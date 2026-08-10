import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Normalized so \n markers keep matching a CRLF checkout on Windows.
const appSource = readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8').replace(/\r\n/gu, '\n')

function sourceBetween(startMarker: string, endMarker: string) {
  const start = appSource.indexOf(startMarker)
  const end = appSource.indexOf(endMarker, start + startMarker.length)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return appSource.slice(start, end)
}

describe('App account-session isolation contracts', () => {
  it('validates identity and generation before adding a refresh token to lineage', () => {
    const refreshAll = sourceBetween(
      'async function refreshAll(',
      'async function refreshSessionMetadata(',
    )
    const identityCheck = refreshAll.indexOf(
      'if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return',
    )
    const remember = refreshAll.indexOf('rememberSessionToken(requestToken)')

    expect(identityCheck).toBeGreaterThanOrEqual(0)
    expect(remember).toBeGreaterThan(identityCheck)
  })

  it('owns offline synchronization with a ref run id and generation-guarded finally', () => {
    const sync = sourceBetween(
      'async function syncOfflineQueue(',
      'async function retryOfflineConnection(',
    )

    expect(sync).toContain('offlineSyncRunRef.current')
    expect(sync).toContain('sessionEpoch: requestEpoch')
    expect(sync).toContain('const isCurrentRun = () =>')
    expect(sync).toContain('if (offlineSyncRunRef.current?.id === run.id)')
    expect(sync).not.toContain('||\n      syncingOffline')
  })

  it('clears notification, AI-key, Team, and offline-sync state at logout', () => {
    const clear = sourceBetween(
      'const clearSessionState = useCallback(',
      'const expireSession = useCallback(',
    )

    expect(clear).toContain('invalidateOfflineSync()')
    expect(clear).toContain('setAiKeys([])')
    expect(clear).toContain('setNotifications([])')
    expect(clear).toContain('setNotificationsLoading(false)')
    expect(clear).toContain('setUnreadNotificationCount(0)')
    expect(clear).toContain('setNotificationCenterOpen(false)')
    expect(clear).toContain('setTeamWorkspaces([])')
    expect(clear).toContain('setTeamApplications([])')
    expect(clear).toContain('setActiveTeamId(null)')
  })
})
