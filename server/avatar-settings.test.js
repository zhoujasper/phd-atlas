import { describe, expect, it } from 'vitest'
import { publicUser } from './storage.js'
import { UserSettingsPatchSchema, parseOrThrow } from './validation.js'

describe('avatar settings validation', () => {
  it('accepts cropped browser image data and explicit removal', () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

    expect(parseOrThrow(UserSettingsPatchSchema, { avatarDataUrl: jpeg })).toEqual({
      avatarDataUrl: jpeg,
    })
    expect(parseOrThrow(UserSettingsPatchSchema, { avatarDataUrl: '' })).toEqual({
      avatarDataUrl: '',
    })
  })

  it('rejects non-image and vector payloads', () => {
    expect(() => parseOrThrow(UserSettingsPatchSchema, {
      avatarDataUrl: 'data:text/plain;base64,SGVsbG8=',
    })).toThrow()
    expect(() => parseOrThrow(UserSettingsPatchSchema, {
      avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    })).toThrow()
  })

  it('returns the persisted avatar in public user settings', () => {
    const avatarDataUrl = 'data:image/webp;base64,UklGRg=='
    const user = publicUser({
      id: 'user_avatar',
      name: 'Avatar User',
      email: 'avatar@example.com',
      role: 'user',
      createdAt: '2026-07-17T00:00:00.000Z',
      settings: { avatarDataUrl },
    })

    expect(user.settings.avatarDataUrl).toBe(avatarDataUrl)
  })
})
