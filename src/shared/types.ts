// Kieu du lieu dung chung giua main <-> preload <-> renderer

export interface DepStatus {
  ytdlp: boolean
  ffmpeg: boolean
  platform: NodeJS.Platform
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
  kind: DownloadKind
  height: number | null // do phan giai mong muon cho video (null = tot nhat)
  audioFormat: string // vd 'mp3'
  outputDir: string
  embedThumbnail: boolean
  embedMetadata: boolean
  cookiesFile: string | null // duong dan cookies.txt neu dung cookie dang nhap
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
}

export type DownloadStatus = 'preparing' | 'downloading' | 'postprocessing' | 'finished' | 'error'

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
}

// ---- Cookie dang nhap (Playwright) ----

export interface CookieDepStatus {
  python: boolean
  playwright: boolean
  chromium: boolean
}

export interface CookieStatus {
  has: boolean
  path: string
  count: number
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

export interface CookieCaptureResult {
  ok: boolean
  count: number
  path: string | null
  error: string | null
}
