// Kieu du lieu dung chung giua main <-> preload <-> renderer

import type { CookieSite } from './sites'
import type { YtDlpErrorCode } from './ytdlpErrors'
export type { CookieSite, SiteId } from './sites'
export type { YtDlpErrorCode } from './ytdlpErrors'

export type LogLevel = 'info' | 'warn' | 'error'
export interface LogEntry {
  time: string // ISO
  level: LogLevel
  msg: string
}

export interface DepStatus {
  ytdlp: boolean
  ffmpeg: boolean
  platform: NodeJS.Platform
}

export interface YtDlpCapabilityStatus {
  installed: boolean
  source: 'managed' | 'path' | null
  version: string | null
  impersonationAvailable: boolean
  impersonateTargets: string[]
}

export type SetupPhase = 'checking' | 'downloading-ytdlp' | 'downloading-ffmpeg' | 'extracting' | 'done' | 'error'

export interface SetupProgress {
  phase: SetupPhase
  message: string
  percent: number // 0..100, -1 neu khong xac dinh
}

export interface VideoFormat {
  format_id: string
  ext: string
  resolution: string | null
  height: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  filesize: number | null
  filesizeApprox: number | null
  tbr: number | null // total bitrate
  note: string | null
}

export interface VideoInfo {
  id: string
  title: string
  uploader: string | null
  duration: number | null // giay
  durationString: string | null
  thumbnail: string | null
  webpageUrl: string
  isPlaylist: boolean
  playlistCount: number | null
  formats: VideoFormat[]
  heights: number[] // cac do phan giai san co (video), giam dan
}

export interface PlaylistEntry {
  id: string
  title: string
  url: string
  uploader: string | null
  duration: number | null
  durationString: string | null
  isPlaylist?: boolean // entry nay ban than la playlist con (vd tab kenh: Videos/Shorts)
  count?: number | null // so video trong playlist con (neu biet)
}

export interface PlaylistProbe {
  isPlaylist: boolean
  title: string | null
  count: number
  entries: PlaylistEntry[]
}

export type DownloadKind = 'video' | 'audio'

export interface DownloadRequest {
  url: string
  /** ID video do yt-dlp tra ve; chi dung de doi chieu fallback file dau ra. */
  mediaId: string | null
  kind: DownloadKind
  height: number | null // do phan giai mong muon cho video (null = tot nhat)
  audioFormat: string // vd 'mp3'
  outputDir: string
  embedThumbnail: boolean
  embedMetadata: boolean
  /** Main process tu chon dung file cookie theo ten mien cua URL. */
  useCookies: boolean
  /** Neu true, file video khong phai H.264 se duoc FFmpeg chuyen sang H.264/MP4. */
  ensureH264: boolean
  formatId: string | null // bo chon dinh dang tuy chon (vd '137+bestaudio'); null = dung kind/height
  // --- P1 nang cao ---
  container: string // dinh dang file video khi ghep: mp4/mkv/webm
  outputTemplate: string // mau ten file yt-dlp (vd '%(title)s [%(id)s].%(ext)s')
  writeSubs: boolean // tai phu de
  autoSubs: boolean // ke ca phu de tu dong (ASR)
  subLangs: string // ngon ngu phu de, vd 'vi,en'
  embedSubs: boolean // nhung phu de vao video
  useArchive: boolean // bo qua file da tai (download archive)
  forceOverwrite: boolean // ghi de file trung
  proxy: string | null // proxy vuot khoa vung, vd 'socks5://127.0.0.1:1080' (null = khong dung)
}

export interface ProxyTestResult {
  ok: boolean
  message: string
}

