import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { binDir, resolveYtDlp } from './deps'
import { debugRaw, errLabel, logError, logInfo } from './logger'

/** Nhat ky khong can biet user tai video NAO — chi can biet tu dau. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '(liên kết)'
  }
}
import {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  PlaylistProbe,
  VideoFormat,
  VideoInfo
} from '../shared/types'

const isWin = process.platform === 'win32'

// Ep yt-dlp xuat UTF-8 -> ten file (co ky tu dac biet: ｜, tieng Viet, tieng Trung…)
// trong output khop dung file that. Neu khong, Windows dung cp1252 lam sai ten -> mo file loi.
const utf8Env = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8'
})

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Neu ffmpeg da tai ve binDir thi tra ve thu muc do de truyen cho yt-dlp. */
async function ffmpegLocation(): Promise<string | null> {
  const local = join(binDir(), isWin ? 'ffmpeg.exe' : 'ffmpeg')
  return (await fileExists(local)) ? binDir() : null
}

async function ytdlpCmd(): Promise<string> {
  const cmd = await resolveYtDlp()
  if (!cmd) throw new Error('Không tìm thấy bộ tải xuống. Vui lòng chạy lại bước cài đặt.')
  return cmd
}

function secondsToString(s: number | null): string | null {
  if (s == null || !isFinite(s)) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/** Chay yt-dlp, gom stdout. */
function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: utf8Env() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** Lay thong tin video (tieu de, thumbnail, formats) de hien len UI. */
export async function fetchInfo(
  url: string,
  cookiesFile?: string | null,
  proxy?: string | null
): Promise<VideoInfo> {
  const cmd = await ytdlpCmd()
  const args = ['-J', '--no-warnings', '--no-playlist']
  if (cookiesFile) args.push('--cookies', cookiesFile)
  if (proxy) args.push('--proxy', proxy)
  args.push(url)
  logInfo(`Lấy thông tin video từ ${domainOf(url)}…`)
  const { code, stdout, stderr } = await run(cmd, args)
  if (code !== 0) {
    // stderr THO lo ten cong cu tai (thu tab Giay phep co tinh giau) + URL user
    debugRaw('ytdlp info', stderr)
    const nhan = errLabel(stderr)
    logError(`Lấy thông tin thất bại: ${nhan}`)
    throw new Error(nhan)
  }
  const data = JSON.parse(stdout)

  const rawFormats: any[] = Array.isArray(data.formats) ? data.formats : []
  const formats: VideoFormat[] = rawFormats.map((f) => ({
    format_id: String(f.format_id ?? ''),
    ext: String(f.ext ?? ''),
    resolution: f.resolution ?? (f.height ? `${f.width ?? ''}x${f.height}` : null),
    height: typeof f.height === 'number' ? f.height : null,
    fps: typeof f.fps === 'number' ? f.fps : null,
    vcodec: f.vcodec && f.vcodec !== 'none' ? f.vcodec : null,
    acodec: f.acodec && f.acodec !== 'none' ? f.acodec : null,
    filesize: typeof f.filesize === 'number' ? f.filesize : null,
    filesizeApprox: typeof f.filesize_approx === 'number' ? f.filesize_approx : null,
    tbr: typeof f.tbr === 'number' ? f.tbr : null,
    note: f.format_note ?? null
  }))

  const heights = Array.from(
    new Set(
      formats
        .filter((f) => f.vcodec && f.height)
        .map((f) => f.height as number)
    )
  ).sort((a, b) => b - a)

  return {
    id: String(data.id ?? ''),
    title: String(data.title ?? 'Khong ro tieu de'),
    uploader: data.uploader ?? data.channel ?? null,
    duration: typeof data.duration === 'number' ? data.duration : null,
    durationString: data.duration_string ?? secondsToString(data.duration ?? null),
    thumbnail: data.thumbnail ?? null,
    webpageUrl: data.webpage_url ?? url,
    isPlaylist: data._type === 'playlist',
    playlistCount: typeof data.playlist_count === 'number' ? data.playlist_count : null,
    formats,
    heights
  }
}

/**
 * Kiem tra URL co phai playlist khong (nhanh, dung --flat-playlist).
 * Neu la playlist: tra ve danh sach video. Neu video don: isPlaylist=false.
 */
export async function fetchPlaylist(
  url: string,
  cookiesFile?: string | null,
  proxy?: string | null
): Promise<PlaylistProbe> {
  const cmd = await ytdlpCmd()
  const args = ['-J', '--flat-playlist', '--no-warnings']
  if (cookiesFile) args.push('--cookies', cookiesFile)
  if (proxy) args.push('--proxy', proxy)
  args.push(url)
  logInfo(`Phân tích danh sách từ ${domainOf(url)}…`)
  const { code, stdout, stderr } = await run(cmd, args)
  if (code !== 0) {
    debugRaw('ytdlp playlist', stderr)
    const nhan = errLabel(stderr)
    logError(`Phân tích danh sách thất bại: ${nhan}`)
    throw new Error(nhan)
  }
  const data = JSON.parse(stdout)

  if (data._type === 'playlist' && Array.isArray(data.entries)) {
    const entries = data.entries
      .filter(Boolean)
      .map((e: any) => {
        // Entry co the la playlist con (tab kenh) chu khong phai video don
        const nested =
          e._type === 'playlist' ||
          (typeof e.ie_key === 'string' && e.ie_key.endsWith('Tab')) ||
          (typeof e.url === 'string' && /[?&]list=/.test(e.url))
        return {
          id: String(e.id ?? ''),
          title: String(e.title ?? e.url ?? 'Video'),
          url: String(e.webpage_url ?? e.url ?? ''),
          uploader: e.uploader ?? e.channel ?? null,
          duration: typeof e.duration === 'number' ? e.duration : null,
          durationString: e.duration_string ?? secondsToString(e.duration ?? null),
          isPlaylist: nested,
          count: typeof e.playlist_count === 'number' ? e.playlist_count : null
        }
      })
      .filter((e: { url: string }) => e.url)
    return {
      isPlaylist: true,
      title: String(data.title ?? 'Playlist'),
      count: entries.length,
      entries
    }
  }
  return { isPlaylist: false, title: null, count: 0, entries: [] }
}

const PROG = 'TBLAOPROG'
const PP_TAGS = ['[Merger]', '[ExtractAudio]', '[EmbedThumbnail]', '[Metadata]', '[VideoConvertor]']

/** Dung lenh yt-dlp tu DownloadRequest. */
function buildArgs(req: DownloadRequest, ffLoc: string | null): string[] {
  const args: string[] = []

  // Output: <thu muc>/<mau ten file>
  const template =
    req.outputTemplate && req.outputTemplate.trim()
      ? req.outputTemplate.trim()
      : '%(title)s [%(id)s].%(ext)s'
  args.push('-o', join(req.outputDir, template))
  args.push('--no-playlist')
  args.push('--no-warnings')
  args.push('--newline', '--no-colors')
  args.push(
    '--progress-template',
    `download:${PROG}|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`
  )
  if (ffLoc) args.push('--ffmpeg-location', ffLoc)
  if (isWin) args.push('--windows-filenames')

  const container = req.container || 'mp4'
  if (req.formatId) {
    // Nguoi dung chon dinh dang cu the (uu tien cao nhat)
    args.push('-f', req.formatId)
    if (req.formatId.includes('+')) args.push('--merge-output-format', container)
  } else if (req.kind === 'audio') {
    args.push('-x', '--audio-format', req.audioFormat || 'mp3', '--audio-quality', '0')
  } else {
    // Uu tien codec TUONG THICH: H.264 (avc) -> VP9 -> con lai (AV1 cuoi cung).
    // Tranh AV1 mac dinh vi nhieu trinh phat (VLC cu, may yeu) khong giai ma duoc.
    const h = req.height
    const cap = h && h > 0 ? `[height<=${h}]` : ''
    const fmt =
      `bv*${cap}[vcodec^=avc]+ba[ext=m4a]/` + // H.264 + AAC (chuan MP4, chay moi noi)
      `bv*${cap}[vcodec^=avc]+ba/` + // H.264 + audio khac
      `bv*${cap}[vcodec^=vp]+ba/` + // VP9
      `bv*${cap}+ba/` + // con lai (co the AV1)
      `b${cap}/` + // 1 file san co
      `bv*+ba/b` // du phong cuoi
    args.push('-f', fmt, '--merge-output-format', container)
  }

  // Phu de (chi ap dung cho video)
  if (req.kind === 'video' && (req.writeSubs || req.autoSubs)) {
    if (req.writeSubs) args.push('--write-subs')
    if (req.autoSubs) args.push('--write-auto-subs')
    args.push('--sub-langs', req.subLangs && req.subLangs.trim() ? req.subLangs.trim() : 'en')
    if (req.embedSubs) args.push('--embed-subs')
  }

  if (req.embedThumbnail) args.push('--embed-thumbnail')
  if (req.embedMetadata) args.push('--embed-metadata')

  // Bo qua file da tai (luu lich su o userData)
  if (req.useArchive) {
    args.push('--download-archive', join(app.getPath('userData'), 'download-archive.txt'))
  }
  if (req.forceOverwrite) args.push('--force-overwrites')

  if (req.cookiesFile) args.push('--cookies', req.cookiesFile)
  if (req.proxy) args.push('--proxy', req.proxy)

  args.push(req.url)
  return args
}

/** Chay 1 lan yt-dlp download voi args cho truoc. */
function runYtdlpDownload(
  cmd: string,
  args: string[],
  id: string,
  req: DownloadRequest,
  onProgress: (p: DownloadProgress) => void
): Promise<DownloadResult> {
  return new Promise<DownloadResult>((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, env: utf8Env() })
    let destFile: string | null = null
    let errBuf = ''
    let stdoutBuf = ''

    const emit = (p: Partial<DownloadProgress>): void => {
      onProgress({
        id,
        status: 'downloading',
        percent: 0,
        downloadedBytes: null,
        totalBytes: null,
        speed: null,
        eta: null,
        line: null,
        ...p
      })
    }

    emit({ status: 'preparing', line: 'Bat dau...' })

    const handleLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return

      if (trimmed.startsWith(PROG)) {
        const [, status, dl, total, totalEst, speed, eta] = trimmed.split('|')
        const num = (v: string): number | null => {
          const n = Number(v)
          return v && v !== 'NA' && isFinite(n) ? n : null
        }
        const downloaded = num(dl)
        const totalBytes = num(total) ?? num(totalEst)
        const percent =
          downloaded != null && totalBytes ? Math.min(100, (downloaded / totalBytes) * 100) : 0
        emit({
          status: status === 'finished' ? 'postprocessing' : 'downloading',
          percent,
          downloadedBytes: downloaded,
          totalBytes,
          speed: num(speed),
          eta: num(eta)
        })
        return
      }

      // Nhan dien buoc hau xu ly
      if (PP_TAGS.some((t) => trimmed.includes(t))) {
        emit({ status: 'postprocessing', percent: 100, line: trimmed })
      }

      // Lay duong dan file dich
      const mDest = trimmed.match(/\[download\] Destination: (.+)$/)
      if (mDest) destFile = mDest[1]
      const mMerge = trimmed.match(/\[Merger\] Merging formats into "(.+)"$/)
      if (mMerge) destFile = mMerge[1]
      const mAlready = trimmed.match(/\[download\] (.+) has already been downloaded/)
      if (mAlready) destFile = mAlready[1]
      const mExtract = trimmed.match(/\[ExtractAudio\] Destination: (.+)$/)
      if (mExtract) destFile = mExtract[1]
    }

    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString()
      const parts = stdoutBuf.split(/\r?\n/)
      stdoutBuf = parts.pop() ?? ''
      for (const l of parts) handleLine(l)
    })
    child.stderr.on('data', (d) => (errBuf += d.toString()))

    child.on('error', (err) => {
      debugRaw('ytdlp spawn', err)
      const nhan = errLabel(err)
      logError(`Tải xuống: ${nhan}`)
      resolve({ id, ok: false, file: null, error: nhan })
    })

    child.on('close', (code) => {
      if (stdoutBuf) handleLine(stdoutBuf)
      if (code === 0) {
        emit({ status: 'finished', percent: 100 })
        logInfo(`Hoàn tất: ${destFile ? basename(destFile) : domainOf(req.url)}`)
        resolve({ id, ok: true, file: destFile, error: null })
      } else {
        debugRaw('ytdlp close', errBuf)
        const nhan = errLabel(errBuf || `code ${code}`)
        logError(`Tải xuống thất bại: ${nhan}`)
        resolve({ id, ok: false, file: null, error: nhan })
      }
    })
  })
}

