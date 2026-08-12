import type { JSX } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type { BlurRegion } from '../../../shared/types'
import {
  cueUsesCjkWrap,
  estimateTextWidthPx,
  fontSizeFromSubBox,
  ngatDongTheoPx,
  wrapWidthFromBox
} from '../../../shared/subWrap'

function measureCanvasText(fontCss: string, text: string): number {
  if (!text) return 0
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return estimateTextWidthPx(text, 16)
    ctx.font = fontCss
    return ctx.measureText(text).width
  } catch {
    return estimateTextWidthPx(text, 16)
  }
}

export interface Region {
  y0: number
  y1: number
  x0: number
  x1: number
}

interface Props {
  regions?: BlurRegion[]
  activeId?: string | null
  setActiveId?: (id: string) => void
  updateRegion?: (r: BlurRegion) => void
  removeRegion?: (id: string) => void
  // Khung phu de (cho phep keo di chuyen + co gian)
  hienSubBox?: boolean
  subRegion?: Region
  setSubRegion?: (v: Region) => void
  // Khung OCR (cho phep keo di chuyen + co gian)
  hienOcrBox?: boolean
  ocrRegion?: Region
  setOcrRegion?: (v: Region) => void
  videoH: number
  videoW: number
  boxH: number
  boxW: number
  xemMo?: boolean
  /** CSS font-family cho chu mau trong khung phu de (sau khi @font-face load). */
  previewFontFamily?: string
  textColor?: string
  outlineColor?: string
  outlinePx?: number
  bgEnabled?: boolean
  bgColor?: string
  bgOpacity?: number
}

type DragType = 'move' | 'top' | 'bot' | 'left' | 'right' | 'top-left' | 'top-right' | 'bot-left' | 'bot-right'

