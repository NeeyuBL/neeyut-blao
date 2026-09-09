import type { CSSProperties, JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTabOutputDir } from '../lib/outputDir'
import { usePersistedState } from '../lib/persist'
import { readDichProvider } from '../lib/dichProvider'
import { hasFeature } from '../lib/license'
import RegionBox, { type Region } from './RegionBox'
import GeminiKey from './GeminiKey'
import type { EditorDraft } from './VideoEditor'
import type { OcrEngineStatus, OcrInstallMode, OcrProvider } from '../../../shared/types'

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path

const srcVideo = (path: string): string => {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(path)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `tblao://b64/${b64}`
}

type Step = 'idle' | 'ocr' | 'translate' | 'done' | 'error'

interface Props {
  onOpenEditor?: (draft: EditorDraft) => void
}

export default function ScreenText({ onOpenEditor }: Props): JSX.Element {
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.screen')
  const [video, setVideo] = useState<string | null>(null)
  const [videoH, setVideoH] = useState(0)
  const [videoW, setVideoW] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const [boxW, setBoxW] = useState(0)

  const [language, setLanguage] = usePersistedState('tblao.ocr.dich', 'none')
  const [step, setStep] = useState<Step>('idle')
  const [percent, setPercent] = useState(0)
  const [currentText, setCurrentText] = useState('')
  const [stopping, setStopping] = useState(false)
  const [outputs, setOutputs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const [limitRegion, setLimitRegion] = useState(false)
  const [ocrRegion, setOcrRegion] = useState<Region | undefined>()
  const [formatSrt, setFormatSrt] = usePersistedState('tblao.ocr.fmt.srt', true)
  const [formatTxt, setFormatTxt] = usePersistedState('tblao.ocr.fmt.txt', false)
  const [formatVtt, setFormatVtt] = usePersistedState('tblao.ocr.fmt.vtt', false)
  const [formatJson, setFormatJson] = usePersistedState('tblao.ocr.fmt.json', false)

  const [engineStatus, setEngineStatus] = useState<OcrEngineStatus | null>(null)
  const [provider, setProvider] = useState<OcrProvider | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPercent, setInstallPercent] = useState(0)
  const [installError, setInstallError] = useState<string | null>(null)
  const [showProcessingOptions, setShowProcessingOptions] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const unlocked = hasFeature('ocr')

  const applyEngineStatus = (status: OcrEngineStatus): void => {
    setEngineStatus(status)
    setProvider((current) => {
      if (current && status.providers.some((item) => item.provider === current && item.ready)) return current
      const gpu = status.providers.find((item) => item.provider !== 'cpu' && item.ready)
      if (gpu) return gpu.provider
      const cpu = status.providers.find((item) => item.provider === 'cpu' && item.ready)
      return status.gpuRequired ? null : cpu?.provider ?? null
    })
  }

  const measureStage = (): void => {
    const element = stageRef.current
    if (!element) return
    setBoxW(element.clientWidth)
    setBoxH(element.clientHeight)
  }

  useEffect(() => {
    let cancelled = false
    let off: (() => void) | undefined
    void (async () => {
      try {
        const status = await window.api.ocrEngineStatus()
        if (cancelled) return
        applyEngineStatus(status)
        const needsBootstrap = !status.activeProvider
        if (!status.needsUpdate && !needsBootstrap) return
        setInstalling(true)
        setInstallError(null)
        setInstallPercent(0)
        off = window.api.onOcrInstallProgress(setInstallPercent)
        const result = await window.api.ocrInstallEngine('auto')
        if (cancelled) return
        if (result.ok && result.status) applyEngineStatus(result.status)
        else setInstallError(result.error || 'Chưa thể cài công cụ đọc chữ. Hãy thử lại.')
      } catch {
        if (!cancelled) setInstallError('Chưa thể kiểm tra hoặc cài công cụ đọc chữ. Hãy thử lại.')
      } finally {
        off?.()
        off = undefined
        if (!cancelled) setInstalling(false)
      }
    })()
    return () => {
      cancelled = true
      off?.()
      off = undefined
    }
  }, [])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(measureStage)
    observer.observe(element)
    measureStage()
    return () => observer.disconnect()
  }, [video, videoW, videoH])

  const installEngine = async (mode: OcrInstallMode = 'auto'): Promise<void> => {
    setInstalling(true)
    setInstallError(null)
    setInstallPercent(0)
    const off = window.api.onOcrInstallProgress(setInstallPercent)
    try {
      const result = await window.api.ocrInstallEngine(mode)
      if (result.ok && result.status) {
        applyEngineStatus(result.status)
        if (mode === 'cpu') setProvider('cpu')
      } else {
        setInstallError(result.error || 'Chưa thể cài công cụ đọc chữ. Hãy thử lại.')
        const refreshed = await window.api.ocrEngineStatus(true).catch(() => null)
        if (refreshed) applyEngineStatus(refreshed)
      }
    } catch {
      setInstallError('Chưa thể cài công cụ đọc chữ. Hãy thử lại.')
    } finally {
      off()
      setInstalling(false)
    }
  }

  const chooseVideo = async (): Promise<void> => {
    const files = await window.api.chooseFiles()
    if (!files.length) return
    setVideo(files[0])
    setVideoH(0)
    setVideoW(0)
    setOcrRegion(undefined)
    setStep('idle')
    setOutputs([])
    setError(null)
  }

  const onMetadata = (): void => {
    const element = videoRef.current
    if (!element) return
    setVideoH(element.videoHeight)
    setVideoW(element.videoWidth)
    requestAnimationFrame(measureStage)
    if (!ocrRegion && element.videoWidth > 0 && element.videoHeight > 0) {
      setOcrRegion({
        x0: Math.round(element.videoWidth * 0.15),
        x1: Math.round(element.videoWidth * 0.85),
        y0: Math.round(element.videoHeight * 0.75),
        y1: element.videoHeight
      })
    }
  }

  const runOcr = async (): Promise<void> => {
    if (!video || !outputDir || !provider) return
    const selected = engineStatus?.providers.find((item) => item.provider === provider)
    if (!selected?.ready) {
      setError('Chế độ xử lý đã chọn chưa sẵn sàng. Hãy mở Tùy chọn xử lý và kiểm tra lại.')
      setStep('error')
      return
    }

    const formats: string[] = []
    if (formatSrt) formats.push('.srt')
    if (formatTxt) formats.push('.txt')
    if (formatVtt) formats.push('.vtt')
    if (formatJson) formats.push('.json')
    if (formats.length === 0) {
      setError('Vui lòng chọn ít nhất một định dạng kết quả.')
      setStep('error')
      return
    }
    if (language !== 'none' && !formatSrt) {
      setError('Hãy bật Phụ đề (.srt) để T-blao có thể tạo bản dịch.')
      setStep('error')
      return
    }

    setStep('ocr')
    setPercent(0)
    setError(null)
    setOutputs([])
    setCurrentText('')
    setStopping(false)

    const x0 = limitRegion && ocrRegion ? ocrRegion.x0 : -1
    const x1 = limitRegion && ocrRegion ? ocrRegion.x1 : -1
    const y0 = limitRegion && ocrRegion ? ocrRegion.y0 : -1
    const y1 = limitRegion && ocrRegion ? ocrRegion.y1 : -1
    const off = window.api.onOcrProgress((progress) => {
      if (progress.percent >= 0) setPercent(progress.percent)
      if (progress.text) setCurrentText(progress.text)
    })
    const result = await window.api.ocrVideo(video, outputDir, y0, y1, x0, x1, formats, provider)
    off()
    setStopping(false)

    if (!result.ok) {
      if (result.error === 'Đã huỷ.') {
        setStep('idle')
        setCurrentText('')
        return
      }
      setError(result.error || 'Đọc chữ thất bại.')
      setStep('error')
      return
    }

    const resultFiles = result.outputs || (result.output ? [result.output] : [])
    if (language !== 'none' && result.output) {
      setStep('translate')
      const translated = result.output.replace(/\.srt$/i, `.${language}.srt`)
      const translation = await window.api.translateSrt(
        result.output,
        translated,
        language,
        readDichProvider()
      )
      if (translation.ok) resultFiles.unshift(translated)
      else setError(`Dịch: ${translation.error}`)
    }
    setOutputs(resultFiles)
    setStep('done')
  }

  const stopOcr = async (): Promise<void> => {
    setStopping(true)
    await window.api.ocrCancel()
  }

  const openEditor = (): void => {
    if (!video || !onOpenEditor) return
    const srt = outputs.find((path) => path.toLowerCase().endsWith('.srt'))
    onOpenEditor({
      requestId: crypto.randomUUID(),
      video,
      srt,
      outputDir: outputDir || undefined,
      source: 'ocr'
    })
  }

  if (!unlocked) return <div className="card muted">Tính năng đang khoá.</div>

  const selectedProviderStatus = engineStatus?.providers.find((item) => item.provider === provider)
  const gpuReady = engineStatus?.providers.find((item) => item.provider !== 'cpu' && item.ready)
  const cpuReady = engineStatus?.providers.find((item) => item.provider === 'cpu' && item.ready)
  const needsProviderSetup = engineStatus !== null && (!provider || !selectedProviderStatus?.ready)
  const usingStableFallback = provider === 'cpu' && engineStatus?.recommendedProvider !== 'cpu' && !gpuReady

  if (engineStatus === null || installing || needsProviderSetup) {
    const updating = Boolean(engineStatus?.has)
    const checkingEngine = engineStatus === null && !installError && !installing
    return (
      <div className="dy-setup">
        <div className="card dy-install-card">
          <div className="dy-install-title">
            {checkingEngine
              ? 'Đang chuẩn bị nhận diện'
              : installing
                ? updating
                  ? 'Đang cập nhật công cụ nhận diện'
                  : 'Đang cài công cụ nhận diện'
                : 'Chưa thể chuẩn bị công cụ đọc chữ'}
          </div>
          <p className="muted">
            {checkingEngine
              ? 'T-blao đang chọn cách xử lý phù hợp nhất với máy của bạn.'
              : installing
                ? 'T-blao đang chuẩn bị công cụ nhận diện phù hợp với máy của bạn.'
                : 'Bạn có thể thử cài lại hoặc chọn chế độ CPU để tiếp tục khi công cụ đã sẵn sàng.'}
          </p>
          {checkingEngine ? (
            <div className="spinner ocr-provider-spinner" />
          ) : installing ? (
            <>
              <div className="bar"><div className="bar-fill" style={{ width: `${installPercent}%` }} /></div>
              <div className="muted small">Đang tải và kiểm tra thành phần cần thiết… {installPercent}%</div>
            </>
          ) : (
            <div className="ocr-provider-setup-actions">
              <button className="btn primary" onClick={() => void installEngine('auto')}>
                Thử cài lại
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (cpuReady) setProvider('cpu')
                  else void installEngine('cpu')
                }}
              >
                Tiếp tục bằng CPU
              </button>
            </div>
          )}
          {engineStatus && !gpuReady && (
            <div className="muted small ocr-provider-explain">
              Nếu tăng tốc chưa sẵn sàng, T-blao sẽ tự dùng chế độ CPU ổn định. Chế độ này có thể xử lý chậm hơn.
            </div>
          )}
          {installError && (
            <div className="dy-err small">
              {installError}
            </div>
          )}
        </div>
      </div>
    )
  }

  const running = step === 'ocr' || step === 'translate'

  return (
    <div className="lam-viec screen-reader-workspace">
      <div className="cot-cauhinh">
        <div className="cot-tieude">Cấu hình nhận diện</div>

        <div className="card options-card">
          <button className="btn primary" onClick={chooseVideo} disabled={running}>Chọn video</button>
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
                  const path = await window.api.chooseFolder()
                  if (path) setOutputDir(path)
                }}
              >
                Chọn thư mục
              </button>
            </div>
          </label>
        </div>

        <div className={`card ocr-provider-card ${provider === 'cpu' ? 'cpu' : 'gpu'}`}>
          <div className="ocr-provider-card-head">
            <span className="ocr-provider-state-icon" aria-hidden="true">
              {provider === 'cpu' ? '●' : '⚡'}
            </span>
            <div>
              <div className="ocr-provider-title-row">
                <strong>{provider === 'cpu' ? 'Chế độ tiêu chuẩn' : 'Tăng tốc đang bật'}</strong>
                <span>{provider === 'cpu' ? 'CPU' : 'Nhanh hơn'}</span>
              </div>
              <small>
                {usingStableFallback
                  ? 'Tăng tốc chưa sẵn sàng, T-blao đang dùng chế độ ổn định.'
                  : provider === 'cpu'
                  ? 'T-blao đang xử lý bằng bộ xử lý chính của máy.'
                  : 'T-blao đang dùng card đồ họa để nhận diện chữ nhanh hơn.'}
              </small>
            </div>
          </div>
          <button
            className="ocr-provider-options-toggle"
            type="button"
            aria-expanded={showProcessingOptions}
            onClick={() => setShowProcessingOptions((value) => !value)}
          >
            <span>Tùy chọn xử lý</span>
            <span aria-hidden="true">{showProcessingOptions ? '−' : '+'}</span>
          </button>
          {showProcessingOptions && (
            <div className="ocr-provider-options-panel">
              <div className="ocr-provider-options" role="group" aria-label="Chế độ xử lý">
                {gpuReady && (
                  <button
                    className={provider !== 'cpu' ? 'active' : ''}
                    onClick={() => setProvider(gpuReady.provider)}
                    disabled={running}
                  >
                    Card đồ họa <span>Khuyến nghị</span>
                  </button>
                )}
                {cpuReady && (
                  <button
                    className={provider === 'cpu' ? 'active' : ''}
                    onClick={() => setProvider('cpu')}
                    disabled={running}
                  >
                    Bộ xử lý <span>Chậm hơn</span>
                  </button>
                )}
              </div>
              {provider !== 'cpu' && engineStatus?.gpuName && (
                <div className="muted small ocr-provider-device">Thiết bị: {engineStatus.gpuName}</div>
              )}
              {usingStableFallback && (
                <div className="muted small ocr-provider-device">
                  Bạn vẫn có thể đọc chữ bằng CPU và kiểm tra lại khả năng tăng tốc sau.
                </div>
              )}
              <button
                className="ocr-provider-recheck"
                type="button"
                onClick={() => void installEngine('auto')}
                disabled={running || installing}
              >
                Kiểm tra lại khả năng tăng tốc
              </button>
            </div>
          )}
        </div>

        <GeminiKey dich={language} setDich={setLanguage} />

        {video && (
          <div className="card">
            <div className="cot-tieude" style={{ fontSize: 13, marginBottom: 8 }}>
              Đọc chữ trong video
            </div>
            <label className="gk-check">
              <input
                type="checkbox"
                checked={limitRegion}
                onChange={(event) => setLimitRegion(event.target.checked)}
              />
              <span>Chỉ đọc chữ trong vùng đã chọn</span>
            </label>
            {limitRegion && (
              <div className="muted small screen-reader-note">
                Kéo khung màu vàng trên video đến vùng có chữ.
              </div>
            )}

            <div className="screen-output-options">
              <div className="muted small">Kết quả muốn lưu</div>
              <div className="screen-output-grid">
                <label className="gk-check">
                  <input type="checkbox" checked={formatSrt} onChange={(event) => setFormatSrt(event.target.checked)} />
                  <span>Phụ đề (.srt)</span>
                </label>
                <label className="gk-check">
                  <input type="checkbox" checked={formatTxt} onChange={(event) => setFormatTxt(event.target.checked)} />
                  <span>Văn bản (.txt)</span>
                </label>
                <label className="gk-check">
                  <input type="checkbox" checked={formatVtt} onChange={(event) => setFormatVtt(event.target.checked)} />
                  <span>Phụ đề web (.vtt)</span>
                </label>
              </div>
              <details className="tech-details compact">
                <summary>Kết quả dành cho ứng dụng khác</summary>
                <label className="gk-check">
                  <input type="checkbox" checked={formatJson} onChange={(event) => setFormatJson(event.target.checked)} />
                  <span>Dữ liệu chi tiết (.json)</span>
                </label>
              </details>
            </div>

            {!running ? (
              <button className="btn primary screen-reader-run" disabled={!outputDir || !provider} onClick={runOcr}>
                Bắt đầu đọc chữ
              </button>
            ) : step === 'ocr' ? (
              <button className="btn danger screen-reader-run" onClick={stopOcr} disabled={stopping}>
                {stopping ? 'Đang dừng…' : 'Dừng'}
              </button>
            ) : null}

            {running && (
              <>
                <div className="bar screen-reader-progress">
                  <div className="bar-fill" style={{ width: `${step === 'translate' ? 100 : percent}%` }} />
                </div>
                <div className="muted small">
                  {step === 'translate' ? 'Đang dịch phụ đề…' : `Đang đọc… ${percent}%`}
                </div>
                {currentText && <div className="muted small ocr-dong">{currentText}</div>}
              </>
            )}
            {error && <div className="dy-err small">{error}</div>}

            {step === 'done' && (
              <div className="screen-reader-result">
                <div className="screen-reader-result-head">Đã tạo {outputs.length} tệp kết quả</div>
                <div className="screen-reader-files">
                  {outputs.map((path) => (
                    <button key={path} className="link-btn" onClick={() => window.api.showItem(path)}>
                      {baseName(path)}
                    </button>
                  ))}
                </div>
                {onOpenEditor && (
                  <button className="btn editor-handoff" onClick={openEditor}>
                    Mở trong Biên tập video <span>→</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="cot-ketqua cot-video">
        <div className="cot-tieude">Vùng đọc chữ</div>
        {video ? (
          <>
            <div className="muted small">
              {limitRegion
                ? 'Điều chỉnh khung để T-blao chỉ nhận diện phần chữ cần thiết.'
                : 'Bật “Chỉ đọc chữ trong vùng đã chọn” để khoanh vùng nhận diện.'}
            </div>
            <div className="ocr-sanh">
              <div
                ref={stageRef}
                className="ocr-video"
                style={
                  videoW > 0 && videoH > 0
                    ? ({
                        aspectRatio: `${videoW} / ${videoH}`,
                        ['--ocr-ar']: String(videoW / videoH)
                      } as CSSProperties)
                    : undefined
                }
              >
                <video
                  ref={videoRef}
                  src={srcVideo(video)}
                  onLoadedMetadata={onMetadata}
                  onError={() => setError('T-blao không mở được video này. Hãy thử một video MP4 khác.')}
                  controls
                  muted
                />
                {videoH > 0 && (
                  <RegionBox
                    hienOcrBox={limitRegion}
                    ocrRegion={ocrRegion}
                    setOcrRegion={setOcrRegion}
                    videoH={videoH}
                    videoW={videoW}
                    boxH={boxH}
                    boxW={boxW}
                  />
                )}
              </div>
            </div>
            {videoH > 0 && <div className="muted small ocr-toado">Video {videoW}×{videoH}</div>}
          </>
        ) : (
          <button className="ocr-sanh screen-reader-empty" onClick={chooseVideo}>
            <strong>Chọn video để xác định vùng có chữ</strong>
            <span className="muted small">Khung nhận diện sẽ hiển thị trực tiếp trên video.</span>
          </button>
        )}
      </div>
    </div>
  )
}
