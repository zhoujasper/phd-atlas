import { describe, expect, it } from 'vitest'
import { deriveOfficialProgramLeads } from './discover-program-leads.js'

function crawlResult(overrides = {}) {
  return {
    source: {
      school: 'Example University',
      region: 'US',
      url: 'https://www.example.edu/',
      allowedHosts: ['example.edu'],
      seeds: [{ kind: 'doctoral', url: 'https://grad.example.edu/programs/phd/' }],
    },
    pages: [{
      url: 'https://grad.example.edu/programs/phd/',
      title: 'Computer Science PhD | Example University',
      label: null,
      types: ['program', 'admissions'],
      fetched: true,
      declaredKind: 'doctoral',
      declaredKinds: ['doctoral'],
      promptInjectionSuspected: false,
    }],
    ...overrides,
  }
}

describe('deriveOfficialProgramLeads', () => {
  it('returns a lead-only candidate copied exactly from a fetched declared official page', () => {
    expect(deriveOfficialProgramLeads([crawlResult()])).toEqual([{
      leadType: 'official-program-page',
      school: 'Example University',
      region: 'US',
      candidateLabel: 'Computer Science PhD | Example University',
      candidateLabelSource: 'title',
      officialUrl: 'https://grad.example.edu/programs/phd',
      matchedFieldTerms: [],
      fieldMatchScore: null,
      verification: 'fetched-official-declared-page',
      canPersistProgramFact: false,
      evidence: {
        url: 'https://grad.example.edu/programs/phd',
        title: 'Computer Science PhD | Example University',
        label: null,
        pageTypes: ['program', 'admissions'],
        declaredKinds: ['doctoral'],
        declarationBasis: 'page-metadata',
        fetched: true,
        official: true,
        untrusted: true,
      },
    }])
  })

  it('prefers an exact field-matching link label and can require that field match', () => {
    const result = crawlResult({
      pages: [
        {
          url: 'https://grad.example.edu/programs/phd/',
          title: 'Doctoral programmes',
          label: 'Machine Learning PhD',
          types: ['program'],
          fetched: true,
          declaredKinds: ['doctoral'],
        },
        {
          url: 'https://grad.example.edu/programs/physics-doctorate',
          title: 'Physics Doctorate',
          types: ['program'],
          fetched: true,
          declaredKinds: ['doctoral'],
        },
      ],
    })

    expect(deriveOfficialProgramLeads([result], {
      fieldTerms: ['machine learning'],
      requireFieldMatch: true,
    })).toMatchObject([{
      candidateLabel: 'Machine Learning PhD',
      candidateLabelSource: 'label',
      matchedFieldTerms: ['machine learning'],
      fieldMatchScore: 1,
    }])
  })

  it('accepts an exact declared doctoral seed URL even when page declaration metadata is absent', () => {
    const result = crawlResult({
      pages: [{
        url: 'https://grad.example.edu/programs/phd',
        title: 'Ph.D. in Robotics',
        types: ['program'],
        fetched: true,
      }],
    })

    const [lead] = deriveOfficialProgramLeads([result])
    expect(lead).toMatchObject({
      candidateLabel: 'Ph.D. in Robotics',
      officialUrl: 'https://grad.example.edu/programs/phd',
      canPersistProgramFact: false,
      evidence: {
        declaredKinds: [],
        declarationBasis: 'source-doctoral-seed',
      },
    })
  })

  it('accepts a fetched page from the source-index program bucket without inventing declaration metadata', () => {
    const page = {
      url: 'https://cs.indexed.example/dphil',
      title: 'DPhil in Computer Science',
      types: ['program'],
      fetched: true,
    }
    const index = {
      schools: [{
        school: 'Indexed University',
        region: 'UK',
        officialUrl: 'https://www.indexed.example/',
        allowedHosts: ['indexed.example'],
        pages: [page],
        programPages: [page],
        admissionsPages: [],
      }],
    }

    expect(deriveOfficialProgramLeads(index)).toMatchObject([{
      school: 'Indexed University',
      candidateLabel: 'DPhil in Computer Science',
      verification: 'fetched-official-declared-page',
      evidence: {
        declaredKinds: [],
        declarationBasis: 'source-index-program-bucket',
      },
    }])
  })

  it('accepts an undeclared page only when its doctoral label and URL path independently signal a programme', () => {
    const base = crawlResult()
    const result = {
      ...base,
      source: { ...base.source, seeds: [] },
      pages: [{
        url: 'https://grad.example.edu/study/courses/computer-science-phd',
        title: 'Computer Science PhD',
        label: null,
        types: ['program'],
        fetched: true,
        declaredKinds: [],
      }],
    }

    expect(deriveOfficialProgramLeads([result])).toMatchObject([{
      candidateLabel: 'Computer Science PhD',
      evidence: {
        declaredKinds: [],
        declarationBasis: 'dual-page-signals',
      },
    }])
  })

  it('accepts multilingual doctoral labels only when the official URL independently carries a programme signal', () => {
    const base = crawlResult()
    const result = {
      ...base,
      source: { ...base.source, seeds: [] },
      pages: [{
        url: 'https://grad.example.edu/estudios/programas/doctorado-inteligencia-artificial',
        title: 'Doctorado en Inteligencia Artificial',
        types: ['program'],
        fetched: true,
        declaredKinds: [],
      }],
    }

    expect(deriveOfficialProgramLeads([result])).toMatchObject([{
      candidateLabel: 'Doctorado en Inteligencia Artificial',
      evidence: { declarationBasis: 'dual-page-signals' },
    }])
  })

  it.each([
    ['unfetched page', { fetched: false }],
    ['undeclared page with a weak URL', { declaredKind: null, declaredKinds: [], url: 'https://grad.example.edu/academics/computer-science' }],
    ['non-official host', { url: 'https://example.edu.evil.test/programs/phd' }],
    ['person page', { url: 'https://grad.example.edu/people/ada/phd' }],
    ['news page', { url: 'https://grad.example.edu/news-all/new-computer-science-phd' }],
    ['event page', { url: 'https://grad.example.edu/events/phd-open-day' }],
    ['doctoral administration page', {
      url: 'https://grad.example.edu/dottorato/collaborazioni-mobilita-internazionale',
      title: 'Collaborazioni e mobilità internazionale dottorati',
      declaredKind: null,
      declaredKinds: [],
    }],
    ['non-doctoral title and label', { title: 'Graduate programmes', label: 'Admissions' }],
    ['suspected injected page', { promptInjectionSuspected: true }],
  ])('fails closed for a %s', (_label, pagePatch) => {
    const base = crawlResult()
    const result = { ...base, pages: [{ ...base.pages[0], ...pagePatch }] }
    expect(deriveOfficialProgramLeads([result])).toEqual([])
  })

  it('deduplicates canonical URLs and applies the requested result limit', () => {
    const base = crawlResult()
    const result = {
      ...base,
      pages: [
        base.pages[0],
        { ...base.pages[0], url: 'https://grad.example.edu/programs/phd' },
        {
          ...base.pages[0],
          url: 'https://grad.example.edu/programs/robotics-phd',
          title: 'Robotics PhD',
          declaredKinds: ['doctoral'],
        },
      ],
    }
    expect(deriveOfficialProgramLeads([result], { limit: 1 })).toHaveLength(1)
  })
})
