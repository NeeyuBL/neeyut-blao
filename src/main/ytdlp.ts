import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access, mkdir, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep
} from 'node:path'
import { binDir, resolveFfmpeg, resolveYtDlp } from './deps'
import { debugRaw, logError, logInfo } from './logger'
import { withResolvedDomainCookie } from './cookies'
import {
  siteExecutionContext,
  type SiteExecutionContext
} from './sitePolicy'
import type { SiteId } from '../shared/sites'
import {
  classifyYtDlpError,
  shouldRetryWithoutCookies,
  type YtDlpErrorCode,
  type YtDlpErrorInfo
} from '../shared/ytdlpErrors'

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

const POLICY_URL_CACHE_TTL_MS = 60 * 60 * 1000
const POLICY_URL_CACHE_MAX = 1000
const resolvedPolicyUrls = new Map<string, { url: string; expiresAt: number }>()

function policyUrlKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url.trim()
  }
}

function rememberResolvedPolicyUrl(sourceUrl: string, resolvedUrl: unknown): string {
  let trusted = sourceUrl
  if (typeof resolvedUrl === 'string') {
    try {
      const parsed = new URL(resolvedUrl)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') trusted = parsed.toString()
    } catch {
      /* Metadata URL khong hop le: giu URL nguon. */
    }
  }

  if (resolvedPolicyUrls.size >= POLICY_URL_CACHE_MAX) {
    const oldest = resolvedPolicyUrls.keys().next().value
    if (oldest) resolvedPolicyUrls.delete(oldest)
  }
  resolvedPolicyUrls.set(policyUrlKey(sourceUrl), {
    url: trusted,
    expiresAt: Date.now() + POLICY_URL_CACHE_TTL_MS
  })
  return trusted
}

function resolvedPolicyUrlFor(sourceUrl: string): string {
  const key = policyUrlKey(sourceUrl)
  const cached = resolvedPolicyUrls.get(key)
  if (!cached) return sourceUrl
  if (cached.expiresAt <= Date.now()) {
    resolvedPolicyUrls.delete(key)
    return sourceUrl
  }
  // Lam moi thu tu chen de eviction gan dung LRU.
  resolvedPolicyUrls.delete(key)
  resolvedPolicyUrls.set(key, cached)
  return cached.url
}

const isWin = process.platform === 'win32'

export class YtDlpSiteError extends Error {
  readonly code: YtDlpErrorCode
  readonly site: SiteId

  constructor(info: YtDlpErrorInfo) {
    super(info.message)
    this.name = 'YtDlpSiteError'
    this.code = info.code
    this.site = info.site
  }
}

export function ytdlpErrorPayload(error: unknown): { error: string; errorCode: YtDlpErrorCode } {
  if (error instanceof YtDlpSiteError) return { error: error.message, errorCode: error.code }
  const info = classifyYtDlpError('generic', error)
  return { error: info.message, errorCode: info.code }
}

function siteError(
  context: Pick<SiteExecutionContext, 'site' | 'impersonationAvailable'>,
  raw: unknown
): YtDlpSiteError {
  return new YtDlpSiteError(
    classifyYtDlpError(context.site, raw, {
      impersonationAvailable: context.impersonationAvailable
    })
  )
}

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

function requestArgs(
  base: string[],
  context: SiteExecutionContext,
  cookiesFile: string | null,
  proxy: string | null | undefined,
  url: string
): string[] {
  const args = [...base, ...context.requestArgs]
  if (cookiesFile) args.push('--cookies', cookiesFile)
  if (proxy) args.push('--proxy', proxy)
  args.push(url)
  return args
}

