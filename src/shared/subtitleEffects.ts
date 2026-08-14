import type { SubtitleCue } from './subtitles'
import type { SubtitleDisplayStyle as SharedSubtitleDisplayStyle } from './types'

export type SubtitleDisplayStyle = SharedSubtitleDisplayStyle
export type SubtitleTokenKind = 'word' | 'space' | 'punctuation' | 'newline'

export interface SubtitleEffectToken {
  text: string
  kind: SubtitleTokenKind
  /** null only when the cue has no timed content. */
  beatIndex: number | null
  start: number
  end: number
}

export interface SubtitleEffectBeat {
  index: number
  tokenIndexes: number[]
  start: number
  end: number
  durationCs: number
}

export interface SubtitleEffectTimeline {
  cueId: string
  start: number
  end: number
  tokens: SubtitleEffectToken[]
  beats: SubtitleEffectBeat[]
}

export interface SubtitleTimelineOptions {
  /** A shorter cue groups adjacent words so every visual beat remains readable. */
  minBeatDurationCs?: number
  /** Protect ASS size for malformed/very long cues. Default: 120 beats per cue. */
  maxBeats?: number
  locale?: string
}

export interface SubtitlePopTiming {
  peakScale: number
  holdDurationMs: number
  settleDurationMs: number
  acceleration: number
}

export interface SubtitlePopRenderOptions {
  enabled?: boolean
  peakScale?: number
}

export interface SubtitleEffectLineGeometry {
  lineIndex: number
  text: string
  width: number
}

export interface SubtitleWordOverlayGeometry {
  tokenIndex: number
  beatIndex: number
  lineIndex: number
  text: string
  /** Horizontal offset from the centre of the already-laid-out line, in pixels. */
  centerOffsetX: number
  width: number
}

export interface SubtitleWordOverlayPlan {
  lines: SubtitleEffectLineGeometry[]
  words: SubtitleWordOverlayGeometry[]
}

const DEFAULT_POP_PEAK_SCALE = 1.16
const DEFAULT_POP_HOLD_MS = 50
const DEFAULT_POP_SETTLE_MS = 200
const POP_ACCELERATION = 0.75

export interface SubtitleRawToken {
  text: string
  kind: SubtitleTokenKind
  beatIndex: number | null
}

/**
 * Keep the line breaks chosen by the shared subtitle planner stable in every
 * renderer. Each returned row is a fixed visual line; consumers must not let
 * CSS wrap it a second time.
 */
export function splitSubtitleEffectLines(
  tokens: readonly SubtitleEffectToken[]
): SubtitleEffectToken[][] {
  const lines: SubtitleEffectToken[][] = [[]]
  for (const token of tokens) {
    if (token.kind === 'newline') lines.push([])
    else lines[lines.length - 1].push(token)
  }
  return lines
}

/**
 * A short beat gets a smaller pop instead of flashing at full strength. ASS
 * works in centiseconds, so all timings are quantized before preview/render.
 */
export function subtitlePopTiming(
  beat: SubtitleEffectBeat,
  requestedPeakScale = DEFAULT_POP_PEAK_SCALE
): SubtitlePopTiming {
  const durationMs = Math.max(10, Math.round(beat.durationCs) * 10)
  // Beat ngan chi nen nhan 6-8%; beat du 260 ms moi dung day du 16%.
  const shortPeakCap =
    durationMs <= 180
      ? 1.06 + (Math.max(100, durationMs) - 100) * 0.00025
      : durationMs < 260
        ? 1.08 + (durationMs - 180) * 0.001
        : DEFAULT_POP_PEAK_SCALE
  const peakScale = Math.min(1 + Math.max(0, requestedPeakScale - 1), shortPeakCap)
  const holdDurationMs = Math.min(
    DEFAULT_POP_HOLD_MS,
    Math.max(10, Math.round(durationMs * 0.22))
  )
  return {
    peakScale,
    holdDurationMs,
    settleDurationMs: Math.max(10, Math.min(DEFAULT_POP_SETTLE_MS, durationMs - holdDurationMs)),
    acceleration: POP_ACCELERATION
  }
}

