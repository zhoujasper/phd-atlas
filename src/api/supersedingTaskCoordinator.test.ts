import { describe, expect, it, vi } from 'vitest'
import { SupersedingTaskCoordinator } from './supersedingTaskCoordinator'

function abortableResult<T>(signal: AbortSignal, value: T) {
  return new Promise<T>((resolve, reject) => {
    const handle = window.setTimeout(() => resolve(value), 20)
    signal.addEventListener('abort', () => {
      window.clearTimeout(handle)
      reject(signal.reason)
    }, { once: true })
  })
}

describe('SupersedingTaskCoordinator', () => {
  it('shares an identical task within one scope', async () => {
    const coordinator = new SupersedingTaskCoordinator<'workspace'>()
    const execute = vi.fn(async () => 'workspace')

    const first = coordinator.run('workspace', 'account:team', execute)
    const second = coordinator.run('workspace', 'account:team', execute)

    expect(second).toBe(first)
    await expect(first).resolves.toBe('workspace')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('aborts the obsolete task when the key changes', async () => {
    const coordinator = new SupersedingTaskCoordinator<'workspace'>()
    const signals: AbortSignal[] = []
    const obsolete = coordinator.run('workspace', 'team-a', (signal) => {
      signals.push(signal)
      return abortableResult(signal, 'team-a')
    })
    const current = coordinator.run('workspace', 'team-b', (signal) => (
      abortableResult(signal, 'team-b')
    ))

    await expect(obsolete).rejects.toMatchObject({ name: 'AbortError' })
    await expect(current).resolves.toBe('team-b')
    expect(signals[0]?.aborted).toBe(true)
  })

  it('keeps independent scopes alive and can cancel all of them', async () => {
    const coordinator = new SupersedingTaskCoordinator<'all' | 'team'>()
    const signals = new Map<'all' | 'team', AbortSignal>()
    const all = coordinator.run('all', 'account', (signal) => {
      signals.set('all', signal)
      return abortableResult(signal, 'all')
    })
    const team = coordinator.run('team', 'team-a', (signal) => {
      signals.set('team', signal)
      return abortableResult(signal, 'team')
    })

    coordinator.cancel()

    await expect(all).rejects.toMatchObject({ name: 'AbortError' })
    await expect(team).rejects.toMatchObject({ name: 'AbortError' })
    expect(signals.get('all')?.aborted).toBe(true)
    expect(signals.get('team')?.aborted).toBe(true)
  })
})
