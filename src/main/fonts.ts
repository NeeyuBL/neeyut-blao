import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { readFile as readFileAsync } from 'node:fs/promises'
import { app } from 'electron'
import type { BurnFontEntry, BurnFontPreviewData } from '../shared/types'

export type BurnFontSource = 'bundled' | 'custom'
export type ManagedBurnFontEntry = BurnFontEntry & {
  source: BurnFontSource
  available: true
}

export interface ResolvedBurnFont {
  entry: ManagedBurnFontEntry
  filePath: string
  fontsDir: string
  sha256: string
}

interface BundledFontManifestEntry {
  id: string
  label: string
  file: string
  family: string
  group: string
  sha256: string
}

interface BundledFontManifest {
  schemaVersion: 1
  packVersion: string
  defaultFontId: string
  fonts: BundledFontManifestEntry[]
}

interface CustomFontManifestEntry {
  id: string
  label: string
  file: string
  family: string
  group: string
  sha256: string
  importedAt: string
}

interface CustomFontManifest {
  schemaVersion: 1
  fonts: CustomFontManifestEntry[]
}

interface FontRecord {
  entry: ManagedBurnFontEntry
  filePath: string
  fontsDir: string
  sha256: string
}

interface FontRegistry {
  records: FontRecord[]
  byId: Map<string, FontRecord>
  defaultFontId: string | null
}

const FONT_EXT_RE = /\.(?:ttf|otf)$/i
const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/
const SHA256_RE = /^[a-f0-9]{64}$/
const MAX_FONT_BYTES = 64 * 1024 * 1024
const CUSTOM_MANIFEST = 'manifest.json'

let cachedBundledDir: string | null = null
let cachedRegistry: FontRegistry | null = null

function warn(message: string, error?: unknown): void {
  console.warn(`[fonts] ${message}`, error instanceof Error ? error.message : (error ?? ''))
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function safeChild(root: string, child: string, label: string): string {
  if (!child || typeof child !== 'string' || isAbsolute(child) || child.includes('\0')) {
    throw new Error(`${label} không hợp lệ.`)
  }
  const base = resolve(root)
  const target = resolve(base, child)
  const rel = relative(base, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} nằm ngoài thư mục font.`)
  }
  return target
}

function assertRealPathInside(root: string, target: string, label: string): void {
  const realRoot = realpathSync(root)
  const realTarget = realpathSync(target)
  const rel = relative(realRoot, realTarget)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} trỏ ra ngoài thư mục font cá nhân.`)
  }
}

/** Thư mục font đóng gói (dev: resources/fonts, packaged: resources/fonts). */
export function resolveFontsDir(): string | null {
  if (cachedBundledDir && existsSync(cachedBundledDir)) return cachedBundledDir

  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'fonts')]
    : [
        join(app.getAppPath(), 'resources', 'fonts'),
        join(__dirname, '..', '..', 'resources', 'fonts')
      ]

  for (const dir of candidates) {
    if (existsSync(join(dir, 'manifest.json')) || existsSync(join(dir, 'catalog.json'))) {
      cachedBundledDir = dir
      return dir
    }
  }
  return null
}

export function resolveCustomFontsDir(): string {
  return join(app.getPath('userData'), 'fonts', 'custom')
}

function decodeName(buffer: Buffer, start: number, length: number, platformId: number): string {
  if (platformId === 0 || platformId === 3) {
    let text = ''
    for (let offset = 0; offset + 1 < length; offset += 2) {
      text += String.fromCharCode(buffer.readUInt16BE(start + offset))
    }
    return text.replace(/\0/g, '').trim()
  }
  return buffer.toString('latin1', start, start + length).replace(/\0/g, '').trim()
}

