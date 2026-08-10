import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  canonicalApplicationProjectionDigest,
  canonicalValueDigest,
  createApplicationMutationAck,
  MAX_APPLICATION_MUTATION_ACK_BYTES,
} from './applicationMutationAck.js'
import { applicationCreateAcknowledgementCandidate } from '../shared/applicationPersistenceProtocol.js'
import { APPLICATION_AUTHORED_PROJECTION_VERSION } from '../shared/applicationAuthorityFields.js'

const baseApplication = (overrides = {}) => ({
  id: 'application-ack-1',
  ownerId: 'owner-1',
  teamId: null,
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  school: { name: 'Northbridge', website: 'https://northbridge.example' },
  program: 'Physics PhD',
  notes: 'resident draft',
  materials: [],
  tasks: [],
  communications: [],
  shares: [],
  reviewComments: [],
  ...overrides,
})

test('canonical hashing matches SHA-256 and acknowledgement patches round-trip compactly', async () => {
  assert.equal(canonicalValueDigest('abc'), 'bMQ_hY-7djMBY3ta-XDipGtG9GHyfloPQeAJxZuCeyU')
  const baseline = baseApplication()
  const application = {
    ...baseline,
    notes: 'durably saved',
    updatedAt: '2026-08-02T10:00:01.000Z',
  }
  const acknowledgement = await createApplicationMutationAck({
    baseline,
    application,
    baseUpdatedAt: baseline.updatedAt,
  })
  assert.equal(acknowledgement.durable, true)
  assert.deepEqual(acknowledgement.patch.map(({ op, path }) => ({ op, path })), [
    { op: 'set', path: '/notes' },
  ])
  assert.ok(Buffer.byteLength(JSON.stringify(acknowledgement)) < MAX_APPLICATION_MUTATION_ACK_BYTES)
})

test('uses only the current communication-authority projection', async () => {
  const baseline = baseApplication({
    communications: [{
      id: 'mail-1',
      subject: 'Decision',
      summary: 'Decision received',
      bodyFormat: 'html',
      bodyHtml: '<p>Browser body</p>',
      bodyText: 'Browser body',
      mailClassification: { category: 'other' },
    }],
  })
  const application = {
    ...baseline,
    updatedAt: '2026-08-02T10:00:01.000Z',
    communications: [{
      ...baseline.communications[0],
      bodyFormat: 'plain',
      bodyHtml: undefined,
      bodyText: 'Durable server body',
      mailClassification: { category: 'offer' },
    }],
  }

  assert.equal(
    canonicalApplicationProjectionDigest(baseline),
    canonicalApplicationProjectionDigest(application),
  )

  const current = await createApplicationMutationAck({
    baseline,
    application,
  })
  assert.equal(current.projectionVersion, 2)
  assert.equal(current.projectionVersion, APPLICATION_AUTHORED_PROJECTION_VERSION)
  assert.deepEqual(current.patch, [])
})

test('authority purpose exposes only its exact committed paths', async () => {
  const baseline = baseApplication({
    ownerId: 'owner-before',
    teamId: 'team-before',
    school: { name: 'Northbridge', logo: { source: 'website', dataUrl: 'old' } },
    materials: [{ id: 'material-1', name: 'CV', fileId: 'old-vault-id', fileSize: 10 }],
    communications: [{ id: 'mail-1', subject: 'Hello', deliveryStatus: 'queued', attachments: [] }],
  })
  const application = {
    ...baseline,
    ownerId: 'owner-after',
    teamId: 'team-after',
    updatedAt: '2026-08-02T10:00:02.000Z',
    school: { ...baseline.school, logo: { source: 'website', dataUrl: 'new' } },
    materials: [{ ...baseline.materials[0], fileId: 'new-vault-id', fileSize: 20 }],
    communications: [{ ...baseline.communications[0], deliveryStatus: 'sent', sentAt: 'now' }],
  }
  assert.equal(
    canonicalApplicationProjectionDigest(baseline),
    canonicalApplicationProjectionDigest(application),
  )
  const acknowledgement = await createApplicationMutationAck({
    baseline,
    application,
    authorityPurpose: 'team-transfer',
  })
  assert.equal(acknowledgement.baselineHash, acknowledgement.applicationHash)
  assert.deepEqual(
    acknowledgement.patch.map((operation) => operation.path),
    ['/teamId'],
  )
})

