/** Wrap phu de theo chieu rong px — dung chung burn ASS + preview UI. */

const CJK_CHAR =
  /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fa5\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/

export type MeasureFn = (text: string) => number

/**
 * true = wrap giua ky tu (CJK).
 * Chi khi cau co chu CJK (Han/Kana/Hangul) VA khong co khoang trang.
 */
export function cueUsesCjkWrap(text: string): boolean {
  const flat = text.replace(/\\N/g, '')
  if (!flat) return false
  if (/\s/.test(flat)) return false
  return CJK_CHAR.test(flat)
}

/** Uoc luong px khi khong do duoc font (fallback). */
export function estimateTextWidthPx(text: string, fontSizePx: number): number {
  let w = 0
  for (const c of text) {
    w += CJK_CHAR.test(c) ? fontSizePx : fontSizePx * 0.5
  }
  return w
}

function wrapCjkPx(text: string, maxWidthPx: number, measure: MeasureFn): string {
  const chars = Array.from(text)
  const lines: string[] = []
  let currentLine = ''

  for (const char of chars) {
    const next = currentLine + char
    if (currentLine && measure(next) > maxWidthPx) {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine = next
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines.join('\\N')
}

function softBreakWordPx(word: string, maxWidthPx: number, measure: MeasureFn): string[] {
  const chars = Array.from(word)
  const chunks: string[] = []
  let cur = ''
  for (const char of chars) {
    const next = cur + char
    if (cur && measure(next) > maxWidthPx) {
      chunks.push(cur)
      cur = char
    } else {
      cur = next
    }
  }
  if (cur) chunks.push(cur)
  return chunks.length ? chunks : [word]
}

function wrapWordsPx(text: string, maxWidthPx: number, measure: MeasureFn): string {
  const words = text.split(/ +/).filter((w) => w.length > 0)
  const lines: string[] = []
  let currentLine = ''

  const pushLine = (): void => {
    if (currentLine) lines.push(currentLine)
    currentLine = ''
  }

  for (const word of words) {
    if (measure(word) > maxWidthPx) {
      pushLine()
      for (const chunk of softBreakWordPx(word, maxWidthPx, measure)) {
        lines.push(chunk)
      }
      continue
    }
    const next = currentLine ? `${currentLine} ${word}` : word
    if (currentLine && measure(next) > maxWidthPx) {
      pushLine()
      currentLine = word
    } else {
      currentLine = next
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines.join('\\N')
}

/**
 * Ngat dong theo maxWidthPx (pixel video / cung he preview).
 * measure(text) tra ve do rong px that (canvas / opentype / fallback).
 */
export function ngatDongTheoPx(
  text: string,
  maxWidthPx: number,
  measure: MeasureFn,
  useCjkWrap: boolean
): string {
  if (!text) return ''
  const limit = Math.max(8, maxWidthPx)
  const segments = text.split('\\N')
  const wrapped = segments.map((seg) => {
    const t = seg.trim()
    if (!t) return ''
    return useCjkWrap ? wrapCjkPx(t, limit, measure) : wrapWordsPx(t, limit, measure)
  })
  return wrapped.filter((s) => s.length > 0).join('\\N')
}

/** Co chu ASS tu chieu cao khung phu de (giong boCuc). */
export function fontSizeFromSubBox(boxHeight: number): number {
  return Math.max(14, Math.round(boxHeight * 0.7))
}

/** Be rong dung de wrap: tru 2*pad khi co nen hop. */
export function wrapWidthFromBox(boxWidthPx: number, boxPadPx = 0): number {
  return Math.max(8, boxWidthPx - 2 * Math.max(0, boxPadPx))
}
