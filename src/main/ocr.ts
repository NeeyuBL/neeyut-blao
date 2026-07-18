import { spawn, ChildProcess } from 'node:child_process'
import { access, mkdir, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { binDir, downloadFile, extractZip, resolveFfmpeg } from './deps'
import { debugRaw, errLabel, logInfo } from './logger'
import type { OcrEngineStatus, OcrProgress, OcrResult } from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const BASE = 'https://github.com/NeeyuBL/neeyut-blao/releases/latest/download'

// Engine RIENG (~232MB) — chi tab Dich man hinh tai.
// Vi sao khong gop vao whisper-engine: opencv 118MB la MA, bi dong bang thang
// vao .exe, khong tach thanh goi du lieu tai rieng duoc. Gop vao la bat nguoi
// chi lam phu de ganh them 150MB. (Theo dung nep dy-engine cua tab Douyin.)
function asset(): string {
  return isWin ? 'ocr-engine-win.zip' : isMac ? 'ocr-engine-macos.zip' : 'ocr-engine-linux.zip'
}
function engineDir(): string {
  return join(binDir(), 'ocr-engine')
}
function enginePath(): string {
  return join(engineDir(), isWin ? 'ocr-engine.exe' : 'ocr-engine')
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function ocrEngineStatus(): Promise<OcrEngineStatus> {
  return { has: await exists(enginePath()) }
}

export async function installOcrEngine(onProgress: (p: number) => void): Promise<void> {
  await mkdir(binDir(), { recursive: true })
  const zip = join(binDir(), 'ocr-engine.zip')
  logInfo('Dịch màn hình: đang tải công cụ (~230MB)…')
  await downloadFile(`${BASE}/${asset()}`, zip, onProgress)
  logInfo('Dịch màn hình: đang giải nén…')
  await extractZip(zip, binDir())
  const { rm } = await import('node:fs/promises')
  await rm(zip, { force: true })
  logInfo('Dịch màn hình: đã cài xong công cụ.')
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
export async function ocrVideo(
  input: string,
  outputDir: string,
  y0: number,
  y1: number,
  onProgress: (p: OcrProgress) => void
): Promise<OcrResult> {
  if (child) return { ok: false, error: 'Đang xử lý một video khác.' }
  if (!(await exists(enginePath()))) {
    return { ok: false, error: 'Chưa có công cụ. Vui lòng tải công cụ trước.' }
  }
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const out = join(outputDir, basename(input).replace(/\.[^.]+$/, '') + '.srt')
  const args = [
    '--input', input,
    '--output', out,
    '--y0', String(y0),
    '--y1', String(y1),
    '--ffmpeg', ff
  ]
  logInfo(`Dịch màn hình: bắt đầu đọc ${basename(input)}…`)

  return new Promise<OcrResult>((resolve) => {
    const p = spawn(enginePath(), args, {
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
      resolve({ ok: false, error: errLabel(err) })
    })

    p.on('close', (code) => {
      child = null
      if (doneOut) {
        logInfo(`Dịch màn hình: xong ${count} câu.`)
        resolve({ ok: true, output: doneOut, count, bandTop, bandBot })
        return
      }
      // Bi huy giua chung -> khong phai loi
      if (code === null) {
        resolve({ ok: false, error: 'Đã huỷ.' })
        return
      }
      const raw = errMsg || errTail || `code ${code}`
      debugRaw('ocr close', raw)
      resolve({ ok: false, error: errLabel(raw) })
    })
  })
}
