import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const recoveryMocks = vi.hoisted(() => ({
  prepare: vi.fn<() => Promise<boolean>>(),
  reload: vi.fn(),
}))

vi.mock('../../safeReload', () => ({
  prepareForSafeReload: recoveryMocks.prepare,
}))

vi.mock('../../pageReload', () => ({
  reloadPage: recoveryMocks.reload,
}))

import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenView(): never {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/ProfileScreen.js')
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  recoveryMocks.prepare.mockReset()
  recoveryMocks.reload.mockReset()
})

describe('AppErrorBoundary', () => {
  it('keeps a recoverable application surface instead of unmounting to a blank page', () => {
    const onReload = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary onReload={onReload}>
        <BrokenView />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /could not be loaded/i })).toBeInTheDocument()
    const reload = screen.getByRole('button', { name: /reload phd atlas/i })
    fireEvent.click(reload)
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('keeps the recovery screen mounted when safe reload is blocked', async () => {
    recoveryMocks.prepare.mockResolvedValue(false)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary>
        <BrokenView />
      </AppErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /reload phd atlas/i }))

    await waitFor(() => expect(recoveryMocks.prepare).toHaveBeenCalledWith({ reason: 'error-recovery' }))
    expect(recoveryMocks.reload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    recoveryMocks.prepare.mockResolvedValue(true)
    fireEvent.click(screen.getByRole('button', { name: /reload phd atlas/i }))
    await waitFor(() => expect(recoveryMocks.reload).toHaveBeenCalledTimes(1))
  })

  it('uses the default browser reload only after safe preparation succeeds', async () => {
    recoveryMocks.prepare.mockResolvedValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary>
        <BrokenView />
      </AppErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /reload phd atlas/i }))

    await waitFor(() => expect(recoveryMocks.reload).toHaveBeenCalledTimes(1))
  })
})
