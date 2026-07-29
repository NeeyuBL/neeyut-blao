import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Video2xDevice,
  Video2xMode,
  Video2xProcessor,
  Video2xProgress,
  Video2xTaskConfig
} from '../../../shared/types'
import { usePersistedState } from '../lib/persist'

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

function defaultConfig(): Video2xTaskConfig {
  return {
    deviceIndex: 0,
    mode: 'filter',
    processor: 'realesrgan',
    scalingFactor: 2,
    width: null,
    height: null,
    noiseLevel: -1,
    libplaceboShader: 'anime4k-v4-a',
    realesrganModel: 'realesr-animevideov3',
    realcuganModel: 'models-se',
    rifeModel: 'rife-v4.26',
    frameRateMul: 2,
    sceneThresh: 100,
    codec: 'libx264',
    copyAudio: true,
    copySubtitle: true,
    crf: 20,
    encoderPreset: 'medium'
  }
}

function processorLabel(p: Video2xProcessor): string {
  if (p === 'libplacebo') return 'libplacebo'
  if (p === 'realesrgan') return 'Real-ESRGAN'
  if (p === 'realcugan') return 'Real-CUGAN'
  return 'RIFE'
}

function outputName(input: string, cfg: Video2xTaskConfig): string {
  const base = baseName(input).replace(/\.[^.]+$/, '')
  const ext = input.match(/\.[^.]+$/)?.[0] || '.mp4'
  const tag = cfg.processor === 'rife' ? 'rife' : 'upscaled'
  return `${base}-${tag}${ext}`
}

function joinOut(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + name
}

