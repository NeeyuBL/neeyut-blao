import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { DICH_LANGS } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'
import GeminiHelp from './GeminiHelp'

/**
 * O nhap API key + nut kiem tra + chon ngon ngu dich.
 * Dung chung cho tab Phu de va (sau nay) tab OCR.
 */
export default function GeminiKey({
  dich,
  setDich
}: {
  dich: string
  setDich: (v: string) => void
}): JSX.Element {
  const [key, setKey] = useState('')
  const [daLuu, setDaLuu] = useState(false)
  const [dangKiem, setDangKiem] = useState(false)
  const [kq, setKq] = useState<{ ok: boolean; message: string } | null>(null)
  const [hienHd, setHienHd] = useState(false)
  const [moRong, setMoRong] = usePersistedState('tblao.gemini.mo', false)

  useEffect(() => {
    void window.api.geminiHasKey().then(setDaLuu)
  }, [])

  const kiem = async (): Promise<void> => {
    setDangKiem(true)
    setKq(null)
    if (key.trim()) await window.api.geminiSaveKey(key.trim())
    const r = await window.api.geminiCheckKey(key.trim())
    setKq(r)
    setDangKiem(false)
    if (r.ok) {
      setDaLuu(true)
      setKey('') // khong giu khoa trong o nua — da luu ma hoa duoi may
    }
  }

  const xoa = async (): Promise<void> => {
    await window.api.geminiSaveKey('')
    setDaLuu(false)
    setKq(null)
    setDich('none')
  }

  return (
    <div className="card gk">
      <button className="gk-head" onClick={() => setMoRong(!moRong)}>
        <span className="gk-title">✨ Dịch phụ đề bằng AI</span>
        <span className={`gk-badge ${daLuu ? 'ok' : ''}`}>{daLuu ? 'Đã có khoá' : 'Tuỳ chọn'}</span>
        <span className="gk-caret">{moRong ? '▴' : '▾'}</span>
      </button>

      {moRong && (
        <div className="gk-body">
          <p className="muted small">
            Dùng <b>API key Google AI Studio của bạn</b> để dịch phụ đề sang mọi ngôn ngữ, chất lượng
            cao hơn hẳn bộ dịch có sẵn. Miễn phí, khoá chỉ lưu trên máy bạn.
          </p>

          <div className="gk-row">
            <input
              type="password"
              placeholder={daLuu ? '••••••••••  (đã lưu — dán khoá mới để thay)' : 'Dán API key vào đây'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              spellCheck={false}
            />
            <button className="btn" disabled={dangKiem || (!key.trim() && !daLuu)} onClick={kiem}>
              {dangKiem ? 'Đang kiểm…' : 'Kiểm tra key'}
            </button>
            {daLuu && (
              <button className="btn" onClick={xoa}>
                Xoá khoá
              </button>
            )}
          </div>

          {kq && (
            <div className={`gk-kq small ${kq.ok ? 'ok' : 'err'}`}>
              {kq.ok ? '✔' : '✗'} {kq.message}
            </div>
          )}

          <div className="muted small gk-note">
            Việc dùng 1 API KEY quá nhiều lần trong ngày sẽ giảm chất lượng dịch.
          </div>

          {/* O chon ngon ngu hien LUON, khong doi kiem tra key.
              Moi lan kiem tra la 1 request cua user — dung bat ho dot mot lan goi
              chi de mo khoa mot cai dropdown, nhat la khi ho biet key con song. */}
          <div className="gk-row2">
            <label className="field gk-field">
              <span className="muted small">Dịch phụ đề sang</span>
              <select value={dich} onChange={(e) => setDich(e.target.value)}>
                <option value="none">Không dịch</option>
                {/* value = MA ngon ngu (vi/en/…) chu khong phai nhan: ma nay
                    dung dat ten file `video.vi.srt` — dung quy uoc trinh phat
                    tu nap phu de. Dat "video.Tiếng Việt.srt" thi khong tu nap. */}
                {DICH_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" onClick={() => setHienHd(true)}>
              📖 Hướng dẫn lấy key
            </button>
          </div>
        </div>
      )}

      {hienHd && <GeminiHelp onClose={() => setHienHd(false)} />}
    </div>
  )
}