async function runMetadataRequest(
  cmd: string,
  base: string[],
  url: string,
  useCookies: boolean,
  proxy?: string | null
): Promise<{
  context: SiteExecutionContext
  code: number
  stdout: string
  stderr: string
}> {
  return withResolvedDomainCookie(url, useCookies, async (savedCookie) => {
    const context = await siteExecutionContext(url, savedCookie)
    // Metadata Facebook public thu guest + impersonation truoc. Cookie co the
    // lam Facebook tra mot payload khac/khong on dinh du link van public.
    // Neu guest that bai, luon thu dung cookie (khong phu thuoc regex stderr).
    const initialCookie = context.site === 'facebook' ? null : savedCookie
    let result: { code: number; stdout: string; stderr: string }
    try {
      result = await run(cmd, requestArgs(base, context, initialCookie, proxy, url))
    } catch (error) {
      throw siteError(context, error)
    }

    if (context.site === 'facebook' && result.code !== 0 && savedCookie) {
      logInfo('Facebook khong tra metadata cong khai — thu lai bang cookie da luu…')
      try {
        result = await run(cmd, requestArgs(base, context, savedCookie, proxy, url))
      } catch (error) {
        throw siteError(context, error)
      }
    }

    return { context, ...result }
  })
}

/** Lay thong tin video (tieu de, thumbnail, formats) de hien len UI. */
export async function fetchInfo(
  url: string,
  proxy?: string | null,
  useCookies = false
): Promise<VideoInfo> {
  const cmd = await ytdlpCmd()
  const args = ['-J', '--no-playlist']
  logInfo(`Lấy thông tin video từ ${domainOf(url)}…`)
  const { context, code, stdout, stderr } = await runMetadataRequest(
    cmd,
    args,
    url,
    useCookies,
    proxy
  )
  if (code !== 0) {
    // stderr THO lo ten cong cu tai (thu tab Giay phep co tinh giau) + URL user
    debugRaw('ytdlp info', stderr)
    const error = siteError(context, stderr)
    logError(`Lấy thông tin thất bại: ${error.message}`)
    throw error
  }
  let data: any
  try {
    data = JSON.parse(stdout)
  } catch (error) {
    debugRaw('ytdlp info json', error)
    throw siteError(context, 'yt-dlp tra ve metadata JSON khong hop le')
  }

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
  const webpageUrl = rememberResolvedPolicyUrl(url, data.webpage_url)

  return {
    id: String(data.id ?? ''),
    title: String(data.title ?? 'Khong ro tieu de'),
    uploader: data.uploader ?? data.channel ?? null,
    duration: typeof data.duration === 'number' ? data.duration : null,
    durationString: data.duration_string ?? secondsToString(data.duration ?? null),
    thumbnail: data.thumbnail ?? null,
    webpageUrl,
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
  proxy?: string | null,
  useCookies = false
): Promise<PlaylistProbe> {
  const cmd = await ytdlpCmd()
  const args = ['-J', '--flat-playlist']
  logInfo(`Phân tích danh sách từ ${domainOf(url)}…`)
  const { context, code, stdout, stderr } = await runMetadataRequest(
    cmd,
    args,
    url,
    useCookies,
    proxy
  )
  if (code !== 0) {
    debugRaw('ytdlp playlist', stderr)
    const error = siteError(context, stderr)
    logError(`Phân tích danh sách thất bại: ${error.message}`)
    throw error
  }
  let data: any
  try {
    data = JSON.parse(stdout)
  } catch (error) {
    debugRaw('ytdlp playlist json', error)
    throw siteError(context, 'yt-dlp tra ve metadata playlist JSON khong hop le')
  }

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
const FILE_PROG = 'TBLAOFILE'
const PP_TAGS = ['[Merger]', '[ExtractAudio]', '[EmbedThumbnail]', '[Metadata]', '[VideoConvertor]']
const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.mov',
  '.m4v',
  '.avi',
  '.flv',
  '.ts',
  '.m4a',
  '.mp3',
  '.aac',
  '.opus',
  '.ogg',
  '.wav',
  '.flac'
])

interface DownloadPathRecord {
  task: string
  path: string
}

function safeTaskId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'task'
}

function resultSidecarPath(id: string, attempt: string): string {
  return join(
    app.getPath('temp'),
    't-blao-download-results',
    `${safeTaskId(id)}-${safeTaskId(attempt)}.jsonl`
  )
}

function outputTemplateLiteral(value: string): string {
  return value.replace(/%/g, '%%')
}

