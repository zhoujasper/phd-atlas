import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorRecoveryDialog } from './ErrorRecoveryDialog'
import { I18nContext } from '../hooks/useI18n'

const mockTx = (key: string, fallback?: string) => fallback ?? key

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nContext.Provider value={{ tx: mockTx, lang: 'en', t: {}, format: (t) => t, ready: true }}>
    {children}
  </I18nContext.Provider>
)

describe('ErrorRecoveryDialog', () => {
  it('does not render when open is false', () => {
    render(
      <ErrorRecoveryDialog
        open={false}
        severity="recoverable"
      />,
      { wrapper }
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders dialog when open is true', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
      />,
      { wrapper }
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('displays default recoverable error config', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
      />,
      { wrapper }
    )

    expect(screen.getByRole('heading')).toHaveTextContent('Something went wrong')
    expect(screen.getByText(/check your connection/i)).toBeInTheDocument()
  })

  it('displays default conflict error config', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="conflict"
      />,
      { wrapper }
    )

    expect(screen.getByRole('heading')).toHaveTextContent('Changes conflict')
    expect(screen.getByText(/record changed while you were editing/i)).toBeInTheDocument()
    expect(screen.getByText(/copy your changes/i)).toBeInTheDocument()
  })

  it('displays default critical error config', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="critical"
      />,
      { wrapper }
    )

    expect(screen.getByRole('heading')).toHaveTextContent('This view could not be loaded')
    expect(screen.getByText(/reload the page/i)).toBeInTheDocument()
  })

  it('displays custom title and message when provided', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        title="Custom Error"
        message="This is a custom error message"
      />,
      { wrapper }
    )

    expect(screen.getByRole('heading')).toHaveTextContent('Custom Error')
    expect(screen.getByText('This is a custom error message')).toBeInTheDocument()
  })

  it('displays custom recovery steps', () => {
    const steps = ['Step one', 'Step two', 'Step three']

    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        title="Custom"
        message="Message"
        recoverySteps={steps}
      />,
      { wrapper }
    )

    steps.forEach(step => {
      expect(screen.getByText(step)).toBeInTheDocument()
    })
  })

  it('calls onRetry when retry button clicked', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()

    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        onRetry={onRetry}
      />,
      { wrapper }
    )

    const retryButton = screen.getByRole('button', { name: /retry/i })
    await user.click(retryButton)

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('calls onReload when reload button clicked', async () => {
    const onReload = vi.fn()
    const user = userEvent.setup()

    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        onReload={onReload}
      />,
      { wrapper }
    )

    const reloadButton = screen.getByRole('button', { name: /reload/i })
    await user.click(reloadButton)

    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when dismiss button clicked', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()

    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        onDismiss={onDismiss}
      />,
      { wrapper }
    )

    const dismissButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(dismissButton)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('shows loading state on retry button', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        onRetry={vi.fn()}
        loading={true}
      />,
      { wrapper }
    )

    const retryButton = screen.getByRole('button', { name: /retrying/i })
    expect(retryButton).toBeDisabled()
    expect(retryButton).toHaveAttribute('aria-busy', 'true')
  })

  it('does not show dismiss button for critical errors', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="critical"
        onDismiss={vi.fn()}
      />,
      { wrapper }
    )

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })

  it('shows close button for recoverable errors with dismiss handler', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        onDismiss={vi.fn()}
      />,
      { wrapper }
    )

    const closeButton = screen.getByRole('button', { name: /close/i })
    expect(closeButton).toBeInTheDocument()
  })

  it('does not show close button when no dismiss handler', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
      />,
      { wrapper }
    )

    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
  })

  it('shows only reload button when it is the primary action', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        onReload={vi.fn()}
      />,
      { wrapper }
    )

    const reloadButton = screen.getByRole('button', { name: /reload/i })
    expect(reloadButton).toHaveClass('primary-action')
  })

  it('shows reload as secondary when retry is present', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        onRetry={vi.fn()}
        onReload={vi.fn()}
      />,
      { wrapper }
    )

    const retryButton = screen.getByRole('button', { name: /retry/i })
    const reloadButton = screen.getByRole('button', { name: /reload/i })

    expect(retryButton).toHaveClass('primary-action')
    expect(reloadButton).toHaveClass('quiet-action')
  })

  it('applies correct severity CSS class', () => {
    const { rerender } = render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
      />,
      { wrapper }
    )

    expect(screen.getByRole('dialog').querySelector('.error-recovery-dialog')).toHaveClass('severity-recoverable')

    rerender(
      <I18nContext.Provider value={{ tx: mockTx, lang: 'en', t: {}, format: (t) => t, ready: true }}>
        <ErrorRecoveryDialog
          open={true}
          severity="conflict"
        />
      </I18nContext.Provider>
    )

    expect(screen.getByRole('dialog').querySelector('.error-recovery-dialog')).toHaveClass('severity-conflict')
  })

  it('does not render recovery steps when none provided', () => {
    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
      />,
      { wrapper }
    )

    expect(screen.queryByText('Next steps:')).not.toBeInTheDocument()
  })

  it('closes button calls onDismiss', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()

    render(
      <ErrorRecoveryDialog
        open={true}
        severity="recoverable"
        onDismiss={onDismiss}
      />,
      { wrapper }
    )

    const closeButton = screen.getByRole('button', { name: /close/i })
    await user.click(closeButton)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
