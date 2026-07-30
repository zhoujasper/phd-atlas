import { describe, expect, it } from 'vitest'
import discoverStyles from '../../styles/discover.css?raw'
import discoverWorkspaceSource from './DiscoverWorkspace.tsx?raw'

describe('Discover mobile result action layout', () => {
  it('keeps the programme and advisor icon groups close to the right edge', () => {
    expect(discoverStyles).toMatch(
      /\.discover-mobile-card-actions\s*\{[^}]*right:\s*8px[^}]*gap:\s*2px/s,
    )
  })

  it('places programme selection immediately before the independent compare action', () => {
    const utilityStart = discoverWorkspaceSource.indexOf(
      '<div className="discover-mobile-result-utilities"',
    )
    const utilityEnd = discoverWorkspaceSource.indexOf('</div>', utilityStart)
    const utilitySource = discoverWorkspaceSource.slice(utilityStart, utilityEnd)

    expect(utilityStart).toBeGreaterThan(-1)
    expect(utilitySource).toMatch(
      /discover-selection-check[\s\S]*discover-compare-action[\s\S]*discover-delete-program-action/,
    )
    expect(discoverStyles).toMatch(
      /\.discover-mobile-result-utilities\s*\{[^}]*justify-content:\s*flex-start[^}]*gap:\s*4px/s,
    )
    expect(discoverStyles).toMatch(
      /\.discover-mobile-result-utilities \.discover-selection-check\s*\{[^}]*width:\s*28px[^}]*height:\s*28px[^}]*flex:\s*0 0 auto/s,
    )
    expect(discoverStyles).toMatch(
      /\.discover-mobile-result-utilities \.discover-delete-program-action\s*\{[^}]*margin-left:\s*auto/s,
    )
  })
})
