import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Normalized so \n markers keep matching a CRLF checkout on Windows.
const appSource = readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8').replace(/\r\n/gu, '\n')

/** Comments explain the invariant; only executable source may be asserted on. */
function withoutComments(source: string) {
  return source.replace(/^\s*\/\/.*$/gmu, '')
}

function sourceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('App mail-sync continuity contracts', () => {
  it('does not give the watcher-owned polling signal to the terminal application refresh', () => {
    const settleMailSyncJob = sourceBetween(
      appSource,
      'async function settleMailSyncJob(',
      'async function pollMailSyncJob(',
    )
    const terminalBranch = sourceBetween(
      settleMailSyncJob,
      "if (!['succeeded', 'failed'].includes(job.status)) return",
      "if (job.status === 'failed') {",
    )

    expect(terminalBranch).toContain('await refreshApplicationsAndSessionMetadata(committedSession)')
    expect(terminalBranch).not.toContain('refreshApplicationsAndSessionMetadata(committedSession, {')
    expect(withoutComments(terminalBranch)).not.toContain('signal')
  })

  it('reports a finished sync only for a job this tab watched running', () => {
    const settleMailSyncJob = sourceBetween(
      appSource,
      'async function settleMailSyncJob(',
      'async function pollMailSyncJob(',
    )

    // Every /api/auth/me body carries the last finished job, so the realtime
    // session refresh that now settles jobs would otherwise toast a stale
    // result on each login.
    expect(settleMailSyncJob).toContain('if (watchedMailSyncJobIdRef.current !== job.id) return')
    expect(settleMailSyncJob).toContain('watchedMailSyncJobIdRef.current = null')
  })
})
