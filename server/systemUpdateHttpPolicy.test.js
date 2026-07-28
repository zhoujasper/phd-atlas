import { describe, expect, it } from 'vitest'
import { usesSystemUpdateMutationBudget } from './systemUpdateHttpPolicy.js'

describe('system update HTTP rate-limit policy', () => {
  it('keeps progress, log, and release-check polling outside the upload budget', () => {
    expect(usesSystemUpdateMutationBudget('GET')).toBe(false)
    expect(usesSystemUpdateMutationBudget('HEAD')).toBe(false)
    expect(usesSystemUpdateMutationBudget('POST')).toBe(true)
    expect(usesSystemUpdateMutationBudget('DELETE')).toBe(true)
  })
})
