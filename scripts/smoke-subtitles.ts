import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  automaticSubtitleFontId,
  formatAssTimestamp,
  parseSrt,
  serializeSrt,
  trimSubtitleCues
} from '../src/shared/subtitles'
import {
  activeSubtitleBeatIndex,
  createSubtitleEffectTimeline,
  planSubtitleWordOverlays,
  renderAssBaseLineWithHiddenBeat,
  renderAssWordHighlight,
  renderAssWordPopLineOverlay,
  renderAssWordReveal,
  safeSubtitlePopScale,
  splitSubtitleEffectLines,
  subtitlePopScaleAt,
  subtitlePopTiming,
  tokenizeSubtitleText
} from '../src/shared/subtitleEffects'
import { subtitleFontSizeForBox } from '../src/shared/subWrap'
import { planSubtitleLayout } from '../src/shared/subtitleLayout'
import { audioMixGains, originalAudioGain } from '../src/shared/audioMix'
import { boCuc, docSrt, taoAss } from '../src/main/burn'

assert.equal(originalAudioGain(100), 1)
assert.equal(originalAudioGain(50), 0.25)
assert.equal(originalAudioGain(0), 0)
assert.deepEqual(
  audioMixGains({
    enabled: true,
    sourceVolume: 50,
    hasOriginalAudio: true,
    hasDubAudio: true,
    dubIsActive: true
  }),
  { original: 0.125, dub: 0.5 }
)
assert.deepEqual(
  audioMixGains({
    enabled: true,
    sourceVolume: 50,
    hasOriginalAudio: true,
    hasDubAudio: true,
    dubIsActive: false
  }),
  { original: 0.25, dub: 0 }
)
assert.deepEqual(
  audioMixGains({
    enabled: true,
    sourceVolume: 50,
    hasOriginalAudio: false,
    hasDubAudio: true,
    dubIsActive: true
  }),
  { original: 0, dub: 1 }
)

const sample = `\uFEFF1\r
00:00:00,000 --> 00:00:02,005\r
Xin  chào, thế giới!\r
Dòng hai.\r
\r
2\r
00:00:02.005 --> 00:00:04,000\r
ภาษาไทย 日本語 العربية\r
`

const parsed = parseSrt(sample)
assert.equal(parsed.warnings.length, 0)
assert.equal(parsed.cues.length, 2)
assert.equal(parsed.cues[0].start, 0)
assert.equal(parsed.cues[0].end, 2.005)
assert.equal(parsed.cues[0].text, 'Xin  chào, thế giới!\nDòng hai.')
assert.equal(parsed.cues[1].start, 2.005)
assert.equal(automaticSubtitleFontId('Xin chào'), 'noto-sans')
assert.equal(automaticSubtitleFontId('ภาษาไทย'), 'noto-sans-thai')
assert.equal(automaticSubtitleFontId('العربية'), 'noto-sans-arabic')
assert.equal(automaticSubtitleFontId('日本語 한국어 中文'), 'noto-sans-kr')
assert.equal(automaticSubtitleFontId('😀'), null)
const emptyParsed = parseSrt('đây không phải SRT')
assert.equal(emptyParsed.cues.length, 0)
assert.equal(emptyParsed.warnings.length, 1)

const tokens = tokenizeSubtitleText(parsed.cues[0].text)
assert.equal(tokens.map((token) => token.text).join(''), parsed.cues[0].text)
assert(tokens.some((token) => token.kind === 'newline'))
assert(tokens.some((token) => token.text === '  '))
for (const text of ['ภาษาไทย', '日本語', '한국어', 'العربية', '👩🏽‍💻 test']) {
  assert.equal(tokenizeSubtitleText(text).map((token) => token.text).join(''), text)
}

