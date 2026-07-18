import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { GpuInfo, WhisperRequest } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'
import { hasFeature } from '../lib/license'
import { useQueueRunner } from '../lib/useQueueRunner'
import RunControls from './RunControls'
import GeminiKey from './GeminiKey'

type ItemStatus = 'queued' | 'running' | 'translating' | 'done' | 'error'

interface WhItem {
  id: string
  input: string
  name: string
  status: ItemStatus
  percent: number
  language: string | null
  outputs: string[]
  speakers: number
  error: string | null
}

// Cac muc model cho user chon (can bang toc do / chinh xac / dung luong tai).
const MODELS: { value: string; label: string; note: string }[] = [
  { value: 'base', label: 'Nhanh (base)', note: '~145MB · nhanh, độ chính xác vừa' },
  { value: 'small', label: 'Cân bằng (small)', note: '~484MB · khuyên dùng' },
  { value: 'medium', label: 'Chính xác (medium)', note: '~1.5GB · chậm hơn, chính xác cao' }
]

const LANGS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Tự nhận diện' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'Tiếng Anh' },
  { value: 'zh', label: 'Tiếng Trung' },
  { value: 'ja', label: 'Tiếng Nhật' },
  { value: 'ko', label: 'Tiếng Hàn' }
]

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

export default function AudioText({
  outputDir,
  setOutputDir,
  subInbox
}: {
  outputDir: string
  setOutputDir: (d: string) => void
  subInbox: { path: string; id: string } | null
}): JSX.Element {
  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPct, setInstallPct] = useState(0)
  const [installErr, setInstallErr] = useState<string | null>(null)

  const [model, setModel] = usePersistedState('tblao.wh.model', 'small')
  const [language, setLanguage] = usePersistedState('tblao.wh.lang', 'auto')
  const [translateEn, setTranslateEn] = usePersistedState('tblao.wh.translate', false)
  const [diarize, setDiarize] = usePersistedState('tblao.wh.diarize', false)
  const [numSpeakers, setNumSpeakers] = usePersistedState('tblao.wh.speakers', 0)
  const [fmtSrt, setFmtSrt] = usePersistedState('tblao.wh.srt', true)
  const [fmtTxt, setFmtTxt] = usePersistedState('tblao.wh.txt', false)
  const [fmtVtt, setFmtVtt] = usePersistedState('tblao.wh.vtt', false)

  // Dich phu de bang API key cua user — 'none' = khong dich
  const [dich, setDich] = usePersistedState('tblao.wh.dich', 'none')
  const [dichErr, setDichErr] = useState<string | null>(null)

  const [items, setItems] = useState<WhItem[]>([])
  const runner = useQueueRunner<WhItem>()

  // Tang toc GPU (tuy chon) — buoc quet an toan truoc khi cho tai goi CUDA
  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [gpuBusy, setGpuBusy] = useState(false)
  const [cudaHas, setCudaHas] = useState(false)
  const [cudaInstalling, setCudaInstalling] = useState(false)
  const [cudaPct, setCudaPct] = useState(0)
  const [cudaErr, setCudaErr] = useState<string | null>(null)
  const [useGpu, setUseGpu] = usePersistedState('tblao.wh.useGpu', true)

  const unlocked = hasFeature('audio2text')
  // Thuc su chay GPU khi: card du dieu kien + da tai goi + user bat cong tac
  const gpuActive = !!gpu?.canAccelerate && cudaHas && useGpu

  const detectGpu = async (): Promise<void> => {
    setGpuBusy(true)
    setGpu(await window.api.whisperDetectGpu())
    setGpuBusy(false)
  }

  const installCuda = async (): Promise<void> => {
    setCudaInstalling(true)
    setCudaErr(null)
    setCudaPct(0)
    const off = window.api.onWhisperCudaProgress(setCudaPct)
    const res = await window.api.whisperInstallCuda()
    off()
    setCudaInstalling(false)
    if (res.ok) setCudaHas(true)
    else setCudaErr(res.error ?? 'Tải gói tăng tốc thất bại.')
  }

  useEffect(() => {
    void window.api.whisperEngineStatus().then((s) => setHasEngine(s.has))
    void window.api.whisperDetectGpu().then(setGpu)
    void window.api.whisperCudaStatus().then((s) => setCudaHas(s.has))
    const off = window.api.onWhisperProgress((p) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === p.id
            ? {
                ...it,
                percent: p.percent >= 0 ? p.percent : it.percent,
                language: p.language ?? it.language,
                status:
                  p.status === 'finished'
                    ? 'done'
                    : p.status === 'error'
                      ? 'error'
                      : 'running',
                error: p.status === 'error' ? p.line : it.error
              }
            : it
        )
      )
    })
    return off
  }, [])

  // Nhan file gui tu tab Tai xuong ("Lay sub")
  useEffect(() => {
    if (!subInbox) return
    addFiles([subInbox.path])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subInbox?.id])

  const addFiles = (paths: string[]): void => {
    const newItems: WhItem[] = paths
      .filter((p) => p && p.trim())
      .map((p) => ({
        id: crypto.randomUUID(),
        input: p,
        name: baseName(p),
        status: 'queued',
        percent: 0,
        language: null,
        outputs: [],
        speakers: 0,
        error: null
      }))
    if (newItems.length) setItems((prev) => [...prev, ...newItems])
  }

  const chooseFiles = async (): Promise<void> => {
    const paths = await window.api.chooseFiles()
    if (paths.length) addFiles(paths)
  }

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setOutputDir(dir)
  }

  const installEngine = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallPct(0)
    const off = window.api.onWhisperInstallProgress(setInstallPct)
    const res = await window.api.whisperInstallEngine()
    off()
    setInstalling(false)
    if (res.ok) setHasEngine(true)
    else setInstallErr(res.error ?? 'Tải công cụ Audio→Text thất bại.')
  }

  const buildReq = (it: WhItem): WhisperRequest => {
    const formats: string[] = []
    if (fmtSrt) formats.push('srt')
    if (fmtTxt) formats.push('txt')
    if (fmtVtt) formats.push('vtt')
    return {
      input: it.input,
      outputDir,
      model,
      language,
      task: translateEn ? 'translate' : 'transcribe',
      formats: formats.length ? formats : ['srt'],
      device: gpuActive ? 'cuda' : 'cpu',
      diarize,
      speakers: numSpeakers
    }
  }

  const runItem = async (it: WhItem): Promise<void> => {
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, status: 'running', percent: 0, error: null } : x))
    )
    const res = await window.api.whisperTranscribe(it.id, buildReq(it))

    // Dich .srt bang API key cua user (neu user da bat). Dich hong thi VAN giu
    // ban goc — suy giam nhe nhang, khong lam hong ca muc.
    const outputs = [...res.outputs]
    if (res.ok && dich !== 'none') {
      const srt = res.outputs.find((o) => o.toLowerCase().endsWith('.srt'))
      if (srt) {
        setItems((prev) =>
          prev.map((x) => (x.id === it.id ? { ...x, status: 'translating' } : x))
        )
        const out = srt.replace(/\.srt$/i, `.${dich}.srt`)
        const t = await window.api.geminiTranslateSrt(srt, out, dich)
        if (t.ok) outputs.push(out)
        else setDichErr(t.error ?? 'Dịch thất bại.')
      }
    }

    setItems((prev) =>
      prev.map((x) =>
        x.id === it.id
          ? {
              ...x,
              status: res.ok ? 'done' : 'error',
              percent: res.ok ? 100 : x.percent,
              outputs,
              speakers: res.speakers,
              error: res.ok ? null : res.error
            }
          : x
      )
    )
  }

  const startRun = (): void => {
    if (!outputDir || !unlocked || noFormat) return
    const queue = items.filter((it) => it.status === 'queued' || it.status === 'error')
    void runner.run(queue, runItem)
  }

  const removeItem = (id: string): void => setItems((prev) => prev.filter((x) => x.id !== id))
  const clearAll = (): void => {
    if (runner.active) return
    setItems([])
  }
  const pending = items.filter((it) => it.status === 'queued' || it.status === 'error').length
  const noFormat = !fmtSrt && !fmtTxt && !fmtVtt

  // ----- Man cai engine -----
  if (hasEngine === false) {
    return (
      <div className="dy-setup">
        <div className="card dy-install-card">
          <div className="dy-install-title">📝 Cần tải công cụ Audio→Text</div>
          <p className="muted">
            Tính năng chuyển giọng nói thành phụ đề dùng AI chạy <b>ngay trên máy bạn</b> (không cần
            mạng sau khi tải, không lộ dữ liệu). Bấm để tải một lần (~240MB), sau đó dùng thoải mái.
          </p>
          {installing ? (
            <>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${installPct}%` }} />
              </div>
              <div className="muted small">Đang tải công cụ… {installPct}%</div>
            </>
          ) : (
            <button className="btn primary" onClick={installEngine}>
              Tải công cụ Audio→Text
            </button>
          )}
          {installErr && <div className="dy-err small">{installErr}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="lam-viec">
      {/* ---------- COT GIUA: cau hinh ---------- */}
      <div className="cot-cauhinh">
        <div className="cot-tieude">Cấu hình</div>
      {/* Tuy chon */}
      <div className="card options-card">
        <div className="folder-row">
          <input
            className="folder-input"
            value={outputDir}
            readOnly
            title={outputDir}
            placeholder="Thư mục lưu phụ đề"
          />
          <button className="btn" onClick={chooseFolder}>
            Chọn thư mục
          </button>
        </div>

        <div className="options" style={{ marginTop: 12 }}>
          <label className="field">
            <span>Chất lượng (model)</span>
            <select className="mini-input" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ngôn ngữ nói</span>
            <select
              className="mini-input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          {MODELS.find((m) => m.value === model)?.note}
          {model === 'medium' && ' — máy không có GPU sẽ chạy khá chậm.'}
        </div>

        <div className="options" style={{ marginTop: 12 }}>
          <label className="check">
            <input type="checkbox" checked={fmtSrt} onChange={(e) => setFmtSrt(e.target.checked)} />
            Xuất .srt (phụ đề)
          </label>
          <label className="check">
            <input type="checkbox" checked={fmtTxt} onChange={(e) => setFmtTxt(e.target.checked)} />
            Xuất .txt (văn bản)
          </label>
          <label className="check">
            <input type="checkbox" checked={fmtVtt} onChange={(e) => setFmtVtt(e.target.checked)} />
            Xuất .vtt (sub web)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={translateEn}
              onChange={(e) => setTranslateEn(e.target.checked)}
            />
            Dịch sang tiếng Anh
          </label>
        </div>
        {noFormat && <div className="dy-err small">Hãy chọn ít nhất 1 định dạng xuất.</div>}

        {/* Nhan dien nguoi noi (diarization) */}
        <div className="options" style={{ marginTop: 12 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={diarize}
              onChange={(e) => setDiarize(e.target.checked)}
            />
            Nhận diện người nói (ai nói lúc nào)
          </label>
          {diarize && (
            <label className="field">
              <span>Số người nói</span>
              <input
                className="mini-input"
                type="number"
                min={0}
                max={20}
                value={numSpeakers}
                onChange={(e) => setNumSpeakers(Math.max(0, Number(e.target.value) || 0))}
                title="0 = để hệ thống tự đoán"
              />
            </label>
          )}
        </div>
        {diarize && (
          <div className="muted small" style={{ marginTop: 6 }}>
            Phụ đề sẽ có nhãn <code>[SPEAKER_00]</code>, <code>[SPEAKER_01]</code>… ·{' '}
            {numSpeakers > 0 ? `ép đúng ${numSpeakers} người` : 'để 0 = tự đoán số người'} · hợp
            phỏng vấn, podcast. Xử lý lâu hơn một chút.
          </div>
        )}
      </div>

      <GeminiKey dich={dich} setDich={setDich} />
      {dichErr && <div className="dy-err small">Dịch phụ đề: {dichErr}</div>}

      {/* Tang toc GPU (tuy chon) */}
      <div className="card">
        <div className="cookie-head">
          <div>
            <div className="cookie-title">Tăng tốc GPU (không bắt buộc)</div>
            <div className="muted small">
              Máy có card <b>NVIDIA</b> sẽ xử lý nhanh hơn nhiều lần. Máy khác vẫn chạy tốt bằng CPU.
            </div>
          </div>
          {gpu &&
            (gpu.canAccelerate ? (
              <span className="cookie-status ok">Sẵn sàng tăng tốc</span>
            ) : (
              <span className="cookie-status">Dùng CPU</span>
            ))}
        </div>

        <div className="cookie-actions">
          <button className="btn" onClick={detectGpu} disabled={gpuBusy || cudaInstalling}>
            {gpuBusy ? 'Đang kiểm tra…' : 'Kiểm tra lại GPU'}
          </button>
          {gpu?.canAccelerate && !cudaHas && !cudaInstalling && (
            <button className="btn primary" onClick={installCuda}>
              Tải gói tăng tốc (~1GB)
            </button>
          )}
          {cudaHas && (
            <label className="check">
              <input
                type="checkbox"
                checked={useGpu}
                onChange={(e) => setUseGpu(e.target.checked)}
              />
              Dùng GPU khi xử lý
            </label>
          )}
        </div>

        {cudaInstalling && (
          <>
            <div className="bar" style={{ marginTop: 8 }}>
              <div className="bar-fill" style={{ width: `${cudaPct}%` }} />
            </div>
            <div className="muted small">Đang tải gói tăng tốc GPU… {cudaPct}%</div>
          </>
        )}
        {cudaErr && <div className="dy-err small">{cudaErr}</div>}

        {gpu && !cudaInstalling && (
          <div className="muted small cookie-msg">
            {gpu.hasNvidia ? (
              <>
                Phát hiện: <b>{gpu.name}</b>
                {gpu.driverVersion ? ` · driver ${gpu.driverVersion}` : ''}
                {gpu.cudaVersion ? ` · CUDA ${gpu.cudaVersion}` : ''}
                {cudaHas && (
                  <span> · {gpuActive ? 'đang dùng GPU ⚡' : 'đã cài gói (đang tắt)'}</span>
                )}
              </>
            ) : (
              'Không thấy GPU NVIDIA trên máy — dùng CPU (vẫn nhanh).'
            )}
            {gpu.reason && gpu.hasNvidia && <div className="qwarn small">{gpu.reason}</div>}
          </div>
        )}
      </div>

      {/* Chon file */}
      <div className="url-row">
        <button className="btn primary" onClick={chooseFiles}>
          📂 Chọn file audio/video
        </button>
        <span className="muted small">Hỗ trợ mp3, m4a, wav… và cả file video (tự tách tiếng).</span>
      </div>
      </div>

      {/* ---------- COT PHAI: hang doi ---------- */}
      <div className="cot-ketqua cot-hangdoi">
        <div className="cot-tieude">Hàng đợi</div>

      {/* Hang doi */}
      {items.length > 0 && (
        <>
          <div className="queue-bar">
            <div className="queue-summary muted small">{items.length} tệp</div>
            <div className="queue-actions">
              <button className="btn" onClick={clearAll} disabled={runner.active}>
                Xóa hết
              </button>
              <RunControls
                runState={runner.runState}
                startLabel={unlocked ? `Bắt đầu (${pending})` : 'Cần bản Pro'}
                canStart={unlocked && pending > 0 && !!outputDir && !noFormat}
                onStart={startRun}
                onPause={runner.pause}
                onResume={runner.resume}
                onStop={runner.stop}
              />
            </div>
          </div>
          <div className="queue-list">
            {items.map((it) => (
              <div className={`qrow ${it.status}`} key={it.id}>
                <div className="qmain">
                  <div className="qtitle" title={it.input}>
                    🎧 {it.name}
                  </div>
                  <div className="muted small">
                    {it.status === 'running' &&
                      `Đang chuyển… ${it.percent > 0 ? it.percent + '%' : ''}${
                        it.language ? ' · ' + it.language : ''
                      }`}
                    {it.status === 'done' && (
                      <>
                        Xong · {it.outputs.length} tệp
                        {it.speakers > 0 ? ` · ${it.speakers} người nói` : ''}{' '}
                        {it.outputs.map((o) => (
                          <button
                            key={o}
                            className="link-btn"
                            onClick={() => window.api.showItem(o)}
                            title={o}
                          >
                            {baseName(o)}
                          </button>
                        ))}
                      </>
                    )}
                    {it.status === 'translating' && '✨ Đang dịch phụ đề…'}
                    {it.status === 'queued' && 'Chờ xử lý'}
                    {it.status === 'error' && (
                      <span className="dy-err" title={it.error ?? ''}>
                        Lỗi: {it.error}
                      </span>
                    )}
                  </div>
                  {it.status === 'running' && it.percent > 0 && (
                    <div className="bar" style={{ marginTop: 6 }}>
                      <div className="bar-fill" style={{ width: `${it.percent}%` }} />
                    </div>
                  )}
                </div>
                <div className="qside">
                  <span className={`qbadge ${it.status}`}>
                    {it.status === 'running'
                      ? 'Đang chạy'
                      : it.status === 'done'
                        ? 'Xong'
                        : it.status === 'error'
                          ? 'Lỗi'
                          : 'Chờ'}
                  </span>
                  {it.status !== 'running' && (
                    <button className="ibtn" title="Xóa" onClick={() => removeItem(it.id)}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {items.length === 0 && (
        <p className="hint muted small">
          💡 Chọn file (hoặc bấm <b>Lấy sub</b> ở tab Tải xuống) → chọn định dạng → <b>Bắt đầu</b>.
          Lần đầu mỗi model sẽ tải thêm một lần rồi chạy offline.
        </p>
      )}
      </div>
    </div>
  )
}
