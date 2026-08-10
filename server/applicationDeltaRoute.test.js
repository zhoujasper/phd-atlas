import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import {
  APPLICATION_MUTATION_ACK_PROTOCOL,
  applyApplicationMutationAcknowledgement,
  applicationAuthoredContentHash,
  canonicalValueHash,
} from '../src/applicationMutationAcknowledgement.ts'
import {
  applicationCreateAcknowledgementCandidate,
  applicationUserEditablePersistenceProjection,
} from '../shared/applicationPersistenceProtocol.js'

let app
let server
let baseUrl

async function startServer() {
  app = createApp()
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
}

async function stopServer() {
  await app?.locals.stopPersistedMailSyncWorker?.()
  await app?.locals.stopRecurringTasks?.()
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

async function jsonRequest(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json()
  return { response, data: payload.data, payload }
}

async function loginAdmin() {
  const login = await jsonRequest('/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@phd-atlas.local',
      password: 'admin123456',
    }),
  })
  expect(login.response.status, JSON.stringify(login.payload)).toBe(200)
  return login.data.token
}

async function purgeApplication(token, applicationId) {
  await jsonRequest(`/api/applications/${encodeURIComponent(applicationId)}`, token, {
    method: 'DELETE',
  }).catch(() => undefined)
  const trash = await jsonRequest('/api/applications/trash', token).catch(() => null)
  for (const item of trash?.data ?? []) {
    if (item.application?.id !== applicationId) continue
    await jsonRequest(`/api/applications/trash/${encodeURIComponent(item.id)}`, token, {
      method: 'DELETE',
    }).catch(() => undefined)
  }
}

