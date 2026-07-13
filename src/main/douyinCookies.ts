import { app, BrowserWindow, session as electronSession } from 'electron'
import { writeFile, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CookieCaptureEvent, CookieCaptureResult, DyCookieStatus } from '../shared/types'

// Cookie Douyin rieng (khac cookie YouTube). Dung partition rieng de khong lan lon.
const DY_PARTITION = 'persist:tblao-douyin'

export function dyCookiesPath(): string {
  return join(app.getPath('userData'), 'douyin-cookies.json')
}

/** Trich cookie douyin.com thanh dict {ten: gia_tri} — dinh dang engine can. */
function toDict(cookies: Electron.Cookie[]): Record<string, string> {
  const dict: Record<string, string> = {}
  for (const c of cookies) {
    const domain = (c.domain ?? '').toLowerCase()
    if (!domain.includes('douyin.com')) continue
    if (c.name) dict[c.name] = c.value
  }
  return dict
}

/** Mo cua so dang nhap Douyin -> nguoi dung dang nhap roi DONG -> luu cookie dict. */
export function captureDyCookies(
  onEvent: (e: CookieCaptureEvent) => void
): Promise<CookieCaptureResult> {
  return new Promise<CookieCaptureResult>((resolve) => {
    const ses = electronSession.fromPartition(DY_PARTITION)

    const win = new BrowserWindow({
      width: 1000,
      height: 720,
      title: 'Đăng nhập Douyin — T-blao',
      autoHideMenuBar: true,
      webPreferences: {
        partition: DY_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }))
    onEvent({ phase: 'launching', message: 'Đang mở cửa sổ đăng nhập Douyin…' })

    let announced = false
    win.webContents.on('did-finish-load', () => {
      if (!announced) {
        announced = true
        onEvent({
          phase: 'ready',
          message: 'Hãy đăng nhập Douyin, rồi ĐÓNG cửa sổ này để lưu cookie.'
        })
      }
    })

    win.loadURL('https://www.douyin.com/').catch(() => {
      /* trang co the chan navigation truc tiep; van cho nguoi dung thao tac */
    })

    let settled = false
    win.on('closed', () => {
      if (settled) return
      settled = true
      void (async () => {
        try {
          const cookies = await ses.cookies.get({})
          const dict = toDict(cookies)
          const count = Object.keys(dict).length
          await writeFile(dyCookiesPath(), JSON.stringify(dict, null, 2), 'utf-8')
          onEvent({ phase: 'saved', message: `Đã lưu ${count} cookie Douyin.`, count })
          resolve({ ok: count > 0, count, path: dyCookiesPath(), error: count > 0 ? null : 'Chưa lấy được cookie Douyin (bạn đã đăng nhập chưa?).' })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          onEvent({ phase: 'error', message: msg })
          resolve({ ok: false, count: 0, path: null, error: msg })
        }
      })()
    })
  })
}

export async function dyCookieStatus(): Promise<DyCookieStatus> {
  const path = dyCookiesPath()
  if (!existsSync(path)) return { has: false, count: 0 }
  try {
    const s = await stat(path)
    if (s.size === 0) return { has: false, count: 0 }
    const dict = JSON.parse(await readFile(path, 'utf-8')) as Record<string, string>
    const count = Object.keys(dict || {}).length
    return { has: count > 0, count }
  } catch {
    return { has: false, count: 0 }
  }
}

export async function readDyCookies(): Promise<Record<string, string>> {
  try {
    const dict = JSON.parse(await readFile(dyCookiesPath(), 'utf-8')) as Record<string, string>
    return dict || {}
  } catch {
    return {}
  }
}

export async function clearDyCookies(): Promise<void> {
  await rm(dyCookiesPath(), { force: true })
  try {
    await electronSession.fromPartition(DY_PARTITION).clearStorageData({ storages: ['cookies'] })
  } catch {
    /* bo qua */
  }
}
