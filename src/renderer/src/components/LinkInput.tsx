import type { JSX, KeyboardEvent } from 'react'
import { useEffect, useRef } from 'react'

// O nhap link dung chung: trang thai rong du cao de doc huong dan,
// sau do textarea tu gian theo noi dung toi khoang 5 dong roi cuon.
export default function LinkInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  disabled?: boolean
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const minimumHeight = value.trim() ? 44 : 72
    el.style.height = Math.min(Math.max(el.scrollHeight, minimumHeight), 140) + 'px'
  }

  // Gian lai moi khi noi dung doi (ke ca khi bi xoa trang sau khi them)
  useEffect(grow, [value])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
    // Shift+Enter -> mac dinh: xuong dong
  }

  return (
    <textarea
      ref={ref}
      className="url-input url-textarea"
      rows={1}
      aria-label="Nhập liên kết cần thêm"
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}
