import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
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

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav']
// Do phan giai muc tieu (yt-dlp se lay ban tot nhat <= gia tri nay)
const RES_PRESETS: { label: string; value: number | null }[] = [
  { label: 'Tot nhat', value: null },
  { label: '2160p (4K)', value: 2160 },
  { label: '1440p', value: 1440 },
  { label: '1080p', value: 1080 },
  { label: '720p', value: 720 },
  { label: '480p', value: 480 },
  { label: '360p', value: 360 }
]

type ItemStatus = 'fetching' | 'ready' | 'downloading' | 'done' | 'error'

interface QueueItem {
  id: string
  url: string
  title: string
  info: VideoInfo | null
  status: ItemStatus
  progress: DownloadProgress | null
  result: DownloadResult | null
  error: string | null
  formatId: string | null // dinh dang tuy chon nguoi dung chon
  formatLabel: string | null // nhan hien thi cho dinh dang do
}

type SelEntry = PlaylistEntry & { checked: boolean; playlistTitle: string }

/** Tu 1 VideoFormat, dung chuoi selector cho yt-dlp + nhan hien thi. */
function buildFormatChoice(f: VideoFormat): { selector: string; label: string } {
  const hasV = !!f.vcodec
  const hasA = !!f.acodec
  let selector = f.format_id
  if (hasV && !hasA) selector = `${f.format_id}+bestaudio/${f.format_id}` // video-only -> ghep audio
  const res = f.height ? `${f.height}p` : hasA && !hasV ? 'Audio' : f.resolution ?? f.format_id
  const parts = [res, f.ext.toUpperCase()]
  if (f.fps) parts.push(`${f.fps}fps`)
  return { selector, label: parts.join(' · ') }
}