test('create acknowledgement establishes identity without exposing unrelated authority', async () => {
  const application = baseApplication({
    teamId: 'team-create',
    teamTransferRequest: { id: 'hidden-transfer', status: 'pending' },
    deletedAt: '2026-08-02T09:00:00.000Z',
    shares: [{ id: 'hidden-share', token: 'secret' }],
    reviewComments: [{ id: 'hidden-review', body: 'secret' }],
    versions: [{ id: 'hidden-version' }],
  })
  const acknowledgement = await createApplicationMutationAck({
    baseline: {},
    application,
    patchMode: 'full',
    authorityPurpose: 'create',
  })
  const paths = acknowledgement.patch.map((operation) => operation.path)
  for (const identityPath of ['/createdAt', '/id', '/ownerId', '/teamId', '/teamTransferRequest']) {
    assert.ok(paths.includes(identityPath), `missing create identity ${identityPath}`)
  }
  for (const hiddenPath of ['/deletedAt', '/reviewComments', '/shares', '/versions']) {
    assert.ok(!paths.includes(hiddenPath), `unexpected authority path ${hiddenPath}`)
  }
  assert.equal(acknowledgement.authorityPurpose, 'create')
  assert.match(acknowledgement.authorityHash, /^[A-Za-z0-9_-]{43}$/u)
})

test('a multi-megabyte create reuses its deterministic request candidate instead of echoing authored leaves', async () => {
  const notes = `large-create:${'n'.repeat(2 * 1024 * 1024)}`
  const input = {
    professor: 'Professor Candidate',
    professorChinese: '',
    professorEmail: 'candidate@example.edu',
    professorHomepage: '',
    university: 'Candidate University',
    country: 'United Kingdom',
    website: '',
    program: 'Candidate PhD',
    deadline: '2027-01-15',
    notes,
  }
  const baseline = applicationCreateAcknowledgementCandidate(input)
  const application = {
    ...baseline,
    id: 'application-large-create',
    ownerId: 'owner-large-create',
    teamId: null,
    professor: {
      ...baseline.professor,
      phone: '',
      social: '',
      lab: 'Lab information to be added.',
    },
    school: { ...baseline.school },
    status: 'Draft',
    progress: 15,
    priority: 50,
    tags: [],
    recommenders: [],
    materials: [],
    communications: [],
    scholarships: [],
    fees: [],
    tasks: [],
    timeline: [{ id: 'time-create', title: 'Draft created', date: '2026-08-02', note: notes }],
    shares: [],
    versions: [],
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
  }
  const acknowledgement = await createApplicationMutationAck({
    baseline,
    application,
    patchMode: 'full',
    authorityPurpose: 'create',
    mutation: input,
  })
  const serialized = JSON.stringify(acknowledgement)
  assert.ok(Buffer.byteLength(serialized) < 32 * 1024)
  assert.ok(!serialized.includes(notes.slice(-1_024)))
  assert.ok(acknowledgement.patch.some((operation) => operation.path === '/id'))
})

test('authority purpose is committed and unknown or mismatched purpose fails closed', async () => {
  const baseline = baseApplication()
  const none = await createApplicationMutationAck({ baseline, application: baseline })
  const transfer = await createApplicationMutationAck({
    baseline,
    application: baseline,
    authorityPurpose: 'team-transfer',
  })
  assert.notEqual(none.canonicalHash, transfer.canonicalHash)
  await assert.rejects(
    createApplicationMutationAck({ baseline, application: baseline, authorityPurpose: 'unknown' }),
    { code: 'APPLICATION_MUTATION_ACK_INVALID' },
  )
  await assert.rejects(
    createApplicationMutationAck({ baseline: {}, application: baseline, patchMode: 'full' }),
    { code: 'APPLICATION_MUTATION_ACK_INVALID' },
  )
})

