import { useCallback, useEffect, useState, type RefObject } from 'react'

interface VideoTransportState {
  isPlaying: boolean
  muted: boolean
  volume: number
  playbackRate: number
  togglePlayback: () => Promise<void>
  seekTo: (seconds: number) => void
  toggleMuted: () => void
  changeVolume: (volume: number) => void
  changePlaybackRate: (rate: number) => void
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

/**
 * Dong bo thanh dieu khien rieng cua editor voi HTMLVideoElement. Native media
 * controls khong duoc dung o editor vi cac lop keo SRT/blur co the nam tren no.
 */
export function useVideoTransport(
  videoRef: RefObject<HTMLVideoElement | null>,
  sourceKey: string | null
): VideoTransportState {
  const [isPlaying, setIsPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [playbackRate, setPlaybackRate] = useState(1)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !sourceKey) {
      setIsPlaying(false)
      return
    }

    const syncPlayback = (): void => setIsPlaying(!video.paused && !video.ended)
    const syncRate = (): void => setPlaybackRate(video.playbackRate)

    video.addEventListener('play', syncPlayback)
    video.addEventListener('pause', syncPlayback)
    video.addEventListener('ended', syncPlayback)
    video.addEventListener('ratechange', syncRate)
    video.addEventListener('loadedmetadata', syncPlayback)
    syncPlayback()
    syncRate()

    return () => {
      video.removeEventListener('play', syncPlayback)
      video.removeEventListener('pause', syncPlayback)
      video.removeEventListener('ended', syncPlayback)
      video.removeEventListener('ratechange', syncRate)
      video.removeEventListener('loadedmetadata', syncPlayback)
    }
  }, [sourceKey, videoRef])

  const togglePlayback = useCallback(async (): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused && !video.ended) {
      video.pause()
      return
    }
    if (video.ended && Number.isFinite(video.duration)) video.currentTime = 0
    try {
      await video.play()
    } catch {
      // Trinh duyet co the tu choi play khi media chua san sang. Event media
      // se dong bo lai trang thai; user co the thu lai sau khi video nap xong.
    }
  }, [videoRef])

  const seekTo = useCallback(
    (seconds: number): void => {
      const video = videoRef.current
      if (!video || !Number.isFinite(seconds)) return
      const maximum = Number.isFinite(video.duration) ? Math.max(0, video.duration) : seconds
      video.currentTime = clamp(seconds, 0, maximum)
    },
    [videoRef]
  )

  const toggleMuted = useCallback((): void => {
    setMuted((current) => !current)
  }, [])

  const changeVolume = useCallback(
    (nextVolume: number): void => {
      if (!Number.isFinite(nextVolume)) return
      const safeVolume = clamp(nextVolume, 0, 1)
      setVolume(safeVolume)
      if (safeVolume > 0) setMuted(false)
    },
    []
  )

  const changePlaybackRate = useCallback(
    (rate: number): void => {
      const video = videoRef.current
      if (!video || !Number.isFinite(rate)) return
      video.playbackRate = clamp(rate, 0.5, 2)
    },
    [videoRef]
  )

  return {
    isPlaying,
    muted,
    volume,
    playbackRate,
    togglePlayback,
    seekTo,
    toggleMuted,
    changeVolume,
    changePlaybackRate
  }
}
