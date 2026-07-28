import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import { InitialAdminSetupSchema } from './validation.js'

let server
let baseUrl

beforeEach(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

async function adminToken() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@phd-atlas.local',
      password: 'admin123456',
      scope: 'admin',
    }),
  })
  const payload = await response.json()
  expect(response.status).toBe(200)
  return payload.data.token
}

describe('hidden administrator entry', () => {
  it('keeps initial setup visible by default and requires a valid code when hiding it', () => {
    const baseSetup = {
      name: 'Atlas Admin',
      email: 'admin@example.com',
      password: 'a-strong-password',
      notificationMailbox: 'alerts@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'notifications@example.com',
      smtpPass: 'smtp-secret',
      smtpTls: true,
      smtpVerificationToken: 'setup-smtp-verification-token',
      language: 'en',
      database: { type: 'sqlite' },
    }

    expect(InitialAdminSetupSchema.parse(baseSetup).adminEntryHidden).toBe(false)
    expect(InitialAdminSetupSchema.safeParse({
      ...baseSetup,
      adminEntryHidden: true,
    }).success).toBe(false)
    expect(InitialAdminSetupSchema.safeParse({
      ...baseSetup,
      adminEntryHidden: true,
      adminEntryCode: 'private-entry',
    }).success).toBe(true)
  })

  it('activates a browser session, optionally remembers it, and invalidates it after code rotation', async () => {
    const token = await adminToken()
    const updateSettings = (body) => fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    try {
      const enableResponse = await updateSettings({
        adminEntryHidden: true,
        adminEntryCode: 'entry-test-a',
      })
      const enablePayload = await enableResponse.json()
      expect(enableResponse.status).toBe(200)
      expect(enablePayload.data).toMatchObject({
        adminEntryHidden: true,
        adminEntryCodeSet: true,
      })
      expect(enablePayload.data.adminEntryCodeHash).toBeUndefined()
      expect(enablePayload.data.adminEntryCodeSalt).toBeUndefined()

      const blockedResponse = await fetch(`${baseUrl}/api/admin-access/status`)
      expect(await blockedResponse.json()).toMatchObject({
        data: { hidden: true, allowed: false },
      })

      const wrongResponse = await fetch(`${baseUrl}/api/admin-access/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'wrong-code' }),
      })
      expect(wrongResponse.status).toBe(404)

      const activateResponse = await fetch(`${baseUrl}/api/admin-access/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'entry-test-a' }),
      })
      const sessionCookie = activateResponse.headers.get('set-cookie')?.split(';')[0]
      expect(activateResponse.status).toBe(200)
      expect(sessionCookie).toMatch(/^phd_atlas_admin_entry=/)
      expect(activateResponse.headers.get('set-cookie')).not.toContain('Max-Age=')

      const allowedResponse = await fetch(`${baseUrl}/api/admin-access/status`, {
        headers: { cookie: sessionCookie },
      })
      expect(await allowedResponse.json()).toMatchObject({
        data: { hidden: true, allowed: true },
      })

      const rememberResponse = await fetch(`${baseUrl}/api/admin-access/remember`, {
        method: 'POST',
        headers: { cookie: sessionCookie },
      })
      expect(rememberResponse.status).toBe(200)
      expect(rememberResponse.headers.get('set-cookie')).toContain('Max-Age=')

      expect((await updateSettings({ adminEntryCode: 'entry-test-b' })).status).toBe(200)
      const staleResponse = await fetch(`${baseUrl}/api/admin-access/status`, {
        headers: { cookie: sessionCookie },
      })
      expect(await staleResponse.json()).toMatchObject({
        data: { hidden: true, allowed: false },
      })
    } finally {
      await updateSettings({ adminEntryHidden: false })
    }
  })
})
