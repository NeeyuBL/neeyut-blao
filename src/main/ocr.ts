import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, chmod, mkdir, readdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { ASSET_BASE, binDir, downloadFile, extractZip, resolveFfmpeg } from './deps'
import { engineNeedsUpdate, markEngineInstalled } from './engines-update'
import { detectGpu } from './gpu'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import type {
  OcrEngineStatus,
  OcrInstallMode,
  OcrProgress,
  OcrProvider,
  OcrProviderStatus,
  OcrResult
} from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const BASE = ASSET_BASE

// Engine RIENG — moi provider Windows la mot environment tach biet vi cac goi
// onnxruntime CPU/CUDA/DirectML cung cung cap module `onnxruntime` va ghi de nhau.
// Vi sao khong gop vao whisper-engine: opencv 118MB la MA, bi dong bang thang
// vao .exe, khong tach thanh goi du lieu tai rieng duoc. Gop vao la bat nguoi
// chi lam phu de ganh them 150MB. (Theo dung nep dy-engine cua tab Douyin.)
const PROVIDERS: OcrProvider[] = ['cuda', 'directml', 'cpu']
const GPU_PROVIDERS: OcrProvider[] = ['cuda', 'directml']
const OCR_HASH_MANIFEST = `${BASE}/ocr-engines-sha256.json`

function asset(provider: OcrProvider): string {
  if (isWin) return `ocr-engine-win-${provider}.zip`
  return isMac ? 'ocr-engine-macos.zip' : 'ocr-engine-linux.zip'
}
function engineDir(provider: OcrProvider): string {
  if (!isWin) return join(binDir(), 'ocr-engine')
  return join(binDir(), `ocr-engine-${provider}`)
}
function enginePath(provider: OcrProvider): string {
  return join(engineDir(provider), isWin ? 'ocr-engine.exe' : 'ocr-engine')
}

interface SelfTestPayload {
  type?: string
  ok?: boolean
  provider?: OcrProvider
  execution_provider?: string
  strict?: boolean
  gpu_required?: boolean
  hybrid?: boolean
  device_id?: number
  inference_ms?: number
  models?: Partial<Record<'det' | 'cls' | 'rec', string>>
  message?: string
}

const probeCache = new Map<OcrProvider, OcrProviderStatus>()

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function runCapture(
  command: string,
  args: string[],
  timeoutMs = 120_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    try {
      const runner = spawn(command, args, {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      })
      const finish = (code: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      }
      const timer = setTimeout(() => {
        stderr += '\nQuá thời gian tự kiểm tra GPU.'
        runner.kill()
        finish(-1)
      }, timeoutMs)
      runner.stdout.on('data', (data: Buffer) => (stdout += data.toString()))
      runner.stderr.on('data', (data: Buffer) => (stderr += data.toString()))
      runner.on('error', (error) => {
        stderr += `\n${error.message}`
        finish(-1)
      })
      runner.on('close', (code) => finish(code ?? -1))
    } catch (error) {
      resolve({ code: -1, stdout, stderr: error instanceof Error ? error.message : String(error) })
    }
  })
}

function emptyProviderStatus(provider: OcrProvider, installed = false): OcrProviderStatus {
  return {
    provider,
    installed,
    ready: false,
    strict: false,
    hybrid: false,
    deviceId: 0,
    inferenceMs: null,
    executionProvider: null,
    models: {},
    error: installed ? 'Công cụ chưa vượt qua tự kiểm tra.' : null
  }
}

async function runProviderSelfTest(
  path: string,
  provider: OcrProvider,
  deviceId: number
): Promise<{ result: Awaited<ReturnType<typeof runCapture>>; payload: SelfTestPayload | null }> {
  const args = ['--self-test', '--provider', provider, '--device-id', String(deviceId)]
  if (provider !== 'cpu') args.push('--require-gpu')
  if (provider === 'cuda') args.push('--forbid-cpu-fallback')
  const result = await runCapture(path, args)
  let payload: SelfTestPayload | null = null
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try {
      const parsed = JSON.parse(line) as SelfTestPayload
      if (parsed.type === 'self-test') payload = parsed
      if (parsed.type === 'error' && parsed.message) payload = parsed
    } catch {
      // Bo qua log khong phai JSON protocol.
    }
  }
  return { result, payload }
}

function selfTestReady(
  provider: OcrProvider,
  code: number,
  payload: SelfTestPayload | null
): boolean {
  const models = payload?.models ?? {}
  return (
    code === 0 &&
    payload?.ok === true &&
    (provider === 'cpu' || payload.gpu_required === true) &&
    (provider !== 'cuda' || payload.strict === true) &&
    ['det', 'cls', 'rec'].every((name) => Boolean(models[name as keyof typeof models]))
  )
}

