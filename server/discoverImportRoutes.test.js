import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import { defaultDiscoverState } from './discover-catalog.js'
import {
  readStore,
  withWriteLock,
  writeStore,
} from './storage.js'

const IMPORT_USER_EMAIL = 'discover-import-advisor@example.test'

let server
let baseUrl

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

async function login(email = IMPORT_USER_EMAIL, password = 'demo123456') {
  const { response, data, payload } = await jsonRequest('/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email, password, scope: 'app' }),
  })
  expect(response.status, JSON.stringify(payload)).toBe(200)
  return data.token
}

describe('Discover import advisor warnings', () => {
  beforeAll(async () => {
    await withWriteLock(async () => {
      const store = await readStore()
      const template = store.users.find((candidate) => candidate.email === 'jasper@example.com')
      if (!template) throw new Error('Discover import test account template is unavailable.')
      store.users = store.users.filter((candidate) => candidate.email !== IMPORT_USER_EMAIL)
      store.users.push({
        ...structuredClone(template),
        id: 'user_discover_import_advisor',
        email: IMPORT_USER_EMAIL,
        canonicalEmail: IMPORT_USER_EMAIL,
        recoveryEmail: IMPORT_USER_EMAIL,
        name: 'Discover Import Advisor',
        settings: {
          ...structuredClone(template.settings ?? {}),
          membershipPlan: 'pro',
          personalMembershipPlan: 'pro',
          discover: {
            ...defaultDiscoverState(),
            customPrograms: [{
              id: 'prog_import_unverified_advisor',
              school: 'Import Test University',
              program: 'Computational Neuroscience PhD',
              country: 'United Kingdom',
              website: 'https://import-test.example.edu/phd',
              sources: ['https://import-test.example.edu/phd'],
              provenance: 'ai',
              verification: {
                status: 'partial',
                officialSourceCount: 1,
                advisorSourceCount: 1,
                checkedAt: '2026-08-22T00:00:00.000Z',
                issues: [],
              },
              pis: [{
                id: 'pi_import_unverified',
                name: 'Dr Unverified Advisor',
                url: 'https://import-test.example.edu/people/advisor',
                email: '',
              }],
            }],
          },
        },
      })
      await writeStore(store)
    })
    server = createApp().listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await withWriteLock(async () => {
      const store = await readStore()
      store.users = store.users.filter((candidate) => candidate.email !== IMPORT_USER_EMAIL)
      store.applications = store.applications.filter(
        (application) => application.ownerId !== 'user_discover_import_advisor',
      )
      await writeStore(store)
    })
  })

  it('adds a program without a verified advisor email and returns a reminder instead of 409', async () => {
    const token = await login()
    const { response, data, payload } = await jsonRequest('/api/discover/import', token, {
      method: 'POST',
      body: JSON.stringify({
        programId: 'prog_import_unverified_advisor',
        piId: 'pi_import_unverified',
        includeNotes: true,
      }),
    })

    expect(response.status, JSON.stringify(payload)).toBe(201)
    expect(data.warnings).toEqual(expect.arrayContaining(['missingAdvisor']))
    expect(data.programId).toBe('prog_import_unverified_advisor')
    expect(data.piId).toBe('pi_import_unverified')
    expect(data.applicationAcknowledgement?.id).toEqual(expect.any(String))

    const application = await jsonRequest(
      `/api/applications/${encodeURIComponent(data.applicationAcknowledgement.id)}`,
      token,
    )
    expect(application.response.status, JSON.stringify(application.payload)).toBe(200)
    expect(application.data.professor.english).toBe('Dr Unverified Advisor')
    expect(application.data.professor.email).toBe('')
    expect(application.data.school.name).toBe('Import Test University')
    expect(application.data.program).toBe('Computational Neuroscience PhD')
  })
})
