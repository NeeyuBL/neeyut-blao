import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, access, rm, readdir, copyFile, chmod, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { DepStatus, SetupProgress } from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const YTDLP_RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const YTDLP_RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
const FFMPEG_WIN_SHA256 = '6b8116749910312a7ce794bffcbe25fca693dfce86c840bce7fb679f938587ce'
const FFMPEG_MAC_ARM64_RELEASE = 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1785863997_9.0'
const FFMPEG_MAC_ARM64_TARGETS = [
  {
    name: 'ffmpeg',
    url: `${FFMPEG_MAC_ARM64_RELEASE}/ffmpeg.zip`,
    sha256: '5267ef149ee0d208057a1b316aac079b661b0476574dee5da7d225769773c603'
  },
  {
    name: 'ffprobe',
    url: `${FFMPEG_MAC_ARM64_RELEASE}/ffprobe.zip`,
    sha256: '7778fbb533fb60d3336cbd9a9e51eced71658f020b570c7203590c1c41d42f50'
  }
] as const
let ytDlpInstallInFlight: Promise<void> | null = null

export type YtDlpSource = 'managed' | 'path'

export interface YtDlpInstallation {
  command: string
  source: YtDlpSource
}

export interface YtDlpCapabilities {
  installation: YtDlpInstallation | null
  version: string | null
  probeSucceeded: boolean
  impersonationAvailable: boolean
  impersonateTargets: string[]
  probeError: string | null
}

interface YtDlpReleaseAsset {
  name: string
  url: string
  checksumUrl: string | null
  version: string | null
}

/**
 * NGUON TAI CAC GOI LON (engine OCR / Audio-Text / ffmpeg / GPU / dy-engine).
 *
 * !! TRO VE MOT TAG CO DINH, TUYET DOI KHONG dung `releases/latest/download`.
 * Da dinh that: voi `latest`, MOI ban app moi (ke ca sua 1 dong chu) deu bat
 * buoc up lai DU ~1.3GB asset len release do, khong thi link thanh 404 va cac
 * tab Douyin / Phu de / Dich man hinh chet ngay.
 * Voi tag co dinh: ban va app chi can setup.exe + blockmap + latest.yml.
 *
 * Khi nao doi engine -> tao release moi `assets-v2` roi sua DUY NHAT dong duoi.
 * Release asset nen de dang PRERELEASE cho khoi tranh "latest" cua auto-update.
 */
export const ASSET_TAG = 'assets-v1'
export const ASSET_BASE = `https://github.com/NeeyuBL/neeyut-blao/releases/download/${ASSET_TAG}`

/** Thu muc luu binaries tai ve, nam trong userData (khong can quyen admin). */
export function binDir(): string {
  return join(app.getPath('userData'), 'bin')
}

function exe(name: string): string {
  return isWin ? `${name}.exe` : name
}

/** Duong dan co dinh cua yt-dlp do app quan ly. */
export function managedYtDlpPath(): string {
  return join(binDir(), exe('yt-dlp'))
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Chay 1 lenh, gom stdout+stderr va khong de probe treo app vo han. */
function runCapture(
  cmd: string,
  args: string[],
  timeoutMs = 30_000
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      const finish = (code: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, out })
      }
      const timer = setTimeout(() => {
        out += '\nQua thoi gian cho yt-dlp.'
        child.kill()
        finish(-1)
      }, timeoutMs)
      child.stdout.on('data', (d) => (out += d.toString()))
      child.stderr.on('data', (d) => (out += d.toString()))
      child.on('error', () => finish(-1))
      child.on('close', (code) => finish(code ?? -1))
    } catch {
      resolve({ code: -1, out })
    }
  })
}

/** Kiem tra mot lenh co chay duoc khong (tren PATH hoac duong dan tuyet doi). */
async function canRun(cmd: string, args: string[] = ['--version']): Promise<boolean> {
  return (await runCapture(cmd, args)).code === 0
}

