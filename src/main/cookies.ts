import { app, BrowserWindow, session as electronSession } from 'electron'
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  CookieCaptureEvent,
  CookieCaptureResult,
  CookieStatus,
  SiteCookieStatus
} from '../shared/types'
import { canonicalCookieDomain } from '../shared/domains'
import type { CookieSite } from '../shared/sites'
export type { CookieSite } from '../shared/sites'

// Cookie dang nhap 100% bang Electron (khong can Python/Playwright).
// Moi registrable domain co file va persistent partition rieng. Khong co file
// cookies.txt dung chung o runtime, tranh gui credential cua site A sang site B.

const LEGACY_LOGIN_PARTITION = 'persist:tblao-login'
const COOKIE_DIRECTORY = 'cookies'
const HTTP_ONLY_PREFIX = '#HttpOnly_'

export const COOKIE_SITES = ['facebook', 'bilibili'] as const satisfies readonly CookieSite[]

interface SiteCookieConfig {
  label: string
  canonicalDomain: string
  legacyFileName: string
  legacyPartition: string
  defaultLoginUrl: string
  /** Host hop le trong URL dau vao (bao gom link rut gon). */
  urlDomains: readonly string[]
  /** Ten cookie de xac nhan nguoi dung da dang nhap; khong bao gio doc/log gia tri. */
  loginMarkers: readonly string[]
}

const SITE_COOKIE_CONFIG: Record<CookieSite, SiteCookieConfig> = {
  facebook: {
    label: 'Facebook',
    canonicalDomain: 'facebook.com',
    legacyFileName: 'cookies-facebook.txt',
    legacyPartition: 'persist:tblao-login-facebook',
    defaultLoginUrl: 'https://www.facebook.com/login/',
    urlDomains: ['facebook.com', 'fb.watch'],
    loginMarkers: ['c_user', 'xs']
  },
  bilibili: {
    label: 'Bilibili',
    canonicalDomain: 'bilibili.com',
    legacyFileName: 'cookies-bilibili.txt',
    legacyPartition: 'persist:tblao-login-bilibili',
    defaultLoginUrl: 'https://passport.bilibili.com/login',
    urlDomains: ['bilibili.com', 'b23.tv'],
    loginMarkers: ['SESSDATA', 'bili_jct', 'DedeUserID']
  }
}

interface NetscapeCookieRow {
  domain: string
  includeSubdomains: boolean
  path: string
  secure: boolean
  expires: number
  name: string
  value: string
  httpOnly: boolean
}

interface ParsedCookieText {
  rows: NetscapeCookieRow[]
  invalidRows: number
}

interface ParsedCookieFile {
  count: number
  expiredCount: number
  activeNames: Set<string>
}

interface LegacyCookieSource {
  path: string
  partition: string
  expectedDomain: string | null
  /** Shared truoc, dedicated sau; file store moi luon co uu tien cao nhat. */
  priority: number
  rows: NetscapeCookieRow[]
  removable: boolean
}

const domainMutexTails = new Map<string, Promise<void>>()
const domainRevisions = new Map<string, number>()
let migrationInFlight: Promise<void> | null = null

export function isCookieSite(value: unknown): value is CookieSite {
  return typeof value === 'string' && (COOKIE_SITES as readonly string[]).includes(value)
}

function getSiteConfig(site: CookieSite): SiteCookieConfig {
  // Lop phong ve runtime cho du lieu qua IPC; TypeScript khong bao ve chuoi tuy y.
  if (!isCookieSite(site)) throw new Error('Site cookie khong duoc ho tro.')
  return SITE_COOKIE_CONFIG[site]
}

function cookieDirectory(): string {
  return join(app.getPath('userData'), COOKIE_DIRECTORY)
}

function legacySharedCookiesPath(): string {
  return join(app.getPath('userData'), 'cookies.txt')
}

function legacySiteCookiesPath(site: CookieSite): string {
  return join(app.getPath('userData'), getSiteConfig(site).legacyFileName)
}