async function probeProvider(provider: OcrProvider, refresh = false): Promise<OcrProviderStatus> {
  if (!refresh) {
    const cached = probeCache.get(provider)
    if (cached) return cached
  }
  const path = enginePath(provider)
  if (!(await exists(path))) {
    const missing = emptyProviderStatus(provider)
    probeCache.set(provider, missing)
    return missing
  }
  // DirectML danh so theo DXGI. Laptop hai GPU thuong de iGPU o adapter 0 va
  // GPU roi o adapter 1, nen do bang suy luan that va chon adapter nhanh hon.
  const attempts: Awaited<ReturnType<typeof runProviderSelfTest>>[] = []
  const deviceIds = provider === 'directml' && isWin ? [0, 1, 2, 3] : [0]
  let foundAdapter = false
  for (const id of deviceIds) {
    const attempt = await runProviderSelfTest(path, provider, id)
    const ok = selfTestReady(provider, attempt.result.code, attempt.payload)
    attempts.push(attempt)
    if (ok) foundAdapter = true
    // DXGI danh so adapter lien tuc. Sau adapter hop le dau tien, mot ID khong
    // hop le co nghia la da het danh sach; khong khoi dong them process ton kem.
    if (foundAdapter && !ok) break
  }
  const successful = attempts.filter(({ result, payload }) => selfTestReady(provider, result.code, payload))
  const selected = successful.sort(
    (a, b) => (a.payload?.inference_ms ?? Number.MAX_SAFE_INTEGER) - (b.payload?.inference_ms ?? Number.MAX_SAFE_INTEGER)
  )[0] ?? attempts[0]
  const { result, payload } = selected
  const models = payload?.models ?? {}
  const ready = selfTestReady(provider, result.code, payload)
  const status: OcrProviderStatus = {
    provider,
    installed: true,
    ready,
    strict: payload?.strict === true,
    hybrid: payload?.hybrid === true,
    deviceId: payload?.device_id ?? 0,
    inferenceMs: typeof payload?.inference_ms === 'number' ? payload.inference_ms : null,
    executionProvider: payload?.execution_provider ?? null,
    models,
    error: ready
      ? null
      : payload?.message || result.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || `Tự kiểm tra thất bại (code ${result.code}).`
  }
  probeCache.set(provider, status)
  return status
}

export async function ocrEngineStatus(refresh = false): Promise<OcrEngineStatus> {
  const gpu = isWin ? await detectGpu() : null
  // DirectML la goi Windows mac dinh: nho, tu mang runtime va ho tro ca NVIDIA,
  // AMD, Intel. CUDA van duoc nhan dien neu nguoi dung da cai goi tuy chon.
  const recommendedProvider: OcrProvider = isWin ? 'directml' : 'cpu'
  const providers = await Promise.all(PROVIDERS.map((provider) => probeProvider(provider, refresh)))
  const activeGpu = providers.find((status) => GPU_PROVIDERS.includes(status.provider) && status.ready)
  const cpu = providers.find((status) => status.provider === 'cpu' && status.ready)
  const activeProvider = activeGpu?.provider ?? cpu?.provider ?? null
  const has = providers.some((status) => status.installed)
  return {
    has,
    needsUpdate: await engineNeedsUpdate('ocr', has),
    recommendedProvider,
    activeProvider,
    gpuRequired: isWin,
    gpuName: gpu?.hasNvidia ? gpu.name : isWin ? 'GPU DirectX 12' : null,
    providers,
    error: activeProvider ? null : 'Chưa có công cụ OCR nào vượt qua tự kiểm tra.'
  }
}

async function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function expectedAssetSha256(name: string): Promise<string> {
  const response = await fetch(OCR_HASH_MANIFEST, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`Không tải được checksum OCR (${response.status}).`)
  const manifest = (await response.json()) as Record<string, string>
  const value = manifest[name]
  if (!/^[a-f0-9]{64}$/i.test(value ?? '')) throw new Error(`Thiếu checksum cho ${name}.`)
  return value.toLowerCase()
}

