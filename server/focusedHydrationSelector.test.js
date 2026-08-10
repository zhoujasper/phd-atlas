import { describe, expect, it } from 'vitest'
import {
  apiMemoryWorkClass,
  focusedHydrationSelectorForRequest,
  hydrationPolicyForRequest,
  requiresDedicatedHeavyWorkAdmission,
  standardWorkMemoryReservationBytes,
} from './index.js'
import { MEMORY_WORK_CLASS } from './memoryPressure.js'

const focusedApplication = (id = 'app_target') => ({
  includeApplications: false,
  applicationIds: [id],
  includeProfileAssets: false,
  includeTeams: false,
  includeTeamPeers: false,
  includeSystemEvents: false,
  compactWorkspaceUsers: true,
  allowAdminApplicationTargets: true,
})

const focusedProfileAsset = (id = 'asset_target') => ({
  includeApplications: false,
  includeProfileAssets: false,
  profileAssetIds: [id],
  includeTeams: false,
  includeTeamPeers: false,
  includeSystemEvents: false,
})

const focusedExportApplication = (id = 'app_target') => ({
  includeApplications: false,
  applicationIds: [id],
  includeProfileAssets: false,
  includeTeams: false,
  includeTeamPeers: false,
  includeSystemEvents: false,
})

const focusedTrashSettings = () => ({
  includeApplications: false,
  includeProfileAssets: false,
  includeTeams: false,
  includeTeamPeers: false,
  includeSystemEvents: false,
  compactWorkspaceUsers: false,
  compactMemoryReservation: true,
})

const AUTH_ONLY_EXPECTATION = {
  includeApplications: false,
  includeProfileAssets: false,
  includeTeams: false,
  includeTeamPeers: false,
  includeSystemEvents: false,
  compactWorkspaceUsers: true,
  compactMemoryReservation: true,
}