function downloadPathPrefix(id: string): string {
  return `${FILE_PROG}_${safeTaskId(id)}`
}

function parseDownloadPathRecord(
  raw: string,
  taskId: string
): DownloadPathRecord | null {
  try {
    const path = JSON.parse(raw) as unknown
    if (typeof path !== 'string' || !path) return null
    return {
      task: safeTaskId(taskId),
      path
    }
  } catch {
    return null
  }
}

async function readSidecarRecord(
  sidecar: string,
  taskId: string
): Promise<DownloadPathRecord | null> {
  try {
    const lines = (await readFile(sidecar, 'utf8')).split(/\r?\n/).filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      const record = parseDownloadPathRecord(lines[i], taskId)
      if (record) return record
    }
  } catch {
    /* Sidecar la fallback; stdout hoac scan van co the xac dinh file. */
  }
  return null
}

async function validatedOutputFile(file: string, outputDir: string): Promise<string | null> {
  if (!isAbsolute(file)) return null
  try {
    const root = resolvePath(outputDir)
    const candidate = resolvePath(file)
    const rel = relative(root, candidate)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null

    // Chan symlink dua buoc thay file ra ngoai thu muc user da chon.
    const [realRoot, realCandidate, info] = await Promise.all([
      realpath(root),
      realpath(candidate),
      stat(candidate)
    ])
    const realRel = relative(realRoot, realCandidate)
    if (
      realRel === '..' ||
      realRel.startsWith(`..${sep}`) ||
      isAbsolute(realRel) ||
      !info.isFile() ||
      info.size <= 0
    ) {
      return null
    }
    return candidate
  } catch {
    return null
  }
}

async function fallbackOutputFile(
  outputDir: string,
  mediaId: string | null,
  startedAt: number
): Promise<string | null> {
  const candidates: { path: string; mtimeMs: number }[] = []
  let visited = 0
  let truncated = false

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || visited > 20_000) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      truncated = true
      return
    }
    for (const entry of entries) {
      if (++visited > 20_000) {
        truncated = true
        return
      }
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        try {
          const info = await stat(full)
          if (info.size > 0) candidates.push({ path: full, mtimeMs: info.mtimeMs })
        } catch {
          /* File co the vua bi process khac di chuyen; bo qua. */
        }
      }
    }
  }

  await walk(resolvePath(outputDir), 0)
  if (truncated) return null
  const normalizedId = mediaId?.trim() || null
  if (normalizedId) {
    const byId = candidates.filter((file) => basename(file.path).includes(normalizedId))
    const recentById = byId.filter((file) => file.mtimeMs >= startedAt - 3_000)
    if (recentById.length === 1) return recentById[0].path
    // ID trung nhung file cu khong phai bang chung cua luot tai hien tai.
    // Neu co nhieu ung vien cung ID cung khong duoc tu doan.
    if (byId.length > 0) return null
  }

  const recent = candidates.filter((file) => file.mtimeMs >= startedAt - 3_000)
  return recent.length === 1 ? recent[0].path : null
}

async function resolveDownloadedFile(
  outputDir: string,
  reported: Array<string | null>,
  mediaId: string | null,
  startedAt: number
): Promise<string | null> {
  for (const file of reported) {
    if (!file) continue
    const valid = await validatedOutputFile(file, outputDir)
    if (valid) return valid
  }
  const fallback = await fallbackOutputFile(outputDir, mediaId, startedAt)
  return fallback ? validatedOutputFile(fallback, outputDir) : null
}

