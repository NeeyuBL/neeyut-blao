import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { DouyinRequest, DyChannel, DyCookieStatus, DyMode } from '../../../shared/types'
import { useTabOutputDir } from '../lib/outputDir'
import { usePersistedState } from '../lib/persist'
import { useQueueRunner } from '../lib/useQueueRunner'
import LinkInput from './LinkInput'
import RunControls from './RunControls'

type ItemStatus = 'queued' | 'downloading' | 'done' | 'error'

interface DyItem {
  id: string
  url: string
  isChannel: boolean
  mode: DyMode
  status: ItemStatus
  success: number
  lastFile: string | null
  error: string | null
}

const isChannelUrl = (u: string): boolean => /\/user\//i.test(u)

export default function Douyin(): JSX.Element {
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.douyin')
  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPct, setInstallPct] = useState(0)
  const [installErr, setInstallErr] = useState<string | null>(null)

  const [cookie, setCookie] = useState<DyCookieStatus | null>(null)
  const [cookieBusy, setCookieBusy] = useState(false)
  const [cookieMsg, setCookieMsg] = useState<string | null>(null)

  const [music, setMusic] = usePersistedState('tblao.dy.music', true)
  const [cover, setCover] = usePersistedState('tblao.dy.cover', true)
  const [avatar, setAvatar] = usePersistedState('tblao.dy.avatar', false)
  const [metaJson, setMetaJson] = usePersistedState('tblao.dy.metaJson', true)
  const [folderstyle, setFolderstyle] = usePersistedState('tblao.dy.folderstyle', true)
  const [proxy, setProxy] = usePersistedState('tblao.dy.proxy', '')

  const [urlInput, setUrlInput] = useState('')
  const [mode, setMode] = usePersistedState<DyMode>('tblao.dy.mode', 'all')
  const [batchSize, setBatchSize] = usePersistedState('tblao.dy.batchSize', 15)

  const [items, setItems] = useState<DyItem[]>([])
  const runner = useQueueRunner<DyItem>()

  const [channels, setChannels] = useState<DyChannel[]>([])

  const refreshChannels = (): void => {
    void window.api.dyChannels().then(setChannels)
  }

  useEffect(() => {
    let huy = false
    void (async () => {
      const s = await window.api.dyEngineStatus()
      if (huy) return
      setHasEngine(s.has)
      if (!s.needsUpdate) return
      setInstalling(true)
      setInstallErr(null)
      setInstallPct(0)
      const offInst = window.api.onDyInstallProgress(setInstallPct)
      const res = await window.api.dyInstallEngine()
      offInst()
      if (huy) return
      setInstalling(false)
      if (res.ok) setHasEngine(true)
      else setInstallErr(res.error ?? 'Cập nhật công cụ thất bại.')
    })()
    void window.api.dyCookieStatus().then((c) => {
      if (!huy) setCookie(c)
    })
    refreshChannels()
    const off = window.api.onDyProgress((p) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === p.id
            ? {
                ...it,
                success: p.success,
                lastFile: p.lastFile ?? it.lastFile,
                status:
                  p.status === 'finished'
                    ? 'done'
                    : p.status === 'error'
                      ? 'error'
                      : 'downloading',
                error: p.status === 'error' ? p.line : it.error
              }
            : it
        )
      )
    })
    return () => {
      huy = true
      off()
    }
  }, [])

  const installEngine = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallPct(0)
    const off = window.api.onDyInstallProgress(setInstallPct)
    const res = await window.api.dyInstallEngine()
    off()
    setInstalling(false)
    if (res.ok) setHasEngine(true)
    else setInstallErr(res.error ?? 'Tải công cụ Douyin thất bại.')
  }

  const openLogin = async (): Promise<void> => {
    setCookieBusy(true)
    setCookieMsg(null)
    const off = window.api.onDyCookieEvent((e) =>
      setCookieMsg(
        e.phase === 'launching'
          ? 'Đang mở cửa sổ đăng nhập Douyin…'
          : e.phase === 'ready'
            ? 'Hãy đăng nhập Douyin, sau đó đóng cửa sổ để hoàn tất.'
            : e.phase === 'saved'
              ? 'Đã kết nối tài khoản Douyin.'
              : 'Không thể lưu phiên đăng nhập. Hãy thử lại.'
      )
    )
    const res = await window.api.dyCookieCapture()
    off()
    setCookie(await window.api.dyCookieStatus())
    setCookieMsg(res.ok ? 'Đã kết nối tài khoản Douyin.' : 'Không thể đăng nhập: ' + (res.error ?? ''))
    setCookieBusy(false)
  }

  const clearCookie = async (): Promise<void> => {
    await window.api.dyCookieClear()
    setCookie(await window.api.dyCookieStatus())
    setCookieMsg('Đã đăng xuất Douyin.')
  }

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setOutputDir(dir)
  }

  const addUrls = (): void => {
    const urls = urlInput
      .split(/\s+/)
      .map((u) => u.trim())
      .filter((u) => /douyin\.com|iesdouyin\.com/i.test(u))
    if (!urls.length) return
    const newItems: DyItem[] = urls.map((url) => ({
      id: crypto.randomUUID(),
      url,
      isChannel: isChannelUrl(url),
      mode: isChannelUrl(url) ? mode : 'all',
      status: 'queued',
      success: 0,
      lastFile: null,
      error: null
    }))
    setItems((prev) => [...prev, ...newItems])
    setUrlInput('')
  }

  const buildReq = (it: DyItem): DouyinRequest => ({
    url: it.url,
    outputDir,
    isChannel: it.isChannel,
    mode: it.mode,
    batchSize,
    music,
    cover,
    avatar,
    metaJson,
    folderstyle,
    proxy: proxy.trim() || null
  })

  const runItem = async (it: DyItem): Promise<void> => {
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, status: 'downloading', error: null } : x))
    )
    const res = await window.api.dyDownload(it.id, buildReq(it))
    setItems((prev) =>
      prev.map((x) =>
        x.id === it.id
          ? {
              ...x,
              status: res.ok ? 'done' : 'error',
              success: res.success,
              error: res.ok ? null : res.error
            }
          : x
      )
    )
  }

  const startRun = (): void => {
    if (!outputDir) return
    const queue = items.filter((it) => it.status === 'queued' || it.status === 'error')
    void runner.run(queue, runItem).then(refreshChannels)
  }

  const addChannelUpdate = (ch: DyChannel): void => {
    const it: DyItem = {
      id: crypto.randomUUID(),
      url: ch.url,
      isChannel: true,
      mode: 'new',
      status: 'queued',
      success: 0,
      lastFile: null,
      error: null
    }
    setItems((prev) => [...prev, it])
  }

  const removeChannel = async (url: string): Promise<void> => {
    setChannels(await window.api.dyRemoveChannel(url))
  }

  const removeItem = (id: string): void => setItems((prev) => prev.filter((x) => x.id !== id))
  const clearAll = (): void => {
    if (runner.active) return
    setItems([])
  }
  const pending = items.filter((it) => it.status === 'queued' || it.status === 'error').length

  // ----- Man cai / cap nhat engine -----
  if (hasEngine === false || installing) {
    const dangCapNhat = hasEngine === true
    return (
      <div className="dy-setup">
        <div className="card dy-install-card">
          <div className="dy-install-title">
            {dangCapNhat ? '🔄 Đang cập nhật tính năng Douyin' : '🎬 Cài tính năng tải Douyin'}
          </div>
          <p className="muted">
            {dangCapNhat ? (
              <>Đã có bản công cụ mới — đang tải và cài đè bản cũ.</>
            ) : (
              <>
                T-blao cần tải thêm một thành phần nhỏ (~21 MB) để tải video và kênh Douyin.
              </>
            )}
          </p>
          {installing ? (
            <>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${installPct}%` }} />
              </div>
              <div className="muted small">
                {dangCapNhat ? 'Đang cập nhật' : 'Đang tải'} công cụ… {installPct}%
              </div>
            </>
          ) : (
            <button className="btn primary" onClick={installEngine}>
              Cài tính năng Douyin
            </button>
          )}
          {installErr && <div className="dy-err small">{installErr}</div>}
        </div>
      </div>
    )
  }

  const activeIsChannel = isChannelUrl(urlInput)

  return (
    <div className="lam-viec">
      {/* ---------- COT GIUA: cau hinh + dan link ---------- */}
      <div className="cot-cauhinh">
        <div className="cot-tieude">Tùy chọn &amp; liên kết</div>
      {/* Cookie Douyin */}
      <div className="card cookie-card">
        <div className="cookie-head">
          <div>
            <div className="cookie-title">Tài khoản Douyin</div>
            <div className="muted small">
              Hầu hết nội dung cần đăng nhập. T-blao sẽ lưu riêng phiên đăng nhập của Douyin.
            </div>
          </div>
          {cookie?.has ? (
            <span className="cookie-status ok">Đã kết nối</span>
          ) : (
            <span className="cookie-status">Chưa đăng nhập</span>
          )}
        </div>
        <div className="cookie-actions">
          <button className="btn primary" onClick={openLogin} disabled={cookieBusy}>
            {cookieBusy ? 'Đang xử lý…' : 'Đăng nhập Douyin'}
          </button>
          {cookie?.has && (
            <button className="link-btn" onClick={clearCookie} disabled={cookieBusy}>
              Đăng xuất
            </button>
          )}
        </div>
        {cookieMsg && <div className="cookie-msg small">{cookieMsg}</div>}
      </div>

      {/* Tuy chon */}
      <div className="card options-card">
        <div className="options">
          <label className="check">
            <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
            Tải kèm nhạc
          </label>
          <label className="check">
            <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} />
            Tải kèm ảnh bìa
          </label>
          <label className="check">
            <input type="checkbox" checked={avatar} onChange={(e) => setAvatar(e.target.checked)} />
            Tải avatar kênh
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={metaJson}
              onChange={(e) => setMetaJson(e.target.checked)}
            />
            Lưu dữ liệu mô tả
          </label>
          <label className="check" title="Bật: mỗi video một thư mục con. Tắt: dồn tất cả file vào thư mục đã chọn.">
            <input
              type="checkbox"
              checked={folderstyle}
              onChange={(e) => setFolderstyle(e.target.checked)}
            />
            Mỗi video một thư mục riêng
          </label>
        </div>
        <div className="folder-row">
          <input className="folder-input" value={outputDir} readOnly title={outputDir} />
          <button className="btn" onClick={chooseFolder}>
            Chọn thư mục
          </button>
        </div>
        <details className="tech-details">
          <summary>Kết nối qua proxy</summary>
          <label className="field folder-mode-row">
            <span className="muted small">Chỉ dùng khi nội dung bị giới hạn khu vực</span>
            <input
              className="folder-input"
              placeholder="Dán địa chỉ proxy"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              spellCheck={false}
            />
          </label>
        </details>
      </div>

      {/* Kieu tai (chi hien khi link la kenh) */}
      {activeIsChannel && (
        <div className="card dy-mode-card">
          <div className="dy-mode-title">Kiểu tải (link kênh)</div>
          <label className="dy-mode-opt">
            <input
              type="radio"
              checked={mode === 'all'}
              onChange={() => setMode('all')}
            />
            <span>
              <b>Tải tất cả video</b>
              <span className="muted small"> — chạy lại sẽ tải tiếp phần còn thiếu, không trùng</span>
            </span>
          </label>
          <label className="dy-mode-opt">
            <input type="radio" checked={mode === 'batch'} onChange={() => setMode('batch')} />
            <span>
              <b>Tải theo đợt</b>
              <input
                className="mini-input dy-batch"
                type="number"
                min={1}
                max={999}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value) || 15)}
                disabled={mode !== 'batch'}
              />
              <span className="muted small"> video mỗi lần (bấm Tải nhiều lần để lấy dần)</span>
            </span>
          </label>
          <label className="dy-mode-opt">
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
            <span>
              <b>Chỉ video mới kể từ lần trước</b> 🔔
              <span className="muted small"> — theo dõi kênh, chỉ lấy video mới</span>
            </span>
          </label>
        </div>
      )}

      {/* Nhap link */}
      <div className="url-row link-entry-row">
        <LinkInput
          placeholder="Dán link video hoặc kênh Douyin vào đây"
          value={urlInput}
          onChange={setUrlInput}
          onSubmit={addUrls}
        />
        <button className="btn primary link-add-btn" onClick={addUrls} disabled={!urlInput.trim()}>
          + Thêm
        </button>
      </div>
      <p className="hint muted small">
        T-blao tự nhận biết link video hoặc link kênh và hiển thị lựa chọn phù hợp.
      </p>
      </div>

      {/* ---------- COT PHAI: hang doi + thu vien kenh ---------- */}
      <div className="cot-ketqua cot-hangdoi">
        <div className="cot-tieude">Hàng đợi &amp; thư viện</div>

      {/* Hang doi */}
      {items.length > 0 && (
        <>
          <div className="queue-bar">
            <div className="queue-summary muted small">{items.length} mục</div>
            <div className="queue-actions">
              <button className="btn" onClick={clearAll} disabled={runner.active}>
                Xóa hết
              </button>
              <RunControls
                runState={runner.runState}
                startLabel={`Tải tất cả (${pending})`}
                canStart={pending > 0 && !!outputDir}
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
                  <div className="qtitle" title={it.url}>
                    {it.isChannel ? '📺 ' : '🎬 '}
                    {it.lastFile || it.url}
                  </div>
                  <div className="muted small">
                    {it.isChannel && (
                      <>
                        Kiểu:{' '}
                        {it.mode === 'all'
                          ? 'Tất cả'
                          : it.mode === 'batch'
                            ? `Theo đợt ${batchSize}`
                            : 'Chỉ video mới'}{' '}
                        ·{' '}
                      </>
                    )}
                    {it.status === 'downloading' && `Đang tải… đã xong ${it.success}`}
                    {it.status === 'done' && `Xong · ${it.success} video`}
                    {it.status === 'queued' && 'Chờ tải'}
                    {it.status === 'error' && (
                      <span className="dy-err" title={it.error ?? ''}>
                        Lỗi: {it.error}
                      </span>
                    )}
                  </div>
                </div>
                <div className="qside">
                  <span className={`qbadge ${it.status}`}>
                    {it.status === 'downloading'
                      ? 'Đang tải'
                      : it.status === 'done'
                        ? 'Xong'
                        : it.status === 'error'
                          ? 'Lỗi'
                          : 'Chờ'}
                  </span>
                  {it.status !== 'downloading' && (
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

      {/* Thu vien kenh */}
      <div className="card dy-library">
        <div className="dy-lib-head">
          <div className="dy-lib-title">📚 Thư viện kênh Douyin</div>
          <button className="link-btn" onClick={refreshChannels}>
            Làm mới
          </button>
        </div>
        {channels.length === 0 ? (
          <div className="muted small">
            Chưa có kênh nào. Tải 1 link kênh, nó sẽ tự xuất hiện ở đây để lần sau lấy video mới nhanh
            hơn.
          </div>
        ) : (
          <div className="dy-chan-list">
            {channels.map((ch) => (
              <div className="dy-chan" key={ch.url}>
                <div className="dy-chan-info">
                  <div className="dy-chan-name" title={ch.url}>
                    👤 {ch.name}
                  </div>
                  <div className="muted small">
                    {ch.count} video · cập nhật {new Date(ch.lastRun).toLocaleDateString('vi-VN')}
                  </div>
                </div>
                <div className="dy-chan-actions">
                  <button
                    className="btn small-btn"
                    onClick={() => addChannelUpdate(ch)}
                    title="Thêm vào hàng đợi ở chế độ chỉ video mới"
                  >
                    🔔 Lấy video mới
                  </button>
                  <button className="ibtn" title="Bỏ theo dõi" onClick={() => removeChannel(ch.url)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
