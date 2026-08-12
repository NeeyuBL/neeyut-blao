import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { SetupProgress } from '../../../shared/types'

interface Props {
  onDone: () => void
}

export default function SetupScreen({ onDone }: Props): JSX.Element {
  const [progress, setProgress] = useState<SetupProgress>({
    phase: 'checking',
    message: 'Thiếu thành phần cần thiết để tải và xử lý video.',
    percent: 0
  })
  const [running, setRunning] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const start = async (): Promise<void> => {
    setError(null)
    setRunning(true)
    const res = await window.api.runSetup()
    setRunning(false)
    if (res.ok) {
      onDone()
    } else if (res.error) {
      setError(res.error)
    }
  }

  useEffect(() => {
    const off = window.api.onSetupProgress((p) => {
      setProgress(p)
      if (p.phase === 'error') setError(p.message)
    })
    void start()
    return off
  }, [])

  const indeterminate = progress.percent < 0
  const friendlyProgress =
    progress.phase === 'downloading-ytdlp'
      ? 'Đang cài tính năng tải video…'
      : progress.phase === 'downloading-ffmpeg'
        ? 'Đang cài tính năng xử lý video…'
        : progress.phase === 'extracting'
          ? 'Đang hoàn tất cài đặt…'
          : progress.phase === 'done'
            ? 'Hoàn tất! T-blao đã sẵn sàng.'
            : progress.message

  return (
    <div className="center setup">
      <div className="card setup-card">
        <h2>Chuẩn bị T-blao</h2>
        <p className="muted">
          Ứng dụng cần tải một số thành phần để tải và xử lý video. Quá trình này chỉ thực hiện khi
          cần và không yêu cầu quyền quản trị.
        </p>

        {!running && !error && (
          <button className="btn primary" onClick={start}>
            Tiếp tục cài đặt
          </button>
        )}

        {(running || progress.phase === 'done') && (
          <div className="setup-progress">
            <div className="bar">
              <div
                className={`bar-fill ${indeterminate ? 'indeterminate' : ''}`}
                style={indeterminate ? undefined : { width: `${progress.percent}%` }}
              />
            </div>
            <p className="muted small">{friendlyProgress}</p>
          </div>
        )}

        {error && (
          <div className="error-box">
            <p>Không thể hoàn tất cài đặt. Hãy kiểm tra kết nối mạng rồi thử lại.</p>
            <details className="tech-details compact">
              <summary>Chi tiết kỹ thuật</summary>
              <div>{error}</div>
            </details>
            <button className="btn" onClick={start}>
              Thử lại
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
