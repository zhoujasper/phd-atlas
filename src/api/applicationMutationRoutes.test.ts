import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplicationRecord } from '../data/applications'
import type { DiscoverApplicationEnrichmentProposal } from '../data/discover'
import { applicationCreateAcknowledgementCandidate } from '../../shared/applicationPersistenceProtocol.js'
import {
  canonicalApplicationProjectionDigest,
  createApplicationMutationAck,
} from '../../server/applicationMutationAck.js'
import {
  clearClientSessionCaches,
  phdApi,
} from './phdApi'
import {
  reportApiReachable,
  resetConnectivityForTests,
} from '../connectivity'

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data, requestId: 'ack-route-test' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type ApplicationRouteFixture = ApplicationRecord & {
  deletedAt?: string
  notes?: string
  updatedAt: string
}

const application = (overrides: Record<string, unknown> = {}) => ({
  id: 'application-route-ack',
  ownerId: 'owner-1',
  teamId: null,
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  professor: {
    english: 'Dr Example',
    chinese: '',
    email: 'example@university.test',
    homepage: '',
    research: '',
  },
  school: { name: 'Northbridge', country: 'United Kingdom', website: '' },
  program: 'Physics PhD',
  deadline: '2027-01-15',
  nextReminder: '2027-01-15',
  result: 'Draft created.',
  materials: [],
  tasks: [],
  communications: [],
  timeline: [],
  ...overrides,
}) as unknown as ApplicationRouteFixture

function requestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
}

function expectBaselineHeader(init: RequestInit | undefined, baseline: unknown) {
  expect(new Headers(init?.headers).get('X-PhD-Application-Acknowledgement')).toBe('v2')
  expect(new Headers(init?.headers).get('X-PhD-Application-Projection-Version')).toBe('2')
  expect(new Headers(init?.headers).get('X-PhD-Application-Baseline-Hash'))
    .toBe(canonicalApplicationProjectionDigest(baseline))
}