/**
 * Tim yt-dlp va cho biet no den tu app hay PATH.
 * Ban do app quan ly luon duoc uu tien de tranh vo tinh dung ban pip thieu
 * dependency (dac biet la curl_cffi/impersonation).
 */
export async function resolveYtDlpInstallation(): Promise<YtDlpInstallation | null> {
  // Khong spawn dung luc Windows dang doi ten binary cu/moi. Neu cap nhat loi,
  // van tiep tuc resolve ban cu da rollback hoac PATH fallback.
  if (ytDlpInstallInFlight) await ytDlpInstallInFlight.catch(() => {})
  const local = managedYtDlpPath()
  if ((await fileExists(local)) && (await canRun(local))) {
    return { command: local, source: 'managed' }
  }
  if (await canRun('yt-dlp')) return { command: 'yt-dlp', source: 'path' }
  return null
}

/** Tra ve lenh yt-dlp dung duoc. Giu API cu cho cac module hien tai. */
export async function resolveYtDlp(): Promise<string | null> {
  return (await resolveYtDlpInstallation())?.command ?? null
}

function parseImpersonateTargets(output: string): string[] {
  const targets = new Set<string>()
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (
      !line ||
      line.startsWith('[info]') ||
      /^Client\s+OS\s+Source$/i.test(line) ||
      /^-+$/.test(line) ||
      /\((?:unavailable|not available)\)\s*$/i.test(line)
    ) {
      continue
    }

    const columns = line.split(/\s{2,}/)
    if (columns.length < 3 || columns[0] === '-') continue
    const client = columns[0].toLowerCase()
    const os = columns[1] && columns[1] !== '-' ? `:${columns[1].toLowerCase()}` : ''
    targets.add(`${client}${os}`)
  }

  return [...targets]
}

/**
 * Kiem tra capability that cua binary dang duoc app chon. Khong suy doan theo
 * ten goi: mot ban tren PATH co the chay duoc nhung thieu curl_cffi.
 */
export async function probeYtDlpCapabilities(): Promise<YtDlpCapabilities> {
  const installation = await resolveYtDlpInstallation()
  if (!installation) {
    return {
      installation: null,
      version: null,
      probeSucceeded: false,
      impersonationAvailable: false,
      impersonateTargets: [],
      probeError: 'Khong tim thay yt-dlp.'
    }
  }

  const [versionResult, targetsResult] = await Promise.all([
    runCapture(installation.command, ['--version']),
    runCapture(installation.command, ['--list-impersonate-targets'])
  ])
  const targets = targetsResult.code === 0 ? parseImpersonateTargets(targetsResult.out) : []
  const version =
    versionResult.code === 0
      ? versionResult.out.trim().split(/\r?\n/).find(Boolean) ?? null
      : null

  return {
    installation,
    version,
    probeSucceeded: targetsResult.code === 0,
    impersonationAvailable: targets.length > 0,
    impersonateTargets: targets,
    probeError:
      targetsResult.code === 0
        ? null
        : targetsResult.out.trim() || 'Khong the kiem tra browser impersonation.'
  }
}

/** Tra ve duong dan ffmpeg dung duoc: bundled -> PATH. Null neu khong co. */
export async function resolveFfmpeg(): Promise<string | null> {
  const local = join(binDir(), exe('ffmpeg'))
  // FFmpeg chi nhan `-version`; `--version` thoat voi loi tren Windows va lam
  // app nham binary da cai la dang bi thieu o moi lan khoi dong.
  if (await canRun(local, ['-version'])) {
    if (isMac && process.arch === 'arm64') {
      const inspected = await runCapture('/usr/bin/file', ['-b', local])
      const description = inspected.out.toLowerCase()
      if (inspected.code === 0 && (description.includes('arm64') || description.includes('universal binary'))) {
        return local
      }
    } else {
      return local
    }
  }
  if (await canRun('ffmpeg', ['-version'])) {
    if (isMac && process.arch === 'arm64') {
      const which = await runCapture('/usr/bin/which', ['ffmpeg'])
      const resolved = which.out.trim().split(/\r?\n/)[0]
      if (!resolved) return null
      const inspected = await runCapture('/usr/bin/file', ['-b', resolved])
      const description = inspected.out.toLowerCase()
      if (!description.includes('arm64') && !description.includes('universal binary')) return null
    }
    return 'ffmpeg'
  }
  return null
}

