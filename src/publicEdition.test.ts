import { describe, expect, it } from 'vitest'
import { PUBLIC_EDITION as frontendPublicEdition } from './edition'

describe('public Team edition', () => {
  it('ships with Team collaboration enabled', () => {
    expect(frontendPublicEdition).toBe(false)
  })
})
