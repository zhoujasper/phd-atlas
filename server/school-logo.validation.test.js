import { describe, expect, it } from 'vitest'
import { SchoolLogoPatchSchema, SchoolLogoResolveSchema, parseOrThrow } from './validation.js'

const VALID_ONE_PIXEL_PNG = [
  'data:image/png;base64,',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
].join('')

describe('school logo validation', () => {
  it('accepts a normalized PNG logo and an intentional removal', () => {
    const logo = {
      dataUrl: VALID_ONE_PIXEL_PNG,
      source: 'website',
      sourceUrl: 'https://www.example.edu/logo.png',
      updatedAt: '2026-07-23T12:00:00.000Z',
    }
    expect(parseOrThrow(SchoolLogoPatchSchema, { logo, autoDetect: true }))
      .toEqual({ logo, autoDetect: true })
    expect(parseOrThrow(SchoolLogoPatchSchema, { logo: null, autoDetect: false }))
      .toEqual({ logo: null, autoDetect: false })
  })

  it('rejects non-PNG persisted data and insecure source URLs', () => {
    expect(() => parseOrThrow(SchoolLogoPatchSchema, {
      logo: {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        source: 'link',
        sourceUrl: 'https://www.example.edu/logo.jpg',
        updatedAt: '2026-07-23T12:00:00.000Z',
      },
      autoDetect: false,
    })).toThrow()
    expect(() => parseOrThrow(SchoolLogoPatchSchema, {
      logo: {
        dataUrl: VALID_ONE_PIXEL_PNG,
        source: 'link',
        sourceUrl: 'http://www.example.edu/logo.png',
        updatedAt: '2026-07-23T12:00:00.000Z',
      },
      autoDetect: false,
    })).toThrow()
  })

  it('requires exactly one remote discovery source', () => {
    expect(parseOrThrow(SchoolLogoResolveSchema, {
      website: 'https://www.example.edu',
    })).toEqual({ website: 'https://www.example.edu' })
    expect(parseOrThrow(SchoolLogoResolveSchema, {
      imageUrl: 'https://www.example.edu/logo.png',
    })).toEqual({ imageUrl: 'https://www.example.edu/logo.png' })
    expect(() => parseOrThrow(SchoolLogoResolveSchema, {})).toThrow()
    expect(() => parseOrThrow(SchoolLogoResolveSchema, {
      website: 'https://www.example.edu',
      imageUrl: 'https://www.example.edu/logo.png',
    })).toThrow()
  })
})
