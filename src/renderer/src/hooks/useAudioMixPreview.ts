import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { audioMixGains } from '../../../shared/audioMix'
import { localMediaSource } from '../lib/localMedia'

export type AudioPreviewStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

interface AudioPreviewFallbackResult {
  ok: boolean
  path?: string
  error?: string
}

interface AudioMixPreviewOptions {
  videoRef: RefObject<HTMLVideoElement | null>
  videoKey: string | null
  audioPath: string
  enabled: boolean
  sourceVolume: number
  monitorVolume: number
  monitorMuted: boolean
  hasOriginalAudio: boolean
  prepareFallback: (input: string) => Promise<AudioPreviewFallbackResult>
}

interface AudioMixPreviewState {
  status: AudioPreviewStatus
  duration: number
  error: string | null
  preparePlayback: () => Promise<void>
}

interface AudioGraph {
  context: AudioContext
  originalGain: GainNode
  dubGain: GainNode
  masterGain: GainNode
}

const DRIFT_TOLERANCE_SECONDS = 0.075

function finiteDuration(media: HTMLMediaElement): number {
  return Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0
}

/**
 * Trộn tiếng video và tệp lồng tiếng trong bản xem trước. Video luôn là đồng
 * hồ chính; tệp lồng tiếng chỉ bám theo play/pause/seek/rate của video.
 */
