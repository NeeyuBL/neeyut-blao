import type { JSX } from 'react'
import { useState } from 'react'

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

// MIT bat buoc giu nguyen thong bao ban quyen cua tac gia goc
const DOUYIN_MIT = `MIT License

Copyright (c) 2026 jiji262

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

interface ThirdParty {
  group: string
  name: string
  license: string
  link: string | null
  copyright?: string
  notice?: string
}

// Giay phep lay tu sieu du lieu goi / the model, KHONG suy doan.
// Xem ban day du o THIRD-PARTY-NOTICES.txt trong kho ma nguon.
const G_TOOL = 'Công cụ tải về khi cần'
const G_LIB = 'Thư viện xử lý âm thanh'
const G_MODEL = 'Model AI'
const G_GPU = 'Tăng tốc GPU (chỉ máy NVIDIA)'

const THIRD_PARTY: ThirdParty[] = [
  {
    group: G_TOOL,
    name: 'ffmpeg',
    license: 'LGPL / GPL',
    link: 'https://ffmpeg.org/legal.html'
  },
  {
    group: G_TOOL,
    name: 'Bộ tải xuống mã nguồn mở',
    license: 'Unlicense (phạm vi công cộng)',
    link: null
  },
  {
    group: G_TOOL,
    name: 'Bộ tải Douyin',
    license: 'MIT',
    link: null,
    copyright: 'Copyright (c) 2026 jiji262',
    notice: DOUYIN_MIT
  },

  {
    group: G_LIB,
    name: 'faster-whisper',
    license: 'MIT',
    link: 'https://github.com/SYSTRAN/faster-whisper',
    copyright: 'SYSTRAN'
  },
  {
    group: G_LIB,
    name: 'CTranslate2',
    license: 'MIT',
    link: 'https://github.com/OpenNMT/CTranslate2',
    copyright: 'OpenNMT'
  },
  {
    group: G_LIB,
    name: 'ONNX Runtime',
    license: 'MIT',
    link: 'https://github.com/microsoft/onnxruntime',
    copyright: 'Microsoft Corporation'
  },
  {
    group: G_LIB,
    name: 'Tokenizers',
    license: 'Apache-2.0',
    link: 'https://github.com/huggingface/tokenizers',
    copyright: 'Hugging Face'
  },
  {
    group: G_LIB,
    name: 'PyAV · NumPy · Protocol Buffers',
    license: 'BSD 3-Clause',
    link: 'https://opensource.org/licenses/BSD-3-Clause'
  },
  {
    group: G_LIB,
    name: 'FlatBuffers · huggingface_hub',
    license: 'Apache-2.0',
    link: 'https://www.apache.org/licenses/LICENSE-2.0'
  },
  {
    group: G_LIB,
    name: 'tqdm',
    license: 'MPL-2.0 và MIT',
    link: 'https://github.com/tqdm/tqdm'
  },

  {
    group: G_MODEL,
    name: 'Whisper',
    license: 'MIT',
    link: 'https://huggingface.co/openai/whisper-small',
    copyright: 'OpenAI · SYSTRAN'
  },
  {
    group: G_MODEL,
    name: 'pyannote segmentation 3.0',
    license: 'MIT',
    link: 'https://huggingface.co/pyannote/segmentation-3.0',
    copyright: 'Hervé Bredin và cộng sự — dự án pyannote.audio'
  },
  {
    group: G_MODEL,
    name: 'CAM++ / 3D-Speaker',
    license: 'Apache-2.0',
    link: 'https://github.com/modelscope/3D-Speaker',
    copyright: 'ModelScope / 3D-Speaker'
  },
  {
    group: G_GPU,
    name: 'NVIDIA cuBLAS & cuDNN',
    license: 'NVIDIA CUDA EULA / cuDNN SLA',
    link: 'https://docs.nvidia.com/cuda/eula/',
    copyright: 'NVIDIA Corporation'
  }
]

const GROUPS = [G_TOOL, G_LIB, G_MODEL, G_GPU]

/** 1 o giay phep dang accordion: bam vao tieu de moi so ra noi dung. */
function LicCard({
  title,
  badge,
  children,
  defaultOpen = false
}: {
  title: string
  badge: string
  children: JSX.Element
  defaultOpen?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`lic-card ${open ? 'open' : ''}`}>
      <button className="lic-card-head" onClick={() => setOpen((o) => !o)}>
        <span className="lic-name">{title}</span>
        <span className="lic-badge">{badge}</span>
        <span className="lic-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="lic-card-body">{children}</div>}
    </div>
  )
}

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
        <p className="muted small">
          T-blao là phần mềm mã nguồn mở. Bấm để xem chi tiết giấy phép.
        </p>
        <LicCard title="T-blao" badge="MIT">
          <pre className="license-text">{MIT_LICENSE}</pre>
        </LicCard>
      </section>

      {/* Thanh phan ben thu ba */}
      <section className="lic-section">
        <h3>Thành phần bên thứ ba</h3>
        <p className="muted small">
          T-blao được dựng trên các công trình mã nguồn mở dưới đây. Bản quyền thuộc về tác giả gốc.
          Bấm từng mục để xem chi tiết.
        </p>
        {GROUPS.map((g) => (
          <div key={g} className="lic-group">
            <div className="lic-group-title small">{g}</div>
            <div className="lic-list">
              {THIRD_PARTY.filter((t) => t.group === g).map((t) => (
                <LicCard key={t.name} title={t.name} badge={t.license}>
                  <>
                    {t.copyright && <div className="lic-copyright small">{t.copyright}</div>}
                    {t.notice && <pre className="license-text lic-notice">{t.notice}</pre>}
                    {t.link && (
                      <button className="lic-link" onClick={() => window.api.openExternal(t.link!)}>
                        {t.link}
                      </button>
                    )}
                  </>
                </LicCard>
              ))}
            </div>
          </div>
        ))}
      </section>

      <p className="lic-foot muted small">
        Đây không phải tư vấn pháp lý. Vui lòng tham khảo luật tại khu vực của bạn khi sử dụng.
      </p>
    </div>
  )
}
