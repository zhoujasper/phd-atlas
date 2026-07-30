import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminLiveUptime } from './AdminLiveUptime'

let parentRenders = 0

function Harness({ initialSeconds = 65 }: { initialSeconds?: number }) {
  parentRenders += 1
  return (
    <AdminLiveUptime
      initialSeconds={initialSeconds}
      label="Uptime"
      tx={(_path, fallback) => {
        if (fallback === 'uptimeSeconds') return '{count}s'
        if (fallback === 'uptimeMinutes') return '{count}m {sec}s'
        if (fallback === 'uptimeHours') return '{count}h {min}m'
        if (fallback === 'uptimeDays') return '{count}d {hr}h'
        return fallback ?? ''
      }}
    />
  )
}

beforeEach(() => {
  parentRenders = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-28T10:00:00.000Z'))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AdminLiveUptime', () => {
  it('updates only its isolated counter instead of rerendering the Admin parent', async () => {
    render(<Harness />)
    expect(screen.getByText(/Uptime/).textContent).toContain('1m 5s')
    expect(parentRenders).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(screen.getByText(/Uptime/).textContent).toContain('1m 7s')
    expect(parentRenders).toBe(1)
  })

  it('reanchors when refreshed system information supplies a new uptime', async () => {
    const { rerender } = render(<Harness initialSeconds={10} />)
    expect(screen.getByText(/Uptime/).textContent).toContain('10s')

    rerender(<Harness initialSeconds={120} />)
    expect(screen.getByText(/Uptime/).textContent).toContain('2m 0s')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByText(/Uptime/).textContent).toContain('2m 1s')
  })
})