// Tu cap nhat app
export interface UpdateStatus {
  state: 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

// ---- Douyin ----
export type DyMode = 'all' | 'batch' | 'new' // kieu tai (chi cho link kenh)

export interface DouyinRequest {
  url: string
  outputDir: string
  isChannel: boolean // link kenh/user (co Kieu tai) hay video don
  mode: DyMode
  batchSize: number // so video moi dot cho mode 'batch'
  music: boolean
  cover: boolean
  avatar: boolean
  metaJson: boolean
  folderstyle: boolean // true = moi video 1 thu muc con; false = don het vao outputDir
  proxy: string | null
}

export interface DouyinResult {
  id: string
  ok: boolean
  total: number
  success: number
  failed: number
  skipped: number
  error: string | null
}

export interface DouyinProgress {
  id: string
  status: 'preparing' | 'downloading' | 'finished' | 'error'
  line: string | null
  lastFile: string | null // ten video vua tai xong
  success: number
}

export interface DyEngineStatus {
  has: boolean
  /** Co tren may nhung thap hon engines-manifest.json tren assets-v1. */
  needsUpdate?: boolean
}

export interface DyCookieStatus {
  has: boolean
  count: number
}

export interface DyChannel {
  url: string
  name: string
  lastRun: string // ISO
  count: number // tong so video da tai tu kenh
}

// ---- Audio -> Text (whisper) ----
export type WhisperTask = 'transcribe' | 'translate'

export type WhisperDevice = 'cpu' | 'cuda'

export interface WhisperRequest {
  input: string // duong dan file audio/video
  outputDir: string
  model: string // 'base' | 'small' | 'medium'
  language: string // 'auto' | 'vi' | 'en' ...
  task: WhisperTask
  formats: string[] // ['srt','txt','vtt']
  device: WhisperDevice // 'cuda' neu user bat GPU va da co goi tang toc
  diarize: boolean // nhan dien ai noi luc nao (gan nhan [SPEAKER_xx])
  speakers: number // so nguoi noi (0 = tu doan)
}

export interface WhisperCudaStatus {
  has: boolean // da tai + giai nen goi tang toc CUDA chua
  needsUpdate?: boolean
}

export interface WhisperProgress {
  id: string
  status: 'preparing' | 'transcribing' | 'finished' | 'error'
  percent: number // 0..100, -1 neu chua biet
  language: string | null
  line: string | null // doan text vua nhan / thong bao
}

export interface WhisperResult {
  id: string
  ok: boolean
  outputs: string[] // duong dan cac file .srt/.txt/.vtt
  segments: number
  speakers: number // so nguoi noi nhan dien duoc (0 neu khong bat diarize)
  error: string | null
}

export interface WhisperEngineStatus {
  has: boolean
  needsUpdate?: boolean
}

// ---- Tab Dich man hinh (doc chu chay tren video) ----
export interface OcrEngineStatus {
  has: boolean
  needsUpdate?: boolean
}
export interface OcrProgress {
  percent: number // -1 = chua tinh duoc (dang tach khung)
  text: string
}
export interface Region {
  y0: number // mep TREN, tinh theo PIXEL CUA VIDEO GOC
  y1: number // mep DUOI
  x0: number // mep TRAI
  x1: number // mep PHAI
}

export interface BlurRegion {
  id: string
  x0: number
  x1: number
  y0: number
  y1: number
  color: string
}

export interface OcrResult {
  ok: boolean
  output?: string
  outputs?: string[]
  count?: number
  error?: string
  // Dai chu goc (pixel video) — buoc ghep video dung de che phu de cung san co.
  bandTop?: number | null
  bandBot?: number | null
}

// ---- Ghep phu de vao video (buoc phu cua tab Dich man hinh) ----
/** Font dong goi de burn phu de (tu resources/fonts/catalog.json). */
export interface BurnFontEntry {
  id: string
  label: string
  file: string
  /** Ten noi bo dung trong ASS Style Fontname. */
  family: string
  group: string
  /** URL tblao:// de @font-face preview trong renderer (main gan khi list). */
  previewUrl?: string
}

export interface BurnReq {
  video: string
  srt?: string | null
  outputDir: string
  mode: 'burn' | 'soft' // dot chet (dang lai) | ghep mem (ranh sub, xem may)
  // VUNG DAT CHU (pixel video, chi khi dot chet): chu se can giua quanh tam
  // vung nay. null -> khong co vung, chu ve vi tri phu de tieu chuan (sat day).
  // LUU Y: gui vung NAY KE CA khi khong lam mo — keo khung = chon cho dat chu.
  bandTop?: number | null
  bandBot?: number | null
  bandLeft?: number | null
  bandRight?: number | null
  blurRegions?: BlurRegion[]
  // Co lam mo vung do khong (che phu de goc). Doc lap voi vi tri dat chu.
  lamMo?: boolean
  // Khung vi tri & co chu phu de (pixel video goc). User khoanh/keo gian khung phu de.
  subRegion?: { x0: number; y0: number; x1: number; y1: number }
  // Cat phu de cho vua thoi luong video (chi che do 'soft'). UI bat co nay khi
  // da canh bao .srt dai hon video ma user van bam ghep. Che do 'burn' khong
  // can: het khung hinh la chu tu dung, khong co gi de cat.
  catSrt?: boolean
  batAmThanh?: boolean
  amThanhFile?: string | null
  amLuongGoc?: number
  /** null / 'auto' / undefined = tu dong theo ngon ngu; else id trong catalog. */
  fontId?: string | null
  /** Mau chu #RRGGBB (mac dinh trang). */
  textColor?: string
  /** Mau vien chu #RRGGBB (mac dinh den). */
  outlineColor?: string
  /** Do day vien (px), 0–8, buoc 0.5. */
  outlinePx?: number
  /** Bat hop nen dung khung subRegion. */
  bgEnabled?: boolean
  /** Mau nen #RRGGBB. */
  bgColor?: string
  /** Do dam nen 0–100. */
  bgOpacity?: number
}
export interface BurnProgress {
  percent: number // -1 = chua tinh duoc
}
export interface BurnResult {
  ok: boolean
  output?: string
  error?: string
}

/** Nha cung cap dich phu de bang AI. */
export type DichProvider = 'gemini' | 'openai'

/** Ket qua kiem tra API key. `message` di THANG len UI — khong duoc mang chi
 *  tiet ky thuat nao. */
export interface GeminiStatus {
  ok: boolean
  message: string
}

/** Alias dung chung cho moi provider (cung hinh GeminiStatus). */
export type DichKeyStatus = GeminiStatus

/** 1 khoi phu de: moc thoi gian + chu. Moc thoi gian KHONG bao gio gui cho AI. */
export interface SrtBlock {
  time: string
  text: string
}

/** Dich phu de sang tieng nao. AI dich duoc moi thu — day chi la danh sach goi y. */
export const DICH_LANGS = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'Tiếng Anh' },
  { code: 'zh', label: 'Tiếng Trung' },
  { code: 'ja', label: 'Tiếng Nhật' },
  { code: 'ko', label: 'Tiếng Hàn' }
] as const

