import { AiProviderError, completeChat, supportsNativeOpenAiWebSearch } from './aiProviders.js'
import {
  normalizeDiscoverState,
  parseAiResearchResponse,
  rankPrograms,
  runDiscoverResearch,
} from './discover-catalog.js'
import { buildDiscoverSourceIndex, compactDiscoverCrawlEvidence, crawlDiscoverSources } from './discover-source-crawler.js'
import { hydrateDiscoverOfficialEvidence } from './discover-evidence-hydration.js'
import { selectDiscoverCandidateHydrationPrograms } from './discover-candidate-hydration.js'
import { discoverGlobalInstitutionSources } from './discover-global-sources.js'
import { deriveOfficialProgramLeads } from './discover-program-leads.js'
import { deriveOfficialAdvisorProfileLeads } from './discover-advisor-leads.js'
import { expandDiscoverResearchTerms } from './discover-query-terms.js'
import { findSchoolSourceEntry, groundDiscoverPrograms } from './discover-source-grounding.js'
import { attachScholarlyEvidence, collectScholarlyEvidence } from './discover-scholarly-data.js'
import { assessDiscoverResearchQuality } from './discover-quality.js'
import {
  DISCOVER_SCHOOL_ADAPTER_COVERAGE,
  DISCOVER_SOURCE_REGISTRY,
  listDiscoverResearchSources,
  prioritizeDiscoverResearchSources,
} from './discover-source-registry.js'
import {
  listDiscoverOpportunitySources,
  summarizeOpportunitySourceHealth,
} from './discover-opportunity-sources.js'
import {
  crawlDiscoverOpportunitySources,
  opportunityPolicyFingerprint,
} from './discover-opportunity-crawler.js'
import {
  advisorDiscoverySystemPrompt,
  buildAdvisorDiscoveryPayload,
  buildIndependentVerificationPayload,
  buildProgramDiscoveryPayload,
  independentVerificationSystemPrompt,
  programDiscoverySystemPrompt,
} from './discover-agent-plan.js'
import {
  createNonFatalCheckpointWriter,
  runDiscoverAgentWithRetry,
} from './discover-agent-resilience.js'
import { dedupeDiscoverProgrammeRecords } from './discover-program-identity.js'

export { isRetryableDiscoverAgentError } from './discover-agent-resilience.js'

const SOURCE_DOMAINS = webSearchDomainsForSources(DISCOVER_SOURCE_REGISTRY)
const DECISION_EVIDENCE_DOMAINS = [
  'topuniversities.com',
  'timeshighereducation.com',
  'euraxess.ec.europa.eu',
  'ukri.org',
  'daad.de',
  'nsf.gov',
  'canada.ca',
  'csc.edu.cn',
  'a-star.edu.sg',
  'education.gov.au',
]
export const DISCOVER_AGENT_BATCH_SIZES = Object.freeze({
  advisor: 1,
  verification: 5,
})

export function discoverAdvisorAgentMaxTokens(targetAdvisors) {
  const requested = Math.max(1, Number(targetAdvisors) || 1)
  return Math.min(8_000, Math.max(3_500, Math.ceil(requested) * 550))
}

function uniqueUrls(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter((value) => /^https:\/\//i.test(value)))].slice(0, 20)
}

function normalizedDomain(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^www\./, '')
  if (!raw) return ''
  try {
    const host = raw.includes('://') ? new URL(raw).hostname : new URL(`https://${raw}`).hostname
    if (!host || host === 'localhost' || host.includes('..')) return ''
    return host.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function registrableResearchDomain(value) {
  const host = normalizedDomain(value)
  const labels = host.split('.').filter(Boolean)
  if (labels.length < 3) return host
  const penultimate = labels.at(-2)
  const tld = labels.at(-1)
  const countryEducationSuffix = tld.length === 2
    && ['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'].includes(penultimate)
  return labels.slice(countryEducationSuffix ? -3 : -2).join('.')
}

/**
 * Build a bounded native-search allow-list from curated school adapters.
 * Adapter hosts are collapsed to the school's public root so a search started
 * at www.mit.edu can reach eecs.mit.edu without opening unrelated domains.
 */
export function webSearchDomainsForSources(sources) {
  const domains = []
  const seen = new Set()
  const add = (value) => {
    const domain = registrableResearchDomain(value)
    if (!domain || seen.has(domain)) return
    seen.add(domain)
    domains.push(domain)
  }
  for (const source of sources || []) {
    if (typeof source === 'string') add(source)
    else {
      add(source?.url || source?.officialUrl)
      for (const host of source?.allowedHosts || []) add(host)
    }
    if (domains.length >= 100) break
  }
  return domains.slice(0, 100)
}

function canonicalEvidenceUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || !url.hostname) return ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(?:fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return url.href.replace(/\/$/, '')
  } catch {
    return ''
  }
}

/**
 * Extract only typed URL fields. Excerpts are deliberately never scanned for
 * links, so a prompt-injected page cannot enlarge the code-level trust set.
 */
export function collectPhaseEvidenceUrls({ crawlerEvidence = [], candidates = [], completionSources = [] } = {}) {
  const urls = new Set()
  const add = (value) => {
    const url = canonicalEvidenceUrl(value)
    if (url) urls.add(url)
  }
  for (const entry of crawlerEvidence || []) {
    add(entry?.officialUrl)
    for (const key of ['pages', 'advisorPages', 'programPages', 'admissionsPages', 'fundingPages', 'researchPages']) {
      // Candidate links remain useful search leads, but they are not evidence
      // until our crawler fetched them or the Responses API actually cited
      // them in completionSources below.
      for (const page of entry?.[key] || []) {
        if (page?.fetched === true && page?.promptInjectionSuspected !== true) add(page?.url)
      }
    }
  }
  for (const candidate of candidates || []) {
    // A later agent may retain the already-grounded program identity, but it
    // must not make its own PI, fact, scholarship, or ranking URLs trusted by
    // merely echoing them. Those decision fields need a freshly fetched page
    // or a native Responses citation in this phase.
    add(candidate?.website)
    for (const value of candidate?.sources || []) add(value)
  }
  for (const value of completionSources || []) add(value)
  return [...urls]
}

/**
 * Persistence is stricter than an individual agent phase: only pages fetched
 * by our server crawler in this run may support the final saved decision set.
 * Native-search citations and candidate links stay useful leads, but cannot
 * outlive the run as verified facts unless the crawler also observed them.
 */
export function collectFinalFetchedEvidenceUrls(sourceIndex) {
  const urls = new Set()
  for (const school of sourceIndex?.schools || []) {
    for (const key of ['pages', 'advisorPages', 'programPages', 'admissionsPages', 'fundingPages', 'researchPages']) {
      for (const page of school?.[key] || []) {
        if (page?.fetched !== true || page?.promptInjectionSuspected === true) continue
        const url = canonicalEvidenceUrl(page?.url)
        if (url) urls.add(url)
      }
    }
  }
  return [...urls]
}

