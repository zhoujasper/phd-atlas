import { describe, expect, it, vi } from 'vitest'
import { SchoolLogoRequestCoordinator } from './schoolLogoRequestCoordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('SchoolLogoRequestCoordinator', () => {
  it('shares one in-flight request between the list and Dossier owners', async () => {
    const coordinator = new SchoolLogoRequestCoordinator()
    const result = deferred<boolean>()
    const start = vi.fn(() => result.promise)

    const listAttempt = coordinator.run('app::auto::school', start, { retainSettledResult: true })
    const dossierAttempt = coordinator.run('app::auto::school', start, { retainSettledResult: true })
    expect(start).toHaveBeenCalledTimes(0)
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(1)

    result.resolve(false)
    await expect(Promise.all([listAttempt, dossierAttempt])).resolves.toEqual([false, false])
    await expect(coordinator.run('app::auto::school', start, {
      retainSettledResult: true,
    })).resolves.toBe(false)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('does not retain failures and keeps explicit refreshes repeatable', async () => {
    const coordinator = new SchoolLogoRequestCoordinator()
    const failed = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true)

    await expect(coordinator.run('auto', failed, { retainSettledResult: true })).rejects.toThrow('offline')
    await expect(coordinator.run('auto', failed, { retainSettledResult: true })).resolves.toBe(true)
    expect(failed).toHaveBeenCalledTimes(2)

    const refresh = vi.fn().mockResolvedValue(true)
    await coordinator.run('refresh', refresh)
    await coordinator.run('refresh', refresh)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('bounds retained automatic results', async () => {
    const coordinator = new SchoolLogoRequestCoordinator(2)
    const start = vi.fn().mockResolvedValue(false)

    await coordinator.run('first', start, { retainSettledResult: true })
    await coordinator.run('second', start, { retainSettledResult: true })
    await coordinator.run('third', start, { retainSettledResult: true })
    await coordinator.run('first', start, { retainSettledResult: true })

    expect(start).toHaveBeenCalledTimes(4)
  })
})
