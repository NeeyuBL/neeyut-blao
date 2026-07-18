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

/** Chay 1 lenh, gom stdout+stderr. */
function runCapture(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      child.stdout.on('data', (d) => (out += d.toString()))
      child.stderr.on('data', (d) => (out += d.toString()))
      child.on('error', () => resolve({ code: -1, out }))
      child.on('close', (code) => resolve({ code: code ?? -1, out }))
    } catch {
      resolve({ code: -1, out })
    }
  })
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

/** Giai nen zip: Windows dung Expand-Archive, macOS/Linux dung unzip (co san). */
export function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = isWin
      ? spawn(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`
          ],
          { windowsHide: true }
        )
      : spawn('unzip', ['-o', zipPath, '-d', destDir])
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Giải nén thất bại'))))
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
    // KHONG dung yt-dlp/FFmpeg-Builds "latest" (master): no doi nv-codec-headers
    // MOI NHAT -> nvenc yeu cau driver rat moi (vd 610) ma DA SO may chua co ->
    // nvenc chet, ghep phu de chi chay CPU. Da do that: ban 2026-05-18 (gyan,
    // nv-codec-headers cu hon) nvenc CHAY tren driver 581 -> GPU 18s vs CPU 62s.
    // Host tren release rieng (github NeeyuBL/neeyut-blao) de KHOA phien ban ffmpeg
    // tuong thich rong, khong bi day len bleeding-edge. -> PHAI upload ffmpeg-win.zip.
    const url = 'https://github.com/NeeyuBL/neeyut-blao/releases/latest/download/ffmpeg-win.zip'
    await downloadFile(url, tmpZip, (p) =>
      onProgress({ phase: 'downloading-ffmpeg', message: `Đang tải ffmpeg… ${p}%`, percent: p })
    )
    onProgress({ phase: 'extracting', message: 'Đang giải nén ffmpeg…', percent: -1 })
    const extractDir = join(binDir(), 'ffmpeg_tmp')
    await rm(extractDir, { recursive: true, force: true })
    await extractZip(tmpZip, extractDir)

    for (const bin of ['ffmpeg.exe', 'ffprobe.exe']) {
      const src = await findFile(extractDir, bin)
      if (src) await copyFile(src, join(binDir(), bin))
    }
    await rm(extractDir, { recursive: true, force: true })
    await rm(tmpZip, { force: true })
  } else if (isMac) {
    // macOS: tai ffmpeg + ffprobe static (moi cai la 1 zip chua 1 binary).
    // LUU Y: chua kiem thu tren may Mac that — can xac minh o giai doan macOS.
    const targets: [string, string][] = [
      ['ffmpeg', 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip'],
      ['ffprobe', 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip']
    ]
    for (const [name, url] of targets) {
      const tmpZip = join(binDir(), `${name}.zip`)
      await downloadFile(url, tmpZip, (p) =>
        onProgress({ phase: 'downloading-ffmpeg', message: `Đang tải ${name}… ${p}%`, percent: p })
      )
      onProgress({ phase: 'extracting', message: `Đang giải nén ${name}…`, percent: -1 })
      const extractDir = join(binDir(), `${name}_tmp`)
      await rm(extractDir, { recursive: true, force: true })
      await extractZip(tmpZip, extractDir)
      const src = await findFile(extractDir, name)
      if (src) {
        await copyFile(src, join(binDir(), name))
        await chmod(join(binDir(), name), 0o755)
      }
      await rm(extractDir, { recursive: true, force: true })
      await rm(tmpZip, { force: true })
    }
  } else {
    // Linux: khuyen nghi cai qua he thong.
    throw new Error(
      'Trên Linux, vui lòng cài ffmpeg qua hệ thống (vd: apt install ffmpeg) rồi mở lại ứng dụng.'
    )
  }
}

/** Da co ban yt-dlp rieng do app quan ly (trong userData/bin) chua? */
export function hasLocalYtDlp(): Promise<boolean> {
  return fileExists(join(binDir(), exe('yt-dlp')))
}

/** Phien ban yt-dlp hien tai (chuoi), null neu khong lay duoc. */
export async function ytDlpVersion(): Promise<string | null> {
  const cmd = await resolveYtDlp()
  if (!cmd) return null
  const r = await runCapture(cmd, ['--version'])
  return r.code === 0 ? r.out.trim().split(/\r?\n/)[0] || null : null
}

/**
 * Cap nhat cong cu tai (yt-dlp) len ban moi nhat.
 * - Co ban rieng trong binDir -> tu cap nhat qua `-U` (nhe).
 * - Chua co -> tai ban .exe moi nhat ve binDir (app se dung ban nay).
 */
export async function updateYtDlp(): Promise<{ ok: boolean; message: string }> {
  const local = join(binDir(), exe('yt-dlp'))
  if (await fileExists(local)) {
    const r = await runCapture(local, ['-U'])
    const line =
      r.out
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-1)[0] || 'Đã kiểm tra cập nhật.'
    return { ok: r.code === 0, message: line }
  }
  try {
    await installYtDlp(() => {})
    const v = await ytDlpVersion()
    return { ok: true, message: `Đã tải bản mới nhất${v ? ` (${v})` : ''}.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
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
