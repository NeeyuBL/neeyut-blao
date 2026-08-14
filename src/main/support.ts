import { app } from 'electron'
import { spawn } from 'node:child_process'
import { cpus, release, totalmem } from 'node:os'
import type { RendererIssueReport, SupportReport } from '../shared/types'
import { checkDependencies, probeYtDlpCapabilities, resolveFfmpeg } from './deps'
import { detectGpu } from './gpu'
import { dyEngineStatus } from './douyin'
import { ocrEngineStatus } from './ocr'
import { video2xEngineStatus } from './video2x'
import { whisperEngineStatus } from './whisper'
import { getLogs, getPreviousCrashLogLines, logError } from './logger'

declare const __TBLAO_BUILD_COMMIT__: string

const PRIVACY_NOTICE =
  'Báo cáo không gồm cookie, API key, mật khẩu proxy hoặc nội dung file của bạn. ' +
  'Tên file, URL đầy đủ và đường dẫn cá nhân được rút gọn trước khi sao chép.'

const rendererIssues: RendererIssueReport[] = []
const MAX_RENDERER_ISSUES = 30

function trimText(value: unknown, maximum: number): string {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return text.replace(/\0/g, '').trim().slice(0, maximum)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Loai bo thong tin co the nhan dien user nhung giu lai dau vet ky thuat. */
export function sanitizeSupportText(input: unknown): string {
  let text = trimText(input, 24_000)
  const home = app.getPath('home')
  const userData = app.getPath('userData')
  if (userData) text = text.replace(new RegExp(escapeRegExp(userData), 'gi'), '%APPDATA%/t-blao')
  if (home) text = text.replace(new RegExp(escapeRegExp(home), 'gi'), '%USERPROFILE%')

  text = text.replace(/https?:\/\/[^\s<>"')\]}]+/gi, (raw) => {
    try {
      const url = new URL(raw)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return `${url.origin}${url.pathname}`
      }
      return `[url:${url.hostname}]`
    } catch {
      return '[url]'
    }
  })
  text = text.replace(
    /\b(api[ _-]?key|access[ _-]?token|authorization|password|passwd|cookie)\s*[:=]\s*[^\s,;]+/gi,
    '$1=[redacted]'
  )
  text = text.replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[redacted]')
  text = text.replace(
    /(['"])(?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^'"]+\1/gi,
    '$1[local-path]$1'
  )
  text = text.replace(
    /\b[^\s\\/:"<>|]+\.(mp4|mkv|webm|mov|avi|m4v|ts|flv|mp3|m4a|wav|aac|ogg|opus|flac|srt|vtt|ass|ttf|otf)\b/gi,
    '[media:$1]'
  )
  return text
}

function captureVersion(command: string, args: string[], timeoutMs = 8_000): Promise<string | null> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const child = spawn(command, args, { windowsHide: true })
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < 4_000) output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (output.length < 4_000) output += chunk.toString()
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      const firstLine = output.trim().split(/\r?\n/).find(Boolean) ?? null
      finish(code === 0 ? firstLine : null)
    })
  })
}

async function safeValue<T>(task: Promise<T>, fallback: T): Promise<T> {
  try {
    return await task
  } catch {
    return fallback
  }
}

export function recordRendererIssue(input: RendererIssueReport): void {
  if (!input || !['error', 'unhandled-rejection', 'react'].includes(input.kind)) return
  const issue: RendererIssueReport = {
    kind: input.kind,
    time: Number.isFinite(Date.parse(input.time)) ? input.time : new Date().toISOString(),
    message: sanitizeSupportText(trimText(input.message, 1_000)) || 'Lỗi giao diện không có thông báo.',
    stack: input.stack ? sanitizeSupportText(trimText(input.stack, 8_000)) : null,
    componentStack: input.componentStack
      ? sanitizeSupportText(trimText(input.componentStack, 6_000))
      : null
  }
  const previous = rendererIssues.at(-1)
  if (
    previous &&
    previous.kind === issue.kind &&
    previous.message === issue.message &&
    Math.abs(Date.parse(issue.time) - Date.parse(previous.time)) < 2_000
  ) {
    return
  }
  rendererIssues.push(issue)
  if (rendererIssues.length > MAX_RENDERER_ISSUES) rendererIssues.shift()
  logError(`Giao diện (${issue.kind}): ${issue.message}`)
}

function yesNo(value: boolean | undefined): string {
  return value ? 'có' : 'không'
}

function selectedLogs(): ReturnType<typeof getLogs> {
  const entries = getLogs()
  const recent = new Set(entries.slice(-120))
  for (const entry of entries.filter((item) => item.level !== 'info').slice(-50)) recent.add(entry)
  return entries.filter((entry) => recent.has(entry)).slice(-160)
}

function reportLine(value: unknown, maximum = 900): string {
  return sanitizeSupportText(value).replace(/\s+/g, ' ').slice(0, maximum)
}

