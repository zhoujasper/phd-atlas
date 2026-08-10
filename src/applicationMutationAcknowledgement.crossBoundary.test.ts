import { describe, expect, it } from 'vitest'
import type { ApplicationRecord } from './data/applications'
import { applicationCreateAcknowledgementCandidate } from '../shared/applicationPersistenceProtocol.js'
import {
  createApplicationMutationAck,
  MAX_APPLICATION_MUTATION_ACK_BYTES,
} from '../server/applicationMutationAck.js'
import {
  applyApplicationMutationAcknowledgement,
  canonicalValueHash,
} from './applicationMutationAcknowledgement'

type VersionedApplicationRecord = ApplicationRecord & { updatedAt: string }

const baseApplication = (overrides: Record<string, unknown> = {}): VersionedApplicationRecord => ({
  id: 'cross-boundary-application',
  ownerId: 'owner-1',
  teamId: null,
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  professor: { english: 'Dr Example', email: 'example@university.test' },
  school: { name: 'Northbridge', country: 'United Kingdom' },
  program: 'Physics PhD',
  deadline: '2027-01-15',
  materials: [],
  tasks: [],
  communications: [],
  timeline: [],
  ...overrides,
}) as unknown as VersionedApplicationRecord

describe('server to browser application acknowledgement boundary', () => {
  it('reconstructs a multi-megabyte create without echoing request-authored text or server authority', async () => {
    const notes = `resident:${'x'.repeat(2 * 1024 * 1024)}`
    const input = {
      professor: 'Dr Ada Example',
      professorChinese: '',
      professorEmail: 'ada@example.test',
      professorHomepage: 'https://example.test/ada',
      university: 'Northbridge',
      country: 'United Kingdom',
      website: 'https://northbridge.example',
      program: 'Computer Science PhD',
      deadline: '2027-01-15',
      notes,
      visibleToTeam: true,
    }
    const baseline = applicationCreateAcknowledgementCandidate(input)
    const durable = baseApplication({
      id: 'created-cross-boundary',
      professor: {
        english: input.professor,
        chinese: input.professorChinese,
        email: input.professorEmail,
        phone: '',
        social: '',
        homepage: input.professorHomepage,
        research: notes,
        lab: 'Lab information to be added.',
      },
      school: {
        name: input.university,
        country: input.country,
        website: input.website,
      },
      program: input.program,
      deadline: input.deadline,
      nextReminder: input.deadline,
      result: notes,
      timeline: [{
        id: 'timeline-created',
        title: 'Draft created',
        date: '2026-08-02',
        note: notes,
      }],
      materials: [{
        id: 'material-created',
        name: 'Academic CV',
        fileId: 'server-only-vault-reference',
      }],
      communications: [{
        id: 'mail-created',
        subject: 'Welcome',
        attachments: [{ fileId: 'server-only-attachment' }],
      }],
      shares: [{ id: 'server-only-share', token: 'never-echo' }],
      teamTransferRequest: {
        id: 'transfer-created',
        teamId: 'team-pending',
        direction: 'join',
        status: 'pending',
      },
      updatedAt: '2026-08-02T10:00:01.000Z',
    })
    const acknowledgement = await createApplicationMutationAck({
      baseline,
      application: durable,
      mutation: input,
      patchMode: 'full',
      authorityPurpose: 'create',
    })

    const serialized = JSON.stringify(acknowledgement)
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(MAX_APPLICATION_MUTATION_ACK_BYTES)
    expect(serialized).not.toContain(notes.slice(-1_024))
    expect(acknowledgement.patch.some((operation) => operation.path === '/updatedAt')).toBe(false)
    expect(acknowledgement.patch.some((operation) => operation.path.includes('attachments'))).toBe(false)
    expect(acknowledgement.patch.some((operation) => operation.path.includes('fileId'))).toBe(false)
    expect(acknowledgement.patch.some((operation) => operation.path.startsWith('/shares'))).toBe(false)

    const canonical = await applyApplicationMutationAcknowledgement(
      acknowledgement,
      baseline,
      {
        baseUpdatedAt: null,
        operationCount: 0,
        mutationHash: await canonicalValueHash(input),
        authorityPurpose: 'create',
      },
    )
    expect(canonical.id).toBe(durable.id)
    expect(canonical.updatedAt).toBe(durable.updatedAt)
    expect(canonical.professor.research).toBe(notes)
    expect(canonical.result).toBe(notes)
    expect(canonical.timeline[0]?.note).toBe(notes)
    expect(canonical.teamTransferRequest).toMatchObject({ id: 'transfer-created', status: 'pending' })
  })

  it('verifies a large school logo through the durable authority hash without echoing it', async () => {
    const dataUrl = `data:image/png;base64,${'a'.repeat(2 * 1024 * 1024)}`
    const baseline = baseApplication({
      result: 'n'.repeat(2 * 1024 * 1024),
      school: { name: 'Northbridge', logo: { source: 'website', dataUrl } },
    })
    const durable = {
      ...baseline,
      school: {
        ...baseline.school,
        logo: { ...baseline.school.logo, updatedAt: '2026-08-02T10:00:02.000Z' },
      },
      updatedAt: '2026-08-02T10:00:02.000Z',
    } as VersionedApplicationRecord
    const mutation = { logo: baseline.school.logo, autoDetect: false }
    const acknowledgement = await createApplicationMutationAck({
      baseline,
      application: durable,
      baseUpdatedAt: baseline.updatedAt,
      mutation,
      authorityPurpose: 'school-logo',
    })
    expect(JSON.stringify(acknowledgement).length).toBeLessThan(4_096)

    await expect(applyApplicationMutationAcknowledgement(acknowledgement, baseline, {
      baseUpdatedAt: baseline.updatedAt,
      operationCount: 0,
      mutationHash: await canonicalValueHash(mutation),
      authorityPurpose: 'school-logo',
    })).resolves.toMatchObject({
      updatedAt: durable.updatedAt,
      school: { logo: { updatedAt: durable.school.logo?.updatedAt } },
    })
  })

  it('applies only the purpose-bound Team authority patch and rejects a mismatched purpose', async () => {
    const baseline = baseApplication({
      result: 'resident authored value',
      shares: [{ id: 'share-preserved' }],
      communications: [{
        id: 'mail-preserved',
        subject: 'Interview',
        attachments: [{ fileId: 'attachment-preserved' }],
      }],
    })
    const durable = {
      ...baseline,
      teamId: 'team-1',
      teamTransferRequest: { id: 'transfer-1', status: 'approved' },
      updatedAt: '2026-08-02T10:00:03.000Z',
    } as VersionedApplicationRecord
    const mutation = { visibleToTeam: true, teamId: 'team-1' }
    const acknowledgement = await createApplicationMutationAck({
      baseline,
      application: durable,
      baseUpdatedAt: baseline.updatedAt,
      mutation,
      authorityPurpose: 'team-transfer',
    })

    const canonical = await applyApplicationMutationAcknowledgement(acknowledgement, baseline, {
      baseUpdatedAt: baseline.updatedAt,
      operationCount: 0,
      mutationHash: await canonicalValueHash(mutation),
      authorityPurpose: 'team-transfer',
    })
    expect(canonical.teamId).toBe('team-1')
    expect(canonical.teamTransferRequest).toMatchObject({ id: 'transfer-1', status: 'approved' })
    expect(canonical.communications[0]?.attachments).toEqual(baseline.communications[0]?.attachments)

    await expect(applyApplicationMutationAcknowledgement(acknowledgement, baseline, {
      baseUpdatedAt: baseline.updatedAt,
      operationCount: 0,
      mutationHash: await canonicalValueHash(mutation),
      authorityPurpose: 'school-logo',
    })).rejects.toMatchObject({ code: 'REQUEST_FAILED' })
  })
})
