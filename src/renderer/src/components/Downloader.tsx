import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type {
  CookieSite,
  CookieStatus,
  DownloadKind,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  PlaylistEntry,
  SiteCookieStatus,
  VideoFormat,
  VideoInfo,
  YtDlpCapabilityStatus
} from '../../../shared/types'
import { cookieSiteForUrl, isKnownSingleVideoUrl } from '../../../shared/sites'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { useTabOutputDir } from '../lib/outputDir'
import { usePersistedState } from '../lib/persist'
import { useQueueRunner } from '../lib/useQueueRunner'
import LinkInput from './LinkInput'
import RunControls from './RunControls'

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav']
const COOKIE_SITE_LABEL: Record<CookieSite, string> = {
  facebook: 'Facebook',
  bilibili: 'Bilibili'
}
const SPECIAL_COOKIE_DOMAINS = new Set(['facebook.com', 'bilibili.com'])
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

type ItemStatus = 'fetching' | 'ready' | 'downloading' | 'done' | 'skipped' | 'error'

// Cach sap xep file vao thu muc
type FolderMode = 'flat' | 'playlist' | 'channel'

interface QueueItem {
  id: string
  mediaId: string | null
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
  onGetSub
}: {
  onGetSub: (filePath: string) => void
}): JSX.Element {
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.download')
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
  const [ensureH264, setEnsureH264] = usePersistedState('tblao.dl.ensureH264', false)

  // Proxy (vuot khoa vung) — nho lai chuoi da nhap
  const [proxyVal, setProxyVal] = usePersistedState('tblao.dl.proxy', '')
  const [proxyMsg, setProxyMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [proxyBusy, setProxyBusy] = useState(false)
  const [proxyGuide, setProxyGuide] = useState(false)
  const proxyArg = (): string | null => proxyVal.trim() || null

  // Cong cu tai: phien ban + cap nhat
  const [ytVer, setYtVer] = useState<string | null>(null)
  const [ytCaps, setYtCaps] = useState<YtDlpCapabilityStatus | null>(null)
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
  const [showFormatDetails, setShowFormatDetails] = useState(false)

  // Cookie rieng theo website: tranh dung cookie Facebook cho Bilibili va nguoc lai.
  const [domainCookieStats, setDomainCookieStats] = useState<CookieStatus[]>([])
  const [useCookies, setUseCookies] = usePersistedState('tblao.dl.useCookies', false)
  const [siteCookieStats, setSiteCookieStats] = useState<
    Record<CookieSite, SiteCookieStatus | null>
  >({ facebook: null, bilibili: null })
  const [useFacebookCookies, setUseFacebookCookies] = usePersistedState(
    'tblao.dl.useFacebookCookies',
    false
  )
  const [useBilibiliCookies, setUseBilibiliCookies] = usePersistedState(
    'tblao.dl.useBilibiliCookies',
    false
  )
  const [cookieBusy, setCookieBusy] = useState<CookieSite | 'generic' | null>(null)
  const [cookieMsg, setCookieMsg] = useState<string | null>(null)
  const [loginUrl, setLoginUrl] = useState('')

  const useCookiesForUrl = (url: string): boolean => {
    const site = cookieSiteForUrl(url)
    if (site === 'facebook') return useFacebookCookies && !!siteCookieStats.facebook?.has
    if (site === 'bilibili') return useBilibiliCookies && !!siteCookieStats.bilibili?.has
    return useCookies
  }

  const refreshToolVer = (): void => {
    void window.api.ytdlpVersion().then(setYtVer).catch(() => setYtVer(null))
    void window.api.ytdlpCapabilities().then(setYtCaps).catch(() => setYtCaps(null))
  }
  const updateTool = async (): Promise<void> => {
    setToolUpdating(true)
    setToolMsg(null)
    try {
      const r = await window.api.ytdlpUpdate()
      setToolMsg(r.message)
      refreshToolVer()
    } catch (err) {
      setToolMsg(err instanceof Error ? err.message : 'Không thể cập nhật công cụ tải.')
    } finally {
      setToolUpdating(false)
    }
  }

  const refreshSiteCookies = async (): Promise<void> => {
    const [facebook, bilibili] = await Promise.all([
      window.api.siteCookieStatus('facebook'),
      window.api.siteCookieStatus('bilibili')
    ])
    setSiteCookieStats({ facebook, bilibili })
  }

  const refreshDomainCookies = async (): Promise<void> => {
    const statuses = await window.api.cookieList()
    setDomainCookieStats(statuses.filter((status) => !SPECIAL_COOKIE_DOMAINS.has(status.domain ?? '')))
  }

  useEffect(() => {
    refreshToolVer()
    void refreshDomainCookies().catch(() => setDomainCookieStats([]))
    void refreshSiteCookies().catch(() =>
      setCookieMsg('Không thể đọc trạng thái đăng nhập đã lưu.')
    )
    const off = window.api.onProgress((p) => {
      setItems((prev) => prev.map((it) => (it.id === p.id ? { ...it, progress: p } : it)))
    })
    return off
  }, [])

  const openSiteLogin = async (site: CookieSite): Promise<void> => {
    setCookieBusy(site)
    setCookieMsg(null)
    const offEvent = window.api.onSiteCookieCaptureEvent((e) => {
      if (e.site !== site) return
      setCookieMsg(
        e.phase === 'launching'
          ? `Đang mở cửa sổ đăng nhập ${COOKIE_SITE_LABEL[site]}…`
          : e.phase === 'ready'
            ? `Hãy đăng nhập ${COOKIE_SITE_LABEL[site]}, sau đó đóng cửa sổ để hoàn tất.`
            : e.phase === 'saved'
              ? `Đã kết nối tài khoản ${COOKIE_SITE_LABEL[site]}.`
              : 'Không thể lưu phiên đăng nhập. Hãy thử lại.'
      )
    })
    try {
      const res = await window.api.siteCookieCapture(site)
      if (!res.ok) {
        setCookieMsg(`Không thể lưu phiên đăng nhập ${COOKIE_SITE_LABEL[site]}: ${res.error ?? ''}`)
        return
      }
      const status = await window.api.siteCookieStatus(site)
      setSiteCookieStats((prev) => ({ ...prev, [site]: status }))
      if (site === 'facebook') setUseFacebookCookies(true)
      else setUseBilibiliCookies(true)
      setCookieMsg(
        status.loggedIn
          ? `Đã kết nối tài khoản ${COOKIE_SITE_LABEL[site]}.`
          : `Chưa hoàn tất đăng nhập ${COOKIE_SITE_LABEL[site]}. Hãy mở lại cửa sổ và đăng nhập.`
      )
    } catch (err) {
      setCookieMsg(err instanceof Error ? err.message : 'Không thể lưu phiên đăng nhập.')
    } finally {
      offEvent()
      setCookieBusy(null)
    }
  }

  const clearSiteCookie = async (site: CookieSite): Promise<void> => {
    setCookieBusy(site)
    try {
      await window.api.siteCookieClear(site)
      const status = await window.api.siteCookieStatus(site)
      setSiteCookieStats((prev) => ({ ...prev, [site]: status }))
      if (site === 'facebook') setUseFacebookCookies(false)
      else setUseBilibiliCookies(false)
      setCookieMsg(`Đã đăng xuất ${COOKIE_SITE_LABEL[site]}.`)
    } catch (err) {
      setCookieMsg(err instanceof Error ? err.message : 'Không thể đăng xuất.')
    } finally {
      setCookieBusy(null)
    }
  }

  const openGenericLogin = async (): Promise<void> => {
    setCookieBusy('generic')
    setCookieMsg(null)
    const offEvent = window.api.onCookieCaptureEvent((e) =>
      setCookieMsg(
        e.phase === 'launching'
          ? 'Đang mở cửa sổ đăng nhập…'
          : e.phase === 'ready'
            ? 'Hãy đăng nhập, sau đó đóng cửa sổ để hoàn tất.'
            : e.phase === 'saved'
              ? 'Đã kết nối website.'
              : 'Không thể lưu phiên đăng nhập. Hãy thử lại.'
      )
    )
    try {
      const res = await window.api.cookieCapture(loginUrl.trim())
      if (!res.ok) {
        setCookieMsg('Không thể lưu phiên đăng nhập: ' + (res.error ?? ''))
        return
      }
      await Promise.all([refreshDomainCookies(), refreshSiteCookies()])
      if (res.domain === 'facebook.com') setUseFacebookCookies(true)
      else if (res.domain === 'bilibili.com') setUseBilibiliCookies(true)
      else setUseCookies(true)
      setCookieMsg(`Đã kết nối ${res.domain ?? 'website'}.`)
    } catch (err) {
      setCookieMsg(err instanceof Error ? err.message : 'Không thể lưu phiên đăng nhập.')
    } finally {
      offEvent()
      setCookieBusy(null)
    }
  }

  const clearGenericCookie = async (domain: string): Promise<void> => {
    setCookieBusy('generic')
    try {
      await window.api.cookieClear(`https://${domain}/`)
      await refreshDomainCookies()
      setCookieMsg(`Đã đăng xuất ${domain}.`)
    } catch (err) {
      setCookieMsg(err instanceof Error ? err.message : 'Không thể đăng xuất.')
    } finally {
      setCookieBusy(null)
    }
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

  const addProbeFailure = (url: string, error: string): void => {
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        mediaId: null,
        url,
        title: url,
        info: null,
        status: 'error',
        progress: null,
        result: null,
        error,
        formatId: null,
        formatLabel: null,
        subfolder: null
      }
    ])
  }

  // Them cac URL video don, lay thong tin day du (kem thumbnail)
  const addSingles = async (urls: string[]): Promise<void> => {
    const newItems: QueueItem[] = urls.map((url) => ({
      id: crypto.randomUUID(),
      mediaId: null,
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
        try {
          const res = await window.api.getInfo(
            it.url,
            proxyArg(),
            useCookiesForUrl(it.url)
          )
          if (res.ok && res.info)
            patch(it.id, {
              info: res.info,
              mediaId: res.info.id || null,
              title: res.info.title,
              status: 'ready'
            })
          else patch(it.id, { status: 'error', error: res.error ?? 'Không lấy được thông tin.' })
        } catch (err) {
          patch(it.id, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Không lấy được thông tin.'
          })
        }
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
    const singles: string[] = []
    const collected: SelEntry[] = []
    const sublists: { title: string; url: string; count: number | null }[] = []
    for (const url of urls) {
      if (isKnownSingleVideoUrl(url)) {
        singles.push(url)
        continue
      }
      try {
        const res = await window.api.getPlaylist(
          url,
          proxyArg(),
          useCookiesForUrl(url)
        )
        if (!res.ok && res.errorCode) {
          // Lenh probe da tra loi ro (412, login, rate-limit...). Khong lap tuc
          // goi getInfo lan hai vi co the lam anti-bot tang muc chan.
          addProbeFailure(url, res.error ?? 'Không phân tích được liên kết.')
        } else if (res.ok && res.playlist?.isPlaylist && res.playlist.entries.length > 0) {
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

    if (singles.length) await addSingles(singles)
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
    try {
      const res = await window.api.getPlaylist(
        url,
        proxyArg(),
        useCookiesForUrl(url)
      )
      if (!res.ok && res.errorCode) {
        addProbeFailure(url, res.error ?? 'Không phân tích được liên kết.')
      } else if (res.ok && res.playlist?.isPlaylist && res.playlist.entries.length > 0) {
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
        await addSingles([url])
      }
    } catch {
      await addSingles([url])
    }
    setProbing(false)
  }

  const confirmAddPlaylist = (): void => {
    const chosen = playlistSel.entries.filter((e) => e.checked)
    const newItems: QueueItem[] = chosen.map((e) => ({
      id: crypto.randomUUID(),
      mediaId: e.id || null,
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
    // Giu URL nguoi dung/playlist cung cap. Main se tu chon cookie dung domain;
    // khong doi sang webpage_url cua extractor (co the la host mobile/redirect).
    url: item.url,
    mediaId: item.info?.id || item.mediaId,
    kind,
    height: kind === 'video' ? height : null,
    audioFormat,
    outputDir,
    embedThumbnail,
    embedMetadata,
    useCookies: useCookiesForUrl(item.info?.webpageUrl ?? item.url),
    ensureH264: kind === 'video' && ensureH264,
    formatId: item.formatId,
    container: kind === 'video' && ensureH264 ? 'mp4' : container,
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
    try {
      const result = await window.api.download(it.id, buildReq(it))
      patch(it.id, {
        status: result.ok ? (result.skipped ? 'skipped' : 'done') : 'error',
        result,
        error: result.ok ? null : result.error
      })
    } catch (err) {
      patch(it.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Không thể bắt đầu lượt tải này.'
      })
    }
  }

  const startRun = (): void => {
    if (!outputDir) return
    const queue = items.filter(
      (it) => it.status === 'ready' || it.status === 'error' || it.status === 'skipped'
    )
    void runner.run(queue, runItem)
  }

  const removeItem = (id: string): void => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }
  const clearAll = (): void => {
    if (runner.active) return
    setItems([])
  }

  const pending = items.filter(
    (it) => it.status === 'ready' || it.status === 'error' || it.status === 'skipped'
  ).length
  const done = items.filter((it) => it.status === 'done').length
  const skipped = items.filter((it) => it.status === 'skipped').length
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
              🎬 Video
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
                <select
                  value={ensureH264 ? 'mp4' : container}
                  disabled={kind === 'video' && ensureH264}
                  onChange={(e) => setContainer(e.target.value)}
                >
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
              <label
                className={`check ${kind === 'video' ? '' : 'disabled'}`}
                title="T-blao sẽ ưu tiên định dạng phát được trên nhiều thiết bị."
              >
                <input
                  type="checkbox"
                  checked={ensureH264}
                  disabled={kind !== 'video'}
                  onChange={(e) => setEnsureH264(e.target.checked)}
                />
                Ưu tiên video dễ phát
              </label>
              <label
                className="check"
                title="Lịch sử toàn cục trên máy — đổi thư mục lưu cũng vẫn bỏ qua video đã từng tải. Muốn tải lại: tắt mục này."
              >
                <input
                  type="checkbox"
                  checked={useArchive}
                  onChange={(e) => setUseArchive(e.target.checked)}
                />
                Bỏ qua video đã tải trước (lịch sử toàn máy)
              </label>
              <label
                className="check"
                title="Chỉ ghi đè khi file cùng tên đã có trên đĩa — không bỏ qua lịch sử tải."
              >
                <input
                  type="checkbox"
                  checked={forceOverwrite}
                  onChange={(e) => setForceOverwrite(e.target.checked)}
                />
                Ghi đè file trùng tên
              </label>
            </div>
            {kind === 'video' && ensureH264 && (
              <div className="muted small" style={{ marginTop: -8 }}>
                Nếu cần, T-blao sẽ chuyển đổi video sau khi tải. Quá trình có thể lâu hơn.
              </div>
            )}
            {useArchive && (
              <div className="muted small" style={{ marginTop: 4 }}>
                Đang bật lịch sử: video đã tải trước sẽ hiện “Bỏ qua”, không ghi file mới vào thư mục
                hiện tại. Tắt ô trên nếu muốn tải lại.
              </div>
            )}

            <details className="tech-details">
              <summary>Thông tin công cụ tải</summary>
              <div className="adv-tools">
                <div className="muted small">
                  Phiên bản: <b>{ytVer || '…'}</b>
                  <span className="muted small"> · tự cập nhật hằng ngày</span>
                </div>
                <button className="btn small-btn" onClick={updateTool} disabled={toolUpdating}>
                  {toolUpdating ? 'Đang cập nhật…' : '⟳ Kiểm tra cập nhật'}
                </button>
                {toolMsg && <div className="muted small adv-tool-msg">{toolMsg}</div>}
              </div>
              {ytCaps && (
                <div
                  className={`capability-note small ${
                    ytCaps.impersonationAvailable ? 'ok' : 'warn'
                  }`}
                >
                  {ytCaps.impersonationAvailable
                    ? '✓ Thành phần hỗ trợ Facebook đã sẵn sàng.'
                    : '⚠ Thành phần hỗ trợ Facebook chưa sẵn sàng. Hãy kiểm tra cập nhật công cụ.'}
                </div>
              )}
            </details>
          </div>
        )}
      </div>

      {/* Dang nhap bang cookie rieng cho tung website */}
      <div className="card cookie-card">
        <div className="cookie-head">
          <div>
            <div className="cookie-title">Tài khoản website</div>
            <div className="muted small">
              Dùng tài khoản của bạn để tải nội dung cần đăng nhập. Mỗi website được lưu riêng.
            </div>
          </div>
        </div>

        <div className="site-cookie-list">
          <div className="site-cookie-row">
            <div className="site-cookie-info">
              <b>Facebook</b>
              {siteCookieStats.facebook?.loggedIn ? (
                <span className="cookie-status ok">
                  Đã kết nối
                </span>
              ) : (siteCookieStats.facebook?.count ?? 0) > 0 ? (
                <span className="cookie-status warn">Chưa hoàn tất đăng nhập</span>
              ) : (siteCookieStats.facebook?.expiredCount ?? 0) > 0 ? (
                <span className="cookie-status warn">
                  Phiên đăng nhập đã hết hạn
                </span>
              ) : (
                <span className="cookie-status">Chưa đăng nhập</span>
              )}
            </div>
            <div className="site-cookie-actions">
              <label className={`check ${siteCookieStats.facebook?.has ? '' : 'disabled'}`}>
                <input
                  type="checkbox"
                  checked={useFacebookCookies && !!siteCookieStats.facebook?.has}
                  disabled={!siteCookieStats.facebook?.has || cookieBusy !== null}
                  onChange={(e) => setUseFacebookCookies(e.target.checked)}
                />
                Dùng tài khoản này
              </label>
              <button
                className="btn small-btn"
                onClick={() => void openSiteLogin('facebook')}
                disabled={cookieBusy !== null}
              >
                {cookieBusy === 'facebook' ? 'Đang xử lý…' : 'Đăng nhập'}
              </button>
              {((siteCookieStats.facebook?.count ?? 0) > 0 ||
                (siteCookieStats.facebook?.expiredCount ?? 0) > 0) && (
                <button
                  className="link-btn"
                  onClick={() => void clearSiteCookie('facebook')}
                  disabled={cookieBusy !== null}
                >
                  Xóa
                </button>
              )}
            </div>
          </div>

          <div className="site-cookie-row">
            <div className="site-cookie-info">
              <b>Bilibili</b>
              {siteCookieStats.bilibili?.loggedIn ? (
                <span className="cookie-status ok">
                  Đã kết nối
                </span>
              ) : (siteCookieStats.bilibili?.count ?? 0) > 0 ? (
                <span className="cookie-status warn">Chưa hoàn tất đăng nhập</span>
              ) : (siteCookieStats.bilibili?.expiredCount ?? 0) > 0 ? (
                <span className="cookie-status warn">
                  Phiên đăng nhập đã hết hạn
                </span>
              ) : (
                <span className="cookie-status">Chưa đăng nhập</span>
              )}
            </div>
            <div className="site-cookie-actions">
              <label className={`check ${siteCookieStats.bilibili?.has ? '' : 'disabled'}`}>
                <input
                  type="checkbox"
                  checked={useBilibiliCookies && !!siteCookieStats.bilibili?.has}
                  disabled={!siteCookieStats.bilibili?.has || cookieBusy !== null}
                  onChange={(e) => setUseBilibiliCookies(e.target.checked)}
                />
                Dùng tài khoản này
              </label>
              <button
                className="btn small-btn"
                onClick={() => void openSiteLogin('bilibili')}
                disabled={cookieBusy !== null}
              >
                {cookieBusy === 'bilibili' ? 'Đang xử lý…' : 'Đăng nhập'}
              </button>
              {((siteCookieStats.bilibili?.count ?? 0) > 0 ||
                (siteCookieStats.bilibili?.expiredCount ?? 0) > 0) && (
                <button
                  className="link-btn"
                  onClick={() => void clearSiteCookie('bilibili')}
                  disabled={cookieBusy !== null}
                >
                  Xóa
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="muted small cookie-tip">
          T-blao tự dùng đúng phiên đăng nhập cho từng website khi cần.
        </div>

        <details className="generic-cookie">
          <summary>Đăng nhập website khác</summary>
          <div className="generic-cookie-body">
            <div className="cookie-actions">
              <input
                className="url-input small-input"
                placeholder="Website cần tải, ví dụ https://youtube.com"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                disabled={cookieBusy !== null}
              />
              <button
                className="btn"
                onClick={() => void openGenericLogin()}
                disabled={cookieBusy !== null || !loginUrl.trim()}
              >
                {cookieBusy === 'generic' ? 'Đang xử lý…' : 'Mở đăng nhập'}
              </button>
            </div>
            <div className="cookie-foot">
              <label className="check">
                <input
                  type="checkbox"
                  checked={useCookies}
                  disabled={cookieBusy !== null}
                  onChange={(e) => setUseCookies(e.target.checked)}
                />
                Tự dùng đúng phiên đăng nhập
              </label>
            </div>
            {domainCookieStats.length > 0 && (
              <div className="site-cookie-list domain-cookie-list">
                {domainCookieStats.map((status) => (
                  <div className="site-cookie-row" key={status.domain ?? 'invalid'}>
                    <div className="site-cookie-info">
                      <b>{status.domain}</b>
                      <span className={`cookie-status ${status.has ? 'ok' : 'warn'}`}>
                        {status.has
                          ? 'Đã kết nối'
                          : 'Phiên đăng nhập đã hết hạn'}
                      </span>
                    </div>
                    {status.domain && (
                      <button
                        className="link-btn"
                        onClick={() => void clearGenericCookie(status.domain!)}
                        disabled={cookieBusy !== null}
                      >
                        Xóa
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

        {cookieMsg && <div className="cookie-msg small">{cookieMsg}</div>}
      </div>

      {/* Proxy (vuot khoa vung) */}
      <details className="card proxy-card tech-card">
        <summary className="proxy-title tech-card-summary">
          Kết nối qua proxy <span className="muted small">(nếu nội dung bị giới hạn khu vực)</span>
        </summary>
        <div className="tech-card-body">
        <div className="proxy-head">
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
      </details>

      {/* Them URL vao hang doi */}
      <div className="url-row link-entry-row">
        <LinkInput
          placeholder="Dán link video hoặc playlist vào đây"
          value={urlInput}
          onChange={setUrlInput}
          onSubmit={addUrls}
          disabled={probing}
        />
        <button
          className="btn primary link-add-btn"
          onClick={addUrls}
          disabled={!urlInput.trim() || probing}
        >
          {probing ? 'Đang phân tích…' : '+ Thêm'}
        </button>
      </div>

      <p className="hint muted small">
        Dán link video để thêm vào hàng đợi. Với playlist, T-blao sẽ cho bạn chọn các video cần tải.
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
              {items.length} mục · {done} xong
              {skipped > 0 ? ` · ${skipped} bỏ qua` : ''}
              {failed > 0 ? ` · ${failed} lỗi` : ''}
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
                outputDir={outputDir}
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
            Sau khi thêm, mỗi video sẽ có nút <b>⚙</b> để chọn chất lượng riêng.
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
              <span className="muted small">Chọn chất lượng phù hợp với nhu cầu của bạn</span>
            </div>
            <label className="check format-detail-toggle">
              <input
                type="checkbox"
                checked={showFormatDetails}
                onChange={(e) => setShowFormatDetails(e.target.checked)}
              />
              Xem chi tiết kỹ thuật
            </label>
            <div className="modal-list">
              <table className={`fmt-table ${showFormatDetails ? 'show-technical' : ''}`}>
                <thead>
                  <tr>
                    <th></th>
                    <th>Độ phân giải</th>
                    <th>Kích thước</th>
                    <th className="fmt-technical">Đuôi</th>
                    <th className="fmt-technical">FPS</th>
                    <th className="fmt-technical">Codec</th>
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
                        <td className="num">{formatBytes(f.filesize ?? f.filesizeApprox)}</td>
                        <td className="fmt-technical">{f.ext}</td>
                        <td className="num fmt-technical">{f.fps ?? ''}</td>
                        <td className="fmt-codec fmt-technical">
                          {[f.vcodec, f.acodec].filter(Boolean).join(' / ') || '—'}
                        </td>
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
        case 'converting':
          return 'Đang tối ưu để dễ phát…'
        case 'postprocessing':
          return 'Đang xử lý…'
        case 'preparing':
          return 'Đang chuẩn bị…'
        default:
          return 'Đang tải…'
      }
    case 'done':
      return 'Xong'
    case 'skipped':
      return 'Bỏ qua'
    case 'error':
      return 'Lỗi'
  }
}

function QueueRow({
  item,
  selKind,
  selHeight,
  folderMode,
  outputDir,
  onRemove,
  onPickFormat,
  onClearFormat,
  onGetSub
}: {
  item: QueueItem
  selKind: DownloadKind
  selHeight: number | null
  folderMode: FolderMode
  outputDir: string
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

        {folderHint && item.status !== 'downloading' && (
          <div className="qfolder muted small" title={folderHint}>
            📁 {folderHint}
          </div>
        )}

        {item.status === 'skipped' && (
          <div className="qwarn small">
            Video này đã có trong lịch sử tải — không ghi file mới. Tắt “Bỏ qua video đã tải trước”
            rồi tải lại nếu cần.
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
          {(item.status === 'done' || item.status === 'error') && item.result?.file && (
            <>
              {item.status === 'done' && (
                <button
                  className="ibtn"
                  title="Mở file"
                  onClick={() => window.api.openPath(item.result!.file!)}
                >
                  ▶
                </button>
              )}
              <button
                className="ibtn"
                title={item.status === 'error' ? 'Mở thư mục chứa file gốc' : 'Mở thư mục'}
                onClick={() => window.api.showItem(item.result!.file!)}
              >
                📂
              </button>
              {item.status === 'done' && (
                <button
                  className="ibtn"
                  title="Lấy phụ đề (Audio → Text)"
                  onClick={() => onGetSub(item.result!.file!)}
                >
                  📝
                </button>
              )}
            </>
          )}
          {item.status === 'skipped' && outputDir && (
            <button
              className="ibtn"
              title="Mở thư mục lưu"
              onClick={() => window.api.openPath(outputDir)}
            >
              📂
            </button>
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
