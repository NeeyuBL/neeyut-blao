/** Wrap phu de: dung chung burn ASS + preview UI. */

const CJK_CHAR =
  /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fa5\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/

function charUnit(char: string): number {
  return CJK_CHAR.test(char) ? 1.0 : 0.5
}

function unitsOf(text: string): number {
  let n = 0
  for (const c of text) n += charUnit(c)
  return n
}

/**
 * Wrap theo ky tu (CJK thuần, khong space).
 * Chi dung khi cueUsesCjkWrap === true.
 */
function wrapCjk(text: string, maxUnits: number): string {
  const chars = Array.from(text)
  const lines: string[] = []
  let currentLine = ''
  let currentUnits = 0

  for (const char of chars) {
    const u = charUnit(char)
    if (currentUnits + u > maxUnits && currentLine) {
      lines.push(currentLine)
      currentLine = char
      currentUnits = u
    } else {
      currentLine += char
      currentUnits += u
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines.join('\\N')
}

/** Cat mem 1 tu dai hon maxUnits (Latin / Viet). */
function softBreakWord(word: string, maxUnits: number): string[] {
  const chars = Array.from(word)
  const chunks: string[] = []
  let cur = ''
  let curU = 0
  for (const char of chars) {
    const u = charUnit(char)
    if (curU + u > maxUnits && cur) {
      chunks.push(cur)
      cur = char
      curU = u
    } else {
      cur += char
      curU += u
    }
  }
  if (cur) chunks.push(cur)
  return chunks.length ? chunks : [word]
}

/** Wrap theo khoang trang; tu qua dai thi soft-break. */
function wrapWords(text: string, maxUnits: number): string {
  const words = text.split(/ +/).filter((w) => w.length > 0)
  const lines: string[] = []
  let currentLine = ''
  let currentUnits = 0

  const pushLine = (): void => {
    if (currentLine) lines.push(currentLine)
    currentLine = ''
    currentUnits = 0
  }

  for (const word of words) {
    const wordUnits = unitsOf(word)
    if (wordUnits > maxUnits) {
      pushLine()
      for (const chunk of softBreakWord(word, maxUnits)) {
        lines.push(chunk)
      }
      continue
    }
    const spaceUnit = currentLine ? 0.5 : 0
    if (currentUnits + spaceUnit + wordUnits > maxUnits && currentLine) {
      pushLine()
      currentLine = word
      currentUnits = wordUnits
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word
      currentUnits += spaceUnit + wordUnits
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines.join('\\N')
}

/**
 * true = wrap giua ky tu (CJK).
 * Chi khi cau co chu CJK (Han/Kana/Hangul) VA khong co khoang trang.
 * Co space (Viet/Latin/Han co cach) -> wrap theo tu.
 */
export function cueUsesCjkWrap(text: string): boolean {
  const flat = text.replace(/\\N/g, '')
  if (!flat) return false
  if (/\s/.test(flat)) return false
  return CJK_CHAR.test(flat)
}

/**
 * Ngat dong theo do rong tuong doi (maxUnits).
 * Doan da co \\N trong SRT duoc wrap rieng tung doan roi ghep lai.
 */
export function ngatDongTheoDoRong(text: string, maxUnits: number, isCJK: boolean): string {
  if (!text) return ''
  const limit = Math.max(1, maxUnits)
  const segments = text.split('\\N')
  const wrapped = segments.map((seg) => {
    const t = seg.trim()
    if (!t) return ''
    return isCJK ? wrapCjk(t, limit) : wrapWords(t, limit)
  })
  return wrapped.filter((s) => s.length > 0).join('\\N')
}

/** maxUnits giong burn: (boxWidth / fontSize) - 0.5 */
export function maxUnitsFromBox(boxWidth: number, fontSize: number): number {
  if (boxWidth <= 0 || fontSize <= 0) return 8
  return Math.max(8, boxWidth / fontSize - 0.5)
}

/** Co chu ASS tu chieu cao khung phu de (giong boCuc). */
export function fontSizeFromSubBox(boxHeight: number): number {
  return Math.max(14, Math.round(boxHeight * 0.7))
}
