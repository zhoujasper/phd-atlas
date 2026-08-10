import { describe, expect, it } from 'vitest'
import {
  htmlResponse,
  jsonFixture,
  jsonResponse,
  readFixture,
} from './sources/adapterTestSupport.js'
import {
  admissionSignalTargetForApplication,
  admissionSignalTargetMatches,
  buildAdmissionOutcomesQueries,
  buildAdvisorSignalQueries,
  collectAdmissionOutcomes,
  collectAdvisorSignals,
  classifyDiscussionRecords,
  dedupeAdvisorWorks,
  normalizeDecision,
  runSourceSafely,
  summarizeAdmissionCycles,
  summarizeAdmissionOutcomes,
} from './admissionSignals.js'
import { buildNsfAwardsUrl, nsfAwardsQueryIsUnbounded } from './sources/nsfAwards.js'
import { buildNihReporterBody, nihReporterCriteriaAreUnbounded } from './sources/nihReporter.js'

/**
 * One aggregation calls several hosts, so the fake fetch dispatches on URL the
 * way the real network does. A request this map does not recognise fails
 * loudly: a silently-empty source would make a broken wiring look like "no
 * results", which is the exact failure this layer exists to prevent.
 */
function routedFetch(routes) {
  return async (url) => {
    const target = String(url)
    for (const [fragment, respond] of Object.entries(routes)) {
      if (target.includes(fragment)) return respond(target)
    }
    throw new Error(`Unrouted request in test: ${target}`)
  }
}

const gradcafeOk = () => htmlResponse(readFixture('gradcafe-results-ok.html'))
const noRetry = { retry: { maxAttempts: 1 } }

describe('admission signal decisions', () => {
  it('buckets the decision wording GradCafe actually uses', () => {
    expect(normalizeDecision('Accepted')).toBe('accepted')
    expect(normalizeDecision('admitted')).toBe('accepted')
    expect(normalizeDecision('Wait listed')).toBe('waitlisted')
    expect(normalizeDecision('waitlisted')).toBe('waitlisted')
    expect(normalizeDecision('Rejected')).toBe('rejected')
    expect(normalizeDecision('')).toBeNull()
    expect(normalizeDecision('something else')).toBeNull()
  })

  it('counts buckets and reports the latest parsable decision date', () => {
    const summary = summarizeAdmissionOutcomes([
      { value: { decision: 'accepted', date: '2024-02-01' } },
      { value: { decision: 'rejected', date: '2024-03-15' } },
      { value: { decision: 'wait listed', date: 'not a date' } },
      { value: { decision: 'mystery', date: null } },
    ])
    expect(summary.total).toBe(4)
    expect(summary.accepted).toBe(1)
    expect(summary.rejected).toBe(1)
    expect(summary.waitlisted).toBe(1)
    expect(summary.unclassified).toBe(1)
    expect(summary.latestDecisionAt).toBe('2024-03-15T00:00:00.000Z')
  })

  it('withholds an acceptance share until the sample can carry one', () => {
    const thin = summarizeAdmissionOutcomes([
      { value: { decision: 'accepted' } },
      { value: { decision: 'rejected' } },
      { value: { decision: 'rejected' } },
    ])
    // Three results is an anecdote. Publishing "33%" from it would read as a
    // statistic, so the UI is given nothing to render instead.
    expect(thin.acceptedShare).toBeNull()

    const enough = summarizeAdmissionOutcomes([
      { value: { decision: 'accepted' } },
      { value: { decision: 'accepted' } },
      { value: { decision: 'rejected' } },
      { value: { decision: 'waitlisted' } },
    ])
    expect(enough.acceptedShare).toBe(0.5)
  })

  it('keeps Reddit discovery posts only when school and field are visible', () => {
    const records = [
      { value: { title: 'Stanford CS PhD decisions', selfText: 'Computer Science interview timeline' } },
      { value: { title: 'Stanford Biology result', selfText: 'Molecular biology PhD' } },
      { value: { title: 'Computer Science decisions', selfText: 'Different university' } },
    ]
    const result = classifyDiscussionRecords(records, {
      school: 'Stanford University',
      program: 'PhD Computer Science',
    })
    expect(result.verified).toHaveLength(1)
    expect(result.verified[0].match).toMatchObject({
      verified: true,
      schoolMatch: true,
    })
    expect(result.possible).toHaveLength(2)
  })

  it('groups verified evidence by decision year rather than lookup date', () => {
    const cycles = summarizeAdmissionCycles([
      { value: { decision: 'accepted', date: '2025-02-01' } },
      { value: { decision: 'rejected', date: '2024-03-15' } },
      { value: { decision: 'waitlisted', date: 'February 20, 2025' } },
      { value: { decision: 'accepted', date: '' } },
    ])
    expect(cycles.map((cycle) => cycle.cycle)).toEqual(['2025', '2024', 'unknown'])
    expect(cycles[0]).toMatchObject({ total: 2, accepted: 1, waitlisted: 1 })
    expect(cycles[0].acceptedShare).toBeNull()
  })
})