function isSafeCanonicalDomain(domain: string): boolean {
  const windowsBaseName = domain.split('.')[0]?.toUpperCase() ?? ''
  const windowsDeviceName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsBaseName)
  return (
    /^[a-z0-9.-]+$/.test(domain) &&
    !windowsDeviceName &&
    !domain.startsWith('.') &&
    !domain.endsWith('.') &&
    !domain.includes('..') &&
    canonicalCookieDomain(`https://${domain}/`) === domain
  )
}

function domainCookiesPath(domain: string): string {
  if (!isSafeCanonicalDomain(domain)) throw new Error('Ten mien cookie khong hop le.')
  return join(cookieDirectory(), `${domain}.txt`)
}

function partitionForDomain(domain: string): string {
  if (!isSafeCanonicalDomain(domain)) throw new Error('Ten mien cookie khong hop le.')
  const id = createHash('sha256').update(`tblao-cookie:${domain}`).digest('hex').slice(0, 32)
  return `persist:tblao-login-domain-${id}`
}

export function siteCookiesPath(site: CookieSite): string {
  return domainCookiesPath(getSiteConfig(site).canonicalDomain)
}

export function siteLoginUrl(site: CookieSite): string {
  return getSiteConfig(site).defaultLoginUrl
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
}

function domainMatches(domain: string, allowedDomain: string): boolean {
  const normalized = normalizeDomain(domain)
  const allowed = normalizeDomain(allowedDomain)
  return normalized === allowed || normalized.endsWith(`.${allowed}`)
}

function isAllowedDomain(domain: string, allowedDomains: readonly string[]): boolean {
  return allowedDomains.some((allowed) => domainMatches(domain, allowed))
}

/** Nhan dien site bang hostname chinh xac, tranh nham facebook.com.evil.example. */
export function cookieSiteFromUrl(url: string): CookieSite | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const hostname = normalizeDomain(parsed.hostname)
    for (const site of COOKIE_SITES) {
      if (isAllowedDomain(hostname, SITE_COOKIE_CONFIG[site].urlDomains)) return site
    }
  } catch {
    // URL khong hop le.
  }
  return null
}

function siteTargetUrl(site: CookieSite, url?: string | null): string {
  const config = getSiteConfig(site)
  if (!url) return config.defaultLoginUrl
  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      canonicalCookieDomain(parsed.toString()) === config.canonicalDomain
    ) {
      return parsed.toString()
    }
  } catch {
    // URL sai hoac khong thuoc site: quay ve trang dang nhap an toan mac dinh.
  }
  return config.defaultLoginUrl
}

function domainTarget(url: string): { domain: string; target: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const domain = canonicalCookieDomain(parsed.toString())
    if (!domain || !isSafeCanonicalDomain(domain)) return null
    return { domain, target: parsed.toString() }
  } catch {
    return null
  }
}

function canonicalDomainForCookieDomain(domain: string): string | null {
  const hostname = normalizeDomain(domain.replace(new RegExp(`^${HTTP_ONLY_PREFIX}`, 'i'), ''))
  if (!hostname) return null
  return canonicalCookieDomain(`https://${hostname}/`)
}

function parseNetscape(text: string): ParsedCookieText {
  const rows: NetscapeCookieRow[] = []
  let invalidRows = 0

  for (const originalLine of text.split(/\r?\n/)) {
    if (!originalLine.trim()) continue
    const httpOnly = originalLine.startsWith(HTTP_ONLY_PREFIX)
    if (originalLine.startsWith('#') && !httpOnly) continue

    const cookieLine = httpOnly ? originalLine.slice(HTTP_ONLY_PREFIX.length) : originalLine
    const fields = cookieLine.split('\t')
    if (fields.length < 7) {
      invalidRows += 1
      continue
    }

    const rawDomain = fields[0].trim().toLowerCase()
    const normalizedDomain = normalizeDomain(rawDomain)
    const includeSubdomainsText = fields[1].trim().toUpperCase()
    const secureText = fields[3].trim().toUpperCase()
    const expiresText = fields[4].trim()
    const expires = expiresText === '' ? 0 : Number(expiresText)
    const name = fields[5]
    if (
      !normalizedDomain ||
      !canonicalDomainForCookieDomain(normalizedDomain) ||
      !['TRUE', 'FALSE'].includes(includeSubdomainsText) ||
      !['TRUE', 'FALSE'].includes(secureText) ||
      !Number.isFinite(expires) ||
      expires < 0 ||
      !name
    ) {
      invalidRows += 1
      continue
    }

    rows.push({
      domain: rawDomain.startsWith('.') ? `.${normalizedDomain}` : normalizedDomain,
      includeSubdomains: includeSubdomainsText === 'TRUE',
      path: fields[2] || '/',
      secure: secureText === 'TRUE',
      expires,
      name,
      value: fields.slice(6).join('\t'),
      httpOnly
    })
  }

  return { rows, invalidRows }
}

