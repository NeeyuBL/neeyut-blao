import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import {
  checkDependencies,
  runSetup,
  ytDlpVersion,
  updateYtDlp,
  hasLocalYtDlp
} from './deps'
import { readFile, writeFile } from 'node:fs/promises'
import { fetchInfo, fetchPlaylist, download } from './ytdlp'
import { captureCookies, clearCookies, cookieStatus } from './cookies'
import { testProxy } from './proxy'
import { dyEngineStatus, installDyEngine, downloadDouyin, getChannels, removeChannel } from './douyin'
import {
  captureDyCookies,
  clearDyCookies,
  dyCookieStatus
} from './douyinCookies'
import { DouyinRequest } from '../shared/types'
import {
  clearLogs,
  getLogs,
  logEmitter,
  logError,
  logFilePath,
  logInfo,
  wipeLogFileSync
} from './logger'
import { DownloadRequest, LogEntry, SetupProgress } from '../shared/types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 740,
    minWidth: 860,
    minHeight: 580,
    show: false,
    autoHideMenuBar: true,
    title: 'T-blao',
    icon: join(__dirname, '../../build/icon.png'),
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Day nhat ky realtime len giao dien
  logEmitter.on('entry', (e: LogEntry) => mainWindow?.webContents.send('logs:entry', e))
  logEmitter.on('cleared', () => mainWindow?.webContents.send('logs:cleared'))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite: dev server URL hoac file build
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Tu kiem tra cap nhat cong cu tai (yt-dlp) trong nen, toi da 1 lan/ngay.
// Chi ap dung khi da co ban rieng trong userData/bin (tranh tai ngam ~30MB tren may dev dung PATH).
async function maybeAutoUpdateYtDlp(): Promise<void> {
  try {
    if (!(await hasLocalYtDlp())) return
    const stampFile = join(app.getPath('userData'), 'update-check.json')
    let last = 0
    try {
      last = (JSON.parse(await readFile(stampFile, 'utf-8')) as { ytdlp?: number }).ytdlp ?? 0
    } catch {
      /* chua co */
    }
    const now = Date.now()
    if (now - last < 24 * 60 * 60 * 1000) return // moi kiem tra trong 24h -> bo qua
    await writeFile(stampFile, JSON.stringify({ ytdlp: now }), 'utf-8')
    logInfo('Tự kiểm tra cập nhật công cụ tải…')
    const r = await updateYtDlp()
    logInfo(`Tự cập nhật công cụ tải: ${r.message}`)
  } catch {
    /* bo qua loi tu cap nhat */
  }
}

