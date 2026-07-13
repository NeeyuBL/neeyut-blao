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
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const off = window.api.onSetupProgress((p) => {
      setProgress(p)
      if (p.phase === 'error') setError(p.message)
    })
    return off
  }, [])

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

  const indeterminate = progress.percent < 0

  return (
    <div className="center setup">
      <div className="card setup-card">
        <h2>Cài đặt công cụ</h2>
        <p className="muted">
          T-blao cần cài thêm vài thành phần để tải và xử lý video. Ứng dụng sẽ tự tải về những
          thành phần còn thiếu (không cần quyền admin).
        </p>

        {!running && !error && (
          <button className="btn primary" onClick={start}>
            Tải &amp; cài đặt
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
            <p className="muted small">{progress.message}</p>
          </div>
        )}

        {error && (
          <div className="error-box">
            <p>{error}</p>
            <button className="btn" onClick={start}>
              Thử lại
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
