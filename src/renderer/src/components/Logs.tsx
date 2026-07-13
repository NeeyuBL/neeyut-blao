import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '../../../shared/types'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => n.toString().padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function Logs(): JSX.Element {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.getLogs().then(setEntries)
    const offLog = window.api.onLog((e) => setEntries((prev) => [...prev, e].slice(-1000)))
    const offClear = window.api.onLogsCleared(() => setEntries([]))
    return () => {
      offLog()
      offClear()
    }
  }, [])

  useEffect(() => {
    if (autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [entries, autoScroll])

  const copyAll = async (): Promise<void> => {
    const text = entries.map((e) => `[${e.time}] ${e.level.toUpperCase()} ${e.msg}`).join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const errorCount = entries.filter((e) => e.level === 'error').length

  return (
    <div className="logs-page">
      <div className="logs-toolbar">
        <div className="logs-stat muted small">
          {entries.length} dòng
          {errorCount > 0 && <span className="logs-err-count"> · {errorCount} lỗi</span>}
        </div>
        <div className="logs-actions">
          <label className="check small">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Tự cuộn
          </label>
          <button className="btn small-btn" onClick={copyAll} disabled={entries.length === 0}>
            {copied ? '✓ Đã sao chép' : 'Sao chép'}
          </button>
          <button className="btn small-btn" onClick={() => window.api.openLogFile()}>
            Mở file log
          </button>
          <button
            className="btn small-btn"
            onClick={() => window.api.clearLogs()}
            disabled={entries.length === 0}
          >
            Xóa
          </button>
        </div>
      </div>

      <div className="logs-list" ref={listRef}>
        {entries.length === 0 ? (
          <div className="logs-empty muted">Chưa có hoạt động nào được ghi lại.</div>
        ) : (
          entries.map((e, i) => (
            <div className={`log-line ${e.level}`} key={i}>
              <span className="log-time">{fmtTime(e.time)}</span>
              <span className={`log-level ${e.level}`}>{e.level.toUpperCase()}</span>
              <span className="log-msg">{e.msg}</span>
            </div>
          ))
        )}
      </div>

      <div className="logs-hint muted small">
        💡 Khi gặp lỗi, bấm <b>Sao chép</b> rồi gửi cho nhà phát triển để được hỗ trợ nhanh hơn.
      </div>
    </div>
  )
}