export function createAiKeyRoundRobin(keys) {
  const queue = (keys || []).filter(Boolean)
  let cursor = 0
  return () => queue.length ? queue[cursor++ % queue.length] : null
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function mergeCustomPrograms(current, additions, { authoritative = false } = {}) {
  const merged = new Map((current || []).map((program) => [program.id, program]))
  for (const program of additions || []) {
    const previous = merged.get(program.id)
    if (!previous) {
      merged.set(program.id, program)
      continue
    }
    if (authoritative) {
      merged.set(program.id, {
        ...previous,
        ...program,
        sources: uniqueUrls([...(previous.sources || []), ...(program.sources || [])]),
      })
      continue
    }
    const next = { ...previous, ...program }
    // Later agents own only the fields they actually verified. Normalization
    // supplies empty/default values for omitted properties; those values must
    // not erase a funding, deadline, ranking or scholarship fact established
    // by an earlier source-backed phase.
    for (const key of [
      'city', 'country', 'website', 'cohortSize', 'researchFocus',
      'fitRationale', 'siblingPrograms',
    ]) {
      if ((!program[key] || program[key] === '—' || program[key] === 'Unknown') && previous[key]) next[key] = previous[key]
    }
    const factFields = {
      deadline: ['deadlineIso', 'deadlineAndTests'],
      funding: ['stipendUSD', 'stipendLocal', 'stipendBasis', 'stipendConfidence', 'stipendFoundOfficial', 'stipendNotes'],
      tuition: ['tuitionLocal', 'tuitionNotes'],
      restrictions: ['applicationRestrictions', 'multiApply'],
      international: ['intlNotes'],
      outcomes: ['careerOutcomes'],
      admissionsBackgrounds: ['admitBackgrounds'],
      degreeStructure: ['degreeStructure'],
      applicationRoute: ['applicationRoute'],
    }
    const factSources = { ...(previous.factSources || {}), ...(program.factSources || {}) }
    for (const [fact, fields] of Object.entries(factFields)) {
      if (program.factSources?.[fact]) continue
      if (previous.factSources?.[fact]) {
        for (const field of fields) next[field] = previous[field]
        factSources[fact] = previous.factSources[fact]
      } else {
        factSources[fact] = ''
      }
    }
    const previousRankingSources = uniqueUrls(previous.rankingSources || [])
    const nextRankingSources = uniqueUrls(program.rankingSources || [])
    for (const prefix of ['qs', 'the']) {
      const host = prefix === 'qs' ? 'topuniversities.com' : 'timeshighereducation.com'
      const hasNext = nextRankingSources.some((value) => new URL(value).hostname.replace(/^www\./, '').endsWith(host))
      const hadPrevious = previousRankingSources.some((value) => new URL(value).hostname.replace(/^www\./, '').endsWith(host))
      if (!hasNext && hadPrevious) {
        for (const field of prefix === 'qs'
          ? ['rankingYear', 'qsWorldRank', 'qsSubjectRank', 'qsSubjectName']
          : ['rankingYear', 'theWorldRank', 'theSubjectRank', 'theSubjectName']) next[field] = previous[field]
      }
    }
    merged.set(program.id, {
      ...next,
      factSources,
      sources: uniqueUrls([...(previous.sources || []), ...(program.sources || [])]),
      rankingSources: uniqueUrls([...(previous.rankingSources || []), ...(program.rankingSources || [])]),
      scholarships: program.scholarships?.length ? program.scholarships : previous.scholarships,
      pis: program.pis?.length ? program.pis : previous.pis,
    })
  }
  return dedupeDiscoverPrograms([...merged.values()]).slice(0, 160)
}

export function dedupeDiscoverPrograms(programs = []) {
  return dedupeDiscoverProgrammeRecords(programs)
}

/**
 * The 145-school adapter library is persistent coverage, not a requirement to
 * hit 100 sites on every click. Scale a run with the requested result set while
 * retaining a broad minimum sample and a strict upper bound.
 */
export function discoverResearchCrawlLimit(scopedSourceCount, requestedPrograms) {
  const available = Math.max(0, Number(scopedSourceCount) || 0)
  const requested = Math.max(1, Number(requestedPrograms) || 1)
  return Math.min(available, Math.min(72, Math.max(24, Math.ceil(requested) * 3)))
}

function adapterCoverageSummary() {
  const coverage = DISCOVER_SCHOOL_ADAPTER_COVERAGE
  return {
    passed: Boolean(coverage.passed),
    requiredSchoolCount: coverage.requiredSchoolCount,
    registrySchoolCount: coverage.registrySchoolCount,
    coveredSchoolCount: coverage.coveredSchoolCount,
    fullyTypedSchoolCount: coverage.fullyTypedSchoolCount,
    seedCount: coverage.seedCount,
  }
}

export const PROGRAM_AGENT_OUTPUT_SCHEMA = {
  name: 'discover_program_research',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      suggestedPrograms: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: ['string', 'null'] },
            school: { type: 'string' },
            program: { type: 'string' },
            region: { type: 'string' },
            city: { type: 'string' },
            country: { type: 'string' },
            website: { type: 'string' },
            researchFocus: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' } },
            fitScore: { type: 'number' },
            fitRationale: { type: 'string' },
            pis: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  research: { type: 'string' },
                  whyFit: { type: 'string' },
                  url: { type: 'string' },
                  scholarUrl: { type: 'string' },
                  recruiting: { type: 'string' },
                  email: { type: 'string' },
                },
                required: ['name', 'research', 'whyFit', 'url', 'scholarUrl', 'recruiting', 'email'],
              },
            },
          },
          required: ['id', 'school', 'program', 'region', 'city', 'country', 'website', 'researchFocus', 'sources', 'fitScore', 'fitRationale', 'pis'],
        },
      },
    },
    required: ['summary', 'suggestedPrograms'],
  },
}

// The verifier owns the decision-critical application fields. Keeping this
// separate from discovery avoids spending discovery output tokens inventing
// details, while making a later verifier unable to return prose that the data
// pipeline silently ignores.
export const VERIFICATION_AGENT_OUTPUT_SCHEMA = {
  name: 'discover_program_verification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      suggestedPrograms: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: ['string', 'null'] },
            school: { type: 'string' },
            program: { type: 'string' },
            region: { type: 'string' },
            city: { type: 'string' },
            country: { type: 'string' },
            website: { type: 'string' },
            researchFocus: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' } },
            fitScore: { type: 'number' },
            fitRationale: { type: 'string' },
            pis: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  research: { type: 'string' },
                  whyFit: { type: 'string' },
                  url: { type: 'string' },
                  scholarUrl: { type: 'string' },
                  recruiting: { type: 'string' },
                  email: { type: 'string' },
                },
                required: ['name', 'research', 'whyFit', 'url', 'scholarUrl', 'recruiting', 'email'],
              },
            },
            stipendUSD: { type: ['number', 'null'] },
            stipendLocal: { type: 'string' },
            stipendBasis: { type: 'string' },
            stipendConfidence: { type: 'string' },
            stipendFoundOfficial: { type: 'boolean' },
            stipendNotes: { type: 'string' },
            deadlineIso: { type: 'string' },
            applicationRestrictions: { type: 'string' },
            multiApply: { type: 'string' },
            careerOutcomes: { type: 'string' },
            admitBackgrounds: { type: 'string' },
            intlNotes: { type: 'string' },
            collectedAt: { type: 'string' },
            tuitionLocal: { type: 'string' },
            tuitionNotes: { type: 'string' },
            rankingYear: { type: ['number', 'null'] },
            qsWorldRank: { type: ['number', 'null'] },
            qsSubjectRank: { type: ['number', 'null'] },
            qsSubjectName: { type: 'string' },
            theWorldRank: { type: ['number', 'null'] },
            theSubjectRank: { type: ['number', 'null'] },
            theSubjectName: { type: 'string' },
            rankingSources: { type: 'array', items: { type: 'string' } },
            scholarships: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  provider: { type: 'string' },
                  amount: { type: 'string' },
                  eligibility: { type: 'string' },
                  deadline: { type: 'string' },
                  url: { type: 'string' },
                  profileFit: { type: 'string' },
                  verifiedAt: { type: ['string', 'null'] },
                },
                required: ['name', 'provider', 'amount', 'eligibility', 'deadline', 'url', 'profileFit', 'verifiedAt'],
              },
            },
            factSources: {
              type: 'object',
              additionalProperties: false,
              properties: {
                deadline: { type: 'string' },
                funding: { type: 'string' },
                tuition: { type: 'string' },
                restrictions: { type: 'string' },
                international: { type: 'string' },
                outcomes: { type: 'string' },
                admissionsBackgrounds: { type: 'string' },
                degreeStructure: { type: 'string' },
                applicationRoute: { type: 'string' },
              },
              required: [
                'deadline', 'funding', 'tuition', 'restrictions', 'international',
                'outcomes', 'admissionsBackgrounds', 'degreeStructure', 'applicationRoute',
              ],
            },
          },
          required: [
            'id', 'school', 'program', 'region', 'city', 'country', 'website', 'researchFocus', 'sources',
            'fitScore', 'fitRationale', 'pis', 'stipendUSD', 'stipendLocal', 'stipendBasis', 'stipendConfidence',
            'stipendFoundOfficial', 'stipendNotes', 'deadlineIso', 'applicationRestrictions', 'multiApply',
            'careerOutcomes', 'admitBackgrounds', 'intlNotes',
            'collectedAt', 'tuitionLocal', 'tuitionNotes', 'rankingYear', 'qsWorldRank', 'qsSubjectRank',
            'qsSubjectName', 'theWorldRank', 'theSubjectRank', 'theSubjectName', 'rankingSources', 'scholarships', 'factSources',
          ],
        },
      },
    },
    required: ['summary', 'suggestedPrograms'],
  },
}

function programResearchContract({
  state,
  applicantProfile,
  researchTerms,
  region,
  perRegion,
  evidence,
  portalEvidence = [],
  officialProgramLeads = [],
}) {
  return buildProgramDiscoveryPayload({
    intake: state.intake,
    applicantProfile,
    researchTerms,
    region,
    targetPrograms: perRegion,
    crawlerEvidence: evidence,
    portalEvidence,
    officialProgramLeads,
  })
}

