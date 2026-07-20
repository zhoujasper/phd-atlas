/** Shared types for the Discover / program-finder surface (phd-application-planner deep merge). */

import type { DiscoverRequirements } from './discoverRequirements'
export type {
  DiscoverRequirements,
  DiscoverDeadline,
  DiscoverTestRequirement,
  DiscoverMaterialRequirement,
  DiscoverFeeRequirement,
  DiscoverRestrictionSet,
  DiscoverApplicationRoute,
  RequirementFilterState,
} from './discoverRequirements'
export {
  DEFAULT_REQUIREMENT_FILTERS,
  daysUntilIso,
  deadlineUrgencyClass,
  primaryDeadline,
  programMatchesRequirementFilters,
  requirementSummaryChips,
  testStatusTone,
} from './discoverRequirements'

export type DiscoverRegionKey = 'US' | 'UK' | 'EU' | 'CA' | 'SG' | 'CN' | 'AU' | 'HK' | 'OTHER'

export type PiCategory = 'rising_star' | 'direction_fit' | 'interesting' | 'famous_but_fits'

export type WetDry = 'dry' | 'wet' | 'both' | 'unknown'

export type RisingStarBias = 'strong' | 'moderate' | 'neutral'

export type DiscoverRegion = {
  key: DiscoverRegionKey | string
  label: string
  short: string
  color: string
  order: number
}

export type DiscoverPi = {
  id: string
  name: string
  category: PiCategory
  rank?: number
  hIndex: number | null
  citations: number | null
  scholarUrl: string
  startedApprox: string
  labSize: string
  wetDry: WetDry
  research: string
  whyFit: string
  recruiting: string
  url: string
  email?: string
}

export type DiscoverProgram = {
  id: string
  region: DiscoverRegionKey | string
  school: string
  program: string
  city: string
  country: string
  website: string
  stipendUSD: number | null
  stipendLocal: string
  stipendBasis: string
  stipendConfidence: 'high' | 'medium' | 'low' | 'unknown'
  stipendFoundOfficial: boolean
  stipendNotes: string
  meetsFloor?: boolean
  cohortSize: string
  degreeStructure: string
  applicationRoute: string
  deadlineAndTests: string
  /** ISO date for next typical cycle when known; used for import defaults. */
  deadlineIso: string
  applicationRestrictions: string
  researchFocus: string
  wetDryIntegration: string
  fitScore: number
  fitRationale: string
  siblingPrograms: string
  sources: string[]
  tags: string[]
  multiApply: 'multi' | 'single' | 'unknown'
  careerOutcomes: string
  admitBackgrounds: string
  intlNotes: string
  colIndex: number
  pis: DiscoverPi[]
  /** Structured deadlines, tests, materials, fees, restrictions, route. */
  requirements?: DiscoverRequirements
}

export type DiscoverIntake = {
  field: string
  subfields: string[]
  regions: string[]
  stipendFloor: number
  currency: string
  nPrograms: number
  nPisPerProgram: number
  piPreferences: string[]
  risingStarBias: RisingStarBias
  notes: string
  interestTags: string[]
  /** When true, new top matches notify in-app (+ email if receive addresses have notify on). */
  notifyMatches: boolean
  /** When true, deadline-like catalog dates for watched programs create reminders. */
  notifyDeadlines: boolean
  /** Named seed schools/programs for AI research (free text lines). */
  seedPrograms?: string[]
}

export type DiscoverRankerWeights = {
  fit: number
  stipend: number
  city: number
  advisorDensity: number
  topics: number
}

export type DiscoverCatalogSource = 'builtin' | 'custom' | 'merged'

export type DiscoverAiEnrichment = {
  fitRationale?: string
  researchFocus?: string
  strategy?: string
  tips?: string
  updatedAt?: string | null
}

export type DiscoverUserState = {
  version: 1
  intake: DiscoverIntake
  intakeCompleted: boolean
  hiddenProgramIds: string[]
  hiddenPiIds: string[]
  watchedProgramIds: string[]
  piNotes: Record<string, string>
  programNotes: Record<string, string>
  ranker: DiscoverRankerWeights
  interestPicks: string[]
  lastResearchAt: string | null
  lastMatchIds: string[]
  researchRuns: number
  catalogSource?: DiscoverCatalogSource
  customPrograms?: DiscoverProgram[]
  aiEnrichments?: Record<string, DiscoverAiEnrichment>
  lastAiResearchAt?: string | null
  preferredAiKeyId?: string | null
}

