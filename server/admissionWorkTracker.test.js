import { describe, expect, it, vi } from 'vitest'
import { createAdmissionWorkTracker } from './admissionWorkTracker.js'

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('async admission work ownership', () => {
  it('keeps a disconnected transport lease until handler work settles', async () => {
    const release = vi.fn()
    const work = deferred()
    const tracker = createAdmissionWorkTracker({ release })
    tracker.track(work.promise)
    tracker.finishDispatch()
    tracker.settleTransport()

    expect(tracker.snapshot()).toMatchObject({ pending: 1, released: false })
    expect(release).not.toHaveBeenCalled()
    work.resolve()
    await work.promise
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(tracker.snapshot()).toMatchObject({ pending: 0, released: true })
  })

  it('also waits for transport settlement after work completes', async () => {
    const release = vi.fn()
    const tracker = createAdmissionWorkTracker({ release })
    tracker.track(Promise.resolve())
    tracker.finishDispatch()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
    tracker.settleTransport()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases middleware-only responses after dispatch and transport settle', () => {
    const release = vi.fn()
    const tracker = createAdmissionWorkTracker({ release })
    tracker.settleTransport()
    expect(release).not.toHaveBeenCalled()
    tracker.finishDispatch()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
