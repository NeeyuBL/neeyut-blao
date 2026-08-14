import type {
  RenderedSubtitleSegment,
  SubtitleCue,
  SubtitleCueHealth,
  SubtitleCueHealthLevel,
  SubtitleCueIssue,
  SubtitleLayoutOptions,
  SubtitleLayoutProfile,
  SubtitleRenderPlan
} from './types'
import {
  cueUsesCjkWrap,
  ngatDongTheoPx,
  wrapWidthFromBox,
  type MeasureFn
} from './subWrap'

const MIN_READABLE_SECONDS = 5 / 6

interface LayoutRules {
  maxLines: number
  hardCps: number
}

export function subtitleLayoutRules(profile: SubtitleLayoutProfile): LayoutRules {
  if (profile === 'social') return { maxLines: 2, hardCps: 28 }
  if (profile === 'vertical') return { maxLines: 3, hardCps: 26 }
  return { maxLines: 2, hardCps: 23 }
}

function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    try {
      return Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text), (item) => item.segment)
    } catch {
      // Fall through to the code-point fallback below.
    }
  }
  return Array.from(text)
}

function readableCharacterCount(text: string): number {
  return graphemes(text).filter((value) => !/^\s+$/u.test(value)).length
}

function severity(level: SubtitleCueHealthLevel): number {
  return level === 'error' ? 2 : level === 'warning' ? 1 : 0
}

function highestLevel(issues: readonly SubtitleCueIssue[]): SubtitleCueHealthLevel {
  return issues.reduce<SubtitleCueHealthLevel>(
    (current, issue) => (severity(issue.level) > severity(current) ? issue.level : current),
    'good'
  )
}

function allocateCentiseconds(total: number, weights: readonly number[], minimum: number): number[] {
  if (weights.length === 0) return []
  if (weights.length === 1) return [total]
  const safeMinimum = minimum * weights.length <= total ? minimum : 1
  const remaining = Math.max(0, total - safeMinimum * weights.length)
  const weightSum = weights.reduce((sum, value) => sum + Math.max(1, value), 0)
  const exact = weights.map((value) => (remaining * Math.max(1, value)) / weightSum)
  const result = exact.map((value) => safeMinimum + Math.floor(value))
  let missing = total - result.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let index = 0; index < missing; index++) result[order[index % order.length].index]++
  return result
}

function lineGroups(lines: readonly string[], maxLines: number, autoOptimize: boolean): string[][] {
  if (!autoOptimize || lines.length <= maxLines) return [lines.slice()]
  const groups: string[][] = []
  for (let index = 0; index < lines.length; index += maxLines) {
    groups.push(lines.slice(index, index + maxLines))
  }
  return groups
}

function balanceLineGroup(lines: readonly string[], maxWidth: number, measure: MeasureFn): string[] {
  if (lines.length < 2 || lines.some((line) => !/\s/u.test(line))) return lines.slice()
  const balanced = lines.slice()
  for (let index = 0; index < balanced.length - 1; index++) {
    let leftWords = balanced[index].trim().split(/\s+/u)
    let rightWords = balanced[index + 1].trim().split(/\s+/u)
    let currentDifference = Math.abs(measure(leftWords.join(' ')) - measure(rightWords.join(' ')))
    while (leftWords.length > 1) {
      const moved = leftWords.at(-1)!
      const nextLeft = leftWords.slice(0, -1)
      const nextRight = [moved, ...rightWords]
      const leftWidth = measure(nextLeft.join(' '))
      const rightWidth = measure(nextRight.join(' '))
      const nextDifference = Math.abs(leftWidth - rightWidth)
      if (leftWidth > maxWidth || rightWidth > maxWidth || nextDifference >= currentDifference) break
      leftWords = nextLeft
      rightWords = nextRight
      currentDifference = nextDifference
    }
    balanced[index] = leftWords.join(' ')
    balanced[index + 1] = rightWords.join(' ')
  }
  return balanced
}

function segmentIssues(
  lines: readonly string[],
  widths: readonly number[],
  cps: number,
  maxWidth: number,
  rules: LayoutRules
): SubtitleCueIssue[] {
  const issues: SubtitleCueIssue[] = []
  if (widths.some((width) => width > maxWidth + 0.5)) {
    issues.push({
      code: 'overflow',
      level: 'error',
      message: 'Đoạn chữ vẫn vượt khỏi vùng phụ đề.'
    })
  }
  if (lines.length > rules.maxLines) {
    issues.push({
      code: 'too-many-lines',
      level: 'error',
      message: `Đoạn chữ có ${lines.length} dòng, vượt giới hạn ${rules.maxLines} dòng.`
    })
  }
  if (cps > rules.hardCps) {
    issues.push({
      code: 'too-fast',
      level: 'warning',
      message: 'Nhịp chữ rất nhanh; hãy nghe thử để xác nhận vẫn khớp lời nói.'
    })
  }
  return issues
}