function serializeNetscape(rows: readonly NetscapeCookieRow[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# Generated by T-blao', '']
  for (const row of rows) {
    const domain = row.httpOnly ? `${HTTP_ONLY_PREFIX}${row.domain}` : row.domain
    lines.push(
      [
        domain,
        row.includeSubdomains ? 'TRUE' : 'FALSE',
        row.path || '/',
        row.secure ? 'TRUE' : 'FALSE',
        String(Math.floor(row.expires)),
        row.name,
        row.value
      ].join('\t')
    )
  }
  return `${lines.join('\n')}\n`
}

/** Chuyen cookie cua Electron sang dinh dang Netscape (yt-dlp doc duoc). */
function toNetscape(cookies: readonly Electron.Cookie[]): string {
  const rows: NetscapeCookieRow[] = []
  for (const cookie of cookies) {
    const normalizedDomain = normalizeDomain(cookie.domain ?? '')
    if (!normalizedDomain || !cookie.name) continue
    rows.push({
      domain: cookie.hostOnly ? normalizedDomain : `.${normalizedDomain}`,
      includeSubdomains: !cookie.hostOnly,
      path: cookie.path || '/',
      secure: !!cookie.secure,
      expires: cookie.session || !cookie.expirationDate ? 0 : Math.floor(cookie.expirationDate),
      name: cookie.name,
      value: cookie.value,
      httpOnly: !!cookie.httpOnly
    })
  }
  return serializeNetscape(rows)
}

function rowKey(row: NetscapeCookieRow): string {
  return `${row.domain}\u0000${row.path}\u0000${row.name}`
}

function mergeRows(...groups: readonly NetscapeCookieRow[][]): NetscapeCookieRow[] {
  const merged = new Map<string, NetscapeCookieRow>()
  for (const rows of groups) {
    for (const row of rows) merged.set(rowKey(row), row)
  }
  return [...merged.values()]
}

function metadataForDomain(
  rows: readonly NetscapeCookieRow[],
  domain: string,
  nowSeconds = Date.now() / 1000
): ParsedCookieFile {
  const activeNames = new Set<string>()
  let count = 0
  let expiredCount = 0

  for (const row of rows) {
    if (canonicalDomainForCookieDomain(row.domain) !== domain) continue
    if (row.expires > 0 && row.expires <= nowSeconds) {
      expiredCount += 1
      continue
    }
    count += 1
    // Marker co gia tri rong khong duoc coi la phien dang nhap hop le.
    if (row.value) activeNames.add(row.name)
  }

  return { count, expiredCount, activeNames }
}

function missingLoginMarkers(names: ReadonlySet<string>, markers: readonly string[]): string[] {
  return markers.filter((marker) => !names.has(marker))
}

function errnoCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as NodeJS.ErrnoException).code ?? '')
    : null
}

async function ensureCookieDirectory(): Promise<void> {
  await mkdir(cookieDirectory(), { recursive: true, mode: 0o700 })
  await chmod(cookieDirectory(), 0o700).catch(() => {
    /* Windows dung ACL thay vi POSIX mode. */
  })
}

