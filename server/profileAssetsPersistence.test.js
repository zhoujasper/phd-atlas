import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apiHeavyMemoryReservationBytes,
  createApp,
  requiresDedicatedHeavyWorkAdmission,
} from './index.js'

let app
let server
let baseUrl
let settingsMutationSequence = 0

function currentSettingsHeaders(authHeaders) {
  settingsMutationSequence += 1
  return {
    ...authHeaders,
    'content-type': 'application/json',
    'X-PhD-Settings-Acknowledgement': 'v1',
    'X-PhD-Settings-Mutation-Id': `profile-assets-test:${Date.now()}:${settingsMutationSequence}`,
  }
}

beforeAll(async () => {
  app = createApp()
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'jasper@example.com', password: 'demo123456' }),
  })
  const payload = await response.json()
  expect(response.status).toBe(200)
  return payload.data.token
}

describe('profile asset persistence', () => {
  it('serializes profile exports behind a 128 MiB memory reservation', () => {
    const request = {
      method: 'GET',
      originalUrl: '/api/profile-assets/asset-1/export?format=pdf',
      get: () => '',
    }

    expect(requiresDedicatedHeavyWorkAdmission(request)).toBe(true)
    expect(apiHeavyMemoryReservationBytes(request)).toBe(128 * 1024 * 1024)
    expect(app.locals.heavyWorkAdmission.snapshot()).toMatchObject({
      maxActive: 1,
      maxActivePerKey: 1,
    })
  })

  it('round-trips a custom asset, private sections, and custom labels after reopening', async () => {
    const token = await login()
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    }
    let assetId

    try {
      const createdResponse = await fetch(`${baseUrl}/api/profile-assets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Persistence custom material',
          kind: 'Custom',
          description: 'A custom body that must survive a fresh read.',
          notes: 'Private note',
          customLabelEn: 'Evidence pack',
          customLabelZh: '证明材料包',
          icon: 'briefcase',
          color: 'teal',
          writingBrief: {
            requirements: 'Keep the evidence concise.',
            sections: [{
              id: 'evidence',
              title: 'Evidence',
              content: 'Project evidence survives reopening.',
              width: 'half',
            }],
          },
        }),
      })
      const createdPayload = await createdResponse.json()
      expect(createdResponse.status).toBe(201)
      assetId = createdPayload.data.id
      expect(createdPayload.data).toMatchObject({
        kind: 'Custom',
        customLabelEn: 'Evidence pack',
        customLabelZh: '证明材料包',
        writingBrief: {
          sections: [expect.objectContaining({ id: 'evidence', width: 'half' })],
        },
      })

      const reopenedResponse = await fetch(`${baseUrl}/api/profile-assets`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const reopenedPayload = await reopenedResponse.json()
      const reopened = reopenedPayload.data.find((candidate) => candidate.id === assetId)
      expect(reopenedResponse.status).toBe(200)
      expect(reopened).toMatchObject({
        name: 'Persistence custom material',
        customLabelEn: 'Evidence pack',
        customLabelZh: '证明材料包',
        writingBrief: {
          requirements: 'Keep the evidence concise.',
          sections: [expect.objectContaining({ content: 'Project evidence survives reopening.' })],
        },
      })

      const updatedResponse = await fetch(`${baseUrl}/api/profile-assets/${assetId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          customLabelEn: 'Updated evidence pack',
          description: 'Updated authored body survives export.',
          writingBrief: {
            requirements: 'Updated requirement.',
            sections: [{
              id: 'evidence',
              title: 'Evidence',
              content: 'Updated content survives a second read.',
              width: 'full',
            }],
          },
        }),
      })
      expect(updatedResponse.status).toBe(200)

      const pdfResponse = await fetch(
        `${baseUrl}/api/profile-assets/${encodeURIComponent(assetId)}/export?format=pdf&language=zh`,
        { headers: { authorization: `Bearer ${token}` } },
      )
      const pdf = Buffer.from(await pdfResponse.arrayBuffer())
      expect(pdfResponse.status).toBe(200)
      expect(pdfResponse.headers.get('content-type')).toMatch(/^application\/pdf\b/i)
      expect(pdfResponse.headers.get('content-disposition')).toMatch(/attachment;.*\.pdf/i)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

      const wordResponse = await fetch(
        `${baseUrl}/api/profile-assets/${encodeURIComponent(assetId)}/export?format=word&language=zh`,
        { headers: { authorization: `Bearer ${token}` } },
      )
      const word = Buffer.from(await wordResponse.arrayBuffer()).toString('utf8')
      expect(wordResponse.status).toBe(200)
      expect(wordResponse.headers.get('content-type')).toMatch(/^application\/msword\b/i)
      expect(wordResponse.headers.get('content-disposition')).toMatch(/attachment;.*\.doc/i)
      expect(word).toContain('Updated authored body survives export.')

      const pathologicalUpdateResponse = await fetch(`${baseUrl}/api/profile-assets/${assetId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ description: '# a\n\n'.repeat(50_000) }),
      })
      expect(pathologicalUpdateResponse.status).toBe(200)

      const limitedExportResponse = await fetch(
        `${baseUrl}/api/profile-assets/${encodeURIComponent(assetId)}/export?format=word&language=en`,
        { headers: { authorization: `Bearer ${token}` } },
      )
      const limitedExportPayload = await limitedExportResponse.json()
      expect(limitedExportResponse.status).toBe(413)
      expect(limitedExportResponse.headers.get('content-type')).toMatch(/^application\/json\b/i)
      expect(limitedExportResponse.headers.get('content-disposition')).toBeNull()
      expect(limitedExportPayload.error).toMatchObject({
        code: 'PROFILE_ASSET_EXPORT_TOO_LARGE',
      })

      const reopenedUpdatedResponse = await fetch(`${baseUrl}/api/profile-assets`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const reopenedUpdatedPayload = await reopenedUpdatedResponse.json()
      expect(reopenedUpdatedPayload.data.find((candidate) => candidate.id === assetId)).toMatchObject({
        customLabelEn: 'Updated evidence pack',
        writingBrief: {
          requirements: 'Updated requirement.',
          sections: [expect.objectContaining({ width: 'full' })],
        },
      })
    } finally {
      if (assetId) {
        await fetch(`${baseUrl}/api/profile-assets/${assetId}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        })
      }
    }
  })

  it('persists a custom insert preset in account settings across a fresh session read', async () => {
    const token = await login()
    const authHeaders = { authorization: `Bearer ${token}` }
    const meResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders })
    const mePayload = await meResponse.json()
    const originalPresets = Array.isArray(mePayload.data.user.settings.profilePresets)
      ? mePayload.data.user.settings.profilePresets
      : []
    const customPreset = {
      id: `persistence-preset-${Date.now()}`,
      kind: 'Custom',
      nameZh: '研究证据包',
      nameEn: 'Research evidence pack',
      descriptionZh: '保存研究证据。',
      descriptionEn: 'Keeps research evidence together.',
      contentZh: '请插入研究证据包。',
      contentEn: 'Please insert the research evidence pack.',
      icon: 'briefcase',
      color: 'teal',
      builtIn: false,
    }

    try {
      const saveResponse = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: currentSettingsHeaders(authHeaders),
        body: JSON.stringify({ profilePresets: [...originalPresets, customPreset] }),
      })
      expect(saveResponse.status).toBe(200)

      const reopenedResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders })
      const reopenedPayload = await reopenedResponse.json()
      expect(reopenedPayload.data.user.settings.profilePresets).toEqual(
        expect.arrayContaining([expect.objectContaining({
          id: customPreset.id,
          nameEn: customPreset.nameEn,
          contentEn: customPreset.contentEn,
        })]),
      )
    } finally {
      await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: currentSettingsHeaders(authHeaders),
        body: JSON.stringify({ profilePresets: originalPresets }),
      })
    }
  })
})
