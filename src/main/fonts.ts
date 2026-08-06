import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { BurnFontEntry } from '../shared/types'

let cached: BurnFontEntry[] | null = null
let cachedDir: string | null = null

/** Thu muc font dong goi (dev: resources/fonts, packaged: resources/fonts). */
export function resolveFontsDir(): string | null {
  if (cachedDir && existsSync(cachedDir)) return cachedDir

  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'fonts'))
  } else {
    // electron-vite: getAppPath() thuong la thu muc project
    candidates.push(join(app.getAppPath(), 'resources', 'fonts'))
    // Fallback: tu out/main -> ../../resources/fonts
    candidates.push(join(__dirname, '..', '..', 'resources', 'fonts'))
  }

  for (const dir of candidates) {
    if (existsSync(join(dir, 'catalog.json'))) {
      cachedDir = dir
      return dir
    }
  }
  return null
}

function pathToTblaoUrl(absPath: string): string {
  const b64 = Buffer.from(absPath, 'utf8').toString('base64url')
  return `tblao://b64/${b64}`
}

export function listBurnFonts(): BurnFontEntry[] {
  if (cached) return cached
  const dir = resolveFontsDir()
  if (!dir) {
    cached = []
    return cached
  }
  try {
    const raw = readFileSync(join(dir, 'catalog.json'), 'utf8')
    const parsed = JSON.parse(raw) as BurnFontEntry[]
    const list = Array.isArray(parsed) ? parsed : []
    cached = list.map((f) => {
      const abs = join(dir, f.file)
      return {
        ...f,
        previewUrl: existsSync(abs) ? pathToTblaoUrl(abs) : undefined
      }
    })
  } catch {
    cached = []
  }
  return cached
}

export function findBurnFont(fontId: string | null | undefined): BurnFontEntry | null {
  if (!fontId || fontId === 'auto') return null
  return listBurnFonts().find((f) => f.id === fontId) ?? null
}

/** Escape path cho tham so filter ffmpeg (ass fontsdir=...).
 *  Phai boc trong '...' — neu khong, dau : o dia Windows (D:) bi FFmpeg
 *  coi la separator option -> Invalid argument. */
export function escapeFfmpegFilterPath(p: string): string {
  const escaped = p
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;')
    .replace(/'/g, "\\'")
  return `'${escaped}'`
}
