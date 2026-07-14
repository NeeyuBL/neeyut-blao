import type { JSX, KeyboardEvent } from 'react'
import { useEffect, useRef } from 'react'

// O nhap link dung chung: textarea tu gian toi ~5 dong roi cuon.
// Enter = gui (them/tai) · Shift+Enter = xuong dong.
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
    el.style.height = Math.min(el.scrollHeight, 140) + 'px' // ~5 dong roi cuon
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
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}
