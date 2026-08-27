import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const serviceWorkerMocks = vi.hoisted(() => ({
  prepare: vi.fn<() => Promise<boolean>>(),
  reload: vi.fn(),
  startChecks: vi.fn(() => vi.fn()),
}))

vi.mock('./safeReload', () => ({
  prepareForSafeReload: serviceWorkerMocks.prepare,
  dispatchSafeReloadBlocked: vi.fn(),
}))

vi.mock('./pageReload', () => ({
  reloadPage: serviceWorkerMocks.reload,
}))

vi.mock('./serviceWorkerUpdateChecks', () => ({
  startServiceWorkerUpdateChecks: serviceWorkerMocks.startChecks,
}))

import { activatePwaUpdate, disableServiceWorkerForDesktop, registerServiceWorker } from './serviceWorker'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('service worker update reload boundary', () => {
  it('re-announces an activated update after a blocked reload and lets the user retry', async () => {
    const postMessage = vi.fn()
    const registration = Object.assign(new EventTarget(), {
      waiting: { postMessage },
      installing: null,
      active: null,
      update: vi.fn().mockResolvedValue(undefined),
    }) as unknown as ServiceWorkerRegistration
    const container = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    }) as unknown as ServiceWorkerContainer
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container,
    })
    serviceWorkerMocks.prepare
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const updateReady = vi.fn()
    window.addEventListener('phd-atlas:pwa-update-ready', updateReady)

    registerServiceWorker()
    window.dispatchEvent(new Event('load'))
    await waitFor(() => expect(container.register).toHaveBeenCalledTimes(1))
    updateReady.mockClear()

    expect(activatePwaUpdate()).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    container.dispatchEvent(new Event('controllerchange'))

    await waitFor(() => expect(serviceWorkerMocks.prepare).toHaveBeenCalledTimes(1))
    expect(serviceWorkerMocks.reload).not.toHaveBeenCalled()
    expect(updateReady).toHaveBeenCalledTimes(1)

    expect(activatePwaUpdate()).toBe(true)
    await waitFor(() => expect(serviceWorkerMocks.reload).toHaveBeenCalledTimes(1))
    expect(serviceWorkerMocks.prepare).toHaveBeenCalledTimes(2)

    window.removeEventListener('phd-atlas:pwa-update-ready', updateReady)
  })

  it('unregisters existing workers when the desktop shell is active', async () => {
    const unregister = vi.fn().mockResolvedValue(true)
    const container = Object.assign(new EventTarget(), {
      controller: {},
      getRegistrations: vi.fn().mockResolvedValue([{ unregister }]),
      register: vi.fn(),
    })
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: container,
    })

    disableServiceWorkerForDesktop()
    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(1))
    expect(container.register).not.toHaveBeenCalled()
  })
})
