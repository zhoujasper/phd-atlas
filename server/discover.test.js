import { describe, expect, it } from 'vitest'
import {
  buildImportPayload,
  computeDiscoverStats,
  defaultDiscoverState,
  discoverMatchNotificationCandidates,
  findProgramById,
  getActivePrograms,
  getDiscoverCatalog,
  listAllScoredPrograms,
  normalizeDiscoverState,
  parseAiResearchResponse,
  parseCatalogUpload,
  rankPrograms,
  runDiscoverResearch,
  scoreProgram,
} from './discover-catalog.js'
import { attachRequirements, normalizeRequirements } from './discover-requirements.js'

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

  it('scores and ranks programs with hidden filtering', () => {
    const state = defaultDiscoverState()
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

  it('computes stats and COL series', () => {
    const stats = computeDiscoverStats(defaultDiscoverState())
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

  it('runs research and emits match notification candidates for new tops', () => {
    const state = defaultDiscoverState()
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
    const state = defaultDiscoverState()
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

    const state = defaultDiscoverState()
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

    const stats = computeDiscoverStats(defaultDiscoverState())
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
    const state = defaultDiscoverState()
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
})
