import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryPressureGuard, MEMORY_WORK_CLASS } from './memoryPressure.js'
import { createMemoryReservationLedger } from './memoryReservationLedger.js'
import { outgoingDeliveryMessageId } from './outgoingMailQueue.js'
import { createCommunicationMailClassificationFingerprint } from './mailClassificationContext.js'

vi.mock('./mailer.js', async () => {
  const actual = await vi.importActual('./mailer.js')
  return { ...actual, sendMail: vi.fn() }
})

import { sendMail } from './mailer.js'

const MEBIBYTE = 1024 * 1024
const previousStorageRoot = process.env.PHD_ATLAS_STORAGE_ROOT
let isolatedStorageRoot
let apiMemoryWorkClass
let createApp
let processOutgoingCommunication
let processSystemMailJob
let configureStoreHydrationMemoryAdmission
let enqueueSystemMailJob
let ensureStorage
let getOutgoingMailDeliveryResult
let getSystemMailJob
let readStore
let shutdownStorage
let withWriteLock
let writeStore
const cleanupApplicationIds = new Set()
const openApps = []
let settingsMutationSequence = 0

beforeAll(async () => {
  isolatedStorageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-outgoing-mail-'))
  process.env.PHD_ATLAS_STORAGE_ROOT = isolatedStorageRoot
  const [indexModule, storageModule] = await Promise.all([
    import('./index.js'),
    import('./storage.js'),
  ])
  ;({ apiMemoryWorkClass, createApp, processOutgoingCommunication, processSystemMailJob } = indexModule)
  ;({
    configureStoreHydrationMemoryAdmission,
    enqueueSystemMailJob,
    ensureStorage,
    getOutgoingMailDeliveryResult,
    getSystemMailJob,
    readStore,
    shutdownStorage,
    withWriteLock,
    writeStore,
  } = storageModule)
}, 60_000)

async function startTestApp(testHooks = {}) {
  const app = createApp({ testHooks })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  const running = {
    app,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
  openApps.push(running)
  return running
}

async function stopTestApp(running) {
  const index = openApps.indexOf(running)
  if (index >= 0) openApps.splice(index, 1)
  await running.app.locals.stopRecurringTasks(new Error('Outgoing-mail recovery test stopped.'))
  if (running.server.listening) {
    await new Promise((resolve, reject) => running.server.close((error) => (
      error ? reject(error) : resolve()
    )))
  }
}

async function jsonRequest(baseUrl, path, token, options = {}) {
  const settingsHeaders = path === '/api/settings' && options.method === 'PATCH'
    ? {
        'X-PhD-Settings-Acknowledgement': 'v1',
        'X-PhD-Settings-Mutation-Id': `outgoing-mail-test:${Date.now()}:${++settingsMutationSequence}`,
      }
    : {}
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...settingsHeaders,
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json()
  return { response, payload, data: payload.data }
}

async function login(baseUrl) {
  const result = await jsonRequest(baseUrl, '/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@phd-atlas.local',
      password: 'admin123456',
    }),
  })
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
  return result.data.token
}

afterAll(async () => {
  for (const running of openApps.splice(0)) {
    await stopTestApp(running).catch(() => undefined)
  }
  if (typeof ensureStorage === 'function') await ensureStorage()
  if (cleanupApplicationIds.size > 0 && typeof withWriteLock === 'function') {
    await withWriteLock(async () => {
      const store = await readStore()
      store.applications = store.applications.filter((application) => (
        !cleanupApplicationIds.has(application.id)
      ))
      await writeStore(store)
    })
  }
  if (typeof shutdownStorage === 'function') await shutdownStorage()
  if (isolatedStorageRoot) {
    await fs.rm(isolatedStorageRoot, { recursive: true, force: true })
  }
  if (previousStorageRoot === undefined) delete process.env.PHD_ATLAS_STORAGE_ROOT
  else process.env.PHD_ATLAS_STORAGE_ROOT = previousStorageRoot
}, 60_000)

