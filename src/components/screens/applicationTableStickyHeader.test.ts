import { describe, expect, it } from 'vitest'
import { resolveApplicationTableStickyHeaderOffset } from './applicationTableStickyHeader'

describe('application table sticky header geometry', () => {
  it('keeps the header in normal flow before it reaches the sticky boundary', () => {
    expect(resolveApplicationTableStickyHeaderOffset({
      naturalTop: 180,
      stickyBoundary: 52,
      tableHeight: 900,
      headerHeight: 36,
    })).toBe(0)
  })

  it('pins the header to the resident table chrome while rows scroll underneath', () => {
    expect(resolveApplicationTableStickyHeaderOffset({
      naturalTop: -148,
      stickyBoundary: 12,
      tableHeight: 900,
      headerHeight: 36,
    })).toBe(160)
  })

  it('releases the header with the final row instead of escaping the table', () => {
    expect(resolveApplicationTableStickyHeaderOffset({
      naturalTop: -1200,
      stickyBoundary: 12,
      tableHeight: 900,
      headerHeight: 36,
    })).toBe(864)
  })
})