describe.sequential('application delta route durability', () => {
  beforeAll(startServer)
  afterAll(stopServer)

  it('saves a tiny CAS delta for a >1 MiB application and survives a server restart', async () => {
    let token = await loginAdmin()
    const createInput = {
      professor: 'Professor Delta',
      professorChinese: '',
      professorEmail: 'delta@example.edu',
      professorHomepage: '',
      university: `Delta University ${Date.now()}`,
      country: 'United Kingdom',
      website: '',
      program: 'Large workspace delta durability',
      deadline: '2027-01-15',
      // The request remains below the 1 MiB body cap, while buildApplication
      // legitimately reuses notes in three authored locations and creates a
      // canonical application above the response cap.
      notes: `Before delta:${'z'.repeat(400 * 1_024)}`,
    }
    const created = await jsonRequest('/api/applications', token, {
      method: 'POST',
      body: JSON.stringify(createInput),
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
    expect(created.data.protocol).toBe(APPLICATION_MUTATION_ACK_PROTOCOL)
    const createdApplication = await applyApplicationMutationAcknowledgement(
      created.data,
      applicationCreateAcknowledgementCandidate(createInput),
      {
        baseUpdatedAt: null,
        operationCount: 0,
        mutationHash: await canonicalValueHash(createInput),
        authorityPurpose: 'create',
      },
    )
    expect(Buffer.byteLength(JSON.stringify(created.payload), 'utf8')).toBeLessThan(32 * 1_024)
    const applicationPath = `/api/applications/${encodeURIComponent(createdApplication.id)}`

    try {
      const large = await jsonRequest(applicationPath, token)
      expect(large.response.status, JSON.stringify(large.payload).slice(0, 1_000)).toBe(200)
      expect(Buffer.byteLength(JSON.stringify(large.data), 'utf8')).toBeGreaterThan(1 * 1_024 * 1_024)

      const logoInput = {
        logo: {
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          source: 'website',
          sourceUrl: 'https://example.edu/logo.png',
          websiteUrl: 'https://example.edu/',
          updatedAt: '2026-08-02T10:00:00.000Z',
        },
        autoDetect: false,
      }
      const logoBaseline = {
        ...large.data,
        school: {
          ...large.data.school,
          logo: { ...logoInput.logo },
          logoAutoDetect: false,
        },
      }
      const logoSaved = await jsonRequest(`${applicationPath}/school-logo`, token, {
        method: 'PATCH',
        body: JSON.stringify(logoInput),
      })
      expect(logoSaved.response.status, JSON.stringify(logoSaved.payload)).toBe(200)
      expect(logoSaved.data.authorityPurpose).toBe('school-logo')
      expect(Buffer.byteLength(JSON.stringify(logoSaved.payload), 'utf8')).toBeLessThan(4 * 1_024)
      const withLogo = await applyApplicationMutationAcknowledgement(
        logoSaved.data,
        logoBaseline,
        {
          baseUpdatedAt: large.data.updatedAt,
          operationCount: 0,
          mutationHash: await canonicalValueHash(logoInput),
          authorityPurpose: 'school-logo',
        },
      )
      expect(withLogo.school.logo?.dataUrl).toBe(logoInput.logo.dataUrl)

      const deltaBody = JSON.stringify({
        baseUpdatedAt: withLogo.updatedAt,
        operations: [{ op: 'replace', path: '/program', value: 'Durably saved through delta' }],
      })
      expect(Buffer.byteLength(deltaBody, 'utf8')).toBeLessThan(512)
      const saved = await jsonRequest(`${applicationPath}/delta`, token, {
        method: 'PATCH',
        body: deltaBody,
      })
      expect(saved.response.status, JSON.stringify(saved.payload)).toBe(200)
      expect(saved.data).toMatchObject({
        protocol: APPLICATION_MUTATION_ACK_PROTOCOL,
        id: createdApplication.id,
        durable: true,
      })
      expect(saved.data.updatedAt).not.toBe(withLogo.updatedAt)
      const operations = [{ op: 'replace', path: '/program', value: 'Durably saved through delta' }]
      const submitted = { ...withLogo, program: 'Durably saved through delta' }
      const mutationHash = await canonicalValueHash(operations)
      expect(saved.data).toMatchObject({
        baseUpdatedAt: withLogo.updatedAt,
        operationCount: 1,
        mutationHash,
      })
      expect(Buffer.byteLength(JSON.stringify(saved.payload), 'utf8')).toBeLessThan(32 * 1_024)
      const canonical = await applyApplicationMutationAcknowledgement(
        saved.data,
        submitted,
        {
          baseUpdatedAt: withLogo.updatedAt,
          operationCount: 1,
          mutationHash,
        },
      )
      expect(canonical.program).toBe('Durably saved through delta')
      expect(await applicationAuthoredContentHash(canonical)).toBe(saved.data.applicationHash)

      const stale = await jsonRequest(`${applicationPath}/delta`, token, {
        method: 'PATCH',
        body: deltaBody,
      })
      expect(stale.response.status, JSON.stringify(stale.payload)).toBe(409)
      expect(stale.payload).toMatchObject({ error: { code: 'APPLICATION_VERSION_CONFLICT' } })

      const afterDuplicateRetry = await jsonRequest(applicationPath, token)
      expect(afterDuplicateRetry.response.status, JSON.stringify(afterDuplicateRetry.payload)).toBe(200)
      expect(afterDuplicateRetry.data.updatedAt).toBe(saved.data.updatedAt)
      expect(afterDuplicateRetry.data.program).toBe('Durably saved through delta')

      const protectedMutation = await jsonRequest(`${applicationPath}/delta`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          baseUpdatedAt: saved.data.updatedAt,
          operations: [{ op: 'replace', path: '/ownerId', value: 'attacker' }],
        }),
      })
      expect(protectedMutation.response.status, JSON.stringify(protectedMutation.payload)).toBe(400)
      expect(protectedMutation.payload).toMatchObject({ error: { code: 'APPLICATION_DELTA_INVALID' } })

      await stopServer()
      await startServer()
      token = await loginAdmin()
      const restored = await jsonRequest(applicationPath, token)
      expect(restored.response.status, JSON.stringify(restored.payload).slice(0, 1_000)).toBe(200)
      expect(restored.data.program).toBe('Durably saved through delta')
      expect(restored.data.school.logo?.dataUrl).toBe(logoInput.logo.dataUrl)
      expect(restored.data.ownerId).toBe(large.data.ownerId)
    } finally {
      await purgeApplication(token, createdApplication.id)
    }
  }, 120_000)

  it('round-trips legacy PUT and trash restore through compact verifiable receipts', async () => {
    const token = await loginAdmin()
    const createInput = {
      professor: 'Professor Receipt',
      professorChinese: '',
      professorEmail: 'receipt@example.edu',
      professorHomepage: '',
      university: `Receipt University ${Date.now()}`,
      country: 'United Kingdom',
      website: '',
      program: 'Receipt baseline',
      deadline: '2027-02-15',
      notes: 'Small application for whole-record compatibility.',
    }
    const created = await jsonRequest('/api/applications', token, {
      method: 'POST',
      body: JSON.stringify(createInput),
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
    const initial = await applyApplicationMutationAcknowledgement(
      created.data,
      applicationCreateAcknowledgementCandidate(createInput),
      {
        baseUpdatedAt: null,
        operationCount: 0,
        mutationHash: await canonicalValueHash(createInput),
        authorityPurpose: 'create',
      },
    )
    const applicationPath = `/api/applications/${encodeURIComponent(initial.id)}`

    try {
      const initialReadback = await jsonRequest(applicationPath, token)
      expect(applicationUserEditablePersistenceProjection(initial)).toEqual(
        applicationUserEditablePersistenceProjection(initialReadback.data),
      )
      const submitted = { ...initial, program: 'Legacy PUT durably saved' }
      const baselineHash = await applicationAuthoredContentHash(submitted)
      const put = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify(submitted),
        headers: { 'X-PhD-Application-Baseline-Hash': baselineHash },
      })
      expect(put.response.status, JSON.stringify(put.payload)).toBe(200)
      expect(put.data.authorityPurpose).toBe('none')
      expect(Buffer.byteLength(JSON.stringify(put.payload), 'utf8')).toBeLessThan(32 * 1_024)
      const canonical = await applyApplicationMutationAcknowledgement(
        put.data,
        submitted,
        {
          baseUpdatedAt: initial.updatedAt,
          operationCount: 0,
          mutationHash: baselineHash,
        },
      )
      expect(canonical.program).toBe('Legacy PUT durably saved')

      const deleted = await jsonRequest(applicationPath, token, { method: 'DELETE' })
      expect(deleted.response.status, JSON.stringify(deleted.payload)).toBe(200)
      expect(deleted.data.trashed).toBe(true)
      const trash = await jsonRequest('/api/applications/trash', token)
      const trashItem = trash.data.find((item) => item.id === deleted.data.trashId)
      expect(trashItem?.application.id).toBe(initial.id)
      const restored = await jsonRequest(
        `/api/applications/trash/${encodeURIComponent(trashItem.id)}/restore`,
        token,
        { method: 'POST' },
      )
      expect(restored.response.status, JSON.stringify(restored.payload)).toBe(200)
      expect(restored.data.authorityPurpose).toBe('trash-restore')
      const restoredCanonical = await applyApplicationMutationAcknowledgement(
        restored.data,
        trashItem.application,
        {
          baseUpdatedAt: trashItem.application.updatedAt,
          operationCount: 0,
          mutationHash: await canonicalValueHash(null),
          authorityPurpose: 'trash-restore',
        },
      )
      expect(restoredCanonical.deletedAt).toBeUndefined()
      expect(restoredCanonical.program).toBe('Legacy PUT durably saved')
      const readback = await jsonRequest(applicationPath, token)
      expect(readback.data.updatedAt).toBe(restoredCanonical.updatedAt)
    } finally {
      await purgeApplication(token, initial.id)
    }
  }, 120_000)
})
