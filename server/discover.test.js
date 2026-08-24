import { describe, expect, it } from 'vitest'
import {
  buildImportPayload,
  collectDiscoverImportWarnings,
  computeDiscoverStats,
  defaultDiscoverState,
  discoverMatchNotificationCandidates,
  findProgramById,
  getActivePrograms,
  getDiscoverCatalog,
  listAllPis,
  listAllScoredPrograms,
  mergeDiscoverSourceIndexes,
  normalizeDiscoverSourceIndex,
  normalizeDiscoverState,
  parseAiResearchResponse,
  parseCatalogUpload,
  rankPrograms,
  runDiscoverResearch,
  scoreProgram,
  selectDiscoverImportAdvisor,
} from './discover-catalog.js'
import { attachRequirements, normalizeRequirements } from './discover-requirements.js'
import { CreateApplicationSchema } from './validation.js'

function fixtureState() {
  const state = defaultDiscoverState()
  state.catalogSource = 'builtin'
  state.officialResearchOnly = false
  return state
}

describe('discover-catalog', () => {
  it('exposes a non-empty curated catalog with regions and PIs', () => {
    const catalog = getDiscoverCatalog()
    expect(catalog.programs.length).toBeGreaterThan(10)
    expect(catalog.meta.regions.length).toBeGreaterThan(4)
    expect(catalog.programs.every((p) => p.id && p.school && Array.isArray(p.pis))).toBe(true)
  })

  it('normalizes partial user state safely', () => {
    const state = normalizeDiscoverState({
      intake: { field: 'NLP', stipendFloor: 40000, regions: ['US', 'UK'] },
      hiddenProgramIds: ['prog_mit_eecs'],
      ranker: { fit: 50 },
    })
    expect(state.intake.field).toBe('NLP')
    expect(state.intake.stipendFloor).toBe(40000)
    expect(state.ranker.fit).toBe(50)
    expect(state.ranker.stipend).toBe(20)
    expect(state.hiddenProgramIds).toEqual(['prog_mit_eecs'])
  })

  it('keeps deleted program tombstones and filters matching persisted results', () => {
    const state = normalizeDiscoverState({
      deletedProgramIds: ['deleted_program'],
      customPrograms: [
        {
          id: 'deleted_program',
          school: 'Deleted University',
          program: 'Computer Science PhD',
          provenance: 'manual',
        },
        {
          id: 'retained_program',
          school: 'Retained University',
          program: 'Computer Science PhD',
          provenance: 'manual',
        },
      ],
    })

    expect(state.deletedProgramIds).toEqual(['deleted_program'])
    expect(state.customPrograms.map((program) => program.id)).toEqual(['retained_program'])
  })

  it('orders newly collected verified results ahead of older and manual rows', () => {
    const verified = { status: 'partial', officialSourceCount: 1, advisorSourceCount: 0 }
    const state = normalizeDiscoverState({
      researchRuns: 2,
      customPrograms: [
        {
          id: 'older_ai',
          school: 'Older University',
          program: 'Computer Science PhD',
          provenance: 'ai',
          collectedAt: '2026-07-22T12:00:00.000Z',
          sources: ['https://older.edu/phd'],
          verification: verified,
        },
        {
          id: 'newer_ai',
          school: 'Newer University',
          program: 'Computer Science PhD',
          provenance: 'ai',
          collectedAt: '2026-07-23T12:00:00.000Z',
          sources: ['https://newer.edu/phd'],
          verification: verified,
        },
        {
          id: 'manual_row',
          school: 'Manual University',
          program: 'User note',
          provenance: 'manual',
        },
      ],
    })

    expect(state.customPrograms.map((program) => program.id)).toEqual(['newer_ai', 'older_ai', 'manual_row'])
  })

  it('scores and ranks programs with hidden filtering', () => {
    const state = fixtureState()
    state.intake.field = 'Machine Learning'
    state.intake.interestTags = ['Machine Learning', 'NLP']
    state.intake.regions = ['US']
    state.hiddenProgramIds = ['prog_oxford_cs']
    const ranked = rankPrograms(state)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.every((p) => p.region === 'US' || p.matchScore >= 0)).toBe(true)
    expect(ranked.some((p) => p.id === 'prog_oxford_cs')).toBe(false)
    expect(ranked[0].matchScore).toBeGreaterThanOrEqual(ranked[ranked.length - 1].matchScore)
  })

  it('does not truncate ranked programs or advisors using legacy intake counts', () => {
    const state = normalizeDiscoverState({
      intake: { ...fixtureState().intake, nPrograms: 5, nPisPerProgram: 1 },
      catalogSource: 'custom',
      customPrograms: Array.from({ length: 7 }, (_, programIndex) => ({
        id: `all-programs-${programIndex}`,
        school: `Evidence University ${programIndex}`,
        program: 'Computational Science PhD',
        region: 'US',
        website: `https://evidence-${programIndex}.edu/phd`,
        sources: [`https://evidence-${programIndex}.edu/phd`],
        provenance: 'ai',
        verification: { status: 'verified', officialSourceCount: 1, advisorSourceCount: 3 },
        pis: Array.from({ length: 3 }, (_, advisorIndex) => ({
          name: `Researcher ${programIndex}-${advisorIndex}`,
          url: `https://evidence-${programIndex}.edu/people/${advisorIndex}`,
        })),
      })),
    })

    const ranked = rankPrograms(state)
    expect(ranked).toHaveLength(7)
    expect(ranked.every((program) => program.pis.length === 3)).toBe(true)
  })

  it('ranks advisor rows with their verified profile overlap rather than the program score', () => {
    const state = normalizeDiscoverState({
      catalogSource: 'custom',
      customPrograms: [{
        id: 'profile-ranked',
        school: 'Evidence University',
        program: 'Computational Neuroscience PhD',
        region: 'US',
        website: 'https://evidence.edu/phd',
        sources: ['https://evidence.edu/phd'],
        provenance: 'ai',
        verification: { status: 'verified', officialSourceCount: 1, advisorSourceCount: 1 },
        pis: [{
          name: 'Profile Matched Researcher',
          url: 'https://evidence.edu/people/researcher',
          profileMatch: {
            score: 87,
            confidence: 'high',
            matchedInterests: ['neural dynamics'],
            matchedMethods: ['graph learning'],
            matchedResearchTerms: [],
            evidenceUrl: 'https://evidence.edu/people/researcher',
            checkedAt: '2026-08-09T00:00:00.000Z',
            basis: 'applicant-profile+official-individual-profile',
          },
        }],
      }],
    })

    expect(listAllPis(state)[0].matchScore).toBe(87)
  })

  it('shows only source-gated AI rows after an official-only research run', () => {
    const state = normalizeDiscoverState({
      catalogSource: 'custom',
      officialResearchOnly: true,
      customPrograms: [
        {
          id: 'official_row', school: 'Example University', program: 'Computer Science PhD', region: 'US',
          website: 'https://example.edu/cs/phd', sources: ['https://example.edu/cs/phd'],
          provenance: 'ai', verification: { status: 'partial', officialSourceCount: 1, advisorSourceCount: 0 },
        },
        {
          id: 'old_placeholder', school: 'Example University', program: 'PhD opportunity in Anything', region: 'US',
          provenance: 'manual', verification: { status: 'unverified', officialSourceCount: 0, advisorSourceCount: 0 },
        },
      ],
    })

    expect(getActivePrograms(state).map((program) => program.id)).toEqual(['official_row'])
    expect(state.customPrograms.map((program) => program.id)).toContain('old_placeholder')
  })

  it('does not expose built-in Example fixtures in the default user decision set', () => {
    const programs = getActivePrograms(defaultDiscoverState())
    expect(programs).toEqual([])
    expect(programs.some((program) => program.pis?.some((pi) => /example/i.test(pi.name)))).toBe(false)
  })

  it('removes copied built-in fixtures without deleting an explicit manual row', () => {
    const builtInFixture = getDiscoverCatalog().programs[0]
    const state = normalizeDiscoverState({
      researchRuns: 1,
      customPrograms: [
        builtInFixture,
        {
          id: 'renamed_legacy_fixture',
          school: 'Legacy Sample University',
          program: 'Computer Science PhD',
          provenance: 'official_catalog',
        },
        {
          id: 'user_manual_quantum',
          school: 'User Selected University',
          program: 'Quantum Computing PhD',
          provenance: 'manual',
        },
      ],
    })

    expect(state.customPrograms.map((program) => program.id)).toEqual(['user_manual_quantum'])
    expect(state.customPrograms[0].provenance).toBe('manual')
    expect(getActivePrograms(state)).toEqual([])
  })

  it('drops generic legacy AI rows and canonical duplicate AI programs from the decision set', () => {
    const verification = { status: 'partial', officialSourceCount: 1, advisorSourceCount: 0 }
    const state = normalizeDiscoverState({
      researchRuns: 1,
      customPrograms: [
        {
          id: 'cambridge-cst-phd',
          school: 'University of Cambridge',
          program: 'Ph.D. in Computer Science',
          provenance: 'ai',
          website: 'https://www.cst.cam.ac.uk/admissions/phd/?utm_source=legacy',
          sources: ['https://www.cst.cam.ac.uk/admissions/phd/?utm_source=legacy'],
          verification,
        },
        {
          id: 'cambridge-ai-current',
          school: 'Cambridge University',
          program: 'Computer Science PhD',
          provenance: 'ai',
          website: 'https://cst.cam.ac.uk/admissions/phd',
          sources: ['https://cst.cam.ac.uk/admissions/phd'],
          pis: [{ id: 'cambridge-advisor', name: 'Dr Ada Researcher', url: 'https://cst.cam.ac.uk/people/ada' }],
          verification: { ...verification, status: 'verified', advisorSourceCount: 1 },
        },
        {
          id: 'southampton-postgraduate-research',
          school: 'University of Southampton',
          program: 'Find Your PhD',
          provenance: 'ai',
          website: 'https://southampton.ac.uk/study/postgraduate-research',
          sources: ['https://southampton.ac.uk/study/postgraduate-research'],
          verification,
        },
      ],
    })

    expect(state.customPrograms.map((program) => program.id)).toEqual(['cambridge-ai-current'])
    expect(getActivePrograms(state).map((program) => program.id)).toEqual(['cambridge-ai-current'])
  })

  it('preserves persisted source-page contamination and declaration evidence', () => {
    const index = normalizeDiscoverSourceIndex({
      schemaVersion: 2,
      schools: [{
        school: 'Example University',
        officialUrl: 'https://example.edu/',
        pages: [{
          url: 'https://example.edu/people/example',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: true,
          declaredKinds: ['faculty', 'research'],
          promptInjectionSuspected: true,
        }],
      }],
    })

    expect(index.schools[0].pages[0]).toMatchObject({
      individualAdvisor: true,
      declaredKinds: ['faculty', 'research'],
      promptInjectionSuspected: true,
    })
    expect(index.schools[0].advisorPages[0].promptInjectionSuspected).toBe(true)
  })

  it('merges bounded source runs without dropping older fetched evidence', () => {
    const previous = {
      generatedAt: '2026-07-22T00:00:00.000Z',
      schools: [
        {
          school: 'Example University',
          officialUrl: 'https://example.edu/',
          pages: [
            { url: 'https://example.edu/phd', fetched: true, title: 'Older observation', types: ['program'] },
            { url: 'https://example.edu/funding', fetched: true, title: 'Funding', types: ['funding'] },
          ],
        },
        {
          school: 'Prior University',
          officialUrl: 'https://prior.edu/',
          pages: [{ url: 'https://prior.edu/phd', fetched: true, title: 'Prior PhD', types: ['program'] }],
        },
      ],
    }
    const current = {
      generatedAt: '2026-07-23T00:00:00.000Z',
      schools: [{
        school: 'Example University',
        officialUrl: 'https://example.edu/',
        pages: [{ url: 'https://example.edu/phd', fetched: true, title: 'Fresh observation', types: ['program'] }],
      }],
    }

    const merged = mergeDiscoverSourceIndexes(previous, current)
    expect(merged.schools.map((school) => school.school)).toEqual(['Example University', 'Prior University'])
    expect(merged.schools[0].pages.map((page) => page.url)).toEqual([
      'https://example.edu/phd',
      'https://example.edu/funding',
    ])
    expect(merged.schools[0].pages[0].title).toBe('Fresh observation')
  })

  it('computes stats and COL series', () => {
    const stats = computeDiscoverStats(fixtureState())
    expect(stats.programCount).toBeGreaterThan(0)
    expect(stats.colSeries.length).toBeGreaterThan(0)
  })

  it('builds import payload from program + PI', () => {
    const program = findProgramById('prog_cmu_ml')
    const pi = program.pis[0]
    const payload = buildImportPayload(program, pi, { programNote: 'Strong COL', piNote: 'Met at conference' })
    expect(payload.university).toBe('Carnegie Mellon University')
    expect(payload.professor).toBe(pi.name)
    expect(payload.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload.notes).toContain('Imported from Discover')
  })

  it('keeps an unknown deadline empty so partial imports do not invent a date', () => {
    const sourceProgram = findProgramById('prog_cmu_ml')
    const program = {
      ...sourceProgram,
      deadlineIso: '',
      deadlineAndTests: '',
      requirements: {
        ...sourceProgram.requirements,
        deadlines: [],
      },
    }
    const pi = {
      ...program.pis[0],
      email: 'advisor@cmu.edu',
      url: 'https://www.cmu.edu/faculty/advisor',
    }
    const payload = buildImportPayload(program, pi)

    expect(payload.deadline).toBe('')
    expect(CreateApplicationSchema.safeParse({
      professor: payload.professor,
      professorChinese: payload.professorChinese,
      professorEmail: payload.professorEmail,
      professorHomepage: payload.professorHomepage,
      university: payload.university,
      country: payload.country,
      website: payload.website,
      program: payload.program,
      deadline: payload.deadline,
      notes: payload.notes,
    }).success).toBe(true)
  })

  it('imports without inventing an advisor email when the profile is incomplete', () => {
    const sourceProgram = findProgramById('prog_cmu_ml')
    const program = {
      ...sourceProgram,
      pis: [{
        ...sourceProgram.pis[0],
        email: '',
        url: '',
      }],
    }
    const pi = selectDiscoverImportAdvisor(program)
    const payload = buildImportPayload(program, pi)

    expect(payload.professor).toBe(sourceProgram.pis[0].name)
    expect(payload.professorEmail).toBe('')
    expect(collectDiscoverImportWarnings(program, pi, payload)).toContain('missingAdvisor')
    expect(CreateApplicationSchema.safeParse({
      professor: payload.professor,
      professorChinese: payload.professorChinese,
      professorEmail: payload.professorEmail,
      professorHomepage: payload.professorHomepage,
      university: payload.university,
      country: payload.country,
      website: payload.website,
      program: payload.program,
      deadline: payload.deadline,
      notes: payload.notes,
    }).success).toBe(true)
  })

  it('strips placeholder example emails instead of treating them as verified contact', () => {
    const program = findProgramById('prog_mit_eecs')
    const pi = program.pis[0]
    const payload = buildImportPayload(program, pi)

    expect(pi.email).toMatch(/example\./i)
    expect(payload.professor).toBe(pi.name)
    expect(payload.professorEmail).toBe('')
    expect(collectDiscoverImportWarnings(program, pi, payload)).toEqual(
      expect.arrayContaining(['missingAdvisor']),
    )
  })

  it('runs research and emits match notification candidates for new tops', () => {
    const state = fixtureState()
    state.intake.field = 'Robotics'
    state.intake.interestTags = ['Robotics']
    state.intake.notifyMatches = true
    state.lastMatchIds = []
    const research = runDiscoverResearch(state)
    expect(research.topProgramIds.length).toBeGreaterThan(0)
    expect(research.agents.every((a) => a.status === 'done')).toBe(true)
    const nextState = { ...state, lastMatchIds: [] }
    const candidates = discoverMatchNotificationCandidates(nextState, research, '2026-07-17')
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0].type).toBe('discover_match')
    expect(candidates[0].targetPath).toBe('/discover')
  })

  it('lists scored programs with watch/hide flags', () => {
    const state = fixtureState()
    state.watchedProgramIds = ['prog_eth_cs']
    state.hiddenProgramIds = ['prog_anu_cs']
    const list = listAllScoredPrograms(state)
    const eth = list.find((p) => p.id === 'prog_eth_cs')
    const anu = list.find((p) => p.id === 'prog_anu_cs')
    expect(eth?.watched).toBe(true)
    expect(anu?.hidden).toBe(true)
    expect(scoreProgram(eth, state).matchScore).toBeTypeOf('number')
  })

  it('parses custom catalog uploads and merges with built-in programs', () => {
    const uploaded = parseCatalogUpload({
      programs: [
        {
          school: 'Example Tech',
          program: 'PhD in AI',
          region: 'US',
          city: 'Boston',
          country: 'United States',
          researchFocus: 'foundation models',
          fitScore: 7.5,
          tags: ['Machine Learning'],
          pis: [{ name: 'Dr. Example', category: 'rising_star', research: 'LLMs' }],
        },
      ],
    })
    expect(uploaded).toHaveLength(1)
    expect(uploaded[0].school).toBe('Example Tech')

    const state = fixtureState()
    state.customPrograms = uploaded
    state.catalogSource = 'merged'
    const active = getActivePrograms(state)
    expect(active.some((p) => p.school === 'Example Tech')).toBe(true)
    expect(active.length).toBeGreaterThan(uploaded.length)
  })

  it('attaches structured deadlines, tests, materials, fees, and restrictions to programs', () => {
    const catalog = getDiscoverCatalog()
    const mit = catalog.programs.find((p) => p.id === 'prog_mit_eecs')
    expect(mit?.requirements?.deadlines?.length).toBeGreaterThan(0)
    expect(mit?.requirements?.tests?.some((t) => t.id === 'gre')).toBe(true)
    expect(mit?.requirements?.materials?.some((m) => m.id === 'letters')).toBe(true)
    expect(mit?.requirements?.fees).toBeTruthy()
    expect(mit?.requirements?.restrictions?.multiApply).toBe('single')
    expect(mit?.requirements?.route?.steps?.length).toBeGreaterThan(0)

    const eth = attachRequirements(findProgramById('prog_eth_cs'))
    expect(eth.requirements.restrictions.supervisorContact).toBe('required')
    expect(eth.requirements.deadlines.some((d) => d.certainty === 'rolling')).toBe(true)

    const stats = computeDiscoverStats(fixtureState())
    expect(stats.requirements.greOptional).toBeGreaterThan(0)
    expect(stats.upcomingDeadlines.length).toBeGreaterThan(0)

    const payload = buildImportPayload(mit, mit.pis[0])
    expect(payload.notes).toContain('Materials:')
    expect(payload.notes).toContain('Tests:')
    expect(payload.requirementsSnapshot?.materials?.length).toBeGreaterThan(0)

    const normalized = normalizeRequirements(undefined, {
      id: 'custom',
      multiApply: 'multi',
      deadlineIso: '2026-12-01',
      applicationRestrictions: 'Test only',
    })
    expect(normalized.restrictions.multiApply).toBe('multi')
    expect(normalized.deadlines[0].date).toBe('2026-12-01')
  })

  it('parses AI research JSON enrichments without inventing unknown program ids', () => {
    const state = fixtureState()
    const ranked = rankPrograms(state).slice(0, 3)
    const parsed = parseAiResearchResponse(
      JSON.stringify({
        summary: 'Focus on COL-adjusted US programs.',
        enrichments: [
          { id: ranked[0].id, fitRationale: 'Strong topic match', tips: 'Email PI early' },
          { id: 'not_a_real_id', fitRationale: 'ignore me' },
        ],
        suggestedPrograms: [
          {
            school: 'AI Suggested U',
            program: 'PhD CS',
            region: 'EU',
            researchFocus: 'privacy ML',
            fitScore: 7,
            fitRationale: 'Fits privacy interests',
          },
        ],
      }),
      ranked,
    )
    expect(parsed.summary).toContain('COL')
    expect(parsed.enrichments[ranked[0].id]?.fitRationale).toBe('Strong topic match')
    expect(parsed.enrichments.not_a_real_id).toBeUndefined()
    expect(parsed.suggestedPrograms[0].school).toBe('AI Suggested U')
    expect(parsed.suggestedPrograms[0].stipendConfidence).toBe('unknown')
  })

  it('uses the final Discover object when a reasoning gateway emits another JSON object first', () => {
    const parsed = parseAiResearchResponse([
      'I will follow this schema:',
      '{"type":"object","properties":{"summary":{"type":"string"}}}',
      'Final answer:',
      '{"summary":"Grounded result","enrichments":[],"suggestedPrograms":[{"school":"Evidence University","program":"Neuroscience PhD","website":"https://evidence.edu/phd"}]}',
    ].join('\n'), [])

    expect(parsed.summary).toBe('Grounded result')
    expect(parsed.suggestedPrograms).toHaveLength(1)
    expect(parsed.suggestedPrograms[0].school).toBe('Evidence University')
  })
})
