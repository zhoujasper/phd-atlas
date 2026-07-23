import { describe, expect, it } from 'vitest'
import {
  fitSchoolLogoDimensions,
  hasSchoolLogoGifSignature,
  resolveSchoolLogoMimeType,
  schoolLogoFileFromDataUrl,
  schoolLogoInitials,
  SCHOOL_LOGO_ACCEPT,
} from './schoolLogoModel'

describe('school logo client model', () => {
  it('creates calm fallback initials for long and short school names', () => {
    expect(schoolLogoInitials('Stanford University')).toBe('SU')
    expect(schoolLogoInitials('University of Cambridge')).toBe('UC')
    expect(schoolLogoInitials('MIT')).toBe('MI')
    expect(schoolLogoInitials('')).toBe('U')
  })

  it('accepts supported image formats but excludes GIF', () => {
    expect(resolveSchoolLogoMimeType('crest.PNG', 'image/png')).toBe('image/png')
    expect(resolveSchoolLogoMimeType('wordmark.svg', 'image/svg+xml')).toBe('image/svg+xml')
    expect(resolveSchoolLogoMimeType('mark.ico', 'image/vnd.microsoft.icon')).toBe('image/x-icon')
    expect(resolveSchoolLogoMimeType('animated.gif', 'image/png')).toBeNull()
    expect(SCHOOL_LOGO_ACCEPT).not.toContain('gif')
    expect(hasSchoolLogoGifSignature(new TextEncoder().encode('GIF89a').buffer)).toBe(true)
  })

  it('preserves aspect ratio and never upscales small logos', () => {
    expect(fitSchoolLogoDimensions(1600, 400)).toEqual({ width: 512, height: 128 })
    expect(fitSchoolLogoDimensions(300, 1200)).toEqual({ width: 64, height: 256 })
    expect(fitSchoolLogoDimensions(240, 80)).toEqual({ width: 240, height: 80 })
  })

  it('converts a fetched data URL into a browser file for rasterization', async () => {
    const file = schoolLogoFileFromDataUrl('data:image/png;base64,iVBORw0KGgo=')
    expect(file.name).toBe('school-logo.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBeGreaterThan(0)
  })
})
