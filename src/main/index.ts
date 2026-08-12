import { app, shell, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { basename, extname, join } from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

// Kieu tep cho giao thuc tblao: — thieu Content-Type thi trinh phat doan mo, de sai.
const KIEU_MEDIA: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/mp4',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

// Giao thuc rieng de trinh phat doc duoc video TREN DIA CUA USER.
// Vi sao khong dung thang file:// — trang chay o http://localhost:5173 (dev)
// nen file:// la KHAC NGUON: vua bi CSP chan, vua bi webSecurity chan. Tat
// webSecurity thi chua duoc nhung mo toang ca app -> KHONG.
// stream:true la BAT BUOC — thieu no thi video khong tua duoc (khong ho tro
// range request), user keo thanh thoi gian se dung hinh.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tblao',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])
import {
  checkDependencies,
  runSetup,
  ytDlpVersion,
  updateYtDlp,
  hasLocalYtDlp
} from './deps'
import { readFile, writeFile } from 'node:fs/promises'
import { fetchInfo, fetchPlaylist, download, ytdlpErrorPayload } from './ytdlp'
import {
  captureDomainCookies,
  clearDomainCookies,
  domainCookieStatus,
  listDomainCookieStatuses,
  captureSiteCookies,
  clearSiteCookies,
  isCookieSite,
  siteCookieStatus
} from './cookies'
import { invalidateYtDlpCapabilities, ytdlpCapabilityStatus } from './sitePolicy'
import { testProxy } from './proxy'
import { initAutoUpdate, checkForUpdates, quitAndInstall } from './updater'
import { dyEngineStatus, installDyEngine, downloadDouyin, getChannels, removeChannel } from './douyin'
import {
  whisperEngineStatus,
  installWhisperEngine,
  transcribeAudio,
  whisperCudaStatus,
  installCudaPack
} from './whisper'
import { detectGpu } from './gpu'
import {
  checkKey as geminiCheckKey,
  hasKey as geminiHasKey,
  saveKey as geminiSaveKey,
  translateSrt as geminiTranslateSrt
} from './gemini'
import {
  checkKey as openaiCheckKey,
  hasKey as openaiHasKey,
  saveKey as openaiSaveKey,
  translateSrt as openaiTranslateSrt
} from './openai'
import { cancelOcr, installOcrEngine, ocrEngineStatus, ocrVideo } from './ocr'
import { burnSubtitle, cancelBurn, srtGiay } from './burn'
import { listBurnFonts } from './fonts'
import {
  cancelVideo2x,
  installVideo2xEngine,
  listVideo2xDevices,
  runVideo2x,
  video2xEngineStatus
} from './video2x'
import {
  captureDyCookies,
  clearDyCookies,
  dyCookieStatus
} from './douyinCookies'
import type { DichProvider, DouyinRequest, Video2xRunRequest, WhisperRequest } from '../shared/types'
import {
  clearLogs,
  debugRaw,
  errLabel,
  getLogs,
  logEmitter,
  logError,
  logFilePath,
  logInfo,
  wipeLogFileSync
} from './logger'

/** Nhat ky khong can biet user vao trang NAO — chi can biet tu dau. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '(liên kết)'
  }
}
import { DownloadRequest, LogEntry, SetupProgress } from '../shared/types'
import type { BurnReq } from '../shared/types'

let mainWindow: BrowserWindow | null = null
const isPrimaryInstance = app.requestSingleInstanceLock()

if (!isPrimaryInstance) app.quit()

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1040,
    minHeight: 620,
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
  mainWindow.on('closed', () => {
    mainWindow = null
  })

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
    invalidateYtDlpCapabilities()
    logInfo(`Tự cập nhật công cụ tải: ${r.message}`)
  } catch {
    /* bo qua loi tu cap nhat */
  }
}

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  // tblao://b64/<duong-dan-ma-hoa-base64url>  ->  doc tep tren dia.
  // !! Duong dan PHAI di qua base64 va PHAI co host "b64". Da do thuc te:
  //    voi standard:true, Chromium coi khuc dau sau "///" la TEN MIEN, nen
  //    `tblao:///D:/phim/a.mp4` bi bien thanh `tblao://d/phim/a.mp4` — nuot mat
  //    o dia, handler nhan duong dan cut -> ERR_FILE_NOT_FOUND, ma trinh phat
  //    lai bao "Format error" nghe nhu video hong. Base64 con mien nhiem voi
  //    ten tep co dau cach, ngoac, dau tieng Viet, '#', '?'.
  //
  // !! PHAI tu tra lai 206 theo Range. Co `stream:true` chi la CHO PHEP doc theo
  //    doan, khong tu lam thay. Da do thuc te tren GENZ.mp4 (155MB): trinh phat
  //    doi `bytes=155353088-` (khuc cuoi tep — cho de bang muc luc cua MP4), neu
  //    cu tra 200 tu byte 0 thi no nhan nham du lieu dau tep -> hong giai ma ->
  //    "Khong mo duoc video nay". Video nho nap tron 1 phat nen KHONG dinh loi,
  //    chi tep lon moi lo. Khong co 206 thi cung KHONG TUA duoc (nhay ve 0).
  protocol.handle('tblao', async (req) => {
    const ma = decodeURIComponent(new URL(req.url).pathname).replace(/^\//, '')
    const p = Buffer.from(ma, 'base64url').toString('utf8')
    const co = (await stat(p)).size
    const kieu = KIEU_MEDIA[extname(p).toLowerCase()] ?? 'application/octet-stream'
    const dau = req.headers.get('Range')

    if (!dau) {
      return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': kieu,
          'Content-Length': String(co),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }
    const m = /bytes=(\d*)-(\d*)/.exec(dau)
    const b = m?.[1] ? Number(m[1]) : 0
    const k = m?.[2] ? Number(m[2]) : co - 1
    return new Response(Readable.toWeb(createReadStream(p, { start: b, end: k })) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': kieu,
        'Content-Length': String(k - b + 1),
        'Content-Range': `bytes ${b}-${k}/${co}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
  registerIpc()
  logInfo(`T-blao ${app.getVersion()} khởi động · ${process.platform}`)
  createWindow()
  void maybeAutoUpdateYtDlp()
  initAutoUpdate(() => mainWindow)

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
    async (
      _e,
      url: string,
      proxy?: string | null,
      useCookies = false
    ) => {
      try {
        const info = await fetchInfo(url, proxy, useCookies)
        return { ok: true, info }
      } catch (err) {
        return { ok: false, ...ytdlpErrorPayload(err) }
      }
    }
  )

  // ---- Cookie dang nhap (Electron native) ----
  ipcMain.handle('cookies:status', async (_event, url: string) => domainCookieStatus(url))
  ipcMain.handle('cookies:list', async () => listDomainCookieStatuses())
  ipcMain.handle('cookies:clear', async (_event, url: string) => {
    logInfo('Xóa cookie đăng nhập.')
    return clearDomainCookies(url)
  })
  ipcMain.handle('cookies:capture', async (event, url: string) => {
    // Chi ghi TEN MIEN — nhat ky khong can biet user dang nhap vao trang nao cu the
    logInfo(`Mở cửa sổ đăng nhập lấy cookie${url ? ` (${domainOf(url)})` : ''}…`)
    const res = await captureDomainCookies(url, (e) => event.sender.send('cookies:capture-event', e))
    if (res.ok) logInfo(`Đã lưu ${res.count} cookie.`)
    else logError(`Lấy cookie thất bại: ${res.error ?? ''}`)
    return res
  })

  // Cookie rieng Facebook/Bilibili: file, partition va marker dang nhap tach biet.
  ipcMain.handle('cookies:siteStatus', async (_event, site: unknown) => {
    if (!isCookieSite(site)) throw new Error('Website cookie không được hỗ trợ.')
    return siteCookieStatus(site)
  })
  ipcMain.handle('cookies:siteClear', async (_event, site: unknown) => {
    if (!isCookieSite(site)) throw new Error('Website cookie không được hỗ trợ.')
    logInfo(`Xóa cookie đăng nhập ${site}.`)
    return clearSiteCookies(site)
  })
  ipcMain.handle('cookies:siteCapture', async (event, site: unknown, url?: string | null) => {
    if (!isCookieSite(site)) throw new Error('Website cookie không được hỗ trợ.')
    logInfo(`Mở cửa sổ đăng nhập ${site}…`)
    const res = await captureSiteCookies(site, url, (captureEvent) =>
      event.sender.send('cookies:site-capture-event', { site, ...captureEvent })
    )
    if (res.ok) logInfo(`Đã lưu cookie đăng nhập ${site}.`)
    else logError(`Lấy cookie ${site} thất bại.`)
    return res
  })

  // Kiem tra playlist
  ipcMain.handle(
    'ytdlp:playlist',
    async (
      _e,
      url: string,
      proxy?: string | null,
      useCookies = false
    ) => {
      try {
        const playlist = await fetchPlaylist(url, proxy, useCookies)
        return { ok: true, playlist }
      } catch (err) {
        return { ok: false, ...ytdlpErrorPayload(err) }
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

  // Chon file audio/video (cho tab Audio->Text)
  ipcMain.handle('dialog:chooseFiles', async () => {
    if (!mainWindow) return []
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Âm thanh / Video',
          extensions: [
            'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma',
            'mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'ts', 'm4v'
          ]
        },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })

  // Chon 1 tep phu de .srt co san (de ghep vao video ma khong can OCR)
  ipcMain.handle('dialog:chooseSrt', async (_e, defaultDir?: string | null) => {
    if (!mainWindow) return null
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'Phụ đề', extensions: ['srt'] },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    }
    // Mo dung thu muc xuat OCR neu co
    if (defaultDir && defaultDir.trim()) opts.defaultPath = defaultDir.trim()
    const res = await dialog.showOpenDialog(mainWindow, opts)
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Chon 1 tep am thanh
  ipcMain.handle('dialog:chooseAudio', async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Âm thanh', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus'] },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Thu muc mac dinh (Downloads)
  ipcMain.handle('app:downloadsDir', async () => app.getPath('downloads'))

  // Phien ban ung dung
  ipcMain.handle('app:version', async () => app.getVersion())

  // Tu cap nhat app
  ipcMain.handle('update:check', async () => checkForUpdates())
  ipcMain.handle('update:install', async () => quitAndInstall())

  // Cong cu tai: phien ban + cap nhat thu cong
  ipcMain.handle('ytdlp:version', async () => ytDlpVersion())
  ipcMain.handle('ytdlp:capabilities', async () => ytdlpCapabilityStatus())
  ipcMain.handle('ytdlp:update', async () => {
    logInfo('Đang cập nhật công cụ tải…')
    const r = await updateYtDlp()
    invalidateYtDlpCapabilities()
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

  // ---- Audio -> Text (whisper) ----
  ipcMain.handle('whisper:engineStatus', async () => whisperEngineStatus())
  ipcMain.handle('whisper:installEngine', async (event) => {
    try {
      await installWhisperEngine((percent) => event.sender.send('whisper:install-progress', percent))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('whisper:transcribe', async (event, id: string, req: WhisperRequest) =>
    transcribeAudio(id, req, (p) => event.sender.send('whisper:progress', p))
  )
  ipcMain.handle('whisper:detectGpu', async () => {
    const g = await detectGpu()
    logInfo(
      `Quét GPU: ${g.hasNvidia ? `${g.name} · CUDA ${g.cudaVersion ?? '?'} · tăng tốc=${g.canAccelerate ? 'được' : 'không'}` : 'không có NVIDIA'}`
    )
    return g
  })
  // ---- Dich man hinh (doc chu chay tren video) ----
  ipcMain.handle('ocr:engineStatus', async () => ocrEngineStatus())
  ipcMain.handle('ocr:installEngine', async (event) => {
    try {
      await installOcrEngine((p) => event.sender.send('ocr:install-progress', p))
      return { ok: true }
    } catch (err) {
      debugRaw('ocr install', err)
      return { ok: false, error: errLabel(err) }
    }
  })
  ipcMain.handle(
    'ocr:video',
    async (event, input: string, outputDir: string, y0: number, y1: number, x0: number, x1: number, formats: string[]) =>
      ocrVideo(input, outputDir, y0, y1, x0, x1, formats, (p) => event.sender.send('ocr:progress', p))
  )
  ipcMain.handle('ocr:cancel', async () => cancelOcr())

  // ---- Ghep phu de vao video (buoc phu tab Dich man hinh) ----
  ipcMain.handle('burn:start', async (event, req: BurnReq) =>
    burnSubtitle(req, (p) => event.sender.send('burn:progress', p))
  )
  ipcMain.handle('burn:cancel', async () => cancelBurn())
  // Do do dai file .srt -> renderer canh bao khi lech han so voi video
  ipcMain.handle('burn:srtGiay', async (_e, duong: string) => srtGiay(duong))
  ipcMain.handle('fonts:list', async () => listBurnFonts())

  // ---- Video2X (nang cap video) ----
  ipcMain.handle('video2x:engineStatus', async () => video2xEngineStatus())
  ipcMain.handle('video2x:installEngine', async (event) => {
    try {
      await installVideo2xEngine((p) => event.sender.send('video2x:install-progress', p))
      return { ok: true }
    } catch (err) {
      debugRaw('video2x install', err)
      return { ok: false, error: errLabel(err) }
    }
  })
  ipcMain.handle('video2x:listDevices', async () => listVideo2xDevices())
  ipcMain.handle('video2x:start', async (event, req: Video2xRunRequest) =>
    runVideo2x(req, (p) => event.sender.send('video2x:progress', p))
  )
  ipcMain.handle('video2x:cancel', async () => cancelVideo2x())

  // ---- Dich phu de bang API key cua user (Gemini | ChatGPT) ----
  const isProvider = (p: unknown): p is DichProvider => p === 'gemini' || p === 'openai'

  ipcMain.handle('translate:hasKey', async (_e, provider: DichProvider) => {
    if (!isProvider(provider)) return false
    return provider === 'openai' ? openaiHasKey() : geminiHasKey()
  })
  ipcMain.handle('translate:saveKey', async (_e, provider: DichProvider, key: string) => {
    if (!isProvider(provider)) return
    return provider === 'openai' ? openaiSaveKey(key) : geminiSaveKey(key)
  })
  ipcMain.handle('translate:checkKey', async (_e, provider: DichProvider, key: string) => {
    if (!isProvider(provider)) return { ok: false, message: 'Nhà cung cấp không hợp lệ.' }
    return provider === 'openai' ? openaiCheckKey(key) : geminiCheckKey(key)
  })
  ipcMain.handle(
    'translate:translateSrt',
    async (
      event,
      srtPath: string,
      outPath: string,
      dich: string,
      provider: DichProvider = 'gemini'
    ) => {
      const p: DichProvider = isProvider(provider) ? provider : 'gemini'
      const run = p === 'openai' ? openaiTranslateSrt : geminiTranslateSrt
      return run(srtPath, outPath, dich, (d, t) =>
        event.sender.send('translate:progress', { done: d, total: t })
      )
    }
  )

  // Alias cu — giu cho goi gemini:* van chay
  ipcMain.handle('gemini:hasKey', async () => geminiHasKey())
  ipcMain.handle('gemini:saveKey', async (_e, key: string) => geminiSaveKey(key))
  ipcMain.handle('gemini:checkKey', async (_e, key: string) => geminiCheckKey(key))
  ipcMain.handle(
    'gemini:translateSrt',
    async (event, srtPath: string, outPath: string, dich: string) =>
      geminiTranslateSrt(srtPath, outPath, dich, (d, t) => {
        event.sender.send('translate:progress', { done: d, total: t })
        event.sender.send('gemini:progress', { done: d, total: t })
      })
  )


  ipcMain.handle('whisper:cudaStatus', async () => whisperCudaStatus())
  ipcMain.handle('whisper:installCuda', async (event) => {
    try {
      await installCudaPack((percent) => event.sender.send('whisper:cuda-progress', percent))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Nhat ky hoat dong
  ipcMain.handle('logs:get', async () => getLogs())
  ipcMain.handle('logs:clear', async () => clearLogs())
  ipcMain.handle('logs:openFile', async () => {
    await shell.openPath(logFilePath())
  })

  // Tai xuong
  ipcMain.handle('ytdlp:download', async (event, id: string, req: DownloadRequest) => {
    try {
      return await download(id, req, (p) => event.sender.send('ytdlp:progress', p))
    } catch (err) {
      const payload = ytdlpErrorPayload(err)
      logError(`Tải xuống thất bại: ${payload.error}`)
      return { id, ok: false, file: null, ...payload }
    }
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
