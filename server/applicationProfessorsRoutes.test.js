import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { emptyProfessor } from './shared/applicationProfessors.js'
import { createApplicationAcknowledged } from '../src/api/applicationMutationRoutes.ts'

let app, server, storage, testRoot, baseUrl, token, ownerId
const profile = (id, email) => ({ ...emptyProfessor(), id, english: `Professor ${id}`, email, research: `Research ${id}` })

async function request(route, auth, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', connection: 'close',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(options.headers ?? {}) },
  })
  const payload = await response.json()
  if (!response.ok) throw Object.assign(new Error(JSON.stringify(payload.error)), { status: response.status })
  return payload.data
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-professors-http-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', randomBytes(48).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const store = await storage.readStore()
  const owner = store.users.find((user) => user.email === 'jasper@example.com')
  ownerId = owner.id
  owner.settings.applicationCreatedCount = 0
  owner.settings.shareCreatedCount = 0
  store.users.push({ ...structuredClone(owner), id: 'foreign-owner', email: 'other@example.test' })
  store.applications = store.applications.filter((application) => application.ownerId !== ownerId)
  await storage.writeStore(store)
  app = (await import('./index.js')).createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  token = (await request('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ email: 'jasper@example.com', password: 'demo123456' }) })).token
}, 90_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve) => server.close(resolve))
  await storage?.shutdownStorage()
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 90_000)

describe.sequential('multi-supervisor application persistence', () => {
  it('acknowledges complete profiles, persists edits, counts all addresses and duplicates independently', async () => {
    const first = profile('first', 'first@example.edu')
    const second = { ...profile('second', 'second@example.edu'), correspondenceEmails: ['lab@example.edu'], labUrl: 'https://example.edu/lab' }
    const input = { professor: first.english, professorChinese: '', professorEmail: first.email, professorHomepage: '',
      professorProfile: first, additionalProfessors: [second], university: 'One University', country: '', website: '', program: 'CS PhD', deadline: '', notes: '' }
    const create = (body) => createApplicationAcknowledged(request, (message) => new Error(message), token, body)
    const created = await create(input)
    expect(created.additionalProfessors).toEqual([second])
    const reread = await request(`/api/applications/${created.id}`, token)
    expect(reread.additionalProfessors[0].labUrl).toBe(second.labUrl)
    expect(await storage.readFocusedTrackedProfessorAddressCount(ownerId)).toBe(3)

    const updated = { ...reread, additionalProfessors: [{ ...second, research: 'Updated second research' }] }
    await request(`/api/applications/${created.id}`, token, { method: 'PUT', body: JSON.stringify(updated) })
    const saved = await request(`/api/applications/${created.id}`, token)
    expect(saved.additionalProfessors[0].research).toBe('Updated second research')
    expect(saved.professor.research).toBe(first.research)

    for (const format of ['csv', 'excel']) {
      const exported = await fetch(`${baseUrl}/api/exports?format=${format}&applicationId=${created.id}`, {
        headers: { authorization: `Bearer ${token}`, connection: 'close' },
      })
      expect(exported.status).toBe(200)
      const content = await exported.text()
      expect(content).toContain(second.english)
      expect(content).toContain(second.labUrl)
      expect(content).toContain('Updated second research')
    }
    const share = await request(`/api/applications/${created.id}/share`, token, {
      method: 'POST', body: JSON.stringify({ permission: 'edit', sections: ['overview'], expiresAt: null }),
    })
    const shared = await request(`/api/share/${share.token}`)
    expect(shared.additionalProfessors).toEqual(saved.additionalProfessors)
    const sharedEdit = await request(`/api/share/${share.token}/sections/overview`, null, {
      method: 'PATCH', body: JSON.stringify({ additionalProfessors: [{ ...second, research: 'Shared research edit' }] }),
    })
    expect(sharedEdit.additionalProfessors[0].research).toBe('Shared research edit')
    await request(`/api/applications/${created.id}/share/${share.id}`, token, {
      method: 'PATCH', body: JSON.stringify({ permission: 'view', sections: ['materials'], expiresAt: null }),
    })
    expect((await request(`/api/share/${share.token}`)).additionalProfessors).toEqual([])

    const copy = await create({ ...input, duplicateFromId: created.id, professor: 'Different supervisor',
      professorProfile: { ...first, english: 'Different supervisor' } })
    expect(copy.id).not.toBe(created.id)
    const copiedRecord = await request(`/api/applications/${copy.id}`, token)
    expect(copiedRecord).toMatchObject({ status: 'Draft', progress: 0, communications: [], shares: [], versions: [] })
    expect(copy.materials.map((item) => item.name)).toEqual(saved.materials.map((item) => item.name))
    expect(copy.materials.every((item) => !saved.materials.some((source) => source.id === item.id))).toBe(true)
    expect((await request(`/api/applications/${created.id}`, token)).professor.english).toBe(first.english)

    const foreign = { ...structuredClone(saved), id: 'foreign-source', ownerId: 'foreign-owner' }
    await storage.withWriteLock(async () => {
      const store = await storage.readStore()
      store.applications.push(foreign)
      await storage.writeStore(store)
    })
    await expect(create({ ...input, duplicateFromId: foreign.id })).rejects.toMatchObject({ status: 404 })
    const schoolOnly = await create({ ...input, professor: '', professorEmail: '', professorProfile: emptyProfessor(), additionalProfessors: [] })
    expect(schoolOnly.professor.english).toBe('')
  }, 45_000)
})