export async function createSupportReport(): Promise<SupportReport> {
  const ffmpegCommand = await safeValue(resolveFfmpeg(), null)
  const [deps, ytdlp, gpu, dy, whisper, ocr, video2x, ffmpegVersion] = await Promise.all([
    safeValue(checkDependencies(), { ytdlp: false, ffmpeg: false, platform: process.platform }),
    safeValue(probeYtDlpCapabilities(), null),
    safeValue(detectGpu(), null),
    safeValue(dyEngineStatus(), { has: false }),
    safeValue(whisperEngineStatus(), { has: false }),
    safeValue(ocrEngineStatus(), { has: false }),
    safeValue(video2xEngineStatus(), { has: false, supported: process.platform !== 'darwin' }),
    ffmpegCommand ? captureVersion(ffmpegCommand, ['-version']) : Promise.resolve(null)
  ])
  const logs = selectedLogs()
  const previousCrash = getPreviousCrashLogLines(60).filter(
    (line) => !line.includes('[ffmpeg] configuration:')
  )
  const generatedAt = new Date().toISOString()
  const buildCommit =
    typeof __TBLAO_BUILD_COMMIT__ === 'string' && __TBLAO_BUILD_COMMIT__.trim()
      ? __TBLAO_BUILD_COMMIT__.slice(0, 12)
      : 'không có'
  const memoryGiB = Math.round((totalmem() / 1024 ** 3) * 10) / 10
  const cpu = cpus()[0]?.model?.replace(/\s+/g, ' ').trim() || 'không xác định'
  const lines: string[] = [
    '=== BÁO CÁO CHẨN ĐOÁN T-BLAO ===',
    `Tạo lúc: ${generatedAt}`,
    `Quyền riêng tư: ${PRIVACY_NOTICE}`,
    '',
    '[Ứng dụng]',
    `Phiên bản: ${app.getVersion()}`,
    `Kênh chạy: ${app.isPackaged ? 'phát hành' : 'phát triển'}`,
    `Build commit: ${buildCommit}`,
    `Electron / Chromium: ${process.versions.electron} / ${process.versions.chrome}`,
    '',
    '[Hệ thống]',
    `Nền tảng: ${process.platform} ${release()} (${process.arch})`,
    `CPU: ${reportLine(cpu)}`,
    `Bộ nhớ: ${memoryGiB} GiB`,
    `GPU: ${gpu?.hasNvidia ? reportLine(gpu.name || 'NVIDIA') : 'không phát hiện NVIDIA'}`,
    `Driver / CUDA: ${gpu?.driverVersion ?? 'n/a'} / ${gpu?.cudaVersion ?? 'n/a'}`,
    '',
    '[Công cụ]',
    `yt-dlp: ${ytdlp?.version ?? (deps.ytdlp ? 'có, chưa đọc được phiên bản' : 'thiếu')}`,
    `Nguồn yt-dlp: ${ytdlp?.installation?.source ?? 'n/a'}`,
    `Giả lập trình duyệt: ${yesNo(ytdlp?.impersonationAvailable)} (${ytdlp?.impersonateTargets.length ?? 0} target)`,
    `FFmpeg: ${ffmpegVersion ? reportLine(ffmpegVersion) : deps.ffmpeg ? 'có, chưa đọc được phiên bản' : 'thiếu'}`,
    `Douyin engine: ${yesNo(dy.has)}${dy.needsUpdate ? ' · cần cập nhật' : ''}`,
    `Nhận diện giọng nói: ${yesNo(whisper.has)}${whisper.needsUpdate ? ' · cần cập nhật' : ''}`,
    `Đọc chữ video: ${yesNo(ocr.has)}${ocr.needsUpdate ? ' · cần cập nhật' : ''}`,
    `Nâng cấp video: ${video2x.supported ? yesNo(video2x.has) : 'không hỗ trợ trên nền tảng này'}${video2x.needsUpdate ? ' · cần cập nhật' : ''}`,
    '',
    `[Lỗi giao diện gần đây: ${rendererIssues.length}]`
  ]

  if (rendererIssues.length === 0) lines.push('(không ghi nhận)')
  for (const issue of rendererIssues) {
    lines.push(`- ${issue.time} · ${issue.kind} · ${reportLine(issue.message)}`)
    if (issue.stack) lines.push(`  stack: ${reportLine(issue.stack, 1_800)}`)
    if (issue.componentStack) lines.push(`  component: ${reportLine(issue.componentStack, 1_400)}`)
  }

  lines.push('', `[Nhật ký liên quan: ${logs.length}/${getLogs().length}]`)
  if (logs.length === 0) lines.push('(không có nhật ký trong phiên này)')
  for (const entry of logs) {
    lines.push(`[${entry.time}] ${entry.level.toUpperCase()} ${reportLine(entry.msg)}`)
  }

  if (previousCrash.length > 0) {
    lines.push('', `[Dấu vết phiên dừng bất thường trước: ${previousCrash.length} dòng]`)
    for (const line of previousCrash) lines.push(reportLine(line))
  }

  return {
    generatedAt,
    text: `${lines.join('\n')}\n`,
    logCount: getLogs().length,
    rendererIssueCount: rendererIssues.length,
    includesPreviousCrash: previousCrash.length > 0,
    privacyNotice: PRIVACY_NOTICE
  }
}
