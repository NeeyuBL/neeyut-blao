import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import logoSrc from '../assets/neeyuvoice-logo.png'
import previewSrc from '../assets/neeyuvoice-preview.jpg'

interface PromoApp {
  id: string
  name: string
  url: string
  blurb: string
  logoSrc: string
  previewSrc: string
}

const APPS: PromoApp[] = [
  {
    id: 'neeyuvoice',
    name: 'NeeyuVoice',
    url: 'https://example.com/',
    blurb:
      'Sắp ra mắt app TTS Neeyuvoice, ấn liên hệ tham gia nhóm zalo để cập nhật thông tin nhanh nhất',
    logoSrc,
    previewSrc
  }
]

export default function EcoNeeyu(): JSX.Element {
  const [preview, setPreview] = useState<PromoApp | null>(null)

  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPreview(null)
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
              onClick={() => setPreview(app)}
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
              <span className="modal-title">{preview.name}</span>
              <button className="modal-x" onClick={() => setPreview(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body eco-preview-body">
              <img
                src={preview.previewSrc}
                alt={`Preview ${preview.name}`}
                className="eco-preview-img"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
