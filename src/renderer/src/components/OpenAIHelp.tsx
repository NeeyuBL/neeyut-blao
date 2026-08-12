import type { JSX } from 'react'
import { useEffect } from 'react'

const PLATFORM = 'https://platform.openai.com/api-keys'

/** Bang huong dan lay OpenAI API key. */
export default function OpenAIHelp({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-nen" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Kết nối OpenAI</div>
          <button className="modal-x" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="hd-step">
            <div className="hd-num">1</div>
            <div>
              <b>Truy cập OpenAI Platform</b>
              <p className="muted small">Đăng nhập tài khoản OpenAI (ChatGPT) của bạn.</p>
              <button className="btn" onClick={() => window.api.openExternal(PLATFORM)}>
                ↗ Mở OpenAI API Keys
              </button>
            </div>
          </div>

          <div className="hd-step">
            <div className="hd-num">2</div>
            <div>
              <b>Tạo khóa kết nối</b>
              <p className="muted small">
                Bấm <b>“Create new secret key”</b>, đặt tên (tuỳ chọn), rồi tạo khoá.
              </p>
            </div>
          </div>

          <div className="hd-step">
            <div className="hd-num">3</div>
            <div>
              <b>Sao chép khóa</b>
              <p className="muted small">
                Key chỉ hiện một lần — bấm <b>“Copy”</b>, rồi dán vào ô trong T-blao. Key thường bắt
                đầu bằng <b>sk-</b>.
              </p>
            </div>
          </div>

          <div className="hd-canh-bao">
            <b>⚠️ Lưu ý</b>
            <p className="small">
              OpenAI API là dịch vụ <b>tính phí theo用量</b>. Giữ mã riêng tư —{' '}
              <b>đừng chia sẻ lên nơi công khai như GitHub</b>.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
