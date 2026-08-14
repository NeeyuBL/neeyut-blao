import { app, BrowserWindow, shell } from 'electron'
import updaterPkg from 'electron-updater'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import { UpdateStatus } from '../shared/types'
import { isNewerAppVersion } from '../shared/version'

const { autoUpdater } = updaterPkg

let started = false
let getWindowRef: (() => BrowserWindow | null) | null = null
let manualUpdateUrl = 'https://github.com/NeeyuBL/neeyut-blao/releases/latest'

const RELEASE_API = 'https://api.github.com/repos/NeeyuBL/neeyut-blao/releases/latest'

function sendStatus(status: UpdateStatus): void {
  getWindowRef?.()?.webContents.send('update:status', status)
}

async function checkManualMacUpdate(): Promise<void> {
  sendStatus({ state: 'checking' })
  try {
    const response = await fetch(RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `T-blao/${app.getVersion()}`
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`GitHub API ${response.status}`)
    const release = (await response.json()) as {
      tag_name?: unknown
      html_url?: unknown
      assets?: Array<{ name?: unknown; browser_download_url?: unknown }>
    }
    if (typeof release.tag_name !== 'string') throw new Error('Release không có phiên bản hợp lệ.')
    const version = release.tag_name.replace(/^v/, '')
    if (!isNewerAppVersion(version, app.getVersion())) {
      sendStatus({ state: 'none' })
      return
    }

    const expectedDmg = `T-blao-${version}-mac-arm64.dmg`
    const dmg = release.assets?.find(
      (asset) => asset.name === expectedDmg && typeof asset.browser_download_url === 'string'
    )
    const candidateUrl =
      typeof dmg?.browser_download_url === 'string'
        ? dmg.browser_download_url
        : typeof release.html_url === 'string'
          ? release.html_url
          : manualUpdateUrl
    const parsed = new URL(candidateUrl)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
      throw new Error('Liên kết cập nhật không hợp lệ.')
    }
    manualUpdateUrl = parsed.toString()
    logInfo(`Có bản cập nhật macOS cài thủ công: ${version}`)
    sendStatus({ state: 'available', version, manual: true })
  } catch (err) {
    debugRaw('updater:manual-macos', err)
    const nhan = errLabel(err)
    logError(`Kiểm tra cập nhật macOS lỗi: ${nhan}`)
    sendStatus({ state: 'error', message: nhan, manual: true })
  }
}

/** Khoi tao tu cap nhat app (chi chay tren ban da dong goi cai dat). */
export function initAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true
  getWindowRef = getWindow

  if (!app.isPackaged) {
    // Che do dev: electron-updater khong chay -> bao trang thai "khong kha dung"
    logInfo('Tự cập nhật app: bỏ qua (đang chạy chế độ phát triển).')
    return
  }

  if (process.platform === 'darwin') {
    const win = getWindow()
    if (win?.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => void checkManualMacUpdate())
    } else {
      void checkManualMacUpdate()
    }
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    logInfo(`Có bản cập nhật app: ${info.version}`)
    sendStatus({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => sendStatus({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    sendStatus({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    logInfo(`Đã tải bản cập nhật ${info.version} — sẵn sàng cài khi khởi động lại.`)
    sendStatus({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    debugRaw('updater', err)
    const nhan = errLabel(err)
    logError(`Lỗi tự cập nhật app: ${nhan}`)
    sendStatus({ state: 'error', message: nhan })
  })

  void autoUpdater.checkForUpdates().catch(() => {})
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  if (process.platform === 'darwin') {
    await checkManualMacUpdate()
    return
  }
  await autoUpdater.checkForUpdates().catch((e) => logError(`Kiểm tra cập nhật lỗi: ${e}`))
}

export async function quitAndInstall(): Promise<void> {
  if (!app.isPackaged) return
  if (process.platform === 'darwin') {
    await shell.openExternal(manualUpdateUrl)
    return
  }
  // Silent + force-run: tranh wizard NSIS (oneClick:false) gỡ app roi dung giua chung.
  autoUpdater.quitAndInstall(true, true)
}
