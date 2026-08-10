import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (path) => readFileSync(resolve(root, path), 'utf8')

describe('current personal-only feature archive boundary', () => {
  it('keeps the collaboration archive switch enabled in both runtimes and public exports', () => {
    expect(source('src/edition.ts')).toContain('PUBLIC_EDITION = true')
    expect(source('server/edition.js')).toContain('PUBLIC_EDITION = true')
    if (existsSync(resolve(root, 'tools/export-public.mjs'))) {
      expect(source('tools/export-public.mjs')).toContain('PUBLIC_EXPORT_INCLUDES_TEAM = false')
      expect(source('.public/publicEdition.test.ts')).toContain('expect(frontendPublicEdition).toBe(true)')
    } else {
      expect(source('src/publicEdition.test.ts')).toContain('expect(frontendPublicEdition).toBe(true)')
    }
  })

  it('does not seed or mix retained collaboration data into current personal work', () => {
    const storage = source('server/storage.js')
    expect(storage).toContain('if (!publicProductionSetup && !PUBLIC_EDITION)')
    expect(storage).toContain('&& (!PUBLIC_EDITION || !application.teamId)')
    expect(storage).toContain('type NOT IN')

    const server = source('server/index.js')
    expect(server).toContain('const ARCHIVED_TEAM_NOTIFICATION_TYPES')
    expect(server).toContain("requestPath.startsWith('/api/teams/')")
    expect(server).toContain("requestPath.startsWith('/api/admin/teams/')")
    expect(server).toContain("requestBody.membershipPlan === 'team'")
  })

  it('omits collaboration entry points and runtime loading from current client surfaces', () => {
    const app = source('src/App.tsx')
    expect(app).not.toContain("import { TeamWorkspaceChooser } from './components/shared/TeamWorkspaceChooser'")
    expect(app).toContain('async function refreshTeamWorkspace')
    expect(app).toMatch(/if \(PUBLIC_EDITION\) \{\r?\n\s+setTeamWorkspaces\(\[\]\)/u)
    expect(app).toContain('!PUBLIC_EDITION && teamWorkspaceChooserOpen')
    expect(app).toContain("if (PUBLIC_EDITION) return 'personal'")

    expect(source('src/RootRoutes.tsx')).toContain('const isTeamInviteRoute = !PUBLIC_EDITION')
    expect(source('src/components/screens/AuthScreen.tsx')).toContain("...(!PUBLIC_EDITION ? ['team' as const] : [])")
    expect(source('src/components/screens/MarketingFeatureTour.tsx')).toContain("...(!PUBLIC_EDITION ? ['team' as const] : [])")
    expect(source('src/components/screens/UpgradeProScreen.tsx')).toContain("PUBLIC_EDITION && requestedFeature === 'team'")
  })

  it('keeps collaboration administration and dedicated tests outside current qualification', () => {
    const admin = source('src/components/screens/AdminScreen.tsx')
    expect(admin).toContain('if (!PUBLIC_EDITION) {')
    expect(admin).toContain('accountView === \'personal\' || PUBLIC_EDITION')
    expect(admin).toContain('!PUBLIC_EDITION && viewingTeam')
    expect(admin).toContain("...(!PUBLIC_EDITION ? [{ id: 'team'")

    const vite = source('vite.config.ts')
    expect(vite).toContain('testNamePattern: /^(?!.*\\bteam\\b).*/i')
    expect(vite).toContain("'**/*Team*.test.{ts,tsx,js}'")
    expect(vite).toContain("'**/*team*.test.{ts,tsx,js}'")
    expect(vite).toContain("'server/applicationTrashOwnership.test.js'")
  })
})
