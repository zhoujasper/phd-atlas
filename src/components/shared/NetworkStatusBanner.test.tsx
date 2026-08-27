import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NetworkStatusBanner } from './NetworkStatusBanner'

describe('NetworkStatusBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders offline status when offline', () => {
    render(<NetworkStatusBanner online={false} />)
    expect(screen.getByRole('status')).toHaveTextContent("You're offline")
  })

  it('renders reconnecting status', () => {
    render(<NetworkStatusBanner online={false} reconnecting={true} />)
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…')
  })

  it('renders online status and auto-hides', () => {
    const { rerender } = render(<NetworkStatusBanner online={false} />)

    rerender(<NetworkStatusBanner online={true} />)
    expect(screen.getByRole('status')).toHaveTextContent('Back online')

    // Fast-forward past hide timer
    act(() => vi.advanceTimersByTime(1200))
    expect(screen.getByRole('status')).toHaveClass('hiding')

    // Fast-forward past unmount timer
    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows retry button when offline and handler provided', () => {
    const onRetry = vi.fn()
    render(<NetworkStatusBanner online={false} onRetry={onRetry} />)

    const retryButton = screen.getByRole('button', { name: /retry/i })
    expect(retryButton).toBeInTheDocument()
  })

  it('calls retry handler when retry button clicked', () => {
    const onRetry = vi.fn()

    render(<NetworkStatusBanner online={false} onRetry={onRetry} />)

    const retryButton = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryButton)

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not render when initially online', () => {
    render(<NetworkStatusBanner online={true} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows banner immediately when going offline', () => {
    const { rerender } = render(<NetworkStatusBanner online={true} />)

    rerender(<NetworkStatusBanner online={false} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveClass('hiding')
  })

  it('cancels hide timer when going offline again', () => {
    const { rerender } = render(<NetworkStatusBanner online={false} />)

    // Go online
    rerender(<NetworkStatusBanner online={true} />)
    expect(screen.getByRole('status')).toHaveTextContent('Back online')

    // Go offline before hide completes
    vi.advanceTimersByTime(500)
    rerender(<NetworkStatusBanner online={false} />)

    expect(screen.getByRole('status')).toHaveTextContent("You're offline")
    expect(screen.getByRole('status')).not.toHaveClass('hiding')
  })

  it('does not show retry button when reconnecting', () => {
    const onRetry = vi.fn()
    render(<NetworkStatusBanner online={false} reconnecting={true} onRetry={onRetry} />)

    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('does not show retry button when online', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<NetworkStatusBanner online={false} onRetry={onRetry} />)

    rerender(<NetworkStatusBanner online={true} onRetry={onRetry} />)

    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('applies correct CSS classes for each status', () => {
    const { rerender } = render(<NetworkStatusBanner online={false} />)
    expect(screen.getByRole('status')).toHaveClass('network-status-banner', 'offline')

    rerender(<NetworkStatusBanner online={false} reconnecting={true} />)
    expect(screen.getByRole('status')).toHaveClass('network-status-banner', 'reconnecting')

    rerender(<NetworkStatusBanner online={true} />)
    expect(screen.getByRole('status')).toHaveClass('network-status-banner', 'online')
  })

  it('maintains visibility when transitioning from offline to reconnecting', () => {
    const { rerender } = render(<NetworkStatusBanner online={false} />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(<NetworkStatusBanner online={false} reconnecting={true} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveClass('hiding')
  })
})