describe('phdApi truthful application mutation route adapters', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    resetConnectivityForTests()
    reportApiReachable(40)
  })

  afterEach(() => {
    clearClientSessionCaches()
    resetConnectivityForTests()
    vi.unstubAllGlobals()
  })

  it('reconstructs POST create and Discover import acknowledgements instead of treating them as applications', async () => {
    const createInput = {
      professor: 'Dr Ada Example',
      professorEmail: 'ada@example.test',
      university: 'Northbridge',
      country: 'United Kingdom',
      program: 'Computer Science PhD',
      deadline: '2027-02-01',
      notes: 'Durable research fit',
      visibleToTeam: true,
    }
    const createBaseline = applicationCreateAcknowledgementCandidate(createInput)
    const created = application({
      id: 'created-route-ack',
      professor: {
        english: createInput.professor,
        chinese: '',
        email: createInput.professorEmail,
        homepage: '',
        research: createInput.notes,
      },
      school: { name: createInput.university, country: createInput.country, website: '' },
      program: createInput.program,
      deadline: createInput.deadline,
      nextReminder: createInput.deadline,
      result: createInput.notes,
      timeline: [{ id: 'timeline-1', title: 'Draft created', date: '2026-08-02', note: createInput.notes }],
      teamTransferRequest: { id: 'transfer-create', teamId: 'team-1', status: 'pending' },
      updatedAt: '2026-08-02T10:00:01.000Z',
    })
    const discoverInput = { programId: 'program-1', piId: null, includeNotes: true }
    const imported = application({
      id: 'imported-route-ack',
      program: 'Imported programme',
      updatedAt: '2026-08-02T10:00:02.000Z',
    })
    const fetchMock = vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
      const body = requestBody(init)
      if (String(path) === '/api/applications') {
        expectBaselineHeader(init, createBaseline)
        return envelope(await createApplicationMutationAck({
          baseline: createBaseline,
          application: created,
          mutation: body,
          patchMode: 'full',
          authorityPurpose: 'create',
        }), 201)
      }
      expect(String(path)).toBe('/api/discover/import')
      expectBaselineHeader(init, {})
      const applicationAcknowledgement = await createApplicationMutationAck({
        baseline: {},
        application: imported,
        mutation: body,
        patchMode: 'full',
        authorityPurpose: 'create',
      })
      return envelope({
        applicationAcknowledgement,
        programId: discoverInput.programId,
        piId: null,
        warnings: [],
      }, 201)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.createApplication('create-token', createInput)).resolves.toMatchObject({
      id: created.id,
      teamTransferRequest: { status: 'pending' },
    })
    await expect(phdApi.importDiscoverProgram('discover-token', discoverInput)).resolves.toMatchObject({
      application: { id: imported.id },
      programId: discoverInput.programId,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('binds the school-logo route to its submitted baseline and authority purpose', async () => {
    const base = application({
      school: {
        name: 'Northbridge',
        country: 'United Kingdom',
        logo: { source: 'website', dataUrl: 'data:image/png;base64,old' },
        logoAutoDetect: true,
      },
    })
    const input = {
      logo: {
        source: 'website' as const,
        dataUrl: 'data:image/png;base64,new',
        updatedAt: '2026-08-02T10:00:01.000Z',
      },
      autoDetect: false,
    }
    const { logo: _logo, logoAutoDetect: _auto, ...schoolIdentity } = base.school
    const submittedBaseline = {
      ...base,
      school: { ...schoolIdentity, logo: input.logo, logoAutoDetect: false },
    }
    const durable = {
      ...submittedBaseline,
      school: {
        ...submittedBaseline.school,
        logo: { ...input.logo, updatedAt: '2026-08-02T10:00:01.000Z' },
      },
      updatedAt: '2026-08-02T10:00:01.000Z',
    } as ApplicationRouteFixture
    vi.stubGlobal('fetch', vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
      expect(String(path)).toBe(`/api/applications/${base.id}/school-logo`)
      expectBaselineHeader(init, submittedBaseline)
      return envelope(await createApplicationMutationAck({
        baseline: submittedBaseline,
        application: durable,
        baseUpdatedAt: base.updatedAt,
        mutation: requestBody(init),
        authorityPurpose: 'school-logo',
      }))
    }))

    await expect(phdApi.updateSchoolLogo('logo-token', base, input)).resolves.toMatchObject({
      updatedAt: durable.updatedAt,
      school: { logo: { updatedAt: durable.school.logo?.updatedAt }, logoAutoDetect: false },
    })
  })

  it('verifies Team visibility, approval, and rejection against each resident baseline', async () => {
    const initial = application()
    const pending = application({
      updatedAt: '2026-08-02T10:00:01.000Z',
      teamTransferRequest: { id: 'transfer-1', teamId: 'team-1', status: 'pending' },
    })
    const approved = {
      ...pending,
      teamId: 'team-1',
      teamTransferRequest: { ...pending.teamTransferRequest, status: 'approved' },
      updatedAt: '2026-08-02T10:00:02.000Z',
    } as ApplicationRouteFixture
    const secondPending = application({
      id: 'application-route-reject',
      teamTransferRequest: { id: 'transfer-2', teamId: 'team-1', status: 'pending' },
    })
    const rejected = {
      ...secondPending,
      teamTransferRequest: { ...secondPending.teamTransferRequest, status: 'rejected' },
      updatedAt: '2026-08-02T10:00:03.000Z',
    } as ApplicationRouteFixture
    const routes = [
      { baseline: initial, durable: pending, path: `/api/applications/${initial.id}/team-visibility` },
      { baseline: pending, durable: approved, path: '/api/teams/team-1/transfer-requests/transfer-1/approve' },
      { baseline: secondPending, durable: rejected, path: '/api/teams/team-1/transfer-requests/transfer-2/reject' },
    ]
    let index = 0
    const fetchMock = vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
      const route = routes[index++]
      expect(String(path)).toBe(route.path)
      expectBaselineHeader(init, route.baseline)
      return envelope(await createApplicationMutationAck({
        baseline: route.baseline,
        application: route.durable,
        baseUpdatedAt: route.baseline.updatedAt,
        mutation: requestBody(init),
        authorityPurpose: 'team-transfer',
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.updateApplicationTeamVisibility(
      'team-token', initial, true, 'team-1',
    )).resolves.toMatchObject({ teamTransferRequest: { status: 'pending' } })
    await expect(phdApi.approveTeamTransferRequest(
      'team-token', 'team-1', 'transfer-1', pending, 'teacher-1',
    )).resolves.toMatchObject({ teamId: 'team-1', teamTransferRequest: { status: 'approved' } })
    await expect(phdApi.rejectTeamTransferRequest(
      'team-token', 'team-1', 'transfer-2', secondPending,
    )).resolves.toMatchObject({ teamTransferRequest: { status: 'rejected' } })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('verifies trash restore and Discover enrichment without trusting raw response shapes', async () => {
    const deleted = application({ deletedAt: '2026-08-02T09:00:00.000Z' })
    const { deletedAt: _deletedAt, ...restoredFields } = deleted
    const restored = {
      ...restoredFields,
      updatedAt: '2026-08-02T10:00:01.000Z',
    } as ApplicationRouteFixture
    const discoverBaseline = application({ id: 'discover-enrichment-1' })
    const enriched = {
      ...discoverBaseline,
      notes: 'Applied verified enrichment',
      updatedAt: '2026-08-02T10:00:02.000Z',
    } as ApplicationRouteFixture
    const proposal = {
      applicationId: discoverBaseline.id,
      applicationUpdatedAt: discoverBaseline.updatedAt,
      changes: [],
    } as unknown as DiscoverApplicationEnrichmentProposal
    const routes = [
      {
        baseline: deleted,
        durable: restored,
        path: '/api/applications/trash/trash-1/restore',
        purpose: 'trash-restore' as const,
      },
      {
        baseline: discoverBaseline,
        durable: enriched,
        path: `/api/discover/applications/${discoverBaseline.id}/enrichment/apply`,
        purpose: 'none' as const,
      },
    ]
    let index = 0
    vi.stubGlobal('fetch', vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
      const route = routes[index++]
      expect(String(path)).toBe(route.path)
      expectBaselineHeader(init, route.baseline)
      return envelope(await createApplicationMutationAck({
        baseline: route.baseline,
        application: route.durable,
        baseUpdatedAt: route.baseline.updatedAt,
        mutation: requestBody(init),
        authorityPurpose: route.purpose,
      }))
    }))

    await expect(phdApi.restoreApplicationFromTrash(
      'trash-token', 'trash-1', deleted,
    )).resolves.not.toHaveProperty('deletedAt')
    await expect(phdApi.applyDiscoverApplicationEnrichment(
      'discover-token', discoverBaseline, proposal, ['change-1'],
    )).resolves.toMatchObject({ notes: enriched.notes })
  })

  it('rejects a purpose-confused acknowledgement before a saved result can escape', async () => {
    const base = application()
    const durable = {
      ...base,
      teamId: 'team-1',
      updatedAt: '2026-08-02T10:00:01.000Z',
    } as ApplicationRouteFixture
    vi.stubGlobal('fetch', vi.fn(async (_path: string | URL | Request, init?: RequestInit) => envelope(
      await createApplicationMutationAck({
        baseline: base,
        application: durable,
        baseUpdatedAt: base.updatedAt,
        mutation: requestBody(init),
        authorityPurpose: 'team-transfer',
      }),
    )))

    await expect(phdApi.applyDiscoverApplicationEnrichment(
      'discover-token', base, {} as DiscoverApplicationEnrichmentProposal, ['change-1'],
    )).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 409 })
  })
})