async function atomicWriteCookieFile(path: string, text: string): Promise<void> {
  await ensureCookieDirectory()
  const tempPath = join(
    cookieDirectory(),
    `.cookie-${process.pid}-${randomBytes(8).toString('hex')}.tmp`
  )
  let handle: Awaited<ReturnType<typeof open>> | null = null

  try {
    handle = await open(tempPath, 'wx', 0o600)
    await handle.writeFile(text, { encoding: 'utf-8' })
    await handle.sync()
    await handle.close()
    handle = null
    // Temp nam cung directory de replace la atomic tren cung filesystem. Tren
    // Windows, antivirus/indexer co the giu handle rat ngan va lam MoveFileEx
    // tra EPERM/EACCES; retry rename, tuyet doi khong rm destination truoc vi
    // nhu vay se tao khoang trong hoac mat file neu app crash.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(tempPath, path)
        break
      } catch (error) {
        const retryable = ['EACCES', 'EBUSY', 'EPERM'].includes(errnoCode(error) ?? '')
        if (!retryable || attempt >= 5) throw error
        await new Promise<void>((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
      }
    }
    await chmod(path, 0o600).catch(() => {
      /* Windows khong ap dung POSIX mode; ACL cua userData van la lop bao ve chinh. */
    })
  } finally {
    await handle?.close().catch(() => {})
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

async function readCookieRows(path: string): Promise<ParsedCookieText> {
  try {
    return parseNetscape(await readFile(path, 'utf-8'))
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { rows: [], invalidRows: 0 }
    throw error
  }
}

async function withDomainMutex<T>(domain: string, action: () => Promise<T>): Promise<T> {
  const previous = domainMutexTails.get(domain) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => gate)
  domainMutexTails.set(domain, tail)

  await previous.catch(() => {})
  try {
    return await action()
  } finally {
    release()
    if (domainMutexTails.get(domain) === tail) domainMutexTails.delete(domain)
  }
}

function nextDomainRevision(domain: string): number {
  const revision = (domainRevisions.get(domain) ?? 0) + 1
  domainRevisions.set(domain, revision)
  return revision
}

async function readLegacySource(
  path: string,
  partition: string,
  expectedDomain: string | null,
  priority: number
): Promise<LegacyCookieSource | null> {
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }

  const parsed = parseNetscape(text)
  const rows: NetscapeCookieRow[] = []
  let unmappableRows = parsed.invalidRows
  for (const row of parsed.rows) {
    const domain = canonicalDomainForCookieDomain(row.domain)
    if (!domain || (expectedDomain && domain !== expectedDomain)) {
      unmappableRows += 1
      continue
    }
    rows.push(row)
  }

  return {
    path,
    partition,
    expectedDomain,
    priority,
    rows,
    // Neu co dong khong map duoc thi giu source de khong xoa mat credential.
    // Runtime tuyet doi khong fallback sang source nay.
    removable: unmappableRows === 0
  }
}

