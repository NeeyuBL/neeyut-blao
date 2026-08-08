import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import logoSrc from '../assets/neeyuvoice-logo.png'
import preview0 from '../assets/preview.png'
import preview1 from '../assets/preview1.png'
import preview2 from '../assets/preview2.png'

interface PromoApp {
  id: string
  name: string
  url: string
  blurb: string
  logoSrc: string
  previewSrcs: string[]
}

const APPS: PromoApp[] = [
  {
    id: 'neeyuvoice',
    name: 'NeeyuVoice',
    url: 'https://drive.google.com/drive/folders/1sx-uhREcoTiah-484XZr5MnRg8k6L2DM',
    blurb:
      'NeeyuVoice: Tạo giọng nói, đọc phụ đề và lồng tiếng nhân vật ngay trên máy tính của bạn, chạy local 100%, khuyến nghị GPU NVIDIA có ít nhất 6 GB VRAM.\n\nBạn đang làm video, audiobook, podcast, khóa học hoặc nội dung đa ngôn ngữ nhưng không muốn mất nhiều thời gian thu âm?\n\nNeeyuVoice giúp chuyển văn bản và phụ đề thành giọng nói, clone giọng mẫu và lồng tiếng nhiều nhân vật trong cùng một dự án.',
    logoSrc,
    previewSrcs: [preview0, preview1, preview2]
  }
]

export default function EcoNeeyu(): JSX.Element {
  const [preview, setPreview] = useState<PromoApp | null>(null)
  const [slide, setSlide] = useState(0)

  const openPreview = (app: PromoApp): void => {
    setSlide(0)
    setPreview(app)
  }

  useEffect(() => {
    if (!preview) return
    const n = preview.previewSrcs.length
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setPreview(null)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setSlide((i) => (i - 1 + n) % n)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setSlide((i) => (i + 1) % n)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  return (
    <div className="eco">
      <div className="eco-grid">
        {APPS.map((app) => (
          <article className="eco-promo" key={app.id}>
            <button
              type="button"
              className="eco-logo"
              onClick={() => openPreview(app)}
              title="Xem ảnh preview"
              aria-label={`Xem preview ${app.name}`}
            >
              <img src={app.logoSrc} alt="" className="eco-logo-img" />
              <span className="eco-logo-hint">Preview</span>
            </button>

            <button
              type="button"
              className="eco-name"
              onClick={() => window.api.openExternal(app.url)}
              title={app.url}
            >
              {app.name}
            </button>

            <div className="eco-blurb-box">
              <p>{app.blurb}</p>
            </div>
          </article>
        ))}
      </div>

      {preview && (
        <div className="modal-nen" onClick={() => setPreview(null)}>
          <div className="modal eco-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">
                {preview.name} ({slide + 1}/{preview.previewSrcs.length})
              </span>
              <button className="modal-x" onClick={() => setPreview(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body eco-preview-body">
              <div className="eco-preview-stage">
                <button
                  type="button"
                  className="eco-preview-nav eco-preview-nav-prev"
                  onClick={() =>
                    setSlide((i) => (i - 1 + preview.previewSrcs.length) % preview.previewSrcs.length)
                  }
                  aria-label="Ảnh trước"
                  title="Mũi tên trái"
                >
                  ‹
                </button>
                <img
                  src={preview.previewSrcs[slide]}
                  alt={`Preview ${preview.name} ${slide + 1}`}
                  className="eco-preview-img"
                />
                <button
                  type="button"
                  className="eco-preview-nav eco-preview-nav-next"
                  onClick={() => setSlide((i) => (i + 1) % preview.previewSrcs.length)}
                  aria-label="Ảnh sau"
                  title="Mũi tên phải"
                >
                  ›
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
