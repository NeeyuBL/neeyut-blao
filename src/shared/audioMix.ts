export interface AudioMixGains {
  original: number
  dub: number
}

export const AUDIO_MIX_DROPOUT_TRANSITION_SECONDS = 0

export function originalAudioGain(percent: number): number {
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 100
  return Math.pow(safePercent / 100, 2)
}

/**
 * Giong FFmpeg amix normalize=1: khi ca hai nguon dang hoat dong, moi nguon
 * duoc chia doi. Khi chi con mot nguon, nguon do giu nguyen gain.
 */
export function audioMixGains(options: {
  enabled: boolean
  sourceVolume: number
  hasOriginalAudio: boolean
  hasDubAudio: boolean
  dubIsActive: boolean
}): AudioMixGains {
  if (!options.enabled) return { original: options.hasOriginalAudio ? 1 : 0, dub: 0 }

  const original = options.hasOriginalAudio ? originalAudioGain(options.sourceVolume) : 0
  if (!options.hasDubAudio || !options.dubIsActive) return { original, dub: 0 }
  if (!options.hasOriginalAudio) return { original: 0, dub: 1 }
  return { original: original / 2, dub: 0.5 }
}
