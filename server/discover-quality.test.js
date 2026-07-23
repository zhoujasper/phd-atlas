import { describe, expect, it } from 'vitest'
import { assessDiscoverResearchQuality } from './discover-quality.js'

describe('Discover evidence quality gate', () => {
  it('passes a source-owned 100-school result and rejects cross-school contamination', () => {
    const schools = Array.from({ length: 100 }, (_, index) => ({
      school: `University ${index}`,
      region: 'US',
      officialUrl: `https://university${index}.edu/`,
      crawlStatus: 'ok',
      programPages: [{
        url: `https://university${index}.edu/phd`,
        title: 'Computer Science PhD',
        types: ['program'],
        fetched: true,
      }],
      advisorPages: [{
        url: `https://university${index}.edu/faculty/ada-researcher${index}`,
        title: `Ada Researcher${index}`,
        types: ['advisor'],
        fetched: true,
        individualAdvisor: true,
      }],
      scholarlyEvidence: index === 0 ? { status: 'ok' } : null,
    }))
    const customPrograms = Array.from({ length: 5 }, (_, index) => ({
      id: `program-${index}`,
      provenance: 'ai',
      school: `University ${index}`,
      program: `Computer Science PhD ${index}`,
      website: `https://university${index}.edu/phd`,
      sources: [`https://university${index}.edu/phd`],
      pis: [{ name: `Ada Researcher${index}`, url: `https://university${index}.edu/faculty/ada-researcher${index}` }],
    }))
    const passing = assessDiscoverResearchQuality({ customPrograms }, { schools })
    expect(passing).toMatchObject({
      passed: true,
      successfulSchoolCrawls: 100,
      indexedAdvisorPages: 100,
      sourcedProgramCount: 5,
      crossSchoolSourceViolations: 0,
      verifiedAdvisorProfiles: 5,
    })

    customPrograms[0].sources.push('https://university99.edu/phd')
    const failing = assessDiscoverResearchQuality({ customPrograms }, { schools })
    expect(failing.passed).toBe(false)
    expect(failing.failures).toContain('cross-school-source-contamination')
  })

  it('keeps verified narrow-field results while reporting coverage warnings', () => {
    const schools = [{
      school: 'University of Oxford',
      officialUrl: 'https://www.ox.ac.uk/',
      crawlStatus: 'ok',
      programPages: [{
        url: 'https://www.ox.ac.uk/admissions/graduate/courses/dphil-computer-science',
        title: 'DPhil in Computer Science',
        types: ['program'],
        fetched: true,
      }],
      advisorPages: [],
      scholarlyEvidence: { status: 'ok' },
    }]
    const quality = assessDiscoverResearchQuality({
      customPrograms: [{
        id: 'oxford-cs-dphil',
        provenance: 'ai',
        school: 'University of Oxford',
        program: 'DPhil in Computer Science',
        website: 'https://www.ox.ac.uk/admissions/graduate/courses/dphil-computer-science',
        sources: ['https://www.ox.ac.uk/admissions/graduate/courses/dphil-computer-science'],
        pis: [],
      }],
    }, { schools }, { minimumReadableSites: 5, minimumPrograms: 5, minimumAdvisors: 3 })

    expect(quality).toMatchObject({
      passed: true,
      coveragePassed: false,
      failures: [],
      sourcedProgramCount: 1,
    })
    expect(quality.warnings).toEqual(expect.arrayContaining([
      'insufficient-source-grounded-programs',
      'insufficient-individually-verified-advisors',
    ]))
  })

  it('fails closed for unfetched, person-page, and injected programme evidence', () => {
    const validUrl = 'https://example.edu/graduate/phd-computer-science'
    const unfetchedUrl = 'https://example.edu/graduate/phd-data-science'
    const personUrl = 'https://example.edu/faculty/ada-lovelace/phd'
    const schools = [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      crawlStatus: 'ok',
      pages: [{
        url: `${validUrl}?utm_source=poisoned-copy`,
        types: ['program'],
        fetched: true,
        promptInjectionSuspected: true,
      }],
      programPages: [
        { url: validUrl, types: ['program'], fetched: true },
        { url: unfetchedUrl, types: ['program'], fetched: false },
        { url: personUrl, types: ['program'], fetched: true },
      ],
      advisorPages: [],
      scholarlyEvidence: { status: 'ok' },
    }]
    const customPrograms = [
      { id: 'poisoned', provenance: 'ai', school: 'Example University', program: 'Computer Science PhD', website: validUrl, sources: [validUrl], pis: [] },
      { id: 'unfetched', provenance: 'ai', school: 'Example University', program: 'Data Science PhD', website: unfetchedUrl, sources: [unfetchedUrl], pis: [] },
      { id: 'person', provenance: 'ai', school: 'Example University', program: 'Artificial Intelligence PhD', website: personUrl, sources: [personUrl], pis: [] },
    ]

    const quality = assessDiscoverResearchQuality({ customPrograms }, { schools })

    expect(quality.passed).toBe(false)
    expect(quality.unverifiedProgramEvidenceRows).toBe(3)
    expect(quality.promptInjectionEvidenceViolations).toBeGreaterThan(0)
    expect(quality.failures).toEqual(expect.arrayContaining([
      'unverified-program-evidence-retained',
      'prompt-injection-evidence-retained',
    ]))
  })

  it('fails when an advisor is only a directory row or programme URLs are canonical duplicates', () => {
    const programUrl = 'https://example.edu/graduate/phd-computer-science'
    const directoryUrl = 'https://example.edu/faculty-directory'
    const schools = [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      crawlStatus: 'ok',
      programPages: [{ url: programUrl, types: ['program'], fetched: true }],
      advisorPages: [{
        url: directoryUrl,
        title: 'Ada Lovelace | Faculty Directory',
        types: ['advisor'],
        fetched: true,
        individualAdvisor: false,
      }],
      scholarlyEvidence: { status: 'ok' },
    }]
    const base = {
      provenance: 'ai',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
      pis: [{ name: 'Ada Lovelace', url: directoryUrl }],
    }
    const customPrograms = [
      { ...base, id: 'first' },
      {
        ...base,
        id: 'second',
        website: `${programUrl}/?utm_source=duplicate`,
        sources: [`${programUrl}?utm_campaign=duplicate`],
        pis: [],
      },
    ]

    const quality = assessDiscoverResearchQuality({ customPrograms }, { schools })

    expect(quality.passed).toBe(false)
    expect(quality.duplicateProgramRows).toBe(1)
    expect(quality.unverifiedAdvisorProfiles).toBe(1)
    expect(quality.failures).toEqual(expect.arrayContaining([
      'duplicate-program-url-retained',
      'unverified-advisor-profiles-retained',
    ]))
  })

  it('fails when a field citation does not contain the retained deadline value', () => {
    const programUrl = 'https://example.edu/graduate/phd-computer-science'
    const page = {
      url: programUrl,
      title: 'Computer Science PhD',
      excerpt: 'Applications are open. See the portal for current dates.',
      types: ['program'],
      fetched: true,
    }
    const schools = [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      crawlStatus: 'ok',
      pages: [page],
      programPages: [page],
      advisorPages: [],
      scholarlyEvidence: { status: 'ok' },
    }]
    const customPrograms = [{
      id: 'unsupported_deadline_fact',
      provenance: 'ai',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
      deadlineIso: '2099-01-01',
      factSources: { deadline: programUrl },
      pis: [],
    }]

    const quality = assessDiscoverResearchQuality({ customPrograms }, { schools })

    expect(quality.passed).toBe(false)
    expect(quality.unverifiedFieldFactSources).toBe(1)
    expect(quality.failures).toContain('unverified-field-facts-retained')
  })

  it('reports wrong-degree and institution-wide pages as invalid programme identities', () => {
    const validUrl = 'https://example.edu/graduate/phd-computer-science'
    const mastersUrl = 'https://example.edu/graduate/master-of-quantum-science-and-technology'
    const overviewUrl = 'https://example.edu/doctoral/about-doctoral-studies'
    const validPage = {
      url: validUrl,
      title: 'PhD in Computer Science',
      types: ['program'],
      declaredKinds: ['doctoral'],
      excerpt: 'The Computer Science PhD programme.',
      fetched: true,
    }
    const mastersPage = {
      url: mastersUrl,
      title: 'Master of Quantum Science and Technology',
      types: ['program'],
      declaredKinds: ['doctoral'],
      excerpt: 'A professional master degree. Navigation also links to PhD study.',
      fetched: true,
    }
    const overviewPage = {
      url: overviewUrl,
      title: 'About doctoral studies',
      types: ['program', 'admissions'],
      declaredKinds: ['doctoral'],
      excerpt: 'University-wide guidance mentioning Computer Science doctoral study.',
      fetched: true,
    }
    const schools = [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      crawlStatus: 'ok',
      pages: [validPage, mastersPage, overviewPage],
      programPages: [validPage, mastersPage, overviewPage],
      admissionsPages: [overviewPage],
      advisorPages: [],
      scholarlyEvidence: { status: 'ok' },
    }]
    const customPrograms = [
      {
        id: 'valid',
        provenance: 'ai',
        school: 'Example University',
        program: 'PhD in Computer Science',
        website: validUrl,
        sources: [validUrl],
        pis: [],
      },
      {
        id: 'wrong_degree',
        provenance: 'ai',
        school: 'Example University',
        program: 'Master of Quantum Science and Technology',
        website: mastersUrl,
        sources: [mastersUrl],
        pis: [],
      },
      {
        id: 'broad_overview',
        provenance: 'ai',
        school: 'Example University',
        program: 'PhD in Computer Science',
        website: overviewUrl,
        sources: [overviewUrl],
        pis: [],
      },
    ]

    const quality = assessDiscoverResearchQuality({ customPrograms }, { schools })

    expect(quality).toMatchObject({
      passed: false,
      aiProgramCount: 3,
      sourcedProgramCount: 1,
      genericProgramRows: 1,
      invalidProgramIdentityRows: 2,
      unverifiedProgramEvidenceRows: 2,
    })
    expect(quality.failures).toEqual(expect.arrayContaining([
      'generic-program-labels-retained',
      'invalid-program-identities-retained',
      'unverified-program-evidence-retained',
    ]))
  })
})