function programDiscoverySystem() {
  return programDiscoverySystemPrompt()
}

function verificationSystem() {
  return independentVerificationSystemPrompt()
}

function advisorDiscoverySystem() {
  return advisorDiscoverySystemPrompt()
}

async function runAgent({ key, system, payload, liveWeb, allowedDomains = SOURCE_DOMAINS, outputSchema = PROGRAM_AGENT_OUTPUT_SCHEMA, maxTokens = 3_000 }) {
  return runDiscoverAgentWithRetry({
    attempts: 2,
    complete: () => completeChat({
        key,
        system,
        user: JSON.stringify(payload),
        temperature: 0.2,
        maxTokens,
        webSearch: liveWeb,
        allowedDomains,
        outputSchema,
    }),
  })
}

/**
 * The pure research phase used by the per-user background queue. It performs
 * no store writes itself, which keeps expensive crawling and provider calls out
 * of the database lock.
 */
export async function buildDiscoverResearchRun({
  state,
  input,
  aiKey,
  aiKeys,
  applicantProfile = null,
  checkpoint = null,
  onCheckpoint,
  onProgress,
  onVerifiedPrograms,
}) {
  let working = normalizeDiscoverState(checkpoint?.workingState || state)
  const agentTrace = []
  let sourceCount = 0
  let sourceIndex = null
  let aiSummary = ''
  let aiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const rejectionReasonCounts = {}
  const degradedAgentBatches = []
  const incompleteVerificationProgramIds = new Set()
  const persistCheckpoint = createNonFatalCheckpointWriter(onCheckpoint)
  const recordGroundingRejections = (rejected = []) => {
    for (const item of rejected) {
      const reason = String(item?.reason || 'unknown')
      rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] || 0) + 1
    }
  }
  const selectedAiKeys = [...new Map((aiKeys?.length ? aiKeys : (aiKey ? [aiKey] : []))
    .filter(Boolean)
    .map((key) => [key.id, key])).values()]
  const aiUsageByKey = new Map(selectedAiKeys.map((key) => [key.id, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }]))
  const nextAgentKey = createAiKeyRoundRobin(selectedAiKeys)
  const addUsage = (key, completion, phase = 'research') => {
    const usage = completion.usage || {}
    aiUsage = {
      inputTokens: aiUsage.inputTokens + (usage.inputTokens || 0),
      outputTokens: aiUsage.outputTokens + (usage.outputTokens || 0),
      totalTokens: aiUsage.totalTokens + (usage.totalTokens || 0),
    }
    const current = aiUsageByKey.get(key.id) || { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    aiUsageByKey.set(key.id, {
      inputTokens: current.inputTokens + (usage.inputTokens || 0),
      outputTokens: current.outputTokens + (usage.outputTokens || 0),
      totalTokens: current.totalTokens + (usage.totalTokens || 0),
    })
    if (completion?.providerError) {
      degradedAgentBatches.push({
        phase,
        code: String(completion.providerError.code || 'PROVIDER_UNAVAILABLE'),
      })
    }
  }

  if (input.useAi) {
    if (!selectedAiKeys.length) throw new AiProviderError('AI_KEY_NOT_FOUND', 'The selected AI key is no longer available.')
    const expandedResearchTerms = expandDiscoverResearchTerms([
      working.intake.field,
      ...(working.intake.subfields || []),
    ])
    const researchQuery = {
      field: working.intake.field,
      subfields: working.intake.subfields,
      notes: working.intake.notes,
      seedPrograms: working.intake.seedPrograms,
      terms: expandedResearchTerms,
    }
    const curatedSources = listDiscoverResearchSources(working.intake.regions)
    let dynamicSources = []
    let dynamicSourceDiscovery = {
      provider: 'openalex',
      status: 'unavailable',
      sourceCount: 0,
      countryCount: 0,
    }
    await onProgress?.({
      stage: 'planning',
      message: 'Finding additional field-active universities across the selected countries…',
      sourceCount: 0,
    })
    try {
      dynamicSources = await discoverGlobalInstitutionSources({
        terms: expandedResearchTerms,
        regions: working.intake.regions,
        existingSources: DISCOVER_SOURCE_REGISTRY,
        limit: Math.min(36, Math.max(12, working.intake.nPrograms * 2)),
      })
      dynamicSourceDiscovery = {
        provider: 'openalex',
        status: 'ok',
        sourceCount: dynamicSources.length,
        countryCount: new Set(dynamicSources.map((source) => source.countryCode).filter(Boolean)).size,
        countries: [...new Set(dynamicSources.map((source) => source.country).filter(Boolean))].slice(0, 40),
      }
    } catch (error) {
      dynamicSourceDiscovery = {
        ...dynamicSourceDiscovery,
        error: String(error?.message || error).slice(0, 180),
      }
    }
    const scopedSources = [...curatedSources, ...dynamicSources]
    agentTrace.push({
      id: 'global_field_institution_discovery',
      name: 'OpenAlex Global Institution Discovery',
      status: dynamicSourceDiscovery.status === 'ok' ? 'done' : 'error',
      detail: dynamicSourceDiscovery.status === 'ok'
        ? `Added ${dynamicSourceDiscovery.sourceCount} field-active university roots across ${dynamicSourceDiscovery.countryCount} countries before the official crawl.`
        : 'Global institution expansion was unavailable; the curated adapter registry remained active.',
    })
    const crawlLimit = discoverResearchCrawlLimit(scopedSources.length, working.intake.nPrograms)
    const selectedSources = prioritizeDiscoverResearchSources(
      scopedSources,
      [
        ...(working.intake.seedPrograms || []),
        ...((applicantProfile?.existingApplications || []).flatMap((application) => [
          application.school,
          application.program,
        ])),
      ],
      crawlLimit,
    )
    await onProgress?.({ stage: 'crawling', message: `Checking ${selectedSources.length} official university sites…`, sourceCount: 0 })
    const resumedCrawls = Array.isArray(checkpoint?.crawls) ? checkpoint.crawls : []
    const crawlByUrl = new Map(resumedCrawls
      .filter((result) => result?.source?.url)
      .map((result) => [result.source.url, result]))
    const remainingSources = selectedSources.filter((source) => !crawlByUrl.has(source.url))
    let crawled = crawlByUrl.size
    const freshCrawls = await crawlDiscoverSources({
      regions: working.intake.regions,
      sources: remainingSources,
      limit: Math.max(1, remainingSources.length),
      concurrency: 8,
      maxPages: 12,
      timeoutMs: 7_000,
      researchQuery,
      onProgress: async (progress) => {
        crawled += 1
        if (progress.result?.source?.url) crawlByUrl.set(progress.result.source.url, progress.result)
        await persistCheckpoint({
          stage: 'crawling',
          crawls: [...crawlByUrl.values()],
          portalCrawls: checkpoint?.portalCrawls || [],
          completedProgramRegions: checkpoint?.completedProgramRegions || [],
          completedAdvisorBatches: checkpoint?.completedAdvisorBatches || [],
          completedVerificationBatches: checkpoint?.completedVerificationBatches || [],
          workingState: working,
        })
        if (crawled === 1 || crawled % 10 === 0 || crawled === selectedSources.length) {
          await onProgress?.({
            stage: 'crawling',
            message: `Checked ${crawled}/${selectedSources.length} official university sites…`,
            sourceCount: crawled,
          })
        }
      },
    })
    for (const result of freshCrawls) if (result?.source?.url) crawlByUrl.set(result.source.url, result)
    let crawls = selectedSources.map((source) => crawlByUrl.get(source.url)).filter(Boolean)
    const rebuildSourceIndex = (previous = sourceIndex) => {
      const scholarlyBySchool = new Map((previous?.schools || [])
        .filter((school) => school?.scholarlyEvidence)
        .map((school) => [school.school, school.scholarlyEvidence]))
      const rebuilt = buildDiscoverSourceIndex(crawls)
      return {
        ...(previous || {}),
        ...rebuilt,
        adapterCoverage: adapterCoverageSummary(),
        dynamicSourceDiscovery,
        schools: rebuilt.schools.map((school) => ({
          ...school,
          scholarlyEvidence: scholarlyBySchool.get(school.school) || null,
        })),
      }
    }
    sourceIndex = rebuildSourceIndex(null)
    const hydratePrograms = async (programs, stage, message, options = {}) => {
      const hydration = await hydrateDiscoverOfficialEvidence({
        programs,
        crawls,
        sourceIndex,
        researchQuery,
        concurrency: 3,
        ...options,
        onProgress: async ({ completed, total }) => {
          if (completed === 1 || completed === total) {
            await onProgress?.({ stage, message: `${message} ${completed}/${total}…`, sourceCount })
          }
        },
      })
      if (hydration.attemptedSourceCount > 0) {
        crawls = hydration.crawls
        sourceIndex = rebuildSourceIndex(sourceIndex)
      }
      return hydration
    }
    const candidateHydrationSchoolLimit = Math.min(
      32,
      Math.max(12, Math.ceil(working.intake.nPrograms * 1.5)),
    )
    const indexedDoctoralCandidates = selectDiscoverCandidateHydrationPrograms(crawls, {
      schoolLimit: candidateHydrationSchoolLimit,
      perSchool: 2,
      totalLimit: candidateHydrationSchoolLimit * 2,
    })
    const candidateHydration = await hydratePrograms(
      indexedDoctoralCandidates,
      'crawling',
      'Fetching high-confidence doctoral pages already found in official indexes',
      {
        includeDeclaredSeeds: false,
        maxSchools: candidateHydrationSchoolLimit,
      },
    )
    agentTrace.push({
      id: 'indexed_doctoral_candidate_hydration',
      name: 'Adaptive Official Programme Deep Crawl',
      status: 'done',
      detail: `Selected ${indexedDoctoralCandidates.length} high-confidence indexed doctoral links and fetched ${candidateHydration.fetchedPageCount} pages across ${candidateHydration.attemptedSourceCount} universities before AI discovery.`,
    })
    const officialProgramLeads = deriveOfficialProgramLeads(crawls, {
      fieldTerms: [working.intake.field, ...(working.intake.subfields || [])],
      requireFieldMatch: false,
      limit: Math.min(320, Math.max(60, working.intake.nPrograms * 8)),
    })
    const officialEvidenceFor = (predicate, maxChars = 72_000) => compactDiscoverCrawlEvidence(
      crawls.filter(predicate),
      { maxChars, researchQuery },
    )
    sourceCount = sourceIndex.schools.filter((school) => school.crawlStatus === 'ok').length
    const advisorPageCount = sourceIndex.schools.reduce((total, school) => total + school.advisorPages.length, 0)
    agentTrace.push({
      id: 'official_source_crawl',
      name: 'Official Source Crawler',
      status: 'done',
      detail: `${sourceCount}/${Math.min(scopedSources.length, crawlLimit)} official sites supplied readable evidence; ${advisorPageCount} likely advisor pages were indexed separately.`,
    })

    const opportunitySources = listDiscoverOpportunitySources()
    const resumedPortalCrawls = Array.isArray(checkpoint?.portalCrawls) ? checkpoint.portalCrawls : []
    const currentPortalByUrl = new Map(opportunitySources.map((source) => [source.url, source]))
    const portalByUrl = new Map(resumedPortalCrawls
      .filter((result) => {
        const currentSource = currentPortalByUrl.get(result?.source?.url)
        return currentSource
          && result?.health?.policyFingerprint === opportunityPolicyFingerprint(currentSource)
      })
      .map((result) => [result.source.url, result]))
    const remainingPortals = opportunitySources.filter((source) => !portalByUrl.has(source.url))
    await onProgress?.({ stage: 'portals', message: `Checking ${opportunitySources.length} opportunity indexes as candidate leads…`, sourceCount })
    const freshPortalCrawls = await crawlDiscoverOpportunitySources({
      sources: remainingPortals,
      concurrency: 2,
      onProgress: async (progress) => {
        if (progress.result?.source?.url) portalByUrl.set(progress.result.source.url, progress.result)
        await persistCheckpoint({
          stage: 'portals', crawls, portalCrawls: [...portalByUrl.values()], workingState: working,
          completedProgramRegions: checkpoint?.completedProgramRegions || [],
          completedAdvisorBatches: checkpoint?.completedAdvisorBatches || [],
          completedVerificationBatches: checkpoint?.completedVerificationBatches || [],
        })
      },
    })
    for (const result of freshPortalCrawls) if (result?.source?.url) portalByUrl.set(result.source.url, result)
    const portalCrawls = opportunitySources.map((source) => portalByUrl.get(source.url)).filter(Boolean)
    const portalEvidence = compactDiscoverCrawlEvidence(portalCrawls, { maxChars: 36_000 })
      .map((entry) => ({ ...entry, authority: 'lead-only', canVerifyApplicationFact: false }))
    sourceIndex = {
      ...sourceIndex,
      opportunitySources: summarizeOpportunitySourceHealth(portalCrawls),
    }
    const portalReadable = sourceIndex.opportunitySources
      .filter((source) => source.status === 'ok' || source.status === 'partial').length
    const portalBlocked = sourceIndex.opportunitySources.filter((source) => source.status === 'blocked').length
    agentTrace.push({
      id: 'opportunity_lead_indexes',
      name: 'Opportunity Index Lead Discovery',
      status: 'done',
      detail: `${portalReadable}/${opportunitySources.length} lead indexes were readable; ${portalBlocked} were explicitly recorded as blocked. Portal-only facts cannot pass the official evidence gate.`,
    })

    // Migrate earlier AI rows through the same evidence boundary. This removes
    // unsourced generic suggestions and strips any cross-university citations
    // before they can influence the next ranking pass. Manual user rows remain
    // untouched, but are not treated as verified research candidates.
    const priorAiPrograms = (working.customPrograms || []).filter((program) => program.provenance === 'ai')
    const manualPrograms = (working.customPrograms || []).filter((program) => program.provenance !== 'ai')
    const groundedPrior = groundDiscoverPrograms(priorAiPrograms, sourceIndex)
    recordGroundingRejections(groundedPrior.rejected)
    working = normalizeDiscoverState({
      ...working,
      // A completed official research run is a new decision set, not an
      // overlay on the small built-in demo catalogue. This prevents an
      // unsourced sample row from outranking a freshly verified program.
      catalogSource: 'custom',
      officialResearchOnly: true,
      customPrograms: [...manualPrograms, ...groundedPrior.programs],
    })

    const regions = working.intake.regions.length ? working.intake.regions : [...new Set(scopedSources.map((source) => source.region))]
    const perRegion = Math.max(1, Math.ceil(working.intake.nPrograms / Math.max(1, regions.length)))
    const completedProgramRegions = new Set(checkpoint?.completedProgramRegions || [])
    const pendingRegions = regions.filter((region) => !completedProgramRegions.has(region))
    const programAgentRuns = await mapWithConcurrency(pendingRegions, 2, async (region) => {
      await onProgress?.({ stage: 'discovering', message: `Finding ${region} programs from official sources…`, sourceCount })
      const agentKey = nextAgentKey()
      const regionEvidence = officialEvidenceFor((result) => result?.source?.region === region)
      const regionProgramLeads = officialProgramLeads.filter((lead) => lead.region === region)
      const completion = await runAgent({
        key: agentKey,
        system: programDiscoverySystem(),
        payload: programResearchContract({
          state: working,
          applicantProfile,
          researchTerms: expandedResearchTerms,
          region,
          perRegion,
          evidence: regionEvidence,
          portalEvidence: portalEvidence.slice(0, 12),
          officialProgramLeads: regionProgramLeads,
        }),
        liveWeb: supportsNativeOpenAiWebSearch(agentKey),
        allowedDomains: webSearchDomainsForSources(
          scopedSources.filter((source) => source.region === region),
        ),
        maxTokens: 4_000,
      })
      return { region, agentKey, completion, regionEvidence, regionProgramLeads }
    })
    for (const { region, agentKey, completion, regionEvidence, regionProgramLeads } of programAgentRuns) {
      addUsage(agentKey, completion, `program:${region}`)
      const parsed = parseAiResearchResponse(completion.text, rankPrograms(working))
      const hydration = await hydratePrograms(
        parsed.suggestedPrograms,
        'discovering',
        `Fetching newly discovered ${region} official programme evidence`,
      )
      const phaseEvidenceUrls = [...new Set([
        ...collectPhaseEvidenceUrls({
          crawlerEvidence: regionEvidence,
          completionSources: completion.sources,
        }),
        ...collectFinalFetchedEvidenceUrls(sourceIndex),
      ])]
      const grounded = groundDiscoverPrograms(parsed.suggestedPrograms, sourceIndex, {
        previousPrograms: working.customPrograms,
        allowedEvidenceUrls: phaseEvidenceUrls,
      })
      recordGroundingRejections(grounded.rejected)
      const acceptedPrograms = input.acceptSuggestions
        ? grounded.programs
        : grounded.programs.filter((program) => (working.customPrograms || []).some((existing) => existing.id === program.id))
      working = normalizeDiscoverState({
        ...working,
        customPrograms: mergeCustomPrograms(working.customPrograms, acceptedPrograms),
        aiEnrichments: { ...working.aiEnrichments, ...parsed.enrichments },
      })
      if (parsed.summary) aiSummary = [aiSummary, parsed.summary].filter(Boolean).join(' · ').slice(0, 1_200)
      agentTrace.push({
        id: `program_discovery_${region}`,
        name: `${region} Program Discovery`,
        status: completion.providerError ? 'error' : 'done',
        detail: `${parsed.summary || `${region} official-source discovery completed.`} Evaluated ${regionProgramLeads.length} deterministic official programme leads; retained ${acceptedPrograms.length}; rejected ${grounded.rejected.length} rows without matching official evidence. Hydrated ${hydration.fetchedPageCount} pages from ${hydration.attemptedSourceCount} official sites.`,
        keyId: agentKey.id,
        provider: agentKey.provider,
        model: agentKey.model || null,
        evidenceUrlCount: phaseEvidenceUrls.length,
      })
      if (!completion.providerError) completedProgramRegions.add(region)
      await persistCheckpoint({
        stage: 'discovering', crawls, portalCrawls, sourceIndex, workingState: working,
        completedProgramRegions: [...completedProgramRegions],
        completedAdvisorBatches: checkpoint?.completedAdvisorBatches || [],
        completedVerificationBatches: checkpoint?.completedVerificationBatches || [],
      })
    }

    // A single regional pass can under-fill when a provider omits valid leads
    // or when some proposed URLs fail the crawler gate. Re-query bounded sets
    // of still-unused, already-fetched official doctoral pages until the user
    // target is met or the evidence pool is exhausted.
    // Store completed lead identities rather than positions. Accepted results
    // change the remaining array between restarts, so a numeric batch offset
    // can otherwise point at a different set of programme pages after resume.
    const completedSupplementalBatches = new Set(checkpoint?.completedSupplementalBatches || [])
    const acceptedProgramUrls = new Set((working.customPrograms || [])
      .filter((program) => program.provenance === 'ai')
      .flatMap((program) => [program.website, ...(program.sources || [])])
      .map(canonicalEvidenceUrl)
      .filter(Boolean))
    const remainingProgramLeads = officialProgramLeads
      .filter((lead) => {
        const identity = canonicalEvidenceUrl(lead.officialUrl)
        return identity
          && !acceptedProgramUrls.has(identity)
          && !completedSupplementalBatches.has(`lead:${identity}`)
      })
    const supplementalChunks = []
    for (let index = 0; index < remainingProgramLeads.length; index += 10) {
      supplementalChunks.push(remainingProgramLeads.slice(index, index + 10))
    }
    const initialShortfall = Math.max(0, working.intake.nPrograms - (working.customPrograms || [])
      .filter((program) => program.provenance === 'ai').length)
    const supplementalLimit = Math.min(6, supplementalChunks.length, Math.max(0, Math.ceil(initialShortfall / 3)))
    for (let batchNumber = 0; batchNumber < supplementalLimit; batchNumber += 1) {
      const currentCount = (working.customPrograms || []).filter((program) => program.provenance === 'ai').length
      const shortfall = Math.max(0, working.intake.nPrograms - currentCount)
      if (!shortfall) break
      const leads = supplementalChunks[batchNumber]
      const schoolNames = new Set(leads.map((lead) => lead.school))
      const supplementalEvidence = officialEvidenceFor((result) => schoolNames.has(result?.source?.school), 84_000)
      await onProgress?.({
        stage: 'discovering',
        message: `Filling the verified programme shortfall from official leads (${currentCount}/${working.intake.nPrograms})…`,
        sourceCount,
      })
      const agentKey = nextAgentKey()
      const completion = await runAgent({
        key: agentKey,
        system: programDiscoverySystem(),
        payload: programResearchContract({
          state: working,
          applicantProfile,
          researchTerms: expandedResearchTerms,
          region: [...new Set(leads.map((lead) => lead.region))].join(', '),
          perRegion: Math.min(shortfall, Math.max(2, Math.ceil(leads.length / 3))),
          evidence: supplementalEvidence,
          portalEvidence: portalEvidence.slice(0, 8),
          officialProgramLeads: leads,
        }),
        liveWeb: supportsNativeOpenAiWebSearch(agentKey),
        allowedDomains: webSearchDomainsForSources(supplementalEvidence),
        maxTokens: 5_000,
      })
      addUsage(agentKey, completion, `program-supplement:${batchNumber + 1}`)
      const parsed = parseAiResearchResponse(completion.text, rankPrograms(working))
      const hydration = await hydratePrograms(
        parsed.suggestedPrograms,
        'discovering',
        'Fetching supplemental official programme evidence',
      )
      const phaseEvidenceUrls = [...new Set([
        ...collectPhaseEvidenceUrls({
          crawlerEvidence: supplementalEvidence,
          completionSources: completion.sources,
        }),
        ...collectFinalFetchedEvidenceUrls(sourceIndex),
      ])]
      const grounded = groundDiscoverPrograms(parsed.suggestedPrograms, sourceIndex, {
        previousPrograms: working.customPrograms,
        allowedEvidenceUrls: phaseEvidenceUrls,
      })
      recordGroundingRejections(grounded.rejected)
      const acceptedPrograms = input.acceptSuggestions
        ? grounded.programs
        : grounded.programs.filter((program) => (working.customPrograms || []).some((existing) => existing.id === program.id))
      working = normalizeDiscoverState({
        ...working,
        customPrograms: mergeCustomPrograms(working.customPrograms, acceptedPrograms),
        aiEnrichments: { ...working.aiEnrichments, ...parsed.enrichments },
      })
      if (parsed.summary) aiSummary = [aiSummary, parsed.summary].filter(Boolean).join(' · ').slice(0, 1_200)
      if (!completion.providerError) {
        for (const lead of leads) {
          const identity = canonicalEvidenceUrl(lead.officialUrl)
          if (identity) completedSupplementalBatches.add(`lead:${identity}`)
        }
      }
      agentTrace.push({
        id: `program_supplement_${batchNumber + 1}`,
        name: 'Adaptive Programme Coverage',
        status: completion.providerError ? 'error' : 'done',
        detail: `Rechecked ${leads.length} unused fetched official leads; retained ${acceptedPrograms.length}, rejected ${grounded.rejected.length}, and hydrated ${hydration.fetchedPageCount} pages.`,
        keyId: agentKey.id,
        provider: agentKey.provider,
        model: agentKey.model || null,
        evidenceUrlCount: phaseEvidenceUrls.length,
      })
      await persistCheckpoint({
        stage: 'discovering', crawls, portalCrawls, sourceIndex, workingState: working,
        completedProgramRegions: [...completedProgramRegions],
        completedSupplementalBatches: [...completedSupplementalBatches],
        completedAdvisorBatches: checkpoint?.completedAdvisorBatches || [],
        completedVerificationBatches: checkpoint?.completedVerificationBatches || [],
      })
    }

    // If deterministic doctoral-page leads are exhausted, use a final bounded
    // school-by-school native-search pass. This is intentionally narrower than
    // the regional agents: one exact current programme per named university,
    // followed by immediate server-side URL hydration and the same grounding
    // gate. It improves recall without turning broad graduate landing pages or
    // portal snippets into saved programmes.
    // School identities remain stable even when newly accepted programmes
    // alter relevance ordering and represented-school filters on resume.
    const completedTargetedSchoolBatches = new Set(checkpoint?.completedTargetedSchoolBatches || [])
    const representedSchools = new Set((working.customPrograms || [])
      .filter((program) => program.provenance === 'ai')
      .map((program) => findSchoolSourceEntry(program, sourceIndex)?.school)
      .filter(Boolean))
    const targetedSchoolResults = crawls
      .filter((result) => {
        const identity = canonicalEvidenceUrl(result?.source?.url)
        return result?.pages?.length
          && !representedSchools.has(result?.source?.school)
          && !completedTargetedSchoolBatches.has(`school:${identity}`)
      })
      .map((result) => ({
        result,
        score: Math.max(0, ...(result.pages || []).map((page) => Number(page?.relevanceScore) || 0))
          + (result.pages || []).filter((page) => (page?.types || []).includes('program')).length * 40
          + (result.candidatePages || []).filter((page) => (page?.types || []).includes('program')).length,
      }))
      .sort((left, right) => right.score - left.score || left.result.source.school.localeCompare(right.result.source.school))
      .map((entry) => entry.result)
    const targetedSchoolChunks = []
    for (let index = 0; index < targetedSchoolResults.length; index += 5) {
      targetedSchoolChunks.push(targetedSchoolResults.slice(index, index + 5))
    }
    const targetedShortfall = Math.max(0, working.intake.nPrograms - (working.customPrograms || [])
      .filter((program) => program.provenance === 'ai').length)
    const targetedLimit = Math.min(6, targetedSchoolChunks.length, Math.max(0, Math.ceil(targetedShortfall / 2)))
    for (let batchNumber = 0; batchNumber < targetedLimit; batchNumber += 1) {
      const currentCount = (working.customPrograms || []).filter((program) => program.provenance === 'ai').length
      const shortfall = Math.max(0, working.intake.nPrograms - currentCount)
      if (!shortfall) break
      const schoolResults = targetedSchoolChunks[batchNumber]
      const schoolUrls = new Set(schoolResults.map((result) => result.source.url))
      const evidence = officialEvidenceFor((result) => schoolUrls.has(result?.source?.url), 90_000)
      const schoolNames = schoolResults.map((result) => result.source.school)
      const leads = officialProgramLeads.filter((lead) => schoolNames.includes(lead.school))
      await onProgress?.({
        stage: 'discovering',
        message: `Deep-searching ${schoolNames.length} additional universities for exact programme pages (${currentCount}/${working.intake.nPrograms})…`,
        sourceCount,
      })
      const agentKey = nextAgentKey()
      const completion = await runAgent({
        key: agentKey,
        system: `${programDiscoverySystem()} For this targeted pass, inspect every named university separately and return at most one exact, field-relevant current doctoral programme per university. A university-wide graduate landing page, "not found", or a bare "PhD" is not a programme title.`,
        payload: {
          ...programResearchContract({
            state: working,
            applicantProfile,
            researchTerms: expandedResearchTerms,
            region: [...new Set(schoolResults.map((result) => result.source.region))].join(', '),
            perRegion: Math.min(shortfall, schoolResults.length),
            evidence,
            portalEvidence: [],
            officialProgramLeads: leads,
          }),
          targetUniversities: schoolNames,
          oneExactProgrammePerUniversity: true,
        },
        liveWeb: supportsNativeOpenAiWebSearch(agentKey),
        allowedDomains: webSearchDomainsForSources(schoolResults.map((result) => result.source)),
        maxTokens: 5_000,
      })
      addUsage(agentKey, completion, `program-targeted:${batchNumber + 1}`)
      const parsed = parseAiResearchResponse(completion.text, rankPrograms(working))
      const hydration = await hydratePrograms(
        parsed.suggestedPrograms,
        'discovering',
        'Fetching targeted official programme pages',
      )
      const phaseEvidenceUrls = [...new Set([
        ...collectPhaseEvidenceUrls({ crawlerEvidence: evidence, completionSources: completion.sources }),
        ...collectFinalFetchedEvidenceUrls(sourceIndex),
      ])]
      const grounded = groundDiscoverPrograms(parsed.suggestedPrograms, sourceIndex, {
        previousPrograms: working.customPrograms,
        allowedEvidenceUrls: phaseEvidenceUrls,
      })
      recordGroundingRejections(grounded.rejected)
      const acceptedPrograms = input.acceptSuggestions
        ? grounded.programs
        : grounded.programs.filter((program) => (working.customPrograms || []).some((existing) => existing.id === program.id))
      working = normalizeDiscoverState({
        ...working,
        customPrograms: mergeCustomPrograms(working.customPrograms, acceptedPrograms),
        aiEnrichments: { ...working.aiEnrichments, ...parsed.enrichments },
      })
      if (parsed.summary) aiSummary = [aiSummary, parsed.summary].filter(Boolean).join(' · ').slice(0, 1_200)
      if (!completion.providerError) {
        for (const result of schoolResults) {
          const identity = canonicalEvidenceUrl(result?.source?.url)
          if (identity) completedTargetedSchoolBatches.add(`school:${identity}`)
        }
      }
      agentTrace.push({
        id: `targeted_school_discovery_${batchNumber + 1}`,
        name: 'Targeted University Programme Search',
        status: completion.providerError ? 'error' : 'done',
        detail: `Deep-searched ${schoolNames.length} named universities; retained ${acceptedPrograms.length} exact programmes, rejected ${grounded.rejected.length}, and hydrated ${hydration.fetchedPageCount} pages.`,
        keyId: agentKey.id,
        provider: agentKey.provider,
        model: agentKey.model || null,
        evidenceUrlCount: phaseEvidenceUrls.length,
      })
      await persistCheckpoint({
        stage: 'discovering', crawls, portalCrawls, sourceIndex, workingState: working,
        completedProgramRegions: [...completedProgramRegions],
        completedSupplementalBatches: [...completedSupplementalBatches],
        completedTargetedSchoolBatches: [...completedTargetedSchoolBatches],
        completedAdvisorBatches: checkpoint?.completedAdvisorBatches || [],
        completedVerificationBatches: checkpoint?.completedVerificationBatches || [],
      })
    }

    const candidates = rankPrograms(working)
      .filter((program) => program.sources?.length && program.verification?.status !== 'unverified')
      .slice(0, working.intake.nPrograms)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    if (!candidates.length) {
      throw new AiProviderError('AI_RESEARCH_UNGROUNDED', 'Live research returned no program with a university-owned source. Previous decisions were preserved.')
    }

    const candidateSchoolEntries = [...new Map(candidates
      .map((program) => findSchoolSourceEntry(program, sourceIndex))
      .filter(Boolean)
      .map((school) => [school.school, school])).values()]
    await onProgress?.({
      stage: 'scholarly',
      message: `Cross-checking publication graphs for ${candidateSchoolEntries.length} candidate universities…`,
      sourceCount,
    })
    const scholarlyEntries = await collectScholarlyEvidence({
      schools: candidateSchoolEntries,
      query: expandedResearchTerms.slice(0, 4),
      concurrency: 3,
      maxResearchersPerSchool: Math.max(
        24,
        Math.min(60, working.intake.nPisPerProgram * 4),
      ),
      onProgress: async ({ completed, total }) => {
        if (completed === 1 || completed % 5 === 0 || completed === total) {
          await onProgress?.({
            stage: 'scholarly',
            message: `Cross-checked OpenAlex/ROR institutions ${completed}/${total}…`,
            sourceCount,
          })
        }
      },
    })
    sourceIndex = attachScholarlyEvidence(sourceIndex, scholarlyEntries)
    const advisorProfileLeads = deriveOfficialAdvisorProfileLeads(candidates, sourceIndex, {
      maxProfilesPerSchool: Math.max(
        10,
        Math.min(20, working.intake.nPisPerProgram * 3),
      ),
    })
    const advisorLeadHydration = await hydratePrograms(
      advisorProfileLeads,
      'advisors',
      'Fetching publication-matched official advisor profiles',
    )
    const scholarlyBySchool = new Map(sourceIndex.schools.map((school) => [school.school, school.scholarlyEvidence]))
    agentTrace.push({
      id: 'scholarly_graph_discovery',
      name: 'OpenAlex + ROR Researcher Discovery',
      status: 'done',
      detail: `${scholarlyEntries.filter((entry) => entry.evidence?.status === 'ok').length}/${candidateSchoolEntries.length} institutions resolved to stable scholarly IDs; candidates still require an official faculty-page check.`,
    })
    agentTrace.push({
      id: 'official_advisor_profile_hydration',
      name: 'Official Advisor Profile Deep Crawl',
      status: 'done',
      detail: `Matched ${advisorProfileLeads.reduce((total, program) => total + (program.pis?.length || 0), 0)} publication-backed names to official directory links and fetched ${advisorLeadHydration.fetchedPageCount} profile/evidence pages across ${advisorLeadHydration.attemptedSourceCount} universities.`,
    })
    // One programme per advisor task keeps the requested PI count realistic
    // inside a bounded output budget. Prefix the fingerprint so checkpoints
    // created by the earlier five-program batching cannot skip new tasks.
    const advisorProgramFingerprint = `advisor-v2:${candidates.map((program) => program.id).join('|')}`
    const completedAdvisorBatches = new Set(
      checkpoint?.advisorProgramFingerprint === advisorProgramFingerprint
        ? (checkpoint?.completedAdvisorBatches || [])
        : [],
    )
    const advisorBatches = []
    for (let index = 0; index < candidates.length; index += DISCOVER_AGENT_BATCH_SIZES.advisor) {
      const batchNumber = Math.floor(index / DISCOVER_AGENT_BATCH_SIZES.advisor)
      if (completedAdvisorBatches.has(batchNumber)) continue
      const batch = candidates.slice(index, index + DISCOVER_AGENT_BATCH_SIZES.advisor)
      advisorBatches.push({ index, batchNumber, batch })
    }
    const advisorAgentRuns = await mapWithConcurrency(advisorBatches, 4, async ({ index, batchNumber, batch }) => {
      await onProgress?.({
        stage: 'advisors',
        message: `Finding official advisor and lab pages for programs ${index + 1}–${index + batch.length} of ${candidates.length}…`,
        sourceCount,
      })
      const agentKey = nextAgentKey()
      const schoolNames = new Set(batch.map((program) => program.school))
      const schoolEvidence = officialEvidenceFor((result) => schoolNames.has(result?.source?.school))
      const completion = await runAgent({
        key: agentKey,
        system: advisorDiscoverySystem(),
        payload: buildAdvisorDiscoveryPayload({
          intake: working.intake,
          applicantProfile,
          researchTerms: expandedResearchTerms,
          candidates: batch,
          crawlerEvidence: schoolEvidence,
          officialAdvisorLeads: advisorProfileLeads
            .filter((program) => schoolNames.has(program.school))
            .map((program) => ({ school: program.school, pis: program.pis })),
          scholarlyEvidence: batch.map((program) => ({
            school: program.school,
            evidence: scholarlyBySchool.get(program.school) || null,
          })),
        }),
        liveWeb: supportsNativeOpenAiWebSearch(agentKey),
        allowedDomains: webSearchDomainsForSources([
          ...schoolEvidence,
          ...batch.flatMap((program) => program.sources || []),
        ]),
        maxTokens: discoverAdvisorAgentMaxTokens(working.intake.nPisPerProgram),
      })
      return { index, batchNumber, batch, schoolEvidence, agentKey, completion }
    })
    for (const { index, batchNumber, batch, schoolEvidence, agentKey, completion } of advisorAgentRuns) {
      addUsage(agentKey, completion, `advisor:${batchNumber + 1}`)
      const parsed = parseAiResearchResponse(completion.text, rankPrograms(working))
      const hydration = await hydratePrograms(
        parsed.suggestedPrograms,
        'advisors',
        'Fetching agent-discovered official advisor profiles',
      )
      const phaseEvidenceUrls = [...new Set([
        ...collectPhaseEvidenceUrls({
          crawlerEvidence: schoolEvidence,
          candidates: batch,
          completionSources: completion.sources,
        }),
        ...collectFinalFetchedEvidenceUrls(sourceIndex),
      ])]
      const grounded = groundDiscoverPrograms(parsed.suggestedPrograms, sourceIndex, {
        previousPrograms: working.customPrograms,
        allowedEvidenceUrls: phaseEvidenceUrls,
      })
      recordGroundingRejections(grounded.rejected)
      const advisorPrograms = input.acceptSuggestions
        ? grounded.programs
        : grounded.programs.filter((program) => (working.customPrograms || []).some((existing) => existing.id === program.id))
      working = normalizeDiscoverState({
        ...working,
        customPrograms: mergeCustomPrograms(working.customPrograms, advisorPrograms),
        aiEnrichments: { ...working.aiEnrichments, ...parsed.enrichments },
      })
      if (parsed.summary) aiSummary = [aiSummary, parsed.summary].filter(Boolean).join(' · ').slice(0, 1_200)
      agentTrace.push({
        id: `advisor_discovery_${Math.floor(index / DISCOVER_AGENT_BATCH_SIZES.advisor) + 1}`,
        name: 'Advisor & Lab Discovery',
        status: completion.providerError ? 'error' : 'done',
        detail: `${parsed.summary || `Checked official faculty, lab and advisor pages for ${batch.length} programs.`} Retained ${advisorPrograms.reduce((total, program) => total + (program.pis?.length || 0), 0)} individually sourced advisor profiles after hydrating ${hydration.fetchedPageCount} pages.`,
        keyId: agentKey.id,
        provider: agentKey.provider,
        model: agentKey.model || null,
        evidenceUrlCount: phaseEvidenceUrls.length,
      })
      if (!completion.providerError) completedAdvisorBatches.add(batchNumber)
      await persistCheckpoint({
        stage: 'advisors', crawls, portalCrawls, sourceIndex, workingState: working,
        completedProgramRegions: [...completedProgramRegions],
        completedSupplementalBatches: [...completedSupplementalBatches],
        completedTargetedSchoolBatches: [...completedTargetedSchoolBatches],
        advisorProgramFingerprint,
        completedAdvisorBatches: [...completedAdvisorBatches],
        completedVerificationBatches: checkpoint?.completedVerificationBatches || [],
      })
    }
    // The verifier must see the advisor/lab records produced by the preceding
    // phase. Reusing the pre-advisor snapshot would make "independent PI
    // verification" cosmetic and could preserve a PI the verifier never saw.
    const candidateIds = new Set(candidates.map((program) => program.id))
    const latestCandidateById = new Map(rankPrograms(working)
      .filter((program) => candidateIds.has(program.id))
      .map((program) => [program.id, program]))
    const verificationCandidates = candidates
      .map((program) => latestCandidateById.get(program.id))
      .filter(Boolean)
    const verificationProgramFingerprint = verificationCandidates.map((program) => program.id).join('|')
    const completedVerificationBatches = new Set(
      checkpoint?.verificationProgramFingerprint === verificationProgramFingerprint
        ? (checkpoint?.completedVerificationBatches || [])
        : [],
    )
    const verificationBatches = []
    for (let index = 0; index < verificationCandidates.length; index += DISCOVER_AGENT_BATCH_SIZES.verification) {
      const batchNumber = Math.floor(index / DISCOVER_AGENT_BATCH_SIZES.verification)
      if (completedVerificationBatches.has(batchNumber)) continue
      const batch = verificationCandidates.slice(index, index + DISCOVER_AGENT_BATCH_SIZES.verification)
      verificationBatches.push({ index, batchNumber, batch })
    }
    const verificationAgentRuns = await mapWithConcurrency(verificationBatches, 2, async ({ index, batchNumber, batch }) => {
      await onProgress?.({
        stage: 'verifying',
        message: `Independently verifying programs ${index + 1}–${index + batch.length} of ${verificationCandidates.length}…`,
        sourceCount,
      })
      const agentKey = nextAgentKey()
      const schoolNames = new Set(batch.map((program) => program.school))
      const schoolEvidence = officialEvidenceFor((result) => schoolNames.has(result?.source?.school))
      const completion = await runAgent({
        key: agentKey,
        system: verificationSystem(),
        payload: buildIndependentVerificationPayload({
          intake: working.intake,
          researchTerms: expandedResearchTerms,
          applicantProfile,
          candidates: batch,
          crawlerEvidence: schoolEvidence,
          scholarlyEvidence: batch.map((program) => ({
            school: program.school,
            evidence: scholarlyBySchool.get(program.school) || null,
          })),
        }),
        liveWeb: supportsNativeOpenAiWebSearch(agentKey),
        allowedDomains: [...new Set([
          ...webSearchDomainsForSources([
            ...schoolEvidence,
            ...batch.flatMap((program) => program.sources || []),
          ]),
          ...DECISION_EVIDENCE_DOMAINS,
        ])].slice(0, 100),
        outputSchema: VERIFICATION_AGENT_OUTPUT_SCHEMA,
        maxTokens: 4_500,
      })
      return { index, batchNumber, batch, schoolEvidence, agentKey, completion }
    })
    for (const { index, batchNumber, batch, schoolEvidence, agentKey, completion } of verificationAgentRuns) {
      addUsage(agentKey, completion, `verification:${batchNumber + 1}`)
      const parsed = parseAiResearchResponse(completion.text, rankPrograms(working), { verified: true })
      const hydration = await hydratePrograms(
        parsed.suggestedPrograms,
        'verifying',
        'Fetching verifier-discovered official evidence',
      )
      const phaseEvidenceUrls = [...new Set([
        ...collectPhaseEvidenceUrls({
          crawlerEvidence: schoolEvidence,
          candidates: batch,
          completionSources: completion.sources,
        }),
        ...collectFinalFetchedEvidenceUrls(sourceIndex),
      ])]
      const grounded = groundDiscoverPrograms(parsed.suggestedPrograms, sourceIndex, {
        previousPrograms: working.customPrograms,
        allowedEvidenceUrls: phaseEvidenceUrls,
        authoritativePis: true,
      })
      recordGroundingRejections(grounded.rejected)
      const verifiedPrograms = input.acceptSuggestions
        ? grounded.programs
        : grounded.programs.filter((program) => (working.customPrograms || []).some((existing) => existing.id === program.id))
      const independentlyVerifiedIds = new Set(verifiedPrograms.map((program) => program.id))
      const missingVerificationIds = batch
        .map((program) => program.id)
        .filter((id) => !independentlyVerifiedIds.has(id))
      for (const id of missingVerificationIds) incompleteVerificationProgramIds.add(id)
      working = normalizeDiscoverState({
        ...working,
        customPrograms: mergeCustomPrograms(working.customPrograms, verifiedPrograms, { authoritative: true }),
        aiEnrichments: { ...working.aiEnrichments, ...parsed.enrichments },
      })
      if (parsed.summary) aiSummary = [aiSummary, parsed.summary].filter(Boolean).join(' · ').slice(0, 1_200)
      agentTrace.push({
        id: `verification_${Math.floor(index / DISCOVER_AGENT_BATCH_SIZES.verification) + 1}`,
        name: 'Independent Fact & PI Verification',
        status: completion.providerError || missingVerificationIds.length ? 'error' : 'done',
        detail: `${parsed.summary || `Verified ${batch.length} program records against live sources.`} Rejected ${grounded.rejected.length} updates that did not retain program-owned official evidence; hydrated ${hydration.fetchedPageCount} verifier pages.${missingVerificationIds.length ? ` ${missingVerificationIds.length}/${batch.length} records did not receive an independently grounded verifier update and remain partial.` : ''}`,
        keyId: agentKey.id,
        provider: agentKey.provider,
        model: agentKey.model || null,
        evidenceUrlCount: phaseEvidenceUrls.length,
      })
      if (!completion.providerError) completedVerificationBatches.add(batchNumber)
      await persistCheckpoint({
        stage: 'verifying', crawls, portalCrawls, sourceIndex, workingState: working,
        completedProgramRegions: [...completedProgramRegions],
        completedSupplementalBatches: [...completedSupplementalBatches],
        completedTargetedSchoolBatches: [...completedTargetedSchoolBatches],
        advisorProgramFingerprint,
        completedAdvisorBatches: [...completedAdvisorBatches],
        verificationProgramFingerprint,
        completedVerificationBatches: [...completedVerificationBatches],
      })
      if (verifiedPrograms.length) {
        await onVerifiedPrograms?.({
          programs: verifiedPrograms,
          sourceIndex,
          sourceCount,
          batchNumber,
        })
      }
    }
    // Re-ground the merged result set once more before persistence. Each agent
    // phase may update a shared record; without this last boundary an older
    // citation can survive a later school/program identity change.
    const finalManualPrograms = (working.customPrograms || []).filter((program) => program.provenance !== 'ai')
    const finalFetchedEvidenceUrls = collectFinalFetchedEvidenceUrls(sourceIndex)
    const finalGrounded = groundDiscoverPrograms(
      (working.customPrograms || []).filter((program) => program.provenance === 'ai'),
      sourceIndex,
      { allowedEvidenceUrls: finalFetchedEvidenceUrls },
    )
    recordGroundingRejections(finalGrounded.rejected)
    const finalSanitizedPrograms = dedupeDiscoverPrograms(finalGrounded.programs.map((program) => {
      if (!incompleteVerificationProgramIds.has(program.id)) return program
      return {
        ...program,
        verification: {
          ...program.verification,
          status: 'partial',
          issues: [...new Set([
            ...(program.verification?.issues || []),
            'Independent verifier coverage was incomplete for this record.',
          ])],
        },
      }
    }))
    working = normalizeDiscoverState({
      ...working,
      customPrograms: [...finalManualPrograms, ...finalSanitizedPrograms],
    })
    agentTrace.push({
      id: 'final_evidence_sanitization',
      name: 'Final Evidence Sanitization',
      status: 'done',
      detail: `Retained ${finalSanitizedPrograms.length} official-source AI programs; removed ${finalGrounded.rejected.length} stale, generic or cross-school rows before persistence.`,
    })
    // Rejected output still consumed billable provider tokens. Record usage
    // before the final safety gate so an integrity rejection is auditable too.
    await Promise.all(selectedAiKeys.map((key) => recordAiUsage(key, aiUsageByKey.get(key.id))))
    const quality = assessDiscoverResearchQuality(working, sourceIndex, {
      requestedPrograms: working.intake.nPrograms,
      scopedSourceCount: scopedSources.length,
      minimumReadableSites: Math.min(
        scopedSources.length,
        Math.max(5, Math.ceil(selectedSources.length * 0.25)),
      ),
      minimumPrograms: Math.min(5, working.intake.nPrograms),
      minimumAdvisors: Math.min(3, working.intake.nPisPerProgram),
    })
    if (degradedAgentBatches.length) {
      quality.warnings = [...new Set([...quality.warnings, 'provider-batches-degraded-after-retry'])]
      quality.coveragePassed = false
      quality.degradedAgentBatches = degradedAgentBatches
    }
    if (incompleteVerificationProgramIds.size) {
      quality.warnings = [...new Set([...quality.warnings, 'incomplete-independent-verifier-coverage'])]
      quality.coveragePassed = false
      quality.incompleteVerificationProgramIds = [...incompleteVerificationProgramIds]
    }
    if (persistCheckpoint.failureCount > 0) {
      quality.warnings = [...new Set([...quality.warnings, 'checkpoint-persistence-degraded'])]
      quality.coveragePassed = false
      quality.checkpointPersistence = {
        failureCount: persistCheckpoint.failureCount,
        failures: persistCheckpoint.failures,
      }
      agentTrace.push({
        id: 'durable_checkpoint_recovery',
        name: 'Durable Research Checkpoint',
        status: 'error',
        detail: `${persistCheckpoint.failureCount} checkpoint write${persistCheckpoint.failureCount === 1 ? '' : 's'} failed without discarding the in-memory verified result.`,
      })
    }
    sourceIndex = { ...sourceIndex, quality: { ...quality, rejectionReasonCounts } }
    if (!quality.passed) {
      throw new AiProviderError(
        'AI_RESEARCH_QUALITY_GATE',
        `Research evidence did not pass quality gates: ${quality.failures.join(', ')}`,
      )
    }
    agentTrace.push({
      id: 'evidence_quality_gate',
      name: 'Evidence Ownership & Coverage Gate',
      status: 'done',
      detail: `${quality.sourcedProgramCount} sourced programs; ${quality.verifiedAdvisorProfiles} verified advisor profiles; 0 cross-school source violations.${quality.warnings.length ? ` Partial-coverage warnings: ${quality.warnings.join(', ')}.` : ''}`,
    })
    working = normalizeDiscoverState({
      ...working,
      lastAiResearchAt: new Date().toISOString(),
      preferredAiKeyId: selectedAiKeys[0].id,
      preferredAiKeyIds: selectedAiKeys.map((key) => key.id),
    })
  }

  const research = runDiscoverResearch(working, input.useAi ? {
    ai: {
      summary: aiSummary,
      provider: selectedAiKeys[0]?.provider || null,
      model: selectedAiKeys.map((key) => key.model).filter(Boolean).join(', ') || null,
      suggestedPrograms: working.customPrograms.filter((program) => program.provenance === 'ai' && program.sources?.length),
      agentTrace,
    },
  } : {})
  if (agentTrace.length) research.agents = agentTrace
  const nextState = normalizeDiscoverState({
    ...working,
    intakeCompleted: true,
    lastResearchAt: research.runAt,
    lastMatchIds: research.topProgramIds,
    researchRuns: (working.researchRuns || 0) + 1,
    preferredAiKeyId: input.keyIds?.[0] || input.keyId || working.preferredAiKeyId,
    preferredAiKeyIds: input.keyIds?.length ? input.keyIds : working.preferredAiKeyIds,
  })
  return { nextState, research, sourceCount, sourceIndex, aiUsage }
}

async function recordAiUsage(aiKey, usage) {
  if (!usage.totalTokens) return
  const { markAiKeyUsed, recordAiKeyUsage } = await import('./storage.js')
  await recordAiKeyUsage(aiKey.id, usage)
  await markAiKeyUsed(aiKey.id)
}
