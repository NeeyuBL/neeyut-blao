import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  BlurRegion,
  BurnFontEntry,
  BurnReq,
  BurnResult,
  SubtitleDisplayStyle,
  SubtitleFilePreview,
  SubtitleLayoutProfile,
  SubtitleRenderPlan
} from '../../../shared/types'
import { automaticSubtitleFontId } from '../../../shared/subtitles'
import { useTabOutputDir } from '../lib/outputDir'
import { usePersistedState } from '../lib/persist'
import { localMediaSource } from '../lib/localMedia'
import { fitVideoInBounds } from '../lib/videoGeometry'
import { useAudioMixPreview } from '../hooks/useAudioMixPreview'
import {
  useSubtitlePreview,
  type PreviewSubtitleCue
} from '../hooks/useSubtitlePreview'
import { useVideoTransport } from '../hooks/useVideoTransport'
import RegionBox, { type Region } from './RegionBox'

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path

const PALETTE = [
  '#e8a13c',
  '#3b82f6',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#a855f7'
]

export type EditorDraftSource = 'audio' | 'ocr' | 'external'

export interface EditorDraft {
  requestId: string
  video?: string
  srt?: string
  outputDir?: string
  source: EditorDraftSource
}

type EditorTool = 'subtitle' | 'blur' | 'audio'
type BurnState = 'idle' | 'running' | 'done' | 'error'
type FontLoadState = 'idle' | 'loading' | 'ready' | 'error'

type EditorApi = typeof window.api

interface Props {
  draft?: EditorDraft | null
  /** Editor duoc giu mounted khi doi tab; active bao luc khung da co kich thuoc de do lai. */
  active?: boolean
}

interface PreviewStageSize {
  width: number
  height: number
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function friendlyIpcMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback
  const message = error.message.replace(/^.*Error:\s*/u, '').trim()
  return message && message.length <= 240 ? message : fallback
}

function defaultSubtitleRegion(width: number, height: number): Region {
  const portrait = height > width
  return {
    x0: Math.round(width * 0.1),
    x1: Math.round(width * 0.9),
    // Giu chu trong lower-third nhung tranh thanh dieu khien native khi video
    // dang tam dung. Video doc can cao hon de chua cho UI cua Shorts/Reels.
    y0: Math.round(height * (portrait ? 0.72 : 0.77)),
    y1: Math.round(height * (portrait ? 0.84 : 0.89))
  }
}

