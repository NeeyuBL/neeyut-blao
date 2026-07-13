import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, access, rm, readdir, copyFile, chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { DepStatus, SetupProgress } from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

/** Thu muc luu binaries tai ve, nam trong userData (khong can quyen admin). */
export function binDir(): string {
  return join(app.getPath('userData'), 'bin')
}

function exe(name: string): string {
  return isWin ? `${name}.exe` : name
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Kiem tra mot lenh co chay duoc khong (tren PATH hoac duong dan tuyet doi). */
function canRun(cmd: string, args: string[] = ['--version']): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    } catch {
      resolve(false)
    }
  })
}

/** Tra ve duong dan yt-dlp dung duoc: bundled -> PATH -> python -m. Null neu khong co. */
export async function resolveYtDlp(): Promise<string | null> {
  const local = join(binDir(), exe('yt-dlp'))
  if (await fileExists(local)) return local
  if (await canRun('yt-dlp')) return 'yt-dlp'
  return null
}

/** Tra ve duong dan ffmpeg dung duoc: bundled -> PATH. Null neu khong co. */
export async function resolveFfmpeg(): Promise<string | null> {
  const local = join(binDir(), exe('ffmpeg'))
  if (await fileExists(local)) return local
  if (await canRun('ffmpeg')) return 'ffmpeg'
  return null
}

export async function checkDependencies(): Promise<DepStatus> {
  const [yt, ff] = await Promise.all([resolveYtDlp(), resolveFfmpeg()])
  return { ytdlp: yt !== null, ffmpeg: ff !== null, platform: process.platform }
}

type ProgressCb = (p: SetupProgress) => void

/** Tai 1 file voi progress theo Content-Length. Theo redirect (fetch mac dinh). */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Tai that bai (${res.status}) tu ${url}`)
  }
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0

  await mkdir(binDir(), { recursive: true })
  const out = createWriteStream(dest)

  const nodeStream = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)))
  })

  await new Promise<void>((resolve, reject) => {
    nodeStream.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    nodeStream.on('error', reject)
  })
}

/** Giai nen zip bang PowerShell Expand-Archive (Windows). */
function expandZipWindows(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`
      ],
      { windowsHide: true }
    )
    ps.on('error', reject)
    ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Expand-Archive that bai'))))
  })
}

/** Tim de quy 1 file ten cho truoc trong thu muc. */
async function findFile(dir: string, name: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      const found = await findFile(full, name)
      if (found) return found
    } else if (e.name.toLowerCase() === name.toLowerCase()) {
      return full
    }
  }
  return null
}

async function installYtDlp(onProgress: ProgressCb): Promise<void> {
  onProgress({ phase: 'downloading-ytdlp', message: 'Đang tải bộ tải xuống…', percent: 0 })
  const dest = join(binDir(), exe('yt-dlp'))
  let url: string
  if (isWin) {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  } else if (isMac) {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
  } else {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
  }
  await downloadFile(url, dest, (p) =>
    onProgress({ phase: 'downloading-ytdlp', message: `Đang tải bộ tải xuống… ${p}%`, percent: p })
  )
  if (!isWin) await chmod(dest, 0o755)
}

async function installFfmpeg(onProgress: ProgressCb): Promise<void> {
  onProgress({ phase: 'downloading-ffmpeg', message: 'Đang tải ffmpeg…', percent: 0 })

  if (isWin) {
    const tmpZip = join(binDir(), 'ffmpeg.zip')
    const url =
      'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
    await downloadFile(url, tmpZip, (p) =>
      onProgress({ phase: 'downloading-ffmpeg', message: `Đang tải ffmpeg… ${p}%`, percent: p })
    )
    onProgress({ phase: 'extracting', message: 'Đang giải nén ffmpeg…', percent: -1 })
    const extractDir = join(binDir(), 'ffmpeg_tmp')
    await rm(extractDir, { recursive: true, force: true })
    await expandZipWindows(tmpZip, extractDir)

    for (const bin of ['ffmpeg.exe', 'ffprobe.exe']) {
      const src = await findFile(extractDir, bin)
      if (src) await copyFile(src, join(binDir(), bin))
    }
    await rm(extractDir, { recursive: true, force: true })
    await rm(tmpZip, { force: true })
  } else {
    // macOS/Linux: khuyen nghi cai qua he thong (brew install ffmpeg).
    // MVP tren Windows la trong tam; o day nem loi de UI huong dan.
    throw new Error(
      'Trên macOS/Linux, vui lòng cài ffmpeg qua hệ thống (vd: brew install ffmpeg) rồi mở lại ứng dụng.'
    )
  }
}

/** Chay setup: chi tai cai nao dang thieu. */
export async function runSetup(onProgress: ProgressCb): Promise<void> {
  try {
    const status = await checkDependencies()
    if (!status.ytdlp) await installYtDlp(onProgress)
    if (!status.ffmpeg) await installFfmpeg(onProgress)
    onProgress({ phase: 'done', message: 'Hoàn tất! Sẵn sàng sử dụng.', percent: 100 })
  } catch (err) {
    onProgress({
      phase: 'error',
      message: err instanceof Error ? err.message : String(err),
      percent: -1
    })
    throw err
  }
}
