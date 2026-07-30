import { describe, expect, it } from 'vitest'
import {
  buildDiscoverDisciplineQuerySeeds,
  buildDiscoverDisciplinePlan,
  DISCOVER_DISCIPLINE_PROFILES,
  DISCOVER_DISCIPLINE_TAXONOMY_VERSION,
} from './discover-discipline-taxonomy.js'

describe('Discover professional discipline taxonomy', () => {
  it('covers every OECD FORD broad domain with a large specialist profile library', () => {
    const plan = buildDiscoverDisciplinePlan([
      '量子计算',
      '材料科学',
      '肿瘤免疫',
      '兽医学',
      '劳动经济学',
      '中世纪史与数字人文',
    ])

    expect(DISCOVER_DISCIPLINE_PROFILES.length).toBeGreaterThanOrEqual(90)
    expect(plan.taxonomyVersion).toBe(DISCOVER_DISCIPLINE_TAXONOMY_VERSION)
    expect(plan.broadDomains.map((domain) => domain.id)).toEqual(expect.arrayContaining([
      'natural_sciences',
      'engineering_and_technology',
      'medical_and_health_sciences',
      'agricultural_and_veterinary_sciences',
      'social_sciences',
      'humanities_and_arts',
    ]))
  })

  it('routes biomedical work to Europe PMC and economics to JEL terminology', () => {
    const biomedical = buildDiscoverDisciplinePlan('空间转录组与癌症免疫治疗')
    expect(biomedical.providerHints).toContain('europepmc')
    expect(biomedical.vocabularies).toContain('mesh')
    expect(biomedical.canonicalTerms).toEqual(expect.arrayContaining([
      'single-cell genomics',
      'immunology',
      'cancer research',
    ]))

    const economics = buildDiscoverDisciplinePlan('labor economics and econometrics')
    expect(economics.vocabularies).toContain('jel')
    expect(economics.relatedTerms).toEqual(expect.arrayContaining([
      'labor economics',
      'applied econometrics',
    ]))
  })

  it('recognizes specialist humanities and legal research without assuming STEM', () => {
    const plan = buildDiscoverDisciplinePlan('medieval history, second language acquisition, constitutional law')
    expect(plan.disciplines.map((discipline) => discipline.id)).toEqual(expect.arrayContaining([
      'medieval-history',
      'second-language-acquisition',
      'constitutional-law',
    ]))
    expect(plan.broadDomains.map((domain) => domain.id)).toEqual(expect.arrayContaining([
      'humanities_and_arts',
      'social_sciences',
    ]))
  })

  it('round-robins user directions before spending topic budget on adjacent terms', () => {
    expect(buildDiscoverDisciplineQuerySeeds([
      '相场多尺度材料建模',
      '肿瘤免疫与空间转录组',
      '劳动经济学',
      '比较宪法学',
      '中世纪史与数字人文',
      '第二语言习得',
    ], { limit: 12 })).toEqual([
      'phase-field modeling',
      'single-cell genomics',
      'labor markets',
      'constitutional jurisprudence',
      'medieval history',
      'second language acquisition',
      'multiscale modeling',
      'immunology',
      'economics',
      'constitutional law',
      'digital humanities',
      'cancer research',
    ])
  })
})