function readFontNames(buffer: Buffer): { family: string; fullName: string } {
  if (buffer.length < 12) throw new Error('File font quá ngắn.')
  const signature = buffer.subarray(0, 4).toString('latin1')
  const trueType = buffer.readUInt32BE(0) === 0x00010000
  if (!trueType && signature !== 'OTTO' && signature !== 'true') {
    throw new Error('Chỉ hỗ trợ font TTF/OTF hợp lệ.')
  }

  const tableCount = buffer.readUInt16BE(4)
  let nameOffset = -1
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16
    if (record + 16 > buffer.length) break
    if (buffer.toString('ascii', record, record + 4) === 'name') {
      nameOffset = buffer.readUInt32BE(record + 8)
      break
    }
  }
  if (nameOffset < 0 || nameOffset + 6 > buffer.length) {
    throw new Error('Không đọc được metadata family của font.')
  }

  const count = buffer.readUInt16BE(nameOffset + 2)
  const strings = nameOffset + buffer.readUInt16BE(nameOffset + 4)
  const best = new Map<number, { value: string; score: number }>()
  for (let index = 0; index < count; index += 1) {
    const record = nameOffset + 6 + index * 12
    if (record + 12 > buffer.length) break
    const platformId = buffer.readUInt16BE(record)
    const languageId = buffer.readUInt16BE(record + 4)
    const nameId = buffer.readUInt16BE(record + 6)
    if (nameId !== 1 && nameId !== 4 && nameId !== 16) continue

    const length = buffer.readUInt16BE(record + 8)
    const start = strings + buffer.readUInt16BE(record + 10)
    if (start < 0 || start + length > buffer.length) continue
    const value = decodeName(buffer, start, length, platformId)
    if (!value) continue

    const score =
      (platformId === 3 && languageId === 0x0409 ? 100 : platformId === 3 ? 70 : platformId === 0 ? 60 : 20) +
      (nameId === 16 ? 3 : nameId === 4 ? 2 : 1)
    const previous = best.get(nameId)
    if (!previous || score > previous.score) best.set(nameId, { value, score })
  }

  const family = best.get(16)?.value || best.get(1)?.value
  const fullName = best.get(4)?.value || family
  if (!family || !fullName) throw new Error('Font không có family name hợp lệ.')
  if (/[\r\n{},]/.test(family) || family.length > 200) {
    throw new Error('Family name của font không an toàn cho phụ đề ASS.')
  }
  if (/[\r\n]/.test(fullName) || fullName.length > 200) {
    throw new Error('Tên hiển thị của font không hợp lệ.')
  }
  return { family, fullName }
}

function inspectFont(buffer: Buffer): { family: string; fullName: string; sha256: string } {
  if (buffer.length <= 0 || buffer.length > MAX_FONT_BYTES) {
    throw new Error(`Font phải có dung lượng từ 1 byte đến ${MAX_FONT_BYTES} byte.`)
  }
  return { ...readFontNames(buffer), sha256: sha256(buffer) }
}

