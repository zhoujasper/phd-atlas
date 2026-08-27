import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { phdApi } from './api/phdApi'
import { resetConnectivityForTests } from './connectivity'
import { setDesktopRuntime } from './desktopRuntime'

const webauthn = vi.hoisted(() => ({
  startAuthentication: vi.fn(async () => ({ id: 'credential-test' })),
}))

vi.mock('@simplewebauthn/browser', () => webauthn)

vi.mock('./components/screens/AuthScreen', async () => {
  const { createElement } = await import('react')
  return {
    AuthScreen: () => createElement('section', { 'aria-label': 'Sign in' }, 'Website login'),
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('desktop app opens without website login', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('phd-atlas-onboarding-done', '1')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    resetConnectivityForTests()
    setDesktopRuntime(null)
    window.phdAtlasDesktop = { enabled: true }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    setDesktopRuntime(null)
    delete window.phdAtlasDesktop
  })

  it('keeps the local workspace boot instead of the email/password screen when the runtime route is missing', async () => {
    const held = deferred<never>()
    const createSession = vi.spyOn(phdApi, 'createDesktopSession').mockReturnValue(held.promise)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/desktop/runtime')) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(JSON.stringify({ ok: true, data: null, requestId: 'req_test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    render(<App />)

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled()
    })
    expect(screen.queryByRole('region', { name: /sign in/i })).not.toBeInTheDocument()
    expect(document.querySelector('.launch-screen')).not.toBeNull()
  })
})