export type DiscoverCatalogMeta = {
  title: string
  subtitle: string
  currency: string
  stipendFloorDefault: number
  currentYear: number
  regions: DiscoverRegion[]
  interestAreas: Record<string, string[]>
  honestyNote: string
  updatedAt: string
}

export type DiscoverCatalog = {
  meta: DiscoverCatalogMeta
  programs: DiscoverProgram[]
}

export type DiscoverAgentStatus = 'idle' | 'running' | 'done' | 'error'

export type DiscoverAgent = {
  id: string
  name: string
  description: string
  status: DiscoverAgentStatus
  detail?: string
}

export type DiscoverResearchResult = {
  runAt: string
  matchedCount: number
  topProgramIds: string[]
  agents: DiscoverAgent[]
  summary: string
  notified: number
  aiUsed?: boolean
  aiProvider?: string | null
  aiModel?: string | null
  suggestedPrograms?: DiscoverProgram[]
}

export type DiscoverImportInput = {
  programId: string
  piId?: string | null
  includeNotes?: boolean
}

export type ScoredDiscoverProgram = DiscoverProgram & {
  meetsFloor?: boolean | null
  realStipendUSD?: number | null
  matchScore: number
  matchDimensions?: {
    fit: number
    stipend: number
    city: number
    advisorDensity: number
    topics: number
  }
  fittingPiCount?: number
  hidden?: boolean
  watched?: boolean
  note?: string
  catalogSource?: string
  aiStrategy?: string
  aiTips?: string
  aiEnrichedAt?: string | null
  pis: Array<DiscoverPi & { hidden?: boolean; note?: string }>
}

export type ScoredDiscoverPi = DiscoverPi & {
  programId: string
  school: string
  program: string
  region: string
  city: string
  matchScore: number
  hidden?: boolean
  note?: string
}

export type DiscoverStats = {
  programCount: number
  piCount: number
  avgStipendUSD: number | null
  avgRealStipendUSD: number | null
  meetFloorCount: number
  byRegion: Record<string, number>
  top: Array<{
    id: string
    school: string
    program: string
    matchScore: number
    stipendUSD: number | null
    realStipendUSD: number | null
  }>
  stipendFitCorrelation: number | null
  requirements?: {
    greOptional: number
    feeWaiver: number
    multi: number
    rolling: number
    upcoming45: number
  }
  upcomingDeadlines?: Array<{
    id: string
    school: string
    program: string
    deadline: string
    label: string
    certainty: string
    matchScore: number
  }>
  colSeries: Array<{
    id: string
    label: string
    stipendUSD: number | null
    realStipendUSD: number | null
    colIndex: number
    matchScore: number
  }>
  advanced?: {
    spearmanMatchVsRealStipend: number | null
    kruskalWallis: {
      H: number
      df: number
      groups: Array<{ region: string; n: number; meanMatch: number }>
      significant: boolean
    } | null
    pareto: {
      frontier: Array<{
        id: string
        school: string
        program: string
        region: string
        matchScore: number
        realStipendUSD: number
        stipendUSD: number | null
      }>
      dominated: Array<{ id: string; school: string; matchScore: number; realStipendUSD: number }>
    }
    clusters: {
      k: number
      clusters: Array<{
        id: number
        label: string
        size: number
        avgMatch: number
        avgRealStipendUSD: number
        members: Array<{
          id: string
          school: string
          program: string
          region: string
          matchScore: number
          realStipendUSD: number
        }>
      }>
    }
    interestHeatmap: Array<{ tag: string; weight: number }>
    strategyTips: Array<{ id: string; tone: string; title: string; body: string }>
  }
}

export type DiscoverCatalogPayload = {
  meta: DiscoverCatalogMeta
  programs: ScoredDiscoverProgram[]
  pis: ScoredDiscoverPi[]
  stats: DiscoverStats
  ranked: ScoredDiscoverProgram[]
  state: DiscoverUserState
}

export type DiscoverResearchPayload = {
  research: DiscoverResearchResult & {
    newlySurfacedIds?: string[]
    rankedPreview?: Array<{
      id: string
      school: string
      program: string
      matchScore: number
      region: string
      stipendUSD: number | null
      realStipendUSD: number | null
    }>
  }
  state: DiscoverUserState
  programs: ScoredDiscoverProgram[]
  pis: ScoredDiscoverPi[]
  stats: DiscoverStats
  ranked: ScoredDiscoverProgram[]
}

