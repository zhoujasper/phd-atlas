import { describe, expect, it } from 'vitest'
import { PUBLIC_EDITION as frontendPublicEdition } from './edition'

describe('public edition boundary', () => {
  it('ships with the public frontend edition enabled', () => {
    expect(frontendPublicEdition).toBe(true)
  })
})