/** Dung lenh yt-dlp tu DownloadRequest. */
function buildArgs(
  id: string,
  req: DownloadRequest,
  ffLoc: string | null,
  context: SiteExecutionContext,
  cookiesFile: string | null,
  sidecar: string
): string[] {
  const args: string[] = []

  // Output: <thu muc>/<mau ten file>
  const template =
    req.outputTemplate && req.outputTemplate.trim()
      ? req.outputTemplate.trim()
      : '%(title)s [%(id)s].%(ext)s'
  args.push('-o', join(req.outputDir, template))
  args.push('--no-playlist')
  args.push('--newline', '--no-colors')
  args.push(
    '--progress-template',
    `download:${PROG}|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`
  )
  // JSON conversion `j` ep moi ky tu Unicode thanh ASCII \uXXXX, nen stdout
  // cp1252 van truyen duoc duong dan Trung/Nhat/Han/Thai/A Rap/emoji nguyen ven.
  const pathTemplate = '%(filepath|null)j'
  args.push(
    '--print',
    `after_move:${downloadPathPrefix(id)}|${pathTemplate}`,
    '--print-to-file',
    `after_move:${pathTemplate}`,
    outputTemplateLiteral(sidecar),
    '--no-quiet'
  )
  if (ffLoc) args.push('--ffmpeg-location', ffLoc)
  if (isWin) args.push('--windows-filenames')
  args.push(...context.requestArgs)

  const container = req.container || 'mp4'
  if (req.formatId) {
    // Nguoi dung chon dinh dang cu the (uu tien cao nhat)
    args.push('-f', req.formatId)
    if (req.formatId.includes('+') && !req.ensureH264) {
      args.push('--merge-output-format', container)
    }
  } else if (req.kind === 'audio') {
    args.push('-x', '--audio-format', req.audioFormat || 'mp3', '--audio-quality', '0')
  } else {
    const h = req.height
    const cap = h && h > 0 ? `[height<=${h}]` : ''
    if (req.ensureH264) {
      // Opt-in: thu H.264 truoc de tranh chuyen ma neu website co san. Van co
      // fallback codec khac; buoc sau tai se chuyen file cuoi sang H.264.
      const fmt =
        `bv${cap}[vcodec^=avc]+ba[ext=m4a]/` +
        `bv${cap}[vcodec^=avc]+ba/` +
        `b${cap}[vcodec^=avc]/` +
        `bv*${cap}+ba/b${cap}/bv*+ba/b`
      args.push('-f', fmt)
    } else {
      // Che do mac dinh: khong ep codec, chi ton trong gioi han do phan giai.
      if (cap) args.push('-f', `bv*${cap}+ba/b${cap}/bv*+ba/b`)
      args.push('--merge-output-format', container)
    }
  }
  if (req.kind === 'video' && req.ensureH264) {
    // Bao dam file trung gian co container MP4 truoc khi probe/chuyen codec.
    args.push('--merge-output-format', 'mp4', '--remux-video', 'mp4')
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

  if (cookiesFile) args.push('--cookies', cookiesFile)
  if (req.proxy) args.push('--proxy', req.proxy)

  args.push(req.url)
  return args
}

/** Chay 1 lan yt-dlp download voi args cho truoc. */
interface InternalDownloadResult extends DownloadResult {
  rawError: string | null
}

async function runYtdlpDownload(
  cmd: string,
  args: string[],
  id: string,
  req: DownloadRequest,
  context: SiteExecutionContext,
  onProgress: (p: DownloadProgress) => void,
  sidecar: string
): Promise<InternalDownloadResult> {
  await mkdir(dirname(sidecar), { recursive: true })
  await rm(sidecar, { force: true })
  const startedAt = Date.now()
  return new Promise<InternalDownloadResult>((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, env: utf8Env() })
    let structuredDestFile: string | null = null
    let legacyDestFile: string | null = null
    let skipped = false
    let errBuf = ''
    let stdoutBuf = ''
    let settled = false

    const finish = (result: InternalDownloadResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

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

      const filePrefix = `${downloadPathPrefix(id)}|`
      if (trimmed.startsWith(filePrefix)) {
        const record = parseDownloadPathRecord(trimmed.slice(filePrefix.length), id)
        if (record) structuredDestFile = record.path
        return
      }

      // Nhan dien buoc hau xu ly
      if (PP_TAGS.some((t) => trimmed.includes(t))) {
        emit({ status: 'postprocessing', percent: 100, line: trimmed })
      }

      // Lay duong dan file dich
      const mDest = trimmed.match(/\[download\] Destination: (.+)$/)
      if (mDest) legacyDestFile = mDest[1]
      const mMerge = trimmed.match(/\[Merger\] Merging formats into "(.+)"$/)
      if (mMerge) legacyDestFile = mMerge[1]
      const mAlready = trimmed.match(/\[download\] (.+) has already been downloaded/)
      if (mAlready) legacyDestFile = mAlready[1]
      const mExtract = trimmed.match(/\[ExtractAudio\] Destination: (.+)$/)
      if (mExtract) legacyDestFile = mExtract[1]
      // Archive skip: exit 0 nhung KHONG ghi file vao thu muc moi
      if (/has already been recorded in the archive/i.test(trimmed)) skipped = true
    }

    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString()
      const parts = stdoutBuf.split(/\r?\n/)
      stdoutBuf = parts.pop() ?? ''
      for (const l of parts) handleLine(l)
    })
    child.stderr.on('data', (d) => (errBuf += d.toString()))

    child.on('error', (err) => {
      void rm(sidecar, { force: true }).catch(() => undefined)
      debugRaw('ytdlp spawn', err)
      const info = classifyYtDlpError(context.site, err, {
        impersonationAvailable: context.impersonationAvailable
      })
      logError(`Tải xuống: ${info.message}`)
      finish({
        id,
        ok: false,
        file: null,
        error: info.message,
        errorCode: info.code,
        rawError: String(err)
      })
    })

    child.on('close', async (code) => {
      if (stdoutBuf) handleLine(stdoutBuf)
      if (code === 0) {
        if (skipped) {
          await rm(sidecar, { force: true }).catch(() => undefined)
          emit({ status: 'finished', percent: 100, line: null })
          logInfo(`Bỏ qua (đã có trong lịch sử tải): ${domainOf(req.url)}`)
          finish({
            id,
            ok: true,
            file: null,
            error: null,
            errorCode: null,
            rawError: null,
            skipped: true
          })
          return
        }
        const sidecarRecord = await readSidecarRecord(sidecar, id)
        const destFile = await resolveDownloadedFile(
          req.outputDir,
          [structuredDestFile, sidecarRecord?.path ?? null, legacyDestFile],
          req.mediaId,
          startedAt
        )
        await rm(sidecar, { force: true }).catch(() => undefined)
        emit({
          status: req.ensureH264 && req.kind === 'video' ? 'postprocessing' : 'finished',
          percent: 100,
          line: req.ensureH264 && req.kind === 'video' ? 'Đang kiểm tra codec video…' : null
        })
        if (destFile) {
          logInfo(
            `${req.ensureH264 && req.kind === 'video' ? 'Tải xong' : 'Hoàn tất'} từ ${domainOf(req.url)}.`
          )
          finish({
            id,
            ok: true,
            file: destFile,
            error: null,
            errorCode: null,
            rawError: null,
            skipped: false
          })
        } else {
          const message =
            'Video đã tải nhưng không xác định chắc chắn được file đầu ra; không tiếp tục xử lý để tránh chọn nhầm file.'
          logError(`Không xác định file đầu ra từ ${domainOf(req.url)}.`)
          finish({
            id,
            ok: false,
            file: null,
            error: message,
            errorCode: 'unknown',
            rawError: message,
            skipped: false
          })
        }
      } else {
        await rm(sidecar, { force: true }).catch(() => undefined)
        debugRaw('ytdlp close', errBuf)
        const rawError = errBuf || `yt-dlp exit code ${code}`
        const info = classifyYtDlpError(context.site, rawError, {
          impersonationAvailable: context.impersonationAvailable
        })
        logError(`Tải xuống thất bại: ${info.message}`)
        finish({
          id,
          ok: false,
          file: null,
          error: info.message,
          errorCode: info.code,
          rawError
        })
      }
    })
  })
}

