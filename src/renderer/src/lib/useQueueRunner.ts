import { useRef, useState } from 'react'

// May trang thai chung cho hang doi 3 tab: chay / tam dung / dung.
// Nguyen tac: KHONG cat ngang muc dang chay — chay het muc hien tai roi moi
// dung tai ranh gioi giua cac muc (an toan, khong file do dang).
export type RunState = 'idle' | 'running' | 'pausing' | 'paused' | 'stopping'

export interface QueueRunner<T> {
  runState: RunState
  /** Dang chay hoac dang chuyen tiep (khong o idle) → khoa nut Bat dau. */
  active: boolean
  /** Chay lan luot cac muc; processOne xu ly 1 muc (chay toi xong, khong bi giet). */
  run: (items: T[], processOne: (item: T) => Promise<void>) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
}

export function useQueueRunner<T>(): QueueRunner<T> {
  const [runState, setRunState] = useState<RunState>('idle')
  const pauseRef = useRef(false)
  const stopRef = useRef(false)
  const resumeRef = useRef<null | (() => void)>(null)

  const run = async (items: T[], processOne: (item: T) => Promise<void>): Promise<void> => {
    // Chi khoi chay khi dang o idle (nut Bat dau chi hien o idle).
    if (runState !== 'idle') return
    stopRef.current = false
    pauseRef.current = false
    setRunState('running')

    for (const it of items) {
      if (stopRef.current) break

      // Neu da bam Tam dung: muc TRUOC da chay xong, gio moi thuc su dung tai day.
      if (pauseRef.current) {
        setRunState('paused')
        await new Promise<void>((resolve) => {
          resumeRef.current = resolve
        })
        resumeRef.current = null
        if (stopRef.current) break // bam Dung trong luc dang tam dung
        setRunState('running')
      }

      await processOne(it) // muc hien tai chay TOI XONG (khong cat ngang)
    }

    stopRef.current = false
    pauseRef.current = false
    setRunState('idle') // ve idle -> mo lai nut Bat dau
  }

  const pause = (): void => {
    if (runState === 'running') {
      pauseRef.current = true
      setRunState('pausing') // nac trung gian: cho muc hien tai xong
    }
  }

  const resume = (): void => {
    if (runState === 'paused') {
      pauseRef.current = false
      setRunState('running')
      resumeRef.current?.()
    }
  }

  const stop = (): void => {
    if (runState === 'running' || runState === 'pausing' || runState === 'paused') {
      stopRef.current = true
      setRunState('stopping') // nac trung gian: cho muc hien tai xong
      // Neu dang tam dung (vong lap dang cho) -> danh thuc de no thay co Dung va thoat.
      if (resumeRef.current) {
        pauseRef.current = false
        const r = resumeRef.current
        resumeRef.current = null
        r()
      }
    }
  }

  return { runState, active: runState !== 'idle', run, pause, resume, stop }
}
