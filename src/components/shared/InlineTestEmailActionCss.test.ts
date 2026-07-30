import { describe, expect, it } from 'vitest'
import mailActionStyles from '../../styles/mail-actions.css?raw'

describe('inline test email action layout CSS', () => {
  it('contributes its complete idle width to a flex action row', () => {
    expect(mailActionStyles).toMatch(
      /\.inline-test-email\s*\{[^}]*flex:\s*0 0 auto[^}]*width:\s*var\(--inline-test-idle-width\)[^}]*max-width:\s*100%/s,
    )
    expect(mailActionStyles).not.toMatch(
      /width:\s*min\(var\(--inline-test-idle-width\),\s*100%\)/,
    )
  })
})
