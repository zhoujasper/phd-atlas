import { describe, expect, it } from 'vitest'
import { applications } from '../data/applications'
import { ApplicationSchema } from './applicationSchemas'

describe('application country contract', () => {
  it('accepts a saved application without a country', () => {
    const application = structuredClone(applications[0])
    application.school.country = ''
    application.professor.lab = ''

    expect(ApplicationSchema.safeParse(application).success).toBe(true)
  })
})
