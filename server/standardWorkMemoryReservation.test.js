import { describe, expect, it } from 'vitest'
import {
  standardWorkMemoryReservationBytes,
  WORKSPACE_STREAM_FINALIZATION_HYDRATION_SELECTOR,
  WORKSPACE_STREAM_FINALIZATION_MAX_BYTES,
} from './index.js'
import { focusedApplicationReadReservationBytes } from './storage.js'

describe('standard-work memory reservations', () => {
  it('uses the bounded focused-session allowance for auth/me', () => {
    expect(standardWorkMemoryReservationBytes('GET', '/api/auth/me')).toBe(1024 * 1024)
    expect(standardWorkMemoryReservationBytes('GET', '/api/auth/me?refresh=1')).toBe(1024 * 1024)
    expect(standardWorkMemoryReservationBytes('HEAD', '/api/auth/me/')).toBe(1024 * 1024)
  })

  it('keeps collection, generic safe, unsafe, and deeper auth routes distinct', () => {
    expect(standardWorkMemoryReservationBytes('GET', '/api/applications')).toBe(512 * 1024)
    expect(standardWorkMemoryReservationBytes('GET', '/api/applications/app_1')).toBe(512 * 1024)
    expect(standardWorkMemoryReservationBytes('GET', '/api/auth/me/history')).toBe(4 * 1024 * 1024)
    expect(standardWorkMemoryReservationBytes('GET', '/api/profile-assets')).toBe(4 * 1024 * 1024)
    expect(standardWorkMemoryReservationBytes('POST', '/api/auth/me')).toBe(3 * 1024 * 1024)
  })

  it('sizes a focused read below the mutation allowance without weakening large rows', () => {
    expect(focusedApplicationReadReservationBytes(0)).toBe(16 * 1024 * 1024)
    expect(focusedApplicationReadReservationBytes(2 * 1024 * 1024)).toBe(16 * 1024 * 1024)
    expect(focusedApplicationReadReservationBytes(8 * 1024 * 1024)).toBe(24 * 1024 * 1024)
  })

  it('keeps the workspace final authorization projection inside its fixed completion budget', () => {
    expect(WORKSPACE_STREAM_FINALIZATION_MAX_BYTES).toBe(8 * 1024 * 1024)
    expect(WORKSPACE_STREAM_FINALIZATION_HYDRATION_SELECTOR).toMatchObject({
      includeApplications: false,
      includeProfileAssets: false,
      includeTeamPeers: true,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
      completionCriticalMemoryReservation: true,
      retainMemoryReservation: true,
    })
  })
})