export function useAudioMixPreview(options: AudioMixPreviewOptions): AudioMixPreviewState {
  const {
    videoRef,
    videoKey,
    audioPath,
    enabled,
    sourceVolume,
    monitorVolume,
    monitorMuted,
    hasOriginalAudio,
    prepareFallback
  } = options
  const dubAudio = useMemo(() => {
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    return audio
  }, [])
  const graphRef = useRef<AudioGraph | null>(null)
  const loadGenerationRef = useRef(0)
  const [status, setStatus] = useState<AudioPreviewStatus>('idle')
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const applyGains = useCallback((): void => {
    const graph = graphRef.current
    if (!graph) return
    const dubDuration = finiteDuration(dubAudio)
    const hasDubAudio = Boolean(audioPath) && dubAudio.readyState >= HTMLMediaElement.HAVE_METADATA
    const dubIsActive = hasDubAudio && (dubDuration <= 0 || dubAudio.currentTime < dubDuration)
    const gains = audioMixGains({
      enabled,
      sourceVolume,
      hasOriginalAudio,
      hasDubAudio,
      dubIsActive
    })
    const now = graph.context.currentTime
    graph.originalGain.gain.setTargetAtTime(gains.original, now, 0.01)
    graph.dubGain.gain.setTargetAtTime(gains.dub, now, 0.01)
    graph.masterGain.gain.setTargetAtTime(monitorMuted ? 0 : monitorVolume, now, 0.01)
  }, [audioPath, dubAudio, enabled, hasOriginalAudio, monitorMuted, monitorVolume, sourceVolume])

  const alignDubToVideo = useCallback((): void => {
    const video = videoRef.current
    if (!video || dubAudio.readyState < HTMLMediaElement.HAVE_METADATA) return
    const maximum = finiteDuration(dubAudio)
    const target = maximum > 0 ? Math.min(video.currentTime, maximum) : video.currentTime
    if (Math.abs(dubAudio.currentTime - target) > DRIFT_TOLERANCE_SECONDS) {
      dubAudio.currentTime = Math.max(0, target)
    }
    dubAudio.playbackRate = video.playbackRate
  }, [dubAudio, videoRef])

  const syncDubPlayback = useCallback(async (): Promise<void> => {
    const video = videoRef.current
    if (!video || !enabled || !audioPath || dubAudio.readyState < HTMLMediaElement.HAVE_METADATA) {
      dubAudio.pause()
      applyGains()
      return
    }
    const dubDuration = finiteDuration(dubAudio)
    if (video.paused || video.ended || (dubDuration > 0 && video.currentTime >= dubDuration)) {
      dubAudio.pause()
      applyGains()
      return
    }
    alignDubToVideo()
    try {
      await dubAudio.play()
    } catch {
      // preparePlayback() duoc goi tu thao tac cua user va se thu lai khi can.
    }
    applyGains()
  }, [alignDubToVideo, applyGains, audioPath, dubAudio, enabled, videoRef])

  const applyGainsRef = useRef(applyGains)
  const alignDubToVideoRef = useRef(alignDubToVideo)
  const syncDubPlaybackRef = useRef(syncDubPlayback)
  useEffect(() => {
    applyGainsRef.current = applyGains
    alignDubToVideoRef.current = alignDubToVideo
    syncDubPlaybackRef.current = syncDubPlayback
  }, [alignDubToVideo, applyGains, syncDubPlayback])

  const ensureGraph = useCallback(async (): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    let graph = graphRef.current
    if (!graph) {
      const AudioContextClass = window.AudioContext
      const context = new AudioContextClass()
      const originalSource = context.createMediaElementSource(video)
      const dubSource = context.createMediaElementSource(dubAudio)
      const originalGain = context.createGain()
      const dubGain = context.createGain()
      const masterGain = context.createGain()
      originalSource.connect(originalGain).connect(masterGain)
      dubSource.connect(dubGain).connect(masterGain)
      masterGain.connect(context.destination)
      video.volume = 1
      video.muted = false
      dubAudio.volume = 1
      dubAudio.muted = false
      graph = { context, originalGain, dubGain, masterGain }
      graphRef.current = graph
    }
    if (graph.context.state === 'suspended') await graph.context.resume()
    applyGains()
  }, [applyGains, dubAudio, videoRef])

  const preparePlayback = useCallback(async (): Promise<void> => {
    try {
      await ensureGraph()
      await syncDubPlayback()
    } catch {
      setStatus('error')
      setError('Trình phát không thể trộn hai nguồn âm thanh trên máy này.')
    }
  }, [ensureGraph, syncDubPlayback])

  useEffect(() => {
    applyGains()
    const video = videoRef.current
    if (!graphRef.current && video) {
      video.volume = monitorVolume
      video.muted = monitorMuted
    }
    if (!enabled) dubAudio.pause()
    else void syncDubPlayback()
  }, [applyGains, dubAudio, enabled, monitorMuted, monitorVolume, syncDubPlayback, videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoKey) return

    const onPlay = (): void => void syncDubPlayback()
    const onPause = (): void => {
      dubAudio.pause()
      applyGains()
    }
    const onSeeking = (): void => dubAudio.pause()
    const onSeeked = (): void => {
      alignDubToVideo()
      void syncDubPlayback()
    }
    const onRateChange = (): void => {
      dubAudio.playbackRate = video.playbackRate
    }
    const onTimeUpdate = (): void => {
      if (!video.paused) alignDubToVideo()
      applyGains()
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('playing', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onPause)
    video.addEventListener('ended', onPause)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('ratechange', onRateChange)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('playing', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onPause)
      video.removeEventListener('ended', onPause)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('ratechange', onRateChange)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [alignDubToVideo, applyGains, dubAudio, syncDubPlayback, videoKey, videoRef])

  useEffect(() => {
    const generation = ++loadGenerationRef.current
    dubAudio.pause()
    dubAudio.removeAttribute('src')
    dubAudio.load()
    setDuration(0)
    setError(null)
    if (!audioPath) {
      setStatus('idle')
      applyGainsRef.current()
      return
    }

    let fallbackAttempted = false
    let fallbackLoaded = false
    setStatus('loading')

    const onLoaded = (): void => {
      if (generation !== loadGenerationRef.current) return
      setDuration(finiteDuration(dubAudio))
      setStatus(fallbackLoaded ? 'fallback' : 'ready')
      alignDubToVideoRef.current()
      void syncDubPlaybackRef.current()
    }
    const onEnded = (): void => applyGainsRef.current()
    const onError = async (): Promise<void> => {
      if (generation !== loadGenerationRef.current) return
      if (fallbackAttempted) {
        if (fallbackLoaded) {
          setStatus('error')
          setError('Bản nghe thử tương thích vẫn không phát được trên máy này.')
          applyGainsRef.current()
        }
        return
      }
      fallbackAttempted = true
      setStatus('loading')
      const result = await prepareFallback(audioPath)
      if (generation !== loadGenerationRef.current) return
      if (!result.ok || !result.path) {
        setStatus('error')
        setError(result.error || 'Không thể chuẩn bị bản nghe thử cho tệp lồng tiếng này.')
        applyGainsRef.current()
        return
      }
      fallbackLoaded = true
      dubAudio.src = localMediaSource(result.path)
      dubAudio.load()
    }

    dubAudio.addEventListener('loadedmetadata', onLoaded)
    dubAudio.addEventListener('canplay', onLoaded)
    dubAudio.addEventListener('ended', onEnded)
    dubAudio.addEventListener('error', onError)
    dubAudio.src = localMediaSource(audioPath)
    dubAudio.load()

    return () => {
      dubAudio.removeEventListener('loadedmetadata', onLoaded)
      dubAudio.removeEventListener('canplay', onLoaded)
      dubAudio.removeEventListener('ended', onEnded)
      dubAudio.removeEventListener('error', onError)
    }
    // Chi nap lai media khi duong dan thay doi. Am luong, bat/tat va transport
    // duoc dong bo boi cac effect rieng, neu khong keo slider se lam WAV nap lai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPath, dubAudio, prepareFallback])

  useEffect(
    () => () => {
      loadGenerationRef.current += 1
      dubAudio.pause()
      dubAudio.removeAttribute('src')
      dubAudio.load()
      const graph = graphRef.current
      graphRef.current = null
      if (graph) void graph.context.close()
    },
    [dubAudio]
  )

  return { status, duration, error, preparePlayback }
}
