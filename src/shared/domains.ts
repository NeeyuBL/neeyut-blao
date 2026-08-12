import { getDomain } from 'tldts'

/**
 * Short/alternate hosts that belong to the same login session as their target
 * website. Cookie files must follow the target domain, not the redirect host.
 */
const COOKIE_DOMAIN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'fb.watch': 'facebook.com',
  'b23.tv': 'bilibili.com',
  'youtu.be': 'youtube.com',
  'youtube-nocookie.com': 'youtube.com'
})

const DOMAIN_OPTIONS = Object.freeze({
  allowPrivateDomains: true,
  validateHostname: true,
  extractHostname: false
})

/**
 * Normalize a hostname without ever treating paths, credentials or ports as
 * part of it. URL performs IDNA conversion, so Unicode domains become stable
 * ASCII/punycode names suitable for filenames and comparisons.
 */
function normalizeHostname(value: string): string | null {
  const candidate = value.trim().toLowerCase().replace(/^\./, '').replace(/\.+$/g, '')
  if (!candidate || /[\s/@\\?#:]/.test(candidate)) return null

  try {
    const hostname = new URL(`http://${candidate}/`).hostname
      .toLowerCase()
      .replace(/\.+$/g, '')
    return hostname || null
  } catch {
    return null
  }
}

/** Exact hostname-or-subdomain match; never matches `example.com.evil.test`. */
export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const host = normalizeHostname(hostname)
  const allowed = normalizeHostname(domain)
  if (!host || !allowed) return false
  return host === allowed || host.endsWith(`.${allowed}`)
}

/** Safe URL variant of hostnameMatchesDomain; only web URLs are accepted. */
export function urlMatchesDomain(url: string, domain: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return hostnameMatchesDomain(parsed.hostname, domain)
  } catch {
    return false
  }
}

/**
 * Resolve a URL to the canonical registrable domain used as its cookie-file
 * key. The Public Suffix List handles domains such as `example.co.uk`; its
 * private section keeps independent tenants such as `alice.github.io` apart.
 * Known redirect/alternate domains are mapped to the session-owning website.
 */
export function canonicalCookieDomain(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

    const hostname = normalizeHostname(parsed.hostname)
    if (!hostname) return null

    const registrableDomain = getDomain(hostname, DOMAIN_OPTIONS)
    if (!registrableDomain) return null

    const normalizedDomain = registrableDomain.toLowerCase().replace(/\.+$/g, '')
    return COOKIE_DOMAIN_ALIASES[normalizedDomain] ?? normalizedDomain
  } catch {
    return null
  }
}