describe('admission signal queries', () => {
  it('invalidates saved evidence when the application target changes', () => {
    const target = admissionSignalTargetForApplication({
      school: { name: 'University of Edinburgh' },
      program: 'Computer Science PhD',
      professor: { english: 'Prof. Fei-Fei Li' },
    })
    expect(target).toEqual({
      school: 'University of Edinburgh',
      program: 'Computer Science PhD',
      advisorName: 'Prof. Fei-Fei Li',
    })
    expect(admissionSignalTargetMatches({
      school: 'University of Edinburgh',
      program: 'Computer Science PhD',
      advisorName: 'Fei-Fei Li',
    }, target)).toBe(true)
    expect(admissionSignalTargetMatches({
      school: 'Stanford University',
      program: 'Computer Science PhD',
      advisorName: 'Fei-Fei Li',
    }, target)).toBe(false)
  })

  it('collapses duplicate scholarly versions without inflating advisor evidence', () => {
    const common = {
      sourceId: 'openalex-works',
      fetchedAt: '2026-08-09T00:00:00.000Z',
      match: { verified: true, confidence: 1 },
    }
    const unique = dedupeAdvisorWorks([
      { ...common, value: { title: 'One Paper', citedByCount: 10, publicationDate: '2024-01-01' } },
      { ...common, value: { title: 'One  Paper', citedByCount: 42, publicationDate: '2024-01-01' } },
      { ...common, value: { title: 'New Work', citedByCount: 2, publicationDate: '2025-01-01' } },
    ])
    expect(unique).toHaveLength(2)
    expect(unique[0].value.title).toBe('New Work')
    expect(unique[1].value.citedByCount).toBe(42)
  })

  it('maps an application onto each source query shape', () => {
    const queries = buildAdmissionOutcomesQueries({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      year: 2024,
    })
    expect(queries['gradcafe-results']).toEqual({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      year: 2024,
    })
    // Reddit takes one search string, not structured fields.
    expect(queries['reddit-submissions'].keyword).toBe('Stanford University PhD Computer Science')
  })

  it('falls back to a usable Reddit keyword when the application is empty', () => {
    expect(buildAdmissionOutcomesQueries({})['reddit-submissions'].keyword).toBe('PhD admissions')
  })

  it('maps an advisor onto parameter names the adapters actually read', () => {
    const queries = buildAdvisorSignalQueries({ name: 'Ada Turing', institution: 'Stanford University' })
    // `pi` is what buildNsfAwardsUrl and buildNihReporterBody look for. Sending
    // `principalInvestigator` instead left NSF with a bare keyword and NIH with
    // no criteria at all, so NIH answered with every active project it had.
    expect(queries['nsf-awards'].pi).toBe('Ada Turing')
    expect(queries['nih-reporter'].pi).toBe('Ada Turing')
    expect(queries['ukri-gateway-projects']).toEqual({
      name: 'Ada Turing',
      institution: 'Stanford University',
      limit: 12,
    })
    // OpenAlex's `search` is full text over titles and abstracts, so a name
    // there returns papers that mention the person rather than papers by them.
    expect(queries['openalex-works'].authorName).toBe('Ada Turing')
    expect(queries['openalex-works'].search).toBeUndefined()
    expect(queries['openalex-works']).toMatchObject({
      fromPublicationDate: '2021-01-01',
      sort: 'publication_date:desc',
    })
  })

  it('strips the honorific people type before querying the agencies', () => {
    // Verified live: NSF answers pdPIName="Prof. Fei-Fei Li" with nothing and
    // pdPIName="Fei-Fei Li" with her awards. Every application in a real
    // workspace stores the title, so leaving it on empties every lookup.
    const queries = buildAdvisorSignalQueries({ name: 'Prof. Ada Turing', institution: 'Stanford University' })
    expect(queries['nsf-awards'].pi).toBe('Ada Turing')
    expect(queries['nih-reporter'].pi).toBe('Ada Turing')
    expect(queries['openalex-works'].authorName).toBe('Ada Turing')
  })

  it('produces a query that constrains every advisor source', () => {
    const queries = buildAdvisorSignalQueries({ name: 'Ada Turing', institution: 'Stanford University' })
    expect(nsfAwardsQueryIsUnbounded(buildNsfAwardsUrl(queries['nsf-awards']))).toBe(false)
    expect(
      nihReporterCriteriaAreUnbounded(buildNihReporterBody(queries['nih-reporter']).criteria),
    ).toBe(false)
  })
})