/** Frame/playhead-driven scale. Seeking to the same timestamp returns the same value. */
export function subtitlePopScaleAt(
  beat: SubtitleEffectBeat,
  currentTime: number,
  requestedPeakScale = DEFAULT_POP_PEAK_SCALE
): number {
  if (!Number.isFinite(currentTime) || currentTime < beat.start || currentTime >= beat.end) return 1
  const timing = subtitlePopTiming(beat, requestedPeakScale)
  const elapsedMs = Math.max(0, (currentTime - beat.start) * 1000)
  if (elapsedMs <= timing.holdDurationMs) return timing.peakScale
  const progress = Math.max(
    0,
    Math.min(1, (elapsedMs - timing.holdDurationMs) / timing.settleDurationMs)
  )
  const eased = Math.pow(progress, timing.acceleration)
  return timing.peakScale + (1 - timing.peakScale) * eased
}

/**
 * Limit pop growth to the spare width of the fixed planned line. This keeps a
 * tight subtitle inside its box while allowing the full effect on roomy lines.
 */
export function safeSubtitlePopScale(
  timeline: SubtitleEffectTimeline,
  activeBeatIndex: number,
  maxLineWidth: number,
  measure: (text: string) => number,
  plannedLineWidths?: readonly number[],
  requestedPeakScale = DEFAULT_POP_PEAK_SCALE
): number {
  if (activeBeatIndex < 0 || !Number.isFinite(maxLineWidth) || maxLineWidth <= 0) return 1
  const lines = splitSubtitleEffectLines(timeline.tokens)
  let safeScale = requestedPeakScale
  let hasActiveWord = false

  lines.forEach((line, lineIndex) => {
    const activeWords = line.filter(
      (token) => token.kind === 'word' && token.beatIndex === activeBeatIndex
    )
    if (activeWords.length === 0) return
    hasActiveWord = true
    const activeWidth = activeWords.reduce((sum, token) => sum + Math.max(0, measure(token.text)), 0)
    if (activeWidth <= 0) return
    const baseWidth =
      plannedLineWidths?.[lineIndex] ?? measure(line.map((token) => token.text).join(''))
    const spareWidth = Math.max(0, maxLineWidth - baseWidth - 2)
    safeScale = Math.min(safeScale, 1 + spareWidth / activeWidth)
  })

  return hasActiveWord ? Math.max(1, Math.min(requestedPeakScale, safeScale)) : 1
}

/**
 * Measure the final, fixed line once and retain an absolute slot for every
 * word. ASS/libass can then animate a word in its own \pos event without
 * changing the width or centre of the base line.
 */
export function planSubtitleWordOverlays(
  timeline: SubtitleEffectTimeline,
  measure: (text: string) => number,
  plannedLineWidths?: readonly number[]
): SubtitleWordOverlayPlan {
  const lines = splitSubtitleEffectLines(timeline.tokens)
  const result: SubtitleWordOverlayPlan = { lines: [], words: [] }
  let tokenIndex = 0

  lines.forEach((line, lineIndex) => {
    const text = line.map((token) => token.text).join('')
    const measuredLineWidth = Math.max(0, measure(text))
    const plannedWidth = plannedLineWidths?.[lineIndex]
    const lineWidth =
      plannedWidth != null && Number.isFinite(plannedWidth) && plannedWidth >= 0
        ? plannedWidth
        : measuredLineWidth
    result.lines.push({ lineIndex, text, width: lineWidth })

    let prefix = ''
    for (const token of line) {
      const before = Math.max(0, measure(prefix))
      prefix += token.text
      const after = Math.max(before, measure(prefix))
      if (token.kind === 'word' && token.beatIndex != null) {
        result.words.push({
          tokenIndex,
          beatIndex: token.beatIndex,
          lineIndex,
          text: token.text,
          centerOffsetX: (before + after) / 2 - measuredLineWidth / 2,
          width: Math.max(0, after - before)
        })
      }
      tokenIndex++
    }
    // Account for the newline token which splitSubtitleEffectLines omits.
    if (lineIndex < lines.length - 1) tokenIndex++
  })

  return result
}

/** Scripts whose visual order/context shaping cannot be positioned safely by the current measurer. */
export function supportsFixedSubtitleWordPop(text: string): boolean {
  return !/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u.test(text)
}

const CJK_OR_THAI = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0e00-\u0e7f]/u
const LETTER_OR_NUMBER = /[\p{L}\p{M}\p{N}]/u
const COMBINING_MARK = /\p{M}/u
const SENTENCE_END = /[.!?。！？؟]/u
const SHORT_PAUSE = /[,;:，；：、]/u

export function normalizeSubtitleDisplayStyle(value: unknown): SubtitleDisplayStyle {
  return value === 'word-reveal' || value === 'word-highlight' ? value : 'standard'
}

