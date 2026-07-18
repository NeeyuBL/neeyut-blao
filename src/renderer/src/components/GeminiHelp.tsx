import type { JSX } from 'react'
import { useEffect } from 'react'

const STUDIO = 'https://aistudio.google.com/'

/** Bang huong dan lay API key. Dong bang: bam ra ngoai, nut X, hoac phim Esc. */
export default function GeminiHelp({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // Bam vao NEN (ngoai bang) -> dong. stopPropagation o trong de bam vao bang
    // khong bi dong theo.
    <div className="modal-nen" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Hướng dẫn lấy Gemini API Key</div>
          <button className="modal-x" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="hd-step">
            <div className="hd-num">1</div>
            <div>
              <b>Truy cập Google AI Studio</b>
              <p className="muted small">Đăng nhập bằng tài khoản Google (Gmail) của bạn.</p>
              <button className="btn" onClick={() => window.api.openExternal(STUDIO)}>
                ↗ Mở Google AI Studio
              </button>
            </div>
          </div>

          <div className="hd-step">
            <div className="hd-num">2</div>
            <div>
              <b>Tạo API Key</b>
              <p className="muted small">
                Ở menu bên trái, bấm <b>“Get API key”</b> → bảng hiện ra, chọn{' '}
                <b>“Create API key”</b>.
              </p>
            </div>
          </div>

          <div className="hd-step">
            <div className="hd-num">3</div>
            <div>
              <b>Chọn dự án</b>
              <p className="muted small">
                Đã có dự án Google Cloud → chọn từ danh sách. Người mới → chọn{' '}
                <b>“Create API key in new project”</b> để hệ thống tự thiết lập.
              </p>
            </div>
          </div>

          <div className="hd-step">
            <div className="hd-num">4</div>
            <div>
              <b>Sao chép key</b>
              <p className="muted small">
                Một đoạn mã dài hiện ra — đó là API Key của bạn. Bấm <b>“Copy”</b>, rồi dán vào ô
                trong T-blao.
              </p>
            </div>
          </div>

          <div className="hd-canh-bao">
            <b>⚠️ Lưu ý bảo mật</b>
            <p className="small">
              Giữ mã này riêng tư. <b>Đừng chia sẻ lên nơi công khai như GitHub</b> — người khác có
              thể dùng ké hạn mức của bạn.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
