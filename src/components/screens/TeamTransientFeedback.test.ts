import { describe, expect, it } from 'vitest'
import teamSource from './TeamScreen.tsx?raw'

describe('Team transient feedback ownership', () => {
  it('routes permission outcomes through the shared top toast instead of a page banner', () => {
    expect(teamSource).toMatch(
      /notifyTeamSuccess\(format\(tx\('team\.delegatedAccessUpdated'\),/,
    )
    expect(teamSource).toContain("onNotify?.(notification, 'success')")
    expect(teamSource).toContain("onNotify?.(notification, 'error')")
    expect(teamSource).not.toContain('className="team-message')
  })
})
