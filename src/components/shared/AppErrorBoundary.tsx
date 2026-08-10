import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { GraduationCap, RefreshCw } from 'lucide-react'
import { StandaloneProviders } from '../StandaloneProviders'
import { useI18n } from '../hooks/useI18n'
import { reloadPage } from '../../pageReload'
import { prepareForSafeReload } from '../../safeReload'

function AppRecoveryScreen({ onReload }: { onReload: () => void }) {
  const { tx } = useI18n()

  return (
    <main className="app-recovery-screen" role="alert">
      <span className="app-recovery-mark" aria-hidden="true">
        <GraduationCap size={24} strokeWidth={2} />
      </span>
      <p className="app-recovery-brand">{tx('appRecovery.brand')}</p>
      <h1>{tx('appRecovery.title')}</h1>
      <p>{tx('appRecovery.description')}</p>
      <button type="button" onClick={onReload}>
        <RefreshCw size={16} aria-hidden="true" />
        <span>{tx('appRecovery.reload')}</span>
      </button>
    </main>
  )
}

type AppErrorBoundaryProps = {
  children: ReactNode
  onReload?: () => void | Promise<void>
}

type AppErrorBoundaryState = {
  failed: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false }
  private reloadPending = false

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[PhD Atlas] The application render tree was recovered.', error, info)
  }

  private reload = async () => {
    if (this.reloadPending) return
    this.reloadPending = true
    if (this.props.onReload) {
      try {
        await this.props.onReload()
      } finally {
        this.reloadPending = false
      }
      return
    }
    try {
      if (await prepareForSafeReload({ reason: 'error-recovery' })) {
        reloadPage()
        return
      }
    } catch (error) {
      this.reloadPending = false
      throw error
    }
    this.reloadPending = false
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <StandaloneProviders>
        <AppRecoveryScreen onReload={this.reload} />
      </StandaloneProviders>
    )
  }
}
