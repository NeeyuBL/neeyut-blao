export interface FittedVideoSize {
  width: number
  height: number
}

/**
 * Fit an intrinsic video rectangle inside the visible preview bounds.
 * Returns null while either side is hidden/unmeasurable (for example display:none).
 */
export function fitVideoInBounds(
  videoWidth: number,
  videoHeight: number,
  availableWidth: number,
  availableHeight: number
): FittedVideoSize | null {
  if (
    !Number.isFinite(videoWidth) ||
    !Number.isFinite(videoHeight) ||
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    videoWidth <= 0 ||
    videoHeight <= 0 ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    return null
  }

  const scale = Math.min(availableWidth / videoWidth, availableHeight / videoHeight)
  if (!Number.isFinite(scale) || scale <= 0) return null
  return {
    width: Math.max(1, Math.floor(videoWidth * scale)),
    height: Math.max(1, Math.floor(videoHeight * scale))
  }
}