async function migrateLegacyCookieFiles(): Promise<void> {
  await ensureCookieDirectory()
  const candidates = await Promise.all([
    readLegacySource(legacySharedCookiesPath(), LEGACY_LOGIN_PARTITION, null, 0),
    readLegacySource(
      legacySiteCookiesPath('facebook'),
      SITE_COOKIE_CONFIG.facebook.legacyPartition,
      'facebook.com',
      1
    ),
    readLegacySource(
      legacySiteCookiesPath('bilibili'),
      SITE_COOKIE_CONFIG.bilibili.legacyPartition,
      'bilibili.com',
      1
    )
  ])
  const sources = candidates.filter((source): source is LegacyCookieSource => source !== null)
  const clearLegacyPartitions = async (): Promise<void> => {
    const partitions = new Set([
      LEGACY_LOGIN_PARTITION,
      SITE_COOKIE_CONFIG.facebook.legacyPartition,
      SITE_COOKIE_CONFIG.bilibili.legacyPartition
    ])
    await Promise.all(
      [...partitions].map((partition) =>
        electronSession.fromPartition(partition).clearStorageData({ storages: ['cookies'] })
      )
    )
  }
  if (sources.length === 0) {
    // Partition cu khong con duoc runtime su dung. Don no ke ca khi file legacy
    // da duoc migrate/xoa boi mot phien app truoc.
    await clearLegacyPartitions()
    return
  }

  const grouped = new Map<string, { priority: number; rows: NetscapeCookieRow[] }[]>()
  for (const source of sources) {
    for (const row of source.rows) {
      const domain = canonicalDomainForCookieDomain(row.domain)
      if (!domain || !isSafeCanonicalDomain(domain)) continue
      const groups = grouped.get(domain) ?? []
      let group = groups.find((candidate) => candidate.priority === source.priority)
      if (!group) {
        group = { priority: source.priority, rows: [] }
        groups.push(group)
        grouped.set(domain, groups)
      }
      group.rows.push(row)
    }
  }

  // Moi destination duoc ghi atomic. Neu crash truoc khi xoa source, lan sau
  // merge theo key nen idempotent va file store moi van thang du lieu legacy.
  await Promise.all(
    [...grouped.entries()].map(([domain, groups]) =>
      withDomainMutex(domain, async () => {
        const destination = domainCookiesPath(domain)
        const current = await readCookieRows(destination)
        if (current.invalidRows > 0) {
          // Sao luu file store hong truoc khi replace; copy (khong rename) giu
          // destination cu hoat dong neu app crash/disk full truoc atomic commit.
          // Cac row parse duoc van duoc merge vao destination moi.
          const corruptBackup = `${destination}.${Date.now()}-${randomBytes(6).toString('hex')}.corrupt`
          await copyFile(destination, corruptBackup, fsConstants.COPYFILE_EXCL)
          await chmod(corruptBackup, 0o600).catch(() => {})
        }
        const legacyGroups = groups
          .sort((left, right) => left.priority - right.priority)
          .map((group) => group.rows)
        const merged = mergeRows(...legacyGroups, current.rows)
        await atomicWriteCookieFile(destination, serializeNetscape(merged))
      })
    )
  )

  // Chi don source sau khi TAT CA destination da replace thanh cong. Source co
  // dong loi duoc doi khoi ten runtime sang backup ngau nhien, khong overwrite
  // backup cu va khong bao gio duoc fallback. Cac dong hop le da duoc migrate.
  await Promise.all(
    sources.map(async (source) => {
      if (source.removable) {
        await rm(source.path, { force: true })
        return
      }
      const backup = `${source.path}.${Date.now()}-${randomBytes(6).toString('hex')}.legacy-unmigrated`
      await rename(source.path, backup)
      await chmod(backup, 0o600).catch(() => {
        /* Windows giu ACL userData; POSIX backup credential phai chi owner doc. */
      })
    })
  )

  // Cookie trong persistent partition cu cung la credential. Chi clear sau
  // khi file da migrate + source da xoa/backup thanh cong. Neu clear loi,
  // migration reject; lan goi sau se thu lai ngay ca khi source khong con.
  await clearLegacyPartitions()
}

async function ensureLegacyCookieMigration(): Promise<void> {
  if (!migrationInFlight) {
    const run = migrateLegacyCookieFiles()
    migrationInFlight = run.catch((error) => {
      migrationInFlight = null
      throw error
    })
  }
  return migrationInFlight
}

function emptyCookieStatus(domain: string | null): CookieStatus {
  return { has: false, count: 0, domain, expiredCount: 0 }
}

async function domainMetadataLocked(domain: string): Promise<ParsedCookieFile> {
  const parsed = await readCookieRows(domainCookiesPath(domain))
  // Policy runtime: bo qua dong Netscape loi, giong yt-dlp 2026.07.04. Chi
  // cookie parse duoc, dung domain va con han moi duoc dem/resolve. Neu khong co
  // dong hop le, resolve tra null thay vi dua mot file rac cho yt-dlp.
  return metadataForDomain(parsed.rows, domain)
}

async function domainCookieStatusByDomain(domain: string): Promise<CookieStatus> {
  return withDomainMutex(domain, async () => {
    const metadata = await domainMetadataLocked(domain)
    return {
      has: metadata.count > 0,
      count: metadata.count,
      domain,
      expiredCount: metadata.expiredCount
    }
  })
}

/** Trang thai cookie chinh xac cua registrable domain tu URL. */
export async function domainCookieStatus(url: string): Promise<CookieStatus> {
  const target = domainTarget(url)
  if (!target) return emptyCookieStatus(null)
  await ensureLegacyCookieMigration()
  return domainCookieStatusByDomain(target.domain)
}

