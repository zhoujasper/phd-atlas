import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'

describe('Dossier email composer action sizing', () => {
  it('uses the Save Draft compact rhythm for every desktop composer action', () => {
    expect(coreStyles).toMatch(
      /\.draft-composer \.composer-actions \.composer-action\s*\{[^}]*height:\s*var\(--action-height-compact\);[^}]*min-height:\s*var\(--action-height-compact\);[^}]*padding:\s*0 var\(--action-padding-inline-compact\);[^}]*gap:\s*5px;[^}]*font-size:\s*12px;/s,
    )
    expect(coreStyles).toMatch(
      /\.composer-actions > \.anchored-popover-root\s*\{[^}]*flex:\s*0 0 auto;[^}]*display:\s*inline-flex;/s,
    )
  })

  it('keeps all three phone actions uniformly touch-safe', () => {
    expect(coreStyles).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.composer-actions > \*\s*\{[^}]*width:\s*100%;[^}]*\}[\s\S]*?\.draft-composer \.composer-actions \.composer-action\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;/s,
    )
  })
})
