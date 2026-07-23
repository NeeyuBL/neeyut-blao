import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { BlurRegion } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'
import { hasFeature } from '../lib/license'
import RegionBox, { type Region } from './RegionBox'
import GeminiKey from './GeminiKey'

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

const srcVideo = (p: string): string => {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(p)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `tblao://b64/${b64}`
}

const PALETTE = [
  '#e8a13c',
  '#3b82f6',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#a855f7'
]

type Buoc = 'idle' | 'doc' | 'dich' | 'xong' | 'loi'

export default function ScreenText({
  outputDir,
  setOutputDir
}: {
  outputDir: string
  setOutputDir: (d: string) => void
}): JSX.Element {
  const [video, setVideo] = useState<string | null>(null)
  const [videoH, setVideoH] = useState(0)
  const [videoW, setVideoW] = useState(0)
  const [boxH, setBoxH] = useState(0)

  const [dich, setDich] = usePersistedState('tblao.ocr.dich', 'none')
  const [buoc, setBuoc] = useState<Buoc>('idle')
  const [pct, setPct] = useState(0)
  const [dongChu, setDongChu] = useState('')
  const [dangDung, setDangDung] = useState(false)
  const [ketQua, setKetQua] = useState<string[]>([])
  const [loi, setLoi] = useState<string | null>(null)

  const [batLamMo, setBatLamMo] = useState(true)
  const [batPhuDe, setBatPhuDe] = useState(false)
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>([])
  const [activeBlurId, setActiveBlurId] = useState<string | null>(null)

  const [videoGiay, setVideoGiay] = useState(0)
  const [srtGiay, setSrtGiay] = useState(0)
  const [ghepSrt, setGhepSrt] = useState('')
  const [subRegion, setSubRegion] = useState<Region | undefined>(undefined)
  const [ghepMode, setGhepMode] = useState<'burn' | 'soft'>('burn')
  const [ghep, setGhep] = useState<'idle' | 'chay' | 'xong' | 'loi'>('idle')
  const [ghepPct, setGhepPct] = useState(0)
  const [ghepOut, setGhepOut] = useState('')
  const [ghepLoi, setGhepLoi] = useState<string | null>(null)

  const [batOcrBox, setBatOcrBox] = useState(false)
  const [ocrRegion, setOcrRegion] = useState<Region | undefined>(undefined)
  const [fmtSrt, setFmtSrt] = usePersistedState('tblao.ocr.fmt.srt', true)
  const [fmtTxt, setFmtTxt] = usePersistedState('tblao.ocr.fmt.txt', false)
  const [fmtVtt, setFmtVtt] = usePersistedState('tblao.ocr.fmt.vtt', false)
  const [fmtJson, setFmtJson] = usePersistedState('tblao.ocr.fmt.json', false)

  const [batAmThanh, setBatAmThanh] = useState(false)
  const [amThanhFile, setAmThanhFile] = useState('')
  const [amLuongGoc, setAmLuongGoc] = useState(100)

  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPct, setInstallPct] = useState(0)
  const [installErr, setInstallErr] = useState<string | null>(null)

  const vidRef = useRef<HTMLVideoElement | null>(null)
  const unlocked = hasFeature('ocr')

  useEffect(() => {
    void window.api.ocrEngineStatus().then((s) => setHasEngine(s.has))
  }, [])

  useEffect(() => {
    if (!ghepSrt) {
      setSrtGiay(0)
      return
    }
    let huy = false
    void Promise.resolve()
      .then(() => window.api.srtGiay(ghepSrt))
      .then((s) => {
        if (!huy) setSrtGiay(s || 0)
      })
      .catch(() => {
        if (!huy) setSrtGiay(0)
      })
    return () => {
      huy = true
    }
  }, [ghepSrt])

  const caiCongCu = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallPct(0)
    const off = window.api.onOcrInstallProgress(setInstallPct)
    const res = await window.api.ocrInstallEngine()
    off()
    setInstalling(false)
    if (res.ok) setHasEngine(true)
    else setInstallErr(res.error ?? 'Tải công cụ Dịch màn hình thất bại.')
  }

  const addBlurRegion = (): void => {
    if (videoH <= 0 || videoW <= 0) return
    const id = String(Date.now())
    const idx = blurRegions.length
    const color = PALETTE[idx % PALETTE.length]
    const newRegion: BlurRegion = {
      id,
      x0: Math.round(videoW * 0.15),
      x1: Math.round(videoW * 0.85),
      y0: Math.round(videoH * 0.75),
      y1: videoH,
      color
    }
    setBlurRegions((prev) => [...prev, newRegion])
    setActiveBlurId(id)
  }

  const updateBlurRegion = (r: BlurRegion): void => {
    setBlurRegions((prev) => prev.map((item) => (item.id === r.id ? r : item)))
  }

  const removeBlurRegion = (id: string): void => {
    setBlurRegions((prev) => {
      const next = prev.filter((item) => item.id !== id)
      if (activeBlurId === id && next.length > 0) {
        setActiveBlurId(next[0].id)
      }
      return next
    })
  }

  const onMeta = (): void => {
    const v = vidRef.current
    if (!v) return
    setVideoH(v.videoHeight)
    setVideoW(v.videoWidth)
    setBoxH(v.clientHeight)
    setVideoGiay(Number.isFinite(v.duration) ? v.duration : 0)
    if (blurRegions.length === 0) {
      const defId = 'def-1'
      setBlurRegions([
        {
          id: defId,
          x0: Math.round(v.videoWidth * 0.15),
          x1: Math.round(v.videoWidth * 0.85),
          y0: Math.round(v.videoHeight * 0.75),
          y1: v.videoHeight,
          color: PALETTE[0]
        }
      ])
      setActiveBlurId(defId)
    }
    if (!subRegion && v.videoWidth > 0 && v.videoHeight > 0) {
      setSubRegion({
        x0: Math.round(v.videoWidth * 0.1),
        x1: Math.round(v.videoWidth * 0.9),
        y0: Math.round(v.videoHeight * 0.82),
        y1: Math.round(v.videoHeight * 0.94)
      })
    }
    if (!ocrRegion && v.videoWidth > 0 && v.videoHeight > 0) {
      setOcrRegion({
        x0: Math.round(v.videoWidth * 0.15),
        x1: Math.round(v.videoWidth * 0.85),
        y0: Math.round(v.videoHeight * 0.75),
        y1: v.videoHeight
      })
    }
  }

  useEffect(() => {
    const el = vidRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [video])

  const chonVideo = async (): Promise<void> => {
    const files = await window.api.chooseFiles()
    if (!files.length) return
    setVideo(files[0])
    setBuoc('idle')
    setKetQua([])
    setLoi(null)
    setGhep('idle')
    setGhepOut('')
    setGhepLoi(null)
  }

  const chonSrt = async (): Promise<void> => {
    const file = await window.api.chooseSrt()
    if (file) {
      setGhepSrt(file)
    }
  }

  const chonAmThanh = async (): Promise<void> => {
    const file = await window.api.chooseAudio()
    if (file) {
      setAmThanhFile(file)
    }
  }

  const chay = async (): Promise<void> => {
    if (!video || !outputDir) return

    const formats: string[] = []
    if (fmtSrt) formats.push('.srt')
    if (fmtTxt) formats.push('.txt')
    if (fmtVtt) formats.push('.vtt')
    if (fmtJson) formats.push('.json')

    if (formats.length === 0) {
      setLoi('Vui lòng chọn ít nhất một định dạng xuất file.')
      setBuoc('loi')
      return
    }

    setBuoc('doc')
    setPct(0)
    setLoi(null)
    setKetQua([])
    setDongChu('')
    setDangDung(false)

    const y0 = batOcrBox && ocrRegion ? ocrRegion.y0 : -1
    const y1 = batOcrBox && ocrRegion ? ocrRegion.y1 : -1
    const x0 = batOcrBox && ocrRegion ? ocrRegion.x0 : -1
    const x1 = batOcrBox && ocrRegion ? ocrRegion.x1 : -1

    const off = window.api.onOcrProgress((p) => {
      setPct(p.percent)
      if (p.text) setDongChu(p.text)
    })
    const r = await window.api.ocrVideo(video, outputDir, y0, y1, x0, x1, formats)
    off()
    setDangDung(false)

    if (!r.ok) {
      if (r.error === 'Đã huỷ.') {
        setBuoc('idle')
        setDongChu('')
        return
      }
      setLoi(r.error ?? 'Đọc chữ thất bại.')
      setBuoc('loi')
      return
    }
    const ra = r.outputs || (r.output ? [r.output] : [])

    if (dich !== 'none' && r.output) {
      setBuoc('dich')
      const out = r.output.replace(/\.srt$/i, `.${dich}.srt`)
      const t = await window.api.geminiTranslateSrt(r.output, out, dich)
      if (t.ok) ra.push(out)
      else setLoi(`Dịch: ${t.error}`)
    }
    setKetQua(ra)
    const srtOutput = r.outputs?.find(o => o.endsWith('.srt')) || r.output
    if (srtOutput) {
      setGhepSrt(srtOutput)
    }
    setBuoc('xong')
  }

  const dung = async (): Promise<void> => {
    setDangDung(true)
    await window.api.ocrCancel()
  }

  const xuLyVideo = async (): Promise<void> => {
    if (!video || !outputDir) return

    if (!batLamMo && !batPhuDe && !batAmThanh) {
      setGhepLoi('Vui lòng bật ít nhất 1 tính năng (Làm mờ, Thêm phụ đề hoặc Cấu hình âm thanh).')
      setGhep('loi')
      return
    }

    if (batPhuDe && !ghepSrt) {
      setGhepLoi('Vui lòng chọn tệp phụ đề (.srt).')
      setGhep('loi')
      return
    }

    if (batLamMo && blurRegions.length === 0) {
      setGhepLoi('Vui lòng thêm ít nhất 1 vùng làm mờ.')
      setGhep('loi')
      return
    }



    setGhep('chay')
    setGhepPct(0)
    setGhepLoi(null)

    const off = window.api.onBurnProgress((p) => setGhepPct(p.percent < 0 ? 0 : p.percent))
    const r = await window.api.burnStart({
      video,
      srt: batPhuDe ? ghepSrt : null,
      outputDir,
      mode: ghepMode,
      blurRegions: batLamMo ? blurRegions : [],
      lamMo: batLamMo,
      subRegion: batPhuDe ? subRegion : undefined,
      batAmThanh,
      amThanhFile: batAmThanh ? amThanhFile : null,
      amLuongGoc
    })
    off()

    if (!r.ok) {
      if (r.error === 'Đã huỷ.') {
        setGhep('idle')
        return
      }
      setGhepLoi(r.error ?? 'Xử lý video thất bại.')
      setGhep('loi')
      return
    }
    setGhepOut(r.output!)
    setGhep('xong')
  }

  if (!unlocked) return <div className="card muted">Tính năng đang khoá.</div>

  if (hasEngine === false) {
    return (
      <div className="dy-setup">
        <div className="card dy-install-card">
          <div className="dy-install-title">🔍 Cần tải công cụ Dịch màn hình</div>
          <p className="muted">
            Tính năng đọc chữ trên video chạy <b>ngay trên máy bạn</b>. Bấm để tải một lần (~230MB).
          </p>
          {installing ? (
            <>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${installPct}%` }} />
              </div>
              <div className="muted small">Đang tải công cụ… {installPct}%</div>
            </>
          ) : (
            <button className="btn primary" onClick={caiCongCu}>
              Tải công cụ Dịch màn hình
            </button>
          )}
          {installErr && <div className="dy-err small">{installErr}</div>}
        </div>
      </div>
    )
  }

  const dangChay = buoc === 'doc' || buoc === 'dich'
  const phut = (s: number): string => {
    const t = Math.round(s)
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  }
  const lechSrt: 'dai' | 'ngan' | null =
    videoGiay > 0 && srtGiay > 0
      ? srtGiay > videoGiay + 30
        ? 'dai'
        : srtGiay < videoGiay * 0.5
          ? 'ngan'
          : null
      : null

  return (
    <div className="lam-viec">
      <div className="cot-cauhinh">
        <div className="cot-tieude">Cấu hình</div>

        <div className="card options-card">
          <button className="btn primary" onClick={chonVideo} disabled={dangChay}>
            🎞 Chọn video
          </button>
          {video && <div className="muted small ocr-ten">{baseName(video)}</div>}
        </div>

        <div className="card options-card">
          <label className="field">
            <span className="muted small">Thư mục lưu kết quả</span>
            <div className="gk-row">
              <input value={outputDir} readOnly />
              <button
                className="btn"
                onClick={async () => {
                  const d = await window.api.chooseFolder()
                  if (d) setOutputDir(d)
                }}
              >
                Chọn thư mục
              </button>
            </div>
          </label>
        </div>

        <GeminiKey dich={dich} setDich={setDich} />

        {video && (
          <div className="card">
            <div className="cot-tieude" style={{ fontSize: 13, marginBottom: 6 }}>
              🔍 Đọc chữ trên video (OCR)
            </div>

            {/* Checkbox Cấu hình vùng quét OCR */}
            <div style={{ marginBottom: 12 }}>
              <label className="gk-check">
                <input
                  type="checkbox"
                  checked={batOcrBox}
                  onChange={(e) => setBatOcrBox(e.target.checked)}
                />
                <span>Cấu hình vùng quét OCR</span>
              </label>
              {batOcrBox && (
                <div className="muted small" style={{ marginTop: 4, marginLeft: 22, color: '#eab308' }}>
                  💡 Kéo di chuyển và kéo giãn <b>Vùng quét OCR màu vàng</b> trên màn hình xem trước để giới hạn phạm vi quét chữ.
                </div>
              )}
            </div>

            {/* Tùy chọn định dạng xuất file */}
            <div style={{ marginBottom: 12 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>Định dạng xuất file:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', paddingLeft: 2 }}>
                <label className="gk-check">
                  <input type="checkbox" checked={fmtSrt} onChange={(e) => setFmtSrt(e.target.checked)} />
                  <span>.srt</span>
                </label>
                <label className="gk-check">
                  <input type="checkbox" checked={fmtTxt} onChange={(e) => setFmtTxt(e.target.checked)} />
                  <span>.txt</span>
                </label>
                <label className="gk-check">
                  <input type="checkbox" checked={fmtVtt} onChange={(e) => setFmtVtt(e.target.checked)} />
                  <span>.vtt</span>
                </label>
                <label className="gk-check">
                  <input type="checkbox" checked={fmtJson} onChange={(e) => setFmtJson(e.target.checked)} />
                  <span>.json</span>
                </label>
              </div>
            </div>

            <div className="cookie-actions" style={{ flexDirection: 'column', gap: 8 }}>
              {!dangChay && (
                <button
                  className="btn primary"
                  disabled={!outputDir || !batOcrBox}
                  onClick={chay}
                  style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 16px' }}
                >
                  ▶ Bắt đầu đọc chữ OCR
                </button>
              )}
              {buoc === 'doc' && (
                <button
                  className="btn danger"
                  onClick={dung}
                  disabled={dangDung}
                  style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 16px' }}
                >
                  {dangDung ? 'Đang dừng…' : '■ Dừng'}
                </button>
              )}
              {buoc === 'doc' && <span className="cookie-status ok" style={{ width: '100%', textAlign: 'center' }}>Đang đọc… {pct}%</span>}
              {buoc === 'dich' && <span className="cookie-status ok" style={{ width: '100%', textAlign: 'center' }}>✨ Đang dịch…</span>}
            </div>
            {dangChay && (
              <>
                <div className="bar" style={{ marginTop: 10, height: 8 }}>
                  <div className="bar-fill" style={{ width: `${buoc === 'dich' ? 100 : pct}%` }} />
                </div>
                {dongChu && <div className="muted small ocr-dong">{dongChu}</div>}
              </>
            )}
            {loi && <div className="dy-err small">{loi}</div>}
            {buoc === 'xong' && (
              <div className="muted small" style={{ marginTop: 8 }}>
                ✅ Xong ·{' '}
                {ketQua.map((o) => (
                  <button key={o} className="link-btn" onClick={() => window.api.showItem(o)}>
                    {baseName(o)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {video && (
          <div className="card options-card">
            <div className="cot-tieude">Xử lý video (Làm mờ &amp; Phụ đề)</div>

            <div style={{ marginTop: 6 }}>
              <label className="gk-check" style={{ fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={batLamMo}
                  onChange={(e) => setBatLamMo(e.target.checked)}
                />
                <span>1. Cấu hình vùng làm mờ video</span>
              </label>

              {batLamMo && (
                <div style={{ paddingLeft: 22, marginTop: 8 }}>
                  <button className="btn" onClick={addBlurRegion}>
                    ➕ Thêm vùng làm mờ
                  </button>

                  <div className="blur-list">
                    {blurRegions.map((r, idx) => {
                      const isActive = r.id === activeBlurId
                      return (
                        <div
                          key={r.id}
                          className={`blur-item ${isActive ? 'active' : ''}`}
                          onClick={() => setActiveBlurId(r.id)}
                        >
                          <div className="blur-color-badge" style={{ background: r.color }} />
                          <div className="blur-toado">
                            <b>Vùng {idx + 1}:</b> {r.y0} → {r.y1} px (Ngang: {r.x0} → {r.x1} px)
                          </div>
                          {blurRegions.length > 1 && (
                            <button
                              className="blur-del-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeBlurRegion(r.id)
                              }}
                              title="Xoá vùng làm mờ này"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />

            <div>
              <label className="gk-check" style={{ fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={batPhuDe}
                  onChange={(e) => setBatPhuDe(e.target.checked)}
                />
                <span>2. Cấu hình thêm phụ đề</span>
              </label>

              {batPhuDe && (
                <div style={{ paddingLeft: 22, marginTop: 8 }}>
                  <div style={{ marginBottom: 8 }}>
                    <button className="btn" onClick={chonSrt}>
                      📄 Chọn tệp phụ đề (.srt)
                    </button>
                    {ghepSrt ? (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        Đã chọn: <b>{baseName(ghepSrt)}</b>
                      </div>
                    ) : (
                      <div className="muted small" style={{ marginTop: 4, color: '#ff6b6b' }}>
                        * Chưa chọn tệp phụ đề .srt
                      </div>
                    )}
                  </div>

                  {lechSrt && ghepSrt && (
                    <div className="qwarn small" style={{ marginBottom: 8 }}>
                      ⚠ File phụ đề dài <b>{phut(srtGiay)}</b>, video dài <b>{phut(videoGiay)}</b>
                      {lechSrt === 'dai'
                        ? ' — phần phụ đề vượt quá thời lượng video sẽ không hiện.'
                        : ' — phụ đề chỉ phủ được phần đầu video.'}
                    </div>
                  )}

                  <label className="field">
                    <span className="muted small">Cách gắn phụ đề</span>
                    <select
                      value={ghepMode}
                      onChange={(e) => setGhepMode(e.target.value as 'burn' | 'soft')}
                    >
                      <option value="burn">Gắn cố định vào hình (đăng lại đâu cũng còn)</option>
                      <option value="soft">Phụ đề rời, bật/tắt được (chỉ xem trên máy)</option>
                    </select>
                  </label>

                  {ghepMode === 'burn' && (
                    <div className="muted small" style={{ marginTop: 8, background: 'rgba(168, 85, 247, 0.1)', padding: 8, borderRadius: 4, border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                      💡 <b>Vị trí &amp; Cỡ chữ phụ đề:</b> Kéo di chuyển và kéo giãn <b>Khung Phụ Đề màu tím</b> trực tiếp trên khung xem trước video bên phải để điều chỉnh vị trí và cỡ chữ xuất ra.
                    </div>
                  )}
                </div>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />

            <div>
              <label className="gk-check" style={{ fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={batAmThanh}
                  onChange={(e) => setBatAmThanh(e.target.checked)}
                />
                <span>3. Cấu hình âm thanh</span>
              </label>

              {batAmThanh && (
                <div style={{ paddingLeft: 22, marginTop: 8 }}>
                  <div style={{ marginBottom: 8 }}>
                    <button className="btn" onClick={chonAmThanh}>
                      🎵 Chọn tệp âm thanh
                    </button>
                    {amThanhFile ? (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        Đã chọn: <b>{baseName(amThanhFile)}</b>
                      </div>
                    ) : (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        (Không lồng nhạc mới)
                      </div>
                    )}
                  </div>

                  <div className="field" style={{ marginTop: 12 }}>
                    <span className="muted small" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Âm lượng video gốc:</span>
                      <b style={{ color: 'var(--text)' }}>{amLuongGoc}%</b>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={amLuongGoc}
                      onChange={(e) => setAmLuongGoc(Number(e.target.value))}
                      style={{ width: '100%', height: 6, borderRadius: 3, outline: 'none', background: 'var(--border)', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />

            <div className="cookie-actions">
              {ghep !== 'chay' && (
                <button
                  className="btn primary"
                  onClick={xuLyVideo}
                  style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 16px' }}
                >
                  ▶ Bắt đầu xử lý
                </button>
              )}
              {ghep === 'chay' && (
                <>
                  <button className="btn danger" onClick={() => window.api.burnCancel()}>
                    ■ Dừng
                  </button>
                  <span className="cookie-status ok">Đang xử lý… {ghepPct}%</span>
                </>
              )}
            </div>

            {ghep === 'chay' && (
              <div className="bar" style={{ marginTop: 10, height: 8 }}>
                <div className="bar-fill" style={{ width: `${ghepPct}%` }} />
              </div>
            )}
            {ghepLoi && <div className="dy-err small" style={{ marginTop: 8 }}>{ghepLoi}</div>}
            {ghep === 'xong' && (
              <div className="muted small" style={{ marginTop: 8 }}>
                ✅ Đã xử lý xong ·{' '}
                <button className="link-btn" onClick={() => window.api.showItem(ghepOut)}>
                  {baseName(ghepOut)}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="cot-ketqua cot-video">
        <div className="cot-tieude">Video &amp; Các vùng làm mờ</div>
        {video ? (
          <>
            <div className="muted small">
              Xem trước video và điều chỉnh vị trí các <b>vùng làm mờ</b>.
            </div>
            <div className="ocr-sanh">
              <div
                className="ocr-video"
                style={videoW > 0 && videoH > 0 ? { aspectRatio: `${videoW} / ${videoH}` } : undefined}
              >
                <video
                  ref={vidRef}
                  src={srcVideo(video)}
                  onLoadedMetadata={onMeta}
                  onError={() => setLoi('Không mở được video này. Thử định dạng khác (mp4/webm).')}
                  controls
                  muted
                />
                {videoH > 0 && (
                  <RegionBox
                    regions={batLamMo ? blurRegions : []}
                    activeId={activeBlurId}
                    setActiveId={setActiveBlurId}
                    updateRegion={updateBlurRegion}
                    removeRegion={removeBlurRegion}
                    hienSubBox={batPhuDe}
                    subRegion={subRegion}
                    setSubRegion={setSubRegion}
                    hienOcrBox={batOcrBox}
                    ocrRegion={ocrRegion}
                    setOcrRegion={setOcrRegion}
                    videoH={videoH}
                    videoW={videoW}
                    boxH={boxH}
                    xemMo={batLamMo}
                  />
                )}
              </div>
            </div>
            {videoH > 0 && (
              <div className="muted small ocr-toado">
                Video {videoW}×{videoH} · Đang có {blurRegions.length} vùng làm mờ
              </div>
            )}
          </>
        ) : (
          <div className="ocr-sanh">
            <div className="muted small">Chưa chọn video — bấm “Chọn video” bên trái.</div>
          </div>
        )}
      </div>
    </div>
  )
}
