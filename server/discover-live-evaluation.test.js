import { describe, expect, it } from 'vitest'
import {
  buildDiscoverResearchRecordLedger,
  evaluateDiscoverResearchResult,
} from './discover-live-evaluation.js'

function result({ programs, quality = {}, funnel = {} }) {
  const pages = programs.flatMap((program) => [
    { url: program.website, fetched: true, types: ['program'] },
    ...(program.pis || [])
      .filter((pi) => !String(pi.url || '').includes('unfetched.edu'))
      .map((pi) => ({ url: pi.url, fetched: true, types: ['advisor'], individualAdvisor: true })),
  ])
  return {
    nextState: { customPrograms: programs },
    sourceIndex: {
      schools: [{ school: 'Verified University', pages, programPages: pages, advisorPages: pages }],
      quality: { failures: [], warnings: [], ...quality },
      funnel,
    },
  }
}

function program(index, advisorCount = 2) {
  const programNames = ['One', 'Two', 'Three', 'Four', 'Five']
  const advisorNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']
  return {
    id: `verified-${index}`,
    provenance: 'ai',
    school: `Verified University ${index}`,
    program: `PhD in Computational Science ${index}`,
    website: `https://verified-${index}.edu/phd`,
    pis: Array.from({ length: advisorCount }, (_, advisorIndex) => ({
      id: `person-${index}-${advisorIndex}`,
      name: `Verified Researcher ${programNames[index - 1] || 'Other'} ${advisorNames[advisorIndex] || 'Other'}`,
      url: `https://verified-${index}.edu/people/researcher-${advisorIndex}`,
      profileMatch: {
        score: 50,
        evidenceUrl: `https://verified-${index}.edu/people/researcher-${advisorIndex}`,
        basis: 'applicant-profile+official-individual-profile',
      },
    })),
  }
}