export type DiscoverEnrichmentChange = {
  id: string
  target: string
  category: 'identity' | 'advisor' | 'research' | 'funding' | 'requirements' | 'workflow'
  mode: 'fill' | 'update' | 'merge' | 'create'
  before: string
  after: string
  source: 'catalog' | 'ai' | 'catalog_ai'
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  recommended: boolean
  sources: string[]
}

export type DiscoverApplicationEnrichmentProposal = {
  applicationId: string
  generatedAt: string
  usedAi: boolean
  matchedProgram: {
    id: string
    school: string
    program: string
    matchScore: number
  } | null
  changes: DiscoverEnrichmentChange[]
  caveats: string[]
  payload: Record<string, unknown>
}

export const DEFAULT_RANKER: DiscoverRankerWeights = {
  fit: 30,
  stipend: 20,
  city: 15,
  advisorDensity: 20,
  topics: 15,
}

export const DEFAULT_INTAKE: DiscoverIntake = {
  field: '',
  subfields: [],
  regions: ['US', 'UK', 'EU', 'CA'],
  stipendFloor: 35000,
  currency: 'USD',
  nPrograms: 20,
  nPisPerProgram: 6,
  piPreferences: ['rising_star', 'direction_fit'],
  risingStarBias: 'moderate',
  notes: '',
  interestTags: [],
  notifyMatches: true,
  notifyDeadlines: true,
  seedPrograms: [],
}

export function defaultDiscoverState(): DiscoverUserState {
  return {
    version: 1,
    intake: { ...DEFAULT_INTAKE },
    intakeCompleted: false,
    hiddenProgramIds: [],
    hiddenPiIds: [],
    watchedProgramIds: [],
    piNotes: {},
    programNotes: {},
    ranker: { ...DEFAULT_RANKER },
    interestPicks: [],
    lastResearchAt: null,
    lastMatchIds: [],
    researchRuns: 0,
    catalogSource: 'merged',
    customPrograms: [],
    aiEnrichments: {},
    lastAiResearchAt: null,
    preferredAiKeyId: null,
  }
}

/** Real stipend after cost-of-living adjustment (colIndex 1.0 = national baseline). */
export function realStipend(usd: number | null, colIndex: number): number | null {
  if (usd == null || !Number.isFinite(usd)) return null
  const col = colIndex > 0 ? colIndex : 1
  return Math.round(usd / col)
}

export function rankerTotal(weights: DiscoverRankerWeights): number {
  return weights.fit + weights.stipend + weights.city + weights.advisorDensity + weights.topics
}

export function normalizeRanker(weights: Partial<DiscoverRankerWeights> | null | undefined): DiscoverRankerWeights {
  return {
    fit: clampWeight(weights?.fit, DEFAULT_RANKER.fit),
    stipend: clampWeight(weights?.stipend, DEFAULT_RANKER.stipend),
    city: clampWeight(weights?.city, DEFAULT_RANKER.city),
    advisorDensity: clampWeight(weights?.advisorDensity, DEFAULT_RANKER.advisorDensity),
    topics: clampWeight(weights?.topics, DEFAULT_RANKER.topics),
  }
}

function clampWeight(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function piCategoryLabel(category: PiCategory, lang: string = 'en'): string {
  const en: Record<PiCategory, string> = {
    rising_star: 'Rising star',
    direction_fit: 'Direction fit',
    interesting: 'Interesting',
    famous_but_fits: 'Famous fit',
  }
  const zh: Record<PiCategory, string> = {
    rising_star: '新锐',
    direction_fit: '方向契合',
    interesting: '有趣',
    famous_but_fits: '知名契合',
  }
  return (lang.startsWith('zh') ? zh : en)[category] ?? category
}

export function multiApplyLabel(value: DiscoverProgram['multiApply'], lang: string = 'en'): string {
  if (value === 'multi') return lang.startsWith('zh') ? '可多申' : 'Multi-apply'
  if (value === 'single') return lang.startsWith('zh') ? '仅一所' : 'Single only'
  return lang.startsWith('zh') ? '未知' : 'Unknown'
}
