import { useEffect } from 'react'
import { usePersistedState } from './persist'

const LEGACY_KEY = 'tblao.outputDir'

/** Doc path cu dung chung (luu raw string, khong JSON). */
function readLegacyOutputDir(): string {
  try {
    return localStorage.getItem(LEGACY_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * Thu muc luu ket qua theo tung tab.
 * - Key rieng (vd tblao.outputDir.download)
 * - Lan dau: seed tu tblao.outputDir cu neu co, khong thi Downloads
 */
export function useTabOutputDir(storageKey: string): [string, (d: string) => void] {
  const [outputDir, setOutputDir] = usePersistedState(storageKey, readLegacyOutputDir())

  useEffect(() => {
    if (outputDir) return
    let huy = false
    void window.api.downloadsDir().then((d) => {
      if (!huy && d) setOutputDir(d)
    })
    return () => {
      huy = true
    }
  }, [outputDir, setOutputDir])

  return [outputDir, setOutputDir]
}
