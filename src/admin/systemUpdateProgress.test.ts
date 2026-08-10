import { describe, expect, it } from 'vitest'
import type { SystemUpdateStatus } from '../api/phdApi'
import {
  advanceSystemUpdateTimeline,
  getSystemUpdateDownloadProgress,
  getSystemUpdateTimelineCandidate,
  INITIAL_SYSTEM_UPDATE_TIMELINE,
} from './systemUpdateProgress'

function status(
  phase: SystemUpdateStatus['phase'],
  overrides: Partial<SystemUpdateStatus> = {},
): SystemUpdateStatus {
  return {
    phase,
    jobId: 'job-1',
    source: 'github',
    bytes: 0,
    total: 1_000,
    targetVersion: '0.1.0-beta.8',
    errorCode: null,
    requestedAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    currentVersion: '0.1.0-beta.7',
    operationInFlight: true,
    restartPending: false,
    ...overrides,
  }
}

describe('system update progress presentation', () => {
  it('uses the server byte ratio only while the package is downloading', () => {
    expect(getSystemUpdateDownloadProgress(status('downloading', { bytes: 425, total: 1_000 }))).toBe(42.5)
    expect(getSystemUpdateDownloadProgress(status('downloading', { bytes: 1_200, total: 1_000 }))).toBe(100)
    expect(getSystemUpdateDownloadProgress(status('downloading', { bytes: -10, total: 1_000 }))).toBe(0)
    expect(getSystemUpdateDownloadProgress(status('downloading', { total: 0 }))).toBeNull()
    expect(getSystemUpdateDownloadProgress(status('verifying', { bytes: 1_000, total: 1_000 }))).toBeNull()
  })

  it('keeps every normal stage at or beyond the maximum preceding stage', () => {
    const candidates = [
      getSystemUpdateTimelineCandidate(status('resolving')),
      getSystemUpdateTimelineCandidate(status('probing')),
      getSystemUpdateTimelineCandidate(status('downloading', { bytes: 0 })),
      getSystemUpdateTimelineCandidate(status('downloading', { bytes: 1_000 })),
      getSystemUpdateTimelineCandidate(status('verifying')),
      getSystemUpdateTimelineCandidate(status('preparing')),
      getSystemUpdateTimelineCandidate(status('installing')),
      getSystemUpdateTimelineCandidate(status('restarting')),
      getSystemUpdateTimelineCandidate(status('ready')),
    ]

    expect(candidates.every((value) => value !== null)).toBe(true)
    expect(candidates).toEqual([...candidates].sort((left, right) => (left ?? 0) - (right ?? 0)))
  })

  it('does not rewind the overall rail when a source falls back to a fresh download', () => {
    const resolving = advanceSystemUpdateTimeline(INITIAL_SYSTEM_UPDATE_TIMELINE, status('resolving'))
    const downloadedDelta = advanceSystemUpdateTimeline(
      resolving,
      status('downloading', { bytes: 1_000, total: 1_000, source: 'delta' }),
    )
    const probingFallback = advanceSystemUpdateTimeline(downloadedDelta, status('probing', { source: 'github' }))
    const fullDownloadStart = advanceSystemUpdateTimeline(
      probingFallback,
      status('downloading', { bytes: 0, total: 4_000, source: 'github' }),
    )

    expect(probingFallback.progress).toBe(downloadedDelta.progress)
    expect(fullDownloadStart.progress).toBe(downloadedDelta.progress)
    expect(getSystemUpdateDownloadProgress(status('downloading', { bytes: 0, total: 4_000 }))).toBe(0)
  })

  it.each(['error', 'timeout'] as const)('holds the last meaningful stage on %s', (phase) => {
    const installing = advanceSystemUpdateTimeline(
      INITIAL_SYSTEM_UPDATE_TIMELINE,
      status('installing'),
    )
    const failed = advanceSystemUpdateTimeline(
      installing,
      status(phase, { operationInFlight: false, errorCode: 'UPDATE_FAILED' }),
    )

    expect(failed.progress).toBe(installing.progress)
    expect(failed.stepIndex).toBe(installing.stepIndex)
    expect(failed.phase).toBe(phase)
  })

  it('starts a deliberate retry from its first stage even for the same version', () => {
    const ready = advanceSystemUpdateTimeline(
      INITIAL_SYSTEM_UPDATE_TIMELINE,
      status('ready', { operationInFlight: false }),
    )
    const retry = advanceSystemUpdateTimeline(ready, status('resolving', { jobId: 'job-2' }))

    expect(ready.progress).toBe(100)
    expect(retry.progress).toBe(getSystemUpdateTimelineCandidate(status('resolving')))
    expect(retry.stepIndex).toBe(0)
  })
})
