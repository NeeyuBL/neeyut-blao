import type { CSSProperties, JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import logoSrc from '../assets/neeyuvoice-logo.png'
import preview0 from '../assets/preview.png'
import preview1 from '../assets/preview1.png'
import preview2 from '../assets/preview2.png'

type AppCategory = 'voice' | 'video' | 'utility'

interface PromoApp {
  id: string
  name: string
  category: AppCategory
  categoryLabel: string
  status: 'available' | 'beta' | 'coming-soon'
  statusLabel: string
  featured: boolean
  accent: string
  url: string
  tagline: string
  description: string
  logoSrc: string
  previewSrcs: string[]
  platforms: string[]
  trustMarks: string[]
  features: string[]
  requirement: string
}

const APPS: PromoApp[] = [
  {
    id: 'neeyuvoice',
    name: 'NeeyuVoice',
    category: 'voice',
    categoryLabel: 'Giọng nói',
    status: 'available',
    statusLabel: 'Có sẵn',
    featured: true,
    accent: '#31c7bd',
    url: 'https://drive.google.com/drive/folders/1sx-uhREcoTiah-484XZr5MnRg8k6L2DM',
    tagline: 'Biến văn bản và phụ đề thành giọng nói ngay trên máy tính.',
    description:
      'Tạo giọng nói, đọc phụ đề và lồng tiếng nhiều nhân vật trong cùng một dự án. Phù hợp cho video, audiobook, podcast, khóa học và nội dung đa ngôn ngữ.',
    logoSrc,
    previewSrcs: [preview0, preview1, preview2],
    platforms: ['Windows', 'macOS'],
    trustMarks: ['Local 100%', 'Dữ liệu ở trên máy'],
    features: ['Văn bản thành giọng nói', 'Đọc SRT giữ mốc thời gian', 'Clone và lồng tiếng nhân vật'],
    requirement: 'Khuyến nghị GPU NVIDIA có ít nhất 6 GB VRAM.'
  }
]

const CATEGORY_ORDER: AppCategory[] = ['voice', 'video', 'utility']

function appStyle(app: PromoApp): CSSProperties {
  return { '--eco-accent': app.accent } as CSSProperties
}

function openDownload(app: PromoApp): void {
  window.api.openExternal(app.url)
}

export default function EcoNeeyu(): JSX.Element {
  const featured = APPS.find((app) => app.featured) ?? APPS[0]
  const [details, setDetails] = useState<PromoApp | null>(null)
  const [preview, setPreview] = useState<PromoApp | null>(null)
  const [slide, setSlide] = useState(0)
  const [category, setCategory] = useState<AppCategory | 'all'>('all')

  const categories = useMemo(
    () =>
      CATEGORY_ORDER.filter((id) => APPS.some((app) => app.category === id)).map((id) => ({
        id,
        label: APPS.find((app) => app.category === id)?.categoryLabel ?? id
      })),
    []
  )

  const catalogApps = useMemo(
    () => APPS.filter((app) => category === 'all' || app.category === category),
    [category]
  )

  const openPreview = (app: PromoApp): void => {
    setDetails(null)
    setSlide(0)
    setPreview(app)
  }

  useEffect(() => {
    if (!preview && !details) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPreview(null)
        setDetails(null)
        return
      }
      if (!preview || preview.previewSrcs.length < 2) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setSlide((index) => (index - 1 + preview.previewSrcs.length) % preview.previewSrcs.length)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setSlide((index) => (index + 1) % preview.previewSrcs.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [details, preview])

  return (
    <div className="eco">
      <section className="eco-intro" aria-labelledby="eco-intro-title">
        <div className="eco-intro-copy">
          <span className="eco-eyebrow">Neeyu product signal</span>
          <h2 id="eco-intro-title">Một hành trình, nhiều công cụ sáng tạo.</h2>
          <p>
            Khám phá những ứng dụng Neeyu giúp đưa nội dung từ ý tưởng đến sản phẩm hoàn chỉnh,
            ngay trên máy tính của bạn.
          </p>
        </div>
        <div className="eco-signal-rail" aria-label="Hành trình sáng tạo của hệ sinh thái Neeyu">
          <span className="eco-signal-stop is-ready"><i />Nội dung</span>
          <span className="eco-signal-stop is-live"><i />Giọng nói</span>
          <span className="eco-signal-stop"><i />Biên tập</span>
          <span className="eco-signal-stop"><i />Xuất bản</span>
        </div>
      </section>

      {featured && (
        <section className="eco-featured" style={appStyle(featured)} aria-labelledby="eco-featured-name">
          <div className="eco-featured-copy">
            <div className="eco-featured-labels">
              <span className="eco-section-label">Ứng dụng nổi bật</span>
              <span className={`eco-status is-${featured.status}`}>{featured.statusLabel}</span>
            </div>

            <div className="eco-product-lockup">
              <div className="eco-product-logo" aria-hidden="true">
                <img src={featured.logoSrc} alt="" />
              </div>
              <div>
                <span className="eco-product-category">{featured.categoryLabel}</span>
                <h3 id="eco-featured-name">{featured.name}</h3>
              </div>
            </div>

            <p className="eco-featured-tagline">{featured.tagline}</p>
            <p className="eco-featured-description">{featured.description}</p>

            <div className="eco-trust-row" aria-label="Thông tin sản phẩm">
              {featured.trustMarks.map((mark) => <span key={mark}>{mark}</span>)}
              {featured.platforms.map((platform) => <span key={platform}>{platform}</span>)}
            </div>

            <div className="eco-actions">
              <button type="button" className="eco-action-primary" onClick={() => setDetails(featured)}>
                Khám phá {featured.name}
                <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="eco-action-secondary" onClick={() => openPreview(featured)}>
                Xem giao diện
              </button>
            </div>
          </div>

          <button
            type="button"
            className="eco-featured-media"
            onClick={() => openPreview(featured)}
            aria-label={`Xem giao diện ${featured.name}`}
          >
            <img src={featured.previewSrcs[0]} alt={`Giao diện ${featured.name}`} />
            <span className="eco-media-caption">
              <span>Giao diện thật</span>
              <strong>{featured.previewSrcs.length} ảnh</strong>
            </span>
          </button>
        </section>
      )}

      {APPS.length > 1 && (
        <section className="eco-catalog" aria-labelledby="eco-catalog-title">
          <div className="eco-catalog-head">
            <div>
              <span className="eco-section-label">Khám phá thêm</span>
              <h2 id="eco-catalog-title">Tất cả ứng dụng</h2>
            </div>
            <div className="eco-filters" aria-label="Lọc ứng dụng">
              <button
                type="button"
                className={category === 'all' ? 'active' : ''}
                onClick={() => setCategory('all')}
              >
                Tất cả
              </button>
              {categories.map((item) => (
                <button
                  type="button"
                  className={category === item.id ? 'active' : ''}
                  onClick={() => setCategory(item.id)}
                  key={item.id}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="eco-grid">
            {catalogApps.map((app) => (
              <article className="eco-app-card" style={appStyle(app)} key={app.id}>
                <div className="eco-app-card-head">
                  <div className="eco-app-icon"><img src={app.logoSrc} alt="" /></div>
                  <span className={`eco-status is-${app.status}`}>{app.statusLabel}</span>
                </div>
                <span className="eco-product-category">{app.categoryLabel}</span>
                <h3>{app.name}</h3>
                <p>{app.tagline}</p>
                <div className="eco-app-meta">
                  {app.platforms.map((platform) => <span key={platform}>{platform}</span>)}
                </div>
                <button type="button" className="eco-card-action" onClick={() => setDetails(app)}>
                  Khám phá <span aria-hidden="true">→</span>
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="eco-coming-next">
        <span className="eco-coming-mark" aria-hidden="true">＋</span>
        <div>
          <strong>Hệ sinh thái vẫn đang mở rộng</strong>
          <span>Các ứng dụng Neeyu mới sẽ xuất hiện tại đây khi sẵn sàng.</span>
        </div>
      </footer>

      {details && (
        <div className="modal-nen" role="presentation" onClick={() => setDetails(null)}>
          <section
            className="modal eco-detail-modal"
            style={appStyle(details)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="eco-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="eco-detail-head">
              <div className="eco-detail-identity">
                <div className="eco-app-icon"><img src={details.logoSrc} alt="" /></div>
                <div>
                  <span>{details.categoryLabel}</span>
                  <h2 id="eco-detail-title">{details.name}</h2>
                </div>
              </div>
              <button className="modal-x" onClick={() => setDetails(null)} aria-label="Đóng">✕</button>
            </div>
            <div className="eco-detail-body">
              <p className="eco-detail-tagline">{details.tagline}</p>
              <p className="eco-detail-description">{details.description}</p>

              <div className="eco-feature-list">
                {details.features.map((feature) => (
                  <div key={feature}><span aria-hidden="true">✓</span>{feature}</div>
                ))}
              </div>

              <div className="eco-detail-facts">
                <div><span>Nền tảng</span><strong>{details.platforms.join(', ')}</strong></div>
                <div><span>Quyền riêng tư</span><strong>{details.trustMarks.join(' · ')}</strong></div>
                <div><span>Cấu hình</span><strong>{details.requirement}</strong></div>
              </div>
            </div>
            <div className="eco-detail-actions">
              <button type="button" className="eco-action-secondary" onClick={() => openPreview(details)}>
                Xem giao diện
              </button>
              <button type="button" className="eco-action-primary" onClick={() => openDownload(details)}>
                Mở trang tải <span aria-hidden="true">↗</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {preview && (
        <div className="modal-nen" role="presentation" onClick={() => setPreview(null)}>
          <section
            className="modal eco-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="eco-preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <span className="modal-title" id="eco-preview-title">Giao diện {preview.name}</span>
              <button className="modal-x" onClick={() => setPreview(null)} aria-label="Đóng">✕</button>
            </div>
            <div className="modal-body eco-preview-body">
              <div className="eco-preview-stage">
                {preview.previewSrcs.length > 1 && (
                  <button
                    type="button"
                    className="eco-preview-nav eco-preview-nav-prev"
                    onClick={() => setSlide((index) =>
                      (index - 1 + preview.previewSrcs.length) % preview.previewSrcs.length
                    )}
                    aria-label="Ảnh trước"
                  >
                    ‹
                  </button>
                )}
                <img
                  src={preview.previewSrcs[slide]}
                  alt={`Giao diện ${preview.name}, ảnh ${slide + 1}`}
                  className="eco-preview-img"
                />
                {preview.previewSrcs.length > 1 && (
                  <button
                    type="button"
                    className="eco-preview-nav eco-preview-nav-next"
                    onClick={() => setSlide((index) => (index + 1) % preview.previewSrcs.length)}
                    aria-label="Ảnh sau"
                  >
                    ›
                  </button>
                )}
              </div>
              <div className="eco-preview-dots" aria-label="Chọn ảnh giao diện">
                {preview.previewSrcs.map((_, index) => (
                  <button
                    type="button"
                    className={index === slide ? 'active' : ''}
                    onClick={() => setSlide(index)}
                    aria-label={`Xem ảnh ${index + 1}`}
                    aria-current={index === slide ? 'true' : undefined}
                    key={index}
                  />
                ))}
                <span>{slide + 1}/{preview.previewSrcs.length}</span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
