import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import settingsStyles from '../../styles/settings.css?raw'

describe('mobile theme and settings polish contracts', () => {
  it('registers inherited color tokens and keeps the theme handoff color-only', () => {
    expect(coreStyles).toMatch(
      /@property --canvas\s*\{[^}]*syntax:\s*'<color>';[^}]*inherits:\s*true;/s,
    )
    expect(coreStyles).toMatch(
      /@media \(max-width: 820px\) \{[\s\S]*?:root\.theme-transitioning,[\s\S]*?transition-property:[\s\S]*?--surface,[\s\S]*?background,[\s\S]*?caret-color;[\s\S]*?transition-duration:\s*320ms !important;/s,
    )
    expect(coreStyles).toMatch(
      /:root\.theme-transitioning \.switch-control span\s*\{[^}]*transition-property:\s*transform, background, background-color, box-shadow !important;/s,
    )
  })

  it('keeps the phone user-id row compact without shrinking its copy hit track', () => {
    expect(settingsStyles).toMatch(
      /@media \(max-width: 820px\) \{[\s\S]*?\.settings-account-id\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?var\(--mobile-icon-control-size, 32px\);[\s\S]*?padding-block:\s*0;/s,
    )
    expect(settingsStyles).toMatch(
      /\.settings-account-id small\s*\{[\s\S]*?font-size:\s*8px;[\s\S]*?\}[\s\S]*?\.settings-account-id code\s*\{[\s\S]*?font-size:\s*10px;/s,
    )
  })
})
