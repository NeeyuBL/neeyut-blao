import { contextBridge, ipcRenderer } from 'electron'
import {
  CookieCaptureEvent,
  CookieCaptureResult,
  CookieStatus,
  DepStatus,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  PlaylistProbe,
  SetupProgress,
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
    cookiesFile?: string | null
  ): Promise<{ ok: boolean; info?: VideoInfo; error?: string }> =>
    ipcRenderer.invoke('ytdlp:info', url, cookiesFile),

  getPlaylist: (
    url: string,
    cookiesFile?: string | null
  ): Promise<{ ok: boolean; playlist?: PlaylistProbe; error?: string }> =>
    ipcRenderer.invoke('ytdlp:playlist', url, cookiesFile),

  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseFolder'),
  downloadsDir: (): Promise<string> => ipcRenderer.invoke('app:downloadsDir'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

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
