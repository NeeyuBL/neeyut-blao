import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import SupportErrorBoundary from './components/SupportErrorBoundary'

function reportRendererIssue(
  kind: 'error' | 'unhandled-rejection',
  message: string,
  stack?: string | null
): void {
  try {
    window.api.reportRendererIssue({
      kind,
      time: new Date().toISOString(),
      message: message || 'Lỗi giao diện không có thông báo.',
      stack: stack || null
    })
  } catch {
    // Preload chua san sang: khong de reporter tao them loi renderer.
  }
}

window.addEventListener('error', (event) => {
  reportRendererIssue('error', event.message, event.error instanceof Error ? event.error.stack : null)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  reportRendererIssue(
    'unhandled-rejection',
    reason instanceof Error ? reason.message : String(reason ?? 'Promise bị từ chối.'),
    reason instanceof Error ? reason.stack : null
  )
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SupportErrorBoundary>
      <App />
    </SupportErrorBoundary>
  </React.StrictMode>
)
