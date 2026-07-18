import type { JSX } from 'react'
import { useCallback, useEffect, useRef } from 'react'

export interface Region {
  y0: number // mep TREN, tinh theo PIXEL CUA VIDEO GOC
  y1: number // mep DUOI
}

/**
 * Khung khoanh vung chu chay, de len video. Keo de doi cho, keo mep de co gian.
 *
 * !! Toa do luon quy ve PIXEL VIDEO GOC (vd 1080x1920), khong phai pixel tren
 *    man hinh. Trinh phat co video lai vua khung -> neu luu toa do man hinh thi
 *    doi kich thuoc cua so la vung lech, engine doc nham cho.
 */
export default function RegionBox({
  vung,
  setVung,
  videoH,
  boxH,
  xemMo = false
}: {
  vung: Region
  setVung: (v: Region) => void
  videoH: number // chieu cao THAT cua video (px)
  boxH: number // chieu cao khung dang hien tren man hinh (px)
  xemMo?: boolean // TRUE = xem truoc vung se bi lam mo (backdrop-filter blur)
}): JSX.Element {
  const keo = useRef<{ kieu: 'move' | 'top' | 'bot'; y: number; v: Region } | null>(null)

  // He so quy doi: 1px tren man hinh = ti px cua video goc
  const ti = videoH > 0 && boxH > 0 ? videoH / boxH : 1

  const bat = (kieu: 'move' | 'top' | 'bot') => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    keo.current = { kieu, y: e.clientY, v: { ...vung } }
  }

  const chuot = useCallback(
    (e: MouseEvent) => {
      const k = keo.current
      if (!k) return
      const d = (e.clientY - k.y) * ti // quy doi ve pixel video goc
      // Khung KHONG nho hon 1 dong chu (= 4% chieu cao video). Khop voi burn.ts:
      // co chu min = 2% cao, dong = font*1.5 -> khung >= 4% thi chu luon vua,
      // khong bao gio "khung nho hon chu" (khong bi nen/cat/no dai).
      const MIN = Math.max(28, Math.round(videoH * 0.04))
      let { y0, y1 } = k.v
      if (k.kieu === 'move') {
        const cao = y1 - y0
        y0 = Math.max(0, Math.min(videoH - cao, k.v.y0 + d))
        y1 = y0 + cao
      } else if (k.kieu === 'top') {
        y0 = Math.max(0, Math.min(k.v.y1 - MIN, k.v.y0 + d))
      } else {
        y1 = Math.min(videoH, Math.max(k.v.y0 + MIN, k.v.y1 + d))
      }
      setVung({ y0: Math.round(y0), y1: Math.round(y1) })
    },
    [ti, videoH, setVung]
  )

  useEffect(() => {
    const tha = (): void => {
      keo.current = null
    }
    window.addEventListener('mousemove', chuot)
    window.addEventListener('mouseup', tha)
    return () => {
      window.removeEventListener('mousemove', chuot)
      window.removeEventListener('mouseup', tha)
    }
  }, [chuot])

  const pct = (v: number): string => `${videoH > 0 ? (v / videoH) * 100 : 0}%`

  return (
    <div className="rbox-lop">
      {/* Phan NGOAI vung: phu mo -> mat tu nhin vao dung cho can nhin */}
      <div className="rbox-mo" style={{ top: 0, height: pct(vung.y0) }} />
      <div className="rbox-mo" style={{ top: pct(vung.y1), bottom: 0 }} />

      <div
        className={`rbox ${xemMo ? 'rbox-lammo' : ''}`}
        style={{ top: pct(vung.y0), height: pct(vung.y1 - vung.y0) }}
        onMouseDown={bat('move')}
        title="Kéo để di chuyển · kéo mép trên/dưới để co giãn"
      >
        <div className="rbox-tay rbox-tren" onMouseDown={bat('top')} />
        <div className="rbox-nhan">{xemMo ? 'Vùng làm mờ' : 'Vùng chữ chạy'}</div>
        <div className="rbox-tay rbox-duoi" onMouseDown={bat('bot')} />
      </div>
    </div>
  )
}