async function installProvider(provider: OcrProvider, onProgress: (p: number) => void): Promise<OcrProviderStatus> {
  await mkdir(binDir(), { recursive: true })
  const assetName = asset(provider)
  const zip = join(binDir(), `${assetName}.download`)
  logInfo(`Dịch màn hình: đang tải công cụ ${provider.toUpperCase()}…`)
  await downloadFile(`${BASE}/${assetName}`, zip, onProgress)
  try {
    if (isWin) {
      const [expected, actual] = await Promise.all([expectedAssetSha256(assetName), fileSha256(zip)])
      if (expected !== actual.toLowerCase()) {
        throw new Error(`Checksum ${assetName} không khớp. Đã huỷ cài đặt.`)
      }
    }
  } catch (error) {
    await rm(zip, { force: true })
    throw error
  }
  logInfo(`Dịch màn hình: đang giải nén công cụ ${provider.toUpperCase()}…`)
  const target = engineDir(provider)
  const backup = `${target}.backup`
  await rm(backup, { recursive: true, force: true })
  const hadPrevious = await exists(target)
  if (hadPrevious) await rename(target, backup)
  try {
    await extractZip(zip, binDir())
    if (!isWin && (await exists(enginePath(provider)))) await chmod(enginePath(provider), 0o755)
    probeCache.delete(provider)
    const status = await probeProvider(provider, true)
    if (!status.ready) throw new Error(status.error || `${provider} không vượt qua tự kiểm tra.`)
    await rm(backup, { recursive: true, force: true })
    return status
  } catch (error) {
    // Bản cập nhật lỗi không được phá engine cũ đang hoạt động.
    await rm(target, { recursive: true, force: true })
    if (hadPrevious && (await exists(backup))) await rename(backup, target)
    probeCache.delete(provider)
    throw error
  } finally {
    await rm(zip, { force: true })
  }
}