function readJsonObject(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${basename(file)} không chứa object JSON.`)
  }
  return parsed as Record<string, unknown>
}

function isManifestFont(raw: unknown): raw is BundledFontManifestEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const font = raw as Record<string, unknown>
  return (
    typeof font.id === 'string' &&
    SAFE_ID_RE.test(font.id) &&
    typeof font.label === 'string' &&
    typeof font.file === 'string' &&
    basename(font.file) === font.file &&
    FONT_EXT_RE.test(font.file) &&
    typeof font.family === 'string' &&
    typeof font.group === 'string' &&
    typeof font.sha256 === 'string' &&
    SHA256_RE.test(font.sha256)
  )
}

function readBundledManifest(dir: string): BundledFontManifest {
  const raw = readJsonObject(join(dir, 'manifest.json'))
  if (raw.schemaVersion !== 1 || typeof raw.packVersion !== 'string' || typeof raw.defaultFontId !== 'string') {
    throw new Error('manifest.json của font pack không đúng schema 1.')
  }
  if (!Array.isArray(raw.fonts) || !raw.fonts.every(isManifestFont)) {
    throw new Error('Danh sách font mặc định trong manifest không hợp lệ.')
  }
  return raw as unknown as BundledFontManifest
}

function readBundledRecords(): { records: FontRecord[]; defaultFontId: string | null } {
  const dir = resolveFontsDir()
  if (!dir || !existsSync(join(dir, 'manifest.json'))) return { records: [], defaultFontId: null }

  try {
    const manifest = readBundledManifest(dir)
    const seen = new Set<string>()
    const records: FontRecord[] = []
    for (const font of manifest.fonts) {
      if (seen.has(font.id)) {
        warn(`Bỏ qua font có ID trùng: ${font.id}`)
        continue
      }
      seen.add(font.id)
      try {
        const filePath = safeChild(dir, font.file, `File font ${font.id}`)
        if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error('không tìm thấy file')
        const buffer = readFileSync(filePath)
        const inspected = inspectFont(buffer)
        if (inspected.sha256 !== font.sha256) throw new Error('checksum không khớp manifest')
        if (inspected.family !== font.family) {
          throw new Error(`family thực tế là '${inspected.family}', manifest là '${font.family}'`)
        }
        records.push({
          entry: {
            id: font.id,
            label: font.label,
            file: font.file,
            family: font.family,
            group: font.group,
            source: 'bundled',
            available: true
          },
          filePath,
          fontsDir: dir,
          sha256: inspected.sha256
        })
      } catch (error) {
        warn(`Bỏ qua font mặc định không dùng được '${font.id}'`, error)
      }
    }
    const defaultFontId = records.some((record) => record.entry.id === manifest.defaultFontId)
      ? manifest.defaultFontId
      : records[0]?.entry.id ?? null
    return { records, defaultFontId }
  } catch (error) {
    warn('Không thể đọc font pack mặc định', error)
    return { records: [], defaultFontId: null }
  }
}

function isCustomManifestFont(raw: unknown): raw is CustomFontManifestEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const font = raw as Record<string, unknown>
  return (
    typeof font.id === 'string' &&
    font.id.startsWith('custom-') &&
    SAFE_ID_RE.test(font.id) &&
    typeof font.label === 'string' &&
    typeof font.file === 'string' &&
    font.file.replace(/\\/g, '/').startsWith(`${font.id}/`) &&
    FONT_EXT_RE.test(font.file) &&
    typeof font.family === 'string' &&
    typeof font.group === 'string' &&
    typeof font.sha256 === 'string' &&
    SHA256_RE.test(font.sha256) &&
    typeof font.importedAt === 'string'
  )
}

function readCustomManifest(strict: boolean): CustomFontManifestEntry[] {
  const dir = resolveCustomFontsDir()
  const file = join(dir, CUSTOM_MANIFEST)
  if (!existsSync(file)) return []
  try {
    const raw = readJsonObject(file)
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.fonts) || !raw.fonts.every(isCustomManifestFont)) {
      throw new Error('manifest font cá nhân không đúng schema 1')
    }
    return raw.fonts as CustomFontManifestEntry[]
  } catch (error) {
    if (strict) throw error
    warn('Không thể đọc manifest font cá nhân', error)
    return []
  }
}

function readCustomRecords(): FontRecord[] {
  const dir = resolveCustomFontsDir()
  const records: FontRecord[] = []
  for (const font of readCustomManifest(false)) {
    try {
      const filePath = safeChild(dir, font.file, `File font ${font.id}`)
      if (!existsSync(filePath) || !lstatSync(filePath).isFile() || lstatSync(filePath).isSymbolicLink()) {
        throw new Error('không tìm thấy file thường')
      }
      assertRealPathInside(dir, filePath, `File font ${font.id}`)
      const buffer = readFileSync(filePath)
      const inspected = inspectFont(buffer)
      if (inspected.sha256 !== font.sha256) throw new Error('checksum đã thay đổi')
      if (inspected.family !== font.family) throw new Error('family metadata đã thay đổi')
      records.push({
        entry: {
          id: font.id,
          label: font.label,
          file: font.file,
          family: font.family,
          group: font.group,
          source: 'custom',
          available: true
        },
        filePath,
        fontsDir: dirname(filePath),
        sha256: inspected.sha256
      })
    } catch (error) {
      warn(`Bỏ qua font cá nhân không dùng được '${font.id}'`, error)
    }
  }
  return records
}

function buildRegistry(): FontRegistry {
  const bundled = readBundledRecords()
  const records = [...bundled.records]
  const used = new Set(records.map((record) => record.entry.id))
  for (const record of readCustomRecords()) {
    if (used.has(record.entry.id)) {
      warn(`Bỏ qua font cá nhân có ID trùng: ${record.entry.id}`)
      continue
    }
    used.add(record.entry.id)
    records.push(record)
  }
  return {
    records,
    byId: new Map(records.map((record) => [record.entry.id, record])),
    defaultFontId: bundled.defaultFontId
  }
}

function registry(): FontRegistry {
  if (!cachedRegistry) cachedRegistry = buildRegistry()
  return cachedRegistry
}

export function refreshBurnFontRegistry(): void {
  cachedRegistry = null
  cachedBundledDir = null
}

function cloneEntry(entry: ManagedBurnFontEntry): ManagedBurnFontEntry {
  return { ...entry }
}

/** Chỉ trả về font có file thật, metadata hợp lệ và checksum đúng. */
export function listBurnFonts(): ManagedBurnFontEntry[] {
  return registry().records.map((record) => cloneEntry(record.entry))
}

export function findBurnFont(fontId: string | null | undefined): ManagedBurnFontEntry | null {
  if (!fontId || fontId === 'auto') return null
  const record = registry().byId.get(fontId)
  return record ? cloneEntry(record.entry) : null
}

/** Resolve một font ID thành đúng file dùng chung cho preview và FFmpeg/libass. */
export function resolveBurnFont(fontId: string | null | undefined): ResolvedBurnFont | null {
  if (!fontId || fontId === 'auto') return null
  const record = registry().byId.get(fontId)
  return record
    ? {
        entry: cloneEntry(record.entry),
        filePath: record.filePath,
        fontsDir: record.fontsDir,
        sha256: record.sha256
      }
    : null
}

export function resolveDefaultBurnFont(): ResolvedBurnFont | null {
  return resolveBurnFont(registry().defaultFontId)
}

/** Dữ liệu nhị phân được main xác minh trước khi gửi cho FontFace API. */
export async function readBurnFontPreview(fontId: string): Promise<BurnFontPreviewData> {
  const resolved = resolveBurnFont(fontId)
  if (!resolved) throw new Error('Font đã chọn không tồn tại hoặc không còn khả dụng.')
  let buffer: Buffer
  try {
    buffer = await readFileAsync(resolved.filePath)
  } catch {
    refreshBurnFontRegistry()
    throw new Error('File font đã chọn không còn tồn tại.')
  }
  if (buffer.length > MAX_FONT_BYTES || sha256(buffer) !== resolved.sha256) {
    refreshBurnFontRegistry()
    throw new Error('File font đã thay đổi sau khi được kiểm tra.')
  }
  const data = Uint8Array.from(buffer).buffer
  return { id: resolved.entry.id, family: resolved.entry.family, data }
}

function atomicWriteNew(file: string, data: Buffer): void {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  let descriptor: number | null = null
  try {
    descriptor = openSync(temp, 'wx', 0o600)
    writeFileSync(descriptor, data)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temp, file)
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor)
    if (existsSync(temp)) unlinkSync(temp)
    throw error
  }
}

function writeCustomManifest(fonts: CustomFontManifestEntry[]): void {
  const dir = resolveCustomFontsDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, CUSTOM_MANIFEST)
  const temp = safeChild(
    dir,
    `${CUSTOM_MANIFEST}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
    'Manifest tạm'
  )
  const backup = safeChild(dir, `${CUSTOM_MANIFEST}.${process.pid}.bak`, 'Manifest backup')
  const payload: CustomFontManifest = { schemaVersion: 1, fonts }
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx', mode: 0o600 })

  let backedUp = false
  try {
    if (existsSync(file)) {
      if (existsSync(backup)) unlinkSync(backup)
      renameSync(file, backup)
      backedUp = true
    }
    renameSync(temp, file)
    if (backedUp && existsSync(backup)) unlinkSync(backup)
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp)
    if (backedUp && existsSync(backup) && !existsSync(file)) renameSync(backup, file)
    throw error
  }
}