function fmtHms(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

interface EnhanceTask {
  id: string
  input: string
  output: string
  status: TaskStatus
  percent: number
  frame: number
  totalFrames: number
  error?: string
}

const SHADERS = [
  'anime4k-v4-a',
  'anime4k-v4-a+a',
  'anime4k-v4-b',
  'anime4k-v4-b+b',
  'anime4k-v4-c',
  'anime4k-v4-c+a',
  'anime4k-v4.1-gan'
]

const ESRGAN_MODELS = [
  'realesr-animevideov3',
  'realesrgan-plus-anime',
  'realesrgan-plus',
  'realesr-generalv3'
]

const CUGAN_MODELS = ['models-se', 'models-pro', 'models-nose']

const RIFE_MODELS = [
  'rife-v4.26',
  'rife-v4.25',
  'rife-v4.6',
  'rife-v4',
  'rife-anime',
  'rife-HD',
  'rife-UHD'
]

function TaskConfigHelp({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="modal-nen" onClick={onClose}>
      <div className="modal v2x-help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Hướng dẫn chỉnh task</b>
          <button type="button" className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body v2x-help-body">
          <p>
            Cột <b>Chỉnh task</b> là cấu hình dùng chung: mọi video trong hàng đợi chạy theo cùng
            một thiết lập. Thay đổi được tự nhớ cho lần mở app sau.
          </p>
          <h4>Processing</h4>
          <ul>
            <li>
              <b>GPU</b> — chọn card Vulkan (xem danh sách từ Video2X). Sai GPU có thể rất chậm hoặc
              lỗi.
            </li>
            <li>
              <b>Filter (Upscaling)</b> — phóng to / làm nét:
              <ul>
                <li>
                  <b>Real-ESRGAN</b> — chất lượng cao, phù hợp anime / video nói chung (khuyến nghị
                  bắt đầu).
                </li>
                <li>
                  <b>Real-CUGAN</b> — mạnh với anime, có chỉnh noise.
                </li>
                <li>
                  <b>libplacebo</b> — Anime4K (shader), nhanh hơn, ít “AI” hơn.
                </li>
              </ul>
            </li>
            <li>
              <b>Scaling ×</b> hoặc <b>Width × Height</b> — chọn một trong hai (không dùng cùng lúc).
            </li>
            <li>
              <b>Frame Interpolation (RIFE)</b> — tăng FPS (×2…), không phóng to. Đổi model / ngưỡng
              scene nếu video cắt cảnh nhiều.
            </li>
          </ul>
          <h4>Encoder</h4>
          <ul>
            <li>
              <b>Codec</b> — <code>libx264</code> ổn định; <code>h264_nvenc</code> /
              <code>hevc_nvenc</code> nếu có NVIDIA.
            </li>
            <li>
              <b>CRF</b> — số thấp = đẹp hơn, file lớn hơn (thường 18–23).
            </li>
            <li>
              <b>Preset</b> — <code>medium</code> cân bằng; <code>slow</code> đẹp hơn nhưng lâu hơn.
            </li>
            <li>Giữ bật Copy audio / subtitle trừ khi muốn encode lại luồng đó.</li>
          </ul>
          <h4>Cách dùng nhanh</h4>
          <ol>
            <li>Chọn Processing + Encoder trước.</li>
            <li>Bấm 「Thêm」 chọn nhiều video.</li>
            <li>Hàng đợi chạy lần lượt theo cấu hình hiện tại.</li>
            <li>Pause = hết job hiện tại rồi dừng; Abort = dừng ngay.</li>
          </ol>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskConfigPanel({
  config,
  devices,
  onChange
}: {
  config: Video2xTaskConfig
  devices: Video2xDevice[]
  onChange: (c: Video2xTaskConfig) => void
}): JSX.Element {
  const [tab, setTab] = useState<'processing' | 'encoder'>('processing')
  const [showHelp, setShowHelp] = useState(false)

  const patch = (partial: Partial<Video2xTaskConfig>): void => {
    onChange({ ...config, ...partial })
  }

  const setMode = (mode: Video2xMode): void => {
    onChange({
      ...config,
      mode,
      processor: mode === 'interpolate' ? 'rife' : config.processor === 'rife' ? 'realesrgan' : config.processor
    })
  }

  const setProcessor = (processor: Video2xProcessor): void => {
    onChange({
      ...config,
      processor,
      mode: processor === 'rife' ? 'interpolate' : 'filter'
    })
  }

  return (
    <aside className="v2x-cfg card">
      <div className="v2x-cfg-head">
        <div className="v2x-cfg-title">
          <b>Chỉnh task</b>
          <span className="muted small">Áp dụng cho cả hàng đợi · tự nhớ</span>
        </div>
        <button
          type="button"
          className="btn ghost v2x-help-btn"
          title="Hướng dẫn sử dụng chỉnh task"
          onClick={() => setShowHelp(true)}
        >
          ?
        </button>
      </div>
      {showHelp && <TaskConfigHelp onClose={() => setShowHelp(false)} />}
      <div className="v2x-edit-tabs">
        <button
          type="button"
          className={tab === 'processing' ? 'active' : ''}
          onClick={() => setTab('processing')}
        >
          Processing
        </button>
        <button
          type="button"
          className={tab === 'encoder' ? 'active' : ''}
          onClick={() => setTab('encoder')}
        >
          Encoder
        </button>
      </div>
      <div className="v2x-cfg-body">
        {tab === 'processing' ? (
          <div className="v2x-form">
            <label className="field">
              <span className="muted small">1. Vulkan device (GPU)</span>
              <select
                value={config.deviceIndex}
                onChange={(e) => patch({ deviceIndex: Number(e.target.value) })}
              >
                {(devices.length ? devices : [{ index: 0, name: 'GPU 0 (mặc định)' }]).map(
                  (dev) => (
                    <option key={dev.index} value={dev.index}>
                      {dev.index}. {dev.name}
                    </option>
                  )
                )}
              </select>
            </label>
            <label className="field">
              <span className="muted small">2. Processing mode</span>
              <select
                value={config.mode}
                onChange={(e) => setMode(e.target.value as Video2xMode)}
              >
                <option value="filter">Filter (Upscaling)</option>
                <option value="interpolate">Frame Interpolation</option>
              </select>
            </label>
            <label className="field">
              <span className="muted small">3. Filter / Processor</span>
              <select
                value={config.processor}
                onChange={(e) => setProcessor(e.target.value as Video2xProcessor)}
              >
                {config.mode === 'interpolate' ? (
                  <option value="rife">RIFE</option>
                ) : (
                  <>
                    <option value="libplacebo">libplacebo</option>
                    <option value="realesrgan">Real-ESRGAN</option>
                    <option value="realcugan">Real-CUGAN</option>
                  </>
                )}
              </select>
            </label>

            {config.processor !== 'rife' && (
              <>
                <label className="field">
                  <span className="muted small">Scaling factor (×)</span>
                  <select
                    value={config.scalingFactor ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '') patch({ scalingFactor: null })
                      else patch({ scalingFactor: Number(v), width: null, height: null })
                    }}
                  >
                    <option value="">Dùng Width × Height</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </label>
                <div className="v2x-row2">
                  <label className="field">
                    <span className="muted small">Output width</span>
                    <input
                      type="number"
                      min={1}
                      value={config.width ?? ''}
                      disabled={config.scalingFactor != null}
                      onChange={(e) =>
                        patch({
                          width: e.target.value ? Number(e.target.value) : null,
                          scalingFactor: null
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="muted small">Output height</span>
                    <input
                      type="number"
                      min={1}
                      value={config.height ?? ''}
                      disabled={config.scalingFactor != null}
                      onChange={(e) =>
                        patch({
                          height: e.target.value ? Number(e.target.value) : null,
                          scalingFactor: null
                        })
                      }
                    />
                  </label>
                </div>
              </>
            )}

            {config.processor === 'libplacebo' && (
              <label className="field">
                <span className="muted small">GLSL shader (Anime4K)</span>
                <select
                  value={config.libplaceboShader}
                  onChange={(e) => patch({ libplaceboShader: e.target.value })}
                >
                  {SHADERS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {config.processor === 'realesrgan' && (
              <label className="field">
                <span className="muted small">Real-ESRGAN model</span>
                <select
                  value={config.realesrganModel}
                  onChange={(e) => patch({ realesrganModel: e.target.value })}
                >
                  {ESRGAN_MODELS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {config.processor === 'realcugan' && (
              <>
                <label className="field">
                  <span className="muted small">Real-CUGAN model</span>
                  <select
                    value={config.realcuganModel}
                    onChange={(e) => patch({ realcuganModel: e.target.value })}
                  >
                    {CUGAN_MODELS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="muted small">Noise level (-1 = tắt)</span>
                  <input
                    type="number"
                    min={-1}
                    max={3}
                    value={config.noiseLevel}
                    onChange={(e) => patch({ noiseLevel: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
            {config.processor === 'rife' && (
              <>
                <label className="field">
                  <span className="muted small">RIFE model</span>
                  <select
                    value={config.rifeModel}
                    onChange={(e) => patch({ rifeModel: e.target.value })}
                  >
                    {RIFE_MODELS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="muted small">Frame rate multiplier</span>
                  <input
                    type="number"
                    min={2}
                    max={8}
                    value={config.frameRateMul}
                    onChange={(e) => patch({ frameRateMul: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span className="muted small">Scene detection threshold (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={config.sceneThresh}
                    onChange={(e) => patch({ sceneThresh: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
          </div>
        ) : (
          <div className="v2x-form">
            <label className="field">
              <span className="muted small">Codec</span>
              <select value={config.codec} onChange={(e) => patch({ codec: e.target.value })}>
                <option value="libx264">libx264</option>
                <option value="h264_nvenc">h264_nvenc</option>
                <option value="hevc_nvenc">hevc_nvenc</option>
                <option value="libx265">libx265</option>
              </select>
            </label>
            <label className="gk-check">
              <input
                type="checkbox"
                checked={config.copyAudio}
                onChange={(e) => patch({ copyAudio: e.target.checked })}
              />
              <span>Copy audio streams</span>
            </label>
            <label className="gk-check">
              <input
                type="checkbox"
                checked={config.copySubtitle}
                onChange={(e) => patch({ copySubtitle: e.target.checked })}
              />
              <span>Copy subtitle streams</span>
            </label>
            <label className="field">
              <span className="muted small">CRF</span>
              <input
                type="number"
                min={0}
                max={51}
                value={config.crf ?? ''}
                onChange={(e) =>
                  patch({ crf: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </label>
            <label className="field">
              <span className="muted small">Encoder preset</span>
              <select
                value={config.encoderPreset ?? ''}
                onChange={(e) => patch({ encoderPreset: e.target.value || null })}
              >
                <option value="">(mặc định)</option>
                <option value="ultrafast">ultrafast</option>
                <option value="fast">fast</option>
                <option value="medium">medium</option>
                <option value="slow">slow</option>
                <option value="veryslow">veryslow</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </aside>
  )
}

export default function VideoEnhance({
  outputDir,
  setOutputDir
}: {
  outputDir: string
  setOutputDir: (d: string) => void
}): JSX.Element {
  const [cfg, setCfg] = usePersistedState('tblao.v2x.config', defaultConfig())
  const [tasks, setTasks] = useState<EnhanceTask[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [devices, setDevices] = useState<Video2xDevice[]>([])
  const [supported, setSupported] = useState(true)
  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPct, setInstallPct] = useState(0)
  const [installErr, setInstallErr] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [live, setLive] = useState<Video2xProgress | null>(null)
  const [activePath, setActivePath] = useState('')
  const queueLock = useRef(false)
  const pausedRef = useRef(false)
  const tasksRef = useRef(tasks)
  const cfgRef = useRef(cfg)
  const outputDirRef = useRef(outputDir)
  tasksRef.current = tasks
  pausedRef.current = paused
  cfgRef.current = cfg
  outputDirRef.current = outputDir

  const updateCfg = useCallback(
    (next: Video2xTaskConfig): void => {
      setCfg(next)
      const dir = outputDirRef.current
      if (!dir) return
      setTasks((prev) =>
        prev.map((t) =>
          t.status === 'queued' || t.status === 'cancelled' || t.status === 'error'
            ? { ...t, output: joinOut(dir, outputName(t.input, next)) }
            : t
        )
      )
    },
    [setCfg]
  )

  const refreshEngine = useCallback(async (): Promise<void> => {
    const s = await window.api.video2xEngineStatus()
    setSupported(s.supported)
    setHasEngine(s.has)
    if (s.supported && s.has) {
      const list = await window.api.video2xListDevices()
      setDevices(list)
    }
    if (s.supported && s.has && s.needsUpdate) {
      setInstalling(true)
      setInstallErr(null)
      setInstallPct(0)
      const off = window.api.onVideo2xInstallProgress(setInstallPct)
      const res = await window.api.video2xInstallEngine()
      off()
      setInstalling(false)
      if (res.ok) {
        setHasEngine(true)
        setDevices(await window.api.video2xListDevices())
      } else setInstallErr(res.error ?? 'Cập nhật thất bại.')
    }
  }, [])

  useEffect(() => {
    void refreshEngine()
  }, [refreshEngine])

  const install = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallPct(0)
    const off = window.api.onVideo2xInstallProgress(setInstallPct)
    const res = await window.api.video2xInstallEngine()
    off()
    setInstalling(false)
    if (res.ok) {
      setHasEngine(true)
      setDevices(await window.api.video2xListDevices())
    } else setInstallErr(res.error ?? 'Cài đặt thất bại.')
  }

  const addTasks = async (): Promise<void> => {
    const paths = await window.api.chooseFiles()
    if (!paths?.length) return
    if (!outputDir) {
      const d = await window.api.chooseFolder()
      if (!d) return
      setOutputDir(d)
    }
    const dir = outputDir || (await window.api.chooseFolder())
    if (!dir) return
    if (!outputDir) setOutputDir(dir)
    const current = cfgRef.current
    setTasks((prev) => [
      ...prev,
      ...paths.map((input: string) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input,
        output: joinOut(dir, outputName(input, current)),
        status: 'queued' as const,
        percent: 0,
        frame: 0,
        totalFrames: 0
      }))
    ])
  }

  const removeSelected = (): void => {
    if (!selectedId) return
    setTasks((prev) => prev.filter((t) => t.id !== selectedId || t.status === 'running'))
    setSelectedId(null)
  }

  const clearAll = (): void => {
    setTasks((prev) => prev.filter((t) => t.status === 'running'))
    setSelectedId(null)
  }

  const processQueue = useCallback(async (): Promise<void> => {
    if (queueLock.current) return
    queueLock.current = true
    setRunning(true)
    try {
      for (;;) {
        if (pausedRef.current) break
        const next = tasksRef.current.find((t) => t.status === 'queued')
        if (!next) break

        const jobCfg = { ...cfgRef.current }
        const dir = outputDirRef.current
        const out = dir ? joinOut(dir, outputName(next.input, jobCfg)) : next.output

        setActivePath(next.input)
        setTasks((prev) =>
          prev.map((t) =>
            t.id === next.id ? { ...t, status: 'running', percent: 0, output: out } : t
          )
        )
        const off = window.api.onVideo2xProgress((p) => {
          setLive(p)
          setTasks((prev) =>
            prev.map((t) =>
              t.id === next.id
                ? {
                    ...t,
                    percent: p.percent,
                    frame: p.frame,
                    totalFrames: p.totalFrames
                  }
                : t
            )
          )
        })
        const res = await window.api.video2xStart({
          input: next.input,
          output: out,
          config: jobCfg
        })
        off()
        setTasks((prev) =>
          prev.map((t) =>
            t.id === next.id
              ? {
                  ...t,
                  status: res.ok ? 'done' : res.error === 'Đã huỷ.' ? 'cancelled' : 'error',
                  percent: res.ok ? 100 : t.percent,
                  error: res.ok ? undefined : res.error
                }
              : t
          )
        )
        if (!res.ok && res.error === 'Đã huỷ.') break
      }
    } finally {
      queueLock.current = false
      setRunning(false)
      setActivePath('')
      setLive(null)
    }
  }, [])

  useEffect(() => {
    if (!paused && hasEngine && tasks.some((t) => t.status === 'queued') && !queueLock.current) {
      void processQueue()
    }
  }, [tasks, paused, hasEngine, processQueue])

  const abort = async (): Promise<void> => {
    setPaused(true)
    await window.api.video2xCancel()
  }

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const totalCount = tasks.length
  const runningTask = tasks.find((t) => t.status === 'running')

  return (
    <div className="v2x-page">
      {!supported && (
        <div className="qwarn">
          Video2X chưa hỗ trợ macOS (không có bản native / Vulkan). Tab này chỉ dùng trên Windows.
        </div>
      )}

      {supported && hasEngine === false && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cot-tieude">Cần cài công cụ Video2X</div>
          <p className="muted small">
            Tải engine từ máy chủ (hoặc copy binary vào thư mục công cụ). Cần GPU hỗ trợ Vulkan.
          </p>
          <button className="btn primary" disabled={installing} onClick={() => void install()}>
            {installing ? `Đang tải… ${installPct}%` : 'Tải Video2X'}
          </button>
          {installErr && <div className="qwarn" style={{ marginTop: 8 }}>{installErr}</div>}
        </div>
      )}

      {installing && hasEngine !== false && (
        <div className="muted small" style={{ marginBottom: 8 }}>
          Đang cập nhật Video2X… {installPct}%
        </div>
      )}

      <div className="v2x-toolbar">
        <button className="btn" onClick={() => void addTasks()} title="Thêm task" disabled={!supported}>
          ＋ Thêm
        </button>
        <button className="btn" onClick={removeSelected} disabled={!selectedId} title="Xóa chọn">
          － Xóa
        </button>
        <button className="btn" onClick={clearAll} title="Xóa hết (trừ đang chạy)">
          🗑 Xóa hết
        </button>
        <div className="v2x-toolbar-spacer" />
        <button
          className="btn"
          onClick={async () => {
            const d = await window.api.chooseFolder()
            if (d) setOutputDir(d)
          }}
        >
          Thư mục xuất
        </button>
        {outputDir && <span className="muted small v2x-outdir">{outputDir}</span>}
      </div>

      <div className="v2x-main">
        <div className="v2x-queue">
          <div className="v2x-table-wrap card">
            <table className="v2x-table">
              <thead>
                <tr>
                  <th>File name</th>
                  <th>Processor</th>
                  <th>Progress</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted small" style={{ textAlign: 'center', padding: 24 }}>
                      Chưa có task — bấm 「Thêm」 để chọn video.
                    </td>
                  </tr>
                )}
                {tasks.map((t) => (
                  <tr
                    key={t.id}
                    className={selectedId === t.id ? 'selected' : ''}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <td title={t.input}>{baseName(t.input)}</td>
                    <td>{processorLabel(cfg.processor)}</td>
                    <td>
                      <div className="v2x-prog">
                        <div
                          className={`v2x-prog-bar ${t.status === 'done' ? 'done' : ''} ${t.status === 'error' ? 'err' : ''}`}
                          style={{ width: `${Math.min(100, Math.max(0, t.percent))}%` }}
                        />
                        <span className="v2x-prog-txt">
                          {t.status === 'error'
                            ? t.error || 'Lỗi'
                            : t.status === 'cancelled'
                              ? 'Đã huỷ'
                              : t.totalFrames > 0
                                ? `${t.frame}/${t.totalFrames} (${t.percent.toFixed(1)}%)`
                                : t.status === 'done'
                                  ? '100%'
                                  : t.status === 'running'
                                    ? `${t.percent.toFixed(1)}%`
                                    : 'Chờ'}
                        </span>
                      </div>
                    </td>
                    <td className="v2x-actions">
                      <button
                        className="btn ghost"
                        disabled={t.status === 'running'}
                        onClick={(e) => {
                          e.stopPropagation()
                          setTasks((prev) => prev.filter((x) => x.id !== t.id))
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="v2x-controls">
            <button className="btn" onClick={() => setShowStats(true)}>
              Stats
            </button>
            <button
              className="btn"
              disabled={!running && !paused}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn danger" disabled={!running} onClick={() => void abort()}>
              Abort
            </button>
            <button className="btn" onClick={() => void window.api.openLogFile()}>
              Logs
            </button>
          </div>
        </div>

        <TaskConfigPanel config={cfg} devices={devices} onChange={updateCfg} />
      </div>

      <div className="v2x-footer">
        <span>Frames/s: {live?.fps?.toFixed(2) ?? '—'}</span>
        <span>Elapsed: {live ? fmtHms(live.elapsedSec) : '—'}</span>
        <span>Remaining: {live ? fmtHms(live.remainingSec) : '—'}</span>
        <div className="v2x-footer-prog">
          <div
            className="v2x-footer-bar"
            style={{
              width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%`
            }}
          />
          <span>
            {runningTask
              ? `Đang xử lý: ${doneCount + 1}/${totalCount}`
              : totalCount
                ? `Hàng đợi: ${doneCount}/${totalCount}`
                : 'Sẵn sàng'}
            {paused ? ' · Tạm dừng' : ''}
          </span>
        </div>
        <div className="muted small v2x-active-path" title={activePath}>
          {activePath || '—'}
        </div>
      </div>

      {showStats && (
        <div className="modal-nen" onClick={() => setShowStats(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <b>Stats</b>
              <button className="btn ghost" onClick={() => setShowStats(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body muted small" style={{ lineHeight: 1.8 }}>
              <div>FPS: {live?.fps?.toFixed(2) ?? '—'}</div>
              <div>
                Frame: {live ? `${live.frame}/${live.totalFrames}` : '—'} (
                {live?.percent?.toFixed(2) ?? '—'}%)
              </div>
              <div>Elapsed: {live ? fmtHms(live.elapsedSec) : '—'}</div>
              <div>Remaining: {live ? fmtHms(live.remainingSec) : '—'}</div>
              <div>File: {activePath ? baseName(activePath) : '—'}</div>
              <div>
                Queue: {doneCount}/{totalCount}
                {paused ? ' (paused)' : ''}
              </div>
              <div>Processor: {processorLabel(cfg.processor)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
