import { spawn } from 'node:child_process'
import { resolveYtDlp } from './deps'
import { debugRaw, errLabel } from './logger'
import type { ProxyTestResult } from '../shared/types'

// Chap nhan: http(s)://  socks4://  socks5://  socks5h://  (co the kem user:pass@)
const PROXY_RE = /^(https?|socks(?:4|5h?)):\/\/(?:[^\s:@/]+(?::[^\s:@/]+)?@)?[^\s:/@]+:\d{2,5}$/i

export function isValidProxy(p: string): boolean {
  return PROXY_RE.test(p.trim())
}

function runYtdlp(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* bo qua */
      }
      resolve({ code: -1, stdout, stderr: stderr || 'timeout' })
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

// Dau hieu loi lien quan den proxy (khong ket noi duoc), phan biet voi "URL khong phai video"
const PROXY_FAIL_RE =
  /socks|proxy|timed?\s?out|timeout|refused|reset|unable to connect|cannot connect|getaddrinfo|econnrefused|failed to establish|connection (?:aborted|failed|error)|407|handshake|authentication/i

/**
 * Thu proxy bang chinh yt-dlp (ho tro day du SOCKS5 co mat khau) — goi api.ipify.org qua proxy.
 * Khong sua input nguoi dung, chi bao dung/sai.
 */
export async function testProxy(proxy: string): Promise<ProxyTestResult> {
  const p = proxy.trim()
  if (!p) return { ok: false, message: 'Chưa nhập proxy.' }
  if (!isValidProxy(p)) {
    return {
      ok: false,
      message: 'Sai định dạng. Ví dụ đúng: socks5://user:pass@1.2.3.4:1080 hoặc http://1.2.3.4:8080'
    }
  }

  const cmd = await resolveYtDlp()
  if (!cmd) return { ok: false, message: 'Chưa cài công cụ tải. Vui lòng chạy lại bước cài đặt.' }

  const args = ['--proxy', p, '--no-warnings', '--socket-timeout', '20', '-J', 'https://api.ipify.org']
  const { code, stderr } = await runYtdlp(cmd, args, 35000)

  // yt-dlp lay duoc trang qua proxy -> proxy chay tot
  if (code === 0) {
    return { ok: true, message: 'Proxy hoạt động ✓ (đã kết nối ra internet qua proxy)' }
  }

  // Loi khong lien quan proxy (vd generic extractor bao khong phai video) -> proxy van OK
  if (!PROXY_FAIL_RE.test(stderr)) {
    return { ok: true, message: 'Proxy hoạt động ✓ (đã kết nối ra internet qua proxy)' }
  }

  // stderr THO cua cong cu tai lo chinh TEN cong cu — thu tab Giay phep co tinh
  // giau. Message nay di thang len UI lan nhat ky, nen chi duoc mang NHAN.
  debugRaw('proxy test', stderr)
  return { ok: false, message: 'Không kết nối được proxy: ' + errLabel(stderr) }
}
