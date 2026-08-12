export type SiteId = 'facebook' | 'bilibili' | 'youtube' | 'generic'
export type CookieSite = Extract<SiteId, 'facebook' | 'bilibili'>

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/g, '')
}

function matchesDomain(hostname: string, domain: string): boolean {
  const host = normalizeHost(hostname)
  return host === domain || host.endsWith(`.${domain}`)
}

export function detectSite(url: string): SiteId {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'generic'
    const host = normalizeHost(parsed.hostname)

    if (matchesDomain(host, 'facebook.com') || matchesDomain(host, 'fb.watch')) return 'facebook'
    if (matchesDomain(host, 'bilibili.com') || matchesDomain(host, 'b23.tv')) return 'bilibili'
    if (
      matchesDomain(host, 'youtube.com') ||
      matchesDomain(host, 'youtu.be') ||
      matchesDomain(host, 'youtube-nocookie.com')
    ) {
      return 'youtube'
    }
  } catch {
    // URL khong hop le duoc xu ly nhu website chung.
  }
  return 'generic'
}

export function cookieSiteForUrl(url: string): CookieSite | null {
  const site = detectSite(url)
  return site === 'facebook' || site === 'bilibili' ? site : null
}

/**
 * Cac URL chac chan la mot video/episode. Bo qua probe playlist cho chung de
 * tranh tao them request anti-bot. Bilibili /video/BV... co the la anthology,
 * nen chi coi la video don khi URL da chon ro trang bang ?p=.
 */
export function isKnownSingleVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const site = detectSite(url)
    const path = parsed.pathname.toLowerCase()

    if (site === 'facebook') {
      return (
        (matchesDomain(parsed.hostname, 'fb.watch') && path !== '/') ||
        /^\/reel\/[^/]+/.test(path) ||
        /\/videos\/[^/]+/.test(path) ||
        ((path === '/watch/' || path === '/watch') && parsed.searchParams.has('v')) ||
        (path.endsWith('/video.php') && parsed.searchParams.has('v'))
      )
    }

    if (site === 'bilibili') {
      return (matchesDomain(parsed.hostname, 'b23.tv') && path !== '/') ||
        /\/bangumi\/play\/ep\d+/i.test(parsed.pathname) ||
        (/^\/video\/(?:bv[^/]+|av\d+)/i.test(parsed.pathname) && parsed.searchParams.has('p'))
    }
  } catch {
    // URL sai khong duoc toi uu probe.
  }
  return false
}