export default function Downloader(): JSX.Element {
  // Tuy chon chung ap dung cho ca hang doi
  const [kind, setKind] = useState<DownloadKind>('video')
  const [height, setHeight] = useState<number | null>(1080)
  const [audioFormat, setAudioFormat] = useState('mp3')
  const [embedThumbnail, setEmbedThumbnail] = useState(true)
  const [embedMetadata, setEmbedMetadata] = useState(true)
  const [outputDir, setOutputDir] = useState('')

  const [urlInput, setUrlInput] = useState('')
  const [items, setItems] = useState<QueueItem[]>([])
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)

  // Playlist
  const [probing, setProbing] = useState(false)
  const [playlistSel, setPlaylistSel] = useState<{ open: boolean; entries: SelEntry[] }>({
    open: false,
    entries: []
  })

  // Chon dinh dang nang cao (per-item)
  const [formatPick, setFormatPick] = useState<{
    open: boolean
    itemId: string | null
    formats: VideoFormat[]
  }>({ open: false, itemId: null, formats: [] })

  // Cookie dang nhap
  const [cookieStat, setCookieStat] = useState<CookieStatus | null>(null)
  const [useCookies, setUseCookies] = useState(false)
  const [cookieBusy, setCookieBusy] = useState(false)
  const [cookieMsg, setCookieMsg] = useState<string | null>(null)
  const [loginUrl, setLoginUrl] = useState('')

  const cookiesFile = (): string | null =>
    useCookies && cookieStat?.has ? cookieStat.path : null

  useEffect(() => {
    void window.api.downloadsDir().then(setOutputDir)
    void window.api.cookieStatus().then((s) => {
      setCookieStat(s)
      if (s.has) setUseCookies(true)
    })
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
      setCookieMsg(`Da luu ${res.count} cookie. San sang tai noi dung can dang nhap.`)
    } else {
      setCookieMsg('Loi lay cookie: ' + (res.error ?? ''))
    }
    setCookieBusy(false)
  }

  const clearCookie = async (): Promise<void> => {
    await window.api.cookieClear()
    const s = await window.api.cookieStatus()
    setCookieStat(s)
    setUseCookies(false)
    setCookieMsg('Da xoa cookie.')
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
      formatLabel: null
    }))
    setItems((prev) => [...prev, ...newItems])
    await Promise.all(
      newItems.map(async (it) => {
        const res = await window.api.getInfo(it.url, cf)
        if (res.ok && res.info)
          patch(it.id, { info: res.info, title: res.info.title, status: 'ready' })
        else patch(it.id, { status: 'error', error: res.error ?? 'Khong lay duoc thong tin.' })
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
    for (const url of urls) {
      try {
        const res = await window.api.getPlaylist(url, cf)
        if (res.ok && res.playlist?.isPlaylist && res.playlist.entries.length > 0) {
          for (const e of res.playlist.entries)
            collected.push({ ...e, checked: true, playlistTitle: res.playlist.title ?? 'Playlist' })
        } else {
          singles.push(url)
        }
      } catch {
        singles.push(url)
      }
    }

    if (singles.length) await addSingles(singles, cf)
    if (collected.length) setPlaylistSel({ open: true, entries: collected })
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
      formatLabel: null
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

  const buildReq = (item: QueueItem): DownloadRequest => ({
    url: item.info?.webpageUrl ?? item.url,
    kind,
    height: kind === 'video' ? height : null,
    audioFormat,
    outputDir,
    embedThumbnail,
    embedMetadata,
    cookiesFile: cookiesFile(),
    formatId: item.formatId
  })

  const downloadAll = async (): Promise<void> => {
    if (runningRef.current || !outputDir) return
    runningRef.current = true
    setRunning(true)

    // Chup danh sach hien tai; tai tuan tu cac muc chua xong
    const queue = items.filter((it) => it.status === 'ready' || it.status === 'error')
    for (const it of queue) {
      patch(it.id, { status: 'downloading', progress: null, result: null, error: null })
      const result = await window.api.download(it.id, buildReq(it))
      patch(it.id, {
        status: result.ok ? 'done' : 'error',
        result,
        error: result.ok ? null : result.error
      })
    }

    runningRef.current = false
    setRunning(false)
  }

  const removeItem = (id: string): void => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }
  const clearAll = (): void => {
    if (running) return
    setItems([])
  }

  const pending = items.filter((it) => it.status === 'ready' || it.status === 'error').length
  const done = items.filter((it) => it.status === 'done').length
  const failed = items.filter((it) => it.status === 'error').length

  return (
    <div className="downloader">
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
              🎵 Audio
            </button>
          </div>

          {kind === 'video' ? (
            <label className="field">
              <span>Do phan giai</span>
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
              <span>Dinh dang audio</span>
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
            Nhung anh bia
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={embedMetadata}
              onChange={(e) => setEmbedMetadata(e.target.checked)}
            />
            Nhung metadata
          </label>
        </div>

        <div className="folder-row">
          <input className="folder-input" value={outputDir} readOnly title={outputDir} />
          <button className="btn" onClick={chooseFolder}>
            Chon thu muc
          </button>
        </div>
      </div>

      {/* Cookie dang nhap */}
      <div className="card cookie-card">
        <div className="cookie-head">
          <div>
            <div className="cookie-title">🔑 Cookie dang nhap</div>
            <div className="muted small">
              Danh cho video can dang nhap. Bam nut de mo trinh duyet, dang nhap, roi{' '}
              <b>dong trinh duyet</b> — cookie se tu luu.
            </div>
          </div>
          {cookieStat?.has ? (
            <span className="cookie-status ok">Da luu · {cookieStat.count} cookie</span>
          ) : (
            <span className="cookie-status">Chua co cookie</span>
          )}
        </div>

        <div className="cookie-actions">
          <input
            className="url-input small-input"
            placeholder="Trang can dang nhap (vd: https://youtube.com) — de trong cung duoc"
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
            disabled={cookieBusy}
          />
          <button className="btn primary" onClick={openLogin} disabled={cookieBusy}>
            {cookieBusy ? 'Dang xu ly...' : 'Mo trinh duyet dang nhap'}
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
            Dung cookie khi tai
          </label>
          {cookieStat?.has && (
            <button className="link-btn" onClick={clearCookie} disabled={cookieBusy}>
              Xoa cookie
            </button>
          )}
        </div>

        {cookieMsg && <div className="cookie-msg small">{cookieMsg}</div>}
      </div>

      {/* Them URL vao hang doi */}
      <div className="url-row">
        <input
          className="url-input"
          placeholder="Dan 1 hoac nhieu lien ket (cach nhau bang khoang trang / xuong dong)"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addUrls()}
        />
        <button className="btn primary" onClick={addUrls} disabled={!urlInput.trim() || probing}>
          {probing ? 'Dang phan tich...' : '+ Them'}
        </button>
      </div>

      <p className="hint muted small">
        💡 Link <b>video</b> → them vao hang doi, moi video co nut <b>⚙</b> de chon dinh dang chi
        tiet. &nbsp; Link <b>playlist</b> → hien bang chon video de tai.
      </p>

      {/* Hang doi */}
      {items.length > 0 && (
        <>
          <div className="queue-bar">
            <div className="queue-summary muted small">
              {items.length} muc · {done} xong{failed > 0 ? ` · ${failed} loi` : ''}
            </div>
            <div className="queue-actions">
              <button className="btn" onClick={clearAll} disabled={running}>
                Xoa het
              </button>
              <button
                className="btn primary"
                onClick={downloadAll}
                disabled={running || pending === 0 || !outputDir}
              >
                {running ? 'Dang tai...' : `⬇ Tai tat ca (${pending})`}
              </button>
            </div>
          </div>

          <div className="queue-list">
            {items.map((it) => (
              <QueueRow
                key={it.id}
                item={it}
                selKind={kind}
                selHeight={height}
                onRemove={() => removeItem(it.id)}
                onPickFormat={() => openFormatPicker(it)}
                onClearFormat={() => clearFormat(it.id)}
              />
            ))}
          </div>
        </>
      )}

      {items.length === 0 && (
        <div className="empty muted">
          <div className="empty-title">Hang doi trong</div>
          <div>
            Dan link <b>video</b> hoac <b>playlist</b> o tren roi bam <b>Them</b>.
          </div>
          <div className="small" style={{ marginTop: 8 }}>
            Sau khi them, moi video se co nut <b>⚙</b> de chon dinh dang (do phan giai, codec…).
          </div>
        </div>
      )}

      {/* Bang chon video tu playlist */}
      {playlistSel.open && (
        <div className="modal-overlay" onClick={() => setPlaylistSel({ open: false, entries: [] })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Chon video tu playlist</h3>
              <span className="muted small">
                {playlistSel.entries.filter((e) => e.checked).length}/{playlistSel.entries.length} da
                chon
              </span>
            </div>
            <div className="modal-tools">
              <button className="btn small-btn" onClick={() => setAllEntries(true)}>
                Chon tat ca
              </button>
              <button className="btn small-btn" onClick={() => setAllEntries(false)}>
                Bo chon
              </button>
            </div>
            <div className="modal-list">
              {playlistSel.entries.map((e, i) => (
                <label className="pl-entry" key={e.id || i}>
                  <input type="checkbox" checked={e.checked} onChange={() => toggleEntry(i)} />
                  <span className="pl-idx">{i + 1}</span>
                  <span className="pl-title" title={e.title}>
                    {e.title}
                  </span>
                  {e.durationString && <span className="pl-dur muted">{e.durationString}</span>}
                </label>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPlaylistSel({ open: false, entries: [] })}>
                Huy
              </button>
              <button
                className="btn primary"
                onClick={confirmAddPlaylist}
                disabled={playlistSel.entries.filter((e) => e.checked).length === 0}
              >
                Them {playlistSel.entries.filter((e) => e.checked).length} video vao hang doi
              </button>
            </div>
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
              <h3>Chon dinh dang</h3>
              <span className="muted small">Chon 1 dong · video-only se tu ghep audio tot nhat</span>
            </div>
            <div className="modal-list">
              <table className="fmt-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Do phan giai</th>
                    <th>Ext</th>
                    <th>FPS</th>
                    <th>Codec</th>
                    <th>Kich thuoc</th>
                  </tr>
                </thead>
                <tbody>
                  {[...formatPick.formats]
                    .sort(
                      (a, b) =>
                        (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0)
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
                              ? 'Audio'
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
                Dong
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
      return 'Dang lay thong tin...'
    case 'ready':
      return 'Cho tai'
    case 'downloading':
      switch (it.progress?.status) {
        case 'postprocessing':
          return 'Dang xu ly...'
        case 'preparing':
          return 'Dang chuan bi...'
        default:
          return 'Dang tai...'
      }
    case 'done':
      return 'Xong'
    case 'error':
      return 'Loi'
  }
}

function QueueRow({
  item,
  selKind,
  selHeight,
  onRemove,
  onPickFormat,
  onClearFormat
}: {
  item: QueueItem
  selKind: DownloadKind
  selHeight: number | null
  onRemove: () => void
  onPickFormat: () => void
  onClearFormat: () => void
}): JSX.Element {
  const p = item.progress
  const pct = p ? Math.round(p.percent) : 0
  const busy = p?.status === 'postprocessing'
  const title = item.info?.title || item.title || item.url
  const canPickFormat = !!item.info?.formats?.length && item.status !== 'downloading'

  // Canh bao neu do phan giai chung cao hon muc toi da cua video nay.
  // Chi ap dung khi: che do Video, co chon do phan giai cu the, chua chon format rieng.
  const maxH = item.info?.heights?.[0] ?? null
  const resWarn =
    selKind === 'video' &&
    selHeight != null &&
    maxH != null &&
    selHeight > maxH &&
    !item.formatLabel &&
    item.status !== 'downloading' &&
    item.status !== 'done'
      ? `Video nay toi da ${maxH}p — chon ${selHeight}p se chi tai duoc ${maxH}p. Hay chon ${maxH}p hoac "Tot nhat".`
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
              bo chon
            </button>
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
                <span>ETA {formatEta(p.eta)}</span>
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
            <button className="ibtn" title="Chon dinh dang" onClick={onPickFormat}>
              ⚙
            </button>
          )}
          {item.status === 'done' && item.result?.file && (
            <>
              <button className="ibtn" title="Mo file" onClick={() => window.api.openPath(item.result!.file!)}>
                ▶
              </button>
              <button
                className="ibtn"
                title="Mo thu muc"
                onClick={() => window.api.showItem(item.result!.file!)}
              >
                📂
              </button>
            </>
          )}
          {item.status !== 'downloading' && (
            <button className="ibtn" title="Xoa khoi hang doi" onClick={onRemove}>
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