export default function RegionBox({
  regions,
  activeId,
  setActiveId,
  updateRegion,
  removeRegion,
  hienSubBox = false,
  subRegion,
  setSubRegion,
  hienOcrBox = false,
  ocrRegion,
  setOcrRegion,
  videoH,
  videoW,
  boxH,
  boxW,
  xemMo = false,
  previewFontFamily,
  textColor = '#ffffff',
  outlineColor = '#000000',
  outlinePx = 2,
  bgEnabled = false,
  bgColor = '#000000',
  bgOpacity = 60
}: Props): JSX.Element {
  const keo = useRef<{
    target: 'blur' | 'sub' | 'ocr'
    id?: string
    kieu: DragType
    x: number
    y: number
    v: Region
  } | null>(null)

  const sx = videoW > 0 && boxW > 0 ? videoW / boxW : 1
  const sy = videoH > 0 && boxH > 0 ? videoH / boxH : 1

  const batBlur =
    (id: string, r: Region, kieu: DragType) =>
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (setActiveId) setActiveId(id)
      keo.current = { target: 'blur', id, kieu, x: e.clientX, y: e.clientY, v: { ...r } }
    }

  const batSub = (kieu: DragType) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (subRegion) {
      keo.current = { target: 'sub', kieu, x: e.clientX, y: e.clientY, v: { ...subRegion } }
    }
  }

  const batOcr = (kieu: DragType) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (ocrRegion) {
      keo.current = { target: 'ocr', kieu, x: e.clientX, y: e.clientY, v: { ...ocrRegion } }
    }
  }

  const chuot = useCallback(
    (e: MouseEvent) => {
      const k = keo.current
      if (!k) return
      const dy = (e.clientY - k.y) * sy
      const dx = (e.clientX - k.x) * sx

      const MIN_H = Math.max(20, Math.round(videoH * 0.03))
      const MIN_W = Math.max(40, Math.round(videoW * 0.05))
      let { y0, y1, x0, x1 } = k.v

      if (k.kieu === 'move') {
        const cao = y1 - y0
        const rong = x1 - x0
        y0 = Math.max(0, Math.min(videoH - cao, k.v.y0 + dy))
        y1 = y0 + cao
        x0 = Math.max(0, Math.min(videoW - rong, k.v.x0 + dx))
        x1 = x0 + rong
      } else {
        if (k.kieu.includes('top')) y0 = Math.max(0, Math.min(k.v.y1 - MIN_H, k.v.y0 + dy))
        if (k.kieu.includes('bot')) y1 = Math.min(videoH, Math.max(k.v.y0 + MIN_H, k.v.y1 + dy))
        if (k.kieu.includes('left')) x0 = Math.max(0, Math.min(k.v.x1 - MIN_W, k.v.x0 + dx))
        if (k.kieu.includes('right')) x1 = Math.min(videoW, Math.max(k.v.x0 + MIN_W, k.v.x1 + dx))
      }

      const updated = {
        y0: Math.round(y0),
        y1: Math.round(y1),
        x0: Math.round(x0),
        x1: Math.round(x1)
      }

      if (k.target === 'blur' && regions && updateRegion && k.id) {
        const match = regions.find((item) => item.id === k.id)
        if (match) updateRegion({ ...match, ...updated })
      } else if (k.target === 'sub' && setSubRegion) {
        setSubRegion(updated)
      } else if (k.target === 'ocr' && setOcrRegion) {
        setOcrRegion(updated)
      }
    },
    [sx, sy, videoH, videoW, regions, updateRegion, setSubRegion, setOcrRegion]
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
  const pctX = (v: number): string => `${videoW > 0 ? (v / videoW) * 100 : 0}%`

  const list = regions || []
  const currentActiveId = activeId ?? list[0]?.id
  const activeRegion = list.find((item) => item.id === currentActiveId)

  // Cỡ chữ mẫu = burn (bh * 0.7), quy về pixel preview qua sy
  const previewFontSize = subRegion && videoH > 0
    ? Math.max(12, Math.round(fontSizeFromSubBox(subRegion.y1 - subRegion.y0) / sy))
    : 16

  // Xuong dong mau: do px that (canvas) vs chieu ngang khung (video px)
  const sampleAssLines = ((): string[] => {
    const sample = 'Mẫu chữ xuất ra'
    if (!subRegion || videoW <= 0) return [sample]
    const bw = Math.max(1, subRegion.x1 - subRegion.x0)
    const bh = Math.max(1, subRegion.y1 - subRegion.y0)
    const fs = fontSizeFromSubBox(bh)
    const pad = bgEnabled ? Math.max(8, Math.round(fs * 0.26)) : 0
    const maxW = wrapWidthFromBox(bw, pad)
    const family = previewFontFamily
      ? `"${previewFontFamily}", Arial, sans-serif`
      : 'Arial, sans-serif'
    // Do theo co chu ASS (video px) de khop burn, khong theo previewFontSize man hinh
    const fontCss = `bold ${fs}px ${family}`
    const measure = (t: string): number => {
      const w = measureCanvasText(fontCss, t)
      return w > 0 ? w : estimateTextWidthPx(t, fs)
    }
    const wrapped = ngatDongTheoPx(sample, maxW, measure, cueUsesCjkWrap(sample))
    return wrapped.split('\\N').filter(Boolean)
  })()

  const boxPadPreview = Math.max(4, Math.round(previewFontSize * 0.26))
  // Phuong an A: gan vuong nhu ASS (blur), khong pill
  const boxRadiusPreview = Math.max(2, Math.round(previewFontSize * 0.06))

  const outlineShadow = (() => {
    const px = Math.max(0, Math.min(8, Math.round(outlinePx * 2) / 2))
    if (px <= 0) return 'none'
    const parts: string[] = []
    const step = 0.5
    for (let x = -px; x <= px + 1e-9; x += step) {
      for (let y = -px; y <= px + 1e-9; y += step) {
        if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) continue
        if (x * x + y * y > px * px + px * 0.5) continue
        const xr = Math.round(x * 2) / 2
        const yr = Math.round(y * 2) / 2
        parts.push(`${xr}px ${yr}px 0 ${outlineColor}`)
      }
    }
    return parts.join(', ')
  })()

  const bgRgba = (() => {
    const s = bgColor.replace('#', '')
    const full =
      s.length === 3
        ? s
            .split('')
            .map((c) => c + c)
            .join('')
        : s
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return 'transparent'
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    const a = Math.max(0, Math.min(100, bgOpacity)) / 100
    return `rgba(${r},${g},${b},${a})`
  })()

  return (
    <div className="rbox-lop">
      {/* Vùng mờ xung quanh active blur region */}
      {xemMo && activeRegion && (
        <>
          <div className="rbox-mo" style={{ top: 0, height: pct(activeRegion.y0) }} />
          <div className="rbox-mo" style={{ top: pct(activeRegion.y1), bottom: 0 }} />
          <div
            className="rbox-mo"
            style={{
              top: pct(activeRegion.y0),
              height: pct(activeRegion.y1 - activeRegion.y0),
              left: 0,
              width: pctX(activeRegion.x0)
            }}
          />
          <div
            className="rbox-mo"
            style={{
              top: pct(activeRegion.y0),
              height: pct(activeRegion.y1 - activeRegion.y0),
              left: pctX(activeRegion.x1),
              right: 0
            }}
          />
        </>
      )}

      {/* Danh sách các Vùng Làm Mờ (nếu có) */}
      {list.map((r, idx) => {
        const isActive = r.id === currentActiveId
        return (
          <div
            key={r.id}
            className={`rbox ${xemMo ? 'rbox-lammo' : ''} ${isActive ? 'active' : ''}`}
            style={{
              top: pct(r.y0),
              height: pct(r.y1 - r.y0),
              left: pctX(r.x0),
              width: pctX(r.x1 - r.x0),
              borderColor: r.color
            }}
            onMouseDown={(e) => {
              if (setActiveId) setActiveId(r.id)
              batBlur(r.id, r, 'move')(e)
            }}
            title="Vùng mờ: kéo di chuyển · kéo các mép để co giãn"
          >
            {isActive && (
              <>
                <div className="rbox-tay rbox-tren" onMouseDown={batBlur(r.id, r, 'top')} />
                <div className="rbox-tay rbox-duoi" onMouseDown={batBlur(r.id, r, 'bot')} />
                <div className="rbox-tay rbox-trai" onMouseDown={batBlur(r.id, r, 'left')} />
                <div className="rbox-tay rbox-phai" onMouseDown={batBlur(r.id, r, 'right')} />
              </>
            )}
            <div className="rbox-nhan" style={{ background: r.color }}>
              Vùng mờ {idx + 1}
            </div>
            {removeRegion && list.length > 1 && (
              <div
                className="rbox-del"
                onClick={(e) => {
                  e.stopPropagation()
                  removeRegion(r.id)
                }}
                title="Xoá vùng làm mờ này"
              >
                ✕
              </div>
            )}
          </div>
        )
      })}

      {/* Khung Phụ Đề Trực Quan (Kéo di chuyển & co giãn) */}
      {hienSubBox && subRegion && (
        <div
          className="rbox rbox-sub"
          style={{
            top: pct(subRegion.y0),
            height: pct(subRegion.y1 - subRegion.y0),
            left: pctX(subRegion.x0),
            width: pctX(subRegion.x1 - subRegion.x0)
          }}
          onMouseDown={batSub('move')}
          title="Khung phụ đề: Kéo di chuyển vị trí · Kéo các điểm mút góc/cạnh để thay đổi cỡ chữ"
        >
          {/* Nút kéo góc & cạnh */}
          <div className="rbox-tay rbox-goc-tl" onMouseDown={batSub('top-left')} />
          <div className="rbox-tay rbox-goc-tr" onMouseDown={batSub('top-right')} />
          <div className="rbox-tay rbox-goc-bl" onMouseDown={batSub('bot-left')} />
          <div className="rbox-tay rbox-goc-br" onMouseDown={batSub('bot-right')} />
          <div className="rbox-tay rbox-tren" onMouseDown={batSub('top')} />
          <div className="rbox-tay rbox-duoi" onMouseDown={batSub('bot')} />
          <div className="rbox-tay rbox-trai" onMouseDown={batSub('left')} />
          <div className="rbox-tay rbox-phai" onMouseDown={batSub('right')} />

          {/* Chu mau: can day khung (\\an2), nam trong vien tim */}
          <div className="sub-sample-slot">
            <div
              className={`sub-sample-text${bgEnabled ? ' sub-sample-hug' : ''}`}
              style={{
                fontSize: `${previewFontSize}px`,
                fontFamily: previewFontFamily
                  ? `"${previewFontFamily}", Arial, sans-serif`
                  : 'Arial, sans-serif',
                color: textColor,
                textShadow: outlineShadow,
                whiteSpace: 'pre-line',
                ...(bgEnabled
                  ? {
                      background: bgRgba,
                      borderRadius: boxRadiusPreview,
                      padding: `${Math.max(3, Math.round(boxPadPreview * 0.55))}px ${boxPadPreview}px`
                    }
                  : {})
              }}
            >
              {sampleAssLines.join('\n')}
            </div>
          </div>
        </div>
      )}

      {/* Khung Quét OCR (Kéo di chuyển & co giãn) */}
      {hienOcrBox && ocrRegion && (
        <div
          className="rbox rbox-ocr"
          style={{
            top: pct(ocrRegion.y0),
            height: pct(ocrRegion.y1 - ocrRegion.y0),
            left: pctX(ocrRegion.x0),
            width: pctX(ocrRegion.x1 - ocrRegion.x0)
          }}
          onMouseDown={batOcr('move')}
          title="Khung đọc chữ: kéo để di chuyển, kéo các cạnh để thay đổi kích thước"
        >
          {/* Nút kéo góc & cạnh */}
          <div className="rbox-tay rbox-goc-tl" onMouseDown={batOcr('top-left')} />
          <div className="rbox-tay rbox-goc-tr" onMouseDown={batOcr('top-right')} />
          <div className="rbox-tay rbox-goc-bl" onMouseDown={batOcr('bot-left')} />
          <div className="rbox-tay rbox-goc-br" onMouseDown={batOcr('bot-right')} />
          <div className="rbox-tay rbox-tren" onMouseDown={batOcr('top')} />
          <div className="rbox-tay rbox-duoi" onMouseDown={batOcr('bot')} />
          <div className="rbox-tay rbox-trai" onMouseDown={batOcr('left')} />
          <div className="rbox-tay rbox-phai" onMouseDown={batOcr('right')} />

          <div className="rbox-nhan rbox-nhan-ocr">
            Khung đọc chữ
          </div>
        </div>
      )}
    </div>
  )
}
