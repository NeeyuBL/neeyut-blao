import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Video2xDevice,
  Video2xMode,
  Video2xProcessor,
  Video2xProgress,
  Video2xTaskConfig
} from '../../../shared/types'
import { useTabOutputDir } from '../lib/outputDir'
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
  return p === 'rife' ? 'Làm mượt' : 'Làm rõ'
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
          <b>Hướng dẫn nâng cấp video</b>
          <button type="button" className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body v2x-help-body">
          <p>
            Chọn mục tiêu và mức xử lý phù hợp. Thiết lập được áp dụng cho toàn bộ video trong hàng
            đợi và được ghi nhớ cho lần mở sau.
          </p>
          <h4>Chế độ chuyên gia: xử lý hình ảnh</h4>
          <ul>
            <li>
              <b>Thiết bị xử lý</b> — chỉ đổi khi máy có nhiều card đồ họa.
            </li>
            <li>
              <b>Làm nét</b> — chọn công nghệ phù hợp với loại video:
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
              <b>Mức phóng</b> hoặc <b>kích thước đầu ra</b> — chỉ dùng một trong hai cách.
            </li>
            <li>
              <b>Làm mượt chuyển động</b> — tạo thêm khung hình, không làm tăng độ phân giải.
            </li>
          </ul>
          <h4>Chế độ chuyên gia: mã hóa đầu ra</h4>
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
            <li>Giữ bật âm thanh và phụ đề trừ khi bạn có nhu cầu xử lý riêng.</li>
          </ul>
          <h4>Cách dùng nhanh</h4>
          <ol>
            <li>Chọn kết quả mong muốn và mức xử lý.</li>
            <li>Bấm “Thêm video” để chọn một hoặc nhiều video.</li>
            <li>Hàng đợi chạy lần lượt theo cấu hình hiện tại.</li>
            <li>“Tạm dừng” sẽ hoàn tất video hiện tại; “Dừng ngay” sẽ dừng tác vụ đang chạy.</li>
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
  const [expert, setExpert] = usePersistedState('tblao.v2x.expert', false)

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

  const setGoal = (goal: 'clarity' | 'motion'): void => {
    if (goal === 'motion') {
      onChange({ ...config, mode: 'interpolate', processor: 'rife', frameRateMul: 2 })
      return
    }
    onChange({
      ...config,
      mode: 'filter',
      processor: config.processor === 'rife' ? 'realesrgan' : config.processor,
      scalingFactor: config.scalingFactor ?? 2,
      width: null,
      height: null
    })
  }

  const profile =
    config.encoderPreset === 'slow' && (config.crf ?? 20) <= 18
      ? 'quality'
      : config.encoderPreset === 'fast' && (config.crf ?? 20) >= 23
        ? 'speed'
        : 'balanced'

  const setProfile = (value: string): void => {
    if (value === 'speed') patch({ encoderPreset: 'fast', crf: 23 })
    else if (value === 'quality') patch({ encoderPreset: 'slow', crf: 18 })
    else patch({ encoderPreset: 'medium', crf: 20 })
  }

  return (
    <aside className="v2x-cfg card">
      <div className="v2x-cfg-head">
        <div className="v2x-cfg-title">
          <b>Kết quả mong muốn</b>
          <span className="muted small">Áp dụng cho cả hàng đợi · T-blao tự nhớ</span>
        </div>
        <button
          type="button"
          className="btn ghost v2x-help-btn"
          title="Hướng dẫn nâng cấp video"
          onClick={() => setShowHelp(true)}
        >
          ?
        </button>
      </div>
      {showHelp && <TaskConfigHelp onClose={() => setShowHelp(false)} />}
      <div className="v2x-goal-grid" role="radiogroup" aria-label="Kết quả nâng cấp video">
        <button
          type="button"
          className={`v2x-goal ${config.mode === 'filter' ? 'active' : ''}`}
          onClick={() => setGoal('clarity')}
        >
          <span className="v2x-goal-icon">◇</span>
          <span>
            <b>Làm video rõ hơn</b>
            <small>Tăng kích thước và làm nét hình ảnh</small>
          </span>
        </button>
        <button
          type="button"
          className={`v2x-goal ${config.mode === 'interpolate' ? 'active' : ''}`}
          onClick={() => setGoal('motion')}
        >
          <span className="v2x-goal-icon">≫</span>
          <span>
            <b>Làm chuyển động mượt hơn</b>
            <small>Tạo thêm khung hình giữa các chuyển động</small>
          </span>
        </button>
      </div>

      <div className="v2x-basic-form">
        <label className="field">
          <span className="muted small">
            {config.mode === 'filter' ? 'Mức tăng độ nét' : 'Mức tăng độ mượt'}
          </span>
          <select
            value={config.mode === 'filter' ? config.scalingFactor ?? 2 : config.frameRateMul}
            onChange={(e) =>
              config.mode === 'filter'
                ? patch({ scalingFactor: Number(e.target.value), width: null, height: null })
                : patch({ frameRateMul: Number(e.target.value) })
            }
          >
            <option value={2}>Gấp 2 — khuyên dùng</option>
            <option value={3}>Gấp 3</option>
            <option value={4}>Gấp 4</option>
          </select>
        </label>
        <label className="field">
          <span className="muted small">Ưu tiên xử lý</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="speed">Nhanh</option>
            <option value="balanced">Cân bằng — khuyên dùng</option>
            <option value="quality">Chất lượng cao</option>
          </select>
        </label>
      </div>

      <label className="gk-check v2x-expert-toggle">
        <input type="checkbox" checked={expert} onChange={(e) => setExpert(e.target.checked)} />
        <span>Chế độ chuyên gia</span>
      </label>

      {expert && (
        <div className="v2x-expert">
      <div className="v2x-edit-tabs">
        <button
          type="button"
          className={tab === 'processing' ? 'active' : ''}
          onClick={() => setTab('processing')}
        >
          Xử lý hình ảnh
        </button>
        <button
          type="button"
          className={tab === 'encoder' ? 'active' : ''}
          onClick={() => setTab('encoder')}
        >
          Mã hóa đầu ra
        </button>
      </div>
      <div className="v2x-cfg-body">
        {tab === 'processing' ? (
          <div className="v2x-form">
            <label className="field">
              <span className="muted small">1. Thiết bị xử lý (Vulkan GPU)</span>
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
              <span className="muted small">2. Kiểu xử lý</span>
              <select
                value={config.mode}
                onChange={(e) => setMode(e.target.value as Video2xMode)}
              >
                <option value="filter">Làm nét hình ảnh</option>
                <option value="interpolate">Làm mượt chuyển động</option>
              </select>
            </label>
            <label className="field">
              <span className="muted small">3. Công nghệ xử lý</span>
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
                  <span className="muted small">Mức phóng (×)</span>
                  <select
                    value={config.scalingFactor ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '') patch({ scalingFactor: null })
                      else patch({ scalingFactor: Number(v), width: null, height: null })
                    }}
                  >
                    <option value="">Tự nhập kích thước</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </label>
                <div className="v2x-row2">
                  <label className="field">
                    <span className="muted small">Chiều rộng đầu ra</span>
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
                    <span className="muted small">Chiều cao đầu ra</span>
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
                  <span className="muted small">Mức khử nhiễu (-1 = tắt)</span>
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
                  <span className="muted small">Mức tăng khung hình</span>
                  <input
                    type="number"
                    min={2}
                    max={8}
                    value={config.frameRateMul}
                    onChange={(e) => patch({ frameRateMul: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span className="muted small">Ngưỡng nhận biết chuyển cảnh (%)</span>
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
              <span>Giữ nguyên âm thanh</span>
            </label>
            <label className="gk-check">
              <input
                type="checkbox"
                checked={config.copySubtitle}
                onChange={(e) => patch({ copySubtitle: e.target.checked })}
              />
              <span>Giữ nguyên phụ đề</span>
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
              <span className="muted small">Mức ưu tiên mã hóa</span>
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
        </div>
      )}
    </aside>
  )
}

export default function VideoEnhance(): JSX.Element {
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.enhance')
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
          Tính năng nâng cấp video hiện chỉ dùng được trên Windows.
        </div>
      )}

      {supported && hasEngine === false && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cot-tieude">Cài tính năng nâng cấp video</div>
          <p className="muted small">
            T-blao cần tải thêm thành phần xử lý để làm nét và tăng độ mượt video.
          </p>
          <button className="btn primary" disabled={installing} onClick={() => void install()}>
            {installing ? `Đang tải… ${installPct}%` : 'Cài tính năng nâng cấp'}
          </button>
          {installErr && <div className="qwarn" style={{ marginTop: 8 }}>{installErr}</div>}
        </div>
      )}

      {installing && hasEngine !== false && (
        <div className="muted small" style={{ marginBottom: 8 }}>
          Đang cập nhật tính năng nâng cấp video… {installPct}%
        </div>
      )}

      <div className="v2x-toolbar">
        <button className="btn primary" onClick={() => void addTasks()} title="Thêm video" disabled={!supported}>
          ＋ Thêm video
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
                  <th>Tên video</th>
                  <th>Cách xử lý</th>
                  <th>Tiến độ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted small" style={{ textAlign: 'center', padding: 24 }}>
                      Chưa có video. Bấm “Thêm video” để bắt đầu.
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
              Chi tiết tiến trình
            </button>
            <button
              className="btn"
              disabled={!running && !paused}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? 'Tiếp tục' : 'Tạm dừng'}
            </button>
            <button className="btn danger" disabled={!running} onClick={() => void abort()}>
              Dừng ngay
            </button>
            <button className="btn" onClick={() => void window.api.openLogFile()}>
              Thông tin hỗ trợ
            </button>
          </div>
        </div>

        <TaskConfigPanel config={cfg} devices={devices} onChange={updateCfg} />
      </div>

      <div className="v2x-footer">
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
      </div>

      {showStats && (
        <div className="modal-nen" onClick={() => setShowStats(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <b>Chi tiết tiến trình</b>
              <button className="btn ghost" onClick={() => setShowStats(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body muted small" style={{ lineHeight: 1.8 }}>
              <div>Tốc độ: {live?.fps?.toFixed(2) ?? '—'} khung hình/giây</div>
              <div>
                Khung hình: {live ? `${live.frame}/${live.totalFrames}` : '—'} (
                {live?.percent?.toFixed(2) ?? '—'}%)
              </div>
              <div>Đã chạy: {live ? fmtHms(live.elapsedSec) : '—'}</div>
              <div>Còn lại: {live ? fmtHms(live.remainingSec) : '—'}</div>
              <div>Video: {activePath ? baseName(activePath) : '—'}</div>
              <div>
                Hàng đợi: {doneCount}/{totalCount}
                {paused ? ' (đang tạm dừng)' : ''}
              </div>
              <div>Công nghệ xử lý: {processorLabel(cfg.processor)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
