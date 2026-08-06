import { readFileSync } from 'node:fs'
import opentype from 'opentype.js'
import { estimateTextWidthPx, type MeasureFn } from '../shared/subWrap'
import { resolveFontFilePath } from './fonts'
import type { BurnFontEntry } from '../shared/types'

/**
 * Tao ham do rong chu (px) bang opentype; fallback uoc luong neu khong load duoc font.
 * Luu y: .ttc (collection) opentype.js thuong khong parse — se fallback.
 */
export function createTextMeasurer(
  fontSizePx: number,
  family: string | null | undefined,
  picked: BurnFontEntry | null
): MeasureFn {
  const path = resolveFontFilePath(family, picked)
  if (path) {
    try {
      const buf = readFileSync(path)
      const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      return (text: string): number => {
        if (!text) return 0
        try {
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
