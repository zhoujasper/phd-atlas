import type { ApplicationRecord } from '../data/applications'
import type {
  DiscoverApplicationEnrichmentProposal,
  DiscoverImportInput,
} from '../data/discover'
import { persistedSubsetMatches } from '../persistenceAcknowledgement'
import {
  APPLICATION_AUTHORED_PROJECTION_VERSION,
  type ApplicationMutationAcknowledgement,
  type ApplicationMutationAuthorityPolicy,
  applyApplicationMutationAcknowledgement,
  applicationAuthoredContentHash,
  canonicalValueHash,
} from '../applicationMutationAcknowledgement'
import { applicationCreateAcknowledgementCandidate } from '../../shared/applicationPersistenceProtocol.js'

type CreateApplicationMutationInput = {
  professor: string
  professorChinese?: string
  professorEmail: string
  professorHomepage?: string
  university: string
  country: string
  website?: string
  program: string
  deadline: string
  notes?: string
  visibleToTeam?: boolean
  ownerId?: string
}

type SchoolLogoMutationInput = {
  logo: ApplicationRecord['school']['logo'] | null
  autoDetect: boolean
}

export type ApplicationMutationTransport = <T>(
  path: string,
  token?: string,
  init?: RequestInit,
  timeoutMs?: number,
) => Promise<T>

type FailureFactory = () => Error

type AcknowledgementRouteOptions = {
  method: 'POST' | 'PATCH'
  body: Record<string, unknown>
  baseline: ApplicationRecord | Record<string, unknown>
  baseUpdatedAt: string | null
  authorityPurpose?: ApplicationMutationAuthorityPolicy
  acceptsCanonical?: (canonical: ApplicationRecord) => boolean
}

async function verifyAcknowledgement(
  acknowledgement: ApplicationMutationAcknowledgement,
  baseline: ApplicationRecord | Record<string, unknown>,
  options: Pick<AcknowledgementRouteOptions, 'baseUpdatedAt' | 'authorityPurpose'> & {
    mutationHash: string
  },
  failure: FailureFactory,
  acceptsCanonical?: (canonical: ApplicationRecord) => boolean,
) {
  try {
    const canonical = await applyApplicationMutationAcknowledgement(acknowledgement, baseline, {
      baseUpdatedAt: options.baseUpdatedAt,
      operationCount: 0,
      mutationHash: options.mutationHash,
      authorityPurpose: options.authorityPurpose,
    })
    if (acceptsCanonical && !acceptsCanonical(canonical)) throw new Error('ACK_MISMATCH')
    return canonical
  } catch {
    throw failure()
  }
}

async function acknowledgedApplicationRoute(
  transport: ApplicationMutationTransport,
  failure: FailureFactory,
  path: string,
  token: string,
  options: AcknowledgementRouteOptions,
) {
  const [baselineHash, mutationHash] = await Promise.all([
    applicationAuthoredContentHash(options.baseline),
    canonicalValueHash(options.body),
  ])
  const acknowledgement = await transport<ApplicationMutationAcknowledgement>(path, token, {
    method: options.method,
    body: JSON.stringify(options.body),
    headers: {
      'X-PhD-Application-Acknowledgement': 'v2',
      'X-PhD-Application-Projection-Version': String(APPLICATION_AUTHORED_PROJECTION_VERSION),
      'X-PhD-Application-Baseline-Hash': baselineHash,
    },
  })
  return verifyAcknowledgement(
    acknowledgement,
    options.baseline,
    { ...options, mutationHash },
    failure,
    options.acceptsCanonical,
  )
}

function createInputAcknowledged(input: CreateApplicationMutationInput, canonical: ApplicationRecord) {
  const professorExpectation = {
    english: input.professor,
    email: input.professorEmail,
    ...(input.professorChinese !== undefined ? { chinese: input.professorChinese } : {}),
    ...(input.professorHomepage !== undefined ? { homepage: input.professorHomepage } : {}),
    ...(input.notes ? { research: input.notes } : {}),
  }
  const schoolExpectation = {
    name: input.university,
    country: input.country,
    ...(input.website !== undefined ? { website: input.website } : {}),
  }
  return persistedSubsetMatches(professorExpectation, canonical.professor)
    && persistedSubsetMatches(schoolExpectation, canonical.school)
    && canonical.program === input.program
    && canonical.deadline === input.deadline
    && (!input.notes || canonical.result === input.notes)
    && (!input.ownerId || canonical.ownerId === input.ownerId)
}

export function createApplicationAcknowledged(
  transport: ApplicationMutationTransport,
  failure: FailureFactory,
  token: string,
  input: CreateApplicationMutationInput,
) {
  const baseline = applicationCreateAcknowledgementCandidate(input)
  return acknowledgedApplicationRoute(transport, failure, '/api/applications', token, {
    method: 'POST',
    body: input as Record<string, unknown>,
    baseline,
    baseUpdatedAt: null,
    authorityPurpose: 'create',
    acceptsCanonical: (canonical) => createInputAcknowledged(input, canonical),
  })
}

