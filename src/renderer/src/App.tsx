import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Downloader from './components/Downloader'

type Stage = 'checking' | 'setup' | 'ready'
type TabKey = 'download'

interface Tab {
  key: TabKey
  label: string
  icon: string
  title: string
  subtitle: string
}

// Danh sach tab o sidebar. Them tinh nang moi = them 1 entry vao day
// (kem 1 nhanh render trong <content-body> ben duoi).
const TABS: Tab[] = [
  {
    key: 'download',
    label: 'Tai xuong',
    icon: '⬇',
    title: 'Tai xuong',
    subtitle: 'Video & audio da nen tang'
  }
]

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('checking')
  const [tab, setTab] = useState<TabKey>('download')

  const check = async (): Promise<void> => {
    setStage('checking')
    const status = await window.api.checkDeps()
    setStage(status.ytdlp && status.ffmpeg ? 'ready' : 'setup')
  }

  useEffect(() => {
    void check()
  }, [])

  if (stage === 'checking') {
    return (
      <div className="boot">
        <div className="center">
          <div className="spinner" />
          <p>Dang kiem tra moi truong...</p>
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

  const active = TABS.find((t) => t.key === tab) ?? TABS[0]

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="side-logo">T-blao</span>
        </div>
        <nav className="side-nav">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`side-item ${t.key === tab ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="side-ico">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot muted small">Sap co them tinh nang…</div>
      </aside>

      <main className="content">
        <header className="content-head">
          <div>
            <h1 className="content-title">{active.title}</h1>
            <p className="content-sub muted">{active.subtitle}</p>
          </div>
        </header>
        <div className="content-body">{tab === 'download' && <Downloader />}</div>
      </main>
    </div>
  )
}
