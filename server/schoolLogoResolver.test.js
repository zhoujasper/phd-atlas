import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  detectSchoolLogoMime,
  detectSchoolLogoGeometry,
  extractSchoolLogoCandidates,
  normalizeSchoolLogoRemoteUrl,
  resolveSchoolLogoAsset,
  schoolLogoGeometryScore,
} from './schoolLogoResolver.js'
import { schoolLogoWebsiteCacheKey } from './schoolLogoCacheKey.js'

const VALID_ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const publicDns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])

describe('school logo resolver', () => {
  it('shares one cache key across equivalent www and trailing-slash website forms', () => {
    expect(schoolLogoWebsiteCacheKey('https://www.cam.ac.uk/'))
      .toBe(schoolLogoWebsiteCacheKey('https://cam.ac.uk'))
  })

  it('ranks structured and explicit logo sources ahead of a favicon fallback', () => {
    const candidates = extractSchoolLogoCandidates(`
      <html>
        <head>
          <link rel="icon" sizes="32x32" href="/favicon-32.png">
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch.png">
          <script type="application/ld+json">
            {"@type":"CollegeOrUniversity","logo":"/official-wordmark.svg"}
          </script>
        </head>
        <body><img class="site-logo" src="/header-logo.png" alt="Example University logo"></body>
      </html>
    `, 'https://www.example.edu/admissions', 'Example University')

    expect(candidates[0]).toMatchObject({
      url: 'https://www.example.edu/official-wordmark.svg',
      kind: 'structured-logo',
    })
    expect(candidates.some((candidate) => candidate.kind === 'apple-touch-icon')).toBe(true)
    expect(candidates.at(-1)?.kind).toBe('favicon-fallback')
  })

  it('prefers the primary colour wordmark over touch icons and inverse/footer variants', () => {
    const candidates = extractSchoolLogoCandidates(`
      <html>
        <head><link rel="apple-touch-icon" sizes="512x512" href="/touch-icon.png"></head>
        <body>
          <img class="cam-logo" alt="University of Cambridge" src="/cambridge_university2.svg">
          <footer>
            <img class="cam-logo footer-logo" alt="" src="/university_logo_white-01.svg">
          </footer>
        </body>
      </html>
    `, 'https://www.cam.ac.uk/', 'University of Cambridge')

    expect(candidates[0]).toMatchObject({
      url: 'https://www.cam.ac.uk/cambridge_university2.svg',
      kind: 'page-logo',
    })
    expect(candidates.findIndex((candidate) => candidate.url.endsWith('/university_logo_white-01.svg')))
      .toBeGreaterThan(candidates.findIndex((candidate) => candidate.url.endsWith('/touch-icon.png')))
  })

  it('selects a square official crest over an extra-wide wordmark for compact identity marks', async () => {
    const wideWordmark = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 566.9 117.9"><path d="M0 0h566v117H0z"/></svg>',
    )
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'https://www.cam.ac.uk/') {
        return new Response(`
          <html><head>
            <link rel="icon" type="image/png" href="/official-crest.png">
          </head><body>
            <img class="cam-logo" alt="University of Cambridge" src="/cambridge-wordmark.svg">
            <img alt="University of Cambridge research story" src="/news-photo.png">
          </body></html>
        `, { headers: { 'Content-Type': 'text/html' } })
      }
      if (url === 'https://www.cam.ac.uk/cambridge-wordmark.svg') {
        return new Response(wideWordmark, { headers: { 'Content-Type': 'image/svg+xml' } })
      }
      if (url === 'https://www.cam.ac.uk/official-crest.png') {
        return new Response(VALID_ONE_PIXEL_PNG, { headers: { 'Content-Type': 'image/png' } })
      }
      if (url === 'https://www.cam.ac.uk/news-photo.png') {
        return new Response(VALID_ONE_PIXEL_PNG, { headers: { 'Content-Type': 'image/png' } })
      }
      return new Response('missing', { status: 404 })
    })

    const result = await resolveSchoolLogoAsset({
      website: 'https://www.cam.ac.uk/',
      schoolName: 'University of Cambridge',
      fetchImpl,
      dnsLookup: publicDns,
    })

    expect(result).toMatchObject({
      found: true,
      sourceUrl: 'https://www.cam.ac.uk/official-crest.png',
      candidateKind: 'icon',
    })
  })

  it('falls back to a compact domain icon when a university blocks its logo assets', async () => {
    const providerPng = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(providerPng)
    providerPng.writeUInt32BE(256, 16)
    providerPng.writeUInt32BE(256, 20)
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'https://www.ox.ac.uk/') {
        return new Response(`
          <html><body>
            <img class="w-logo-header" alt="Oxford University" src="/brand/oxford-logo.svg">
          </body></html>
        `, { headers: { 'Content-Type': 'text/html' } })
      }
      if (url === 'https://www.ox.ac.uk/brand/oxford-logo.svg') {
        return new Response('blocked', { status: 403 })
      }
      if (String(url).startsWith('https://www.google.com/s2/favicons?')) {
        return new Response(providerPng, { headers: { 'Content-Type': 'image/png' } })
      }
      return new Response('missing', { status: 404 })
    })

    const result = await resolveSchoolLogoAsset({
      website: 'https://www.ox.ac.uk/',
      schoolName: 'University of Oxford',
      fetchImpl,
      dnsLookup: publicDns,
    })

    expect(result).toMatchObject({
      found: true,
      candidateKind: 'site-icon-provider',
    })
    expect(result.sourceUrl).toContain('https://www.google.com/s2/favicons?')
  })

  it('fetches the best usable official image and returns its source URL', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'https://www.example.edu/') {
        return new Response(`
          <html><head>
            <link rel="apple-touch-icon" sizes="180x180" href="/brand/touch.png">
            <link rel="icon" href="/favicon.ico">
          </head></html>
        `, { headers: { 'Content-Type': 'text/html' } })
      }
      if (url === 'https://www.example.edu/brand/touch.png') {
        return new Response(VALID_ONE_PIXEL_PNG, { headers: { 'Content-Type': 'image/png' } })
      }
      return new Response('missing', { status: 404 })
    })

    const result = await resolveSchoolLogoAsset({
      website: 'https://www.example.edu/',
      schoolName: 'Example University',
      fetchImpl,
      dnsLookup: publicDns,
    })

    expect(result).toMatchObject({
      found: true,
      sourceUrl: 'https://www.example.edu/brand/touch.png',
      candidateKind: 'apple-touch-icon',
    })
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/u)
  })

  it('supports a direct official image URL while rejecting private-network targets', async () => {
    const fetchImpl = vi.fn(async () => (
      new Response(VALID_ONE_PIXEL_PNG, { headers: { 'Content-Type': 'image/png' } })
    ))
    const direct = await resolveSchoolLogoAsset({
      imageUrl: 'https://assets.example.edu/logo.png',
      fetchImpl,
      dnsLookup: publicDns,
    })
    expect(direct.found).toBe(true)

    expect(normalizeSchoolLogoRemoteUrl('https://127.0.0.1/logo.png')).toBeNull()
    const privateResult = await resolveSchoolLogoAsset({
      imageUrl: 'https://127.0.0.1/logo.png',
      fetchImpl,
      dnsLookup: publicDns,
    })
    expect(privateResult).toEqual({ found: false, reason: 'invalid-url' })
  })

  it('rejects GIF and active SVG payloads before they reach the client', () => {
    expect(detectSchoolLogoMime(Buffer.from('GIF89a payload'), 'image/gif')).toBeNull()
    expect(detectSchoolLogoMime(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'image/svg+xml',
    )).toBeNull()
    expect(detectSchoolLogoMime(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>'),
      'image/svg+xml',
    )).toBe('image/svg+xml')
    expect(detectSchoolLogoGeometry(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 566.9 117.9"></svg>'),
      'image/svg+xml',
    )).toEqual({ width: 566.9, height: 117.9 })
    expect(schoolLogoGeometryScore({ width: 32, height: 32 }))
      .toBeGreaterThan(schoolLogoGeometryScore({ width: 566.9, height: 117.9 }))
  })
})
