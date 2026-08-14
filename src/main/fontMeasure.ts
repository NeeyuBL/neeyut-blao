import { readFileSync } from 'node:fs'
import opentype from 'opentype.js'
import { estimateTextWidthPx, type MeasureFn } from '../shared/subWrap'
import { resolveFontFilePath } from './fonts'
import type { BurnFontEntry } from '../shared/types'

const parsedFontCache = new Map<string, opentype.Font>()

/**
 * Tao ham do rong chu (px) bang opentype; fallback uoc luong neu khong load duoc font.
 * Luu y: .ttc (collection) opentype.js thuong khong parse — se fallback.
 */
export function createTextMeasurer(
  fontSizePx: number,
  family: string | null | undefined,
  picked: BurnFontEntry | null
): MeasureFn {
  // Font lookup can be unavailable in isolated tests or during very early
  // startup; measurement must still have a deterministic fallback.
  let path: string | null = null
  try {
    path = resolveFontFilePath(family, picked)
  } catch {
    path = null
  }
  if (path) {
    try {
      let font = parsedFontCache.get(path)
      if (!font) {
        const buf = readFileSync(path)
        font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        parsedFontCache.set(path, font)
      }
      return (text: string): number => {
        if (!text) return 0
        try {
          const missingGlyph = Array.from(text).some(
            (char) => !/\s/u.test(char) && font.charToGlyphIndex(char) === 0
          )
          if (missingGlyph) return estimateTextWidthPx(text, fontSizePx)
          return font.getAdvanceWidth(text, fontSizePx)
        } catch {
          return estimateTextWidthPx(text, fontSizePx)
        }
      }
    } catch {
      /* fallback below */
    }
  }
  return (text: string): number => estimateTextWidthPx(text, fontSizePx)
}