// Ket qua quet GPU (buoc an toan truoc khi cho tai goi tang toc CUDA)
export interface GpuInfo {
  hasNvidia: boolean // may co GPU NVIDIA + driver (nvidia-smi chay duoc) khong
  name: string | null // vd 'NVIDIA GeForce GTX 1050 Ti'
  driverVersion: string | null // vd '582.28'
  cudaVersion: string | null // CUDA toi da driver ganh duoc, vd '13.0'
  cudaMajor: number | null // phan nguyen, vd 13
  canAccelerate: boolean // du dieu kien tang toc (NVIDIA + CUDA >= 12)
  reason: string | null // ly do KHONG tang toc duoc (de bao user)
}

export type DownloadStatus =
  | 'preparing'
  | 'downloading'
  | 'postprocessing'
  | 'converting'
  | 'finished'
  | 'error'

export interface DownloadProgress {
  id: string
  status: DownloadStatus
  percent: number // 0..100
  downloadedBytes: number | null
  totalBytes: number | null
  speed: number | null // bytes/s
  eta: number | null // giay
  line: string | null // dong log tho (neu can)
}

export interface DownloadResult {
  id: string
  ok: boolean
  file: string | null
  error: string | null
  /** true = yt-dlp bo qua vi ID da co trong download-archive (khong ghi file moi). */
  skipped?: boolean
  errorCode?: YtDlpErrorCode | null
}

// ---- Cookie dang nhap (Playwright) ----

export interface CookieDepStatus {
  python: boolean
  playwright: boolean
  chromium: boolean
}

export interface CookieStatus {
  has: boolean
  count: number
  /** Ten mien chinh dung lam khoa kho cookie; null neu URL khong hop le. */
  domain: string | null
  /** Co cookie da het han trong file; khong chua ten/gia tri cookie. */
  expiredCount: number
}

export interface SiteCookieStatus extends CookieStatus {
  site: CookieSite
  loggedIn: boolean
  /** Chi la ten cookie con thieu; khong chua gia tri cookie. */
  missingLoginMarkers: string[]
}

export type CookieInstallPhase =
  | 'checking'
  | 'installing-playwright'
  | 'installing-chromium'
  | 'done'
  | 'error'

export interface CookieInstallProgress {
  phase: CookieInstallPhase
  message: string
}

export type CookieCapturePhase = 'launching' | 'ready' | 'saved' | 'error'

export interface CookieCaptureEvent {
  phase: CookieCapturePhase
  message: string
  count?: number
}

export interface SiteCookieCaptureEvent extends CookieCaptureEvent {
  site: CookieSite
}

export interface CookieCaptureResult {
  ok: boolean
  count: number
  domain?: string | null
  /** Chi cac engine cu co the tra ve; downloader chung khong dung duong dan nay. */
  path?: string | null
  error: string | null
}

// ---- Video2X (nang cap video) ----
export type Video2xProcessor = 'libplacebo' | 'realesrgan' | 'realcugan' | 'rife'
export type Video2xMode = 'filter' | 'interpolate'

export interface Video2xTaskConfig {
  deviceIndex: number
  mode: Video2xMode
  processor: Video2xProcessor
  /** Upscale bang he so (ESRGAN/CUGAN); null neu dung width/height. */
  scalingFactor: number | null
  width: number | null
  height: number | null
  noiseLevel: number
  libplaceboShader: string
  realesrganModel: string
  realcuganModel: string
  rifeModel: string
  frameRateMul: number
  sceneThresh: number
  codec: string
  copyAudio: boolean
  copySubtitle: boolean
  crf: number | null
  encoderPreset: string | null
}

export interface Video2xEngineStatus {
  has: boolean
  needsUpdate?: boolean
  /** false tren macOS — khong co binary native. */
  supported: boolean
}

export interface Video2xDevice {
  index: number
  name: string
}

export interface Video2xProgress {
  percent: number
  fps: number
  frame: number
  totalFrames: number
  elapsedSec: number
  remainingSec: number
  message?: string
}

export interface Video2xRunRequest {
  input: string
  output: string
  config: Video2xTaskConfig
}

export interface Video2xRunResult {
  ok: boolean
  output?: string
  error?: string
}