function detectLocale(text: string): string {
  if (/[\u0e00-\u0e7f]/u.test(text)) return 'th'
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko'
  if (/[\u3400-\u9fff]/u.test(text)) return 'zh'
  if (/[\u0600-\u06ff]/u.test(text)) return 'ar'
  return 'vi'
}

function classify(text: string, isWordLike?: boolean): SubtitleTokenKind {
  if (text === '\n') return 'newline'
  if (/^\s+$/u.test(text)) return 'space'
  if (isWordLike || LETTER_OR_NUMBER.test(text)) return 'word'
  return 'punctuation'
}

function segmentWithIntl(text: string, locale: string): SubtitleRawToken[] | null {
  if (typeof Intl.Segmenter !== 'function') return null
  try {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
    const out: SubtitleRawToken[] = []
    for (const part of segmenter.segment(text)) {
      const value = part.segment
      if (!value) continue
      // Segmenter may include a newline beside whitespace; split it so layout is exact.
      for (const piece of value.split(/(\n)/u)) {
        if (!piece) continue
        out.push({ text: piece, kind: classify(piece, part.isWordLike), beatIndex: null })
      }
    }
    return out
  } catch {
    return null
  }
}

function fallbackSegments(text: string): SubtitleRawToken[] {
  const out: SubtitleRawToken[] = []
  let buffer = ''
  let bufferKind: SubtitleTokenKind | null = null

  const flush = (): void => {
    if (!buffer || !bufferKind) return
    out.push({ text: buffer, kind: bufferKind, beatIndex: null })
    buffer = ''
    bufferKind = null
  }

  for (const char of Array.from(text)) {
    if (char === '\n') {
      flush()
      out.push({ text: char, kind: 'newline', beatIndex: null })
      continue
    }
    if (/\s/u.test(char)) {
      if (bufferKind !== 'space') flush()
      bufferKind = 'space'
      buffer += char
      continue
    }
    if (CJK_OR_THAI.test(char)) {
      flush()
      out.push({ text: char, kind: 'word', beatIndex: null })
      continue
    }
    if (LETTER_OR_NUMBER.test(char)) {
      // A combining mark stays with the preceding grapheme/word.
      if (bufferKind !== 'word' && !COMBINING_MARK.test(char)) flush()
      bufferKind = 'word'
      buffer += char
      continue
    }
    flush()
    out.push({ text: char, kind: 'punctuation', beatIndex: null })
  }
  flush()
  return out
}

/** Tokenize without losing a character, space, punctuation mark, or line break. */
export function tokenizeSubtitleText(text: string, locale?: string): SubtitleRawToken[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return segmentWithIntl(normalized, locale || detectLocale(normalized)) ?? fallbackSegments(normalized)
}

function graphemeCount(text: string, locale: string): number {
  if (typeof Intl.Segmenter === 'function') {
    try {
      return Array.from(new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)).length
    } catch {
      // fall through
    }
  }
  return Math.max(1, Array.from(text).filter((char) => !COMBINING_MARK.test(char)).length)
}

function allocateDurations(totalCs: number, weights: number[], minimumCs: number): number[] {
  if (weights.length === 0) return []
  if (weights.length === 1) return [totalCs]

  const safeMinimum = minimumCs * weights.length <= totalCs ? minimumCs : 0
  const remaining = totalCs - safeMinimum * weights.length
  const weightSum = weights.reduce((sum, value) => sum + Math.max(1, value), 0)
  const exact = weights.map((value) => (remaining * Math.max(1, value)) / weightSum)
  const result = exact.map((value) => safeMinimum + Math.floor(value))
  let missing = totalCs - result.reduce((sum, value) => sum + value, 0)

  const remainderOrder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < missing; i++) result[remainderOrder[i % remainderOrder.length].index]++
  return result
}

/**
 * Build a deterministic, centisecond-aligned word timeline for one cue. Adjacent
 * words are grouped only when the cue is too short to give each one 100 ms.
 */
