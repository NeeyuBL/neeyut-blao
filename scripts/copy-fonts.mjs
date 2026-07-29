/**
 * Copy curated subtitle fonts from font/ -> resources/fonts/
 * and write catalog.json with ASS Fontname (family) per file.
 *
 * Usage: node scripts/copy-fonts.mjs
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const srcDir = join(root, 'font')
const destDir = join(root, 'resources', 'fonts')

/** @type {Array<{ file: string, group: string, label?: string }>} */
const FONTS = [
  // Latin
  { file: 'arial.ttf', group: 'Latin', label: 'Arial' },
  { file: 'arialbd.ttf', group: 'Latin', label: 'Arial Bold' },
  { file: 'times.ttf', group: 'Latin', label: 'Times New Roman' },
  { file: 'timesbd.ttf', group: 'Latin', label: 'Times New Roman Bold' },
  { file: 'verdana.ttf', group: 'Latin', label: 'Verdana' },
  { file: 'verdanab.ttf', group: 'Latin', label: 'Verdana Bold' },
  { file: 'georgia.ttf', group: 'Latin', label: 'Georgia' },
  { file: 'georgiab.ttf', group: 'Latin', label: 'Georgia Bold' },
  { file: 'tahoma.ttf', group: 'Latin', label: 'Tahoma' },
  { file: 'tahomabd.ttf', group: 'Latin', label: 'Tahoma Bold' },
  { file: 'impact.ttf', group: 'Latin', label: 'Impact' },
  // UTM
  { file: 'UTM Avo.ttf', group: 'UTM' },
  { file: 'UTM AvoBold.ttf', group: 'UTM' },
  { file: 'UTM Aptima.ttf', group: 'UTM' },
  { file: 'UTM AptimaBold.ttf', group: 'UTM' },
  { file: 'UTM Helvetins.ttf', group: 'UTM' },
  { file: 'UTM Neo Sans Intel.ttf', group: 'UTM' },
  { file: 'UTM Neo Sans IntelBold.ttf', group: 'UTM' },
  { file: 'UTM Facebook.ttf', group: 'UTM' },
  { file: 'UTM Bebas.ttf', group: 'UTM' },
  { file: 'UTM Times.ttf', group: 'UTM' },
  { file: 'UTM Centur.ttf', group: 'UTM' },
  { file: 'UTM Caviar.ttf', group: 'UTM' },
  { file: 'UTM Micra.ttf', group: 'UTM' },
  { file: 'UTM American Sans.ttf', group: 'UTM' },
  { file: 'UTM Amerika Sans.ttf', group: 'UTM' },
  { file: 'UTM BryantLG.ttf', group: 'UTM' },
  { file: 'UTM Nokia.ttf', group: 'UTM' },
  { file: 'UTM Neutra.ttf', group: 'UTM' },
  { file: 'UTM Swiss 721 Black Condensed.ttf', group: 'UTM' },
  { file: 'UTM Eremitage.ttf', group: 'UTM' },
  { file: 'UTM Flamenco.ttf', group: 'UTM' },
  { file: 'UTM Alexander.ttf', group: 'UTM' },
  { file: 'UTM Aurora.ttf', group: 'UTM' },
  { file: 'UTM Bienvenue.ttf', group: 'UTM' },
  { file: 'UTM Cookies.ttf', group: 'UTM' },
  { file: 'UTM Nyala.ttf', group: 'UTM' },
  { file: 'UTM Ong Do Gia.ttf', group: 'UTM' },
  { file: 'UTM Ong Do Tre.ttf', group: 'UTM' },
  { file: 'UTM Mabella.ttf', group: 'UTM' },
  // UVF
  { file: 'UVF Chopin Script.ttf', group: 'UVF' },
  { file: 'UVF Fiolex Girl.ttf', group: 'UVF' },
  { file: 'UVF SlimTony.ttf', group: 'UVF' },
  { file: 'UVF Voyage Regular.otf', group: 'UVF' },
  { file: 'UVF BellissimaScriptPro.otf', group: 'UVF' },
  { file: 'UVF Breathe Pro.otf', group: 'UVF' },
  { file: 'UVF You Make Me Smile.ttf', group: 'UVF' },
  { file: 'UVF Funkydori.ttf', group: 'UVF' },
  { file: 'UVF memoriam.ttf', group: 'UVF' },
  // UVN
  { file: 'UVNBaiHoc.TTF', group: 'UVN' },
  { file: 'UVNChinhLuan_R.TTF', group: 'UVN' },
  { file: 'UVNNhatKy_R.TTF', group: 'UVN' },
  { file: 'UVNSaigon_I.TTF', group: 'UVN' },
  { file: 'UVNGiaDinh_I.TTF', group: 'UVN' },
  { file: 'UVNGiaDinhHep_R.TTF', group: 'UVN' },
  { file: 'UVNAnhHaiNhe_I.TTF', group: 'UVN' },
  { file: 'UVNBachTuyet_I.TTF', group: 'UVN' },
  // VNF
  { file: 'VNF-Aire Roman Std.ttf', group: 'VNF' },
  { file: 'VNF-Narziss Regular.ttf', group: 'VNF' },
  { file: 'VNF-Valentina.ttf', group: 'VNF' },
  // SVN
  { file: 'SVN-Avo.ttf', group: 'SVN' },
  { file: 'SVN-Avo bold.ttf', group: 'SVN' },
  { file: 'SVN-Aptima.ttf', group: 'SVN' },
  { file: 'SVN-Aptima bold.ttf', group: 'SVN' },
  { file: 'SVN-Helvetica Neue Regular.ttf', group: 'SVN' },
  { file: 'SVN-Helvetica Neue Bold.ttf', group: 'SVN' },
  { file: 'SVN-Helves.ttf', group: 'SVN' },
  { file: 'SVN-Helves bold.ttf', group: 'SVN' },
  { file: 'SVN-Book Antiqua.ttf', group: 'SVN' },
  { file: 'SVN-Book Antiqua bold.ttf', group: 'SVN' },
  { file: 'SVN-Lobster.ttf', group: 'SVN' },
  { file: 'SVN-Dancing script.ttf', group: 'SVN' },
  { file: 'SVN-Cookie.ttf', group: 'SVN' },
  { file: 'SVN-Sofia.ttf', group: 'SVN' },
  { file: 'SVN-Agency FB.ttf', group: 'SVN' },
  { file: 'SVN-Agency FB Bold.ttf', group: 'SVN' },
  { file: 'SVN-Titillium medium.ttf', group: 'SVN' },
  { file: 'SVN-Titillium bold.ttf', group: 'SVN' },
  { file: 'SVN-The Voice Regular.ttf', group: 'SVN' },
  { file: 'SVN-Linux Libertine regular.ttf', group: 'SVN' },
  { file: 'SVN-Sansation.ttf', group: 'SVN' },
  { file: 'SVN-Rounded.ttf', group: 'SVN' },
  { file: 'SVN-Comic Sans MS.ttf', group: 'SVN' },
  { file: 'SVN-Yahoo.ttf', group: 'SVN' },
  // iCiel
  { file: 'iCiel Rukola.ttf', group: 'iCiel' },
  { file: 'iCielAmerigraf.ttf', group: 'iCiel' }
]

