import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

export interface PreviewSubtitleCue {
  id: string
  start: number
  end: number
  text: string
  sourceIndex: number
}

interface SubtitlePreviewState<T extends PreviewSubtitleCue> {
  currentTime: number
  activeCues: T[]
}

function findActiveCues<T extends PreviewSubtitleCue>(
  cues: T[],
  prefixMaxEnd: number[],
  time: number
): T[] {
  if (cues.length === 0) return []

  // Tim cue cuoi cung da bat dau. Khi seek, binary search tranh quet lai ca file SRT.
  let low = 0
  let high = cues.length - 1
  let lastStarted = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (cues[mid].start <= time) {
      lastStarted = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  if (lastStarted < 0) return []

  // SRT co the co cue chong nhau. Lui toi cue dau con song roi gom tat ca cue active.
  let first = lastStarted
  // prefixMaxEnd giu lai cue dai nam truoc cac cue ngan da ket thuc.
  while (first > 0 && prefixMaxEnd[first - 1] > time) first -= 1
  const active: T[] = []
  for (let i = first; i <= lastStarted; i += 1) {
    const cue = cues[i]
    if (time >= cue.start && time < cue.end) active.push(cue)
  }
  return active
}

export function useSubtitlePreview<T extends PreviewSubtitleCue>(
  videoRef: RefObject<HTMLVideoElement | null>,
  cues: T[],
  sourceKey: string | null
): SubtitlePreviewState<T> {
  const [currentTime, setCurrentTime] = useState(0)
  const [activeIds, setActiveIds] = useState<string[]>([])
  const idsRef = useRef('')
  const prefixMaxEnd = useMemo(() => {
    let maximum = Number.NEGATIVE_INFINITY
    return cues.map((cue) => {
      maximum = Math.max(maximum, cue.end)
      return maximum
    })
  }, [cues])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !sourceKey) {
      setCurrentTime(0)
      setActiveIds([])
      idsRef.current = ''
      return
    }

    let frameId: number | null = null
    let animationId: number | null = null
    let disposed = false

    const update = (): void => {
      if (disposed) return
      const time = Number.isFinite(video.currentTime) ? video.currentTime : 0
      const active = findActiveCues(cues, prefixMaxEnd, time)
      const signature = active.map((cue) => cue.id).join('\u0000')
      setCurrentTime(time)
      if (signature !== idsRef.current) {
        idsRef.current = signature
        setActiveIds(active.map((cue) => cue.id))
      }
    }

    const schedule = (): void => {
      if (
        disposed ||
        video.paused ||
        video.ended ||
        frameId !== null ||
        animationId !== null
      ) return
      if ('requestVideoFrameCallback' in video) {
        frameId = video.requestVideoFrameCallback(() => {
          frameId = null
          update()
          schedule()
        })
      } else {
        animationId = requestAnimationFrame(() => {
          animationId = null
          update()
          schedule()
        })
      }
    }

    const cancelScheduled = (): void => {
      if (frameId !== null && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(frameId)
        frameId = null
      }
      if (animationId !== null) {
        cancelAnimationFrame(animationId)
        animationId = null
      }
    }

    const onPlay = (): void => {
      update()
      schedule()
    }
    const onPause = (): void => {
      cancelScheduled()
      update()
    }
    const onSeek = (): void => update()

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeking', onSeek)
    video.addEventListener('seeked', onSeek)
    video.addEventListener('loadedmetadata', onSeek)
    video.addEventListener('timeupdate', onSeek)
    update()
    if (!video.paused) schedule()

    return () => {
      disposed = true
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeking', onSeek)
      video.removeEventListener('seeked', onSeek)
      video.removeEventListener('loadedmetadata', onSeek)
      video.removeEventListener('timeupdate', onSeek)
      cancelScheduled()
    }
  }, [videoRef, cues, prefixMaxEnd, sourceKey])

  const cueById = useMemo(() => new Map(cues.map((cue) => [cue.id, cue])), [cues])
  const activeCues = useMemo(
    () => activeIds.map((id) => cueById.get(id)).filter((cue): cue is T => Boolean(cue)),
    [activeIds, cueById]
  )

  return { currentTime, activeCues }
}