/** Liet ke cac domain co file cookie, ke ca file chi con cookie het han. */
export async function listDomainCookieStatuses(): Promise<CookieStatus[]> {
  await ensureLegacyCookieMigration()
  await ensureCookieDirectory()
  const entries = await readdir(cookieDirectory(), { withFileTypes: true })
  const domains = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
    .map((entry) => entry.name.slice(0, -4))
    .filter((domain) => isSafeCanonicalDomain(domain))
  const statuses = await Promise.all(domains.map(domainCookieStatusByDomain))
  return statuses.sort((left, right) => (left.domain ?? '').localeCompare(right.domain ?? ''))
}

/**
 * Main-process lookup duy nhat cho --cookies. Renderer chi gui URL + enabled,
 * khong gui duong dan file. File het han/khong co cookie active tra ve null.
 */
export async function resolveDomainCookieFile(
  url: string,
  enabled: boolean
): Promise<string | null> {
  if (!enabled) return null
  const target = domainTarget(url)
  if (!target) return null
  await ensureLegacyCookieMigration()
  return withDomainMutex(target.domain, async () => {
    const metadata = await domainMetadataLocked(target.domain)
    return metadata.count > 0 ? domainCookiesPath(target.domain) : null
  })
}

/**
 * Chay mot tac vu duoi cung mutex voi capture-write/clear/migration cua domain.
 * Dung khi caller da tu quan ly snapshot/path. Mutex chi co hieu luc trong main
 * process hien tai; khong phai file lock lien process.
 */
export async function withDomainCookieLock<T>(
  url: string,
  task: () => Promise<T>
): Promise<T> {
  const target = domainTarget(url)
  if (!target) return task()
  await ensureLegacyCookieMigration()
  return withDomainMutex(target.domain, task)
}

/**
 * Resolve file va giu mutex xuyen suot task. Day la API uu tien cho yt-dlp:
 * clear/capture/migration khong the thay file tu luc resolve den luc process da
 * close (yt-dlp co the dump cookie jar nguoc vao file khi thoat).
 */
export async function withResolvedDomainCookie<T>(
  url: string,
  enabled: boolean,
  task: (file: string | null) => Promise<T>
): Promise<T> {
  if (!enabled) return task(null)
  const target = domainTarget(url)
  if (!target) return task(null)
  await ensureLegacyCookieMigration()
  return withDomainMutex(target.domain, async () => {
    const metadata = await domainMetadataLocked(target.domain)
    const file = metadata.count > 0 ? domainCookiesPath(target.domain) : null
    // yt-dlp co the cap nhat cookie jar khi process dong. Vo hieu hoa moi cua
    // so dang nhap da mo truoc do, tranh snapshot cu ghi de file vua cap nhat.
    if (file) nextDomainRevision(target.domain)
    return task(file)
  })
}

interface CaptureOptions {
  domain: string
  target: string
  label: string | null
  loginMarkers?: readonly string[]
}

function safeEvent(onEvent: (event: CookieCaptureEvent) => void, event: CookieCaptureEvent): void {
  try {
    onEvent(event)
  } catch {
    // Renderer co the reload/dong trong khi cua so dang nhap van mo.
  }
}

function captureFailure(
  domain: string | null,
  message: string,
  onEvent: (event: CookieCaptureEvent) => void
): CookieCaptureResult {
  safeEvent(onEvent, { phase: 'error', message })
  return { ok: false, count: 0, domain, error: message }
}