test('large school logo authority is hashed incrementally without echoing its data URL', async () => {
  const dataUrl = `data:image/png;base64,${'a'.repeat(2 * 1024 * 1024)}`
  const baseline = baseApplication({
    school: { name: 'Northbridge', logo: { source: 'website', dataUrl } },
  })
  const application = {
    ...baseline,
    school: {
      ...baseline.school,
      logo: { ...baseline.school.logo, updatedAt: '2026-08-02T10:00:02.000Z' },
    },
    updatedAt: '2026-08-02T10:00:02.000Z',
  }
  let eventLoopTurns = 0
  const sampler = setInterval(() => { eventLoopTurns += 1 }, 0)
  const acknowledgement = await createApplicationMutationAck({
    baseline,
    application,
    baseUpdatedAt: baseline.updatedAt,
    authorityPurpose: 'school-logo',
  })
  clearInterval(sampler)
  assert.ok(eventLoopTurns >= 2)
  assert.deepEqual(acknowledgement.patch.map((operation) => operation.path), ['/school/logo/updatedAt'])
  assert.ok(Buffer.byteLength(JSON.stringify(acknowledgement)) < 4 * 1024)
  assert.ok(!JSON.stringify(acknowledgement).includes(dataUrl.slice(-1_024)))
})

test('trash restore acknowledgement commits only removal of deletedAt', async () => {
  const baseline = baseApplication({ deletedAt: '2026-08-02T09:00:00.000Z' })
  const { deletedAt: _deletedAt, ...applicationWithoutDeletedAt } = baseline
  const application = {
    ...applicationWithoutDeletedAt,
    updatedAt: '2026-08-02T10:00:02.000Z',
  }
  const acknowledgement = await createApplicationMutationAck({
    baseline,
    application,
    authorityPurpose: 'trash-restore',
  })
  assert.deepEqual(acknowledgement.patch, [{ op: 'remove', path: '/deletedAt' }])
})

test('a 16 MiB resident field is hashed cooperatively without copying it into the response', async () => {
  const largeNotes = 'x'.repeat(16 * 1024 * 1024)
  const baseline = baseApplication({ notes: largeNotes })
  const application = {
    ...baseline,
    updatedAt: '2026-08-02T10:00:03.000Z',
    teamTransferRequest: { id: 'transfer-1', status: 'pending' },
  }
  let eventLoopTurns = 0
  let peakHeap = process.memoryUsage().heapUsed
  const beforeHeap = peakHeap
  const sampler = setInterval(() => {
    eventLoopTurns += 1
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
  }, 0)
  const acknowledgement = await createApplicationMutationAck({
    baseline,
    application,
    baseUpdatedAt: baseline.updatedAt,
    authorityPurpose: 'team-transfer',
  })
  clearInterval(sampler)
  assert.ok(eventLoopTurns >= 2, `expected cooperative hashing, observed ${eventLoopTurns} event-loop turns`)
  assert.ok(peakHeap - beforeHeap < 96 * 1024 * 1024, `hashing grew heap by ${peakHeap - beforeHeap} bytes`)
  assert.ok(Buffer.byteLength(JSON.stringify(acknowledgement)) < 4 * 1024)
  assert.deepEqual(acknowledgement.patch.map((operation) => operation.path), ['/teamTransferRequest'])
})

test('an unreferenced oversized changed field is rejected before a route may commit', async () => {
  const baseline = baseApplication()
  await assert.rejects(
    createApplicationMutationAck({
      baseline,
      application: {
        ...baseline,
        notes: 'n'.repeat(129 * 1024),
        updatedAt: '2026-08-02T10:00:04.000Z',
      },
      baseUpdatedAt: baseline.updatedAt,
    }),
    { code: 'APPLICATION_MUTATION_ACK_TOO_LARGE', status: 413 },
  )
})