export async function checkDependencies(): Promise<DepStatus> {
  // Trang setup can cai ban official do app quan ly ngay ca khi PATH co yt-dlp.
  // PATH van la fallback cua resolveYtDlp neu viec cai dat chua hoan tat.
  const [managedYtDlp, ff] = await Promise.all([
    canRun(managedYtDlpPath()),
    resolveFfmpeg()
  ])
  return { ytdlp: managedYtDlp, ffmpeg: ff !== null, platform: process.platform }
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
          { windowsHide: true, stdio: 'ignore' }
        )
      : spawn('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'ignore' })
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

function isMuslLinux(): boolean {
  if (process.platform !== 'linux') return false
  try {
    const report = process.report.getReport() as {
      header?: { glibcVersionRuntime?: string }
    }
    return !report.header?.glibcVersionRuntime
  } catch {
    // Electron desktop thuong chay tren glibc; neu khong doc duoc report thi
    // dung asset glibc pho bien thay vi tu dong chon musl sai.
    return false
  }
}

/** Ten asset official phu hop voi he dieu hanh/kien truc hien tai. */
export function ytDlpReleaseAssetName(): string {
  if (isWin) {
    if (process.arch === 'arm64') return 'yt-dlp_arm64.exe'
    if (process.arch === 'ia32') return 'yt-dlp_x86.exe'
    return 'yt-dlp.exe'
  }
  if (isMac) return 'yt-dlp_macos' // official universal binary: x64 + arm64
  if (process.platform === 'linux') {
    const musl = isMuslLinux()
    if (process.arch === 'arm64') {
      return musl ? 'yt-dlp_musllinux_aarch64' : 'yt-dlp_linux_aarch64'
    }
    if (process.arch === 'x64') return musl ? 'yt-dlp_musllinux' : 'yt-dlp_linux'
  }

  // Asset zipimport official, doc lap kien truc, nhung can Python va co the
  // khong co curl_cffi. Capability probe se bao dung tinh trang nay.
  return 'yt-dlp'
}

async function latestYtDlpAsset(name: string): Promise<YtDlpReleaseAsset> {
  try {
    const res = await fetch(YTDLP_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = (await res.json()) as {
      tag_name?: unknown
      assets?: Array<{ name?: unknown; browser_download_url?: unknown }>
    }
    const assets = Array.isArray(data.assets) ? data.assets : []
    const wanted = assets.find((asset) => asset.name === name)
    const sums = assets.find((asset) => asset.name === 'SHA2-256SUMS')
    if (typeof wanted?.browser_download_url !== 'string') {
      throw new Error(`Release khong co asset ${name}`)
    }
    return {
      name,
      url: wanted.browser_download_url,
      checksumUrl:
        typeof sums?.browser_download_url === 'string' ? sums.browser_download_url : null,
      version: typeof data.tag_name === 'string' ? data.tag_name : null
    }
  } catch {
    // API co rate-limit rieng. Link latest/download van la nguon official va
    // giu cho setup hoat dong khi API tam thoi khong truy cap duoc.
    return {
      name,
      url: `${YTDLP_RELEASE_BASE}/${name}`,
      checksumUrl: `${YTDLP_RELEASE_BASE}/SHA2-256SUMS`,
      version: null
    }
  }
}

async function expectedSha256(url: string, assetName: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Khong tai duoc checksum yt-dlp (${res.status}).`)
  const sums = await res.text()
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+?)\s*$/i.exec(line)
    if (match?.[2] === assetName) return match[1].toLowerCase()
  }
  throw new Error(`Khong tim thay checksum cho ${assetName}.`)
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function replaceManagedYtDlp(candidate: string, dest: string): Promise<void> {
  const previous = `${dest}.previous`

  // Phuc hoi neu app da bi tat dung luc Windows dang doi ten binary cu.
  if (!(await fileExists(dest)) && (await fileExists(previous))) {
    await rename(previous, dest)
  } else if ((await fileExists(dest)) && (await fileExists(previous))) {
    await rm(previous, { force: true })
  }

  if (!(await fileExists(dest))) {
    await rename(candidate, dest)
    return
  }

  if (!isWin) {
    // rename cung filesystem thay the atomically tren POSIX: loi thi binary cu
    // van con nguyen; thanh cong thi process dang chay van giu inode cu.
    await rename(candidate, dest)
    return
  }

  // Windows khong cho rename de len file ton tai. Giu ban cu cho den khi ban
  // moi da vao dung vi tri va chay duoc, roi moi xoa backup.
  await rename(dest, previous)
  try {
    await rename(candidate, dest)
    const verified = await runCapture(dest, ['--version'])
    if (verified.code !== 0) throw new Error('Binary yt-dlp moi khong khoi dong duoc.')
    // Binary cu co the van dang duoc mot process download giu handle. Ban moi
    // da xac minh thanh cong, nen cleanup backup that bai khong duoc rollback.
    await rm(previous, { force: true }).catch(() => {})
  } catch (err) {
    await rm(dest, { force: true })
    try {
      await rename(previous, dest)
    } catch {
      // Antivirus/process khac co the chan rename trong thoang choc; copy giu
      // cho duong dan managed van san sang, file .previous se duoc don lan sau.
      await copyFile(previous, dest).catch(() => {})
    }
    if (!(await fileExists(dest))) {
      throw new Error(
        `Không thể khôi phục công cụ tải; bản sao an toàn còn tại ${previous}.`,
        { cause: err }
      )
    }
    throw err
  }
}

async function doInstallYtDlp(onProgress: ProgressCb): Promise<void> {
  onProgress({ phase: 'downloading-ytdlp', message: 'Đang tải bộ tải xuống…', percent: 0 })
  const dest = managedYtDlpPath()
  const candidate = `${dest}.download`
  const release = await latestYtDlpAsset(ytDlpReleaseAssetName())

  await mkdir(binDir(), { recursive: true })
  await rm(candidate, { force: true })
  try {
    if (!release.checksumUrl) throw new Error('Release yt-dlp không có checksum SHA-256.')
    const checksum = await expectedSha256(release.checksumUrl, release.name)
    await downloadFile(release.url, candidate, (p) =>
      onProgress({ phase: 'downloading-ytdlp', message: `Đang tải bộ tải xuống… ${p}%`, percent: p })
    )
    if (!isWin) await chmod(candidate, 0o755)

    if ((await sha256File(candidate)) !== checksum) {
      throw new Error('Checksum yt-dlp khong khop; da giu nguyen binary cu.')
    }
    const version = await runCapture(candidate, ['--version'])
    if (version.code !== 0 || !version.out.trim()) {
      throw new Error('Binary yt-dlp vua tai khong hop le; da giu nguyen binary cu.')
    }

    await replaceManagedYtDlp(candidate, dest)
  } finally {
    await rm(candidate, { force: true }).catch(() => {})
  }
}

async function installYtDlp(onProgress: ProgressCb): Promise<void> {
  if (ytDlpInstallInFlight) return ytDlpInstallInFlight
  ytDlpInstallInFlight = doInstallYtDlp(onProgress)
  try {
    await ytDlpInstallInFlight
  } finally {
    ytDlpInstallInFlight = null
  }
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
    const url = `${ASSET_BASE}/ffmpeg-win.zip`
    await downloadFile(url, tmpZip, (p) =>
      onProgress({ phase: 'downloading-ffmpeg', message: `Đang tải ffmpeg… ${p}%`, percent: p })
    )
    if ((await sha256File(tmpZip)) !== FFMPEG_WIN_SHA256) {
      await rm(tmpZip, { force: true })
      throw new Error('Checksum gói FFmpeg Windows không khớp.')
    }
    onProgress({ phase: 'extracting', message: 'Đang giải nén ffmpeg…', percent: -1 })
    const extractDir = join(binDir(), 'ffmpeg_tmp')
    await rm(extractDir, { recursive: true, force: true })
    try {
      await extractZip(tmpZip, extractDir)

      for (const bin of ['ffmpeg.exe', 'ffprobe.exe']) {
        const src = await findFile(extractDir, bin)
        if (!src) throw new Error(`Gói FFmpeg Windows thiếu ${bin}.`)
        const probe = await runCapture(src, ['-version'])
        if (probe.code !== 0) throw new Error(`${bin} trong gói tải về không chạy được.`)
        await copyFile(src, join(binDir(), bin))
      }
    } finally {
      await rm(extractDir, { recursive: true, force: true }).catch(() => {})
      await rm(tmpZip, { force: true }).catch(() => {})
    }
  } else if (isMac) {
    if (process.arch !== 'arm64') {
      throw new Error('T-blao cho macOS từ phiên bản 0.1.18 chỉ hỗ trợ Apple Silicon (M1 trở lên).')
    }

    // Bản 9.0 ARM64 cố định, có libass + dav1d + libx264. Không dùng URL "latest"
    // để tránh binary/checksum thay đổi ngoài một bản phát hành của T-blao.
    for (const { name, url, sha256 } of FFMPEG_MAC_ARM64_TARGETS) {
      const tmpZip = join(binDir(), `${name}.zip`)
      await downloadFile(url, tmpZip, (p) =>
        onProgress({ phase: 'downloading-ffmpeg', message: `Đang tải ${name}… ${p}%`, percent: p })
      )
      if ((await sha256File(tmpZip)) !== sha256) {
        await rm(tmpZip, { force: true })
        throw new Error(`Checksum ${name} ARM64 không khớp.`)
      }
      onProgress({ phase: 'extracting', message: `Đang giải nén ${name}…`, percent: -1 })
      const extractDir = join(binDir(), `${name}_tmp`)
      await rm(extractDir, { recursive: true, force: true })
      try {
        await extractZip(tmpZip, extractDir)
        const src = await findFile(extractDir, name)
        if (!src) throw new Error(`Gói FFmpeg ARM64 thiếu ${name}.`)
        await copyFile(src, join(binDir(), name))
        await chmod(join(binDir(), name), 0o755)
        const probe = await runCapture(join(binDir(), name), ['-version'])
        if (probe.code !== 0) throw new Error(`${name} ARM64 vừa cài không chạy được.`)
      } finally {
        await rm(extractDir, { recursive: true, force: true }).catch(() => {})
        await rm(tmpZip, { force: true }).catch(() => {})
      }
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
  return fileExists(managedYtDlpPath())
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
 * Khong dung `-U` tren file dang hoat dong. Ban moi duoc tai vao file tam,
 * kiem tra checksum/version, sau do moi thay the de khong lam hong ban cu.
 */
export async function updateYtDlp(): Promise<{ ok: boolean; message: string }> {
  try {
    const local = managedYtDlpPath()
    if (await fileExists(local)) {
      const [current, latest] = await Promise.all([
        runCapture(local, ['--version']),
        latestYtDlpAsset(ytDlpReleaseAssetName())
      ])
      const currentVersion = current.code === 0 ? current.out.trim().split(/\r?\n/)[0] : null
      if (currentVersion && latest.version && currentVersion === latest.version) {
        return { ok: true, message: `Đã là bản mới nhất (${currentVersion}).` }
      }
    }

    await installYtDlp(() => {})
    const v = await ytDlpVersion()
    return { ok: true, message: `Đã cập nhật bản mới nhất${v ? ` (${v})` : ''}.` }
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
