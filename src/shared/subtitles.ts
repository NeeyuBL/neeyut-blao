import type { SubtitleCue as SharedSubtitleCue } from './types'

/** Canonical cue type; times are seconds and text never contains ASS tags. */
export type SubtitleCue = SharedSubtitleCue

export interface SubtitleParseWarning {
  line: number
  message: string
}

export interface SubtitleParseResult {
  cues: SubtitleCue[]
  warnings: SubtitleParseWarning[]
}

export type AutomaticSubtitleFontId =
  | 'noto-sans'
  | 'noto-sans-arabic'
  | 'noto-sans-thai'
  | 'noto-sans-kr'

/** Chọn cùng một font bundled cho preview và burn dựa trên script xuất hiện trong SRT. */
export function automaticSubtitleFontId(text: string): AutomaticSubtitleFontId | null {
  if (/[\u0600-\u06ff]/u.test(text)) return 'noto-sans-arabic'
  if (/[\u0e00-\u0e7f]/u.test(text)) return 'noto-sans-thai'
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text)) return 'noto-sans-kr'
  if (/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u.test(text)) return 'noto-sans'
  return null
}

const TIMING_LINE =
  /^\s*(\d{1,4}:\d{1,2}:\d{1,2}[,.]\d{1,3})\s*-->\s*(\d{1,4}:\d{1,2}:\d{1,2}[,.]\d{1,3})(?:\s+.*)?$/

/** Parse an SRT timestamp. Returns null instead of silently turning bad input into 0. */
export function parseSubtitleTimestamp(value: string): number | null {
  const match = /^(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (minutes > 59 || seconds > 59) return null

  // SRT fractions are decimal fractions: ,7 = 700 ms; ,70 = 700 ms.
  const millis = Number(match[4].padEnd(3, '0'))
  return hours * 3600 + minutes * 60 + seconds + millis / 1000
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** Format numeric seconds as a canonical SRT timestamp. */
export function formatSrtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const secs = Math.floor((totalMs % 60_000) / 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(totalMs % 1000, 3)}`
}

/** Format numeric seconds as an ASS timestamp, carrying rounded centiseconds correctly. */
export function formatAssTimestamp(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100))
  const hours = Math.floor(totalCs / 360_000)
  const minutes = Math.floor((totalCs % 360_000) / 6000)
  const secs = Math.floor((totalCs % 6000) / 100)
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(totalCs % 100)}`
}

function trimEmptyEdges(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start++
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end)
}

/**
 * Parse SRT once for every consumer. The parser tolerates missing blank lines and
 * numeric indexes, while invalid ranges are skipped and reported.
 */
export function parseSrt(raw: string): SubtitleParseResult {
  const normalized = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const timings: Array<{
    lineIndex: number
    nextTimingLine: number
    sourceIndex: number
    start: number
    end: number
  }> = []
  const warnings: SubtitleParseWarning[] = []
  const timingLineIndexes = lines
    .map((line, index) => (line.includes('-->') ? index : -1))
    .filter((index) => index >= 0)

  if (timingLineIndexes.length === 0 && normalized.trim()) {
    warnings.push({ line: 1, message: 'Không tìm thấy mốc thời gian SRT hợp lệ.' })
  }

  for (let sourceIndex = 0; sourceIndex < timingLineIndexes.length; sourceIndex++) {
    const i = timingLineIndexes[sourceIndex]
    const match = TIMING_LINE.exec(lines[i])
    if (!match) {
      warnings.push({ line: i + 1, message: 'Mốc thời gian SRT không hợp lệ.' })
      continue
    }
    const start = parseSubtitleTimestamp(match[1])
    const end = parseSubtitleTimestamp(match[2])
    if (start == null || end == null || end <= start) {
      warnings.push({ line: i + 1, message: 'Khoảng thời gian SRT không hợp lệ.' })
      continue
    }
    timings.push({
      lineIndex: i,
      nextTimingLine: timingLineIndexes[sourceIndex + 1] ?? lines.length,
      sourceIndex,
      start,
      end
    })
  }

  const cues: SubtitleCue[] = []
  for (let i = 0; i < timings.length; i++) {
    const timing = timings[i]
    let textLines = trimEmptyEdges(lines.slice(timing.lineIndex + 1, timing.nextTimingLine))

    // When blank separators are omitted, the next numeric index belongs to the
    // next cue rather than to this cue's text.
    if (
      timing.nextTimingLine < lines.length &&
      textLines.length > 1 &&
      /^\s*\d+\s*$/.test(textLines[textLines.length - 1])
    ) {
      textLines = textLines.slice(0, -1)
      textLines = trimEmptyEdges(textLines)
    }

    if (textLines.length === 0) {
      warnings.push({ line: timing.lineIndex + 1, message: 'Câu phụ đề không có nội dung.' })
      continue
    }

    // Preserve line content and punctuation. Only trim whitespace at the outer
    // edge of the whole cue; internal spaces and line breaks remain untouched.
    const text = textLines.join('\n').trim()
    if (!text) continue
    cues.push({
      id: `cue-${timing.sourceIndex}-${Math.round(timing.start * 1000)}`,
      sourceIndex: timing.sourceIndex,
      start: timing.start,
      end: timing.end,
      text
    })
  }

  cues.sort((a, b) => a.start - b.start || a.end - b.end || a.sourceIndex - b.sourceIndex)
  return { cues, warnings }
}

export function subtitleDuration(cues: readonly SubtitleCue[]): number {
  let duration = 0
  for (const cue of cues) duration = Math.max(duration, cue.end)
  return duration
}

export function trimSubtitleCues(
  cues: readonly SubtitleCue[],
  durationSeconds: number
): SubtitleCue[] {
  const duration = Math.max(0, durationSeconds)
  const result: SubtitleCue[] = []
  for (const cue of cues) {
    if (cue.start >= duration) continue
    const end = Math.min(cue.end, duration)
    if (end <= cue.start) continue
    result.push({ ...cue, end })
  }
  return result
}

export function serializeSrt(cues: readonly SubtitleCue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}\n`
    )
    .join('\n')
}