export function createSubtitleEffectTimeline(
  cue: SubtitleCue,
  options: SubtitleTimelineOptions = {}
): SubtitleEffectTimeline {
  const locale = options.locale || detectLocale(cue.text)
  const minBeatDurationCs = Math.max(1, Math.round(options.minBeatDurationCs ?? 10))
  const maxBeats = Math.max(1, Math.round(options.maxBeats ?? 120))
  const rawTokens = tokenizeSubtitleText(cue.text, locale)
  const wordIndexes = rawTokens
    .map((token, index) => (token.kind === 'word' ? index : -1))
    .filter((index) => index >= 0)

  const startCs = Math.max(0, Math.round(cue.start * 100))
  const endCs = Math.max(startCs + 1, Math.round(cue.end * 100))
  const durationCs = endCs - startCs

  // A punctuation-only cue is still one visible beat.
  const candidates = wordIndexes.length > 0 ? wordIndexes : rawTokens.length > 0 ? [0] : []
  const maxReadableBeats = Math.max(1, Math.floor(durationCs / minBeatDurationCs))
  const beatCount = Math.min(candidates.length, maxReadableBeats, maxBeats)

  if (beatCount > 0) {
    for (let wordPosition = 0; wordPosition < candidates.length; wordPosition++) {
      const beatIndex = Math.min(beatCount - 1, Math.floor((wordPosition * beatCount) / candidates.length))
      rawTokens[candidates[wordPosition]].beatIndex = beatIndex
    }

    // Untimed separators attach to the preceding beat. Leading content attaches
    // to the first beat, preserving a monotonic, lossless ASS karaoke sequence.
    let lastBeat: number | null = null
    for (const token of rawTokens) {
      if (token.beatIndex != null) lastBeat = token.beatIndex
      else if (lastBeat != null) token.beatIndex = lastBeat
    }
    let nextBeat = 0
    for (let i = rawTokens.length - 1; i >= 0; i--) {
      if (rawTokens[i].beatIndex != null) nextBeat = rawTokens[i].beatIndex!
      else rawTokens[i].beatIndex = nextBeat
    }
  }

  const weights = Array.from({ length: beatCount }, () => 0)
  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]
    if (token.kind !== 'word' || token.beatIndex == null) continue
    weights[token.beatIndex] += graphemeCount(token.text, locale) * 100
    const following = rawTokens[i + 1]?.text ?? ''
    if (SENTENCE_END.test(following)) weights[token.beatIndex] += 70
    else if (SHORT_PAUSE.test(following)) weights[token.beatIndex] += 35
  }
  for (let i = 0; i < weights.length; i++) if (weights[i] === 0) weights[i] = 100

  const durations = allocateDurations(durationCs, weights, minBeatDurationCs)
  const beats: SubtitleEffectBeat[] = []
  let cursorCs = startCs
  for (let i = 0; i < durations.length; i++) {
    const beatStartCs = cursorCs
    cursorCs += durations[i]
    beats.push({
      index: i,
      tokenIndexes: rawTokens
        .map((token, tokenIndex) => (token.beatIndex === i ? tokenIndex : -1))
        .filter((tokenIndex) => tokenIndex >= 0),
      start: beatStartCs / 100,
      end: cursorCs / 100,
      durationCs: durations[i]
    })
  }

  const tokens = rawTokens.map<SubtitleEffectToken>((token) => {
    const beat = token.beatIndex == null ? null : beats[token.beatIndex]
    return {
      ...token,
      start: beat?.start ?? startCs / 100,
      end: beat?.end ?? endCs / 100
    }
  })

  return {
    cueId: cue.id,
    start: startCs / 100,
    end: endCs / 100,
    tokens,
    beats
  }
}

/** [start, end) lookup used by renderer preview. */
export function activeSubtitleBeatIndex(
  timeline: SubtitleEffectTimeline,
  currentTime: number
): number | null {
  if (!Number.isFinite(currentTime)) return null
  if (currentTime < timeline.start || currentTime >= timeline.end) return null
  let low = 0
  let high = timeline.beats.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const beat = timeline.beats[middle]
    if (currentTime < beat.start) high = middle - 1
    else if (currentTime >= beat.end) low = middle + 1
    else return middle
  }
  return null
}

function assPlainText(value: string): string {
  // Curly braces would otherwise inject ASS override tags.
  return value.replace(/[{}]/g, '').replace(/\n/g, '\\N')
}

function assOverrideColour(value: string): string {
  const withAlpha = /^&H[0-9A-Fa-f]{2}([0-9A-Fa-f]{6})&$/.exec(value)
  return withAlpha ? `&H${withAlpha[1].toUpperCase()}&` : value
}

function subtitleLineTokenEntries(
  timeline: SubtitleEffectTimeline,
  lineIndex: number
): Array<{ token: SubtitleEffectToken; tokenIndex: number }> {
  const entries: Array<{ token: SubtitleEffectToken; tokenIndex: number }> = []
  let currentLine = 0
  timeline.tokens.forEach((token, tokenIndex) => {
    if (token.kind === 'newline') {
      currentLine++
      return
    }
    if (currentLine === lineIndex) entries.push({ token, tokenIndex })
  })
  return entries
}

