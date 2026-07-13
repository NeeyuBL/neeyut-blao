import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Downloader from './components/Downloader'
import Douyin from './components/Douyin'
import License from './components/License'
import Logs from './components/Logs'

type Stage = 'checking' | 'setup' | 'ready'
type TabKey = 'download' | 'douyin' | 'logs' | 'license'

interface Tab {
  key: TabKey
  label: string
  icon: string
  title: string
  subtitle: string
}

// Tab tinh nang chinh (o tren). Them tinh nang moi = them 1 entry vao day.
const TABS: Tab[] = [
  {
    key: 'download',
    label: 'Tải xuống',
    icon: '⬇',
    title: 'Tải xuống',
    subtitle: 'Video & âm thanh đa nền tảng'
  },
  {
    key: 'douyin',
    label: 'Douyin',
    icon: '🎬',
    title: 'Tải Douyin',
    subtitle: 'Video & kênh Douyin (không watermark)'
  }
]

// Muc phu o day sidebar
const BOTTOM_TABS: Tab[] = [
  {
    key: 'logs',
    label: 'Nhật ký',
    icon: '📋',
    title: 'Nhật ký hoạt động',
    subtitle: 'Theo dõi hoạt động & lỗi phát sinh'
  },
  {
    key: 'license',
    label: 'Giấy phép',
    icon: '📜',
    title: 'Giấy phép & Điều khoản',
    subtitle: 'Bản quyền và trách nhiệm sử dụng'
  }
]

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('checking')
  const [tab, setTab] = useState<TabKey>('download')
  const [version, setVersion] = useState('')
  // Thu muc luu dung CHUNG cho moi tab; nho qua cac lan mo app
  const [outputDir, setOutputDir] = useState('')

  const updateOutputDir = (d: string): void => {
    setOutputDir(d)
    try {
      localStorage.setItem('tblao.outputDir', d)
    } catch {
      /* bo qua */
    }
  }

  const check = async (): Promise<void> => {
    setStage('checking')
    const status = await window.api.checkDeps()
    setStage(status.ytdlp && status.ffmpeg ? 'ready' : 'setup')
  }

  useEffect(() => {
    void check()
    void window.api.appVersion().then(setVersion)
    const saved = localStorage.getItem('tblao.outputDir')
    if (saved) setOutputDir(saved)
    else void window.api.downloadsDir().then(setOutputDir)
  }, [])

  if (stage === 'checking') {
    return (
      <div className="boot">
        <div className="center">
          <div className="spinner" />
          <p>Đang kiểm tra môi trường…</p>
        </div>
      </div>
    )
  }

  if (stage === 'setup') {
    return (
      <div className="boot">
        <SetupScreen onDone={() => setStage('ready')} />
      </div>
    )
  }

  const active = [...TABS, ...BOTTOM_TABS].find((t) => t.key === tab) ?? TABS[0]

  const renderTab = (t: Tab): JSX.Element => (
    <button
      key={t.key}
      className={`side-item ${t.key === tab ? 'active' : ''}`}
      onClick={() => setTab(t.key)}
    >
      <span className="side-ico">{t.icon}</span>
      <span>{t.label}</span>
    </button>
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="side-logo">T-blao</span>
        </div>
        <nav className="side-nav">{TABS.map(renderTab)}</nav>
        <div className="side-hint muted small">Sắp có thêm tính năng…</div>

        <div className="side-bottom">
          {BOTTOM_TABS.map(renderTab)}
          <div className="side-version">Phiên bản {version || '…'}</div>
        </div>
      </aside>

      <main className="content">
        <header className="content-head">
          <div>
            <h1 className="content-title">{active.title}</h1>
            <p className="content-sub muted">{active.subtitle}</p>
          </div>
        </header>
        <div className="content-body">
          {tab === 'download' && (
            <Downloader outputDir={outputDir} setOutputDir={updateOutputDir} />
          )}
          {tab === 'douyin' && <Douyin outputDir={outputDir} setOutputDir={updateOutputDir} />}
          {tab === 'logs' && <Logs />}
          {tab === 'license' && <License />}
        </div>
      </main>
    </div>
  )
}
