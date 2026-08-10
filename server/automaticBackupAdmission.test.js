import { describe, expect, it, vi } from 'vitest'
import { createMemoryPressureGuard, MEMORY_WORK_CLASS } from './memoryPressure.js'
import { runAutomaticBackupPassWithMemoryAdmission } from './automaticBackupAdmission.js'

function guardWithDecisions(decisions, events = []) {
  let index = 0
  return {
    admit: vi.fn((workClass) => {
      events.push(`admit:${workClass}`)
      const decision = decisions[Math.min(index, decisions.length - 1)]
      index += 1
      return decision
    }),
  }
}

function allowed(level = 'normal') {
  return { allowed: true, level, retryAfterMs: null }
}

function refused(level = 'soft', retryAfterMs = 1_250) {
  return { allowed: false, level, retryAfterMs }
}

describe('runAutomaticBackupPassWithMemoryAdmission', () => {
  it('admits immediately before each due backup and preserves application-then-workspace order', async () => {
    const events = []
    const guard = guardWithDecisions([allowed()], events)

    const result = await runAutomaticBackupPassWithMemoryAdmission({
      memoryPressureGuard: guard,
      applicationCandidates: [
        { id: 'not-due', due: false },
        { id: 'app-a', due: true },
        { id: 'app-b', due: true },
      ],
      prepareApplicationBackup: (candidate) => {
        events.push(`prepare:${candidate.id}`)
        return candidate.due ? candidate : null
      },
      createApplicationBackup: async (candidate) => {
        events.push(`create:${candidate.id}`)
        return { applicationId: candidate.id }
      },
      prepareWorkspaceBackup: async () => {
        events.push('prepare:workspace')
        return { id: 'workspace' }
      },
      createWorkspaceBackup: async (candidate) => {
        events.push(`create:${candidate.id}`)
        return { fileName: 'workspace.json' }
      },
    })

    expect(result).toEqual({
      applicationBackups: [
        { applicationId: 'app-a' },
        { applicationId: 'app-b' },
      ],
      workspaceBackup: { fileName: 'workspace.json' },
      completed: true,
      deferred: false,
      deferredKind: null,
      retryAfterMs: null,
      pressureLevel: null,
    })
    expect(guard.admit).toHaveBeenCalledTimes(3)
    expect(guard.admit).toHaveBeenCalledWith(MEMORY_WORK_CLASS.HEAVY)
    expect(events).toEqual([
      'prepare:not-due',
      'prepare:app-a',
      'admit:heavy',
      'create:app-a',
      'prepare:app-b',
      'admit:heavy',
      'create:app-b',
      'prepare:workspace',
      'admit:heavy',
      'create:workspace',
    ])
  })

  it('safely defers the current and remaining due work after a normal-to-soft transition', async () => {
    const mebibyte = 1024 * 1024
    let rssBytes = 200 * mebibyte
    const state = {
      completed: new Set(),
      workspaceCompleted: false,
    }
    const created = []
    const candidates = ['app-a', 'app-b', 'app-c'].map((id) => ({ id }))

    const runPass = (memoryPressureGuard) => runAutomaticBackupPassWithMemoryAdmission({
      memoryPressureGuard,
      applicationCandidates: candidates,
      prepareApplicationBackup: (candidate) => (
        state.completed.has(candidate.id) ? null : candidate
      ),
      createApplicationBackup: async (candidate) => {
        created.push(candidate.id)
        state.completed.add(candidate.id)
        if (candidate.id === 'app-a') rssBytes = 400 * mebibyte
        return { applicationId: candidate.id }
      },
      prepareWorkspaceBackup: () => (
        state.workspaceCompleted ? null : { id: 'workspace' }
      ),
      createWorkspaceBackup: async () => {
        created.push('workspace')
        state.workspaceCompleted = true
        return { fileName: 'workspace.json' }
      },
    })

    const firstGuard = createMemoryPressureGuard({
      budgetBytes: 512 * mebibyte,
      readRssBytes: () => rssBytes,
      retryAfterMs: 2_400,
    })
    const first = await runPass(firstGuard)

    expect(first).toEqual({
      applicationBackups: [{ applicationId: 'app-a' }],
      workspaceBackup: null,
      completed: false,
      deferred: true,
      deferredKind: 'application',
      retryAfterMs: 2_400,
      pressureLevel: 'soft',
    })
    expect(created).toEqual(['app-a'])
    expect([...state.completed]).toEqual(['app-a'])
    expect(state.workspaceCompleted).toBe(false)
    expect(firstGuard.snapshot()).toMatchObject({
      level: 'soft',
      counters: {
        admitted: 1,
        rejected: 1,
        softRejections: 1,
      },
    })

    rssBytes = 200 * mebibyte
    const secondGuard = guardWithDecisions([allowed()])
    const second = await runPass(secondGuard)

    expect(second.completed).toBe(true)
    expect(second.deferred).toBe(false)
    expect(second.applicationBackups).toEqual([
      { applicationId: 'app-b' },
      { applicationId: 'app-c' },
    ])
    expect(second.workspaceBackup).toEqual({ fileName: 'workspace.json' })
    expect(created).toEqual(['app-a', 'app-b', 'app-c', 'workspace'])
    expect([...state.completed]).toEqual(['app-a', 'app-b', 'app-c'])
    expect(state.workspaceCompleted).toBe(true)
  })

  it('commits the application prefix but leaves a refused workspace due for the next pass', async () => {
    const events = []
    let appDue = true
    let workspaceDue = true
    const runPass = (memoryPressureGuard) => runAutomaticBackupPassWithMemoryAdmission({
      memoryPressureGuard,
      applicationCandidates: [{ id: 'app-a' }],
      prepareApplicationBackup: (candidate) => (appDue ? candidate : null),
      createApplicationBackup: async (candidate) => {
        events.push(`create:${candidate.id}`)
        appDue = false
        return { applicationId: candidate.id }
      },
      prepareWorkspaceBackup: () => (workspaceDue ? { id: 'workspace' } : null),
      createWorkspaceBackup: async (candidate) => {
        events.push(`create:${candidate.id}`)
        workspaceDue = false
        return { fileName: 'workspace.json' }
      },
    })

    const first = await runPass(guardWithDecisions([allowed(), refused('hard')]))

    expect(first.applicationBackups).toEqual([{ applicationId: 'app-a' }])
    expect(first.workspaceBackup).toBeNull()
    expect(first.completed).toBe(false)
    expect(first.deferredKind).toBe('workspace')
    expect(events).toEqual(['create:app-a'])
    expect(appDue).toBe(false)
    expect(workspaceDue).toBe(true)

    const second = await runPass(guardWithDecisions([allowed()]))
    expect(second.applicationBackups).toEqual([])
    expect(second.workspaceBackup).toEqual({ fileName: 'workspace.json' })
    expect(second.completed).toBe(true)
    expect(events).toEqual(['create:app-a', 'create:workspace'])
    expect(workspaceDue).toBe(false)
  })

  it('does not double-reserve a workspace archive that owns phase-specific admission', async () => {
    const ledger = {
      acquire: vi.fn(() => ({
        allowed: false,
        decision: refused('soft', 4_000),
      })),
    }
    const created = vi.fn(async () => ({ fileName: 'workspace.tar.gz' }))

    const result = await runAutomaticBackupPassWithMemoryAdmission({
      memoryPressureGuard: guardWithDecisions([allowed()]),
      memoryReservationLedger: ledger,
      applicationCandidates: [],
      prepareApplicationBackup: (candidate) => candidate,
      createApplicationBackup: async () => null,
      prepareWorkspaceBackup: () => ({ id: 'workspace' }),
      createWorkspaceBackup: created,
      workspaceReservationBytes: () => 512 * 1024 * 1024,
      workspaceOwnsMemoryAdmission: true,
    })

    expect(ledger.acquire).not.toHaveBeenCalled()
    expect(created).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      completed: true,
      deferred: false,
      workspaceBackup: { fileName: 'workspace.tar.gz' },
    })
  })

  it('enforces the per-pass cap when created backups are deliberately not retained in memory', async () => {
    const created = []
    const committed = []

    const result = await runAutomaticBackupPassWithMemoryAdmission({
      memoryPressureGuard: guardWithDecisions([allowed()]),
      applicationCandidates: Array.from({ length: 20 }, (_, index) => ({ id: `app-${index}` })),
      prepareApplicationBackup: (candidate) => candidate,
      createApplicationBackup: async (candidate) => {
        created.push(candidate.id)
        return { applicationId: candidate.id }
      },
      onApplicationBackup: async (backup) => committed.push(backup.applicationId),
      collectApplicationBackups: false,
      maxApplicationBackups: 3,
      prepareWorkspaceBackup: () => null,
      createWorkspaceBackup: async () => null,
    })

    expect(created).toEqual(['app-0', 'app-1', 'app-2'])
    expect(committed).toEqual(created)
    expect(result.applicationBackups).toEqual([])
    expect(result).toMatchObject({ completed: true, deferred: false })
  })
})
