import { describe, expect, it } from 'vitest'
import {
  checklistStatusKey,
  mergeChecklistStatuses,
  normalizeChecklistCustomStatuses,
  normalizeChecklistStatus,
} from './checklistStatusModel'

describe('checklist status model', () => {
  it('keeps built-ins first and deduplicates custom and legacy values case-insensitively', () => {
    expect(mergeChecklistStatuses(['Open', 'Done'], ['Needs review', 'Open'], ['needs   review', 'Waiting'])).toEqual([
      'Open',
      'Done',
      'Needs review',
      'Waiting',
    ])
  })

  it('normalizes whitespace without changing the user-facing capitalization', () => {
    expect(normalizeChecklistStatus('  Needs   Faculty Review  ')).toBe('Needs Faculty Review')
    expect(checklistStatusKey(' needs faculty review ')).toBe('needs faculty review')
  })

  it('does not persist built-ins, duplicates, or more than the account limit', () => {
    const values = Array.from({ length: 35 }, (_, index) => `Stage ${index}`)
    expect(normalizeChecklistCustomStatuses(['Open', 'open', 'Custom'], ['Open', 'Done'])).toEqual(['Custom'])
    expect(normalizeChecklistCustomStatuses(values, ['Open', 'Done'])).toHaveLength(30)
  })
})