export async function installOcrEngine(
  mode: OcrInstallMode,
  onProgress: (p: number) => void
): Promise<OcrEngineStatus> {
  const candidates: OcrProvider[] = mode !== 'auto' ? [mode] : isWin ? ['directml'] : ['cpu']
  const failures: string[] = []
  for (const provider of candidates) {
    try {
      await installProvider(provider, onProgress)
      await markEngineInstalled('ocr')
      logInfo(`Dịch màn hình: ${provider.toUpperCase()} đã vượt qua tự kiểm tra.`)
      return ocrEngineStatus(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${provider.toUpperCase()}: ${message}`)
      debugRaw(`ocr install ${provider}`, error)
      if (mode !== 'auto') break
    }
  }
  throw new Error(`Không cài được công cụ đã chọn. ${failures.join(' · ')}`)
}

let child: ChildProcess | null = null

/** Huy giua chung: dong tien trinh, video dai co the chay vai phut. */
export function cancelOcr(): void {
  if (!child) return
  try {
    child.kill()
  } catch {
    /* bo qua */
  }
  child = null
}

/**
 * Doc chu chay tren video -> .srt.
 * y0/y1 la PIXEL CUA VIDEO GOC (giao dien da quy doi san).
 */
interface SrtCue {
  id: number
  start: string
  end: string
  text: string
}

function parseSrt(content: string): SrtCue[] {
  const blocks = content.trim().split(/\r?\n\r?\n/)
  const cues: SrtCue[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    if (lines.length >= 3) {
      const id = parseInt(lines[0].trim(), 10)
      const timeLine = lines[1].trim()
      const text = lines.slice(2).join('\n').trim()
      const timeParts = timeLine.split(' --> ')
      if (timeParts.length === 2) {
        cues.push({
          id,
          start: timeParts[0],
          end: timeParts[1],
          text
        })
      }
    }
  }
  return cues
}

function convertToVtt(cues: SrtCue[]): string {
  const lines = ['WEBVTT', '']
  for (const cue of cues) {
    const start = cue.start.replace(',', '.')
    const end = cue.end.replace(',', '.')
    lines.push(`${cue.id}`)
    lines.push(`${start} --> ${end}`)
    lines.push(cue.text)
    lines.push('')
  }
  return lines.join('\n')
}

function convertToTxt(cues: SrtCue[]): string {
  return cues.map((c) => c.text).join('\n')
}

function convertToJson(cues: SrtCue[]): string {
  return JSON.stringify(cues, null, 2)
}

/**
 * Doc chu chay tren video -> .srt.
 * y0/y1 la PIXEL CUA VIDEO GOC (giao dien da quy doi san).
 */
export async function ocrVideo(
  input: string,
  outputDir: string,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
  formats: string[],
  provider: OcrProvider,
  onProgress: (p: OcrProgress) => void
): Promise<OcrResult> {
  if (child) return { ok: false, error: 'Đang xử lý một video khác.' }
  if (!PROVIDERS.includes(provider)) return { ok: false, error: 'Provider OCR không hợp lệ.' }
  const providerStatus = await probeProvider(provider)
  if (!providerStatus.ready) {
    return {
      ok: false,
      provider,
      error:
        provider !== 'cpu'
          ? `GPU ${provider.toUpperCase()} chưa vượt qua tự kiểm tra. ${providerStatus.error ?? ''}`.trim()
          : `CPU OCR chưa sẵn sàng. ${providerStatus.error ?? ''}`.trim()
    }
  }
  const executable = enginePath(provider)
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const out = join(outputDir, basename(input).replace(/\.[^.]+$/, '') + '.srt')
  const args = [
    '--input', input,
    '--output', out,
    '--y0', String(y0),
    '--y1', String(y1),
    '--x0', String(x0),
    '--x1', String(x1),
    '--ffmpeg', ff,
    '--provider', provider,
    '--device-id', String(providerStatus.deviceId)
  ]
  if (provider !== 'cpu') args.push('--require-gpu')
  if (provider === 'cuda') args.push('--forbid-cpu-fallback')
  logInfo(`Dịch màn hình: bắt đầu đọc ${basename(input)} bằng ${provider.toUpperCase()}…`)

  return new Promise<OcrResult>((resolve) => {
    const p = spawn(executable, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    })
    child = p

    let buf = ''
    let errTail = ''
    let doneOut: string | null = null
    let count = 0
    let bandTop: number | null = null
    let bandBot: number | null = null
    let errMsg: string | null = null
    let confirmedProvider: OcrProvider | null = null

    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      for (const line of parts) {
        const t = line.trim()
        if (!t || t[0] !== '{') continue
        try {
          const o = JSON.parse(t) as {
            type?: string
            percent?: number
            text?: string
            message?: string
            output?: string
            count?: number
            band_top?: number | null
            band_bot?: number | null
            provider?: OcrProvider
            frames?: number
            visual_segments?: number
            detection_frames?: number
            detection_episodes?: number
            ocr_candidates?: number
            final_cues?: number
            merged_candidates?: number
          }
          if (o.type === 'progress') {
            onProgress({ percent: o.percent ?? 0, text: o.text ?? '' })
          } else if (o.type === 'status') {
            onProgress({ percent: -1, text: o.message ?? '' })
          } else if (o.type === 'done') {
            doneOut = o.output ?? out
            count = o.count ?? 0
            bandTop = o.band_top ?? null
            bandBot = o.band_bot ?? null
          } else if (o.type === 'provider') {
            confirmedProvider = o.provider ?? null
          } else if (o.type === 'diagnostic') {
            logInfo(
              `Dịch màn hình: ${o.frames ?? 0} frame · ${o.detection_frames ?? 0} frame có chữ · ${o.detection_episodes ?? o.visual_segments ?? 0} đoạn chữ · ${o.ocr_candidates ?? 0} mẫu OCR · ${o.final_cues ?? 0} cue · đã gộp ${o.merged_candidates ?? 0}.`
            )
          } else if (o.type === 'error') {
            errMsg = o.message ?? null
          }
        } catch {
          /* bo qua dong hong */
        }
      }
    })

    p.stderr.on('data', (d: Buffer) => {
      const last = d.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })

    p.on('error', (err) => {
      debugRaw('ocr spawn', err)
      child = null
      const nhan = errLabel(err)
      logError(`Dịch màn hình: ${nhan}`)
      resolve({ ok: false, error: nhan })
    })

    p.on('close', async (code) => {
      child = null
      if (doneOut) {
        if (confirmedProvider !== provider) {
          const message = 'Engine không xác nhận đúng provider đã chọn. Đã huỷ kết quả để tránh chạy nhầm CPU.'
          logError(`Dịch màn hình: ${message}`)
          resolve({ ok: false, error: message, provider })
          return
        }
        logInfo(`Dịch màn hình: xong ${count} câu.`)

        const outputs: string[] = []
        try {
          const srtContent = await readFile(doneOut, 'utf8')
          const cues = parseSrt(srtContent)

          const txtPath = doneOut.replace(/\.srt$/i, '.txt')
          const vttPath = doneOut.replace(/\.srt$/i, '.vtt')
          const jsonPath = doneOut.replace(/\.srt$/i, '.json')

          if (formats.includes('.srt')) {
            outputs.push(doneOut)
          }
          if (formats.includes('.txt')) {
            await writeFile(txtPath, convertToTxt(cues), 'utf8')
            outputs.push(txtPath)
          }
          if (formats.includes('.vtt')) {
            await writeFile(vttPath, convertToVtt(cues), 'utf8')
            outputs.push(vttPath)
          }
          if (formats.includes('.json')) {
            await writeFile(jsonPath, convertToJson(cues), 'utf8')
            outputs.push(jsonPath)
          }

          if (!formats.includes('.srt')) {
            await rm(doneOut, { force: true })
          }
        } catch (err) {
          debugRaw('ocr format conversion error', err)
          if (outputs.length === 0) {
            outputs.push(doneOut)
          }
        }

        resolve({ ok: true, output: outputs[0] || doneOut, outputs, count, bandTop, bandBot, provider })
        return
      }
      // Bi huy giua chung -> khong phai loi
      if (code === null) {
        resolve({ ok: false, error: 'Đã huỷ.' })
        return
      }
      const raw = errMsg || errTail || `code ${code}`
      debugRaw('ocr close', raw)
      const nhan = errLabel(raw)
      logError(`Dịch màn hình: ${nhan}`)
      resolve({ ok: false, error: nhan })
    })
  })
}