/** Tai xuong: thu voi cau hinh hien tai; neu 403 ma dang dung cookie -> thu lai KHONG cookie. */
export async function download(
  id: string,
  req: DownloadRequest,
  onProgress: (p: DownloadProgress) => void
): Promise<DownloadResult> {
  const cmd = await ytdlpCmd()
  const ffLoc = await ffmpegLocation()
  logInfo(`Bắt đầu tải từ ${domainOf(req.url)}…`)
  const args = buildArgs(req, ffLoc)
  // Dong lenh day du lo: duong dan cong cu, TEN cong cu (thu tab Giay phep co
  // tinh giau), duong dan file cookie, proxy, URL. Chi cho console luc dev.
  debugRaw('ytdlp cmd', `${cmd} ${args.join(' ')}`)
  let result = await runYtdlpDownload(cmd, args, id, req, onProgress)

  // YouTube: cookie dang nhap thuong gay 403 cho video cong khai (thieu PO token).
  // Neu 403 va dang dung cookie -> thu lai KHONG cookie.
  if (!result.ok && req.cookiesFile && /403|forbidden/i.test(result.error ?? '')) {
    logInfo('Tải lỗi 403 khi dùng cookie — thử lại KHÔNG cookie…')
    const req2: DownloadRequest = { ...req, cookiesFile: null }
    const args2 = buildArgs(req2, ffLoc)
    result = await runYtdlpDownload(cmd, args2, id, req2, onProgress)
    if (result.ok) logInfo('Thử lại không cookie: thành công.')
  }
  return result
}
