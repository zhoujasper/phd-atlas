import { describe, expect, it } from 'vitest'
import {
  fitTeamLogoDimensions,
  hasGifSignature,
  readTeamLogoPngDimensions,
  resolveTeamLogoMimeType,
  TEAM_LOGO_ACCEPT,
} from './teamLogo'

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

describe('team logo normalization model', () => {
  it('accepts common browser image formats while excluding GIF from the picker', () => {
    expect(resolveTeamLogoMimeType('mark.png', 'image/png')).toBe('image/png')
    expect(resolveTeamLogoMimeType('mark.JPG', '')).toBe('image/jpeg')
    expect(resolveTeamLogoMimeType('mark.jpeg', 'image/pjpeg')).toBe('image/jpeg')
    expect(resolveTeamLogoMimeType('mark.webp', 'image/webp')).toBe('image/webp')
    expect(resolveTeamLogoMimeType('mark.avif', 'image/avif')).toBe('image/avif')
    expect(resolveTeamLogoMimeType('mark.bmp', 'image/x-ms-bmp')).toBe('image/bmp')
    expect(resolveTeamLogoMimeType('mark.svg', 'image/svg+xml')).toBe('image/svg+xml')
    expect(resolveTeamLogoMimeType('mark.ico', 'image/vnd.microsoft.icon')).toBe('image/x-icon')
    expect(TEAM_LOGO_ACCEPT).not.toContain('gif')
  })

  it('rejects GIF by MIME type, extension, and binary signature', () => {
    expect(resolveTeamLogoMimeType('mark.gif', 'image/png')).toBeNull()
    expect(resolveTeamLogoMimeType('mark.png', 'image/gif')).toBeNull()
    expect(hasGifSignature(new TextEncoder().encode('GIF87a').buffer)).toBe(true)
    expect(hasGifSignature(new TextEncoder().encode('GIF89a').buffer)).toBe(true)
    expect(hasGifSignature(new TextEncoder().encode('notgif').buffer)).toBe(false)
  })

  it('reads PNG dimensions only from a valid PNG IHDR header', () => {
    expect(readTeamLogoPngDimensions(pngHeader(1200, 300))).toEqual({
      width: 1200,
      height: 300,
    })

    const invalid = new Uint8Array(pngHeader(1200, 300))
    invalid[1] = 0
    expect(readTeamLogoPngDimensions(invalid.buffer)).toBeNull()
  })

  it('fits wide and tall logos without forcing a square crop or upscaling', () => {
    expect(fitTeamLogoDimensions(1600, 400)).toEqual({ width: 1024, height: 256 })
    expect(fitTeamLogoDimensions(300, 1200)).toEqual({ width: 128, height: 512 })
    expect(fitTeamLogoDimensions(320, 80)).toEqual({ width: 320, height: 80 })
  })
})
