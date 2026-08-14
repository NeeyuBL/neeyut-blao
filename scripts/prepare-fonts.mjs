import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  assertSafeRelativePath,
  catalogFromManifest,
  maxFontBytes,
  readManifest,
  sha256Buffer,
  sha256File,
  sourceFontsDir,
  validateManifestEntries
} from './font-pack-utils.mjs'

function atomicWrite(file, data) {
  mkdirSync(sourceFontsDir, { recursive: true })
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temp, data, { flag: 'wx' })
  try {
    renameSync(temp, file)
  } catch (error) {
    // Windows does not consistently replace an existing file with rename(). The
    // payload is already verified and this command runs before packaging.
    try {
      rmSync(file, { force: true })
      renameSync(temp, file)
    } catch {
      rmSync(temp, { force: true })
      throw error
    }
  }
}

async function fetchPinnedFont(entry) {
  const response = await fetch(entry.sourceUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: { 'user-agent': 'T-blao-font-pack/1' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} while downloading ${entry.id}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length <= 0 || buffer.length > maxFontBytes) {
    throw new Error(`downloaded font ${entry.id} has invalid size ${buffer.length}`)
  }
  const actual = sha256Buffer(buffer)
  if (actual !== entry.sha256) {
    throw new Error(`checksum mismatch for ${entry.id}: expected ${entry.sha256}, got ${actual}`)
  }
  return buffer
}

async function main() {
  const manifest = readManifest(sourceFontsDir)
  const entries = validateManifestEntries(manifest, sourceFontsDir)
  mkdirSync(sourceFontsDir, { recursive: true })

  let downloaded = 0
  for (const entry of entries) {
    const destination = assertSafeRelativePath(sourceFontsDir, entry.file, `font ${entry.id}`)
    if (existsSync(destination) && sha256File(destination) === entry.sha256) {
      console.log(`[font-pack] ready: ${entry.file}`)
      continue
    }

    console.log(`[font-pack] downloading pinned OFL font: ${entry.label}`)
    const buffer = await fetchPinnedFont(entry)
    atomicWrite(destination, buffer)
    downloaded += 1
  }

  const catalog = `${JSON.stringify(catalogFromManifest(manifest), null, 2)}\n`
  const catalogPath = join(sourceFontsDir, 'catalog.json')
  if (!existsSync(catalogPath) || readFileSync(catalogPath, 'utf8') !== catalog) {
    atomicWrite(catalogPath, catalog)
  }

  console.log(
    `[font-pack] prepared ${entries.length} bundled fonts (${downloaded} downloaded), pack ${manifest.packVersion}`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
