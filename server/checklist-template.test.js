import { describe, expect, it } from 'vitest'
import { buildDefaultChecklistMaterials } from './checklist-template.js'

describe('default application checklist template', () => {
  it('creates the expected checklist rows for a new application', () => {
    const checklist = buildDefaultChecklistMaterials()
    const names = checklist.map((item) => item.name)

    expect(names).toEqual([
      'Academic CV',
      'Recommendation Letters',
      'Personal Statement (PS)',
      'Research Proposal (RP)',
      'Language Scores (IELTS/TOEFL)',
      'Portal Registration',
      'Statement of Purpose (SOP)',
      'Final Submission',
    ])

    expect(checklist.every((item) => item.status === 'Missing')).toBe(true)
    expect(checklist.every((item) => item.reminderEnabled === false)).toBe(true)
    expect(checklist.every((item) => item.reminderDate === '')).toBe(true)
    expect(checklist.every((item) => item.details.length > 0)).toBe(true)
  })

  it('prepares recommendation letters with editable recommender slots', () => {
    const recommendation = buildDefaultChecklistMaterials().find(
      (item) => item.name === 'Recommendation Letters',
    )

    expect(recommendation).toMatchObject({
      type: 'Request',
      group: 'Recommendations',
      requiredCount: 3,
    })
    expect(recommendation?.recommenders).toHaveLength(3)
    expect(recommendation?.recommenders?.[0]).toMatchObject({
      name: '',
      contact: '',
    })
  })
})