describe('per-source isolation', () => {
  it('reports a thrown source as an error instead of rejecting', async () => {
    const exploding = {
      config: { id: 'boom', name: 'Boom' },
      run: async () => { throw new TypeError('network down') },
    }
    const outcome = await runSourceSafely(exploding, {})
    expect(outcome.status).toBe('error')
    expect(outcome.records).toEqual([])
    expect(outcome.error.kind).toBe('TypeError')
    expect(outcome.error.message).toContain('network down')
  })

  it('separates a source that needs credentials from one that broke', async () => {
    const unconfigured = {
      config: { id: 'needs-auth', name: 'Needs Auth' },
      run: async () => ({ status: 'empty', records: [], warnings: ['oauth-credentials-missing'], meta: {} }),
    }
    const outcome = await runSourceSafely(unconfigured, {})
    expect(outcome.status).toBe('not-configured')
  })
})

describe('collectAdmissionOutcomes', () => {
  it('returns GradCafe outcomes with provenance and a summary', async () => {
    const result = await collectAdmissionOutcomes(
      { school: 'Stanford University', program: 'PhD Computer Science', year: 2024 },
      { ...noRetry, fetchImpl: routedFetch({ 'thegradcafe.com': gradcafeOk }) },
    )

    // The fixture holds two rows: Stanford / PhD Computer Science, and Example
    // University / PhD Bioinformatics. Only the first is this programme, so
    // only the first may count toward its statistics.
    expect(result.summary.total).toBe(1)
    expect(result.outcomes).toHaveLength(1)
    expect(result.outcomes[0].value.school).toBe('Stanford University')
    expect(result.outcomes[0].match.verified).toBe(true)
    // The other row stays reachable, clearly separated from the counted ones.
    expect(result.unmatchedOutcomes).toHaveLength(1)
    expect(result.unmatchedOutcomes[0].value.school).toBe('Example University')
    for (const record of result.outcomes) {
      expect(record.sourceUrl).toBeTruthy()
      expect(record.fetchedAt).toBeTruthy()
    }
    expect(result.query).toEqual({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      year: 2024,
    })
    expect(result.fetchedAt).toBeTruthy()
  })

  it('uses Reddit official Atom results when OAuth credentials do not exist', async () => {
    const result = await collectAdmissionOutcomes(
      { school: 'Stanford University', program: 'PhD Computer Science' },
      {
        ...noRetry,
        fetchImpl: routedFetch({
          'thegradcafe.com': gradcafeOk,
          'search.rss': () => htmlResponse(readFixture('reddit-search-ok.atom.xml')),
        }),
        auth: { clientId: '', clientSecret: '', username: '', password: '' },
      },
    )
    const reddit = result.sources.find((source) => source.id === 'reddit-submissions')
    expect(reddit.status).toBe('ok')
    expect(result.discussions).toHaveLength(1)
    expect(result.discussions[0].value.transport).toBe('official-atom-feed')
    // The point of the isolation: GradCafe still answered.
    expect(result.outcomes).toHaveLength(1)
  })

  it('keeps one source when the other refuses the request', async () => {
    const result = await collectAdmissionOutcomes(
      { school: 'Stanford University', program: 'PhD Computer Science' },
      {
        ...noRetry,
        fetchImpl: routedFetch({
          'thegradcafe.com': () => htmlResponse('gone', { status: 503 }),
          // Match the token path before the host: oauth.reddit.com contains
          // reddit.com, so a host-only fragment would answer the search call
          // with a token payload.
          'access_token': () => jsonResponse(jsonFixture('reddit-token-ok.json')),
          'oauth.reddit.com': () => jsonResponse(jsonFixture('reddit-search-ok.json')),
        }),
        auth: {
          clientId: 'id', clientSecret: 'secret', username: 'user', password: 'pass',
        },
      },
    )
    const gradcafe = result.sources.find((source) => source.id === 'gradcafe-results')
    expect(gradcafe.status).toBe('error')
    expect(result.summary.total).toBe(0)
    expect(result.discussions.length).toBeGreaterThan(0)
  })
})

