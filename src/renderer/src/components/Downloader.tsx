import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type {
  CookieStatus,
  DownloadKind,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  PlaylistEntry,
  VideoFormat,
  VideoInfo
} from '../../../shared/types'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { usePersistedState } from '../lib/persist'
import { useQueueRunner } from '../lib/useQueueRunner'
import LinkInput from './LinkInput'
import RunControls from './RunControls'

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav']
// Do phan giai muc tieu (lay ban tot nhat <= gia tri nay)
const RES_PRESETS: { label: string; value: number | null }[] = [
  { label: 'Tốt nhất', value: null },
  { label: '2160p (4K)', value: 2160 },
  { label: '1440p', value: 1440 },
  { label: '1080p', value: 1080 },
  { label: '720p', value: 720 },
  { label: '480p', value: 480 },
  { label: '360p', value: 360 }
]

// Kieu dat ten file: nhan bang chu de hieu, ben trong la mau ky thuat
const NAME_PRESETS: { label: string; tpl: string; ex: string }[] = [
  { label: 'Tiêu đề video', tpl: '%(title)s.%(ext)s', ex: 'Tên video.mp4' },
  { label: 'Tiêu đề + mã video', tpl: '%(title)s [%(id)s].%(ext)s', ex: 'Tên video [aBc123].mp4' },
  { label: 'Kênh - Tiêu đề', tpl: '%(uploader)s - %(title)s.%(ext)s', ex: 'Tên kênh - Tên video.mp4' },
  { label: 'Ngày đăng - Tiêu đề', tpl: '%(upload_date)s - %(title)s.%(ext)s', ex: '20240115 - Tên video.mp4' },
  {
    label: 'Số thứ tự - Tiêu đề (playlist)',
    tpl: '%(playlist_index)s - %(title)s.%(ext)s',
    ex: '01 - Tên video.mp4'
  }
]

type ItemStatus = 'fetching' | 'ready' | 'downloading' | 'done' | 'error'

// Cach sap xep file vao thu muc
type FolderMode = 'flat' | 'playlist' | 'channel'

interface QueueItem {
  id: string
  url: string
  title: string
  info: VideoInfo | null
  status: ItemStatus
  progress: DownloadProgress | null
  result: DownloadResult | null
  error: string | null
  formatId: string | null
  formatLabel: string | null
  subfolder: string | null // ten thu muc con (vd: ten playlist)
}

// Lam sach ten thu muc: bo ky tu cam tren Windows, gom khoang trang
function cleanFolder(s: string): string {
  const out = s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return out || 'Playlist'
}

type SelEntry = PlaylistEntry & { checked: boolean; playlistTitle: string }

/** Tu 1 VideoFormat, dung chuoi selector + nhan hien thi. */
function buildFormatChoice(f: VideoFormat): { selector: string; label: string } {
  const hasV = !!f.vcodec
  const hasA = !!f.acodec
  let selector = f.format_id
  if (hasV && !hasA) selector = `${f.format_id}+bestaudio/${f.format_id}` // video-only -> ghep audio
  const res = f.height ? `${f.height}p` : hasA && !hasV ? 'Âm thanh' : f.resolution ?? f.format_id
  const parts = [res, f.ext.toUpperCase()]
  if (f.fps) parts.push(`${f.fps}fps`)
  return { selector, label: parts.join(' · ') }
}