describe.sequential('focused outgoing SMTP delivery journal', () => {
  it('does not stack a whole-request HEAVY lease and never resends accepted SMTP after restart', async () => {
    expect(apiMemoryWorkClass({
      method: 'POST',
      originalUrl: '/api/applications/app-1/communications/send',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    })).toBe(MEMORY_WORK_CLASS.STANDARD)

    let rssBytes = 200 * MEBIBYTE
    const guard = createMemoryPressureGuard({
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => rssBytes,
      recoverySamples: 1,
    })
    const baseLedger = createMemoryReservationLedger({ memoryPressureGuard: guard })
    const acquisitionTrace = []
    let monitorMail = false
    let mailLeaseActive = false
    let nestedHydrationWhileSending = false
    const memoryReservationLedger = {
      admit: (...args) => baseLedger.admit(...args),
      snapshot: () => baseLedger.snapshot(),
      acquire(workClass, bytes) {
        if (monitorMail) {
          acquisitionTrace.push({ workClass, bytes })
          if (mailLeaseActive && workClass === MEMORY_WORK_CLASS.STANDARD) {
            nestedHydrationWhileSending = true
          }
        }
        const lease = baseLedger.acquire(workClass, bytes)
        if (
          monitorMail
          && lease.allowed
          && workClass === MEMORY_WORK_CLASS.HEAVY
          && bytes === 32 * MEBIBYTE
        ) {
          mailLeaseActive = true
          const release = lease.release
          lease.release = () => {
            mailLeaseActive = false
            release()
          }
        }
        return lease
      },
    }

    let reservationAtSmtp = null
    let reservationAtFinalize = null
    sendMail.mockImplementation(async (_settings, message) => {
      reservationAtSmtp = memoryReservationLedger.snapshot().reservedBytes
      return { messageId: message.messageId }
    })

    const first = await startTestApp({
      memoryPressureGuard: guard,
      memoryReservationLedger,
      outgoingMailBeforeFinalize: () => {
        reservationAtFinalize = memoryReservationLedger.snapshot().reservedBytes
        throw new Error('Injected application projection failure after SMTP acceptance.')
      },
    })

    const firstToken = await login(first.baseUrl)
    const configuredSmtp = await jsonRequest(first.baseUrl, '/api/settings', firstToken, {
      method: 'PATCH',
      body: JSON.stringify({
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'admin@phd-atlas.local',
        smtpPass: 'test-only-smtp-secret',
        smtpTls: true,
      }),
    })
    expect(configuredSmtp.response.status, JSON.stringify(configuredSmtp.payload)).toBe(200)
    const created = await jsonRequest(first.baseUrl, '/api/applications', firstToken, {
      method: 'POST',
      body: JSON.stringify({
        professor: 'Professor SMTP Journal',
        professorChinese: '',
        professorEmail: 'smtp-journal@example.edu',
        professorHomepage: '',
        university: `SMTP Journal ${Date.now()}`,
        country: 'United Kingdom',
        website: '',
        program: 'Reliable Delivery PhD',
        deadline: '2027-01-15',
        notes: '',
      }),
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
    cleanupApplicationIds.add(created.data.id)

    // 330 MiB is below the guard's soft edge. The former 96 MiB request lease
    // plus 32 MiB SMTP lease crossed the 448 MiB hard boundary; the focused
    // worker now owns only 32 MiB during the actual network phase.
    rssBytes = 330 * MEBIBYTE
    monitorMail = true
    const idempotencyKey = `smtp-journal-${Date.now()}`
    const expectedMessageId = outgoingDeliveryMessageId(idempotencyKey)
    const sendPayload = {
      subject: 'Exactly once journal probe',
      summary: 'The provider must be called once across process recovery.',
      bodyFormat: 'plain',
      date: '2026-08-02',
      time: '18:30',
      from: 'admin@phd-atlas.local',
      to: 'smtp-journal@example.edu',
      idempotencyKey,
    }
    const sent = await jsonRequest(
      first.baseUrl,
      `/api/applications/${created.data.id}/communications/send`,
      firstToken,
      { method: 'POST', body: JSON.stringify(sendPayload) },
    )
    monitorMail = false
    expect(sent.response.status, JSON.stringify(sent.payload)).toBe(201)
    expect(sent.data.delivery).toMatchObject({ sent: true, delivery: 'smtp' })
    expect(sendMail.mock.calls.filter(([, message]) => (
      message.messageId === expectedMessageId
    ))).toHaveLength(1)
    expect(nestedHydrationWhileSending).toBe(false)
    expect(acquisitionTrace).toContainEqual({
      workClass: MEMORY_WORK_CLASS.HEAVY,
      bytes: 32 * MEBIBYTE,
    })
    expect(acquisitionTrace.some(({ bytes }) => bytes >= 96 * MEBIBYTE)).toBe(false)
    expect(reservationAtSmtp - reservationAtFinalize).toBe(32 * MEBIBYTE)
    expect(reservationAtFinalize).toBeLessThan(32 * MEBIBYTE)

    const accepted = await getOutgoingMailDeliveryResult(sent.data.communication.id)
    expect(accepted).toMatchObject({
      journalStatus: 'accepted',
      delivery: { sent: true, delivery: 'smtp', pendingFinalize: true },
    })

    await stopTestApp(first)
    await shutdownStorage()

    rssBytes = 200 * MEBIBYTE
    const second = await startTestApp()
    const secondToken = await login(second.baseUrl)
    const recovered = await jsonRequest(
      second.baseUrl,
      `/api/applications/${created.data.id}/communications/send`,
      secondToken,
      { method: 'POST', body: JSON.stringify(sendPayload) },
    )
    expect(recovered.response.status, JSON.stringify(recovered.payload)).toBe(200)
    expect(recovered.data.communication).toMatchObject({
      id: sent.data.communication.id,
      deliveryId: idempotencyKey,
      deliveryStatus: 'sent',
    })
    expect(recovered.data.delivery).toMatchObject({ sent: true, delivery: 'smtp' })
    expect(sendMail.mock.calls.filter(([, message]) => (
      message.messageId === expectedMessageId
    ))).toHaveLength(1)
    await expect(getOutgoingMailDeliveryResult(sent.data.communication.id)).resolves.toMatchObject({
      journalStatus: 'sent',
      communication: { deliveryStatus: 'sent' },
    })

    await stopTestApp(second)
  })

  it('invalidates a pre-send classification when SMTP projection changes classified content', async () => {
    sendMail.mockClear()
    sendMail.mockImplementation(async (_settings, message) => ({ messageId: message.messageId }))
    const running = await startTestApp()
    const token = await login(running.baseUrl)
    const configuredSmtp = await jsonRequest(running.baseUrl, '/api/settings', token, {
      method: 'PATCH',
      body: JSON.stringify({
        smtpHost: 'smtp.freshness.example.test',
        smtpPort: 587,
        smtpUser: 'admin@phd-atlas.local',
        smtpPass: 'test-only-freshness-secret',
        smtpTls: true,
      }),
    })
    expect(configuredSmtp.response.status, JSON.stringify(configuredSmtp.payload)).toBe(200)
    const created = await jsonRequest(running.baseUrl, '/api/applications', token, {
      method: 'POST',
      body: JSON.stringify({
        professor: 'Professor SMTP Freshness',
        professorChinese: '',
        professorEmail: 'smtp-freshness@example.edu',
        professorHomepage: '',
        university: `SMTP Freshness ${Date.now()}`,
        country: 'United Kingdom',
        website: '',
        program: 'Classification Freshness PhD',
        deadline: '2027-01-15',
        notes: '',
      }),
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
    cleanupApplicationIds.add(created.data.id)

    const queued = await jsonRequest(
      running.baseUrl,
      `/api/applications/${created.data.id}/communications/send`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          subject: 'Classify before scheduled send',
          summary: 'SMTP will replace the scheduled date and message type.',
          bodyFormat: 'plain',
          date: '2099-01-01',
          time: '12:00',
          sendAt: '2099-01-01T12:00:00.000Z',
          from: 'admin@phd-atlas.local',
          to: 'smtp-freshness@example.edu',
          idempotencyKey: `smtp-freshness-${Date.now()}`,
        }),
      },
    )
    expect(queued.response.status, JSON.stringify(queued.payload)).toBe(202)
    expect(queued.data.communication).toMatchObject({
      deliveryStatus: 'queued',
      messageType: 'scheduled-email',
      date: '2099-01-01',
    })

    await withWriteLock(async () => {
      const store = await readStore()
      const application = store.applications.find((item) => item.id === created.data.id)
      const communication = application?.communications.find((item) => (
        item.id === queued.data.communication.id
      ))
      expect(application).toBeTruthy()
      expect(communication).toBeTruthy()
      communication.mailClassification = {
        category: 'outreach',
        confidence: 0.9,
        summary: 'Scheduled outgoing message.',
        evidence: ['Classify before scheduled send'],
        actions: ['none'],
        source: 'rule',
        classifiedAt: '2026-08-02T18:30:00.000Z',
        inputHash: createCommunicationMailClassificationFingerprint(application, communication),
        version: 1,
      }
      // Make the already-authored queue item due without changing any field in
      // the classifier fingerprint. SMTP finalization owns the content change.
      communication.scheduledAt = '2000-01-01T00:00:00.000Z'
      await writeStore(store)
    })

    const finalized = await processOutgoingCommunication(queued.data.communication.id)
    expect(finalized).toMatchObject({
      communication: {
        deliveryStatus: 'sent',
        messageType: 'outgoing-email',
      },
      delivery: { sent: true, delivery: 'smtp' },
    })
    expect(finalized.communication).not.toHaveProperty('mailClassification')
    await expect(getOutgoingMailDeliveryResult(queued.data.communication.id)).resolves.not.toHaveProperty(
      'communication.mailClassification',
    )
    await withWriteLock(async () => {
      const store = await readStore()
      const application = store.applications.find((item) => item.id === created.data.id)
      const communication = application?.communications.find((item) => (
        item.id === queued.data.communication.id
      ))
      expect(communication).not.toHaveProperty('mailClassification')
    })
    await stopTestApp(running)
  })

  it('does not resend when the process disappears after SMTP success but before acceptance journaling', async () => {
    sendMail.mockClear()
    const first = await startTestApp({
      outgoingMailAfterSmtpAccepted: () => {
        throw new Error('Injected crash after SMTP returned success.')
      },
    })
    const token = await login(first.baseUrl)
    const created = await jsonRequest(first.baseUrl, '/api/applications', token, {
      method: 'POST',
      body: JSON.stringify({
        professor: 'Professor Ambiguous SMTP',
        professorChinese: '',
        professorEmail: 'smtp-ambiguous@example.edu',
        professorHomepage: '',
        university: `SMTP Ambiguous ${Date.now()}`,
        country: 'United Kingdom',
        website: '',
        program: 'Crash Boundary PhD',
        deadline: '2027-01-15',
        notes: '',
      }),
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
    cleanupApplicationIds.add(created.data.id)

    const idempotencyKey = `smtp-ambiguous-${Date.now()}`
    const expectedMessageId = outgoingDeliveryMessageId(idempotencyKey)
    sendMail.mockImplementation(async (_settings, message) => ({ messageId: message.messageId }))
    const sendPayload = {
      subject: 'SMTP ambiguity crash probe',
      summary: 'SMTP returns, then the process disappears before journal acceptance.',
      bodyFormat: 'plain',
      date: '2026-08-02',
      time: '19:00',
      from: 'admin@phd-atlas.local',
      to: 'smtp-ambiguous@example.edu',
      idempotencyKey,
    }
    const interrupted = await jsonRequest(
      first.baseUrl,
      `/api/applications/${created.data.id}/communications/send`,
      token,
      { method: 'POST', body: JSON.stringify(sendPayload) },
    )
    expect(interrupted.response.status, JSON.stringify(interrupted.payload)).toBe(202)
    expect(interrupted.data.communication).toMatchObject({
      deliveryStatus: 'sending',
      deliveryLastErrorCode: 'SMTP_OUTCOME_UNKNOWN',
    })
    expect(interrupted.data.delivery).toMatchObject({
      sent: false,
      delivery: 'ambiguous',
      outcomeUnknown: true,
      requiresReconciliation: true,
    })
    expect(sendMail.mock.calls.filter(([, message]) => (
      message.messageId === expectedMessageId
    ))).toHaveLength(1)

    await stopTestApp(first)
    await shutdownStorage()

    const second = await startTestApp()
    const secondToken = await login(second.baseUrl)
    const recovered = await jsonRequest(
      second.baseUrl,
      `/api/applications/${created.data.id}/communications/send`,
      secondToken,
      { method: 'POST', body: JSON.stringify(sendPayload) },
    )
    expect(recovered.response.status, JSON.stringify(recovered.payload)).toBe(200)
    expect(recovered.data.delivery).toMatchObject({
      sent: false,
      delivery: 'ambiguous',
      outcomeUnknown: true,
      requiresReconciliation: true,
    })
    expect(sendMail.mock.calls.filter(([, message]) => (
      message.messageId === expectedMessageId
    ))).toHaveLength(1)
    await expect(getOutgoingMailDeliveryResult(interrupted.data.communication.id)).resolves.toMatchObject({
      journalStatus: 'sending',
      delivery: { delivery: 'ambiguous', requiresReconciliation: true },
    })
    await stopTestApp(second)
  })

  it('applies the same durable ambiguity boundary to system email', async () => {
    sendMail.mockClear()
    await withWriteLock(async () => {
      const store = await readStore()
      store.settings = {
        ...store.settings,
        smtpHost: 'smtp-system.example.test',
        smtpPort: 587,
        smtpUser: 'system@phd-atlas.local',
        smtpPass: 'test-only-system-smtp-secret',
        smtpTls: true,
        notificationMailbox: 'system@phd-atlas.local',
      }
      await writeStore(store)
    })
    const queued = await enqueueSystemMailJob({
      dedupeKey: `system-ambiguous-${Date.now()}`,
      kind: 'recovery-test',
      to: 'recipient@example.edu',
      subject: 'System SMTP ambiguity probe',
      text: 'Do not deliver this job twice.',
      scope: 'System mail test',
      metadata: { test: true },
    })
    sendMail.mockImplementation(async (_settings, message) => ({ messageId: message.messageId }))

    const interrupted = await processSystemMailJob(queued.job.id, {
      afterSmtpAccepted: () => {
        throw new Error('Injected system-mail crash after SMTP success.')
      },
    })
    expect(interrupted).toMatchObject({
      status: 'sending',
      lastErrorCode: 'SMTP_OUTCOME_UNKNOWN',
    })
    expect(interrupted.dispatchStartedAt).toEqual(expect.any(String))
    expect(sendMail.mock.calls.filter(([, message]) => (
      message.messageId === queued.job.messageId
    ))).toHaveLength(1)

    await shutdownStorage()
    await ensureStorage()
    const recovered = await processSystemMailJob(queued.job.id)
    expect(recovered).toMatchObject({
      status: 'sending',
      lastErrorCode: 'SMTP_OUTCOME_UNKNOWN',
    })
    expect(sendMail.mock.calls.filter(([, message]) => (
      message.messageId === queued.job.messageId
    ))).toHaveLength(1)
    await expect(getSystemMailJob(queued.job.id)).resolves.toMatchObject({
      status: 'sending',
      dispatchStartedAt: expect.any(String),
    })
  })

  it('keeps large application projection and SMTP leases sequential and projects SMTP settings narrowly', async () => {
    configureStoreHydrationMemoryAdmission(null)
    const stamp = Date.now()
    const applicationId = `large-smtp-app-${stamp}`
    const communicationId = `large-smtp-comm-${stamp}`
    const deliveryId = `large-smtp-delivery-${stamp}`
    const now = new Date().toISOString()
    await withWriteLock(async () => {
      const store = await readStore()
      const owner = store.users.find((user) => user.email === 'admin@phd-atlas.local')
      const source = store.applications[0]
      expect(owner).toBeTruthy()
      expect(source).toBeTruthy()
      owner.settings = {
        ...owner.settings,
        smtpHost: 'smtp.large-projection.example.test',
        smtpPort: 587,
        smtpUser: 'admin@phd-atlas.local',
        smtpPass: 'test-only-large-projection-secret',
        smtpTls: true,
        sendFrom: 'admin@phd-atlas.local',
        notificationMailbox: 'admin@phd-atlas.local',
        largeSettingsProjectionProbe: 's'.repeat(8 * MEBIBYTE),
      }
      store.applications.push({
        ...structuredClone(source),
        id: applicationId,
        ownerId: owner.id,
        teamId: null,
        school: { ...source.school, name: 'Large SMTP Projection University' },
        professor: {
          ...source.professor,
          english: 'Professor Large Projection',
          email: 'large-projection@example.edu',
        },
        program: 'Bounded SMTP Projection PhD',
        largeProjectionProbe: 'a'.repeat(28 * MEBIBYTE),
        communications: [{
          id: communicationId,
          subject: 'Large application focused delivery',
          summary: 'The worker must not hydrate the containing application before SMTP.',
          bodyFormat: 'plain',
          bodyHtml: '<p>The worker must not hydrate the containing application before SMTP.</p>',
          bodyText: 'The worker must not hydrate the containing application before SMTP.',
          channel: 'Email',
          date: now.slice(0, 10),
          time: now.slice(11, 16),
          direction: 'outgoing',
          messageType: 'outgoing-email',
          from: 'admin@phd-atlas.local',
          to: 'large-projection@example.edu',
          attachments: [],
          deliveryStatus: 'queued',
          scheduledAt: now,
          deliveryId,
          deliveryUserId: owner.id,
          deliveryAttemptCount: 0,
        }],
        createdAt: now,
        updatedAt: now,
      })
      await writeStore(store)
    })
    cleanupApplicationIds.add(applicationId)

    const guard = createMemoryPressureGuard({
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => 300 * MEBIBYTE,
      recoverySamples: 1,
    })
    const baseLedger = createMemoryReservationLedger({ memoryPressureGuard: guard })
    const acquisitions = []
    let smtpLeaseActive = false
    const ledger = {
      admit: (...args) => baseLedger.admit(...args),
      snapshot: () => baseLedger.snapshot(),
      acquire(workClass, bytes) {
        acquisitions.push({ workClass, bytes, whileSmtp: smtpLeaseActive })
        const lease = baseLedger.acquire(workClass, bytes)
        if (lease.allowed && workClass === MEMORY_WORK_CLASS.HEAVY) {
          smtpLeaseActive = true
          const release = lease.release
          lease.release = () => {
            smtpLeaseActive = false
            release()
          }
        }
        return lease
      },
    }
    configureStoreHydrationMemoryAdmission((bytes) => {
      const lease = ledger.acquire(MEMORY_WORK_CLASS.STANDARD, bytes)
      if (!lease.allowed) throw new Error(`Unexpected storage-memory denial for ${bytes} bytes.`)
      return lease.release
    })

    let projectedSmtpSettings = null
    sendMail.mockImplementation(async (settings, message) => {
      projectedSmtpSettings = settings
      return { messageId: message.messageId }
    })
    try {
      const result = await processOutgoingCommunication(communicationId, {
        memoryReservationLedger: ledger,
        memoryReservationBytes: 32 * MEBIBYTE,
      })
      expect(result).toMatchObject({
        communication: { id: communicationId, deliveryStatus: 'sent' },
        delivery: { sent: true, delivery: 'smtp' },
      })
      expect(projectedSmtpSettings).toMatchObject({
        smtpHost: 'smtp.large-projection.example.test',
        smtpUser: 'admin@phd-atlas.local',
      })
      expect(Object.keys(projectedSmtpSettings).sort()).toEqual([
        'notificationMailbox',
        'sendFrom',
        'smtpHost',
        'smtpPass',
        'smtpPort',
        'smtpTls',
        'smtpUser',
      ])
      expect(projectedSmtpSettings).not.toHaveProperty('largeSettingsProjectionProbe')
      expect(acquisitions).toContainEqual({
        workClass: MEMORY_WORK_CLASS.HEAVY,
        bytes: 32 * MEBIBYTE,
        whileSmtp: false,
      })
      expect(acquisitions.some(({ workClass, bytes }) => (
        workClass === MEMORY_WORK_CLASS.STANDARD && bytes >= 80 * MEBIBYTE
      ))).toBe(true)
      expect(acquisitions.some(({ workClass, whileSmtp }) => (
        workClass === MEMORY_WORK_CLASS.STANDARD && whileSmtp
      ))).toBe(false)
      expect(baseLedger.snapshot().reservedBytes).toBe(0)
    } finally {
      configureStoreHydrationMemoryAdmission(null)
    }
  }, 60_000)
})
