import { probeYtDlpCapabilities, type YtDlpCapabilities } from './deps'
import { detectSite, type SiteId } from '../shared/sites'
import type { YtDlpCapabilityStatus } from '../shared/types'

export interface SiteExecutionContext {
  site: SiteId
  requestArgs: string[]
  siteCookiesFile: string | null
  impersonationAvailable: boolean | undefined
}

let capabilityCache: Promise<YtDlpCapabilities> | null = null

async function capabilities(force = false): Promise<YtDlpCapabilities> {
  if (force || !capabilityCache) capabilityCache = probeYtDlpCapabilities()
  return capabilityCache
}

export function invalidateYtDlpCapabilities(): void {
  capabilityCache = null
}

export async function ytdlpCapabilityStatus(force = false): Promise<YtDlpCapabilityStatus> {
  const result = await capabilities(force)
  return {
    installed: result.installation !== null,
    source: result.installation?.source ?? null,
    version: result.version,
    impersonationAvailable: result.impersonationAvailable,
    impersonateTargets: result.impersonateTargets
  }
}

/** Tao tham so chi ap dung cho dung website; khong ep workaround len site khac. */
export async function siteExecutionContext(
  url: string,
  cookiesFile: string | null
): Promise<SiteExecutionContext> {
  const site = detectSite(url)
  const requestArgs: string[] = []
  let impersonationAvailable: boolean | undefined

  if (site === 'facebook') {
    const cap = await capabilities()
    impersonationAvailable = cap.impersonationAvailable
    // Gia tri rong nghia la de yt-dlp chon target kha dung, ben vung hon viec
    // hard-code mot phien ban Chrome cu the.
    if (cap.impersonationAvailable) requestArgs.push('--impersonate=')
  }

  return {
    site,
    requestArgs,
    siteCookiesFile: cookiesFile,
    impersonationAvailable
  }
}

/** Facebook thu public truoc; chi thu cookie khi response cho thay auth/parse bi chan. */
export function shouldRetryFacebookWithCookies(site: SiteId, raw: unknown): boolean {
  if (site !== 'facebook') return false
  return /cannot parse data|sign in|log in|login required|private video|registered users|cookies?.*required|checkpoint|HTTP Error 403|\b403 Forbidden\b/i.test(
    String(raw ?? '')
  )
}
