import { contextBridge, ipcRenderer } from 'electron'
import {
  CookieCaptureEvent,
  CookieCaptureResult,
  CookieStatus,
  DepStatus,
  DouyinProgress,
  DouyinRequest,
  DouyinResult,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DyChannel,
  DyCookieStatus,
  DyEngineStatus,
  LogEntry,
  PlaylistProbe,
  ProxyTestResult,
  SetupProgress,
  UpdateStatus,
  VideoInfo
} from '../shared/types'

const api = {
  checkDeps: (): Promise<DepStatus> => ipcRenderer.invoke('deps:check'),

  runSetup: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('deps:setup'),
  onSetupProgress: (cb: (p: SetupProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: SetupProgress): void => cb(p)
    ipcRenderer.on('deps:setup-progress', listener)
    return () => ipcRenderer.removeListener('deps:setup-progress', listener)
  },

  getInfo: (
    url: string,
    cookiesFile?: string | null,
    proxy?: string | null
  ): Promise<{ ok: boolean; info?: VideoInfo; error?: string }> =>
    ipcRenderer.invoke('ytdlp:info', url, cookiesFile, proxy),

  getPlaylist: (
    url: string,
    cookiesFile?: string | null,
    proxy?: string | null
  ): Promise<{ ok: boolean; playlist?: PlaylistProbe; error?: string }> =>
    ipcRenderer.invoke('ytdlp:playlist', url, cookiesFile, proxy),

  testProxy: (proxy: string): Promise<ProxyTestResult> => ipcRenderer.invoke('proxy:test', proxy),

  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseFolder'),
  downloadsDir: (): Promise<string> => ipcRenderer.invoke('app:downloadsDir'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  // Tu cap nhat app
  checkAppUpdate: (): Promise<void> => ipcRenderer.invoke('update:check'),
  installAppUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, s: UpdateStatus): void => cb(s)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },

  ytdlpVersion: (): Promise<string | null> => ipcRenderer.invoke('ytdlp:version'),
  ytdlpUpdate: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('ytdlp:update'),

  download: (id: string, req: DownloadRequest): Promise<DownloadResult> =>
    ipcRenderer.invoke('ytdlp:download', id, req),
  onProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: DownloadProgress): void => cb(p)
    ipcRenderer.on('ytdlp:progress', listener)
    return () => ipcRenderer.removeListener('ytdlp:progress', listener)
  },

  showItem: (filePath: string): Promise<void> => ipcRenderer.invoke('shell:showItem', filePath),
  openPath: (p: string): Promise<void> => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

  // ---- Douyin ----
  dyEngineStatus: (): Promise<DyEngineStatus> => ipcRenderer.invoke('douyin:engineStatus'),
  dyInstallEngine: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('douyin:installEngine'),
  onDyInstallProgress: (cb: (percent: number) => void): (() => void) => {
    const listener = (_e: unknown, p: number): void => cb(p)
    ipcRenderer.on('douyin:install-progress', listener)
    return () => ipcRenderer.removeListener('douyin:install-progress', listener)
  },
  dyDownload: (id: string, req: DouyinRequest): Promise<DouyinResult> =>
    ipcRenderer.invoke('douyin:download', id, req),
  onDyProgress: (cb: (p: DouyinProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: DouyinProgress): void => cb(p)
    ipcRenderer.on('douyin:progress', listener)
    return () => ipcRenderer.removeListener('douyin:progress', listener)
  },
  dyCookieStatus: (): Promise<DyCookieStatus> => ipcRenderer.invoke('douyin:cookieStatus'),
  dyCookieClear: (): Promise<void> => ipcRenderer.invoke('douyin:cookieClear'),
  dyCookieCapture: (): Promise<CookieCaptureResult> => ipcRenderer.invoke('douyin:cookieCapture'),
  onDyCookieEvent: (cb: (e: CookieCaptureEvent) => void): (() => void) => {
    const listener = (_e: unknown, ev: CookieCaptureEvent): void => cb(ev)
    ipcRenderer.on('douyin:cookie-event', listener)
    return () => ipcRenderer.removeListener('douyin:cookie-event', listener)
  },
  dyChannels: (): Promise<DyChannel[]> => ipcRenderer.invoke('douyin:channels'),
  dyRemoveChannel: (url: string): Promise<DyChannel[]> =>
    ipcRenderer.invoke('douyin:removeChannel', url),

  // ---- Nhat ky hoat dong ----
  getLogs: (): Promise<LogEntry[]> => ipcRenderer.invoke('logs:get'),
  clearLogs: (): Promise<void> => ipcRenderer.invoke('logs:clear'),
  openLogFile: (): Promise<void> => ipcRenderer.invoke('logs:openFile'),
  onLog: (cb: (e: LogEntry) => void): (() => void) => {
    const listener = (_e: unknown, entry: LogEntry): void => cb(entry)
    ipcRenderer.on('logs:entry', listener)
    return () => ipcRenderer.removeListener('logs:entry', listener)
  },
  onLogsCleared: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('logs:cleared', listener)
    return () => ipcRenderer.removeListener('logs:cleared', listener)
  },

  // ---- Cookie dang nhap ----
  cookieStatus: (): Promise<CookieStatus> => ipcRenderer.invoke('cookies:status'),
  cookieClear: (): Promise<void> => ipcRenderer.invoke('cookies:clear'),
  cookieCapture: (url: string): Promise<CookieCaptureResult> =>
    ipcRenderer.invoke('cookies:capture', url),
  onCookieCaptureEvent: (cb: (e: CookieCaptureEvent) => void): (() => void) => {
    const listener = (_e: unknown, ev: CookieCaptureEvent): void => cb(ev)
    ipcRenderer.on('cookies:capture-event', listener)
    return () => ipcRenderer.removeListener('cookies:capture-event', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type TblaoApi = typeof api
