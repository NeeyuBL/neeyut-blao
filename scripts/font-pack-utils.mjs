import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'

export const scriptsDir = dirname(fileURLToPath(import.meta.url))
export const projectRoot = join(scriptsDir, '..')
export const sourceFontsDir = join(projectRoot, 'resources', 'fonts')
export const manifestName = 'manifest.json'
export const catalogName = 'catalog.json'
export const maxFontBytes = 64 * 1024 * 1024

const sha256Pattern = /^[a-f0-9]{64}$/
const fontExtensionPattern = /\.(?:ttf|otf)$/i

export function fail(message) {
  throw new Error(`[font-pack] ${message}`)
}

export function assertSafeRelativePath(baseDir, value, label = 'path') {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`)
  if (isAbsolute(value) || value.includes('\0')) fail(`${label} must be relative: ${value}`)

  const base = resolve(baseDir)
  const target = resolve(base, value)
  const rel = relative(base, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    fail(`${label} leaves its font directory: ${value}`)
  }
  return target
}

export function readManifest(fontsDir = sourceFontsDir) {
  const file = join(fontsDir, manifestName)
  if (!existsSync(file)) fail(`missing ${file}`)

  let manifest
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail(`${manifestName} must contain an object`)
  }
  if (manifest.schemaVersion !== 1) fail(`unsupported manifest schema: ${manifest.schemaVersion}`)
  if (typeof manifest.packVersion !== 'string' || !manifest.packVersion.trim()) {
    fail('packVersion is required')
  }
  if (!Array.isArray(manifest.fonts) || manifest.fonts.length === 0) {
    fail('manifest must contain at least one bundled font')
  }
  if (typeof manifest.defaultFontId !== 'string' || !manifest.defaultFontId.trim()) {
    fail('defaultFontId is required')
  }
  if (typeof manifest.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) {
    fail('sourceCommit must be a full 40-character Git commit SHA')
  }
  return manifest
}

export function validateManifestEntries(manifest, fontsDir = sourceFontsDir) {
  const ids = new Set()
  const files = new Set()
  const entries = []

  for (const [index, raw] of manifest.fonts.entries()) {
    const where = `fonts[${index}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${where} must be an object`)

    for (const field of [
      'id',
      'label',
      'family',
      'file',
      'group',
      'sha256',
      'license',
      'licenseFile',
      'noticeFile',
      'copyright',
      'sourceUrl'
    ]) {
      if (typeof raw[field] !== 'string' || !raw[field].trim()) fail(`${where}.${field} is required`)
    }
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(raw.id)) fail(`${where}.id is not safe: ${raw.id}`)
    if (ids.has(raw.id)) fail(`duplicate font id: ${raw.id}`)
    ids.add(raw.id)

    if (!fontExtensionPattern.test(raw.file) || basename(raw.file) !== raw.file) {
      fail(`${where}.file must be one .ttf/.otf filename: ${raw.file}`)
    }
    if (files.has(raw.file.toLowerCase())) fail(`duplicate font filename: ${raw.file}`)
    files.add(raw.file.toLowerCase())

    if (!sha256Pattern.test(raw.sha256)) fail(`${where}.sha256 must be lowercase SHA-256`)
    if (raw.license !== 'OFL-1.1') fail(`${where}.license must be OFL-1.1 for the bundled pack`)
    const licensePath = assertSafeRelativePath(fontsDir, raw.licenseFile, `${where}.licenseFile`)
    if (!raw.licenseFile.startsWith('licenses/')) fail(`${where}.licenseFile must be inside licenses/`)
    const noticePath = assertSafeRelativePath(fontsDir, raw.noticeFile, `${where}.noticeFile`)
    if (!raw.noticeFile.startsWith('licenses/')) fail(`${where}.noticeFile must be inside licenses/`)

    let source
    try {
      source = new URL(raw.sourceUrl)
    } catch {
      fail(`${where}.sourceUrl is not a URL`)
    }
    if (source.protocol !== 'https:' || source.hostname !== 'raw.githubusercontent.com') {
      fail(`${where}.sourceUrl must use pinned raw.githubusercontent.com HTTPS`)
    }
    const sourceParts = source.pathname.split('/').filter(Boolean)
    if (sourceParts.length < 4 || !/^[a-f0-9]{40}$/.test(sourceParts[2] ?? '')) {
      fail(`${where}.sourceUrl must contain a full 40-character commit SHA`)
    }
    if (sourceParts[2] !== manifest.sourceCommit) {
      fail(`${where}.sourceUrl does not match manifest sourceCommit`)
    }

    if (!Array.isArray(raw.requiredCodepoints) || raw.requiredCodepoints.length === 0) {
      fail(`${where}.requiredCodepoints must contain representative glyphs`)
    }
    for (const cp of raw.requiredCodepoints) {
      if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) {
        fail(`${where}.requiredCodepoints contains an invalid codepoint`)
      }
    }

    entries.push({ ...raw, licensePath, noticePath })
  }

  if (!ids.has(manifest.defaultFontId)) {
    fail(`defaultFontId does not match a bundled font: ${manifest.defaultFontId}`)
  }
  return entries
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function sha256File(file) {
  return sha256Buffer(readFileSync(file))
}

function englishName(font, key) {
  const names = font?.names
  return (
    names?.windows?.[key]?.en ??
    names?.macintosh?.[key]?.en ??
    names?.unicode?.[key]?.en ??
    names?.[key]?.en ??
    null
  )
}

export function inspectFontFile(file) {
  const stats = statSync(file)
  if (!stats.isFile()) fail(`not a regular font file: ${file}`)
  if (stats.size <= 0 || stats.size > maxFontBytes) {
    fail(`font size is outside 1-${maxFontBytes} bytes: ${file}`)
  }

  const buffer = readFileSync(file)
  const signature = buffer.subarray(0, 4).toString('latin1')
  const isTrueType = buffer.length >= 4 && buffer.readUInt32BE(0) === 0x00010000
  if (!isTrueType && signature !== 'OTTO' && signature !== 'true') {
    fail(`unsupported or damaged TTF/OTF header: ${file}`)
  }

  let font
  try {
    const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    font = opentype.parse(data)
  } catch (error) {
    fail(`cannot parse font ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const family = englishName(font, 'preferredFamily') || englishName(font, 'fontFamily')
  const fullName = englishName(font, 'fullName') || family
  if (!family) fail(`font has no readable family metadata: ${file}`)
  return { buffer, font, family, fullName }
}

export function catalogFromManifest(manifest) {
  return manifest.fonts.map((font) => ({
    id: font.id,
    label: font.label,
    file: font.file,
    family: font.family,
    group: font.group,
    source: 'bundled',
    available: true
  }))
}

export function verifyFontDirectory(fontsDir, { requireExactBinaries = false } = {}) {
  const manifest = readManifest(fontsDir)
  const entries = validateManifestEntries(manifest, fontsDir)
  const expectedFiles = new Set(entries.map((entry) => entry.file.toLowerCase()))

  for (const entry of entries) {
    const file = assertSafeRelativePath(fontsDir, entry.file, `font ${entry.id}`)
    if (!existsSync(file)) fail(`missing bundled font: ${entry.file}`)
    const actualHash = sha256File(file)
    if (actualHash !== entry.sha256) {
      fail(`checksum mismatch for ${entry.file}: expected ${entry.sha256}, got ${actualHash}`)
    }
    if (!existsSync(entry.licensePath) || statSync(entry.licensePath).size < 1000) {
      fail(`missing or incomplete license for ${entry.id}: ${entry.licenseFile}`)
    }
    if (!existsSync(entry.noticePath) || statSync(entry.noticePath).size < 100) {
      fail(`missing or incomplete copyright notice for ${entry.id}: ${entry.noticeFile}`)
    }

    const inspected = inspectFontFile(file)
    if (inspected.family !== entry.family) {
      fail(`family mismatch for ${entry.file}: manifest '${entry.family}', font '${inspected.family}'`)
    }
    for (const codepoint of entry.requiredCodepoints) {
      const glyphIndex = inspected.font.charToGlyphIndex(String.fromCodePoint(codepoint))
      if (!glyphIndex) {
        fail(`${entry.file} does not contain required glyph U+${codepoint.toString(16).toUpperCase()}`)
      }
    }
  }

  const expectedCatalog = `${JSON.stringify(catalogFromManifest(manifest), null, 2)}\n`
  const catalogPath = join(fontsDir, catalogName)
  if (!existsSync(catalogPath)) fail(`missing ${catalogName}`)
  if (readFileSync(catalogPath, 'utf8') !== expectedCatalog) {
    fail(`${catalogName} is not synchronized with ${manifestName}; run npm run fonts:prepare`)
  }

  if (requireExactBinaries) {
    const actual = []
    const queue = [{ dir: fontsDir, prefix: '' }]
    while (queue.length) {
      const current = queue.shift()
      if (!current) continue
      for (const item of readdirSync(current.dir, { withFileTypes: true })) {
        const rel = current.prefix ? `${current.prefix}/${item.name}` : item.name
        if (item.isDirectory()) queue.push({ dir: join(current.dir, item.name), prefix: rel })
        else if (item.isFile() && fontExtensionPattern.test(item.name)) actual.push(rel.toLowerCase())
      }
    }
    actual.sort()
    const expected = [...expectedFiles].sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`packaged font binaries differ from manifest (expected ${expected.length}, found ${actual.length})`)
    }
  }

  return { manifest, entries }
}

export function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

export function totalFontBytes(fontsDir, entries) {
  return entries.reduce((sum, entry) => sum + statSync(join(fontsDir, entry.file)).size, 0)
}
