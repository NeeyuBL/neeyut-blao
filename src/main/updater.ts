import { app, BrowserWindow } from 'electron'
import updaterPkg from 'electron-updater'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import { UpdateStatus } from '../shared/types'

const { autoUpdater } = updaterPkg

let started = false

/** Khoi tao tu cap nhat app (chi chay tren ban da dong goi cai dat). */
export function initAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true

  if (!app.isPackaged) {
    // Che do dev: electron-updater khong chay -> bao trang thai "khong kha dung"
    logInfo('Tự cập nhật app: bỏ qua (đang chạy chế độ phát triển).')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (s: UpdateStatus): void => getWindow()?.webContents.send('update:status', s)

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    logInfo(`Có bản cập nhật app: ${info.version}`)
    send({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => send({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    logInfo(`Đã tải bản cập nhật ${info.version} — sẵn sàng cài khi khởi động lại.`)
    send({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    debugRaw('updater', err)
    const nhan = errLabel(err)
    logError(`Lỗi tự cập nhật app: ${nhan}`)
    send({ state: 'error', message: nhan })
  })

  void autoUpdater.checkForUpdates().catch(() => {})
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  await autoUpdater.checkForUpdates().catch((e) => logError(`Kiểm tra cập nhật lỗi: ${e}`))
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall()
}
