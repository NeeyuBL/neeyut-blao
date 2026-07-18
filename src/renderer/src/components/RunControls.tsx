import type { JSX } from 'react'
import type { RunState } from '../lib/useQueueRunner'

// Nut dieu khien hang doi dung chung cho 3 tab: Bat dau / Tam dung / Tiep tuc / Dung.
// Nut "Bat dau" CHI hien khi idle -> tu dong bi khoa suot running/pausing/paused/stopping.
export default function RunControls({
  runState,
  startLabel,
  canStart,
  onStart,
  onPause,
  onResume,
  onStop
}: {
  runState: RunState
  startLabel: string
  canStart: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}): JSX.Element {
  if (runState === 'idle') {
    return (
      <button className="btn primary" onClick={onStart} disabled={!canStart}>
        {startLabel}
      </button>
    )
  }

  return (
    <div className="run-controls">
      {runState === 'running' && (
        <button className="btn" onClick={onPause}>
          Tạm dừng
        </button>
      )}
      {runState === 'pausing' && (
        <button className="btn" disabled>
          Đang tạm dừng…
        </button>
      )}
      {runState === 'paused' && (
        <button className="btn primary" onClick={onResume}>
          Tiếp tục
        </button>
      )}
      {runState === 'stopping' && (
        <button className="btn" disabled>
          Đang dừng…
        </button>
      )}

      {/* Nut Dung: co suot khi dang chay/tam dung; an di khi dang dung han */}
      {runState !== 'stopping' && (
        <button className="btn danger" onClick={onStop}>
          Dừng
        </button>
      )}
    </div>
  )
}