export default function VideoEditor({ draft, active = true }: Props): JSX.Element {
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.editor')
  const [video, setVideo] = useState<string | null>(null)
  const [subtitlePath, setSubtitlePath] = useState('')
  const [videoH, setVideoH] = useState(0)
  const [videoW, setVideoW] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const [boxW, setBoxW] = useState(0)
  const [previewStageSize, setPreviewStageSize] = useState<PreviewStageSize>({
    width: 0,
    height: 0
  })
  const [tool, setTool] = useState<EditorTool>('subtitle')

  const [subtitleEnabled, setSubtitleEnabled] = useState(true)
  const [blurEnabled, setBlurEnabled] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [subtitleRegion, setSubtitleRegion] = useState<Region | undefined>()
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>([])
  const [activeBlurId, setActiveBlurId] = useState<string | null>(null)

  const [fontId, setFontId] = usePersistedState('tblao.burn.fontId', 'auto')
  const [fonts, setFonts] = useState<BurnFontEntry[]>([])
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const [previewFontFamily, setPreviewFontFamily] = useState('')
  const [fontLoadState, setFontLoadState] = useState<FontLoadState>('idle')
  const [fontMessage, setFontMessage] = useState('')
  const [fontMutationNotice, setFontMutationNotice] = useState<string | null>(null)
  const [textColor, setTextColor] = usePersistedState('tblao.burn.textColor', '#ffffff')
  const [outlineColor, setOutlineColor] = usePersistedState('tblao.burn.outlineColor', '#000000')
  const [outlinePx, setOutlinePx] = usePersistedState('tblao.burn.outlinePx', 2)
  const [bgEnabled, setBgEnabled] = usePersistedState('tblao.burn.bgEnabled', false)
  const [bgColor, setBgColor] = usePersistedState('tblao.burn.bgColor', '#000000')
  const [bgOpacity, setBgOpacity] = usePersistedState('tblao.burn.bgOpacity', 60)
  const [displayStyle, setDisplayStyle] = usePersistedState<SubtitleDisplayStyle>(
    'tblao.burn.subtitleDisplayStyle',
    'standard'
  )
  const [highlightColor, setHighlightColor] = usePersistedState(
    'tblao.burn.highlightColor',
    '#43e7d5'
  )
  const [highlightPop, setHighlightPop] = usePersistedState(
    'tblao.burn.subtitleHighlightPop',
    !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  )
  const [layoutProfile, setLayoutProfile] = usePersistedState<SubtitleLayoutProfile>(
    'tblao.burn.subtitleLayoutProfile',
    'readable'
  )
  const [autoOptimize, setAutoOptimize] = usePersistedState(
    'tblao.burn.subtitleAutoOptimize',
    true
  )
  const [showSafeArea, setShowSafeArea] = usePersistedState(
    'tblao.editor.showSafeArea',
    true
  )

  const [audioFile, setAudioFile] = useState('')
  const [sourceVolume, setSourceVolume] = useState(100)
  const [hasOriginalAudio, setHasOriginalAudio] = useState(true)
  const [previewFile, setPreviewFile] = useState<SubtitleFilePreview>({
    cues: [],
    duration: 0,
    warnings: []
  })
  const [subtitleError, setSubtitleError] = useState<string | null>(null)
  const [layoutPlan, setLayoutPlan] = useState<SubtitleRenderPlan | null>(null)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const [layoutLoading, setLayoutLoading] = useState(false)
  const [isStageFullscreen, setIsStageFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState<string | null>(null)
  const [burnState, setBurnState] = useState<BurnState>('idle')
  const [burnPercent, setBurnPercent] = useState(0)
  const [burnOutput, setBurnOutput] = useState('')
  const [burnError, setBurnError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewPanelRef = useRef<HTMLElement | null>(null)
  const stageShellRef = useRef<HTMLDivElement | null>(null)
  const appliedDraftId = useRef('')

  const api = window.api as EditorApi
  const previewCues = layoutPlan?.segments ?? previewFile.cues
  const { currentTime, activeCues } = useSubtitlePreview(videoRef, previewCues, video)
  const {
    isPlaying,
    muted,
    volume,
    playbackRate,
    togglePlayback,
    seekTo,
    toggleMuted,
    changeVolume,
    changePlaybackRate
  } = useVideoTransport(videoRef, video)
  const audioPreview = useAudioMixPreview({
    videoRef,
    videoKey: video,
    audioPath: audioFile,
    enabled: audioEnabled,
    sourceVolume,
    monitorVolume: volume,
    monitorMuted: muted,
    hasOriginalAudio,
    prepareFallback: api.prepareAudioPreview
  })

  const togglePreviewPlayback = useCallback(async (): Promise<void> => {
    await audioPreview.preparePlayback()
    await togglePlayback()
  }, [audioPreview.preparePlayback, togglePlayback])

  const activeCue = activeCues[0]
  const activeText = activeCues.map((cue) => cue.text).join('\n')
  const plannedSourceCueId = activeCue
    ? (activeCue as { sourceCueId?: unknown }).sourceCueId
    : undefined
  const activeSourceCueId = typeof plannedSourceCueId === 'string' ? plannedSourceCueId : activeCue?.id
  const railDuration = Math.max(videoDuration, previewFile.duration, 1)
  const cueHealthById = useMemo(
    () => new Map((layoutPlan?.cueHealth ?? []).map((health) => [health.cueId, health])),
    [layoutPlan]
  )
  const activeHealth = activeSourceCueId ? cueHealthById.get(activeSourceCueId) : undefined
  const activeIssue = activeHealth?.issues.find((issue) => issue.level !== 'good') ?? activeHealth?.issues[0]

  const groupedFonts = useMemo(() => {
    const groups = new Map<string, BurnFontEntry[]>()
    for (const font of fonts) {
      const group = font.group || 'Khác'
      const list = groups.get(group) || []
      list.push(font)
      groups.set(group, list)
    }
    return [...groups.entries()]
  }, [fonts])

  const automaticFontId = useMemo(
    () => automaticSubtitleFontId(previewFile.cues.map((cue) => cue.text).join('')),
    [previewFile.cues]
  )

  const measureStage = useCallback((): void => {
    const shell = stageShellRef.current
    if (!shell || videoW <= 0 || videoH <= 0) return

    // clientWidth/clientHeight gom ca padding. Tru padding de video "contain" chinh xac
    // trong san khau, sau do dung cung kich thuoc cho lop RegionBox.
    const shellStyle = window.getComputedStyle(shell)
    const horizontalPadding =
      (Number.parseFloat(shellStyle.paddingLeft) || 0) +
      (Number.parseFloat(shellStyle.paddingRight) || 0)
    const verticalPadding =
      (Number.parseFloat(shellStyle.paddingTop) || 0) +
      (Number.parseFloat(shellStyle.paddingBottom) || 0)
    const availableW = Math.max(0, shell.clientWidth - horizontalPadding)
    const availableH = Math.max(0, shell.clientHeight - verticalPadding)

    // Pane display:none bao cao 0x0. Khong ghi de kich thuoc hop le; effect active
    // se do lai ngay sau khi pane duoc dua tro lai layout.
    if (availableW <= 0 || availableH <= 0) return

    const fitted = fitVideoInBounds(videoW, videoH, availableW, availableH)
    if (!fitted) return
    const { width, height } = fitted

    setPreviewStageSize((current) =>
      current.width === width && current.height === height ? current : { width, height }
    )
    setBoxW((current) => (current === width ? current : width))
    setBoxH((current) => (current === height ? current : height))
  }, [videoH, videoW])

  const refreshFonts = async (): Promise<void> => {
    try {
      const list = await window.api.listBurnFonts()
      setFonts(list)
    } catch (error) {
      setFontLoadState('error')
      setFontMessage(error instanceof Error ? error.message : 'Không thể đọc danh sách font.')
    } finally {
      setFontsLoaded(true)
    }
  }

  useEffect(() => {
    void refreshFonts()
  }, [])

  useEffect(() => {
    if (!draft || draft.requestId === appliedDraftId.current) return
    appliedDraftId.current = draft.requestId
    if (burnState === 'running') {
      window.alert('Video đang được xuất. Hãy dừng hoặc chờ hoàn tất trước khi mở nội dung mới.')
      return
    }
    const replacesCurrentDraft =
      Boolean(video && draft.video && draft.video !== video) ||
      Boolean(subtitlePath && draft.srt && draft.srt !== subtitlePath)
    if (
      replacesCurrentDraft &&
      !window.confirm('Mở nội dung mới sẽ thay video hoặc phụ đề đang biên tập. Bạn muốn tiếp tục?')
    ) {
      return
    }
    const nextVideo = draft.video || null
    const videoChanged = nextVideo !== video
    setVideo(nextVideo)
    if (videoChanged) {
      setVideoH(0)
      setVideoW(0)
      setPreviewStageSize({ width: 0, height: 0 })
      setBoxH(0)
      setBoxW(0)
      setVideoDuration(0)
      setSubtitleRegion(undefined)
    } else if (nextVideo) {
      // Handoff thu hai co the dung lai cung video nhung SRT moi. React khong doi
      // `src`, vi vay loadedmetadata khong phat lai; giu metadata va khoi phuc tu
      // HTMLVideoElement neu mot phien cu da tung ghi kich thuoc ve 0.
      const element = videoRef.current
      const width = element?.videoWidth || videoW
      const height = element?.videoHeight || videoH
      if (width > 0 && height > 0) {
        setVideoW(width)
        setVideoH(height)
        if (element && Number.isFinite(element.duration)) setVideoDuration(element.duration)
        // Moi handoff la mot draft moi: giu metadata cua cung video, nhung dua
        // khung phu de ve bo cuc mac dinh de khong ke thua vung keo meo tu draft cu.
        setSubtitleRegion(defaultSubtitleRegion(width, height))
      }
    }
    setSubtitlePath(draft.srt || '')
    setSubtitleEnabled(Boolean(draft.srt))
    setPreviewFile({ cues: [], duration: 0, warnings: [] })
    setSubtitleError(null)
    setBlurEnabled(false)
    setBlurRegions([])
    setActiveBlurId(null)
    setAudioEnabled(false)
    setAudioFile('')
    setSourceVolume(100)
    setTool('subtitle')
    if (draft.outputDir) setOutputDir(draft.outputDir)
    setBurnState('idle')
    setBurnOutput('')
    setBurnError(null)
  }, [burnState, draft, setOutputDir, subtitlePath, video, videoH, videoW])

  useEffect(() => {
    if (!fontsLoaded || fontId === 'auto' || fonts.some((font) => font.id === fontId)) return
    setFontId('auto')
    setFontLoadState('idle')
    setFontMessage('Font của phiên bản cũ không còn trong bộ font mới. T-blao đã chuyển sang Tự động.')
  }, [fontId, fonts, fontsLoaded, setFontId])

  useEffect(() => {
    let cancelled = false
    if (!video) {
      setHasOriginalAudio(false)
      return
    }
    // Fail-open: neu ffprobe tam thoi khong doc duoc, giu tieng video thay vi
    // vo tinh lam preview im lang.
    setHasOriginalAudio(true)
    void api
      .probeBurnMedia(video)
      .then((result) => {
        if (!cancelled && result.ok && result.meta) {
          setHasOriginalAudio(Boolean(result.meta.hasAudio))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api.probeBurnMedia, video])

  useLayoutEffect(() => {
    const shell = stageShellRef.current
    const fullscreenTarget = previewPanelRef.current
    if (!shell || !fullscreenTarget) return

    let frame = 0
    const scheduleMeasure = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(measureStage)
    }
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(shell)
    scheduleMeasure()

    let fullscreenFrame = 0
    const handleFullscreenChange = (): void => {
      setIsStageFullscreen(document.fullscreenElement === fullscreenTarget)
      if (document.fullscreenElement === fullscreenTarget || document.fullscreenElement == null) {
        setFullscreenError(null)
      }
      window.cancelAnimationFrame(fullscreenFrame)
      fullscreenFrame = window.requestAnimationFrame(() => {
        fullscreenFrame = window.requestAnimationFrame(measureStage)
      })
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)

    // Pane chuyen tu display:none sang flex trong cung mot render. Doi them mot
    // frame de grid/flex cua content-body co kich thuoc cuoi cung roi moi anh xa.
    let activationFrame = 0
    if (active) {
      activationFrame = window.requestAnimationFrame(() => {
        activationFrame = window.requestAnimationFrame(measureStage)
      })
    }

    return () => {
      observer.disconnect()
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(fullscreenFrame)
      window.cancelAnimationFrame(activationFrame)
    }
  }, [active, measureStage, video])

  useEffect(() => {
    if (!subtitlePath) {
      setPreviewFile({ cues: [], duration: 0, warnings: [] })
      setSubtitleError(null)
      setLayoutPlan(null)
      setLayoutError(null)
      return
    }

    let cancelled = false
    setSubtitleError(null)
    setPreviewFile({ cues: [], duration: 0, warnings: [] })
    setLayoutPlan(null)
    setLayoutError(null)
    const parse = api.parseSubtitleFile
    if (!parse) {
      void window.api
        .srtGiay(subtitlePath)
        .then((duration) => {
          if (!cancelled) setPreviewFile({ cues: [], duration: duration || 0, warnings: [] })
        })
        .catch(() => {
          if (!cancelled) setSubtitleError('Không thể đọc tệp phụ đề này.')
        })
      return () => {
        cancelled = true
      }
    }

    void parse(subtitlePath)
      .then((result) => {
        if (cancelled) return
        setPreviewFile(result)
        setSubtitleError(result.error || null)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewFile({ cues: [], duration: 0, warnings: [] })
          setSubtitleError(error instanceof Error ? error.message : 'Không thể đọc tệp phụ đề này.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [api.parseSubtitleFile, subtitlePath])

  useEffect(() => {
    if (
      !subtitleEnabled ||
      !subtitlePath ||
      previewFile.cues.length === 0 ||
      videoW <= 0 ||
      videoH <= 0
    ) {
      setLayoutPlan(null)
      setLayoutLoading(false)
      return
    }

    let cancelled = false
    setLayoutLoading(true)
    setLayoutError(null)
    const timer = window.setTimeout(() => {
      void api
        .planSubtitleLayout({
          path: subtitlePath,
          videoWidth: videoW,
          videoHeight: videoH,
          subRegion: subtitleRegion,
          fontId,
          bgEnabled,
          profile: layoutProfile,
          autoOptimize
        })
        .then((plan) => {
          if (!cancelled) setLayoutPlan(plan)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setLayoutPlan(null)
          setLayoutError(friendlyIpcMessage(error, 'Không thể tối ưu bố cục phụ đề. Hãy thử lại.'))
        })
        .finally(() => {
          if (!cancelled) setLayoutLoading(false)
        })
    }, 140)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    api,
    autoOptimize,
    bgEnabled,
    fontId,
    layoutProfile,
    previewFile.cues.length,
    subtitleEnabled,
    subtitlePath,
    subtitleRegion,
    videoH,
    videoW
  ])

  useEffect(() => {
    let cancelled = false
    let loadedFace: FontFace | null = null

    const previewFontId = fontId === 'auto' ? automaticFontId : fontId
    if (!previewFontId) {
      setPreviewFontFamily('')
      setFontLoadState('idle')
      setFontMessage('T-blao sẽ chọn font phù hợp khi xuất video.')
      return
    }

    const entry = fonts.find((font) => font.id === previewFontId)
    if (!entry) {
      setPreviewFontFamily('')
      setFontLoadState('error')
      setFontMessage('Font đã chọn không còn trên máy.')
      return
    }

    const family = `TblaoPreview_${entry.id.replace(/[^a-z0-9_-]/gi, '_')}`
    setFontLoadState('loading')
    setFontMessage('Đang áp dụng font lên bản xem trước…')

    void (async () => {
      try {
        const result = await api.loadBurnFontData(entry.id)
        if (cancelled) return

        const face = new FontFace(family, result.data)
        loadedFace = await face.load()
        if (cancelled) return
        document.fonts.add(loadedFace)
        if (!document.fonts.check(`24px "${family}"`)) {
          throw new Error('Trình hiển thị chưa nhận diện được font này.')
        }
        setPreviewFontFamily(family)
        setFontLoadState('ready')
        setFontMessage(
          fontId === 'auto'
            ? `Tự động theo nội dung · ${entry.label}`
            : `Đang xem trước bằng ${entry.label}.`
        )
      } catch (error) {
        if (cancelled) return
        setPreviewFontFamily('')
        setFontLoadState('error')
        setFontMessage(
          error instanceof Error
            ? `${error.message} Bản xem trước đang dùng font mặc định.`
            : 'Không thể xem trước font này. Video vẫn sẽ thử dùng font đã chọn.'
        )
      }
    })()

    return () => {
      cancelled = true
      if (loadedFace) document.fonts.delete(loadedFace)
    }
  }, [api.loadBurnFontData, automaticFontId, fontId, fonts])

  const chooseVideo = async (): Promise<void> => {
    if (burnState === 'running') return
    const files = await window.api.chooseFiles()
    if (!files.length) return
    setVideo(files[0])
    setVideoH(0)
    setVideoW(0)
    setPreviewStageSize({ width: 0, height: 0 })
    setBoxH(0)
    setBoxW(0)
    setVideoDuration(0)
    setBlurRegions([])
    setSubtitleRegion(undefined)
    setBurnState('idle')
    setBurnOutput('')
    setBurnError(null)
  }

  const chooseSubtitle = async (): Promise<void> => {
    if (burnState === 'running') return
    const path = await window.api.chooseSrt(outputDir || null)
    if (!path) return
    setSubtitlePath(path)
    setSubtitleEnabled(true)
    setTool('subtitle')
  }

  const chooseAudio = async (): Promise<void> => {
    if (burnState === 'running') return
    const path = await window.api.chooseAudio()
    if (!path) return
    setAudioFile(path)
    setAudioEnabled(true)
  }

  const onMetadata = (): void => {
    const element = videoRef.current
    if (!element) return
    const width = element.videoWidth
    const height = element.videoHeight
    setVideoW(width)
    setVideoH(height)
    setVideoDuration(Number.isFinite(element.duration) ? element.duration : 0)
    requestAnimationFrame(measureStage)

    if (!subtitleRegion && width > 0 && height > 0) {
      setSubtitleRegion(defaultSubtitleRegion(width, height))
    }
    if (blurRegions.length === 0 && width > 0 && height > 0) {
      const first: BlurRegion = {
        id: 'blur-1',
        x0: Math.round(width * 0.15),
        x1: Math.round(width * 0.85),
        y0: Math.round(height * 0.75),
        y1: height,
        color: PALETTE[0]
      }
      setBlurRegions([first])
      setActiveBlurId(first.id)
    }
  }

  const addBlurRegion = (): void => {
    if (burnState === 'running') return
    if (videoW <= 0 || videoH <= 0) return
    const index = blurRegions.length
    const id = `blur-${Date.now()}`
    const region: BlurRegion = {
      id,
      x0: Math.round(videoW * 0.18),
      x1: Math.round(videoW * 0.82),
      y0: Math.round(videoH * Math.max(0.08, 0.7 - index * 0.06)),
      y1: Math.round(videoH * Math.max(0.22, 0.82 - index * 0.06)),
      color: PALETTE[index % PALETTE.length]
    }
    setBlurRegions((current) => [...current, region])
    setActiveBlurId(id)
  }

  const updateBlurRegion = (region: BlurRegion): void => {
    setBlurRegions((current) => current.map((item) => (item.id === region.id ? region : item)))
  }

  const removeBlurRegion = (id: string): void => {
    setBlurRegions((current) => {
      const next = current.filter((item) => item.id !== id)
      if (activeBlurId === id) setActiveBlurId(next[0]?.id || null)
      return next
    })
  }

  const importFonts = async (): Promise<void> => {
    setFontMutationNotice(null)
    let result
    try {
      result = await api.importBurnFonts()
    } catch (error) {
      setFontLoadState('error')
      setFontMessage(error instanceof Error ? error.message : 'Không thể thêm font này.')
      return
    }
    if (result.fonts?.length) {
      await refreshFonts()
      setFontId(result.fonts[0].id)
    }
    if (!result.ok) {
      setFontLoadState('error')
      setFontMessage(result.error || 'Không thể thêm font này.')
      return
    }
    if (result.error) {
      setFontMutationNotice(result.error)
    }
  }

  const removeSelectedFont = async (): Promise<void> => {
    const selected = fonts.find((font) => font.id === fontId)
    if (!selected || selected.source !== 'custom') return
    let result
    try {
      result = await api.removeCustomBurnFont(selected.id)
    } catch (error) {
      setFontLoadState('error')
      setFontMessage(error instanceof Error ? error.message : 'Không thể xóa font này.')
      return
    }
    if (!result.ok) {
      setFontLoadState('error')
      setFontMessage(result.error || 'Không thể xóa font này.')
      return
    }
    setFontId('auto')
    await refreshFonts()
  }

  const exportVideo = async (): Promise<void> => {
    if (!video) {
      setBurnError('Hãy chọn video cần biên tập.')
      setBurnState('error')
      return
    }
    if (!outputDir) {
      setBurnError('Hãy chọn thư mục lưu video.')
      setBurnState('error')
      return
    }
    if (!subtitleEnabled && !blurEnabled && !audioEnabled) {
      setBurnError('Hãy bật ít nhất một thay đổi trước khi xuất video.')
      setBurnState('error')
      return
    }
    if (subtitleEnabled && !subtitlePath) {
      setBurnError('Hãy chọn tệp phụ đề (.srt).')
      setBurnState('error')
      return
    }
    if (subtitleEnabled && (subtitleError || previewFile.cues.length === 0)) {
      setBurnError(subtitleError || 'File phụ đề chưa có câu nào với mốc thời gian hợp lệ.')
      setBurnState('error')
      return
    }
    if (subtitleEnabled && (layoutLoading || !layoutPlan)) {
      setBurnError(
        layoutError ||
          (layoutLoading
            ? 'T-blao đang căn lại phụ đề. Hãy đợi một chút rồi xuất video.'
            : 'Chưa thể kiểm tra bố cục phụ đề. Hãy thử chọn lại file phụ đề.')
      )
      setBurnState('error')
      return
    }
    if (
      subtitleEnabled &&
      layoutPlan &&
      layoutPlan.summary.errorCueCount > 0 &&
      !window.confirm(
        `${layoutPlan.summary.errorCueCount} đoạn chữ vẫn quá nhanh hoặc chưa vừa vùng hiển thị. ` +
          'Bạn vẫn muốn xuất video?'
      )
    ) {
      setBurnState('idle')
      return
    }
    if (blurEnabled && blurRegions.length === 0) {
      setBurnError('Hãy thêm ít nhất một vùng làm mờ.')
      setBurnState('error')
      return
    }

    // Khong de ban nghe thu tiep tuc phat trong luc FFmpeg dang xuat.
    videoRef.current?.pause()

    setBurnState('running')
    setBurnPercent(0)
    setBurnError(null)
    setBurnOutput('')
    const off = window.api.onBurnProgress((progress) => {
      setBurnPercent(progress.percent < 0 ? 0 : progress.percent)
    })

    const request = {
      video,
      srt: subtitleEnabled ? subtitlePath : null,
      outputDir,
      mode: 'burn',
      blurRegions: blurEnabled ? blurRegions : [],
      lamMo: blurEnabled,
      subRegion: subtitleEnabled ? subtitleRegion : undefined,
      batAmThanh: audioEnabled,
      amThanhFile: audioEnabled ? audioFile : null,
      amLuongGoc: sourceVolume,
      fontId: fontId || 'auto',
      textColor,
      outlineColor,
      outlinePx,
      bgEnabled,
      bgColor,
      bgOpacity,
      subtitleDisplayStyle: displayStyle,
      highlightColor,
      subtitleHighlightPop: highlightPop,
      subtitleLayoutProfile: layoutProfile,
      subtitleAutoOptimize: autoOptimize
    } as BurnReq & {
      subtitleDisplayStyle: SubtitleDisplayStyle
      highlightColor: string
      subtitleHighlightPop: boolean
    }

    let result: BurnResult
    try {
      result = await window.api.burnStart(request)
    } catch (error) {
      setBurnState('error')
      setBurnError(
        error instanceof Error ? error.message : 'Không thể kết nối với tiến trình xuất video.'
      )
      return
    } finally {
      off()
    }

    if (!result.ok) {
      if (result.error === 'Đã huỷ.') {
        setBurnState('idle')
        return
      }
      setBurnState('error')
      setBurnError(result.error || 'Không thể xuất video.')
      return
    }
    setBurnOutput(result.output || '')
    setBurnState('done')
  }

  const seekToCue = (cue: PreviewSubtitleCue): void => {
    seekTo(Math.max(0, cue.start + 0.001))
  }

  const seekFromRail = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest('.cue-segment')) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
    seekTo(ratio * railDuration)
  }

  const toggleStageFullscreen = async (): Promise<void> => {
    const fullscreenTarget = previewPanelRef.current
    if (!fullscreenTarget) return
    try {
      setFullscreenError(null)
      if (document.fullscreenElement === fullscreenTarget) {
        await document.exitFullscreen()
        return
      }
      if (document.fullscreenElement) await document.exitFullscreen()
      await fullscreenTarget.requestFullscreen()
    } catch {
      setFullscreenError('Không thể mở toàn màn hình. Hãy thử lại hoặc nhấn Esc để thoát.')
    }
  }

  const activeCueIds = new Set(
    activeCues.map((cue) => ('sourceCueId' in cue ? cue.sourceCueId : cue.id))
  )
  const cueStep = Math.max(1, Math.ceil(previewFile.cues.length / 700))
  const railCues = useMemo(() => {
    const selected = previewFile.cues.filter((_, index) => index % cueStep === 0)
    const selectedIds = new Set(selected.map((cue) => cue.id))
    for (const cue of activeCues) {
      if (!selectedIds.has(cue.id)) selected.push(cue)
    }
    return selected
  }, [activeCues, cueStep, previewFile.cues])

  return (
    <div className="video-editor">
      <div className="editor-sourcebar" aria-label="Nguồn biên tập">
        <button className="editor-source" disabled={burnState === 'running'} onClick={chooseVideo}>
          <span className="editor-source-icon">▸</span>
          <span>
            <small>Video</small>
            <strong title={video || undefined}>{video ? baseName(video) : 'Chọn video'}</strong>
          </span>
        </button>
        <button className="editor-source" disabled={burnState === 'running'} onClick={chooseSubtitle}>
          <span className="editor-source-icon">CC</span>
          <span>
            <small>Phụ đề</small>
            <strong title={subtitlePath || undefined}>
              {subtitlePath ? baseName(subtitlePath) : 'Chọn tệp SRT'}
            </strong>
          </span>
        </button>
        <button
          className="editor-source editor-source-output"
          disabled={burnState === 'running'}
          onClick={async () => {
            const path = await window.api.chooseFolder()
            if (path) setOutputDir(path)
          }}
        >
          <span className="editor-source-icon">↗</span>
          <span>
            <small>Lưu tại</small>
            <strong title={outputDir || undefined}>{outputDir ? baseName(outputDir) : 'Chọn thư mục'}</strong>
          </span>
        </button>
        <button
          className="btn primary editor-export-top"
          disabled={burnState === 'running'}
          onClick={exportVideo}
        >
          {burnState === 'running' ? `Đang xuất ${burnPercent}%` : 'Xuất video'}
        </button>
      </div>

      <div className="editor-workspace">
        <section ref={previewPanelRef} className="editor-canvas-panel" aria-label="Xem trước video">
          <div className="editor-stage-head">
            <div>
              <span className="editor-eyebrow">Bản xem trước</span>
              <span className="editor-timecode">
                {formatTime(currentTime)} / {formatTime(videoDuration)}
              </span>
            </div>
            <div className="editor-stage-status">
              {fullscreenError
                ? fullscreenError
                : subtitleError
                ? 'Phụ đề chưa hợp lệ'
                : layoutError
                  ? 'Chưa thể kiểm tra bố cục'
                  : layoutLoading
                    ? 'Đang căn lại phụ đề'
                    : layoutPlan && layoutPlan.summary.errorCueCount > 0
                      ? `${layoutPlan.summary.errorCueCount} lỗi hiển thị`
                      : layoutPlan && layoutPlan.summary.warningCueCount > 0
                        ? `${layoutPlan.summary.warningCueCount} gợi ý khả năng đọc`
                : subtitlePath && previewFile.cues.length > 0
                  ? `${previewFile.cues.length} đoạn phụ đề`
                  : subtitlePath
                    ? 'Đang đọc phụ đề'
                    : 'Chưa có phụ đề'}
            </div>
          </div>

          <div ref={stageShellRef} className="editor-stage-shell">
            {video ? (
              <div
                className="ocr-video editor-stage-video"
                style={
                  videoW > 0 && videoH > 0
                    ? ({
                        aspectRatio: `${videoW} / ${videoH}`,
                        ['--ocr-ar']: String(videoW / videoH),
                        width: previewStageSize.width > 0 ? `${previewStageSize.width}px` : undefined,
                        height: previewStageSize.height > 0 ? `${previewStageSize.height}px` : undefined
                      } as CSSProperties)
                    : undefined
                }
              >
                <video
                  ref={videoRef}
                  crossOrigin="anonymous"
                  src={localMediaSource(video)}
                  onLoadedMetadata={onMetadata}
                  onClick={() => void togglePreviewPlayback()}
                  aria-label={isPlaying ? 'Tạm dừng video' : 'Phát video'}
                />
                {videoH > 0 && (
                  <RegionBox
                    regions={blurEnabled ? blurRegions : []}
                    activeId={activeBlurId}
                    setActiveId={setActiveBlurId}
                    updateRegion={updateBlurRegion}
                    removeRegion={removeBlurRegion}
                    blurInteractive={tool === 'blur'}
                    hienSubBox={subtitleEnabled}
                    subInteractive={tool === 'subtitle'}
                    subRegion={subtitleRegion}
                    setSubRegion={setSubtitleRegion}
                    videoH={videoH}
                    videoW={videoW}
                    boxH={boxH}
                    boxW={boxW}
                    xemMo={blurEnabled && tool === 'blur'}
                    showBlurEffect={blurEnabled}
                    previewFontFamily={previewFontFamily || undefined}
                    subtitleText={subtitlePath ? activeText : undefined}
                    subtitleCues={activeCues}
                    subtitleTime={currentTime}
                    subtitleDisplayStyle={displayStyle}
                    subtitleFontSize={layoutPlan?.options.fontSize}
                    highlightColor={highlightColor}
                    highlightPop={highlightPop}
                    textColor={textColor}
                    outlineColor={outlineColor}
                    outlinePx={outlinePx}
                    bgEnabled={bgEnabled}
                    bgColor={bgColor}
                    bgOpacity={bgOpacity}
                    showSafeArea={showSafeArea}
                  />
                )}
              </div>
            ) : (
              <button className="editor-empty-stage" onClick={chooseVideo}>
                <span className="editor-empty-mark">▶</span>
                <strong>Chọn video để bắt đầu</strong>
                <small>Phụ đề, vùng làm mờ và kết quả sẽ hiển thị tại đây.</small>
              </button>
            )}
          </div>

          <div className="cue-rail" aria-label="Các đoạn phụ đề">
            <div className="cue-transport" aria-label="Điều khiển xem trước">
              <button
                type="button"
                className="cue-transport-button cue-play-toggle"
                onClick={() => void togglePreviewPlayback()}
                aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
                title={isPlaying ? 'Tạm dừng' : 'Phát'}
              >
                <span aria-hidden="true">{isPlaying ? '❚❚' : '▶'}</span>
              </button>
              <span className="cue-transport-time">{formatTime(currentTime)}</span>
              <div
                className="cue-rail-track"
                onClick={seekFromRail}
                title="Nhấp vào thanh để tua video"
              >
                {railCues.map((cue) => {
                  const left = Math.max(0, Math.min(100, (cue.start / railDuration) * 100))
                  const width = Math.max(
                    0.35,
                    Math.min(100 - left, ((cue.end - cue.start) / railDuration) * 100)
                  )
                  const health = cueHealthById.get(cue.id)
                  const issue = health?.issues.find((item) => item.level !== 'good') ?? health?.issues[0]
                  return (
                    <button
                      key={cue.id}
                      className={`cue-segment health-${health?.level ?? 'unknown'} ${activeCueIds.has(cue.id) ? 'active' : ''}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      onClick={() => seekToCue(cue)}
                      title={`${formatTime(cue.start)} · ${issue?.message || cue.text.replace(/\s+/g, ' ')}`}
                    />
                  )
                })}
                <span
                  className="cue-playhead"
                  style={{ left: `${Math.min(100, (currentTime / railDuration) * 100)}%` }}
                />
              </div>
              <span className="cue-transport-time">{formatTime(railDuration)}</span>
              <button
                type="button"
                className="cue-transport-button cue-mute-toggle"
                onClick={toggleMuted}
                aria-label={muted || volume === 0 ? 'Bật tiếng' : 'Tắt tiếng'}
                title={muted || volume === 0 ? 'Bật tiếng' : 'Tắt tiếng'}
              >
                <span aria-hidden="true">{muted || volume === 0 ? '🔇' : '🔊'}</span>
              </button>
              <input
                className="cue-volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(event) => changeVolume(Number(event.target.value))}
                aria-label="Âm lượng nghe thử"
                title={`Âm lượng nghe thử ${Math.round((muted ? 0 : volume) * 100)}% · không áp dụng khi xuất`}
              />
              <select
                className="cue-playback-rate"
                value={playbackRate}
                onChange={(event) => changePlaybackRate(Number(event.target.value))}
                aria-label="Tốc độ phát"
                title="Tốc độ phát"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <option key={rate} value={rate}>{rate}×</option>
                ))}
              </select>
              <button
                type="button"
                className="cue-transport-button cue-fullscreen-toggle"
                onClick={() => void toggleStageFullscreen()}
                aria-pressed={isStageFullscreen}
                aria-label={isStageFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'}
                title={isStageFullscreen ? 'Thoát toàn màn hình (Esc)' : 'Xem toàn màn hình'}
              >
                <span aria-hidden="true">{isStageFullscreen ? '×' : '⛶'}</span>
              </button>
            </div>
            <div className="cue-rail-caption">
              <span className="cue-rail-current">
                {activeCue ? activeCue.text.replace(/\s+/g, ' ') : 'Nhấp một đoạn để tua video'}
              </span>
              <span className="cue-rail-legend" aria-label="Chú giải đánh giá phụ đề">
                <span><i className="good" />Ổn</span>
                <span><i className="warning" />Gợi ý</span>
                <span><i className="error" />Lỗi hiển thị</span>
              </span>
            </div>
          </div>
        </section>

        <aside className="editor-inspector">
          <div className="editor-tools" role="tablist" aria-label="Công cụ biên tập">
            <button
              className={tool === 'subtitle' ? 'active' : ''}
              onClick={() => setTool('subtitle')}
              role="tab"
            >
              Phụ đề
            </button>
            <button
              className={tool === 'blur' ? 'active' : ''}
              onClick={() => setTool('blur')}
              role="tab"
            >
              Làm mờ
            </button>
            <button
              className={tool === 'audio' ? 'active' : ''}
              onClick={() => setTool('audio')}
              role="tab"
            >
              Lồng tiếng
            </button>
          </div>

          <div className="editor-inspector-scroll">
            {tool === 'subtitle' && (
              <>
                <div className="editor-section-head">
                  <div>
                    <strong>Kiểu phụ đề</strong>
                    <small>Áp dụng đồng thời cho xem trước và video xuất.</small>
                  </div>
                  <label className="editor-switch">
                    <input
                      type="checkbox"
                      checked={subtitleEnabled}
                      onChange={(event) => setSubtitleEnabled(event.target.checked)}
                    />
                    <span>{subtitleEnabled ? 'Bật' : 'Tắt'}</span>
                  </label>
                </div>

                <div className="subtitle-style-options">
                  {(
                    [
                      ['standard', 'Hiển thị cả câu', 'Ổn định và dễ đọc'],
                      ['word-reveal', 'Hiện lần lượt từng từ', 'Từ đã hiện được giữ lại'],
                      ['word-highlight', 'Làm nổi bật từ đang đọc', 'Toàn câu luôn hiển thị']
                    ] as const
                  ).map(([value, label, note]) => (
                    <label
                      key={value}
                      className={`subtitle-style-option ${displayStyle === value ? 'active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="subtitle-display-style"
                        value={value}
                        checked={displayStyle === value}
                        onChange={() => setDisplayStyle(value)}
                      />
                      <span className="subtitle-style-signal" aria-hidden="true" />
                      <span>
                        <strong>{label}</strong>
                        <small>{note}</small>
                      </span>
                    </label>
                  ))}
                </div>

                {displayStyle === 'word-highlight' && (
                  <div className="highlight-effect-controls">
                    <label className="field editor-field">
                      <span>Màu từ đang đọc</span>
                      <input
                        type="color"
                        value={highlightColor}
                        disabled={burnState === 'running'}
                        onChange={(event) => setHighlightColor(event.target.value)}
                      />
                    </label>
                    <div className="highlight-pop-control">
                      <div>
                        <strong>Nhấn nhẹ từ đang đọc</strong>
                        <small>Phóng nhẹ rồi trở về, không làm xô dòng chữ.</small>
                      </div>
                      <label className="editor-switch">
                        <input
                          type="checkbox"
                          checked={highlightPop}
                          disabled={burnState === 'running'}
                          onChange={(event) => setHighlightPop(event.target.checked)}
                        />
                        <span>{highlightPop ? 'Bật' : 'Tắt'}</span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="subtitle-layout-card">
                  <div className="subtitle-layout-head">
                    <div>
                      <strong>Tự tối ưu phụ đề</strong>
                      <small>Giữ chữ gọn trong khung mà không sửa file SRT gốc.</small>
                    </div>
                    <label className="editor-switch">
                      <input
                        type="checkbox"
                        checked={autoOptimize}
                        disabled={burnState === 'running'}
                        onChange={(event) => setAutoOptimize(event.target.checked)}
                      />
                      <span>{autoOptimize ? 'Bật' : 'Tắt'}</span>
                    </label>
                  </div>
                  <label className="field editor-field">
                    <span>Nhịp hiển thị</span>
                    <select
                      value={layoutProfile}
                      disabled={burnState === 'running'}
                      onChange={(event) => setLayoutProfile(event.target.value as SubtitleLayoutProfile)}
                    >
                      <option value="readable">Dễ đọc · tối đa 2 dòng</option>
                      <option value="social">Social · nhịp nhanh</option>
                      <option value="vertical">Video dọc · tối đa 3 dòng</option>
                    </select>
                  </label>
                  <label className="gk-check editor-check subtitle-safe-toggle">
                    <input
                      type="checkbox"
                      checked={showSafeArea}
                      onChange={(event) => setShowSafeArea(event.target.checked)}
                    />
                    <span>Hiện vùng an toàn trên bản xem trước</span>
                  </label>

                  {layoutPlan && (
                    <div className="subtitle-plan-summary" aria-live="polite">
                      <span>{layoutPlan.summary.cueCount} đoạn</span>
                      <span>{layoutPlan.summary.splitCueCount} đoạn đã chia</span>
                      {layoutPlan.summary.warningCueCount > 0 && (
                        <span className="warning">
                          {layoutPlan.summary.warningCueCount} gợi ý
                        </span>
                      )}
                      <span className={layoutPlan.summary.errorCueCount > 0 ? 'danger' : 'success'}>
                        {layoutPlan.summary.errorCueCount > 0
                          ? `${layoutPlan.summary.errorCueCount} lỗi hiển thị`
                          : 'Hiển thị ổn'}
                      </span>
                    </div>
                  )}
                  {activeHealth && (
                    <div className={`subtitle-cue-health ${activeHealth.level}`}>
                      <strong>
                        {activeHealth.level === 'good'
                          ? 'Hiển thị tốt'
                          : activeHealth.level === 'warning'
                            ? 'Gợi ý khả năng đọc'
                            : 'Có lỗi hiển thị'}
                      </strong>
                      <span>
                        {activeHealth.lineCount} dòng · {activeHealth.duration.toFixed(1)} giây
                      </span>
                      {activeIssue && <small>{activeIssue.message}</small>}
                    </div>
                  )}
                  {layoutLoading && <div className="muted small">Đang căn lại phụ đề…</div>}
                  {layoutError && <div className="dy-err small">{layoutError}</div>}
                </div>

                <div className="editor-section-divider" />

                <label className="field editor-field">
                  <span>Font chữ</span>
                  <select
                    value={fontId}
                    disabled={burnState === 'running'}
                    onChange={(event) => setFontId(event.target.value)}
                  >
                    <option value="auto">Tự động theo nội dung</option>
                    {groupedFonts.map(([group, entries]) => (
                      <optgroup key={group} label={group}>
                        {entries.map((font) => (
                          <option key={font.id} value={font.id}>
                            {font.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <div className={`font-preview-status ${fontLoadState}`}>
                  <span className="font-preview-dot" />
                  <span>{fontMessage || 'Chọn font để xem trực tiếp trên video.'}</span>
                </div>
                <div className="editor-inline-actions">
                    <button className="btn" disabled={burnState === 'running'} onClick={importFonts}>
                      Thêm font từ máy
                    </button>
                    {fonts.find((font) => font.id === fontId)?.source === 'custom' && (
                      <button
                        className="btn danger"
                        disabled={burnState === 'running'}
                        onClick={removeSelectedFont}
                      >
                        Xóa font
                      </button>
                    )}
                </div>
                {fontMutationNotice && <div className="dy-err small">{fontMutationNotice}</div>}

                <div className="editor-color-grid">
                  <label className="field editor-field">
                    <span>Màu chữ</span>
                    <input
                      type="color"
                      value={textColor}
                      onChange={(event) => setTextColor(event.target.value)}
                    />
                  </label>
                  <label className="field editor-field">
                    <span>Màu viền</span>
                    <input
                      type="color"
                      value={outlineColor}
                      onChange={(event) => setOutlineColor(event.target.value)}
                    />
                  </label>
                </div>
                <label className="field editor-field">
                  <span>Độ dày viền · {outlinePx}px</span>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    step={0.5}
                    value={outlinePx}
                    onChange={(event) => setOutlinePx(Number(event.target.value))}
                  />
                </label>
                <label className="gk-check editor-check">
                  <input
                    type="checkbox"
                    checked={bgEnabled}
                    onChange={(event) => setBgEnabled(event.target.checked)}
                  />
                  <span>Thêm nền sau chữ</span>
                </label>
                {bgEnabled && (
                  <div className="editor-color-grid">
                    <label className="field editor-field">
                      <span>Màu nền</span>
                      <input
                        type="color"
                        value={bgColor}
                        onChange={(event) => setBgColor(event.target.value)}
                      />
                    </label>
                    <label className="field editor-field">
                      <span>Độ đậm · {bgOpacity}%</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={bgOpacity}
                        onChange={(event) => setBgOpacity(Number(event.target.value))}
                      />
                    </label>
                  </div>
                )}

                {subtitleError && <div className="dy-err small">{subtitleError}</div>}
                {previewFile.warnings.length > 0 && (
                  <details className="tech-details compact">
                    <summary>{previewFile.warnings.length} lưu ý trong tệp phụ đề</summary>
                    {previewFile.warnings.map((warning, index) => (
                      <div key={`${warning}-${index}`} className="muted small">{warning}</div>
                    ))}
                  </details>
                )}
              </>
            )}

            {tool === 'blur' && (
              <>
                <div className="editor-section-head">
                  <div>
                    <strong>Vùng làm mờ</strong>
                    <small>Kéo vùng màu trên video đến vị trí cần che.</small>
                  </div>
                  <label className="editor-switch">
                    <input
                      type="checkbox"
                      checked={blurEnabled}
                      onChange={(event) => setBlurEnabled(event.target.checked)}
                    />
                    <span>{blurEnabled ? 'Bật' : 'Tắt'}</span>
                  </label>
                </div>
                <button className="btn editor-wide-action" onClick={addBlurRegion} disabled={!video}>
                  + Thêm vùng làm mờ
                </button>
                <div className="blur-list">
                  {blurRegions.map((region, index) => (
                    <button
                      key={region.id}
                      className={`blur-item ${activeBlurId === region.id ? 'active' : ''}`}
                      onClick={() => setActiveBlurId(region.id)}
                    >
                      <span className="blur-color-badge" style={{ background: region.color }} />
                      <span className="blur-toado">
                        <b>Vùng {index + 1}</b>
                        <span className="blur-coords">{region.x0},{region.y0} → {region.x1},{region.y1}</span>
                      </span>
                      <span
                        className="blur-del-btn"
                        onClick={(event) => {
                          event.stopPropagation()
                          removeBlurRegion(region.id)
                        }}
                        title="Xóa vùng"
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {tool === 'audio' && (
              <>
                <div className="editor-section-head">
                  <div>
                    <strong>Lồng tiếng đã dịch</strong>
                    <small>Thêm tệp WAV chứa lời thoại đã dịch sang ngôn ngữ mới.</small>
                  </div>
                  <label className="editor-switch">
                    <input
                      type="checkbox"
                      checked={audioEnabled}
                      onChange={(event) => setAudioEnabled(event.target.checked)}
                    />
                    <span>{audioEnabled ? 'Bật' : 'Tắt'}</span>
                  </label>
                </div>
                <button className="btn editor-wide-action" onClick={chooseAudio}>
                  {audioFile ? 'Đổi tệp lồng tiếng' : 'Chọn tệp WAV lồng tiếng'}
                </button>
                <div className="editor-selected-file">
                  {audioFile ? baseName(audioFile) : 'Chưa chọn tệp WAV lồng tiếng'}
                </div>
                <div
                  className={`audio-preview-status is-${audioPreview.status}`}
                  role={audioPreview.status === 'error' ? 'alert' : 'status'}
                >
                  <span className="audio-preview-dot" aria-hidden="true" />
                  <span>
                    {!audioFile
                      ? 'Chọn WAV để nghe cùng video.'
                      : !audioEnabled
                        ? 'Tệp đã sẵn sàng · bật Lồng tiếng để nghe.'
                        : audioPreview.status === 'loading'
                          ? 'Đang chuẩn bị bản nghe thử…'
                          : audioPreview.status === 'fallback'
                            ? `Đã tạo bản nghe thử tương thích · ${formatTime(audioPreview.duration)}`
                            : audioPreview.status === 'ready'
                              ? `Sẵn sàng nghe thử · ${formatTime(audioPreview.duration)}`
                              : audioPreview.status === 'error'
                                ? audioPreview.error || 'Không thể nghe thử tệp này.'
                                : 'Chọn WAV để nghe cùng video.'}
                  </span>
                </div>
                <label className="field editor-field">
                  <span>Âm lượng âm thanh gốc · {sourceVolume}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sourceVolume}
                    disabled={!audioEnabled || burnState === 'running'}
                    onChange={(event) => setSourceVolume(Number(event.target.value))}
                  />
                </label>
                <p className="audio-preview-note">
                  Mức tiếng gốc này áp dụng cho cả bản nghe thử và video xuất.
                  Âm lượng trên thanh phát chỉ điều chỉnh lúc nghe thử.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>

      <footer className="editor-exportbar">
        <div className="editor-export-state">
          {burnState === 'running' && (
            <>
              <div className="bar"><div className="bar-fill" style={{ width: `${burnPercent}%` }} /></div>
              <span>Đang tạo video · {burnPercent}%</span>
            </>
          )}
          {burnState === 'done' && (
            <span>
              Đã tạo xong ·{' '}
              <button className="link-btn" onClick={() => window.api.showItem(burnOutput)}>
                {baseName(burnOutput)}
              </button>
            </span>
          )}
          {burnError && <span className="dy-err small">{burnError}</span>}
          {burnState === 'idle' && layoutPlan && subtitleEnabled ? (
            <span>
              {layoutPlan.summary.cueCount} đoạn · {layoutPlan.summary.splitCueCount} đoạn đã tự chia ·{' '}
              {layoutPlan.summary.errorCueCount > 0
                ? `${layoutPlan.summary.errorCueCount} lỗi hiển thị`
                : 'không có lỗi hiển thị'}
              {layoutPlan.summary.warningCueCount > 0
                ? ` · ${layoutPlan.summary.warningCueCount} gợi ý`
                : ''}
            </span>
          ) : burnState === 'idle' ? (
            <span>Thiết lập trên bản xem trước, sau đó xuất video.</span>
          ) : null}
        </div>
        {burnState === 'running' ? (
          <button className="btn danger" onClick={() => window.api.burnCancel()}>Dừng</button>
        ) : (
          <button className="btn primary" onClick={exportVideo}>Xuất video</button>
        )}
      </footer>
    </div>
  )
}
