import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { SetupProgress } from '../../../shared/types'

interface Props {
  onDone: () => void
}

export default function SetupScreen({ onDone }: Props): JSX.Element {
  const [progress, setProgress] = useState<SetupProgress>({
    phase: 'checking',
    message: 'Thieu thanh phan can thiet de tai va xu ly video.',
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
        <h2>Cai dat cong cu</h2>
        <p className="muted">
          T-blao can cai them vai thanh phan de tai va xu ly video. Ung dung se tu tai ve nhung
          thanh phan con thieu (khong can quyen admin).
        </p>

        {!running && !error && (
          <button className="btn primary" onClick={start}>
            Tai &amp; cai dat
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
              Thu lai
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
