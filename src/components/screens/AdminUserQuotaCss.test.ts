import { describe, expect, it } from 'vitest'
import adminStyles from '../../styles/admin.css?raw'

describe('Admin user quota table polish', () => {
  it('keeps the actions heading on the shared compact table type scale', () => {
    expect(adminStyles).toMatch(
      /\.admin-user-column-label\s*\{[^}]*font-size:\s*11px[^}]*font-weight:\s*700/s,
    )
  })

  it('keeps ordinary action controls compact enough to share one row and wraps only when needed', () => {
    expect(adminStyles).toMatch(
      /\.admin-user-actions \.quiet-action\s*\{[^}]*gap:\s*4px[^}]*padding:\s*0 7px[^}]*font-size:\s*11px/s,
    )
    expect(adminStyles).toMatch(
      /\.admin-user-actions\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s,
    )
  })

  it('animates quota progress widths and removes that motion for reduced-motion users', () => {
    expect(adminStyles).toMatch(
      /\.admin-mini-progress i\s*\{[^}]*transition:\s*width 420ms var\(--ease-out\)/s,
    )
    expect(adminStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.admin-mini-progress > i,[\s\S]*?transition-duration:\s*0\.01ms !important/s,
    )
  })
})