async function captureCookiesToDomain(
  options: CaptureOptions,
  onEvent: (event: CookieCaptureEvent) => void
): Promise<CookieCaptureResult> {
  await ensureLegacyCookieMigration()

  // Khoa rat ngan de cap token. Khong giu mutex trong luc user dang nhap.
  const captureRevision = await withDomainMutex(options.domain, async () =>
    nextDomainRevision(options.domain)
  )
  const partition = partitionForDomain(options.domain)
  const ses = electronSession.fromPartition(partition)
  const suffix = options.label ? ` ${options.label}` : ` ${options.domain}`

  return new Promise<CookieCaptureResult>((resolve) => {
    let win: BrowserWindow
    try {
      win = new BrowserWindow({
        width: 1000,
        height: 720,
        title: `Dang nhap${suffix} - T-blao`,
        autoHideMenuBar: true,
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      resolve(captureFailure(options.domain, message, onEvent))
      return
    }

    // Popup dang nhap ke thua cung persistent partition.
    win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }))
    const browserUserAgent = win.webContents
      .getUserAgent()
      .replace(/\sElectron\/[\d.]+/gi, '')
      .replace(/\sT-blao\/[\d.]+/gi, '')
    win.webContents.setUserAgent(browserUserAgent)

    safeEvent(onEvent, { phase: 'launching', message: `Dang mo cua so dang nhap${suffix}...` })
    let announced = false
    win.webContents.on('did-finish-load', () => {
      if (announced) return
      announced = true
      safeEvent(onEvent, {
        phase: 'ready',
        message: `Hay dang nhap${suffix}, roi DONG cua so nay de luu cookie.`
      })
    })

    win.loadURL(options.target).catch(() => {
      /* Mot so trang chan navigation truc tiep; van cho nguoi dung thao tac. */
    })

    let settled = false
    win.on('closed', () => {
      if (settled) return
      settled = true
      void (async () => {
        try {
          const result = await withDomainMutex(options.domain, async (): Promise<CookieCaptureResult> => {
            // Clear hoac capture moi hon da xay ra trong luc cua so mo: khong hoi
            // sinh/ghi de trang thai cookie bang snapshot cu.
            if (domainRevisions.get(options.domain) !== captureRevision) {
              const message = 'Trang thai cookie da thay doi trong khi cua so dang nhap mo. Hay thu lai.'
              return { ok: false, count: 0, domain: options.domain, error: message }
            }

            const nowSeconds = Date.now() / 1000
            const allCookies = await ses.cookies.get({})
            const cookies = allCookies.filter((cookie) => {
              const cookieDomain = canonicalDomainForCookieDomain(cookie.domain ?? '')
              const active = !cookie.expirationDate || cookie.expirationDate > nowSeconds
              return cookieDomain === options.domain && active
            })
            const activeNames = new Set(
              cookies.filter((cookie) => !!cookie.value).map((cookie) => cookie.name)
            )
            const missing = missingLoginMarkers(activeNames, options.loginMarkers ?? [])

            if (cookies.length === 0 || (options.loginMarkers && missing.length > 0)) {
              const message = options.label
                ? `Chua xac nhan dang nhap ${options.label}. Hay dang nhap day du roi thu lai.`
                : `Chua lay duoc cookie cho ${options.domain}. Hay dang nhap roi thu lai.`
              return { ok: false, count: cookies.length, domain: options.domain, error: message }
            }

            await atomicWriteCookieFile(domainCookiesPath(options.domain), toNetscape(cookies))
            return {
              ok: true,
              count: cookies.length,
              domain: options.domain,
              error: null
            }
          })

          if (result.ok) {
            safeEvent(onEvent, {
              phase: 'saved',
              message: `Da luu ${result.count} cookie${suffix}.`,
              count: result.count
            })
          } else {
            safeEvent(onEvent, { phase: 'error', message: result.error ?? 'Khong the luu cookie.' })
          }
          resolve(result)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          resolve(captureFailure(options.domain, message, onEvent))
        }
      })()
    })
  })
}

/** URL la bat buoc; chi cookie cung canonical domain moi duoc ghi. */
export async function captureDomainCookies(
  url: string,
  onEvent: (event: CookieCaptureEvent) => void
): Promise<CookieCaptureResult> {
  const target = domainTarget(url)
  if (!target) {
    return captureFailure(null, 'Can mot URL website HTTP/HTTPS hop le de lay cookie.', onEvent)
  }
  // Neu user nhap Facebook/Bilibili trong muc website khac, van bat buoc qua
  // marker dang nhap cua site. Khong de mot lan capture cookie anonymous ghi de
  // file dang nhap hop le cua nut chuyen dung.
  const site = cookieSiteFromUrl(url)
  if (site) return captureSiteCookies(site, url, onEvent)
  return captureCookiesToDomain(
    { domain: target.domain, target: target.target, label: null },
    onEvent
  )
}