function safeDownloadResult(result: InternalDownloadResult): DownloadResult {
  const { rawError: _rawError, ...safe } = result
  return safe
}

/** Tai xuong voi retry rieng theo tung website. */
export async function download(
  id: string,
  req: DownloadRequest,
  onProgress: (p: DownloadProgress) => void
): Promise<DownloadResult> {
  const cmd = await ytdlpCmd()
  const ffLoc = await ffmpegLocation()
  const sidecar = resultSidecarPath(id, 'primary')
  // Chi tin mapping do chinh fetchInfo trong main process da ghi nhan; renderer
  // khong duoc tu chi dinh domain cookie khac voi URL tai.
  const policyUrl = resolvedPolicyUrlFor(req.url)
  const downloaded = await withResolvedDomainCookie(policyUrl, req.useCookies, async (savedCookie) => {
    const context = await siteExecutionContext(policyUrl, savedCookie)
    // Neu user bat cookie, moi website dung file cua chinh domain ngay tu dau.
    const initialCookie = savedCookie
    logInfo(`Bắt đầu tải từ ${domainOf(req.url)}…`)
    const args = buildArgs(id, req, ffLoc, context, initialCookie, sidecar)
    // Dong lenh day du lo: duong dan cong cu, TEN cong cu (thu tab Giay phep co
    // tinh giau), duong dan file cookie, proxy, URL. Chi cho console luc dev.
    debugRaw('ytdlp cmd', `${cmd} ${args.join(' ')}`)
    let result = await runYtdlpDownload(cmd, args, id, req, context, onProgress, sidecar)

    if (
      !result.ok &&
      initialCookie &&
      shouldRetryWithoutCookies(context.site, result.rawError)
    ) {
      // Workaround nay chi hop le cho YouTube public, khong bao gio ap dung cho
      // Facebook/Bilibili hoac website chung.
      logInfo('Tải lỗi 403 khi dùng cookie — thử lại KHÔNG cookie…')
      const retrySidecar = resultSidecarPath(id, 'without-cookies')
      const args2 = buildArgs(id, req, ffLoc, context, null, retrySidecar)
      result = await runYtdlpDownload(
        cmd,
        args2,
        id,
        req,
        context,
        onProgress,
        retrySidecar
      )
      if (result.ok) logInfo('Thử lại không cookie: thành công.')
    }
    return safeDownloadResult(result)
  })

  // Chuyen ma nam NGOAI cookie lock: FFmpeg co the chay lau nhung khong dung
  // cookie, khong nen chan capture/clear hoac download cung ten mien.
  if (
    downloaded.ok &&
    !downloaded.skipped &&
    req.kind === 'video' &&
    req.ensureH264
  ) {
    if (!downloaded.file) {
      return {
        ...downloaded,
        ok: false,
        error: 'Đã tải xong nhưng không xác định được file để chuyển sang H.264.',
        errorCode: 'unknown'
      }
    }
    try {
      downloaded.file = await ensureH264Output(id, downloaded.file, onProgress)
    } catch (error) {
      debugRaw('h264 conversion', error)
      logError('Chuyển H.264 thất bại; đã giữ file gốc.')
      return {
        ...downloaded,
        ok: false,
        error: 'Video đã tải nhưng không thể chuyển sang H.264; file gốc vẫn được giữ.',
        errorCode: 'unknown'
      }
    }
  }

  return downloaded
}

