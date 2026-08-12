import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { DICH_LANGS, type DichProvider } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'
import GeminiHelp from './GeminiHelp'
import OpenAIHelp from './OpenAIHelp'

/**
 * O nhap API key + chon nha cung cap (Gemini | ChatGPT) + ngon ngu dich.
 * Dung chung cho tab Phu de va tab OCR.
 */
export default function GeminiKey({
  dich,
  setDich
}: {
  dich: string
  setDich: (v: string) => void
}): JSX.Element {
  const [provider, setProvider] = usePersistedState<DichProvider>('tblao.dich.provider', 'gemini')
  const [key, setKey] = useState('')
  const [daLuu, setDaLuu] = useState(false)
  const [dangKiem, setDangKiem] = useState(false)
  const [kq, setKq] = useState<{ ok: boolean; message: string } | null>(null)
  const [hienHd, setHienHd] = useState(false)
  const [moRong, setMoRong] = usePersistedState('tblao.gemini.mo', false)

  /** Ghi localStorage dong bo — de tab cha doc dung provider ngay khi dich. */
  const chonProvider = (p: DichProvider): void => {
    setProvider(p)
    try {
      localStorage.setItem('tblao.dich.provider', JSON.stringify(p))
    } catch {
      /* bo qua */
    }
  }

  useEffect(() => {
    setKey('')
    setKq(null)
    void window.api.translateHasKey(provider).then(setDaLuu)
  }, [provider])

  const kiem = async (): Promise<void> => {
    setDangKiem(true)
    setKq(null)
    if (key.trim()) await window.api.translateSaveKey(provider, key.trim())
    const r = await window.api.translateCheckKey(provider, key.trim())
    setKq(r)
    setDangKiem(false)
    if (r.ok) {
      setDaLuu(true)
      setKey('')
    }
  }

  const xoa = async (): Promise<void> => {
    await window.api.translateSaveKey(provider, '')
    setDaLuu(false)
    setKq(null)
    setDich('none')
  }

  const laGemini = provider === 'gemini'

  return (
    <div className="card gk">
      <button className="gk-head" onClick={() => setMoRong(!moRong)}>
        <span className="gk-title">✨ Dịch phụ đề bằng AI</span>
        <span className={`gk-badge ${daLuu ? 'ok' : ''}`}>{daLuu ? 'Đã kết nối' : 'Tuỳ chọn'}</span>
        <span className="gk-caret">{moRong ? '▴' : '▾'}</span>
      </button>

      {moRong && (
        <div className="gk-body">
          <div className="gk-providers" role="radiogroup" aria-label="Nhà cung cấp dịch">
            <button
              type="button"
              className={`gk-prov ${laGemini ? 'active' : ''}`}
              onClick={() => chonProvider('gemini')}
            >
              Gemini
            </button>
            <button
              type="button"
              className={`gk-prov ${!laGemini ? 'active' : ''}`}
              onClick={() => chonProvider('openai')}
            >
              OpenAI
            </button>
          </div>

          <p className="muted small">
            {laGemini ? (
              <>
                Kết nối Google AI Studio để dịch phụ đề. Thông tin kết nối chỉ được lưu trên máy bạn.
              </>
            ) : (
              <>
                Kết nối OpenAI để dịch phụ đề. Thông tin kết nối chỉ được lưu trên máy bạn; OpenAI
                tính phí theo lượng sử dụng.
              </>
            )}
          </p>

          <div className="gk-row">
            <input
              type="password"
              placeholder={
                daLuu
                  ? '••••••••••  (đã lưu — dán khoá mới để thay)'
                  : laGemini
                    ? 'Dán Gemini API key vào đây'
                    : 'Dán OpenAI API key vào đây'
              }
              value={key}
              onChange={(e) => setKey(e.target.value)}
              spellCheck={false}
            />
            <button className="btn" disabled={dangKiem || (!key.trim() && !daLuu)} onClick={kiem}>
              {dangKiem ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
            </button>
            {daLuu && (
              <button className="btn" onClick={xoa}>
                Ngắt kết nối
              </button>
            )}
          </div>

          {kq && (
            <div className={`gk-kq small ${kq.ok ? 'ok' : 'err'}`}>
              {kq.ok ? '✔' : '✗'} {kq.message}
            </div>
          )}

          <div className="muted small gk-note">
            {laGemini
              ? 'Google có thể giới hạn số lượt dịch trong ngày.'
              : 'T-blao tự chọn cách xử lý phù hợp để cân bằng chất lượng và chi phí.'}
          </div>

          <div className="gk-row2">
            <label className="field gk-field">
              <span className="muted small">Dịch phụ đề sang</span>
              <select value={dich} onChange={(e) => setDich(e.target.value)}>
                <option value="none">Không dịch</option>
                {DICH_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" onClick={() => setHienHd(true)}>
              📖 Hướng dẫn kết nối
            </button>
          </div>
        </div>
      )}

      {hienHd &&
        (laGemini ? (
          <GeminiHelp onClose={() => setHienHd(false)} />
        ) : (
          <OpenAIHelp onClose={() => setHienHd(false)} />
        ))}
    </div>
  )
}