function schoolLogoBaseline(application: ApplicationRecord, input: SchoolLogoMutationInput) {
  const {
    logo: _previousLogo,
    logoAutoDetect: _previousAutoDetect,
    ...schoolIdentity
  } = application.school
  return {
    ...application,
    school: {
      ...schoolIdentity,
      ...(input.logo ? { logo: { ...input.logo } } : {}),
      logoAutoDetect: input.autoDetect,
    },
  } as ApplicationRecord
}

export function updateSchoolLogoAcknowledged(
  transport: ApplicationMutationTransport,
  failure: FailureFactory,
  token: string,
  application: ApplicationRecord,
  input: SchoolLogoMutationInput,
) {
  return acknowledgedApplicationRoute(
    transport,
    failure,
    `/api/applications/${application.id}/school-logo`,
    token,
    {
      method: 'PATCH',
      body: input as unknown as Record<string, unknown>,
      baseline: schoolLogoBaseline(application, input),
      baseUpdatedAt: application.updatedAt ?? null,
      authorityPurpose: 'school-logo',
      acceptsCanonical: (canonical) => canonical.school.logoAutoDetect === input.autoDetect
        && (input.logo ? Boolean(canonical.school.logo) : !canonical.school.logo),
    },
  )
}

export function updateApplicationTeamVisibilityAcknowledged(
  transport: ApplicationMutationTransport,
  failure: FailureFactory,
  token: string,
  application: ApplicationRecord,
  visibleToTeam: boolean,
  teamId?: string,
) {
  const body: Record<string, unknown> = {
    visibleToTeam,
    ...(teamId !== undefined ? { teamId } : {}),
  }
  return acknowledgedApplicationRoute(
    transport,
    failure,
    `/api/applications/${application.id}/team-visibility`,
    token,
    {
      method: 'PATCH',
      body,
      baseline: application,
      baseUpdatedAt: application.updatedAt ?? null,
      authorityPurpose: 'team-transfer',
    },
  )
}

export function decideTeamTransferAcknowledged(
  transport: ApplicationMutationTransport,
  failure: FailureFactory,
  token: string,
  teamId: string,
  requestId: string,
  decision: 'approve' | 'reject',
  application: ApplicationRecord,
  teacherMemberId?: string,
) {
  const body: Record<string, unknown> = decision === 'approve' && teacherMemberId !== undefined
    ? { teacherMemberId }
    : {}
  return acknowledgedApplicationRoute(
    transport,
    failure,
    `/api/teams/${teamId}/transfer-requests/${requestId}/${decision}`,
    token,
    {
      method: 'POST',
      body,
      baseline: application,
      baseUpdatedAt: application.updatedAt ?? null,
      authorityPurpose: 'team-transfer',
    },
  )
}

export function restoreApplicationFromTrashAcknowledged(
  transport: ApplicationMutationTransport,
  failure: FailureFactory,
  token: string,
  trashId: string,
  application: ApplicationRecord,
) {
  return acknowledgedApplicationRoute(
    transport,
    failure,
    `/api/applications/trash/${trashId}/restore`,
    token,
    {
      method: 'POST',
      body: {},
      baseline: application,
      baseUpdatedAt: application.updatedAt ?? null,
      authorityPurpose: 'trash-restore',
      acceptsCanonical: (canonical) => !('deletedAt' in canonical),
    },
  )
}

export function applyDiscoverEnrichmentAcknowledged(
  transport: ApplicationMutationTransport,
  failure: FailureFactory,
  token: string,
  application: ApplicationRecord,
  proposal: DiscoverApplicationEnrichmentProposal,
  acceptedChangeIds: string[],
) {
  return acknowledgedApplicationRoute(
    transport,
    failure,
    `/api/discover/applications/${encodeURIComponent(application.id)}/enrichment/apply`,
    token,
    {
      method: 'POST',
      body: { proposal, acceptedChangeIds },
      baseline: application,
      baseUpdatedAt: application.updatedAt ?? null,
    },
  )
}

export async function importDiscoverProgramAcknowledged(
  transport: ApplicationMutationTransport,
  failure: FailureFactory,
  token: string,
  input: DiscoverImportInput,
) {
  const body = input as Record<string, unknown>
  const [baselineHash, mutationHash] = await Promise.all([
    applicationAuthoredContentHash({}),
    canonicalValueHash(body),
  ])
  const result = await transport<{
    applicationAcknowledgement: ApplicationMutationAcknowledgement
    programId: string
    piId: string | null
    warnings?: Array<'missingOfficialSource' | 'missingDeadline' | 'missingAdvisor'>
  }>('/api/discover/import', token, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'X-PhD-Application-Acknowledgement': 'v2',
      'X-PhD-Application-Projection-Version': String(APPLICATION_AUTHORED_PROJECTION_VERSION),
      'X-PhD-Application-Baseline-Hash': baselineHash,
    },
  })
  const application = await verifyAcknowledgement(
    result.applicationAcknowledgement,
    {},
    {
      baseUpdatedAt: null,
      authorityPurpose: 'create',
      mutationHash,
    },
    failure,
  )
  const {
    applicationAcknowledgement: _applicationAcknowledgement,
    ...metadata
  } = result
  return { ...metadata, application }
}