interface VideoProbe {
  codec: string | null
  duration: number | null
}

function runCapture(
  cmd: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: utf8Env() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => (stdout += data.toString()))
    child.stderr.on('data', (data) => {
      stderr = (stderr + data.toString()).slice(-16_384)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

async function ffprobeCommand(ffmpeg: string): Promise<string> {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  const sibling = join(dirname(ffmpeg), isWin ? 'ffprobe.exe' : 'ffprobe')
  return (await fileExists(sibling)) ? sibling : 'ffprobe'
}

async function probeVideo(file: string, ffmpeg: string): Promise<VideoProbe> {
  const probe = await ffprobeCommand(ffmpeg)
  const result = await runCapture(probe, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name:format=duration',
    '-of',
    'json',
    '--',
    file
  ])
  if (result.code !== 0) throw new Error(result.stderr || 'ffprobe không đọc được video')
  const data = JSON.parse(result.stdout) as {
    streams?: { codec_name?: unknown }[]
    format?: { duration?: unknown }
  }
  const codec = typeof data.streams?.[0]?.codec_name === 'string' ? data.streams[0].codec_name : null
  const rawDuration = Number(data.format?.duration)
  return { codec, duration: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null }
}

function runH264Conversion(
  ffmpeg: string,
  input: string,
  output: string,
  duration: number | null,
  id: string,
  onProgress: (p: DownloadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-y',
      '-i',
      input,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-map',
      '0:s?',
      '-map_metadata',
      '0',
      '-map_chapters',
      '0',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-c:s',
      'mov_text',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      output
    ]
    const child = spawn(ffmpeg, args, { windowsHide: true, env: utf8Env() })
    let stdoutBuf = ''
    let stderr = ''

    const emit = (percent: number): void =>
      onProgress({
        id,
        status: 'converting',
        percent,
        downloadedBytes: null,
        totalBytes: null,
        speed: null,
        eta: null,
        line: 'Đang chuyển video sang H.264…'
      })

    emit(0)
    child.stdout.on('data', (data) => {
      stdoutBuf += data.toString()
      const lines = stdoutBuf.split(/\r?\n/)
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        const match = /^out_time_us=(\d+)$/.exec(line.trim())
        if (!match || !duration) continue
        emit(Math.min(99, (Number(match[1]) / 1_000_000 / duration) * 100))
      }
    })
    child.stderr.on('data', (data) => {
      stderr = (stderr + data.toString()).slice(-16_384)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr || `FFmpeg thoát mã ${code}`))
    })
  })
}

