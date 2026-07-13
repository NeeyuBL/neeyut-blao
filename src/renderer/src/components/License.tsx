import type { JSX } from 'react'

const MIT_LICENSE = `MIT License

Copyright (c) 2026 NeeyuBL

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

const THIRD_PARTY = [
  {
    name: 'ffmpeg',
    role: 'Xử lý & ghép âm thanh/video, đổi định dạng, nhúng phụ đề.',
    license: 'LGPL / GPL',
    link: 'https://ffmpeg.org/legal.html'
  },
  {
    name: 'Bộ tải xuống mã nguồn mở',
    role: 'Công cụ tải nội dung từ các nền tảng.',
    license: 'Unlicense (phạm vi công cộng)',
    link: null
  }
]

export default function License(): JSX.Element {
  return (
    <div className="license-page">
      {/* Mien tru trach nhiem */}
      <div className="lic-disclaimer">
        <div className="lic-disclaimer-tag">⚠️ Miễn trừ trách nhiệm</div>
        <p>
          Người dùng tự chịu trách nhiệm về việc tải nội dung, tuân thủ điều khoản dịch vụ của nền
          tảng gốc và luật bản quyền tại khu vực của họ.
        </p>
      </div>

      {/* Giay phep T-blao */}
      <section className="lic-section">
        <h3>Giấy phép T-blao</h3>
        <p className="muted">
          T-blao là phần mềm mã nguồn mở, phát hành theo giấy phép <b>MIT</b>.
        </p>
        <pre className="license-text">{MIT_LICENSE}</pre>
      </section>

      {/* Thanh phan ben thu ba */}
      <section className="lic-section">
        <h3>Thành phần bên thứ ba</h3>
        <p className="muted small">
          T-blao sử dụng các công cụ mã nguồn mở dưới đây, được tải về khi cần (không kèm trong bộ
          cài).
        </p>
        <div className="lic-list">
          {THIRD_PARTY.map((t) => (
            <div className="lic-item" key={t.name}>
              <div className="lic-item-head">
                <span className="lic-name">{t.name}</span>
                <span className="lic-badge">{t.license}</span>
              </div>
              <div className="muted small">{t.role}</div>
              {t.link && (
                <button
                  className="lic-link"
                  onClick={() => window.api.openExternal(t.link!)}
                >
                  {t.link}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <p className="lic-foot muted small">
        Đây không phải tư vấn pháp lý. Vui lòng tham khảo luật tại khu vực của bạn khi sử dụng.
      </p>
    </div>
  )
}
