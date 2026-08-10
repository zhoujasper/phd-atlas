import { describe, expect, it } from 'vitest'
import settingsStyles from '../../styles/settings.css?raw'

describe('Settings frontend build signature', () => {
  it('stays compact and aligns with the desktop settings content column', () => {
    expect(settingsStyles).toMatch(/\.settings-frontend-build\s*\{[^}]*padding:\s*0 0 0 calc\(var\(--settings-index-width\) \+ 28px\)/s)
    expect(settingsStyles).toMatch(/\.settings-frontend-build-inner\s*\{[^}]*width:\s*min\(100%, 720px\)/s)
    expect(settingsStyles).toMatch(/\.settings-frontend-build-content\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
    expect(settingsStyles).toMatch(/\.settings-frontend-build-content strong\s*\{[^}]*font-size:\s*9px/s)
    expect(settingsStyles).toMatch(/\.settings-frontend-build-content code\s*\{[^}]*display:\s*block/s)
    expect(settingsStyles).not.toContain('settings-frontend-build-copy-action')
    expect(settingsStyles).toMatch(/@media \(max-width:\s*980px\)[\s\S]*?\.settings-frontend-build\s*\{[^}]*padding-left:\s*0/s)
  })
})