describe('collectAdvisorSignals', () => {
  it('aggregates funding and publication signals for one advisor', async () => {
    const result = await collectAdvisorSignals(
      { name: 'Ada Turing', institution: 'Stanford University' },
      {
        ...noRetry,
        fetchImpl: routedFetch({
          'api.nsf.gov': () => jsonResponse(jsonFixture('nsf-awards-ok.json')),
          'api.reporter.nih.gov': () => jsonResponse(jsonFixture('nih-projects-ok.json')),
          'api.openalex.org': () => jsonResponse(jsonFixture('openalex-works-ok.json')),
        }),
      },
    )

    // The NSF fixture credits Ada Turing, so it is hers. The NIH fixture
    // credits Rosa Franklin and the OpenAlex fixture credits Lin Zhang -- the
    // sources answered, but with other people's records, and attributing those
    // to this advisor is precisely the failure this layer exists to stop.
    expect(result.funding.hasPublicAward).toBe(true)
    expect(result.funding.awardCount).toBe(1)
    expect(result.awards[0].value.piName).toBe('Ada Turing')
    expect(result.awards[0].match.verified).toBe(true)
    expect(result.projects).toEqual([])
    expect(result.works).toEqual([])
    expect(result.funding.projectCount).toBe(0)
    expect(result.sources).toHaveLength(4)
    for (const record of [...result.awards, ...result.projects, ...result.works]) {
      expect(record.sourceUrl).toBeTruthy()
      expect(record.fetchedAt).toBeTruthy()
    }
  })

  it('never reports an unnamed advisor as funded from an unconstrained fetch', async () => {
    const result = await collectAdvisorSignals(
      { name: '   ', institution: 'Stanford University' },
      {
        ...noRetry,
        // Any request at all is the bug: with no name to filter on, NSF and NIH
        // both answer an unconstrained query with real records belonging to
        // strangers, and the panel would render them as this advisor's funding.
        fetchImpl: routedFetch({}),
      },
    )
    expect(result.funding.hasPublicAward).toBe(false)
    expect(result.awards).toEqual([])
    expect(result.projects).toEqual([])
    for (const source of result.sources) expect(source.status).toBe('empty')
  })

  it('keeps a same-surname stranger out of the funding count', async () => {
    const result = await collectAdvisorSignals(
      { name: 'Alan Turing', institution: 'Cambridge' },
      {
        ...noRetry,
        fetchImpl: routedFetch({
          'api.nsf.gov': () => jsonResponse(jsonFixture('nsf-awards-ok.json')),
          'api.reporter.nih.gov': () => jsonResponse({ results: [] }),
          'api.openalex.org': () => jsonResponse({ results: [] }),
        }),
      },
    )
    // "Ada Turing" at Example University shares a surname and an initial with
    // "Alan Turing" at Cambridge. That is a candidate, not this person.
    expect(result.funding.hasPublicAward).toBe(false)
    expect(result.awards).toEqual([])
    expect(result.possibleAwards).toHaveLength(1)
    expect(result.possibleAwards[0].match.nameMatch).toBe('initial')
    expect(result.funding.possibleAwardCount).toBe(1)
  })

  it('does not claim an advisor is unfunded when every source failed', async () => {
    const result = await collectAdvisorSignals(
      { name: 'Ada Turing', institution: 'Stanford University' },
      {
        ...noRetry,
        fetchImpl: routedFetch({
          'api.nsf.gov': () => jsonResponse({}, { status: 500 }),
          'api.reporter.nih.gov': () => jsonResponse({}, { status: 500 }),
          'api.openalex.org': () => jsonResponse({}, { status: 500 }),
        }),
      },
    )
    expect(result.funding.hasPublicAward).toBe(false)
    // Every source must be visibly broken, so the UI can say "could not check"
    // rather than "no funding found" -- the two mean very different things to
    // someone deciding whether to contact this professor.
    expect(result.sources.every((source) => source.status === 'error')).toBe(true)
  })
})