/**
 * Minimal TTF/OTF name-table reader. Prefers Full name (id 4), else Family (id 1).
 * @param {string} path
 * @returns {string | null}
 */
function readFontFamily(path) {
  try {
    const buf = readFileSync(path)
    if (buf.length < 12) return null
    const tag = buf.toString('ascii', 0, 4)
    let tablesOffset = 12
    let numTables = buf.readUInt16BE(4)

    // WOFF not supported; TTC: use first font
    if (tag === 'ttcf') {
      const numFonts = buf.readUInt32BE(8)
      if (numFonts < 1) return null
      const offset = buf.readUInt32BE(12)
      if (offset + 12 > buf.length) return null
      numTables = buf.readUInt16BE(offset + 4)
      tablesOffset = offset + 12
    } else if (tag !== 'OTTO' && tag !== '\x00\x01\x00\x00' && tag !== 'true') {
      return null
    }

    let nameOffset = 0
    let nameLength = 0
    for (let i = 0; i < numTables; i++) {
      const o = tablesOffset + i * 16
      if (o + 16 > buf.length) break
      const name = buf.toString('ascii', o, o + 4)
      if (name === 'name') {
        nameOffset = buf.readUInt32BE(o + 8)
        nameLength = buf.readUInt32BE(o + 12)
        break
      }
    }
    if (!nameOffset || nameOffset + 6 > buf.length) return null

    const format = buf.readUInt16BE(nameOffset)
    const count = buf.readUInt16BE(nameOffset + 2)
    const stringOffset = buf.readUInt16BE(nameOffset + 4)
    const storage = nameOffset + stringOffset

    /** @type {Map<number, string>} */
    const names = new Map()

    for (let i = 0; i < count; i++) {
      const rec = nameOffset + 6 + i * 12
      if (rec + 12 > buf.length) break
      const platformID = buf.readUInt16BE(rec)
      const encodingID = buf.readUInt16BE(rec + 2)
      const languageID = buf.readUInt16BE(rec + 4)
      const nameID = buf.readUInt16BE(rec + 6)
      const length = buf.readUInt16BE(rec + 8)
      const offset = buf.readUInt16BE(rec + 10)
      if (nameID !== 1 && nameID !== 4) continue
      const start = storage + offset
      if (start + length > buf.length) continue

      let text = ''
      if (platformID === 3 || (platformID === 0 && encodingID !== 0)) {
        // UTF-16 BE
        for (let j = 0; j + 1 < length; j += 2) {
          text += String.fromCharCode(buf.readUInt16BE(start + j))
        }
      } else {
        text = buf.toString('latin1', start, start + length)
      }
      text = text.replace(/\0/g, '').trim()
      if (!text) continue

      // Prefer Windows English (platform 3, lang 0x0409), else any
      const score =
        (platformID === 3 && languageID === 0x0409 ? 100 : platformID === 3 ? 50 : 10) +
        (nameID === 4 ? 2 : 0)
      const prev = names.get(nameID)
      const prevScore = names.get(nameID + 1000) ?? 0
      if (!prev || score > prevScore) {
        names.set(nameID, text)
        names.set(nameID + 1000, score)
      }
    }

    void format
    void nameLength
    return names.get(4) || names.get(1) || null
  } catch {
    return null
  }
}

