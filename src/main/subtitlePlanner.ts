import type {
  SubtitleCue,
  SubtitleLayoutOptions,
  SubtitleRenderPlan
} from '../shared/types'
import { automaticSubtitleFontId } from '../shared/subtitles'
import { planSubtitleLayout } from '../shared/subtitleLayout'
import { createTextMeasurer } from './fontMeasure'
import {
  resolveBurnFont,
  resolveDefaultBurnFont,
  type ResolvedBurnFont
} from './fonts'

export interface MainSubtitlePlan {
  plan: SubtitleRenderPlan
  resolvedFont: ResolvedBurnFont | null
  fontFamily: string
}

export function resolveSubtitlePlanFont(
  cues: readonly SubtitleCue[],
  fontId: string | null | undefined
): ResolvedBurnFont | null {
  if (fontId && fontId !== 'auto') {
    const explicit = resolveBurnFont(fontId)
    if (!explicit) throw new Error('Font đã chọn không còn khả dụng. Hãy chọn lại font rồi thử lại.')
    return explicit
  }
  const automaticId = automaticSubtitleFontId(cues.map((cue) => cue.text).join(''))
  if (automaticId) {
    const automatic = resolveBurnFont(automaticId)
    if (automatic) return automatic
  }
  return resolveDefaultBurnFont()
}

/** Main process la nguon do glyph chinh thuc cho ca preview va ASS. */
export function createMainSubtitlePlan(
  cues: readonly SubtitleCue[],
  options: SubtitleLayoutOptions,
  fontId: string | null | undefined
): MainSubtitlePlan {
  const resolvedFont = resolveSubtitlePlanFont(cues, fontId)
  const fontFamily = resolvedFont?.entry.family || 'Arial'
  const measure = createTextMeasurer(
    options.fontSize,
    fontFamily,
    resolvedFont?.entry ?? null
  )
  return {
    plan: planSubtitleLayout(cues, options, measure),
    resolvedFont,
    fontFamily
  }
}