app.whenReady().then(() => {
  registerIpc()
  logInfo(`T-blao ${app.getVersion()} khởi động · ${process.platform}`)
  createWindow()
  void maybeAutoUpdateYtDlp()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Tu xoa nhat ky khi thoat app -> moi lan mo la nhat ky moi
app.on('before-quit', () => wipeLogFileSync())

function registerIpc(): void {
  // Kiem tra phu thuoc luc khoi dong
  ipcMain.handle('deps:check', async () => {
    const s = await checkDependencies()
    logInfo(`Kiểm tra môi trường: bộ tải xuống=${s.ytdlp ? 'có' : 'thiếu'}, ffmpeg=${s.ffmpeg ? 'có' : 'thiếu'}`)
    return s
  })

  // Chay setup (tai cai con thieu), day tien do ve renderer
  ipcMain.handle('deps:setup', async (event) => {
    const send = (p: SetupProgress): void => event.sender.send('deps:setup-progress', p)
    try {
      await runSetup(send)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Lay thong tin video
  ipcMain.handle(
    'ytdlp:info',
    async (_e, url: string, cookiesFile?: string | null, proxy?: string | null) => {
      try {
        const info = await fetchInfo(url, cookiesFile, proxy)
        return { ok: true, info }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ---- Cookie dang nhap (Electron native) ----
  ipcMain.handle('cookies:status', async () => cookieStatus())
  ipcMain.handle('cookies:clear', async () => {
    logInfo('Xóa cookie đăng nhập.')
    return clearCookies()
  })
  ipcMain.handle('cookies:capture', async (event, url: string) => {
    logInfo(`Mở cửa sổ đăng nhập lấy cookie: ${url || '(trống)'}`)
    const res = await captureCookies(url, (e) => event.sender.send('cookies:capture-event', e))
    if (res.ok) logInfo(`Đã lưu ${res.count} cookie.`)
    else logError(`Lấy cookie thất bại: ${res.error ?? ''}`)
    return res
  })

  // Kiem tra playlist
  ipcMain.handle(
    'ytdlp:playlist',
    async (_e, url: string, cookiesFile?: string | null, proxy?: string | null) => {
      try {
        const playlist = await fetchPlaylist(url, cookiesFile, proxy)
        return { ok: true, playlist }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Kiem tra proxy
  ipcMain.handle('proxy:test', async (_e, proxy: string) => {
    const r = await testProxy(proxy)
    logInfo(`Kiểm tra proxy: ${r.ok ? 'OK' : 'THẤT BẠI'} — ${r.message}`)
    return r
  })

  // Chon thu muc luu
  ipcMain.handle('dialog:chooseFolder', async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // Thu muc mac dinh (Downloads)
  ipcMain.handle('app:downloadsDir', async () => app.getPath('downloads'))

  // Phien ban ung dung
  ipcMain.handle('app:version', async () => app.getVersion())

  // Cong cu tai: phien ban + cap nhat thu cong
  ipcMain.handle('ytdlp:version', async () => ytDlpVersion())
  ipcMain.handle('ytdlp:update', async () => {
    logInfo('Đang cập nhật công cụ tải…')
    const r = await updateYtDlp()
    logInfo(`Cập nhật công cụ tải: ${r.ok ? 'OK' : 'LỖI'} — ${r.message}`)
    return r
  })

  // ---- Douyin ----
  ipcMain.handle('douyin:engineStatus', async () => dyEngineStatus())
  ipcMain.handle('douyin:installEngine', async (event) => {
    try {
      await installDyEngine((percent) => event.sender.send('douyin:install-progress', percent))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('douyin:download', async (event, id: string, req: DouyinRequest) =>
    downloadDouyin(id, req, (p) => event.sender.send('douyin:progress', p))
  )
  ipcMain.handle('douyin:cookieStatus', async () => dyCookieStatus())
  ipcMain.handle('douyin:cookieClear', async () => {
    logInfo('Douyin: xóa cookie đăng nhập.')
    return clearDyCookies()
  })
  ipcMain.handle('douyin:cookieCapture', async (event) => {
    logInfo('Douyin: mở cửa sổ đăng nhập lấy cookie.')
    const res = await captureDyCookies((e) => event.sender.send('douyin:cookie-event', e))
    if (res.ok) logInfo(`Douyin: đã lưu ${res.count} cookie.`)
    else logError(`Douyin: lấy cookie thất bại: ${res.error ?? ''}`)
    return res
  })
  ipcMain.handle('douyin:channels', async () => getChannels())
  ipcMain.handle('douyin:removeChannel', async (_e, url: string) => removeChannel(url))

  // Nhat ky hoat dong
  ipcMain.handle('logs:get', async () => getLogs())
  ipcMain.handle('logs:clear', async () => clearLogs())
  ipcMain.handle('logs:openFile', async () => {
    await shell.openPath(logFilePath())
  })

  // Tai xuong
  ipcMain.handle('ytdlp:download', async (event, id: string, req: DownloadRequest) => {
    const result = await download(id, req, (p) => event.sender.send('ytdlp:progress', p))
    return result
  })

  // Mo file/thu muc sau khi tai
  ipcMain.handle('shell:showItem', async (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('shell:openPath', async (_e, p: string) => {
    await shell.openPath(p)
  })
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url)
  })
}