describe('default-deny focused request hydration', () => {
  it('marks focused, legacy-broad, and undeclared default-auth-only routes explicitly', () => {
    expect(hydrationPolicyForRequest('GET', '/api/events')).toMatchObject({
      kind: 'scoped',
      declared: true,
    })
    expect(hydrationPolicyForRequest('PATCH', '/api/profile-assets/asset_target')).toMatchObject({
      kind: 'legacy-broad',
      declared: true,
      selector: null,
    })
    expect(hydrationPolicyForRequest('GET', '/api/future-light-route')).toMatchObject({
      kind: 'auth-only-default',
      declared: false,
      selector: {
        includeApplications: false,
        includeProfileAssets: false,
        includeTeams: false,
      },
    })
  })

  it('keeps admission evidence metadata routes scoped to the principal', () => {
    expect(hydrationPolicyForRequest('POST', '/api/admission-bookmarks')).toMatchObject({
      kind: 'scoped',
      declared: true,
      selector: AUTH_ONLY_EXPECTATION,
    })
    expect(hydrationPolicyForRequest(
      'POST',
      '/api/applications/app_target/admission-signals',
    )).toMatchObject({
      kind: 'scoped',
      declared: true,
      selector: focusedApplication(),
    })
  })

  it('classifies cursor and exact payload-reserved application reads as standard work', () => {
    expect(apiMemoryWorkClass({ method: 'GET', originalUrl: '/api/applications' }))
      .toBe(MEMORY_WORK_CLASS.STANDARD)
    expect(apiMemoryWorkClass({ method: 'GET', originalUrl: '/api/applications/app_target' }))
      .toBe(MEMORY_WORK_CLASS.STANDARD)
    expect(requiresDedicatedHeavyWorkAdmission({
      method: 'GET',
      originalUrl: '/api/applications/app_target',
    })).toBe(false)
    expect(standardWorkMemoryReservationBytes('GET', '/api/applications/app_target'))
      .toBe(512 * 1024)
  })

  it('keeps the compact auth principal on its exact small standard reservation', () => {
    const request = { method: 'GET', originalUrl: '/api/auth/me' }
    expect(apiMemoryWorkClass(request)).toBe(MEMORY_WORK_CLASS.STANDARD)
    expect(requiresDedicatedHeavyWorkAdmission(request)).toBe(false)
    expect(standardWorkMemoryReservationBytes(request.method, request.originalUrl))
      .toBe(1024 * 1024)
    expect(focusedHydrationSelectorForRequest(request.method, request.originalUrl)).toEqual({
      ...AUTH_ONLY_EXPECTATION,
      skipWorkspaceAuthorizationContext: true,
      directAccountSummaryHydration: true,
    })
  })

  it('lets the exactly reserved sectional stream make bounded progress at soft pressure', () => {
    expect(apiMemoryWorkClass({
      method: 'GET',
      originalUrl: '/api/workspace/bootstrap/stream?sections=teamApplications',
    })).toBe(MEMORY_WORK_CLASS.STANDARD)
    expect(apiMemoryWorkClass({ method: 'GET', originalUrl: '/api/workspace/bootstrap' }))
      .toBe(MEMORY_WORK_CLASS.HEAVY)
  })

  it('routes a Team member recommender projection through a small standard reservation', () => {
    const request = {
      method: 'GET',
      originalUrl: '/api/teams/team_1/members/student_1/profile-recommenders',
    }
    expect(apiMemoryWorkClass(request)).toBe(MEMORY_WORK_CLASS.STANDARD)
    expect(requiresDedicatedHeavyWorkAdmission(request)).toBe(false)
    expect(standardWorkMemoryReservationBytes(request.method, request.originalUrl))
      .toBe(2 * 1024 * 1024)
  })

  it('hydrates only the principal for a focused Team recommender GET', () => {
    expect(focusedHydrationSelectorForRequest(
      'GET',
      '/api/teams/team_1/members/student_1/profile-recommenders',
    )).toEqual({
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
      skipWorkspaceAuthorizationContext: true,
    })
    expect(focusedHydrationSelectorForRequest(
      'PUT',
      '/api/teams/team_1/members/student_1/profile-recommenders',
    )).toBeNull()
  })

  it.each([
    ['GET', '/api/events'],
    ['GET', '/api/notifications'],
    ['GET', '/api/notifications/unread-count'],
    ['POST', '/api/notifications/read-all'],
    ['POST', '/api/notifications/notification_1/read'],
    ['POST', '/api/notifications/bulk'],
    ['GET', '/api/push/public-key'],
    ['PUT', '/api/push/subscriptions'],
    ['DELETE', '/api/push/subscriptions'],
    ['POST', '/api/push/test'],
    ['GET', '/api/codex/whoami'],
    ['GET', '/api/codex/capabilities'],
    ['GET', '/api/codex/settings'],
    ['GET', '/api/codex/profile-recommenders'],
    ['POST', '/api/codex/profile-recommenders'],
    ['PATCH', '/api/codex/profile-recommenders/profile_1'],
    ['DELETE', '/api/codex/profile-recommenders/profile_1'],
    ['GET', '/api/codex/authorizations'],
    ['POST', '/api/codex/authorizations'],
    ['PATCH', '/api/codex/authorizations/auth_1'],
    ['DELETE', '/api/codex/authorizations/current'],
    ['GET', '/api/codex/device-authorizations/ABCD-EFGH'],
    ['POST', '/api/codex/device-authorizations/ABCD-EFGH/approve'],
    ['POST', '/api/codex/device-authorizations/ABCD-EFGH/deny'],
    ['GET', '/api/auth/passkeys'],
    ['POST', '/api/auth/passkeys/register/options'],
    ['POST', '/api/auth/passkeys/register/verify'],
    ['PATCH', '/api/auth/passkeys/passkey_1'],
    ['DELETE', '/api/auth/passkeys/passkey_1'],
    ['POST', '/api/ai/keys/key_1/test'],
    ['GET', '/api/files/file_1/download'],
    ['POST', '/api/teams/invites/invite_1/accept'],
    ['POST', '/api/teams/join-codes/ABCD-EFGH-IJKL/redeem'],
    ['GET', '/api/backups'],
  ])('keeps direct/cursor route %s %s on auth-only hydration', (method, pathname) => {
    expect(focusedHydrationSelectorForRequest(method, pathname)).toEqual({
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
    })
  })

  it('keeps the personal application cursor off the full Team visibility graph', () => {
    expect(focusedHydrationSelectorForRequest('GET', '/api/applications')).toEqual({
      ...AUTH_ONLY_EXPECTATION,
      skipTeamApplicationVisibilityContext: true,
      directApplicationListHydration: true,
    })
  })

  it('uses focused auth-only hydration for every Interview Prep route', () => {
    expect(focusedHydrationSelectorForRequest('GET', '/api/interview-prep/workspace')).toEqual({
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
    })
    expect(focusedHydrationSelectorForRequest(
      'POST',
      '/api/interview-prep/ai/mock-turn',
    )).toEqual({
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
    })
  })

  it.each([
    ['GET', '/api/discover/catalog'],
    ['GET', '/api/discover/state'],
    ['GET', '/api/discover/source-index'],
  ])('hydrates complete principal settings for Discover route %s %s', (method, pathname) => {
    expect(focusedHydrationSelectorForRequest(method, pathname)).toEqual({
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: false,
      compactMemoryReservation: true,
    })
  })

  it.each([
    ['GET', '/api/applications/trash'],
    ['DELETE', '/api/applications/trash/trash_1'],
    ['DELETE', '/api/applications/trash'],
  ])('hydrates only complete principal settings for recycle-bin route %s %s', (method, pathname) => {
    expect(focusedHydrationSelectorForRequest(method, pathname)).toEqual(focusedTrashSettings())
  })

  it.each([
    ['GET', '/api/teams/team_1/notification-groups'],
    ['POST', '/api/teams/team_1/notification-groups'],
    ['PATCH', '/api/teams/team_1/notification-groups/group_1'],
    ['DELETE', '/api/teams/team_1/notification-groups/group_1'],
  ])('hydrates only the requested Team metadata for %s %s', (method, pathname) => {
    expect(focusedHydrationSelectorForRequest(method, pathname)).toEqual({
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
      teamIds: ['team_1'],
    })
  })

  it('uses auth-only Team metadata for an explicitly invite-only member revoke', () => {
    expect(focusedHydrationSelectorForRequest(
      'DELETE',
      '/api/teams/team_1/members/member_1',
      new URLSearchParams({ invite: '1' }),
    )).toEqual({
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
      teamIds: ['team_1'],
    })
    expect(focusedHydrationSelectorForRequest(
      'DELETE',
      '/api/teams/team_1/members/member_1',
    )).toBeNull()
  })

  it('keeps Team Discover reads broad until their target user loader is available', () => {
    expect(focusedHydrationSelectorForRequest(
      'GET',
      '/api/discover/catalog',
      new URLSearchParams({ teamId: 'team_1', targetUserId: 'student_1' }),
    )).toBeNull()
  })

  it('hydrates only the requested application when filtering the backup list', () => {
    expect(focusedHydrationSelectorForRequest(
      'GET',
      '/api/backups',
      new URLSearchParams({ applicationId: 'app_target' }),
    )).toEqual({
      includeApplications: false,
      applicationIds: ['app_target'],
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
    })
  })

  it.each([
    ['GET', '/api/applications/app_target'],
    ['GET', '/api/applications/app_target/review-comments/threaded'],
    ['POST', '/api/applications/app_target/school-logo/resolve'],
    ['PATCH', '/api/applications/app_target/school-logo'],
    ['PATCH', '/api/applications/app_target/delta'],
    ['PUT', '/api/applications/app_target'],
    ['POST', '/api/applications/app_target/materials'],
    ['POST', '/api/applications/app_target/materials/material_1/file'],
    ['PATCH', '/api/applications/app_target/materials/material_1/files/file_1'],
    ['DELETE', '/api/applications/app_target/materials/material_1/files/file_1'],
    ['POST', '/api/applications/app_target/communications'],
    ['PATCH', '/api/applications/app_target/communications/categories'],
    ['POST', '/api/applications/app_target/communications/classify'],
    ['PATCH', '/api/applications/app_target/communications/communication_1'],
    ['POST', '/api/applications/app_target/scholarships'],
    ['POST', '/api/applications/app_target/fees'],
    ['PATCH', '/api/applications/app_target/fees/fee_1'],
    ['DELETE', '/api/applications/app_target/fees/fee_1'],
    ['POST', '/api/applications/app_target/tasks'],
    ['PATCH', '/api/applications/app_target/tasks/task_1'],
    ['POST', '/api/applications/app_target/tasks/task_1/file'],
    ['PATCH', '/api/applications/app_target/tasks/task_1/files/file_1'],
    ['DELETE', '/api/applications/app_target/tasks/task_1/files/file_1'],
    ['PATCH', '/api/applications/app_target/share/share_1'],
    ['DELETE', '/api/applications/app_target/share/share_1/'],
  ])('focuses the target application for %s %s', (method, pathname) => {
    expect(focusedHydrationSelectorForRequest(method, pathname)).toEqual(focusedApplication())
  })

  it('hydrates complete principal settings only for an exact application delete', () => {
    expect(focusedHydrationSelectorForRequest(
      'DELETE',
      '/api/applications/app_target',
    )).toEqual({
      ...focusedApplication(),
      compactWorkspaceUsers: false,
    })
  })

  it.each([
    ['GET', '/api/profile-assets/asset_target/export'],
    ['DELETE', '/api/profile-assets/asset_target'],
    ['POST', '/api/profile-assets/asset_target/files'],
    ['PATCH', '/api/profile-assets/asset_target/files/file_1'],
    ['DELETE', '/api/profile-assets/asset_target/files/file_1'],
    ['PATCH', '/api/profile-assets/asset_target/share/share_1'],
    ['DELETE', '/api/profile-assets/asset_target/share/share_1/'],
  ])('focuses the target profile asset for %s %s', (method, pathname) => {
    expect(focusedHydrationSelectorForRequest(method, pathname)).toEqual(focusedProfileAsset())
  })

  it('decodes an ordinary encoded id but rejects an encoded path separator', () => {
    expect(focusedHydrationSelectorForRequest(
      'DELETE',
      '/api/applications/app%20target',
    )).toEqual({
      ...focusedApplication('app target'),
      compactWorkspaceUsers: false,
    })
    expect(focusedHydrationSelectorForRequest(
      'DELETE',
      '/api/applications/app%2Ftarget',
    )).toBeNull()
  })

  it('focuses only single-application exports', () => {
    expect(focusedHydrationSelectorForRequest(
      'GET',
      '/api/exports',
      new URLSearchParams({ applicationId: 'app_target', format: 'pdf' }),
    )).toEqual(focusedExportApplication())
    expect(focusedHydrationSelectorForRequest('GET', '/api/exports')).toBeNull()
    expect(focusedHydrationSelectorForRequest(
      'GET',
      '/api/exports',
      new URLSearchParams({ scope: 'current' }),
    )).toBeNull()
  })

  it.each([
    ['POST', '/api/applications/app_target/communications/send'],
    ['POST', '/api/applications/app_target/recommenders/teacher_1/resolve'],
    ['POST', '/api/applications/app_target/team-transfer/preflight'],
    ['PATCH', '/api/applications/app_target/team-visibility'],
    ['POST', '/api/applications/app_target/review-comments'],
    ['POST', '/api/applications/app_target/request-feedback'],
    ['PATCH', '/api/profile-assets/asset_target'],
    ['POST', '/api/profile-assets/asset_target/share'],
    ['POST', '/api/applications/trash/trash_1/restore'],
    ['DELETE', '/api/applications'],
  ])('retains broad hydration for cross-resource %s %s', (method, pathname) => {
    expect(focusedHydrationSelectorForRequest(method, pathname)).toBeNull()
  })
})
