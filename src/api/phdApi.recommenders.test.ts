import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientSessionCaches,
  phdApi,
  type ApplicationRecommenderMutationResult,
  type ApplicationRecommenderSlice,
  type ProfileRecommender,
  type ProfileRecommenderMutationResult,
} from './phdApi'
import {
  reportApiReachable,
  resetConnectivityForTests,
} from '../connectivity'
import type { MaterialRecommender } from '../data/applications'

function envelope<T>(data: T) {
  return new Response(JSON.stringify({
    ok: true,
    data,
    requestId: 'recommender-contract-test',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const profile: ProfileRecommender = {
  id: 'profile_teacher_1',
  name: 'Professor Ada Lovelace',
  email: 'ada@example.edu',
  phone: '+44 20 7946 0991',
  title: 'Professor',
  institution: 'Example University',
  relationship: 'Research supervisor',
  notes: 'Reusable profile context',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-02T09:00:00.000Z',
}

const recommender: MaterialRecommender = {
  id: 'application_teacher_1',
  profileId: profile.id,
  name: profile.name,
  email: profile.email,
  phone: profile.phone,
  contact: profile.email,
  notes: 'Private note for this application only',
  deadline: '2026-11-30',
  deadlineTime: '17:00',
  reminderDate: '2026-11-23',
  reminderTime: '09:30',
}

function applicationSliceWithRecommender(saved = recommender): ApplicationRecommenderSlice {
  return {
    id: 'application_1',
    recommenders: [structuredClone(saved)],
    updatedAt: '2026-08-02T10:00:00.000Z',
  }
}

function applicationMutationResult(
  overrides: Partial<ApplicationRecommenderMutationResult> = {},
): ApplicationRecommenderMutationResult {
  const application = applicationSliceWithRecommender()
  return {
    application,
    applications: [],
    profiles: [structuredClone(profile)],
    directoryRevision: 101,
    profile: structuredClone(profile),
    recommender: structuredClone(recommender),
    affectedApplicationIds: [application.id],
    resolution: 'synced',
    ownerId: 'student_1',
    ...overrides,
  }
}

function profileMutationResult(
  profiles: ProfileRecommender[],
): ProfileRecommenderMutationResult {
  return {
    profiles,
    directoryRevision: 102,
    applications: [applicationSliceWithRecommender()],
    affectedApplicationIds: ['application_1'],
    ownerId: 'student_1',
  }
}

describe('phdApi recommender persistence contracts', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
    reportApiReachable(80)
  })

  afterEach(() => {
    clearClientSessionCaches()
    resetConnectivityForTests()
    vi.unstubAllGlobals()
  })

  it('posts the complete application recommender and concurrency decision to the resolve route', async () => {
    const result = applicationMutationResult()
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(result))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.resolveApplicationRecommender(
      'application-token',
      'application_1',
      recommender,
      {
        applicationUpdatedAt: '2026-08-02T08:00:00.000Z',
        profileUpdatedAt: '2026-08-02T07:00:00.000Z',
      },
      'sync',
    )).resolves.toEqual(result)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/applications/application_1/recommenders/application_teacher_1/resolve',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization'))
      .toBe('Bearer application-token')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      recommender,
      decision: 'sync',
      expectedApplicationUpdatedAt: '2026-08-02T08:00:00.000Z',
      expectedProfileUpdatedAt: '2026-08-02T07:00:00.000Z',
    })
  })

  it('rejects a 200 response that strips a nested application-only recommender field', async () => {
    const stripped = structuredClone(recommender)
    stripped.notes = ''
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(applicationMutationResult({
      application: applicationSliceWithRecommender(stripped),
    }))))

    await expect(phdApi.resolveApplicationRecommender(
      'application-token',
      'application_1',
      recommender,
      { applicationUpdatedAt: '2026-08-02T08:00:00.000Z' },
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a 200 response whose shared profile projection is missing or incomplete', async () => {
    const strippedProfile = { ...profile, phone: '' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(applicationMutationResult({
      profiles: [strippedProfile],
    }))))

    await expect(phdApi.resolveApplicationRecommender(
      'application-token',
      'application_1',
      recommender,
      { applicationUpdatedAt: '2026-08-02T08:00:00.000Z' },
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a resolve response that omits the required empty sibling-slice list', async () => {
    const result = { ...applicationMutationResult() } as Partial<ApplicationRecommenderMutationResult>
    delete result.applications
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(result)))

    await expect(phdApi.resolveApplicationRecommender(
      'application-token',
      'application_1',
      recommender,
      { applicationUpdatedAt: '2026-08-02T08:00:00.000Z' },
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a resolve response with a non-canonical compact-slice timestamp', async () => {
    const result = applicationMutationResult()
    result.application = {
      ...result.application,
      // Parseable, but not the exact canonical representation emitted by Date#toISOString.
      updatedAt: '2026-08-02T10:00:00Z',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(result)))

    await expect(phdApi.resolveApplicationRecommender(
      'application-token',
      'application_1',
      recommender,
      { applicationUpdatedAt: '2026-08-02T08:00:00.000Z' },
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a resolve response that repeats the target in the sibling slices', async () => {
    const result = applicationMutationResult()
    result.applications = [structuredClone(result.application)]
    result.affectedApplicationIds = [result.application.id]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(result)))

    await expect(phdApi.resolveApplicationRecommender(
      'application-token',
      'application_1',
      recommender,
      { applicationUpdatedAt: '2026-08-02T08:00:00.000Z' },
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a resolve response without a safe positive directory revision', async () => {
    const result = { ...applicationMutationResult() } as Partial<ApplicationRecommenderMutationResult>
    delete result.directoryRevision
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(result)))

    await expect(phdApi.resolveApplicationRecommender(
      'application-token',
      'application_1',
      recommender,
      { applicationUpdatedAt: '2026-08-02T08:00:00.000Z' },
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('puts the complete personal recommender library with its base snapshot', async () => {
    const nextProfiles = [profile]
    const baseProfiles = [{ ...profile, phone: '+44 20 7000 0000' }]
    const result = profileMutationResult(nextProfiles)
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(result))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.replaceProfileRecommenders(
      'profile-token',
      nextProfiles,
      baseProfiles,
    )).resolves.toEqual(result)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/profile-recommenders')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization'))
      .toBe('Bearer profile-token')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      profiles: nextProfiles,
      baseProfiles,
    })
  })

  it('rejects a successful-looking profile-library response that strips nested data', async () => {
    const strippedProfile = { ...profile } as Partial<ProfileRecommender>
    delete strippedProfile.relationship
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(profileMutationResult([
      strippedProfile as ProfileRecommender,
    ]))))

    await expect(phdApi.replaceProfileRecommenders(
      'profile-token',
      [profile],
      [profile],
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a successful-looking profile-library response without the canonical list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope({
      applications: [],
      affectedApplicationIds: [],
      ownerId: 'student_1',
    })))

    await expect(phdApi.replaceProfileRecommenders(
      'profile-token',
      [profile],
      [profile],
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a profile-library response that omits the required empty application-slice list', async () => {
    const result = { ...profileMutationResult([profile]) } as Partial<ProfileRecommenderMutationResult>
    delete result.applications
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(result)))

    await expect(phdApi.replaceProfileRecommenders(
      'profile-token',
      [profile],
      [profile],
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a profile-library response whose compact slice omits updatedAt', async () => {
    const result = profileMutationResult([profile])
    const malformed = { ...result.applications[0] } as Partial<ApplicationRecommenderSlice>
    delete malformed.updatedAt
    result.applications = [malformed as ApplicationRecommenderSlice]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(result)))

    await expect(phdApi.replaceProfileRecommenders(
      'profile-token',
      [profile],
      [profile],
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('rejects a profile-library response with a non-positive directory revision', async () => {
    const result = profileMutationResult([profile])
    result.directoryRevision = 0
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(result)))

    await expect(phdApi.replaceProfileRecommenders(
      'profile-token',
      [profile],
      [profile],
    )).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('uses the student-scoped Team read and replace routes with the full payload', async () => {
    const nextProfiles = [profile]
    const baseProfiles = [{ ...profile, email: 'previous@example.edu' }]
    const result = profileMutationResult(nextProfiles)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(nextProfiles))
      .mockResolvedValueOnce(envelope(result))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listTeamMemberProfileRecommenders(
      'team-token',
      'team_1',
      'student_1',
    )).resolves.toEqual(nextProfiles)
    await expect(phdApi.replaceTeamMemberProfileRecommenders(
      'team-token',
      'team_1',
      'student_1',
      nextProfiles,
      baseProfiles,
    )).resolves.toEqual(result)

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/teams/team_1/members/student_1/profile-recommenders',
      '/api/teams/team_1/members/student_1/profile-recommenders',
    ])
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' })
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get('Authorization')).toBe('Bearer team-token')
    }
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      profiles: nextProfiles,
      baseProfiles,
    })
  })
})