function importOneFont(sourcePath: string): ManagedBurnFontEntry {
  if (!sourcePath || typeof sourcePath !== 'string') throw new Error('Đường dẫn font không hợp lệ.')
  const extension = extname(sourcePath).toLowerCase()
  if (extension !== '.ttf' && extension !== '.otf') throw new Error('Chỉ có thể thêm file .ttf hoặc .otf.')
  const sourceStat = lstatSync(sourcePath)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error('Font nguồn phải là một file thông thường, không phải liên kết.')
  }
  if (sourceStat.size <= 0 || sourceStat.size > MAX_FONT_BYTES) {
    throw new Error(`Font phải có dung lượng từ 1 byte đến ${MAX_FONT_BYTES} byte.`)
  }

  const buffer = readFileSync(sourcePath)
  const inspected = inspectFont(buffer)
  const id = `custom-${inspected.sha256.slice(0, 24)}`
  const existing = resolveBurnFont(id)
  if (existing) return existing.entry

  const customDir = resolveCustomFontsDir()
  const relativeFile = `${id}/font${extension}`
  const destination = safeChild(customDir, relativeFile, 'File font đích')
  mkdirSync(dirname(destination), { recursive: true })
  if (lstatSync(dirname(destination)).isSymbolicLink()) {
    throw new Error('Thư mục font đích không được là liên kết.')
  }
  assertRealPathInside(customDir, dirname(destination), 'Thư mục font đích')
  let created = false
  if (!existsSync(destination)) {
    atomicWriteNew(destination, buffer)
    created = true
  } else {
    if (!lstatSync(destination).isFile() || lstatSync(destination).isSymbolicLink()) {
      throw new Error('Đích import đã tồn tại nhưng không phải file thường.')
    }
    assertRealPathInside(customDir, destination, 'File font đích')
    if (sha256(readFileSync(destination)) !== inspected.sha256) {
      throw new Error('Đích import đã tồn tại nhưng chứa dữ liệu khác.')
    }
  }

  try {
    const current = readCustomManifest(true)
    const entry: CustomFontManifestEntry = {
      id,
      label: inspected.fullName,
      file: relativeFile.replace(/\\/g, '/'),
      family: inspected.family,
      group: 'Font của tôi',
      sha256: inspected.sha256,
      importedAt: new Date().toISOString()
    }
    const next = [...current.filter((font) => font.id !== id), entry].sort((a, b) =>
      a.label.localeCompare(b.label, 'vi')
    )
    writeCustomManifest(next)
    refreshBurnFontRegistry()
    const imported = resolveBurnFont(id)
    if (!imported) throw new Error('Không thể đăng ký font sau khi sao chép.')
    return imported.entry
  } catch (error) {
    if (created && existsSync(destination)) {
      unlinkSync(destination)
      try {
        rmdirSync(dirname(destination))
      } catch {
        // Thư mục không rỗng: giữ lại, không xóa đệ quy.
      }
    }
    throw error
  }
}

