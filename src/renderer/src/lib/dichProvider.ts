import type { DichProvider } from '../../../shared/types'

const KEY = 'tblao.dich.provider'

/** Doc provider dang chon (localStorage) — luon lay gia tri moi nhat luc goi dich. */
export function readDichProvider(): DichProvider {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw != null ? (JSON.parse(raw) as string) : 'gemini'
    return v === 'openai' ? 'openai' : 'gemini'
  } catch {
    return 'gemini'
  }
}