const timeline = createSubtitleEffectTimeline(parsed.cues[0])
assert(timeline.beats.length > 1)
assert.equal(
  timeline.beats.reduce((sum, beat) => sum + beat.durationCs, 0),
  Math.round(parsed.cues[0].end * 100) - Math.round(parsed.cues[0].start * 100)
)
assert.equal(activeSubtitleBeatIndex(timeline, timeline.start), 0)
assert.equal(activeSubtitleBeatIndex(timeline, timeline.end), null)
assert.equal(activeSubtitleBeatIndex(timeline, Number.NaN), null)
assert.deepEqual(createSubtitleEffectTimeline(parsed.cues[0]), timeline)
assert.deepEqual(
  splitSubtitleEffectLines(timeline.tokens).map((line) => line.map((token) => token.text).join('')),
  parsed.cues[0].text.split('\n')
)

const reveal = renderAssWordReveal(timeline)
assert.match(reveal, /\{\\ko\d+\}/)
assert.match(reveal, /\\N/)

const highlighted = renderAssWordHighlight(timeline, 0, '&H00FFFFFF&', '&H0000D7FF&')
assert.match(highlighted, /\{\\1c&H00D7FF&/)
assert.match(highlighted, /\{\\1c&HFFFFFF&/)
assert.match(highlighted, /\\fscx\d+\\fscy\d+\\t\(\d+,\d+,0\.75,\\fscx100\\fscy100\)/)
assert.doesNotMatch(
  renderAssWordHighlight(timeline, 0, '&H00FFFFFF&', '&H0000D7FF&', { enabled: false }),
  /\\fscx/
)
const overlayPlan = planSubtitleWordOverlays(timeline, (value) => Array.from(value).length * 10)
assert.equal(overlayPlan.lines.length, 2)
assert(overlayPlan.words.length > 1)
assert(overlayPlan.words.every((word) => Number.isFinite(word.centerOffsetX) && word.width > 0))
const firstWord = overlayPlan.words[0]
const hiddenBase = renderAssBaseLineWithHiddenBeat(timeline, firstWord.lineIndex, firstWord.beatIndex)
assert.match(hiddenBase, /\\1a&HFF&\\3a&HFF&/)
assert.match(hiddenBase, /\\1a&H00&\\3a&H00&/)
const firstOverlay = renderAssWordPopLineOverlay(
  timeline,
  firstWord.lineIndex,
  firstWord.tokenIndex,
  timeline.beats[overlayPlan.words[0].beatIndex],
  '&H0000D7FF&'
)
assert.match(firstOverlay, /\\fscx\d+\\fscy\d+/)
assert.match(firstOverlay, /\\1a&HFF&\\3a&HFF&/)
assert.match(firstOverlay, /\\1a&H00&\\3a&H00&/)
assert(subtitlePopScaleAt(timeline.beats[0], timeline.beats[0].start) > 1)
assert.equal(
  subtitlePopScaleAt(timeline.beats[0], timeline.beats[0].start + 0.03),
  subtitlePopScaleAt(timeline.beats[0], timeline.beats[0].start)
)
assert.equal(subtitlePopScaleAt(timeline.beats[0], timeline.beats[0].end), 1)
assert.equal(
  safeSubtitlePopScale(timeline, 0, 100, (value) => value.length * 10, [100, 40]),
  1
)

const shortCue = { ...parsed.cues[0], id: 'short', start: 1, end: 1.15 }
const shortTimeline = createSubtitleEffectTimeline(shortCue)
assert(shortTimeline.beats.length <= 2)
assert(subtitlePopTiming(shortTimeline.beats[0]).peakScale <= 1.08)
assert.equal(shortTimeline.beats.reduce((sum, beat) => sum + beat.durationCs, 0), 15)
assert(createSubtitleEffectTimeline(parsed.cues[0], { maxBeats: 2 }).beats.length <= 2)

const trimmed = trimSubtitleCues(parsed.cues, 3)
assert.equal(trimmed.length, 2)
assert.equal(trimmed[1].end, 3)
assert.match(serializeSrt(trimmed), /00:00:03,000/)
assert.equal(formatAssTimestamp(1.999), '0:00:02.00')

const malformed = parseSrt(
  '1\n00:00:00,000 --> 00:00:01,000\n2026\n2\nbad --> time\nskip me\n3\n00:00:02,000 --> 00:00:03,000\nok\n'
)
assert.equal(malformed.warnings.length, 1)
assert.equal(malformed.cues.length, 2)
assert.equal(malformed.cues[0].text, '2026')

const burnCues = docSrt(sample)
const meta = { w: 1280, h: 720, giay: 4, hasAudio: false }
const layout = boCuc(meta, { x0: 120, y0: 550, x1: 1160, y1: 680 }, false)
const standardAss = taoAss(burnCues, meta, layout)
const revealAss = taoAss(burnCues, meta, layout, null, null, null, {
  displayStyle: 'word-reveal'
})
const highlightAss = taoAss(burnCues, meta, layout, null, null, null, {
  displayStyle: 'word-highlight',
  highlightColor: '#FFD166'
})
assert.equal((standardAss.match(/^Dialogue:/gm) ?? []).length, 2)
assert.match(standardAss, /WrapStyle: 2/)
assert.match(revealAss, /\{\\ko\d+\}/)
assert.match(revealAss, /Style: D,[^\n]*,&HFF[0-9A-F]{6}&,/)
assert((highlightAss.match(/^Dialogue:/gm) ?? []).length > 2)
assert.match(highlightAss, /\{\\1c&H[0-9A-F]{6}&/)
assert.match(highlightAss, /\\fscx\d+\\fscy\d+\\t\(\d+,\d+,0\.75,\\fscx100\\fscy100\)/)
const scaledHighlightEvents = (highlightAss.match(/^Dialogue:.*$/gm) ?? []).filter((line) =>
  line.includes('\\fscx')
)
assert(scaledHighlightEvents.length > 0)
assert(scaledHighlightEvents.every((line) => line.includes('\\an2\\pos(')))
assert(scaledHighlightEvents.every((line) => !line.includes('\\N')))
// Regression: every pop event uses a full invisible line as libass's own
// layout placeholder, with exactly one visible word replacing the hidden base.
assert(
  scaledHighlightEvents.every(
    (line) => line.includes('\\1a&HFF&\\3a&HFF&') && line.includes('\\1a&H00&\\3a&H00&')
  )
)
assert(
  (highlightAss.match(/^Dialogue:.*$/gm) ?? []).some(
    (line) =>
      !line.includes('\\fscx') &&
      line.includes('\\an2\\pos(') &&
      line.includes('\\1a&HFF&\\3a&HFF&') &&
      line.includes('\\1a&H00&\\3a&H00&')
  )
)

// Regression: a tall subtitle box on a portrait video used to turn into a
// 222px font and wrap a normal cue into roughly ten one/two-word lines.
const portraitMeta = { w: 1080, h: 1920, giay: 4, hasAudio: false }
const portraitRegion = { x0: 98, y0: 1173, x1: 962, y1: 1490 }
const portraitLayout = boCuc(portraitMeta, portraitRegion, false)
assert.equal(
  portraitLayout.fontSize,
  subtitleFontSizeForBox({
    boxWidth: portraitRegion.x1 - portraitRegion.x0,
    boxHeight: portraitRegion.y1 - portraitRegion.y0,
    videoWidth: portraitMeta.w,
    videoHeight: portraitMeta.h
  })
)
assert.equal(portraitLayout.fontSize, 70)
const longPortraitCue = [
  {
    id: 'portrait-long',
    sourceIndex: 1,
    start: 0.11,
    end: 3.85,
    text: 'Em xin lỗi anh với chị, em thích cái cơ vời quá, mà em không thịt mua'
  }
]
const simpleMeasure = (text: string): number => Array.from(text).length * 10
const pacingCue = [
  { id: 'pacing', sourceIndex: 1, start: 0, end: 1, text: 'mot hai ba bon nam sau bay' }
]
const pacingOptions = {
  profile: 'readable' as const,
  autoOptimize: true,
  videoWidth: 1280,
  videoHeight: 720,
  boxWidth: 500,
  boxHeight: 180,
  fontSize: 40,
  boxPadding: 0
}
const speechReviewPlan = planSubtitleLayout(pacingCue, pacingOptions, simpleMeasure)
assert.equal(speechReviewPlan.cueHealth[0].level, 'good')

const fastSpeechPlan = planSubtitleLayout(
  [{ ...pacingCue[0], id: 'fast-pacing', end: 0.5 }],
  pacingOptions,
  simpleMeasure
)
assert.equal(fastSpeechPlan.cueHealth[0].level, 'warning')
assert.equal(fastSpeechPlan.summary.errorCueCount, 0)

const shortSpeechCue = [{ id: 'short-speech', sourceIndex: 1, start: 0, end: 0.5, text: 'ok' }]
assert.equal(
  planSubtitleLayout(shortSpeechCue, pacingOptions, simpleMeasure).cueHealth[0].level,
  'good'
)

const displayErrorPlan = planSubtitleLayout(
  [{ id: 'overflow', sourceIndex: 1, start: 0, end: 3, text: 'supercalifragilistic' }],
  { ...pacingOptions, boxWidth: 80, autoOptimize: false },
  simpleMeasure
)
assert.equal(displayErrorPlan.cueHealth[0].level, 'error')
assert(
  displayErrorPlan.cueHealth[0].issues.some(
    (issue) => issue.code === 'overflow' || issue.code === 'too-many-lines'
  )
)

const readablePlan = planSubtitleLayout(
  longPortraitCue,
  {
    profile: 'readable',
    autoOptimize: true,
    videoWidth: 1080,
    videoHeight: 1920,
    boxWidth: 260,
    boxHeight: 220,
    fontSize: 70,
    boxPadding: 0
  },
  simpleMeasure
)
assert(readablePlan.segments.length > 1)
assert.equal(readablePlan.summary.splitCueCount, 1)
assert(readablePlan.segments.every((segment) => segment.lines.length <= 2))
assert.equal(readablePlan.segments[0].start, longPortraitCue[0].start)
assert.equal(readablePlan.segments.at(-1)?.end, longPortraitCue[0].end)
for (let index = 1; index < readablePlan.segments.length; index++) {
  assert.equal(readablePlan.segments[index - 1].end, readablePlan.segments[index].start)
}

const unoptimizedPlan = planSubtitleLayout(
  longPortraitCue,
  { ...readablePlan.options, autoOptimize: false },
  simpleMeasure
)
assert.equal(unoptimizedPlan.segments.length, 1)
assert(unoptimizedPlan.cueHealth[0].issues.some((issue) => issue.code === 'too-many-lines'))

const verticalPlan = planSubtitleLayout(
  longPortraitCue,
  { ...readablePlan.options, profile: 'vertical' },
  simpleMeasure
)
assert(verticalPlan.segments.every((segment) => segment.lines.length <= 3))

const manualBreakCue = {
  id: 'manual-break',
  sourceIndex: 1,
  start: 0,
  end: 3,
  text: 'Dòng thứ nhất\nDòng thứ hai'
}
const manualBreakPlan = planSubtitleLayout(
  [manualBreakCue],
  { ...readablePlan.options, boxWidth: 300 },
  simpleMeasure
)
assert.deepEqual(manualBreakPlan.segments[0].lines, ['Dòng thứ nhất', 'Dòng thứ hai'])
assert.equal(manualBreakCue.text, 'Dòng thứ nhất\nDòng thứ hai')

const emojiPlan = planSubtitleLayout(
  [{ id: 'emoji', sourceIndex: 1, start: 0, end: 3, text: '👩🏽‍💻👨‍👩‍👧‍👦 kiểm tra' }],
  { ...readablePlan.options, boxWidth: 70 },
  simpleMeasure
)
assert(!emojiPlan.segments.flatMap((segment) => segment.lines).some((line) => /^[🏽‍]/u.test(line)))

for (const multilingual of ['ภาษาไทยกำลังทดสอบการตัดบรรทัด', 'مرحبا بالعالم هذا اختبار طويل', '日本語字幕の折り返しテストです']) {
  const plan = planSubtitleLayout(
    [{ id: multilingual, sourceIndex: 1, start: 0, end: 4, text: multilingual }],
    { ...readablePlan.options, boxWidth: 90 },
    simpleMeasure
  )
  assert(plan.segments.every((segment) => segment.lines.length <= 2))
  assert.equal(
    plan.segments.map((segment) => segment.lines.join('')).join('').replace(/\s/g, ''),
    multilingual.replace(/\s/g, '')
  )
  assert(plan.segments.flatMap((segment) => segment.lines).every((line) => !/^\p{M}/u.test(line)))
}
const portraitAss = taoAss(longPortraitCue, portraitMeta, portraitLayout, null, null, null, {
  displayStyle: 'word-highlight'
})
const portraitStandardAss = taoAss(longPortraitCue, portraitMeta, portraitLayout, null, null, null, {
  displayStyle: 'standard',
  layoutProfile: 'readable',
  autoOptimize: true
})
const portraitStandardDialogues = portraitStandardAss.match(/^Dialogue:.*$/gm) ?? []
assert(portraitStandardDialogues.length > 1)
assert(portraitStandardDialogues.every((dialogue) => (dialogue.match(/\\N/g) ?? []).length <= 1))
const portraitDialogues = portraitAss.match(/^Dialogue:.*$/gm) ?? []
assert(portraitDialogues.length > 1)
for (const dialogue of portraitDialogues) {
  assert((dialogue.match(/\\N/g) ?? []).length <= 3)
}

// If an FFmpeg binary is available, also prove that libass accepts every style
// and that the two animated styles actually change rendered frames over time.
const ffmpegProbe = spawnSync('ffmpeg', ['-version'], { windowsHide: true })
let ffmpegSummary = 'FFmpeg unavailable (syntax render skipped)'
if (ffmpegProbe.status === 0) {
  const temp = mkdtempSync(join(tmpdir(), 'tblao-subtitle-smoke-'))
  try {
    const uniqueFrameHashes = (name: string, ass: string): number => {
      writeFileSync(join(temp, `${name}.ass`), ass, 'utf8')
      const run = spawnSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=1280x720:r=10:d=4',
          '-vf',
          `ass=${name}.ass`,
          '-f',
          'framemd5',
          '-'
        ],
        { cwd: temp, encoding: 'utf8', windowsHide: true }
      )
      assert.equal(run.status, 0, run.stderr || `FFmpeg rejected ${name}.ass`)
      const hashes = run.stdout
        .split(/\r?\n/u)
        .filter((line) => /^0,/.test(line))
        .map((line) => line.split(',').at(-1)?.trim())
        .filter(Boolean)
      return new Set(hashes).size
    }

    const standardFrames = uniqueFrameHashes('standard', standardAss)
    const revealFrames = uniqueFrameHashes('reveal', revealAss)
    const highlightFrames = uniqueFrameHashes('highlight', highlightAss)
    assert(revealFrames > standardFrames)
    assert(highlightFrames > standardFrames)
    ffmpegSummary = `FFmpeg frames standard/reveal/highlight=${standardFrames}/${revealFrames}/${highlightFrames}`
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

console.log(
  `subtitle smoke OK: ${parsed.cues.length} cues, ${tokens.length} tokens, ${timeline.beats.length} beats; ${ffmpegSummary}`
)