/**
 * Bao dam file dau ra la H.264. File goc chi duoc thay sau khi file tam da
 * probe thanh cong; neu FFmpeg loi thi file tai ve van con nguyen.
 */
async function ensureH264Output(
  id: string,
  file: string,
  onProgress: (p: DownloadProgress) => void
): Promise<string> {
  if (!(await fileExists(file))) throw new Error('Không tìm thấy file vừa tải để kiểm tra codec.')
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Không tìm thấy FFmpeg để chuyển video sang H.264.')

  const source = await probeVideo(file, ffmpeg)
  if (source.codec === 'h264') {
    logInfo('Video đã là H.264, không cần chuyển đổi.')
    onProgress({
      id,
      status: 'finished',
      percent: 100,
      downloadedBytes: null,
      totalBytes: null,
      speed: null,
      eta: null,
      line: null
    })
    return file
  }
  if (!source.codec) throw new Error('Không xác định được codec video vừa tải.')

  const safeId = safeTaskId(id)
  const temp = join(dirname(file), `.${basename(file)}.${safeId}.tblao-h264.mp4`)
  const backup = `${file}.${safeId}.tblao-original`
  await Promise.all([rm(temp, { force: true }), rm(backup, { force: true })])

  try {
    logInfo(`Đang chuyển ${source.codec.toUpperCase()} sang H.264…`)
    await runH264Conversion(ffmpeg, file, temp, source.duration, id, onProgress)
    const converted = await probeVideo(temp, ffmpeg)
    if (converted.codec !== 'h264') throw new Error('File chuyển đổi không có codec H.264.')
    if (
      source.duration &&
      converted.duration &&
      converted.duration < Math.max(1, source.duration * 0.95)
    ) {
      throw new Error('File H.264 sau chuyển đổi không đủ thời lượng.')
    }

    // Windows khong cho rename de len file dang ton tai: giu backup den khi
    // file H.264 da vao dung ten. Cleanup backup khong duoc lam rollback file moi.
    await rename(file, backup)
    try {
      await rename(temp, file)
    } catch (error) {
      await rename(backup, file)
      throw error
    }
    await rm(backup, { force: true }).catch((error) =>
      debugRaw('h264 cleanup backup', error)
    )
    onProgress({
      id,
      status: 'finished',
      percent: 100,
      downloadedBytes: null,
      totalBytes: null,
      speed: null,
      eta: null,
      line: null
    })
    logInfo('Chuyển H.264 hoàn tất.')
    return file
  } finally {
    await rm(temp, { force: true }).catch(() => undefined)
  }
}
