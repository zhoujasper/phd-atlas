import { describe, expect, it } from 'vitest'
import { normalizeSharePermission, normalizeShareSections, shareSections } from './applications'

describe('normalizeSharePermission', () => {
  it('keeps supported share permissions', () => {
    expect(normalizeSharePermission('view')).toBe('view')
    expect(normalizeSharePermission('upload')).toBe('upload')
    expect(normalizeSharePermission('edit')).toBe('edit')
  })

  it('falls back to view for missing or unsupported permissions', () => {
    expect(normalizeSharePermission(undefined)).toBe('view')
    expect(normalizeSharePermission('undefined')).toBe('view')
    expect(normalizeSharePermission('admin')).toBe('view')
  })
})

describe('normalizeShareSections', () => {
  it('keeps supported share sections without duplicates', () => {
    expect(normalizeShareSections(['overview', 'materials', 'overview', 'timeline'])).toEqual([
      'overview',
      'materials',
      'timeline',
    ])
  })

  it('treats legacy missing sections as a complete share', () => {
    expect(normalizeShareSections(undefined)).toEqual([...shareSections])
  })

  it('falls back to overview when an explicit section list has no supported sections', () => {
    expect(normalizeShareSections(['admin', 'private-notes'])).toEqual(['overview'])
    expect(normalizeShareSections(null)).toEqual(['overview'])
  })
})
