import { describe, expect, it } from 'vitest'
import { applications } from '../../data/applications'
import {
  fileSizeLabel,
  isChecklistGroup,
  isRecommendationMaterial,
  materialStatusFilterValue,
  normalizeRecommenders,
} from './dossierChecklistModel'

describe('dossier checklist model', () => {
  it('preserves checklist group and status-filter rules', () => {
    expect(isChecklistGroup('Recommendations')).toBe(true)
    expect(isChecklistGroup('Invented group')).toBe(false)
    expect(materialStatusFilterValue('Needs Review')).toBe('status:Needs Review')
  })

  it('builds stable recommender rows without discarding existing data', () => {
    const material = {
      ...structuredClone(applications[0].materials[0]),
      id: 'recommendation-request',
      type: 'Request',
      name: 'Recommendation letter',
      requiredCount: 3,
      recommenders: [{ id: 'advisor', name: 'Professor Ada', contact: 'ada@example.edu' }],
    }

    expect(isRecommendationMaterial(material)).toBe(true)
    expect(normalizeRecommenders(material)).toEqual([
      { id: 'advisor', name: 'Professor Ada', contact: 'ada@example.edu' },
      { id: 'recommendation-request-recommender-2', name: '', contact: '' },
      { id: 'recommendation-request-recommender-3', name: '', contact: '' },
    ])
  })

  it('formats attachment sizes exactly as the checklist rows expect', () => {
    expect(fileSizeLabel()).toBe('—')
    expect(fileSizeLabel(0)).toBe('0 B')
    expect(fileSizeLabel(1024)).toBe('1.0 KB')
    expect(fileSizeLabel(12 * 1024 * 1024)).toBe('12 MB')
  })
})
