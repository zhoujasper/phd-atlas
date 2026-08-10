import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import { canonicalApplicationProjectionDigest } from './applicationMutationAck.js'
import { lockedWriteStore, readStore } from './storage.js'
import { APPLICATION_AUTHORED_PROJECTION_VERSION } from '../shared/applicationAuthorityFields.js'

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
    body: JSON.stringify({ email: 'admin@phd-atlas.local', password: 'admin123456' }),
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

const WEBSITE_LOGO = {
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  source: 'website',
  sourceUrl: 'https://example.edu/logo.png',
  websiteUrl: 'https://example.edu/',
  updatedAt: '2026-08-02T10:00:00.000Z',
}

async function createApplication(token, overrides = {}) {
  const created = await jsonRequest('/api/applications', token, {
    method: 'POST',
    body: JSON.stringify({
      professor: 'Professor Canonical',
      professorChinese: '',
      professorEmail: 'canonical@example.edu',
      professorHomepage: '',
      university: `Canonical University ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      country: 'United Kingdom',
      website: 'https://example.edu/',
      program: 'Canonical guard',
      deadline: '2027-01-15',
      ...overrides,
    }),
  })
  expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
  return created.data.id
}

describe.sequential('application delta canonical guard', () => {
  beforeAll(startServer)
  afterAll(stopServer)

  it('accepts a school edit that makes the server drop a stale auto-detected logo', async () => {
    const token = await loginAdmin()
    const applicationId = await createApplication(token)
    const path = `/api/applications/${encodeURIComponent(applicationId)}`

    try {
      // A website-sourced logo with no explicit logoAutoDetect is exactly the
      // state the server rewrites when the school identity changes.
      const loaded = await jsonRequest(path, token)
      expect(loaded.response.status).toBe(200)
      const withLogo = await jsonRequest(path, token, {
        method: 'PUT',
        body: JSON.stringify({
          ...loaded.data,
          school: { ...loaded.data.school, logo: { ...WEBSITE_LOGO } },
        }),
      })
      expect(withLogo.response.status, JSON.stringify(withLogo.payload)).toBe(200)

      const beforeEdit = await jsonRequest(path, token)
      expect(beforeEdit.data.school.logo?.source).toBe('website')
      expect(beforeEdit.data.school.logoAutoDetect).toBeUndefined()

      // Changing the website invalidates that logo, so the server strips it and
      // stamps logoAutoDetect. Server-owned logo bookkeeping is not a field the
      // submitter lost, so the save must still succeed.
      const saved = await jsonRequest(`${path}/delta`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          baseUpdatedAt: beforeEdit.data.updatedAt,
          operations: [{ op: 'replace', path: '/school/website', value: 'https://moved.example.edu/' }],
        }),
      })

      expect(saved.response.status, JSON.stringify(saved.payload)).toBe(200)
      const after = await jsonRequest(path, token)
      expect(after.data.school.website).toBe('https://moved.example.edu/')
      expect(after.data.school.logo).toBeUndefined()
    } finally {
      await purgeApplication(token, applicationId)
    }
  }, 60_000)

  it('accepts every ordinary dossier edit without reporting lost fields', async () => {
    const token = await loginAdmin()
    const applicationId = await createApplication(token)
    const path = `/api/applications/${encodeURIComponent(applicationId)}`

    // One edit per field a person actually types into, applied in sequence
    // against the record the previous edit produced.
    const edits = [
      { op: 'replace', path: '/school/website', value: 'https://renamed.example.edu/' },
      { op: 'replace', path: '/school/name', value: 'Renamed University' },
      { op: 'replace', path: '/professor/homepage', value: 'https://example.edu/~prof' },
      // Optional fields are absent on a fresh record, so filling one in is an
      // `add` — exactly what buildApplicationDelta emits for a first-time value.
      { op: 'add', path: '/professor/labUrl', value: 'https://example.edu/lab' },
      { op: 'add', path: '/professor/projectUrl', value: 'https://example.edu/project' },
      { op: 'replace', path: '/professor/email', value: 'renamed@example.edu' },
      { op: 'replace', path: '/professor/phone', value: '+44 20 7000 0000' },
      { op: 'replace', path: '/program', value: 'Renamed programme' },
      { op: 'replace', path: '/deadline', value: '2027-03-01' },
      { op: 'replace', path: '/professor/research', value: 'A research note with  irregular   spacing ' },
      { op: 'replace', path: '/tags', value: ['alpha', 'beta'] },
      { op: 'replace', path: '/status', value: 'Submitted' },
      { op: 'replace', path: '/priority', value: 4 },
    ]

    try {
      for (const operation of edits) {
        const current = await jsonRequest(path, token)
        expect(current.response.status).toBe(200)
        const saved = await jsonRequest(`${path}/delta`, token, {
          method: 'PATCH',
          body: JSON.stringify({
            baseUpdatedAt: current.data.updatedAt,
            operations: [operation],
          }),
        })
        expect(
          saved.response.status,
          `${operation.path} was rejected: ${JSON.stringify(saved.payload)}`,
        ).toBe(200)
      }

      const final = await jsonRequest(path, token)
      expect(final.data.school.website).toBe('https://renamed.example.edu/')
      expect(final.data.professor.labUrl).toBe('https://example.edu/lab')
      expect(final.data.program).toBe('Renamed programme')
      expect(final.data.tags).toEqual(['alpha', 'beta'])
    } finally {
      await purgeApplication(token, applicationId)
    }
  }, 120_000)

  it('rejects an outdated editor and accepts only the current projection', async () => {
    const token = await loginAdmin()
    const applicationId = await createApplication(token)
    const path = `/api/applications/${encodeURIComponent(applicationId)}`

    try {
      const store = await readStore()
      const seeded = store.applications.find((candidate) => candidate.id === applicationId)
      expect(seeded).toBeTruthy()
      seeded.communications = [{
        id: 'comm_cached_projection',
        subject: 'Application decision',
        channel: 'Email',
        date: '2026-08-09',
        summary: 'A server-owned message snapshot',
        direction: 'incoming',
        messageType: 'fetched-email',
        from: 'admissions@example.edu',
        to: 'applicant@example.com',
        time: '09:30',
        attachments: [],
        bodyFormat: 'html',
        bodyHtml: '<p>Offer details</p>',
        bodyText: 'Offer details',
        sourceMessageKey: 'cached-projection-message',
        sourceMailbox: 'INBOX',
        importedAt: '2026-08-09T09:30:00.000Z',
      }]
      seeded.updatedAt = new Date(Date.now() + 1_000).toISOString()
      await lockedWriteStore(store)

      const outdatedBase = await jsonRequest(path, token)
      expect(outdatedBase.response.status).toBe(200)
      expect(outdatedBase.data.communications[0].bodyHtml).toBe('<p>Offer details</p>')
      const outdated = await jsonRequest(`${path}/delta`, token, {
        method: 'PATCH',
        headers: {
          'X-PhD-Application-Acknowledgement': 'v2',
        },
        body: JSON.stringify({
          baseUpdatedAt: outdatedBase.data.updatedAt,
          operations: [{ op: 'replace', path: '/program', value: 'Must not persist' }],
        }),
      })
      expect(outdated.response.status).toBe(409)
      expect(outdated.payload).toMatchObject({
        error: { code: 'APPLICATION_MUTATION_PROJECTION_UNSUPPORTED' },
      })

      const currentBase = await jsonRequest(path, token)
      expect(currentBase.data.program).not.toBe('Must not persist')
      const unsupported = await jsonRequest(`${path}/delta`, token, {
        method: 'PATCH',
        headers: {
          'X-PhD-Application-Acknowledgement': 'v2',
          'X-PhD-Application-Projection-Version': '99',
        },
        body: JSON.stringify({
          baseUpdatedAt: currentBase.data.updatedAt,
          operations: [{ op: 'replace', path: '/program', value: 'Must not persist' }],
        }),
      })
      expect(unsupported.response.status).toBe(409)
      expect(unsupported.payload).toMatchObject({
        error: { code: 'APPLICATION_MUTATION_PROJECTION_UNSUPPORTED' },
      })

      const currentTarget = { ...currentBase.data, program: 'Saved by current v2 editor' }
      const currentHash = canonicalApplicationProjectionDigest(currentTarget)
      const currentSaved = await jsonRequest(`${path}/delta`, token, {
        method: 'PATCH',
        headers: {
          'X-PhD-Application-Acknowledgement': 'v2',
          'X-PhD-Application-Projection-Version': String(APPLICATION_AUTHORED_PROJECTION_VERSION),
          'X-PhD-Application-Baseline-Hash': currentHash,
        },
        body: JSON.stringify({
          baseUpdatedAt: currentBase.data.updatedAt,
          operations: [{ op: 'replace', path: '/program', value: currentTarget.program }],
        }),
      })
      expect(currentSaved.response.status, JSON.stringify(currentSaved.payload)).toBe(200)
      expect(currentSaved.data).toMatchObject({
        projectionVersion: APPLICATION_AUTHORED_PROJECTION_VERSION,
        baselineHash: currentHash,
      })

      const final = await jsonRequest(path, token)
      expect(final.data.program).toBe('Saved by current v2 editor')
      expect(final.data.communications[0].bodyHtml).toBe('<p>Offer details</p>')
    } finally {
      await purgeApplication(token, applicationId)
    }
  }, 60_000)

  it('still refuses a delta whose submitted key the schema strips', async () => {
    const token = await loginAdmin()
    const applicationId = await createApplication(token)
    const path = `/api/applications/${encodeURIComponent(applicationId)}`

    try {
      const current = await jsonRequest(path, token)
      // The application has no top-level `notes`, so the schema drops it. That
      // is a real silent loss and must still be reported, even though the
      // normalized submission and the saved record agree about it.
      const rejected = await jsonRequest(`${path}/delta`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          baseUpdatedAt: current.data.updatedAt,
          operations: [{ op: 'add', path: '/notes', value: 'This field does not exist.' }],
        }),
      })

      expect(rejected.response.status, JSON.stringify(rejected.payload)).toBe(409)
      expect(rejected.payload).toMatchObject({
        error: { code: 'APPLICATION_DELTA_CANONICAL_MISMATCH' },
      })
    } finally {
      await purgeApplication(token, applicationId)
    }
  }, 60_000)

  it('still refuses a delta whose submitted value the server would not keep', async () => {
    const token = await loginAdmin()
    const applicationId = await createApplication(token)
    const path = `/api/applications/${encodeURIComponent(applicationId)}`

    try {
      const loaded = await jsonRequest(path, token)
      // ownerId is server-authority: the delta layer rejects it outright, which
      // is the guarantee the canonical guard exists to back up.
      const rejected = await jsonRequest(`${path}/delta`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          baseUpdatedAt: loaded.data.updatedAt,
          operations: [{ op: 'replace', path: '/ownerId', value: 'someone-else' }],
        }),
      })
      expect(rejected.response.status).toBe(400)
      expect(rejected.payload).toMatchObject({ error: { code: 'APPLICATION_DELTA_INVALID' } })
    } finally {
      await purgeApplication(token, applicationId)
    }
  }, 60_000)
})
