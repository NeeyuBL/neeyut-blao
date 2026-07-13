import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
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

  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  out(`[tblao] ${msg}`)
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