export interface BurnFontImportBatch {
  fonts: BurnFontEntry[]
  errors: string[]
}

/** Import best-effort và trả rõ cả file thành công lẫn thất bại để UI không bị lệch trạng thái. */
export async function importBurnFontFiles(paths: string[]): Promise<BurnFontImportBatch> {
  if (!Array.isArray(paths) || paths.length === 0) return { fonts: [], errors: [] }
  if (paths.length > 20) throw new Error('Mỗi lần chỉ có thể thêm tối đa 20 font.')
  const imported: ManagedBurnFontEntry[] = []
  const errors: string[] = []
  for (const sourcePath of paths) {
    try {
      imported.push(importOneFont(sourcePath))
    } catch (error) {
      const file = typeof sourcePath === 'string' ? basename(sourcePath) : 'File font'
      errors.push(`${file}: ${error instanceof Error ? error.message : 'Không thể thêm font.'}`)
    }
  }
  return { fonts: imported.map(cloneEntry), errors }
}

export async function removeCustomBurnFont(fontId: string): Promise<void> {
  const resolved = resolveBurnFont(fontId)
  if (!resolved) return
  if (resolved.entry.source !== 'custom') throw new Error('Không thể xóa font mặc định đi cùng T-blao.')

  const current = readCustomManifest(true)
  const target = current.find((font) => font.id === fontId)
  if (!target) return
  const next = current.filter((font) => font.id !== fontId)
  const customDir = resolveCustomFontsDir()
  const file = safeChild(customDir, target.file, 'File font cần xóa')
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
    throw new Error('Không xóa file font cá nhân vì đường dẫn không còn an toàn.')
  }
  assertRealPathInside(customDir, file, 'File font cần xóa')

  const quarantined = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.delete`
  renameSync(file, quarantined)
  try {
    writeCustomManifest(next)
    refreshBurnFontRegistry()
    try {
      unlinkSync(quarantined)
      rmdirSync(dirname(file))
    } catch (error) {
      // Manifest đã commit và file hoạt động đã biến mất; chỉ còn bản quarantine để dọn sau.
      warn(`Không thể dọn hoàn toàn file font đã xóa '${fontId}'`, error)
    }
  } catch (error) {
    if (existsSync(quarantined) && !existsSync(file)) renameSync(quarantined, file)
    refreshBurnFontRegistry()
    throw error
  }
}

/** Đường dẫn file .ttf/.otf để đo glyph (opentype). */
export function resolveFontFilePath(
  family: string | null | undefined,
  picked: BurnFontEntry | null
): string | null {
  if (picked) {
    const record = registry().byId.get(picked.id)
    if (record) return record.filePath
  }

  const normalizedFamily = (family || '').trim().toLocaleLowerCase('en-US')
  if (normalizedFamily) {
    const record = registry().records.find(
      (item) =>
        item.entry.family.toLocaleLowerCase('en-US') === normalizedFamily ||
        item.entry.label.toLocaleLowerCase('en-US') === normalizedFamily
    )
    if (record) return record.filePath
  }

  // Font hệ thống Windows cho chế độ tự động và tương thích cấu hình cũ.
  const winFonts = process.env.WINDIR ? join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts'
  const systemMap: Record<string, string[]> = {
    arial: ['arial.ttf', 'Arial.ttf'],
    'arial bold': ['arialbd.ttf'],
    'times new roman': ['times.ttf'],
    'microsoft yahei': ['msyh.ttc', 'msyh.ttf', 'MSYH.TTC'],
    'ms gothic': ['msgothic.ttc', 'msgothic.ttf'],
    'malgun gothic': ['malgun.ttf', 'malgun.ttc'],
    'leelawadee ui': ['LeelawadeeUI.ttf', 'leelawadeeui.ttf'],
    'nirmala ui': ['Nirmala.ttf', 'nirmala.ttf'],
    'segoe ui': ['segoeui.ttf', 'SegoeUI.ttf'],
    tahoma: ['tahoma.ttf'],
    verdana: ['verdana.ttf']
  }
  for (const file of systemMap[normalizedFamily] ?? []) {
    const candidate = join(winFonts, file)
    if (existsSync(candidate)) return candidate
  }

  for (const file of ['arial.ttf', 'Arial.ttf']) {
    const candidate = join(winFonts, file)
    if (existsSync(candidate)) return candidate
  }
  return resolveDefaultBurnFont()?.filePath ?? null
}

/** Escape path cho tham số filter ffmpeg (ass fontsdir=...). */
export function escapeFfmpegFilterPath(path: string): string {
  const escaped = path
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;')
    .replace(/'/g, "\\'")
  return `'${escaped}'`
}
