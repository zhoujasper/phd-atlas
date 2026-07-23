import { describe, expect, it } from 'vitest'
import workspaceStyles from '../../index.css?raw'

const normalizedWorkspaceStyles = workspaceStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedWorkspaceStyles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('workspace layout motion CSS', () => {
  it('reveals the floating switcher without a per-frame layout or backdrop repaint', () => {
    const panelRule = cssRule('.workspace-layout-toolbar-panel')
    const bodyRule = cssRule('.workspace-layout-toolbar-body')
    const innerRule = cssRule('.workspace-layout-toolbar-body-inner')

    expect(panelRule).toContain('backdrop-filter: none')
    expect(bodyRule).toContain('grid-template-columns 0s linear')
    expect(innerRule).toContain('clip-path:')
    expect(innerRule).toContain('contain: layout paint')
  })

  it('uses only one animated size property for desktop pane toggles', () => {
    for (const selector of [
      '.workspace-layout .application-pane',
      '.workspace-layout .inspector-pane',
    ]) {
      const rule = cssRule(selector)
      expect(rule).toContain('flex-basis var(--duration)')
      expect(rule).not.toMatch(/\bwidth\s+var\(--duration/)
    }
  })

  it('does not interpolate pane widths while pointer resizing writes live values', () => {
    const rule = cssRule('.workspace-resizing .workspace-layout .application-pane,\n.workspace-resizing .workspace-layout .inspector-pane')
    expect(rule).toContain('transition: none')
  })
})
