import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import {
  DESKTOP_COMPLETE_FORMAT,
  evaluateDesktopWebApplicationQuota,
  findMissingLocalApplications,
} from './desktopRuntime.js'
import { parseCompleteWorkspaceSnapshot } from './desktopCompleteExport.js'

let app
let server
let baseUrl
let token
const createdIds = []

function createBody(suffix) {
  return {
    professor: `Desktop Advisor ${suffix}`,
    professorChinese: '',
    professorEmail: `desktop-${suffix}@example.edu`,
    university: `Desktop College ${suffix}`,
    country: 'US',
    program: `Desktop Program ${suffix}`,
    deadline: '2027-12-01',
    notes: `desktop-sync-${suffix}`,
  }
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload, data: payload.data }
}

async function login() {
  const login = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'jasper@example.com',
      password: 'demo123456',
      scope: 'app',
    }),
  })
  expect(login.response.status, JSON.stringify(login.payload)).toBe(200)
  token = login.data.token
}

async function purgeCreated() {
  for (const id of createdIds.splice(0)) {
    await jsonRequest(`/api/applications/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)
  }
}

function startFakeWeb({ applicationQuota, applications = [] }) {
  const remoteApps = [...applications]
  const sharePosts = []
  const serverRef = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : {}
    const url = new URL(request.url, 'http://127.0.0.1')
    const send = (status, data, ok = true) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(ok ? { ok: true, data } : { ok: false, error: data }))
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      if (body.email !== 'web@example.com' || body.password !== 'web-password-123') {
        send(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' }, false)
        return
      }
      send(200, {
        token: 'web-session-token',
        user: { id: 'user_web', email: body.email, name: 'Web User' },
        usage: {
          plan: applicationQuota > 3 ? 'pro' : 'free',
          applicationQuota,
          applicationCreateQuota: applicationQuota,
          applicationCount: remoteApps.length,
          shareQuota: 5,
          storageQuotaBytes: 5 * 1024 * 1024,
        },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/applications') {
      send(200, remoteApps)
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/applications') {
      const created = {
        id: `app_remote_${remoteApps.length + 1}`,
        school: { name: body.university },
        program: body.program,
        professor: { email: body.professorEmail, english: body.professor },
      }
      remoteApps.push(created)
      send(201, created)
      return
    }
    if (request.method === 'PUT' && url.pathname.startsWith('/api/applications/')) {
      send(200, { id: url.pathname.split('/').at(-1) })
      return
    }
    if (request.method === 'POST' && url.pathname.endsWith('/share')) {
      sharePosts.push({ path: url.pathname, body })
      send(200, {
        id: 'share_remote',
        token: 'share-token',
        url: '/share/share-token',
      })
      return
    }
    send(404, { code: 'NOT_FOUND', message: 'not found' }, false)
  })
  return new Promise((resolve) => {
    serverRef.listen(0, '127.0.0.1', () => {
      const address = serverRef.address()
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        remoteApps,
        sharePosts,
        close: () => new Promise((done) => serverRef.close(() => done())),
      })
    })
  })
}

describe('desktop local/unlinked and web-linked storage mode', () => {
  beforeAll(async () => {
    app = createApp({ desktopEnabled: true })
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
    await login()
  }, 90_000)

  afterAll(async () => {
    await jsonRequest('/api/desktop/disconnect', { method: 'POST', body: '{}' }).catch(() => undefined)
    await purgeCreated()
    await app?.locals.stopPersistedMailSyncWorker?.()
    await app?.locals.stopRecurringTasks?.()
    if (server) await new Promise((resolve) => server.close(resolve))
  }, 90_000)

  it('exposes desktop runtime, unlimited local quotas, and rejects share while unlinked', async () => {
    const runtime = await jsonRequest('/api/desktop/runtime')
    expect(runtime.response.status).toBe(200)
    expect(runtime.data.enabled).toBe(true)
    expect(runtime.data.mode).toBe('local')
    expect(runtime.data.shareEnabled).toBe(false)
    expect(runtime.data.adminEnabled).toBe(false)
    expect(runtime.data.teamEnabled).toBe(false)
    expect(runtime.data.unlimited).toBe(true)

    const me = await jsonRequest('/api/auth/me')
    expect(me.response.status).toBe(200)
    expect(me.data.usage.plan).toBe('pro')
    expect(me.data.usage.applicationQuota).toBeGreaterThan(10_000)
    expect(me.data.usage.applicationCreateQuota).toBeGreaterThan(10_000)

    const listed = await jsonRequest('/api/applications')
    const existing = Array.isArray(listed.data) ? listed.data.length : listed.data?.applications?.length ?? 0
    const needed = Math.max(0, 4 - existing)
    for (let index = 0; index < needed; index += 1) {
      const created = await jsonRequest('/api/applications', {
        method: 'POST',
        body: JSON.stringify(createBody(`quota-${Date.now()}-${index}`)),
      })
      expect([200, 201]).toContain(created.response.status)
      expect(created.payload.error?.code).not.toBe('APPLICATION_LIMIT_REACHED')
      createdIds.push(created.data.id)
    }

    const applications = await jsonRequest('/api/applications')
    const rows = Array.isArray(applications.data) ? applications.data : applications.data.applications
    expect(rows.length).toBeGreaterThan(3)

    const share = await jsonRequest(`/api/applications/${encodeURIComponent(rows[0].id)}/share`, {
      method: 'POST',
      body: JSON.stringify({ permission: 'view' }),
    })
    expect(share.response.status).toBe(403)
    expect(share.payload.error.code).toBe('DESKTOP_SHARE_REQUIRES_REMOTE')

    const admin = await jsonRequest('/api/admin/users')
    expect(admin.response.status).toBe(404)
    expect(admin.payload.error.code).toBe('DESKTOP_ADMIN_UNAVAILABLE')
  })

  it('round-trips a complete workspace archive through the shipped export/import routes', async () => {
    const before = await jsonRequest('/api/auth/me')
    const originalSettings = before.data.user.settings
    const stamp = Date.now()
    const created = await jsonRequest('/api/applications', {
      method: 'POST',
      body: JSON.stringify(createBody(`archive-${stamp}`)),
    })
    expect([200, 201]).toContain(created.response.status)
    createdIds.push(created.data.id)

    const exportedSeed = await jsonRequest('/api/workspace/complete-export')
    expect(exportedSeed.response.status).toBe(200)
    const snapshot = parseCompleteWorkspaceSnapshot(exportedSeed.data)
    const storageName = `import-file-${stamp}.txt`
    const fileBytes = Buffer.from(`imported-attachment-${stamp}`)
    const target = snapshot.applications.find((application) => application.id === created.data.id)
    expect(target).toBeTruthy()
    target.program = 'Imported Desktop Program'
    target.notes = 'imported-complete-archive'
    target.materials = [
      ...(target.materials ?? []),
      {
        id: `mat_import_${stamp}`,
        name: 'Imported Statement',
        type: 'Essay',
        group: 'Core materials',
        status: 'Submitted',
        storageName,
        fileName: 'statement.txt',
        fileSize: fileBytes.length,
        fileId: `file_import_${stamp}`,
      },
    ]
    snapshot.user.settings = {
      ...(snapshot.user.settings ?? {}),
      language: 'zh',
      themeAccent: '#112233',
      highContrast: true,
    }
    snapshot.profileAssets = [
      ...(snapshot.profileAssets ?? []),
      {
        id: `asset_import_${stamp}`,
        name: 'Imported Profile Snippet',
        kind: 'custom',
        content: 'Imported profile body',
      },
    ]
    snapshot.interviewPrep = {
      interviews: [{
        id: `iv_import_${stamp}`,
        title: 'Imported Desktop Interview',
        school: 'Imported School',
        program: 'Imported Program',
        advisor: 'Imported Advisor',
        format: 'video',
        status: 'preparing',
        timezone: 'UTC',
        durationMinutes: 30,
        participantNames: [],
        preparationNotes: 'Imported interview note',
        talkingPoints: '',
      }],
      questions: [],
      mockSessions: [],
      feedback: [],
    }
    snapshot.files = [
      ...(snapshot.files ?? []),
      {
        storageName,
        encoding: 'base64',
        bytes: fileBytes.toString('base64'),
        size: fileBytes.length,
      },
    ]

    const imported = await jsonRequest('/api/desktop/import', {
      method: 'POST',
      body: JSON.stringify({ snapshot }),
    })
    expect(imported.response.status, JSON.stringify(imported.payload)).toBe(200)
    expect(imported.data.applicationsImported).toBeGreaterThan(0)
    expect(imported.data.assetsImported).toBeGreaterThan(0)
    expect(imported.data.filesImported).toBeGreaterThan(0)
    expect(imported.data.settingsImported).toBe(true)
    expect(imported.data.interviewImported).toBe(true)

    const applications = await jsonRequest('/api/applications')
    const rows = Array.isArray(applications.data) ? applications.data : applications.data.applications
    const importedRow = rows.find((application) => application.program === 'Imported Desktop Program')
    expect(importedRow).toBeTruthy()
    expect(importedRow.materials?.some((material) => (
      material.storageName === storageName && material.fileName === 'statement.txt'
    ))).toBe(true)
    createdIds.push(importedRow.id)

    const assets = await jsonRequest('/api/profile-assets')
    const assetRows = Array.isArray(assets.data) ? assets.data : assets.data?.assets ?? []
    expect(assetRows.some((asset) => asset.name === 'Imported Profile Snippet')).toBe(true)

    const me = await jsonRequest('/api/auth/me')
    expect(me.data.user.settings.language).toBe('zh')
    expect(me.data.user.settings.themeAccent).toBe('#112233')
    expect(me.data.user.settings.highContrast).toBe(true)

    const interview = await jsonRequest(
      `/api/interview-prep/workspace?subjectUserId=${encodeURIComponent(me.data.user.id)}`,
    )
    expect(interview.response.status, JSON.stringify(interview.payload)).toBe(200)
    expect(interview.data.interviews?.some((entry) => entry.title === 'Imported Desktop Interview')).toBe(true)

    const exported = await jsonRequest('/api/workspace/complete-export')
    expect(exported.response.status).toBe(200)
    const roundTrip = parseCompleteWorkspaceSnapshot(exported.data)
    const exportedFile = roundTrip.files.find((entry) => entry.storageName === storageName)
    expect(exportedFile).toBeTruthy()
    expect(Buffer.from(exportedFile.bytes, 'base64').toString('utf8')).toBe(fileBytes.toString('utf8'))
    expect(roundTrip.user.settings.language).toBe('zh')
    expect(roundTrip.profileAssets.some((asset) => asset.name === 'Imported Profile Snippet')).toBe(true)
    expect(roundTrip.interviewPrep?.interviews?.some((entry) => entry.title === 'Imported Desktop Interview')).toBe(true)

    const restore = {
      format: DESKTOP_COMPLETE_FORMAT,
      exportedAt: new Date().toISOString(),
      user: {
        name: originalSettings ? 'Jasper' : 'Imported User',
        email: 'jasper@example.com',
        settings: {
          language: originalSettings.language,
          themeAccent: originalSettings.themeAccent,
          highContrast: originalSettings.highContrast,
        },
      },
      applications: [],
      profileAssets: [],
      interviewPrep: null,
      files: [],
    }
    await jsonRequest('/api/desktop/import', {
      method: 'POST',
      body: JSON.stringify({ snapshot: restore }),
    })
  })

  it('fails closed on local→web push when the web account quota is too small', async () => {
    const listed = await jsonRequest('/api/applications')
    const rows = Array.isArray(listed.data) ? listed.data : listed.data.applications
    expect(rows.length).toBeGreaterThan(3)

    const web = await startFakeWeb({ applicationQuota: 3, applications: [] })
    try {
      const connect = await jsonRequest('/api/desktop/connect', {
        method: 'POST',
        body: JSON.stringify({
          origin: web.origin,
          email: 'web@example.com',
          password: 'web-password-123',
        }),
      })
      expect(connect.response.status).toBe(409)
      expect(connect.payload.error.code).toBe('APPLICATION_LIMIT_REACHED')
      expect(connect.payload.error.message).toMatch(/cannot exceed 3/i)
      expect(connect.payload.error.message).toMatch(/upgrade/i)
      expect(web.remoteApps).toHaveLength(0)

      const runtime = await jsonRequest('/api/desktop/runtime')
      expect(runtime.data.mode).toBe('local')
      expect(runtime.data.shareEnabled).toBe(false)
    } finally {
      await web.close()
    }
  })

  it('connects to a web account with enough quota, then follows that quota and allows share-create', async () => {
    const created = await jsonRequest('/api/applications', {
      method: 'POST',
      body: JSON.stringify(createBody(`share-${Date.now()}`)),
    })
    expect([200, 201]).toContain(created.response.status)
    createdIds.push(created.data.id)

    const web = await startFakeWeb({ applicationQuota: 300, applications: [] })
    try {
      const connect = await jsonRequest('/api/desktop/connect', {
        method: 'POST',
        body: JSON.stringify({
          origin: web.origin,
          email: 'web@example.com',
          password: 'web-password-123',
        }),
      })
      expect(connect.response.status, JSON.stringify(connect.payload)).toBe(200)
      expect(connect.data.runtime.mode).toBe('remote')
      expect(connect.data.runtime.shareEnabled).toBe(true)
      expect(connect.data.pushed).toBeGreaterThan(0)
      expect(web.remoteApps.length).toBe(connect.data.pushed)

      const me = await jsonRequest('/api/auth/me')
      expect(me.data.usage.applicationQuota).toBe(300)
      expect(me.data.usage.applicationQuota).toBeLessThan(10_000)

      const share = await jsonRequest(`/api/applications/${encodeURIComponent(created.data.id)}/share`, {
        method: 'POST',
        body: JSON.stringify({ permission: 'view' }),
      })
      expect(share.response.status, JSON.stringify(share.payload)).toBe(201)
      expect(share.data.url).toBe(`${web.origin}/share/share-token`)
      expect(share.data.url.startsWith(web.origin)).toBe(true)
      expect(web.sharePosts.length).toBeGreaterThan(0)
    } finally {
      await jsonRequest('/api/desktop/disconnect', { method: 'POST', body: '{}' })
      await web.close()
    }
  })
})

describe('desktop quota planning helpers used by the shipped connect route', () => {
  it('keeps extras off the web account when the remaining quota is too small', () => {
    const local = [
      { school: { name: 'A' }, program: 'P', professor: { email: 'a@x.edu' } },
      { school: { name: 'B' }, program: 'P', professor: { email: 'b@x.edu' } },
      { school: { name: 'C' }, program: 'P', professor: { email: 'c@x.edu' } },
      { school: { name: 'D' }, program: 'P', professor: { email: 'd@x.edu' } },
    ]
    const missing = findMissingLocalApplications(local, [])
    const result = evaluateDesktopWebApplicationQuota({
      localCount: local.length,
      remoteCount: 0,
      remoteQuota: 3,
      missingCount: missing.length,
    })
    expect(missing).toHaveLength(4)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('APPLICATION_LIMIT_REACHED')
    expect(result.quota).toBe(3)
  })
})
