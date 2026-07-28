import { describe, expect, it } from 'vitest'
import { passkeyLoginEmailHint } from './passkeyClient'

describe('passkeyLoginEmailHint', () => {
  it('uses discoverable credentials in an installed PWA', () => {
    expect(passkeyLoginEmailHint('person@example.com', true)).toBe('')
  })

  it('keeps the email hint in a normal browser tab', () => {
    expect(passkeyLoginEmailHint('  person@example.com  ', false)).toBe('person@example.com')
  })
})
