import { describe, expect, it } from 'vitest'
import appSource from '../../App.tsx?raw'
import globalStyles from '../../index.css?raw'
import dashboardSource from './Dashboard.tsx?raw'

describe('application jump navigation integration', () => {
  it('scopes and consumes each jump while ordinary record clicks cancel the prior intent', () => {
    expect(appSource).toContain("Omit<DossierJumpIntent, 'applicationId' | 'token'>")
    expect(appSource).toContain('return { ...target, applicationId, token: workspaceJumpTokenRef.current }')
    expect(appSource).toContain('onJumpIntentConsumed={consumeWorkspaceJumpIntent}')
    expect(appSource).toMatch(
      /function selectApplication\(applicationId: string, jumpTarget\?: WorkspaceJumpTarget\) \{\s+\/\/[\s\S]*?setWorkspaceJumpIntent\(null\)/,
    )
    expect(appSource).toMatch(
      /if \(id === selected\?\.id\) \{\s+setWorkspaceJumpIntent\(null\)/,
    )
  })

  it('routes priority cards to the same concrete dossier target as deadline summaries', () => {
    expect(dashboardSource).toContain(
      'onClick={() => openDashboardApplication(app.id, dossierJumpTarget)}',
    )
    expect(dashboardSource).toContain(
      'onContextMenu={(event) => openDashboardApplicationContextMenu(event, app, dossierJumpTarget)}',
    )
    expect(dashboardSource).toContain(
      "const dossierJumpTarget: DashboardJumpTarget = { tab: 'dossier', targetId: 'dossier-config-card' }",
    )
  })

  it('uses two bounded accent breaths and a static reduced-motion locator', () => {
    expect(globalStyles).toContain('animation: jump-focus-glow 1.68s')
    expect(globalStyles).toContain('animation: jump-focus-wash 1.68s')
    expect(globalStyles).toMatch(
      /@keyframes jump-focus-glow \{[\s\S]*?10% \{[\s\S]*?28% \{[\s\S]*?45% \{[\s\S]*?68% \{/,
    )
    expect(globalStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.jump-focus \{[\s\S]*?animation: none;/,
    )
  })
})
