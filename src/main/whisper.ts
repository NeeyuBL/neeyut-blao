import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access, chmod, mkdir, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { binDir, downloadFile, extractZip } from './deps'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import {
  WhisperCudaStatus,
  WhisperEngineStatus,
  WhisperProgress,
  WhisperRequest,
  WhisperResult
} from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

// Engine (faster-whisper freeze PyInstaller --onedir) nen chay CPU.
// Ban GPU se tai them CUDA libs khi phat hien NVIDIA (giai doan B5).
const WHISPER_ENGINE_BASE = 'https://github.com/NeeyuBL/neeyut-blao/releases/latest/download'
function engineAsset(): string {
  return isWin
    ? 'whisper-engine-win.zip'
    : isMac
      ? 'whisper-engine-macos.zip'
      : 'whisper-engine-linux.zip'
}
function engineUrl(): string {
  return `${WHISPER_ENGINE_BASE}/${engineAsset()}`
}
function engineExe(): string {
  return isWin ? 'whisper-engine.exe' : 'whisper-engine'
}
/** Thu muc engine (onedir): binDir/whisper-engine/ chua exe + _internal. */
function engineDir(): string {
  return join(binDir(), 'whisper-engine')
}
function enginePath(): string {
  return join(engineDir(), engineExe())
}
/** Noi cache model (tai lan dau tu HF Hub) — nam trong userData. */
function modelDir(): string {
  return join(app.getPath('userData'), 'whisper-models')
}

// ---- Goi tang toc GPU (cuBLAS + cuDNN) — chi tai khi user co NVIDIA va chu dong bat ----
function cudaAsset(): string {
  return isWin
    ? 'whisper-cuda-win.zip'
    : isMac
      ? 'whisper-cuda-macos.zip'
      : 'whisper-cuda-linux.zip'
}
function cudaUrl(): string {
  return `${WHISPER_ENGINE_BASE}/${cudaAsset()}`
}
/** Thu muc chua cac DLL CUDA — engine se nap tu day khi chay --device cuda. */
function cudaDir(): string {
  return join(binDir(), 'whisper-cuda')
}

export async function whisperCudaStatus(): Promise<WhisperCudaStatus> {
  try {
    const files = await readdir(cudaDir())
    return { has: files.some((f) => f.toLowerCase().endsWith('.dll') || f.toLowerCase().endsWith('.so')) }
  } catch {
    return { has: false }
  }
}