/**
 * Preserve the complete base-line layout while making the active word's fill
 * and outline invisible. The separate pop layer replaces that glyph instead
 * of being drawn on top of another visible copy.
 */
export function renderAssBaseLineWithHiddenBeat(
  timeline: SubtitleEffectTimeline,
  lineIndex: number,
  activeBeatIndex: number
): string {
  return subtitleLineTokenEntries(timeline, lineIndex)
    .map(({ token }) => {
      const text = assPlainText(token.text)
      if (token.kind !== 'word' || token.beatIndex !== activeBeatIndex) return text
      return `{\\1a&HFF&\\3a&HFF&}${text}{\\1a&H00&\\3a&H00&}`
    })
    .join('')
}

/**
 * Let libass lay out the same complete line as the base event, but make every
 * glyph except one word invisible. This retains the renderer's exact font
 * shaping/spacing and avoids JS-measured coordinates drifting with custom
 * fonts. Scaling the sole visible word cannot move any visible neighbour.
 */
export function renderAssWordPopLineOverlay(
  timeline: SubtitleEffectTimeline,
  lineIndex: number,
  activeTokenIndex: number,
  beat: SubtitleEffectBeat,
  highlightColour: string,
  options: SubtitlePopRenderOptions = {}
): string {
  const timing = subtitlePopTiming(
    beat,
    Math.max(1, options.peakScale ?? DEFAULT_POP_PEAK_SCALE)
  )
  const enabled = options.enabled !== false && timing.peakScale > 1.001
  const scale = Math.max(100, Math.round(timing.peakScale * 100))
  const popTags = enabled
    ? `\\fscx${scale}\\fscy${scale}\\t(${timing.holdDurationMs},${timing.holdDurationMs + timing.settleDurationMs},${timing.acceleration},\\fscx100\\fscy100)`
    : ''
  const resetScale = enabled ? '\\fscx100\\fscy100' : ''
  const hidden = '\\1a&HFF&\\3a&HFF&'
  const visible = '\\1a&H00&\\3a&H00&'

  return (
    `{${hidden}}` +
    subtitleLineTokenEntries(timeline, lineIndex)
      .map(({ token, tokenIndex }) => {
        const text = assPlainText(token.text)
        if (tokenIndex !== activeTokenIndex) return text
        return `{${visible}\\1c${assOverrideColour(highlightColour)}${popTags}}${text}{${resetScale}${hidden}}`
      })
      .join('')
  )
}

/** Build one lossless ASS karaoke line. \ko also hides outline before reveal. */
export function renderAssWordReveal(timeline: SubtitleEffectTimeline): string {
  if (timeline.beats.length === 0) return assPlainText(timeline.tokens.map((token) => token.text).join(''))
  const chunks = timeline.beats.map((beat) => {
    const text = timeline.tokens
      .filter((token) => token.beatIndex === beat.index)
      .map((token) => token.text)
      .join('')
    return `{\\ko${beat.durationCs}}${assPlainText(text)}`
  })
  return chunks.join('')
}

/** Build the full cue with only the active word/group using the highlight colour. */
export function renderAssWordHighlight(
  timeline: SubtitleEffectTimeline,
  activeBeatIndex: number,
  primaryColour: string,
  highlightColour: string,
  options: SubtitlePopRenderOptions = {}
): string {
  const primary = assOverrideColour(primaryColour)
  const highlight = assOverrideColour(highlightColour)
  const beat = timeline.beats[activeBeatIndex]
  const popTiming = beat
    ? subtitlePopTiming(beat, Math.max(1, options.peakScale ?? DEFAULT_POP_PEAK_SCALE))
    : null
  const popEnabled = options.enabled !== false && popTiming != null && popTiming.peakScale > 1.001
  const popScale = popTiming ? Math.max(100, Math.round(popTiming.peakScale * 100)) : 100
  const popTags = popEnabled
    ? `\\fscx${popScale}\\fscy${popScale}\\t(${popTiming!.holdDurationMs},${popTiming!.holdDurationMs + popTiming!.settleDurationMs},${popTiming!.acceleration},\\fscx100\\fscy100)`
    : ''
  const resetScaleTags = popEnabled ? '\\fscx100\\fscy100' : ''
  return timeline.tokens
    .map((token) => {
      const text = assPlainText(token.text)
      if (token.kind !== 'word' || token.beatIndex !== activeBeatIndex) return text
      return `{\\1c${highlight}${popTags}}${text}{\\1c${primary}${resetScaleTags}}`
    })
    .join('')
}
