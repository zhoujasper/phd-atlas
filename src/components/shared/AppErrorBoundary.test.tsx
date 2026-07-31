import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenView(): never {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/ProfileScreen.js')
}

afterEach(() => {
  vi.restoreAllMocks()
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
})
