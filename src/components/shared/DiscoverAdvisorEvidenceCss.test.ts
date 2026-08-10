import { describe, expect, it } from 'vitest'
import discoverStyles from '../../styles/discover.css?raw'
import discoverWorkspaceSource from './DiscoverWorkspace.tsx?raw'

describe('Discover advisor evidence presentation', () => {
  it('renders scholarly identity and publications as a quiet ledger, not nested cards', () => {
    expect(discoverWorkspaceSource).toContain("title={tx('discover.scholarlyRecord'")
    expect(discoverWorkspaceSource).toContain('className="discover-publication-ledger"')
    expect(discoverWorkspaceSource).toContain('scholarly.recentWorks.map((work) =>')
    expect(discoverWorkspaceSource).not.toContain('scholarly.recentWorks.slice(')
    expect(discoverWorkspaceSource).toContain('institution-scoped')

    const ledgerRule = discoverStyles.match(/\.discover-publication-ledger ol\s*\{([^}]*)\}/s)?.[1] ?? ''
    const rowRule = discoverStyles.match(/\.discover-publication-ledger li\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(ledgerRule).toContain('list-style: none')
    expect(rowRule).toContain('border-bottom: 1px solid var(--border)')
    expect(rowRule).not.toContain('border-radius')
    expect(rowRule).not.toContain('box-shadow')
  })

  it('keeps identifiers external and exposes a direct verified email action', () => {
    expect(discoverWorkspaceSource).toContain('scholarly?.profileUrl')
    expect(discoverWorkspaceSource).toContain('https://orcid.org/')
    expect(discoverWorkspaceSource).toContain('href={`mailto:${pi.email}`}')
    expect(discoverWorkspaceSource).toContain('{...DISCOVER_EXTERNAL_LINK_PROPS}')
  })
})