describe('Discover live-run acceptance evaluator', () => {
  it('passes only a complete, fetched, deduplicated and profile-grounded result', () => {
    const evaluation = evaluateDiscoverResearchResult(result({
      programs: [program(1), program(2)],
      quality: { verifiedAdvisorProfiles: 4, profileMatchedAdvisorProfiles: 4 },
      funnel: { selectedOfficialSchools: 48, deepAdvisorPrograms: 2 },
    }), { scenario: 'fixture', requestedPrograms: 2, requestedPis: 2 })

    expect(evaluation).toMatchObject({
      passed: true,
      integrityPassed: true,
      coveragePassed: true,
      returned: { programs: 2, uniqueSchools: 2, advisors: 4 },
      evidence: { deterministicProfileMatchReceipts: 4 },
      funnel: { selectedOfficialSchools: 48 },
    })
  })

  it('fails obvious placeholders, duplicates, unfetched URLs and missing match receipts', () => {
    const first = program(1, 1)
    const duplicate = {
      ...program(2, 1),
      website: `${first.website}/`,
      pis: [{ id: 'benchmark-ada', name: 'Professor Ada', url: 'https://unfetched.edu/ada' }],
    }
    const evaluation = evaluateDiscoverResearchResult(result({ programs: [first, duplicate] }), {
      requestedPrograms: 2,
      requestedPis: 1,
    })

    expect(evaluation.integrityPassed).toBe(false)
    expect(evaluation.evidenceIntegrityFailures).toEqual(expect.arrayContaining([
      'duplicate-program-urls',
      'placeholder-output-retained',
      'advisor-url-not-in-fetched-evidence',
      'advisor-profile-fit-receipt-missing',
    ]))
  })

  it('fails integrity when an institution governance page is retained as an advisor terminal', () => {
    const candidate = program(1, 1)
    const governanceUrl = 'https://verified-1.edu/about/leadership/governance-and-compliance/academic-structure'
    candidate.pis[0] = {
      ...candidate.pis[0],
      name: 'Stella Bruzzi',
      url: governanceUrl,
      profileMatch: {
        score: 0,
        evidenceUrl: governanceUrl,
        basis: 'applicant-profile+official-individual-profile',
      },
    }
    const evaluation = evaluateDiscoverResearchResult(result({ programs: [candidate] }), {
      coverageMode: 'evidence-exhaustive',
    })

    expect(evaluation.integrityPassed).toBe(false)
    expect(evaluation.evidenceIntegrityFailures).toContain('generic-advisor-terminal-page-retained')
    expect(evaluation.genericAdvisorTerminalRows).toEqual([
      'advisor:verified-1:person-1-0',
    ])
  })

  it('separates honest coverage shortfall from fabrication risk', () => {
    const evaluation = evaluateDiscoverResearchResult(result({ programs: [program(1, 1)] }), {
      requestedPrograms: 4,
      requestedPis: 2,
    })

    expect(evaluation.integrityPassed).toBe(true)
    expect(evaluation.coveragePassed).toBe(false)
    expect(evaluation.coverageWarnings).toEqual(expect.arrayContaining([
      'requested-program-count-not-met',
      'requested-advisor-count-not-met',
    ]))
  })

  it('does not turn evidence-exhaustive research into an arbitrary count quota', () => {
    const evaluation = evaluateDiscoverResearchResult(result({ programs: [program(1, 1)] }), {
      requestedPrograms: 120,
      requestedPis: 20,
      coverageMode: 'evidence-exhaustive',
    })

    expect(evaluation.requested).toEqual({
      mode: 'evidence-exhaustive',
      programs: null,
      advisorsPerProgram: null,
      totalAdvisors: null,
    })
    expect(evaluation.coverage).toMatchObject({ programRecall: null, advisorRecall: null })
    expect(evaluation.coverageWarnings).not.toEqual(expect.arrayContaining([
      'requested-program-count-not-met',
      'requested-advisor-count-not-met',
    ]))
  })

  it('reports advisor information richness and compares against an independent official gold set', () => {
    const rich = program(1, 1)
    rich.pis[0] = {
      ...rich.pis[0],
      research: 'Official profile mentions graph learning.',
      email: 'researcher@verified-1.edu',
      recruiting: 'Accepting doctoral students',
      scholarly: {
        openAlexId: 'https://openalex.org/A123',
        orcid: 'https://orcid.org/0000-0001-2345-6789',
        profileUrl: 'https://openalex.org/A123',
        providers: ['openalex'],
        matchedQueries: ['graph learning'],
        recentWorks: [{
          title: 'Graph learning paper',
          year: 2025,
          citedByCount: 4,
          source: 'https://doi.org/10.1000/example',
          matchedQuery: 'graph learning',
          matchedTopic: null,
        }],
        match: {
          basis: 'institution-scoped-scholarly-record+official-individual-profile',
          nameMatch: 'exact',
          officialProfileUrl: rich.pis[0].url,
          institutionId: 'https://openalex.org/I123',
          checkedAt: '2026-08-09T00:00:00.000Z',
        },
      },
    }
    const evaluation = evaluateDiscoverResearchResult(result({ programs: [rich] }), {
      requestedPrograms: 1,
      requestedPis: 1,
      enforceRichness: true,
      enforceGoldCoverage: true,
      goldSet: {
        checkedAt: '2026-08-09T00:00:00.000Z',
        programs: [{
          school: rich.school,
          program: rich.program,
          officialUrl: rich.website,
        }],
        advisors: [{
          school: rich.school,
          name: rich.pis[0].name,
          officialUrl: rich.pis[0].url,
        }],
      },
    })

    expect(evaluation.richness).toMatchObject({
      scholarlyReceiptCoverage: 1,
      stableIdentifierCoverage: 1,
      recentWorksCoverage: 1,
      recentWorks: 1,
      meanCompleteness: 1,
    })
    expect(evaluation.goldComparison).toMatchObject({
      programs: { identityRecall: 1, urlRecall: 1, missed: [] },
      advisors: { identityRecall: 1, urlRecall: 1, missed: [] },
    })
    expect(evaluation.coverageWarnings).toEqual([])

    const ledger = buildDiscoverResearchRecordLedger(result({ programs: [rich] }))
    expect(ledger).toEqual([expect.objectContaining({
      school: rich.school,
      website: rich.website,
      advisors: [expect.objectContaining({
        name: rich.pis[0].name,
        officialProfileUrl: rich.pis[0].url,
        profileMatch: expect.objectContaining({
          evidenceUrl: rich.pis[0].url,
          basis: 'applicant-profile+official-individual-profile',
        }),
        scholarly: expect.objectContaining({
          openAlexId: 'https://openalex.org/A123',
          recentWorks: [expect.objectContaining({
            source: 'https://doi.org/10.1000/example',
          })],
        }),
      })],
    })])
  })

  it('treats an exact official URL as identity evidence and normalizes a leading school article', () => {
    const exact = program(1, 1)
    exact.school = 'The University of Edinburgh'
    exact.program = 'Computational Neuroscience PhD, MScR'
    const evaluation = evaluateDiscoverResearchResult(result({ programs: [exact] }), {
      requestedPrograms: 1,
      requestedPis: 1,
      goldSet: {
        programs: [{
          school: 'University of Edinburgh',
          program: 'Computational Neuroscience PhD',
          officialUrl: 'https://verified-1.edu/graduate-catalogue',
          officialUrlAliases: [exact.website],
        }],
        advisors: [{
          school: 'University of Edinburgh',
          name: exact.pis[0].name,
          officialUrl: exact.pis[0].url,
        }],
      },
    })

    expect(evaluation.goldComparison).toMatchObject({
      programs: { identityRecall: 1, missed: [] },
      advisors: { identityRecall: 1, missed: [] },
    })
  })

  it('reports a real advisor shared across two programs without calling either row a duplicate', () => {
    const first = program(1, 1)
    const second = {
      ...program(2, 1),
      school: first.school,
      pis: [{ ...first.pis[0], id: 'same-person-second-program' }],
    }
    const evaluation = evaluateDiscoverResearchResult(result({ programs: [first, second] }), {
      requestedPrograms: 2,
      requestedPis: 1,
    })

    expect(evaluation.integrityPassed).toBe(true)
    expect(evaluation.duplicates).toMatchObject({ advisors: 0, crossProgramAdvisors: 1 })
  })
})
