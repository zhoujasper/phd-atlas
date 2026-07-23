import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  detectSchoolLogoMime,
  extractSchoolLogoCandidates,
  normalizeSchoolLogoRemoteUrl,
  resolveSchoolLogoAsset,
} from './schoolLogoResolver.js'

const VALID_ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const publicDns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])

describe('school logo resolver', () => {
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
  })
})
