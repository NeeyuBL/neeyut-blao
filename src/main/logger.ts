import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { LogEntry, LogLevel } from '../shared/types'

const MAX = 1000 // giu toi da 1000 dong gan nhat trong bo nho
const buffer: LogEntry[] = []
export const logEmitter = new EventEmitter()

function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}
export function logFilePath(): string {
  return join(logDir(), 'tblao.log')
}

let dirReady = false
async function ensureDir(): Promise<void> {
  if (dirReady) return
  try {
    await mkdir(logDir(), { recursive: true })
  } catch {
    /* bo qua */
  }
  dirReady = true
}

// ---------------------------------------------------------------------------
// LOC LOI TRUOC KHI GHI NHAT KY
//
// Tab Nhat ky la thu USER MO RA DOC. Do stderr THO vao day thi:
//  - Traceback Python lo nguyen ngan xep cong nghe (ten module, duong dan file).
//  - stderr cua cong cu tai lo luon TEN CONG CU — dung cai ma tab Giay phep
//    co tinh giau di.
// Ma user thuong doc traceback cung khong hieu gi. Nen: chi tra TEN LOI.
//
// Loi cua Google/HTTP thi tra MA CONG KHAI (api_429...) — tra Google la ra,
// khong lo gi cua minh, ma user con biet duong xu ly.
// ---------------------------------------------------------------------------
// !! THU TU QUAN TRONG: luat tren khop truoc thi lay luon. Xep tu HEP den RONG.
//    (Da tung sai: luat 503 bat ca chu "unavailable" nen nuot mat loi chan khu
//     vuc — "Video unavailable ... not available in your country" -> bao nham
//     la "dich vu qua tai", user di sua nham cho.)
const NHAN_LOI: [RegExp, string][] = [
  [/\b429\b|rate.?limit|quota|resource.?exhausted/i, 'api_429 — vượt hạn mức, thử lại sau'],
  [/\b503\b|overloaded|service unavailable/i, 'api_503 — dịch vụ đang quá tải'],
  [/\b40[13]\b|api.?key|permission|unauthorized/i, 'api_403 — khoá không hợp lệ'],
  [/geo|region|\bcountry\b|blocked/i, 'nội dung bị chặn theo khu vực'],
  [/sign in|log in|cookie|private video|members.?only/i, 'cần đăng nhập mới tải được'],
  [/unavailable|removed|deleted|not exist|404/i, 'nội dung không còn khả dụng'],
  [/ENOENT|not found|no such file/i, 'thiếu tệp hoặc công cụ'],
  [/ENOSPC|disk.?full|no space/i, 'ổ đĩa đã đầy'],
  [/EACCES|EPERM|denied/i, 'không đủ quyền ghi'],
  // `fetch failed` la thu Node nem ra khi MAT MANG — khong chua chu "network"
  // nao ca, nen phai bat rieng, khong thi user chi thay "lỗi không xác định"
  // trong khi ho chi can cam lai wifi.
  [/abort|timed? ?out|ETIMEDOUT/i, 'quá thời gian chờ — máy chủ không phản hồi'],
  [/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network/i, 'lỗi kết nối mạng'],
  [/proxy/i, 'lỗi proxy'],
  [/out of memory|ENOMEM/i, 'máy không đủ bộ nhớ']
]

/**
 * Rut loi tho thanh MOT NHAN ngan, an toan de hien cho user.
 * KHONG BAO GIO tra ve nguyen van stderr.
 */
export function errLabel(raw: unknown): string {
  const s = raw instanceof Error ? raw.message : String(raw ?? '')
  for (const [re, nhan] of NHAN_LOI) if (re.test(s)) return nhan
  return 'lỗi không xác định'
}

/**
 * Chi tiet tho CHI cho console luc phat trien — KHONG vao nhat ky, khong vao
 * file (file cung mo duoc bang nut "Mở file nhật ký").
 * Danh doi da biet: user bao loi thi minh it manh moi hon. Chap nhan.
 */
export function debugRaw(ctx: string, raw: unknown): void {
  if (!process.env['ELECTRON_RENDERER_URL']) return // chi che do phat trien
  try {
    console.error(`[tblao:debug] ${ctx}:`, raw)
  } catch {
    /* ong dut — ke */
  }
}

/** Ghi 1 dong nhat ky: vao bo nho, phat len UI, va ghi file. */
export function log(level: LogLevel, msg: string): void {
  const entry: LogEntry = { time: new Date().toISOString(), level, msg }
  buffer.push(entry)
  if (buffer.length > MAX) buffer.shift()
  logEmitter.emit('entry', entry)

  // Ghi file (fire-and-forget, khong chan luong)
  void ensureDir().then(() =>
    appendFile(logFilePath(), `[${entry.time}] ${level.toUpperCase()} ${msg}\n`).catch(() => {})
  )

  // In ra console CHI de tien theo doi luc phat trien. Neu dau kia dong ong
  // (dong cua so console, chay qua `| head`...) thi console.log NEM EPIPE ->
  // khong ai bat -> SAP CA APP. Ghi nhat ky khong bao gio duoc lam sap app.
  try {
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    out(`[tblao] ${msg}`)
  } catch {
    /* mat dong log tren console — app van chay, van co file + UI Nhat ky */
  }
}

export const logInfo = (m: string): void => log('info', m)
export const logWarn = (m: string): void => log('warn', m)
export const logError = (m: string): void => log('error', m)

export function getLogs(): LogEntry[] {
  return [...buffer]
}
export function clearLogs(): void {
  buffer.length = 0
  logEmitter.emit('cleared')
  logInfo('Đã xóa nhật ký.')
}

/** Xoa sach file log (dong bo) — goi luc app thoat de moi lan mo la nhat ky moi. */
export function wipeLogFileSync(): void {
  buffer.length = 0
  try {
    rmSync(logFilePath(), { force: true })
  } catch {
    /* bo qua */
  }
}
