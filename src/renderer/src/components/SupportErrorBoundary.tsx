import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
  copied: boolean
  copyError: string | null
}

export default class SupportErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, copied: false, copyError: null }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      window.api.reportRendererIssue({
        kind: 'react',
        time: new Date().toISOString(),
        message: error.message || 'React render error',
        stack: error.stack || null,
        componentStack: info.componentStack || null
      })
    } catch {
      // Preload co the la nguyen nhan loi; fallback van phai render duoc.
    }
  }

  private copyReport = async (): Promise<void> => {
    try {
      const report = await window.api.createSupportReport()
      await navigator.clipboard.writeText(report.text)
      this.setState({ copied: true, copyError: null })
    } catch {
      this.setState({ copied: false, copyError: 'Không thể sao chép báo cáo. Hãy thử tải lại giao diện.' })
    }
  }

  render(): JSX.Element | ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className="renderer-fallback" role="alert">
        <div className="renderer-fallback-card">
          <span className="renderer-fallback-mark" aria-hidden="true">!</span>
          <div>
            <h1>Giao diện đã dừng</h1>
            <p>
              T-blao đã lưu thông tin cần thiết để kiểm tra lỗi. Báo cáo không chứa cookie,
              khóa API hoặc mật khẩu proxy.
            </p>
          </div>
          <div className="renderer-fallback-actions">
            <button className="btn primary" onClick={() => void this.copyReport()}>
              {this.state.copied ? '✓ Đã sao chép báo cáo' : 'Sao chép báo cáo chẩn đoán'}
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Tải lại giao diện
            </button>
          </div>
          {this.state.copyError && <span className="dy-err small">{this.state.copyError}</span>}
        </div>
      </main>
    )
  }
}