/**
 * Lap bo cuc thuần, deterministic cho preview va ASS. Ham do chu duoc inject
 * de main co the dung dung file font da chon, con smoke test dung fixture nhe.
 */
export function planSubtitleLayout(
  cues: readonly SubtitleCue[],
  options: SubtitleLayoutOptions,
  measure: MeasureFn
): SubtitleRenderPlan {
  const profileRules = subtitleLayoutRules(options.profile)
  const verticalCapacity = Math.max(
    1,
    Math.floor(Math.max(1, options.boxHeight) / Math.max(1, options.fontSize * 1.25))
  )
  const rules: LayoutRules = {
    ...profileRules,
    maxLines: Math.min(profileRules.maxLines, verticalCapacity)
  }
  const maxWidth = wrapWidthFromBox(options.boxWidth, options.boxPadding)
  const segments: RenderedSubtitleSegment[] = []
  const cueHealth: SubtitleCueHealth[] = []

  for (const cue of cues) {
    const normalized = cue.text.replace(/\r\n|\r|\n/g, '\\N').replace(/[{}]/g, '')
    const wrapped = ngatDongTheoPx(normalized, maxWidth, measure, cueUsesCjkWrap(normalized))
    const allLines = wrapped.split('\\N').filter((line) => line.length > 0)
    const safeLines = allLines.length > 0 ? allLines : ['']
    const groups = lineGroups(safeLines, rules.maxLines, options.autoOptimize).map((lines) =>
      normalized.includes('\\N') ? lines : balanceLineGroup(lines, maxWidth, measure)
    )
    const totalCs = Math.max(1, Math.round((Math.max(cue.end, cue.start + 0.01) - cue.start) * 100))
    const weights = groups.map((lines) => readableCharacterCount(lines.join(' ')))
    const durations = allocateCentiseconds(totalCs, weights, Math.round(MIN_READABLE_SECONDS * 100))
    let cursorCs = Math.max(0, Math.round(cue.start * 100))
    const cueSegments: RenderedSubtitleSegment[] = []

    for (let index = 0; index < groups.length; index++) {
      const lines = groups[index]
      const start = cursorCs / 100
      cursorCs += durations[index]
      const end = index === groups.length - 1 ? Math.max(start + 0.01, cue.end) : cursorCs / 100
      const duration = Math.max(0.01, end - start)
      const text = lines.join('\n')
      const lineWidths = lines.map((line) => measure(line))
      const charactersPerSecond = readableCharacterCount(text) / duration
      const issues = segmentIssues(
        lines,
        lineWidths,
        charactersPerSecond,
        maxWidth,
        rules
      )
      cueSegments.push({
        ...cue,
        id: `${cue.id}:render:${index + 1}`,
        sourceCueId: cue.id,
        segmentIndex: index,
        start,
        end,
        text,
        lines,
        lineWidths,
        charactersPerSecond,
        issues
      })
    }

    const issues = cueSegments.flatMap((segment) => segment.issues)
    if (cueSegments.length > 1) {
      issues.unshift({
        code: 'split',
        level: 'good',
        message: `Đã tự chia thành ${cueSegments.length} đoạn để chữ không tràn khung.`
      })
    }
    const uniqueIssues = issues.filter(
      (issue, index, list) => list.findIndex((other) => other.code === issue.code && other.message === issue.message) === index
    )
    cueHealth.push({
      cueId: cue.id,
      level: highestLevel(uniqueIssues),
      lineCount: Math.max(...cueSegments.map((segment) => segment.lines.length)),
      charactersPerSecond: Math.max(...cueSegments.map((segment) => segment.charactersPerSecond)),
      duration: Math.max(0, cue.end - cue.start),
      segmentCount: cueSegments.length,
      issues: uniqueIssues
    })
    segments.push(...cueSegments)
  }

  return {
    segments,
    cueHealth,
    summary: {
      cueCount: cues.length,
      segmentCount: segments.length,
      splitCueCount: cueHealth.filter((health) => health.segmentCount > 1).length,
      warningCueCount: cueHealth.filter((health) => health.level === 'warning').length,
      errorCueCount: cueHealth.filter((health) => health.level === 'error').length
    },
    options
  }
}
