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
  const [showDetails, setShowDetails] = useState(false)
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
  }, [entries, autoScroll, showDetails])

  const copyAll = async (): Promise<void> => {
    const text = entries.map((e) => `[${e.time}] ${e.level.toUpperCase()} ${e.msg}`).join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const errorCount = entries.filter((e) => e.level === 'error').length
  const levelLabel = (level: LogEntry['level']): string => {
    if (level === 'error') return 'Lỗi'
    if (level === 'warn') return 'Cảnh báo'
    return 'Thông tin'
  }

  return (
    <div className="logs-page">
      <div className={`support-summary ${errorCount > 0 ? 'has-errors' : ''}`}>
        <div>
          <div className="support-summary-title">
            {errorCount > 0 ? `${errorCount} hoạt động cần chú ý` : 'T-blao đang hoạt động bình thường'}
          </div>
          <div className="muted small">
            {entries.length > 0
              ? `Đã ghi nhận ${entries.length} hoạt động trong phiên này.`
              : 'Chưa có hoạt động nào được ghi nhận trong phiên này.'}
          </div>
        </div>
        <button className="btn" onClick={copyAll} disabled={entries.length === 0}>
          {copied ? '✓ Đã sao chép' : 'Sao chép thông tin hỗ trợ'}
        </button>
      </div>

      <button className="btn support-details-toggle" onClick={() => setShowDetails((value) => !value)}>
        {showDetails ? 'Ẩn chi tiết kỹ thuật' : 'Xem chi tiết kỹ thuật'}
      </button>

      {showDetails && (
        <div className="support-technical">
          <div className="logs-toolbar">
            <div className="logs-stat muted small">Thông tin dành cho chẩn đoán và hỗ trợ</div>
            <div className="logs-actions">
              <label className="check small">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                Tự cuộn
              </label>
              <button className="btn small-btn" onClick={() => window.api.openLogFile()}>
                Mở tệp chẩn đoán
              </button>
              <button
                className="btn small-btn"
                onClick={() => window.api.clearLogs()}
                disabled={entries.length === 0}
              >
                Xóa lịch sử
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
                  <span className={`log-level ${e.level}`}>{levelLabel(e.level)}</span>
                  <span className="log-msg">{e.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="logs-hint muted small">
        Khi gặp lỗi, chọn <b>Sao chép thông tin hỗ trợ</b> rồi gửi nội dung đó cho nhà phát triển.
      </div>
    </div>
  )
}
