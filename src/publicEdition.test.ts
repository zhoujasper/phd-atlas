import { describe, expect, it } from 'vitest'
import { PUBLIC_DISTRIBUTION, PUBLIC_EDITION as frontendPublicEdition } from './edition'

describe('public personal edition', () => {
  it('ships with the Team archive boundary enabled', () => {
    expect(frontendPublicEdition).toBe(true)
    expect(PUBLIC_DISTRIBUTION).toBe(true)
  })
})