function slugId(file) {
  return basename(file, extname(file))
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
}

function defaultLabel(file) {
  return basename(file, extname(file))
}

if (!existsSync(srcDir)) {
  console.error('Missing source folder:', srcDir)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })

// Remove previously copied font binaries (keep catalog rewrite fresh)
for (const f of readdirSync(destDir)) {
  if (/\.(ttf|otf|TTF|OTF)$/i.test(f) || f === 'catalog.json') {
    // will overwrite catalog; delete old fonts not in list after
  }
}

const catalog = []
const missing = []
const keep = new Set()

for (const entry of FONTS) {
  const src = join(srcDir, entry.file)
  if (!existsSync(src)) {
    missing.push(entry.file)
    continue
  }
  const dest = join(destDir, entry.file)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  keep.add(entry.file)

  const family = readFontFamily(dest) || defaultLabel(entry.file)
  const id = slugId(entry.file)
  catalog.push({
    id,
    label: entry.label || defaultLabel(entry.file),
    file: entry.file,
    family,
    group: entry.group
  })
}

// Drop orphaned font files in dest not in keep
for (const f of readdirSync(destDir)) {
  if (/\.(ttf|otf)$/i.test(f) && !keep.has(f)) {
    try {
      unlinkSync(join(destDir, f))
    } catch {
      /* ignore */
    }
  }
}

writeFileSync(join(destDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n', 'utf8')

console.log(`Copied ${catalog.length} fonts -> ${destDir}`)
if (missing.length) {
  console.error('Missing:', missing.join(', '))
  process.exit(1)
}
