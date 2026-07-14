import { Dispatch, SetStateAction, useEffect, useState } from 'react'

/**
 * Nhu useState nhung tu nho vao localStorage (nho qua cac lan mo app).
 * Dung drop-in: const [x, setX] = usePersistedState('key', default)
 */
export function usePersistedState<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(val))
    } catch {
      /* bo qua */
    }
  }, [key, val])

  return [val, setVal]
}