async function clearDomainByName(domain: string): Promise<void> {
  await withDomainMutex(domain, async () => {
    // Invalidate moi cua so capture da mo truoc thao tac clear.
    nextDomainRevision(domain)
    await rm(domainCookiesPath(domain), { force: true })
    await electronSession
      .fromPartition(partitionForDomain(domain))
      .clearStorageData({ storages: ['cookies'] })
  })
}

export async function clearDomainCookies(url: string): Promise<void> {
  const target = domainTarget(url)
  if (!target) throw new Error('Can mot URL website HTTP/HTTPS hop le de xoa cookie.')
  await ensureLegacyCookieMigration()
  await clearDomainByName(target.domain)
}

/** Wrapper site-aware cu, bay gio cung dung store canonical-domain moi. */
export async function captureSiteCookies(
  site: CookieSite,
  url: string | null | undefined,
  onEvent: (event: CookieCaptureEvent) => void
): Promise<CookieCaptureResult> {
  const config = getSiteConfig(site)
  return captureCookiesToDomain(
    {
      domain: config.canonicalDomain,
      target: siteTargetUrl(site, url),
      label: config.label,
      loginMarkers: config.loginMarkers
    },
    onEvent
  )
}

export async function siteCookieStatus(site: CookieSite): Promise<SiteCookieStatus> {
  const config = getSiteConfig(site)
  await ensureLegacyCookieMigration()
  return withDomainMutex(config.canonicalDomain, async () => {
    const metadata = await domainMetadataLocked(config.canonicalDomain)
    const missing = missingLoginMarkers(metadata.activeNames, config.loginMarkers)
    const loggedIn = metadata.count > 0 && missing.length === 0
    return {
      site,
      has: loggedIn,
      count: metadata.count,
      domain: config.canonicalDomain,
      expiredCount: metadata.expiredCount,
      loggedIn,
      missingLoginMarkers: missing
    }
  })
}

export async function clearSiteCookies(site: CookieSite): Promise<void> {
  const config = getSiteConfig(site)
  await ensureLegacyCookieMigration()
  await clearDomainByName(config.canonicalDomain)
  // Don partition cu de thao tac Xoa van xoa het session truoc migration.
  await electronSession
    .fromPartition(config.legacyPartition)
    .clearStorageData({ storages: ['cookies'] })
    .catch(() => {})
}

// ---- Wrapper legacy tam thoi cho IPC/preload cu ----

/** @deprecated Dung captureDomainCookies(url, onEvent). URL khong duoc de trong. */
export function captureCookies(
  url: string,
  onEvent: (event: CookieCaptureEvent) => void
): Promise<CookieCaptureResult> {
  return captureDomainCookies(url, onEvent)
}

/**
 * @deprecated Trang thai tong hop de code UI cu khong vo. Khong tra path va
 * khong tuong ung voi mot file cookies.txt dung chung.
 */
export async function cookieStatus(): Promise<CookieStatus> {
  const statuses = await listDomainCookieStatuses()
  const count = statuses.reduce((total, status) => total + status.count, 0)
  const expiredCount = statuses.reduce((total, status) => total + status.expiredCount, 0)
  return { has: count > 0, count, domain: null, expiredCount }
}

/** @deprecated Xoa toan bo store domain; UI moi nen goi clearDomainCookies(url). */
export async function clearCookies(): Promise<void> {
  await ensureLegacyCookieMigration()
  const statuses = await listDomainCookieStatuses()
  await Promise.all(
    statuses
      .map((status) => status.domain)
      .filter((domain): domain is string => !!domain)
      .map(clearDomainByName)
  )
  await electronSession
    .fromPartition(LEGACY_LOGIN_PARTITION)
    .clearStorageData({ storages: ['cookies'] })
    .catch(() => {})
  // Neu migration giu lai source bi loi dinh dang, Clear-all van phai xoa no.
  await Promise.all([
    rm(legacySharedCookiesPath(), { force: true }),
    rm(legacySiteCookiesPath('facebook'), { force: true }),
    rm(legacySiteCookiesPath('bilibili'), { force: true })
  ])
}
