import { net, session } from 'electron'
import type { ProxyTestResult } from '../shared/types'

// Chap nhan: http(s)://  socks4://  socks5://  socks5h://  (co the kem user:pass@)
const PROXY_RE = /^(https?|socks(?:4|5h?)):\/\/(?:[^\s:@/]+(?::[^\s:@/]+)?@)?[^\s:/@]+:\d{2,5}$/i

export function isValidProxy(p: string): boolean {
  return PROXY_RE.test(p.trim())
}

/** Chuyen chuoi proxy nguoi dung -> dinh dang proxyRules cua Chromium (chi dung noi bo cho phep thu). */
function toProxyRules(p: string): string {
  const m = p.match(/^(\w+):\/\/(.+)$/)
  if (!m) return p
  const scheme = m[1].toLowerCase()
  let hostpart = m[2]
  const at = hostpart.lastIndexOf('@') // bo user:pass cho buoc thu ket noi
  if (at >= 0) hostpart = hostpart.slice(at + 1)
  if (scheme.startsWith('socks')) return `socks5://${hostpart}`
  return hostpart // http/https proxy: 'host:port' ap dung cho moi giao thuc
}

/**
 * Thu proxy: goi ra api.ipify.org qua proxy, tra ve IP thoat.
 * Khong sua input nguoi dung — chi bao dung/sai.
 */
export async function testProxy(proxy: string): Promise<ProxyTestResult> {
  const p = proxy.trim()
  if (!p) return { ok: false, message: 'Chưa nhập proxy.' }
  if (!isValidProxy(p)) {
    return {
      ok: false,
      message: 'Sai định dạng. Ví dụ đúng: socks5://127.0.0.1:1080 hoặc http://1.2.3.4:8080'
    }
  }

  const ses = session.fromPartition('tblao-proxytest')
  try {
    await ses.setProxy({ proxyRules: toProxyRules(p), proxyBypassRules: '' })
  } catch (e) {
    return { ok: false, message: 'Không đặt được proxy: ' + (e instanceof Error ? e.message : '') }
  }

  return new Promise<ProxyTestResult>((resolve) => {
    let done = false
    const finish = (r: ProxyTestResult): void => {
      if (!done) {
        done = true
        resolve(r)
      }
    }
    const req = net.request({
      url: 'https://api.ipify.org?format=text',
      session: ses,
      useSessionCookies: false
    })
    const timer = setTimeout(() => {
      try {
        req.abort()
      } catch {
        /* bo qua */
      }
      finish({
        ok: false,
        message: 'Hết thời gian chờ — proxy không phản hồi (kiểm tra host/cổng, đã bật VPN/proxy chưa).'
      })
    }, 12000)

    req.on('response', (res) => {
      let body = ''
      res.on('data', (d) => (body += d.toString()))
      res.on('end', () => {
        clearTimeout(timer)
        const code = res.statusCode ?? 0
        if (code >= 200 && code < 400) {
          finish({ ok: true, message: `Proxy hoạt động ✓  (IP thoát: ${body.trim() || 'không rõ'})` })
        } else {
          finish({ ok: false, message: `Proxy phản hồi lỗi HTTP ${code}` })
        }
      })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      finish({ ok: false, message: 'Không kết nối được proxy: ' + err.message })
    })
    req.end()
  })
}
