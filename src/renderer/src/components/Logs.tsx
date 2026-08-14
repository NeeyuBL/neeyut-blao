import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { LogEntry, SupportReport } from '../../../shared/types'

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
  const [report, setReport] = useState<SupportReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.getLogs().then(setEntries)
    const offLog = window.api.onLog((e) => setEntries((prev) => [...prev, e].slice(-1000)))
    const offClear = window.api.onLogsCleared(() => {
      setEntries([])
      setReport(null)
    })
    return () => {
      offLog()
      offClear()
    }
  }, [])

  useEffect(() => {
    if (autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [entries, autoScroll, showDetails])

  const createReport = async (): Promise<void> => {
    setReportLoading(true)
    setReportError(null)
    setCopied(false)
    try {
      setReport(await window.api.createSupportReport())
    } catch {
      setReportError('Không thể tạo báo cáo lúc này. Hãy thử lại sau khi tác vụ đang chạy hoàn tất.')
    } finally {
      setReportLoading(false)
    }
  }

  const copyReport = async (): Promise<void> => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report.text)
      setCopied(true)
      setReportError(null)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setReportError('Không thể ghi vào bộ nhớ tạm. Bạn có thể chọn và sao chép nội dung bên dưới.')
    }
  }

  const errorCount = entries.filter((e) => e.level === 'error').length
  const warningCount = entries.filter((e) => e.level === 'warn').length
  const levelLabel = (level: LogEntry['level']): string => {
    if (level === 'error') return 'Lỗi'
    if (level === 'warn') return 'Cảnh báo'
    return 'Thông tin'
  }

  return (
    <div className="logs-page">
      <div
        className={`support-summary ${errorCount > 0 ? 'has-errors' : warningCount > 0 ? 'has-warnings' : ''}`}
      >
        <div>
          <div className="support-summary-title">
            {errorCount > 0
              ? `${errorCount} lỗi được ghi nhận`
              : warningCount > 0
                ? `${warningCount} cảnh báo được ghi nhận`
                : 'Chưa ghi nhận lỗi trong phiên này'}
          </div>
          <div className="muted small">
            {entries.length > 0
              ? `Đã ghi nhận ${entries.length} hoạt động trong phiên này.`
              : 'Chưa có hoạt động nào được ghi nhận trong phiên này.'}
          </div>
        </div>
        <button className="btn primary" onClick={() => void createReport()} disabled={reportLoading}>
          {reportLoading ? 'Đang kiểm tra hệ thống…' : report ? 'Tạo lại báo cáo' : 'Tạo báo cáo chẩn đoán'}
        </button>
      </div>

      {reportError && <div className="support-report-error" role="alert">{reportError}</div>}

      {report && (
        <section className="support-report-preview" aria-labelledby="support-report-title">
          <div className="support-report-head">
            <div>
              <div className="support-report-eyebrow">Sẵn sàng gửi</div>
              <h2 id="support-report-title">Kiểm tra nội dung trước khi sao chép</h2>
            </div>
            <button className="link-btn" onClick={() => setReport(null)}>Đóng</button>
          </div>
          <p className="support-privacy-note">{report.privacyNotice}</p>
          <div className="support-report-facts" aria-label="Thành phần báo cáo">
            <span>{report.logCount} dòng hoạt động</span>
            <span>{report.rendererIssueCount} lỗi giao diện</span>
            {report.includesPreviousCrash && <span className="warning">Có dấu vết phiên dừng trước</span>}
          </div>
          <textarea
            className="support-report-text"
            value={report.text}
            readOnly
            spellCheck={false}
            aria-label="Nội dung báo cáo chẩn đoán"
          />
          <div className="support-report-actions">
            <button className="btn primary" onClick={() => void copyReport()}>
              {copied ? '✓ Đã sao chép báo cáo' : 'Sao chép báo cáo'}
            </button>
            <span className="muted small">Chỉ gửi báo cáo cho người bạn tin tưởng hỗ trợ ứng dụng.</span>
          </div>
        </section>
      )}

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
        Khi gặp lỗi, tạo báo cáo, kiểm tra nội dung rồi gửi cho nhà phát triển.
      </div>
    </div>
  )
}