export async function installCudaPack(onProgress: (percent: number) => void): Promise<void> {
  await mkdir(binDir(), { recursive: true })
  const zip = join(binDir(), 'whisper-cuda.zip')
  logInfo('Audio→Text: đang tải gói tăng tốc GPU (~1GB)…')
  await downloadFile(cudaUrl(), zip, onProgress)
  logInfo('Audio→Text: đang giải nén gói GPU…')
  await rm(cudaDir(), { recursive: true, force: true })
  await mkdir(cudaDir(), { recursive: true })
  await extractZip(zip, cudaDir())
  await rm(zip, { force: true })
  logInfo('Audio→Text: đã cài gói tăng tốc GPU.')
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function whisperEngineStatus(): Promise<WhisperEngineStatus> {
  return { has: await fileExists(enginePath()) }
}

export async function installWhisperEngine(onProgress: (percent: number) => void): Promise<void> {
  await mkdir(binDir(), { recursive: true })
  const zip = join(binDir(), 'whisper-engine.zip')
  logInfo('Audio→Text: đang tải bộ chuyển giọng nói…')
  await downloadFile(engineUrl(), zip, onProgress)
  logInfo('Audio→Text: đang giải nén…')
  await rm(engineDir(), { recursive: true, force: true })
  await extractZip(zip, binDir())
  await rm(zip, { force: true })
  if (!isWin) await chmod(enginePath(), 0o755)
  logInfo('Audio→Text: đã cài xong engine.')
}

/** Phien am 1 file: spawn engine, doc JSON-lines stdout -> tien do + ket qua. */
export async function transcribeAudio(
  id: string,
  req: WhisperRequest,
  onProgress: (p: WhisperProgress) => void
): Promise<WhisperResult> {
  const engine = enginePath()
  if (!(await fileExists(engine))) {
    return {
      id,
      ok: false,
      outputs: [],
      segments: 0,
      speakers: 0,
      error: 'Chưa có công cụ Audio→Text. Vui lòng tải công cụ trước.'
    }
  }
  await mkdir(modelDir(), { recursive: true })
  const formats = req.formats && req.formats.length ? req.formats : ['srt']

  // Chi chay GPU khi user chon 'cuda' VA da co goi tang toc; nguoc lai CPU.
  const useCuda = req.device === 'cuda' && (await whisperCudaStatus()).has

  const args = [
    '--input', req.input,
    '--output-dir', req.outputDir,
    '--model', req.model,
    '--model-dir', modelDir(),
    '--language', req.language || 'auto',
    '--task', req.task,
    '--formats', formats.join(','),
    '--device', useCuda ? 'cuda' : 'cpu'
  ]
  if (useCuda) args.push('--cuda-dir', cudaDir())
  if (req.diarize) {
    args.push('--diarize')
    if (req.speakers > 0) args.push('--speakers', String(req.speakers))
  }

  // Chi ghi TEN TEP, khong ghi ca duong dan — nhat ky khong can biet user
  // luu file o dau trong may ho.
  logInfo(
    `Audio→Text: bắt đầu ${basename(req.input)} (model ${req.model}, ${req.task}, ${useCuda ? 'GPU' : 'CPU'}${req.diarize ? ', nhận diện người nói' : ''})`
  )

  return new Promise<WhisperResult>((resolve) => {
    const child = spawn(engine, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1'
      }
    })

    let duration = 0
    let language: string | null = null
    let outBuf = ''
    let errTail = ''
    let outputs: string[] = []
    let segments = 0
    let speakers = 0
    let doneOk = false
    let errMsg: string | null = null

    onProgress({ id, status: 'preparing', percent: -1, language: null, line: 'Đang chuẩn bị…' })

    const handleLine = (line: string): void => {
      const t = line.trim()
      if (!t || t[0] !== '{') return
      let obj: {
        type?: string
        message?: string
        duration?: number
        language?: string
        seconds?: number
        text?: string
        outputs?: string[]
        segments?: number
        speakers?: number
      }
      try {
        obj = JSON.parse(t)
      } catch {
        return
      }
      switch (obj.type) {
        case 'status':
          onProgress({ id, status: 'preparing', percent: -1, language, line: obj.message ?? null })
          break
        case 'info':
          duration = Number(obj.duration) || 0
          language = obj.language ?? null
          onProgress({ id, status: 'transcribing', percent: 0, language, line: null })
          break
        case 'progress': {
          const sec = Number(obj.seconds) || 0
          const pct = duration > 0 ? Math.min(99, Math.round((sec / duration) * 100)) : -1
          onProgress({ id, status: 'transcribing', percent: pct, language, line: obj.text ?? null })
          break
        }
        case 'done':
          doneOk = true
          outputs = obj.outputs ?? []
          segments = obj.segments ?? 0
          speakers = obj.speakers ?? 0
          break
        case 'error':
          errMsg = obj.message ?? 'Lỗi không rõ'
          break
      }
    }

    const feed = (chunk: string): void => {
      outBuf += chunk
      const parts = outBuf.split(/\r?\n/)
      outBuf = parts.pop() ?? ''
      for (const l of parts) handleLine(l)
    }

    child.stdout.on('data', (d) => feed(d.toString()))
    child.stderr.on('data', (d) => {
      const last = d.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })

    child.on('error', (err) => {
      // Loi tho -> chi console luc phat trien. Nhat ky + UI chi duoc thay NHAN.
      debugRaw('whisper spawn', err)
      const nhan = errLabel(err)
      logError(`Audio→Text: ${nhan}`)
      resolve({ id, ok: false, outputs: [], segments: 0, speakers: 0, error: nhan })
    })

    child.on('close', (code) => {
      if (outBuf) handleLine(outBuf)
      if (doneOk && !errMsg) {
        logInfo(
          `Audio→Text: hoàn tất — ${segments} đoạn, ${outputs.length} tệp${speakers ? `, ${speakers} người nói` : ''}`
        )
        onProgress({ id, status: 'finished', percent: 100, language, line: null })
        resolve({ id, ok: true, outputs, segments, speakers, error: null })
      } else {
        // errTail la stderr THO cua engine — traceback Python lo ten module,
        // duong dan, ca ngan xep cong nghe. TUYET DOI khong dua ra ngoai.
        const raw = errMsg || errTail || `Thoát mã ${code}`
        debugRaw('whisper close', raw)
        const nhan = errLabel(raw)
        logError(`Audio→Text: ${nhan}`)
        onProgress({ id, status: 'error', percent: -1, language, line: nhan })
        resolve({ id, ok: false, outputs, segments, speakers, error: nhan })
      }
    })
  })
}