export default function Downloader({
  outputDir,
  setOutputDir,
  onGetSub
}: {
  outputDir: string
  setOutputDir: (d: string) => void
  onGetSub: (filePath: string) => void
}): JSX.Element {
  // Tuy chon chung ap dung cho ca hang doi (tu nho qua cac lan mo app)
  const [kind, setKind] = usePersistedState<DownloadKind>('tblao.dl.kind', 'video')
  const [height, setHeight] = usePersistedState<number | null>('tblao.dl.height', 1080)
  const [audioFormat, setAudioFormat] = usePersistedState('tblao.dl.audioFormat', 'mp3')
  const [embedThumbnail, setEmbedThumbnail] = usePersistedState('tblao.dl.embedThumbnail', true)
  const [embedMetadata, setEmbedMetadata] = usePersistedState('tblao.dl.embedMetadata', true)
  const [folderMode, setFolderMode] = usePersistedState<FolderMode>('tblao.dl.folderMode', 'flat')

  // Tuy chon nang cao (tu nho)
  const [showAdvanced, setShowAdvanced] = usePersistedState('tblao.dl.showAdvanced', false)
  const [container, setContainer] = usePersistedState('tblao.dl.container', 'mp4')
  const [outputTemplate, setOutputTemplate] = usePersistedState(
    'tblao.dl.outputTemplate',
    '%(title)s [%(id)s].%(ext)s'
  )
  const [customName, setCustomName] = usePersistedState('tblao.dl.customName', false)
  const [writeSubs, setWriteSubs] = usePersistedState('tblao.dl.writeSubs', false)
  const [autoSubs, setAutoSubs] = usePersistedState('tblao.dl.autoSubs', false)
  const [subLangs, setSubLangs] = usePersistedState('tblao.dl.subLangs', 'vi,en')
  const [embedSubs, setEmbedSubs] = usePersistedState('tblao.dl.embedSubs', true)
  const [useArchive, setUseArchive] = usePersistedState('tblao.dl.useArchive', false)
  const [forceOverwrite, setForceOverwrite] = usePersistedState('tblao.dl.forceOverwrite', false)

  // Proxy (vuot khoa vung) — nho lai chuoi da nhap
  const [proxyVal, setProxyVal] = usePersistedState('tblao.dl.proxy', '')
  const [proxyMsg, setProxyMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [proxyBusy, setProxyBusy] = useState(false)
  const [proxyGuide, setProxyGuide] = useState(false)
  const proxyArg = (): string | null => proxyVal.trim() || null

  // Cong cu tai: phien ban + cap nhat
  const [ytVer, setYtVer] = useState<string | null>(null)
  const [toolUpdating, setToolUpdating] = useState(false)
  const [toolMsg, setToolMsg] = useState<string | null>(null)

  const [urlInput, setUrlInput] = useState('')
  const [items, setItems] = useState<QueueItem[]>([])
  const runner = useQueueRunner<QueueItem>()

  // Playlist
  const [probing, setProbing] = useState(false)
  const [playlistSel, setPlaylistSel] = useState<{ open: boolean; entries: SelEntry[] }>({
    open: false,
    entries: []
  })
  // Khoang chon (tu so x den so y) — huu ich cho kenh/playlist rat nhieu video
  const [plRange, setPlRange] = useState<{ from: number; to: number }>({ from: 1, to: 1 })
  // Bang chon danh sach con (tab kenh: Videos/Shorts, hoac cac playlist)
  const [subChooser, setSubChooser] = useState<{
    open: boolean
    parent: string
    lists: { title: string; url: string; count: number | null }[]
  }>({ open: false, parent: '', lists: [] })

  // Chon dinh dang nang cao (per-item)
  const [formatPick, setFormatPick] = useState<{
    open: boolean
    itemId: string | null
    formats: VideoFormat[]
  }>({ open: false, itemId: null, formats: [] })

  // Dang nhap bang cookie
  const [cookieStat, setCookieStat] = useState<CookieStatus | null>(null)
  const [useCookies, setUseCookies] = usePersistedState('tblao.dl.useCookies', false)
  const [cookieBusy, setCookieBusy] = useState(false)
  const [cookieMsg, setCookieMsg] = useState<string | null>(null)
  const [loginUrl, setLoginUrl] = useState('')

  const cookiesFile = (): string | null =>
    useCookies && cookieStat?.has ? cookieStat.path : null

  const refreshToolVer = (): void => {
    void window.api.ytdlpVersion().then(setYtVer)
  }
  const updateTool = async (): Promise<void> => {
    setToolUpdating(true)
    setToolMsg(null)
    const r = await window.api.ytdlpUpdate()
    setToolMsg(r.message)
    setToolUpdating(false)
    refreshToolVer()
  }

  useEffect(() => {
    refreshToolVer()
    void window.api.cookieStatus().then(setCookieStat)
    const off = window.api.onProgress((p) => {
      setItems((prev) => prev.map((it) => (it.id === p.id ? { ...it, progress: p } : it)))
    })
    return off
  }, [])

  const openLogin = async (): Promise<void> => {
    setCookieBusy(true)
    const offEvent = window.api.onCookieCaptureEvent((e) => setCookieMsg(e.message))
    const res = await window.api.cookieCapture(loginUrl.trim())
    offEvent()

    if (res.ok) {
      const s = await window.api.cookieStatus()
      setCookieStat(s)
      setUseCookies(true)
      setCookieMsg(`Đã lưu ${res.count} cookie. Sẵn sàng tải nội dung cần đăng nhập.`)
    } else {
      setCookieMsg('Lỗi lấy cookie: ' + (res.error ?? ''))
    }
    setCookieBusy(false)
  }

  const clearCookie = async (): Promise<void> => {
    await window.api.cookieClear()
    const s = await window.api.cookieStatus()
    setCookieStat(s)
    setUseCookies(false)
    setCookieMsg('Đã xóa cookie.')
  }

  const testProxyNow = async (): Promise<void> => {
    setProxyBusy(true)
    setProxyMsg(null)
    const res = await window.api.testProxy(proxyVal.trim())
    setProxyMsg({ ok: res.ok, text: res.message })
    setProxyBusy(false)
  }

  const patch = (id: string, upd: Partial<QueueItem>): void => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...upd } : it)))
  }

  // Them cac URL video don, lay thong tin day du (kem thumbnail)
  const addSingles = async (urls: string[], cf: string | null): Promise<void> => {
    const newItems: QueueItem[] = urls.map((url) => ({
      id: crypto.randomUUID(),
      url,
      title: url,
      info: null,
      status: 'fetching',
      progress: null,
      result: null,
      error: null,
      formatId: null,
      formatLabel: null,
      subfolder: null // video le -> nam o thu muc goc
    }))
    setItems((prev) => [...prev, ...newItems])
    await Promise.all(
      newItems.map(async (it) => {
        const res = await window.api.getInfo(it.url, cf, proxyArg())
        if (res.ok && res.info)
          patch(it.id, { info: res.info, title: res.info.title, status: 'ready' })
        else patch(it.id, { status: 'error', error: res.error ?? 'Không lấy được thông tin.' })
      })
    )
  }

  const addUrls = async (): Promise<void> => {
    const urls = urlInput
      .split(/\s+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u))
    if (urls.length === 0) return
    setUrlInput('')
    setProbing(true)
    const cf = cookiesFile()

    const singles: string[] = []
    const collected: SelEntry[] = []
    const sublists: { title: string; url: string; count: number | null }[] = []
    for (const url of urls) {
      try {
        const res = await window.api.getPlaylist(url, cf, proxyArg())
        if (res.ok && res.playlist?.isPlaylist && res.playlist.entries.length > 0) {
          const plTitle = res.playlist.title ?? 'Playlist'
          for (const e of res.playlist.entries) {
            if (e.isPlaylist) {
              sublists.push({ title: e.title, url: e.url, count: e.count ?? null })
            } else {
              collected.push({ ...e, checked: true, playlistTitle: plTitle })
            }
          }
        } else {
          singles.push(url)
        }
      } catch {
        singles.push(url)
      }
    }

    if (singles.length) await addSingles(singles, cf)
    // Uu tien: neu co danh sach con (tab kenh) -> mo bang chon danh sach truoc
    if (sublists.length) {
      setSubChooser({ open: true, parent: urls[0], lists: sublists })
    } else if (collected.length) {
      setPlRange({ from: 1, to: collected.length })
      setPlaylistSel({ open: true, entries: collected })
    }
    setProbing(false)
  }

  // Thao tac tren bang chon playlist
  const toggleEntry = (idx: number): void =>
    setPlaylistSel((s) => ({
      ...s,
      entries: s.entries.map((e, i) => (i === idx ? { ...e, checked: !e.checked } : e))
    }))
  const setAllEntries = (val: boolean): void =>
    setPlaylistSel((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, checked: val })) }))
  // Chi tich chon cac video co so thu tu trong [from, to], bo tich phan con lai
  const applyRange = (from: number, to: number): void =>
    setPlaylistSel((s) => ({
      ...s,
      entries: s.entries.map((e, i) => ({ ...e, checked: i + 1 >= from && i + 1 <= to }))
    }))

  // Dao vao 1 danh sach con: lay video that (hoac hien tiep bang chon neu van long nhau)
  const openSubList = async (url: string): Promise<void> => {
    setSubChooser({ open: false, parent: '', lists: [] })
    setProbing(true)
    const cf = cookiesFile()
    try {
      const res = await window.api.getPlaylist(url, cf, proxyArg())
      if (res.ok && res.playlist?.isPlaylist && res.playlist.entries.length > 0) {
        const nested = res.playlist.entries.filter((e) => e.isPlaylist)
        if (nested.length > 0) {
          setSubChooser({
            open: true,
            parent: url,
            lists: nested.map((e) => ({ title: e.title, url: e.url, count: e.count ?? null }))
          })
        } else {
          const plTitle = res.playlist.title ?? 'Playlist'
          const collected: SelEntry[] = res.playlist.entries.map((e) => ({
            ...e,
            checked: true,
            playlistTitle: plTitle
          }))
          setPlRange({ from: 1, to: collected.length })
          setPlaylistSel({ open: true, entries: collected })
        }
      } else {
        // Khong phai playlist -> coi nhu 1 video don
        await addSingles([url], cf)
      }
    } catch {
      await addSingles([url], cf)
    }
    setProbing(false)
  }

  const confirmAddPlaylist = (): void => {
    const chosen = playlistSel.entries.filter((e) => e.checked)
    const newItems: QueueItem[] = chosen.map((e) => ({
      id: crypto.randomUUID(),
      url: e.url,
      title: e.title,
      info: null,
      status: 'ready',
      progress: null,
      result: null,
      error: null,
      formatId: null,
      formatLabel: null,
      subfolder: cleanFolder(e.playlistTitle) // playlist -> thu muc theo ten playlist
    }))
    setItems((prev) => [...prev, ...newItems])
    setPlaylistSel({ open: false, entries: [] })
  }

  // Chon dinh dang nang cao
  const openFormatPicker = (item: QueueItem): void => {
    if (!item.info?.formats?.length) return
    setFormatPick({ open: true, itemId: item.id, formats: item.info.formats })
  }
  const chooseFormat = (f: VideoFormat): void => {
    const { selector, label } = buildFormatChoice(f)
    if (formatPick.itemId) patch(formatPick.itemId, { formatId: selector, formatLabel: label })
    setFormatPick({ open: false, itemId: null, formats: [] })
  }
  const clearFormat = (id: string): void => patch(id, { formatId: null, formatLabel: null })

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setOutputDir(dir)
  }

  // Chen thu muc con vao truoc mau ten file tuy theo cach sap xep
  const templateFor = (item: QueueItem): string => {
    if (folderMode === 'channel') return `%(uploader)s/${outputTemplate}`
    if (folderMode === 'playlist' && item.subfolder) return `${item.subfolder}/${outputTemplate}`
    return outputTemplate
  }

  const buildReq = (item: QueueItem): DownloadRequest => ({
    url: item.info?.webpageUrl ?? item.url,
    kind,
    height: kind === 'video' ? height : null,
    audioFormat,
    outputDir,
    embedThumbnail,
    embedMetadata,
    cookiesFile: cookiesFile(),
    formatId: item.formatId,
    container,
    outputTemplate: templateFor(item),
    writeSubs,
    autoSubs,
    subLangs,
    embedSubs,
    useArchive,
    forceOverwrite,
    proxy: proxyArg()
  })

  const runItem = async (it: QueueItem): Promise<void> => {
    patch(it.id, { status: 'downloading', progress: null, result: null, error: null })
    const result = await window.api.download(it.id, buildReq(it))
    patch(it.id, {
      status: result.ok ? 'done' : 'error',
      result,
      error: result.ok ? null : result.error
    })
  }

  const startRun = (): void => {
    if (!outputDir) return
    const queue = items.filter((it) => it.status === 'ready' || it.status === 'error')
    void runner.run(queue, runItem)
  }

  const removeItem = (id: string): void => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }
  const clearAll = (): void => {
    if (runner.active) return
    setItems([])
  }

  const pending = items.filter((it) => it.status === 'ready' || it.status === 'error').length
  const done = items.filter((it) => it.status === 'done').length
  const failed = items.filter((it) => it.status === 'error').length

  return (
    <div className="lam-viec">
      {/* ---------- COT GIUA: tuy chon + dan link ---------- */}
      <div className="cot-cauhinh">
        <div className="cot-tieude">Tùy chọn &amp; liên kết</div>
      {/* Tuy chon chung */}
      <div className="card options-card">
        <div className="options">
          <div className="seg">
            <button
              className={`seg-btn ${kind === 'video' ? 'active' : ''}`}
              onClick={() => setKind('video')}
            >
              🎬 Video (mp4)
            </button>
            <button
              className={`seg-btn ${kind === 'audio' ? 'active' : ''}`}
              onClick={() => setKind('audio')}
            >
              🎵 Âm thanh
            </button>
          </div>

          {kind === 'video' ? (
            <label className="field">
              <span>Độ phân giải</span>
              <select
                value={height ?? ''}
                onChange={(e) => setHeight(e.target.value ? Number(e.target.value) : null)}
              >
                {RES_PRESETS.map((r) => (
                  <option key={r.label} value={r.value ?? ''}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Định dạng âm thanh</span>
              <select value={audioFormat} onChange={(e) => setAudioFormat(e.target.value)}>
                {AUDIO_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="check">
            <input
              type="checkbox"
              checked={embedThumbnail}
              onChange={(e) => setEmbedThumbnail(e.target.checked)}
            />
            Kèm ảnh bìa
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={embedMetadata}
              onChange={(e) => setEmbedMetadata(e.target.checked)}
            />
            Kèm thông tin (tác giả, tên…)
          </label>
        </div>

        <div className="folder-row">
          <input className="folder-input" value={outputDir} readOnly title={outputDir} />
          <button className="btn" onClick={chooseFolder}>
            Chọn thư mục
          </button>
        </div>

        <label className="field folder-mode-row">
          <span>Sắp xếp vào thư mục</span>
          <select value={folderMode} onChange={(e) => setFolderMode(e.target.value as FolderMode)}>
            <option value="flat">Chung một thư mục</option>
            <option value="playlist">Mỗi playlist một thư mục riêng</option>
            <option value="channel">Theo kênh / tác giả</option>
          </select>
          <span className="muted small folder-mode-hint">
            {folderMode === 'flat' && 'Tất cả video lưu chung vào thư mục đã chọn.'}
            {folderMode === 'playlist' &&
              'Playlist tự vào thư mục con theo tên playlist. Video lẻ nằm ở thư mục gốc.'}
            {folderMode === 'channel' && 'Mỗi kênh/tác giả một thư mục con riêng.'}
          </span>
        </label>
      </div>

      {/* Tuy chon nang cao */}
      <div className="card adv-card">
        <button className="adv-toggle" onClick={() => setShowAdvanced((v) => !v)}>
          <span>⚙ Tùy chọn nâng cao</span>
          <span className="adv-arrow">{showAdvanced ? '▴' : '▾'}</span>
        </button>
        {showAdvanced && (
          <div className="adv-body">
            <div className="adv-row">
              <label className="field">
                <span>Định dạng file (video)</span>
                <select value={container} onChange={(e) => setContainer(e.target.value)}>
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                  <option value="webm">WEBM</option>
                </select>
              </label>
              <label className="field grow">
                <span>Kiểu đặt tên file</span>
                <select
                  value={customName ? 'custom' : outputTemplate}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === 'custom') {
                      setCustomName(true)
                    } else {
                      setCustomName(false)
                      setOutputTemplate(v)
                    }
                  }}
                >
                  {NAME_PRESETS.map((p) => (
                    <option key={p.tpl} value={p.tpl}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Tùy chỉnh…</option>
                </select>
              </label>
            </div>

            {customName ? (
              <label className="field">
                <span>Mẫu tùy chỉnh (nâng cao)</span>
                <input
                  className="folder-input"
                  value={outputTemplate}
                  onChange={(e) => setOutputTemplate(e.target.value)}
                  spellCheck={false}
                  placeholder="%(title)s.%(ext)s"
                />
                <span className="muted small">
                  Ví dụ: <code>%(uploader)s/%(title)s.%(ext)s</code> = lưu theo thư mục kênh. Dùng
                  các biến: <code>title</code> (tên), <code>id</code> (mã), <code>ext</code> (đuôi
                  file), <code>uploader</code> (kênh), <code>upload_date</code> (ngày).
                </span>
              </label>
            ) : (
              <div className="name-preview muted small">
                Tên file sẽ là:{' '}
                <b>{NAME_PRESETS.find((p) => p.tpl === outputTemplate)?.ex ?? outputTemplate}</b>
              </div>
            )}

            <div className="adv-subs">
              <label className="check">
                <input
                  type="checkbox"
                  checked={writeSubs}
                  onChange={(e) => setWriteSubs(e.target.checked)}
                />
                Tải phụ đề <span className="muted small">(chỉ khi tải Video)</span>
              </label>
              {writeSubs && (
                <div className="adv-subs-detail">
                  <label className="field">
                    <span>Ngôn ngữ</span>
                    <input
                      className="mini-input"
                      value={subLangs}
                      onChange={(e) => setSubLangs(e.target.value)}
                      placeholder="vi,en"
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={autoSubs}
                      onChange={(e) => setAutoSubs(e.target.checked)}
                    />
                    Kèm cả phụ đề tự động
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={embedSubs}
                      onChange={(e) => setEmbedSubs(e.target.checked)}
                    />
                    Gắn vào video
                  </label>
                </div>
              )}
            </div>

            <div className="adv-checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={useArchive}
                  onChange={(e) => setUseArchive(e.target.checked)}
                />
                Bỏ qua file đã tải (nhớ lịch sử)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={forceOverwrite}
                  onChange={(e) => setForceOverwrite(e.target.checked)}
                />
                Ghi đè file trùng
              </label>
            </div>

            {/* Cong cu tai: phien ban + cap nhat */}
            <div className="adv-tools">
              <div className="muted small">
                Công cụ tải: <b>{ytVer || '…'}</b>
                <span className="muted small"> · tự cập nhật hằng ngày</span>
              </div>
              <button className="btn small-btn" onClick={updateTool} disabled={toolUpdating}>
                {toolUpdating ? 'Đang cập nhật…' : '⟳ Cập nhật công cụ'}
              </button>
              {toolMsg && <div className="muted small adv-tool-msg">{toolMsg}</div>}
            </div>
          </div>
        )}
      </div>

      {/* Dang nhap bang cookie */}
      <div className="card cookie-card">
        <div className="cookie-head">
          <div>
            <div className="cookie-title">🔑 Đăng nhập bằng cookie</div>
            <div className="muted small">
              Dành cho video cần đăng nhập. Bấm nút để mở cửa sổ đăng nhập, đăng nhập xong rồi{' '}
              <b>đóng cửa sổ</b> — cookie sẽ tự lưu.
            </div>
          </div>
          {cookieStat?.has ? (
            <span className="cookie-status ok">Đã lưu · {cookieStat.count} cookie</span>
          ) : (
            <span className="cookie-status">Chưa có cookie</span>
          )}
        </div>

        <div className="cookie-actions">
          <input
            className="url-input small-input"
            placeholder="Trang cần đăng nhập (vd: https://youtube.com) — để trống cũng được"
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
            disabled={cookieBusy}
          />
          <button className="btn primary" onClick={openLogin} disabled={cookieBusy}>
            {cookieBusy ? 'Đang xử lý…' : 'Mở cửa sổ đăng nhập'}
          </button>
        </div>

        <div className="cookie-foot">
          <label className={`check ${cookieStat?.has ? '' : 'disabled'}`}>
            <input
              type="checkbox"
              checked={useCookies}
              disabled={!cookieStat?.has}
              onChange={(e) => setUseCookies(e.target.checked)}
            />
            Dùng cookie khi tải
          </label>
          {cookieStat?.has && (
            <button className="link-btn" onClick={clearCookie} disabled={cookieBusy}>
              Xóa cookie
            </button>
          )}
        </div>
        <div className="muted small cookie-tip">
          💡 Chỉ bật khi tải nội dung <b>cần đăng nhập</b>. Với video công khai (YouTube…), cookie có
          thể gây lỗi — cứ để tắt. Nếu lỡ bật mà lỗi, app sẽ tự thử lại không cookie.
        </div>

        {cookieMsg && <div className="cookie-msg small">{cookieMsg}</div>}
      </div>

      {/* Proxy (vuot khoa vung) */}
      <div className="card proxy-card">
        <div className="proxy-head">
          <div className="proxy-title">
            🌐 Proxy <span className="muted small">(vượt khóa vùng)</span>
          </div>
          <button
            className="proxy-guide-btn"
            onClick={() => setProxyGuide(true)}
            title="Hướng dẫn"
          >
            ? Hướng dẫn
          </button>
        </div>
        <div className="proxy-actions">
          <input
            className="url-input small-input"
            placeholder="socks5://127.0.0.1:1080  —  để trống nếu không dùng"
            value={proxyVal}
            onChange={(e) => {
              setProxyVal(e.target.value)
              setProxyMsg(null)
            }}
            spellCheck={false}
            disabled={proxyBusy}
          />
          <button
            className="btn"
            onClick={testProxyNow}
            disabled={proxyBusy || !proxyVal.trim()}
          >
            {proxyBusy ? 'Đang kiểm tra…' : 'Kiểm tra proxy'}
          </button>
        </div>
        {proxyMsg && (
          <div className={`proxy-msg small ${proxyMsg.ok ? 'ok' : 'err'}`}>
            {proxyMsg.ok ? '✓ ' : '✕ '}
            {proxyMsg.text}
          </div>
        )}
      </div>

      {/* Them URL vao hang doi */}
      <div className="url-row">
        <LinkInput
          placeholder="Dán 1 hoặc nhiều liên kết — Enter để thêm, Shift+Enter để xuống dòng"
          value={urlInput}
          onChange={setUrlInput}
          onSubmit={addUrls}
          disabled={probing}
        />
        <button className="btn primary" onClick={addUrls} disabled={!urlInput.trim() || probing}>
          {probing ? 'Đang phân tích…' : '+ Thêm'}
        </button>
      </div>

      <p className="hint muted small">
        💡 Link <b>video</b> → thêm vào hàng đợi, mỗi video có nút <b>⚙</b> để chọn định dạng chi
        tiết. &nbsp; Link <b>playlist</b> → hiện bảng chọn video để tải.
      </p>
      </div>

      {/* ---------- COT PHAI: hang doi ---------- */}
      <div className="cot-ketqua cot-hangdoi">
        <div className="cot-tieude">Hàng đợi</div>

      {/* Hang doi */}
      {items.length > 0 && (
        <>
          <div className="queue-bar">
            <div className="queue-summary muted small">
              {items.length} mục · {done} xong{failed > 0 ? ` · ${failed} lỗi` : ''}
            </div>
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
              <QueueRow
                key={it.id}
                item={it}
                selKind={kind}
                selHeight={height}
                folderMode={folderMode}
                onRemove={() => removeItem(it.id)}
                onPickFormat={() => openFormatPicker(it)}
                onClearFormat={() => clearFormat(it.id)}
                onGetSub={onGetSub}
              />
            ))}
          </div>
        </>
      )}

      {items.length === 0 && (
        <div className="empty muted">
          <div className="empty-title">Hàng đợi trống</div>
          <div>
            Dán link <b>video</b> hoặc <b>playlist</b> ở trên rồi bấm <b>Thêm</b>.
          </div>
          <div className="small" style={{ marginTop: 8 }}>
            Sau khi thêm, mỗi video sẽ có nút <b>⚙</b> để chọn định dạng (độ phân giải, codec…).
          </div>
        </div>
      )}
      </div>

      {/* Bang chon danh sach con (tab kenh / nhieu playlist) */}
      {subChooser.open && (
        <div
          className="modal-overlay"
          onClick={() => setSubChooser({ open: false, parent: '', lists: [] })}
        >
          <div className="modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-head">
              <h3>Chọn danh sách để tải</h3>
              <span className="muted small">{subChooser.lists.length} danh sách</span>
            </div>
            <div className="sub-note muted small">
              Link này chứa nhiều danh sách. Chọn 1 danh sách để xem video bên trong (kèm số lượng),
              rồi mới chọn khoảng tải.
            </div>
            <div className="modal-list">
              {subChooser.lists.map((l, i) => (
                <button className="sub-item" key={l.url || i} onClick={() => openSubList(l.url)}>
                  <span className="sub-ico">📃</span>
                  <span className="sub-title" title={l.title}>
                    {l.title}
                  </span>
                  <span className="sub-count muted small">
                    {l.count != null ? `${l.count} video` : 'Mở →'}
                  </span>
                </button>
              ))}
            </div>
            <div className="modal-foot">
              <button
                className="btn"
                onClick={() => setSubChooser({ open: false, parent: '', lists: [] })}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bang chon video tu playlist */}
      {playlistSel.open &&
        (() => {
          const total = playlistSel.entries.length
          const checkedCount = playlistSel.entries.filter((e) => e.checked).length
          const from = Math.max(1, Math.min(plRange.from || 1, total))
          const to = Math.max(from, Math.min(plRange.to || total, total))
          const RENDER_CAP = 500 // gioi han so dong ve DOM cho khoi lag
          const rows: { e: SelEntry; i: number }[] = []
          for (let i = from - 1; i < to && rows.length < RENDER_CAP; i++)
            rows.push({ e: playlistSel.entries[i], i })
          const hidden = to - from + 1 - rows.length

          return (
            <div
              className="modal-overlay"
              onClick={() => setPlaylistSel({ open: false, entries: [] })}
            >
              <div className="modal" onClick={(ev) => ev.stopPropagation()}>
                <div className="modal-head">
                  <h3>Chọn video từ playlist</h3>
                  <span className="muted small">
                    {total} video · đã chọn {checkedCount}
                  </span>
                </div>

                <div className="modal-tools">
                  <div className="pl-range">
                    <span className="muted small">Tải từ</span>
                    <input
                      className="mini-input pl-num"
                      type="number"
                      min={1}
                      max={total}
                      value={plRange.from}
                      onChange={(ev) =>
                        setPlRange((r) => ({ ...r, from: Number(ev.target.value) || 1 }))
                      }
                    />
                    <span className="muted small">đến</span>
                    <input
                      className="mini-input pl-num"
                      type="number"
                      min={1}
                      max={total}
                      value={plRange.to}
                      onChange={(ev) =>
                        setPlRange((r) => ({ ...r, to: Number(ev.target.value) || total }))
                      }
                    />
                    <span className="muted small">/ {total}</span>
                    <button className="btn small-btn" onClick={() => applyRange(from, to)}>
                      ✓ Chọn khoảng này
                    </button>
                  </div>
                  <div className="pl-tool-btns">
                    <button className="btn small-btn" onClick={() => setAllEntries(true)}>
                      Chọn tất cả
                    </button>
                    <button className="btn small-btn" onClick={() => setAllEntries(false)}>
                      Bỏ chọn
                    </button>
                  </div>
                </div>

                <div className="modal-list">
                  {rows.map(({ e, i }) => (
                    <label className="pl-entry" key={e.id || i}>
                      <input type="checkbox" checked={e.checked} onChange={() => toggleEntry(i)} />
                      <span className="pl-idx">{i + 1}</span>
                      <span className="pl-title" title={e.title}>
                        {e.title}
                      </span>
                      {e.durationString && <span className="pl-dur muted">{e.durationString}</span>}
                    </label>
                  ))}
                  {hidden > 0 && (
                    <div className="pl-more muted small">
                      … còn {hidden} video nữa trong khoảng (thu hẹp “Từ…đến” để xem). Nút “Chọn khoảng
                      này” vẫn áp dụng cho toàn bộ khoảng {from}–{to}.
                    </div>
                  )}
                </div>

                <div className="modal-foot">
                  <button
                    className="btn"
                    onClick={() => setPlaylistSel({ open: false, entries: [] })}
                  >
                    Hủy
                  </button>
                  <button
                    className="btn primary"
                    onClick={confirmAddPlaylist}
                    disabled={checkedCount === 0}
                  >
                    Thêm {checkedCount} video vào hàng đợi
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {/* Bang huong dan proxy */}
      {proxyGuide && (
        <div className="modal-overlay" onClick={() => setProxyGuide(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Hướng dẫn nhập Proxy</h3>
            </div>
            <div className="proxy-guide-body">
              <p className="muted small">
                Proxy giúp tải nội dung bị <b>khóa theo khu vực</b> (ví dụ Bilibili, một số đài TV).
                Bạn cần có sẵn proxy/VPN, rồi dán địa chỉ theo mẫu:
              </p>
              <div className="proxy-fmt">scheme://[tài_khoản:mật_khẩu@]host:cổng</div>

              <div className="proxy-ex-title small">Ví dụ dán đúng:</div>
              <table className="proxy-ex">
                <tbody>
                  <tr>
                    <td>
                      <code>socks5://127.0.0.1:1080</code>
                    </td>
                    <td className="muted">Proxy SOCKS5 chạy trên máy (v2ray, Shadowsocks…)</td>
                  </tr>
                  <tr>
                    <td>
                      <code>socks5h://127.0.0.1:1080</code>
                    </td>
                    <td className="muted">SOCKS5 + phân giải tên miền qua proxy (khuyên dùng)</td>
                  </tr>
                  <tr>
                    <td>
                      <code>http://1.2.3.4:8080</code>
                    </td>
                    <td className="muted">Proxy HTTP</td>
                  </tr>
                  <tr>
                    <td>
                      <code>socks5://user:pass@1.2.3.4:1080</code>
                    </td>
                    <td className="muted">Proxy có tài khoản/mật khẩu</td>
                  </tr>
                </tbody>
              </table>

              <div className="proxy-note small">
                ⚠ Bắt buộc có <b>phần đầu</b> (<code>socks5://</code>, <code>http://</code>…). Chỉ dán{' '}
                <code>1.2.3.4:1080</code> (thiếu phần đầu) sẽ báo lỗi.
              </div>
              <div className="proxy-note small">
                📋 Nếu mua proxy (DataImpulse, v.v.): copy <b>đúng nguyên chuỗi</b> nhà cung cấp đưa,
                kể cả phần đuôi trong tên đăng nhập (vd <code>__cr.eg</code> để chọn quốc gia). Thiếu
                đuôi này vẫn chạy nhưng có thể ra sai khu vực.
              </div>
              <p className="muted small">
                Sau khi dán, bấm <b>Kiểm tra proxy</b>: xanh là dùng được (kèm IP thoát), đỏ là sai
                định dạng hoặc không kết nối được.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn primary" onClick={() => setProxyGuide(false)}>
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay khi dang tai danh sach (dao vao tab lon co the mat vai giay) */}
      {probing && !subChooser.open && !playlistSel.open && (
        <div className="modal-overlay">
          <div className="probing-box">
            <div className="spinner" />
            <div className="muted small">Đang tải danh sách…</div>
          </div>
        </div>
      )}

      {/* Bang chon dinh dang nang cao */}
      {formatPick.open && (
        <div
          className="modal-overlay"
          onClick={() => setFormatPick({ open: false, itemId: null, formats: [] })}
        >
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Chọn định dạng</h3>
              <span className="muted small">
                Chọn 1 dòng · video không tiếng sẽ tự ghép âm thanh tốt nhất
              </span>
            </div>
            <div className="modal-list">
              <table className="fmt-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Độ phân giải</th>
                    <th>Đuôi</th>
                    <th>FPS</th>
                    <th>Codec</th>
                    <th>Kích thước</th>
                  </tr>
                </thead>
                <tbody>
                  {[...formatPick.formats]
                    .sort(
                      (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0)
                    )
                    .map((f) => (
                      <tr key={f.format_id} onClick={() => chooseFormat(f)}>
                        <td className="fmt-kind">
                          {f.vcodec ? (f.acodec ? '🎬' : '🎞') : '🎵'}
                        </td>
                        <td>
                          {f.height
                            ? `${f.height}p`
                            : f.acodec && !f.vcodec
                              ? 'Âm thanh'
                              : f.resolution ?? '—'}
                        </td>
                        <td>{f.ext}</td>
                        <td className="num">{f.fps ?? ''}</td>
                        <td className="fmt-codec">
                          {[f.vcodec, f.acodec].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td className="num">{formatBytes(f.filesize ?? f.filesizeApprox)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="modal-foot">
              <button
                className="btn"
                onClick={() => setFormatPick({ open: false, itemId: null, formats: [] })}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function statusLabel(it: QueueItem): string {
  switch (it.status) {
    case 'fetching':
      return 'Đang lấy thông tin…'
    case 'ready':
      return 'Chờ tải'
    case 'downloading':
      switch (it.progress?.status) {
        case 'postprocessing':
          return 'Đang xử lý…'
        case 'preparing':
          return 'Đang chuẩn bị…'
        default:
          return 'Đang tải…'
      }
    case 'done':
      return 'Xong'
    case 'error':
      return 'Lỗi'
  }
}

function QueueRow({
  item,
  selKind,
  selHeight,
  folderMode,
  onRemove,
  onPickFormat,
  onClearFormat,
  onGetSub
}: {
  item: QueueItem
  selKind: DownloadKind
  selHeight: number | null
  folderMode: FolderMode
  onRemove: () => void
  onPickFormat: () => void
  onClearFormat: () => void
  onGetSub: (filePath: string) => void
}): JSX.Element {
  const p = item.progress
  const pct = p ? Math.round(p.percent) : 0
  const busy = p?.status === 'postprocessing'
  const title = item.info?.title || item.title || item.url
  const canPickFormat = !!item.info?.formats?.length && item.status !== 'downloading'

  // Thu muc con dich (de nguoi dung biet file se luu o dau)
  const folderHint =
    folderMode === 'playlist' && item.subfolder
      ? item.subfolder
      : folderMode === 'channel'
        ? item.info?.uploader || 'theo kênh'
        : null

  const maxH = item.info?.heights?.[0] ?? null
  const resWarn =
    selKind === 'video' &&
    selHeight != null &&
    maxH != null &&
    selHeight > maxH &&
    !item.formatLabel &&
    item.status !== 'downloading' &&
    item.status !== 'done'
      ? `Video này tối đa ${maxH}p — chọn ${selHeight}p sẽ chỉ tải được ${maxH}p. Hãy chọn ${maxH}p hoặc "Tốt nhất".`
      : null

  return (
    <div className={`qrow ${item.status}`}>
      <div className="qthumb">
        {item.info?.thumbnail ? (
          <img src={item.info.thumbnail} alt="" />
        ) : (
          <div className="qthumb-ph">{item.status === 'fetching' ? '…' : '🎞'}</div>
        )}
      </div>

      <div className="qmain">
        <div className="qtitle" title={title}>
          {title}
        </div>

        {item.formatLabel && item.status !== 'downloading' && (
          <div className="qfmt">
            <span className="fmt-badge">⚙ {item.formatLabel}</span>
            <button className="link-btn" onClick={onClearFormat}>
              bỏ chọn
            </button>
          </div>
        )}

        {folderHint && item.status !== 'downloading' && item.status !== 'done' && (
          <div className="qfolder muted small" title={folderHint}>
            📁 {folderHint}
          </div>
        )}

        {resWarn && <div className="qwarn small">⚠ {resWarn}</div>}

        {item.status === 'downloading' && (
          <>
            <div className="bar mini">
              <div
                className={`bar-fill ${busy ? 'indeterminate' : ''}`}
                style={busy ? undefined : { width: `${pct}%` }}
              />
            </div>
            {p?.status === 'downloading' && (
              <div className="qstats muted small">
                <span>
                  {formatBytes(p.downloadedBytes)} / {formatBytes(p.totalBytes)}
                </span>
                <span>{formatSpeed(p.speed)}</span>
                <span>Còn {formatEta(p.eta)}</span>
              </div>
            )}
          </>
        )}

        {item.status === 'error' && item.error && (
          <div className="qerr small" title={item.error}>
            {item.error}
          </div>
        )}
      </div>

      <div className="qside">
        <span className={`qbadge ${item.status}`}>
          {statusLabel(item)}
          {item.status === 'downloading' && !busy ? ` ${pct}%` : ''}
        </span>
        <div className="qbtns">
          {canPickFormat && (
            <button className="ibtn" title="Chọn định dạng" onClick={onPickFormat}>
              ⚙
            </button>
          )}
          {item.status === 'done' && item.result?.file && (
            <>
              <button
                className="ibtn"
                title="Mở file"
                onClick={() => window.api.openPath(item.result!.file!)}
              >
                ▶
              </button>
              <button
                className="ibtn"
                title="Mở thư mục"
                onClick={() => window.api.showItem(item.result!.file!)}
              >
                📂
              </button>
              <button
                className="ibtn"
                title="Lấy phụ đề (Audio → Text)"
                onClick={() => onGetSub(item.result!.file!)}
              >
                📝
              </button>
            </>
          )}
          {item.status !== 'downloading' && (
            <button className="ibtn" title="Xóa khỏi hàng đợi" onClick={onRemove}>
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
