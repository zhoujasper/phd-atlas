import { describe, expect, it } from 'vitest'
import { safeExternalHttpUrl, safeMailtoHref, safeMarkdownHref, safeTelHref } from './safeLinks'

describe('safe link helpers', () => {
  it('normalizes http links and bare domains', () => {
    expect(safeExternalHttpUrl('example.edu/apply')).toBe('https://example.edu/apply')
    expect(safeExternalHttpUrl('https://example.edu')).toBe('https://example.edu')
  })

  it('rejects executable or malformed external hrefs', () => {
    expect(safeExternalHttpUrl('javascript:alert(1)')).toBe('')
    expect(safeExternalHttpUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(safeExternalHttpUrl('https://example.edu/a b')).toBe('')
    expect(safeExternalHttpUrl('https://example.edu/\nnext')).toBe('')
    expect(safeExternalHttpUrl('https://user:pass@example.edu')).toBe('')
    expect(safeExternalHttpUrl('https://example.edu\\@evil.test')).toBe('')
  })

  it('keeps mail and phone links constrained to safe forms', () => {
    expect(safeMailtoHref('prof@example.edu')).toBe('mailto:prof@example.edu')
    expect(safeMailtoHref('prof@example.edu?subject=x')).toBe('')
    expect(safeMailtoHref('not an email@example.edu')).toBe('')
    expect(safeMailtoHref('prof<attack>@example.edu')).toBe('')
    expect(safeTelHref('+1 (555) 010-1010')).toBe('tel:+15550101010')
  })

  it('uses the same filter for markdown preview links', () => {
    expect(safeMarkdownHref('mailto:prof@example.edu')).toBe('mailto:prof@example.edu')
    expect(safeMarkdownHref('https://example.edu')).toBe('https://example.edu')
    expect(safeMarkdownHref('javascript:alert(1)')).toBe('')
  })
})
