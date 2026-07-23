import { DISCOVER_SOURCE_REGISTRY } from './discover-source-registry.js'

const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max)

export const AI_APPLICATION_ENRICHMENT_OUTPUT_SCHEMA = Object.freeze({
  name: 'discover_application_enrichment',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      researchSummary: { type: 'string' },
      fitRationale: { type: 'string' },
      requirementsSummary: { type: 'string' },
      fundingSummary: { type: 'string' },
      suggestedAdvisor: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          homepage: { type: 'string' },
          research: { type: 'string' },
        },
        required: ['name', 'email', 'homepage', 'research'],
      },
      caveats: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      factSources: {
        type: 'object',
        additionalProperties: false,
        properties: {
          research: { type: 'string' },
          requirements: { type: 'string' },
          funding: { type: 'string' },
          advisor: { type: 'string' },
        },
        required: ['research', 'requirements', 'funding', 'advisor'],
      },
    },
    required: [
      'researchSummary', 'fitRationale', 'requirementsSummary', 'fundingSummary',
      'suggestedAdvisor', 'caveats', 'sources', 'factSources',
    ],
  },
})

function publicHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    const host = url.hostname.toLowerCase()
    const privateIpv4 = /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(host)
    if (url.protocol !== 'https:' || !host || host === 'localhost' || host.endsWith('.local') || privateIpv4 || host === '::1') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function urlsInText(value) {
  const text = String(value || '').trim()
  const direct = !/\s/.test(text) ? publicHttpsUrl(text) : null
  if (direct) return [direct]
  // This extracts links for crawl scope only. It never rewrites user text or
  // treats an arbitrary URL as verified application data.
  return [...text.matchAll(/https:\/\/[^\s<>"')\]]+/gi)]
    .map((match) => publicHttpsUrl(match[0]))
    .filter(Boolean)
}

function collectHttpsUrls(value, output, depth = 0) {
  if (depth > 5 || output.length >= 24 || value === null || value === undefined) return
  if (typeof value === 'string') {
    output.push(...urlsInText(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHttpsUrls(item, output, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectHttpsUrls(item, output, depth + 1)
  }
}

function normalizedSchoolIdentity(value) {
  return clean(value, 240)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
}

function normalizedStaticHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
}

const VERIFIED_SCHOOL_SOURCE_BY_NAME = new Map(
  DISCOVER_SOURCE_REGISTRY.map((source) => [normalizedSchoolIdentity(source.school), source]),
)

function sourceStaticHosts(source) {
  const hosts = new Set((source?.allowedHosts || []).map(normalizedStaticHost).filter(Boolean))
  const root = publicHttpsUrl(source?.url)
  if (root) hosts.add(normalizedStaticHost(new URL(root).hostname))
  return hosts
}

function sourceAllowsStaticUrl(value, source) {
  const url = publicHttpsUrl(value)
  if (!url || !source) return null
  return sourceStaticHosts(source).has(normalizedStaticHost(new URL(url).hostname)) ? url : null
}

/** Resolve only exact school identities represented by the verified registry. */
export function resolveVerifiedApplicationSchoolSource(application, program = null) {
  const applicationSchool = normalizedSchoolIdentity(application?.school?.name)
  if (!applicationSchool) return null
  const programSchool = normalizedSchoolIdentity(program?.school)
  if (programSchool && programSchool !== applicationSchool) return null
  return VERIFIED_SCHOOL_SOURCE_BY_NAME.get(applicationSchool) || null
}

/**
 * The crawl root and host allow-list always come from the verified registry.
 * Application links can only become bounded untrusted seeds when their exact
 * hostname is already statically declared by that school's adapter.
 */
export function extractApplicationResearchSources(application, program = null) {
  const verifiedSource = resolveVerifiedApplicationSchoolSource(application, program)
  if (!verifiedSource) return []
  const catalogSeedValues = []
  const applicationSeedValues = []
  const pushTyped = (value, kind, output) => {
    const urls = []
    collectHttpsUrls(value, urls)
    for (const url of urls) output.push({ kind, url })
  }
  pushTyped({
    programWebsite: program?.website,
    programSources: program?.sources,
    requirementsSource: program?.factSources?.applicationRoute,
    deadlineSource: program?.factSources?.deadline,
  }, 'doctoral', catalogSeedValues)
  pushTyped({
    advisors: (program?.pis || []).map((pi) => [pi?.url, pi?.homepage]),
  }, 'faculty', catalogSeedValues)
  pushTyped({
    fundingSource: program?.factSources?.funding,
    researchSource: program?.factSources?.research,
    scholarships: program?.scholarships,
  }, 'research', catalogSeedValues)
  pushTyped({
    schoolWebsite: application?.school?.website,
    professorHomepage: application?.professor?.homepage,
    applicationLinks: application?.links,
    dossierCards: application?.dossierCards,
    notes: application?.notes,
  }, 'application', applicationSeedValues)
  const declared = new Set((verifiedSource.seeds || []).map((seed) => seed.url))
  const seen = new Set(declared)
  const boundedSeeds = (values, max) => values.flatMap(({ kind, url }) => {
    const allowed = sourceAllowsStaticUrl(url, verifiedSource)
    if (!allowed || seen.has(allowed)) return []
    seen.add(allowed)
    return [{ kind, url: allowed, untrusted: true }]
  }).slice(0, max)
  // Matched catalog evidence is ordered before the broad school entry points,
  // so the bounded enrichment crawl reaches the exact programme, advisor and
  // funding pages instead of spending its whole budget on generic indexes.
  const catalogSeeds = boundedSeeds(catalogSeedValues, 8)
  const applicationSeeds = boundedSeeds(applicationSeedValues, 4)
  return [{
    school: verifiedSource.school,
    region: verifiedSource.region,
    url: verifiedSource.url,
    allowedHosts: [...verifiedSource.allowedHosts],
    seeds: [...catalogSeeds, ...applicationSeeds, ...verifiedSource.seeds],
    pathHints: verifiedSource.pathHints,
    adapterVerifiedAt: verifiedSource.adapterVerifiedAt,
  }]
}

function normalizedWords(value) {
  return new Set(clean(value, 300)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1))
}

function similarity(left, right) {
  const a = normalizedWords(left)
  const b = normalizedWords(right)
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const word of a) if (b.has(word)) overlap += 1
  return (2 * overlap) / (a.size + b.size)
}

function hostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const TRUSTED_ENRICHMENT_EVIDENCE_DOMAINS = new Set([
  'topuniversities.com',
  'timeshighereducation.com',
  'ukri.org',
  'daad.de',
  'nsf.gov',
  'canada.ca',
  'csc.edu.cn',
  'a-star.edu.sg',
  'education.gov.au',
])

function domainWithin(host, root) {
  return host === root || host.endsWith(`.${root}`)
}

function verifiedEnrichmentSources(application, program, ai) {
  const verifiedSource = resolveVerifiedApplicationSchoolSource(application, program)
  if (!verifiedSource) return []
  const allowedEvidenceUrl = (value) => {
    const url = publicHttpsUrl(value)
    if (!url) return null
    const host = hostname(url)
    return sourceAllowsStaticUrl(url, verifiedSource)
      || ([...TRUSTED_ENRICHMENT_EVIDENCE_DOMAINS].some((root) => domainWithin(host, root)) ? url : null)
  }
  const catalog = uniqueStrings([program.website, ...(program.sources || []), ...(program.rankingSources || [])], 20)
    .map(allowedEvidenceUrl)
    .filter(Boolean)
  const aiSources = uniqueStrings(ai?.sources || [], 20)
    .map(allowedEvidenceUrl)
    .filter(Boolean)
  return uniqueStrings([...catalog, ...aiSources], 12)
}

function matchScore(application, program) {
  const school = similarity(application?.school?.name, program?.school)
  const degree = similarity(application?.program, program?.program)
  const appHost = hostname(application?.school?.website)
  const programHost = hostname(program?.website)
  const host = appHost && programHost && (appHost === programHost || appHost.endsWith(`.${programHost}`) || programHost.endsWith(`.${appHost}`)) ? 1 : 0
  return Math.round((school * 0.68 + degree * 0.27 + host * 0.05) * 100)
}

export function findBestDiscoverProgram(application, programs) {
  const candidates = (Array.isArray(programs) ? programs : [])
    .map((program) => ({ program, score: matchScore(application, program) }))
    .sort((a, b) => b.score - a.score)
  return candidates[0]?.score >= 32 ? candidates[0] : null
}

function uniqueStrings(values, max = 24) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value, 500))
    .filter(Boolean))).slice(0, max)
}

function createChange({
  id,
  target,
  category,
  before = '',
  after = '',
  source = 'catalog',
  confidence = 'medium',
  sources = [],
  forceMode,
}) {
  const current = clean(before)
  const next = clean(after)
  if (!next || current === next) return null
  const mode = forceMode || (current ? 'update' : 'fill')
  return {
    id,
    target,
    category,
    mode,
    before: current,
    after: next,
    source,
    confidence,
    recommended: mode !== 'update',
    sources: uniqueStrings(sources, 12),
  }
}

function safeAi(ai) {
  if (!ai || typeof ai !== 'object') return null
  const advisor = ai.suggestedAdvisor && typeof ai.suggestedAdvisor === 'object'
    ? {
        name: clean(ai.suggestedAdvisor.name, 180),
        email: clean(ai.suggestedAdvisor.email, 240),
        homepage: clean(ai.suggestedAdvisor.homepage, 500),
        research: clean(ai.suggestedAdvisor.research, 1200),
      }
    : null
  return {
    researchSummary: clean(ai.researchSummary, 1600),
    fitRationale: clean(ai.fitRationale, 1600),
    requirementsSummary: clean(ai.requirementsSummary, 1600),
    fundingSummary: clean(ai.fundingSummary, 1200),
    caveats: uniqueStrings(ai.caveats, 8),
    sources: uniqueStrings(ai.sources, 12),
    fetchedSources: uniqueStrings(ai.fetchedSources, 60),
    factSources: Object.fromEntries(['research', 'requirements', 'funding', 'advisor'].map((key) => [
      key,
      clean(ai.factSources?.[key], 500),
    ])),
    suggestedAdvisor: advisor?.name ? advisor : null,
  }
}

function canonicalUrl(value) {
  const url = publicHttpsUrl(value)
  return url ? url.replace(/\/$/, '') : ''
}

function factSourceAllowed(ai, application, program, key) {
  const source = canonicalUrl(ai?.factSources?.[key])
  if (!source) return false
  const verifiedSource = resolveVerifiedApplicationSchoolSource(application, program)
  if (!sourceAllowsStaticUrl(source, verifiedSource)) return false
  const fetched = new Set((ai?.fetchedSources || []).map(canonicalUrl).filter(Boolean))
  // Catalog URLs remain useful crawl seeds, but they are not evidence for the
  // current run until the server crawler actually fetched them. This prevents
  // stale or redirected catalogue citations from self-certifying AI prose.
  return fetched.has(source)
}

function advisorUrlNamesPerson(advisor) {
  const url = publicHttpsUrl(advisor?.homepage)
  const honorifics = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss'])
  const words = clean(advisor?.name, 180).toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !honorifics.has(word))
  if (!url || words.length < 2) return false
  const pathWords = new URL(url).pathname.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return pathWords.includes(words[0]) && pathWords.includes(words[words.length - 1])
}

export function parseAiApplicationEnrichment(text) {
  try {
    const cleaned = clean(text, 30_000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    return safeAi(JSON.parse(cleaned))
  } catch {
    return null
  }
}

function requirementSummary(program, ai) {
  if (ai?.requirementsSummary) return ai.requirementsSummary
  return [
    program.deadlineAndTests,
    program.applicationRestrictions,
    program.applicationRoute,
  ].map((value) => clean(value, 800)).filter(Boolean).join('\n')
}

function fundingSummary(program, ai) {
  if (ai?.fundingSummary) return ai.fundingSummary
  return [program.stipendLocal, program.stipendBasis, program.stipendNotes]
    .map((value) => clean(value, 800)).filter(Boolean).join('\n')
}

function snapshotPayload(program, ai, sources) {
  return {
    programId: clean(program.id, 80),
    school: clean(program.school, 240),
    program: clean(program.program, 240),
    website: clean(program.website, 500),
    deadline: clean(program.deadlineIso, 40),
    research: ai?.researchSummary || clean(program.researchFocus, 1600),
    fit: ai?.fitRationale || clean(program.fitRationale, 1600),
    funding: fundingSummary(program, ai),
    requirements: requirementSummary(program, ai),
    outcomes: clean(program.careerOutcomes, 1200),
    international: clean(program.intlNotes, 1200),
    tuition: clean(program.tuitionLocal, 500),
    rankings: [
      program.qsWorldRank ? `QS world #${program.qsWorldRank}` : '',
      program.qsSubjectRank ? `QS ${clean(program.qsSubjectName, 160)} #${program.qsSubjectRank}` : '',
      program.theWorldRank ? `THE world #${program.theWorldRank}` : '',
      program.theSubjectRank ? `THE ${clean(program.theSubjectName, 160)} #${program.theSubjectRank}` : '',
    ].filter(Boolean).join(' · '),
    scholarships: (program.scholarships || []).map((item) => `${clean(item.name, 240)} · ${clean(item.amount, 200)} · ${clean(item.url, 500)}`).join('\n'),
    sources,
  }
}

export function buildApplicationEnrichmentProposal(application, programs, aiInput = null) {
  const candidateMatch = findBestDiscoverProgram(application, programs)
  const matched = candidateMatch && resolveVerifiedApplicationSchoolSource(application, candidateMatch.program)
    ? candidateMatch
    : null
  const rawAi = matched ? safeAi(aiInput) : null
  const generatedAt = new Date().toISOString()
  const program = matched?.program || null
  if (!program) {
    return {
      applicationId: clean(application?.id, 100),
      generatedAt,
      usedAi: Boolean(rawAi),
      matchedProgram: null,
      changes: [],
      caveats: ['No sufficiently close program was found in the current Discover catalog. Add or research the program in Discover first.'],
      payload: {},
    }
  }

  const score = matched?.score ?? 0
  // Sources remain catalog-backed even when AI synthesizes the prose. This
  // prevents a model-generated URL from being promoted as verified evidence.
  const sources = verifiedEnrichmentSources(application, program, rawAi)
  const ai = rawAi ? {
    ...rawAi,
    researchSummary: factSourceAllowed(rawAi, application, program, 'research') ? rawAi.researchSummary : '',
    fitRationale: factSourceAllowed(rawAi, application, program, 'research') ? rawAi.fitRationale : '',
    requirementsSummary: factSourceAllowed(rawAi, application, program, 'requirements') ? rawAi.requirementsSummary : '',
    fundingSummary: factSourceAllowed(rawAi, application, program, 'funding') ? rawAi.fundingSummary : '',
    suggestedAdvisor: factSourceAllowed(rawAi, application, program, 'advisor') && advisorUrlNamesPerson(rawAi.suggestedAdvisor)
      ? rawAi.suggestedAdvisor
      : null,
  } : null
  const source = ai ? 'catalog_ai' : 'catalog'
  const confidence = matched ? (score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low') : 'low'
  const changes = []
  const push = (change) => { if (change) changes.push(change) }

  push(createChange({
    id: 'school-website', target: 'school.website', category: 'identity',
    before: application?.school?.website, after: program.website, confidence, sources,
  }))
  push(createChange({
    id: 'application-deadline', target: 'deadline', category: 'requirements',
    before: application?.deadline, after: program.deadlineIso, confidence, sources,
  }))

  const matchedAiAdvisor = ai?.suggestedAdvisor
    ? (program.pis || []).find((candidate) => (
        similarity(candidate.name, ai.suggestedAdvisor.name) >= 0.75
        || (candidate.email && clean(candidate.email).toLowerCase() === clean(ai.suggestedAdvisor.email).toLowerCase())
      ))
    : null
  const aiAdvisor = matchedAiAdvisor || (ai?.suggestedAdvisor ? {
    ...ai.suggestedAdvisor,
    url: ai.suggestedAdvisor.homepage,
  } : null)
  const advisor = aiAdvisor || (program.pis || [])[0] || null
  if (advisor) {
    const advisorSource = aiAdvisor ? source : 'catalog'
    push(createChange({
      id: 'advisor-name', target: 'professor.english', category: 'advisor',
      before: application?.professor?.english, after: advisor.name, source: advisorSource,
      confidence: aiAdvisor ? 'medium' : confidence, sources,
    }))
    push(createChange({
      id: 'advisor-email', target: 'professor.email', category: 'advisor',
      before: application?.professor?.email, after: advisor.email, source: advisorSource,
      confidence: advisor.email ? confidence : 'unknown', sources,
    }))
    push(createChange({
      id: 'advisor-homepage', target: 'professor.homepage', category: 'advisor',
      before: application?.professor?.homepage, after: advisor.homepage || advisor.url, source: advisorSource,
      confidence, sources,
    }))
    push(createChange({
      id: 'advisor-research', target: 'professor.research', category: 'research',
      before: application?.professor?.research, after: advisor.research || ai?.researchSummary, source,
      confidence, sources,
    }))
  }

  const mergedTags = uniqueStrings([...(application?.tags || []), ...(program.tags || []), 'discover-enriched'], 12)
  if (mergedTags.join('\n') !== uniqueStrings(application?.tags || [], 12).join('\n')) {
    push(createChange({
      id: 'research-tags', target: 'tags', category: 'research',
      before: (application?.tags || []).join(', '), after: mergedTags.join(', '), source,
      confidence, sources, forceMode: 'merge',
    }))
  }

  const snapshot = snapshotPayload(program, ai, sources)
  push(createChange({
    id: 'discover-dossier', target: 'dossier.discover', category: 'research',
    before: (application?.dossierCards || []).some((card) => card.id === `discover-research-${program.id}`) ? 'Existing Discover research snapshot' : '',
    after: 'Program fit, funding, requirements, outcomes and official sources', source,
    confidence, sources, forceMode: 'create',
  }))
  if (program.stipendLocal) {
    push(createChange({
      id: 'discover-funding', target: 'scholarship.discover', category: 'funding',
      before: (application?.scholarships || []).some((item) => item.id === `discover-stipend-${program.id}`) ? 'Existing stipend snapshot' : '',
      after: clean(program.stipendLocal, 500), source, confidence: program.stipendConfidence || confidence,
      sources, forceMode: 'create',
    }))
  }
  if (!(application?.timeline || []).some((item) => item.id === `discover-enriched-${program.id}`)) {
    push(createChange({
      id: 'discover-timeline', target: 'timeline.discover', category: 'workflow',
      after: 'Research snapshot added from Discover', source, confidence, sources, forceMode: 'create',
    }))
  }

  return {
    applicationId: clean(application?.id, 100),
    generatedAt,
    usedAi: Boolean(ai),
    matchedProgram: matched ? {
      id: clean(program.id, 80),
      school: clean(program.school, 240),
      program: clean(program.program, 240),
      matchScore: score,
    } : null,
    changes,
    caveats: uniqueStrings([
      'Discover data is a research snapshot, not a live guarantee. Verify deadlines, funding and recruiting status on official pages.',
      ...(ai?.caveats || []),
      ...(!matched ? ['No current Discover catalog match was found; this preview is based on the application links and live official-source research only.'] : []),
      ...(score < 60 ? ['The catalog match is uncertain. Review the matched school and program before applying changes.'] : []),
    ], 10),
    payload: { snapshot, tags: mergedTags },
  }
}

function dossierCardFrom(snapshot, now) {
  const field = (id, label, value, type = 'textarea') => ({ id, label, value: clean(value, 4000), type, width: 'full' })
  return {
    id: `discover-research-${clean(snapshot.programId, 80)}`,
    title: 'Discover research snapshot',
    icon: 'sparkles',
    color: '#0071e3',
    width: 'full',
    fields: [
      field('research', 'Research focus', snapshot.research),
      field('fit', 'Why it may fit', snapshot.fit),
      field('funding', 'Funding snapshot', snapshot.funding),
      field('requirements', 'Application requirements', snapshot.requirements),
      field('outcomes', 'Career outcomes', snapshot.outcomes),
      field('international', 'International applicant notes', snapshot.international),
      field('tuition', 'Tuition', snapshot.tuition),
      field('rankings', 'QS / THE rankings', snapshot.rankings),
      field('scholarships', 'Profile-matched scholarships', snapshot.scholarships),
      field('sources', 'Official sources to verify', uniqueStrings(snapshot.sources, 12).join('\n'), 'textarea'),
    ].filter((item) => item.value),
    createdAt: now,
    updatedAt: now,
  }
}

export function applyApplicationEnrichmentProposal(application, proposal, acceptedChangeIds) {
  const accepted = new Set(Array.isArray(acceptedChangeIds) ? acceptedChangeIds : [])
  const changes = new Map((Array.isArray(proposal?.changes) ? proposal.changes : []).map((change) => [change.id, change]))
  const next = structuredClone(application)
  const now = new Date().toISOString()
  const applyText = (id, setter) => {
    const change = changes.get(id)
    if (accepted.has(id) && change?.after) setter(clean(change.after))
  }

  next.professor = { ...(next.professor || {}) }
  next.school = { ...(next.school || {}) }
  applyText('school-website', (value) => { next.school.website = value })
  applyText('application-deadline', (value) => { next.deadline = value })
  applyText('advisor-name', (value) => { next.professor.english = value })
  applyText('advisor-email', (value) => { next.professor.email = value })
  applyText('advisor-homepage', (value) => { next.professor.homepage = value })
  applyText('advisor-research', (value) => { next.professor.research = value })

  if (accepted.has('research-tags') && changes.has('research-tags')) {
    next.tags = uniqueStrings(proposal?.payload?.tags || changes.get('research-tags').after.split(','), 12)
  }

  const snapshot = proposal?.payload?.snapshot && typeof proposal.payload.snapshot === 'object'
    ? proposal.payload.snapshot
    : null
  if (accepted.has('discover-dossier') && changes.has('discover-dossier') && snapshot?.programId) {
    const card = dossierCardFrom(snapshot, now)
    const cards = Array.isArray(next.dossierCards) ? [...next.dossierCards] : []
    const index = cards.findIndex((item) => item.id === card.id)
    if (index >= 0) card.createdAt = cards[index].createdAt || now
    if (index >= 0) cards[index] = card
    else cards.push(card)
    next.dossierCards = cards
  }

  if (accepted.has('discover-funding') && changes.has('discover-funding') && snapshot?.programId) {
    const id = `discover-stipend-${clean(snapshot.programId, 80)}`
    const scholarship = {
      id,
      name: 'Program stipend (Discover snapshot)',
      amount: changes.get('discover-funding').after,
      startDate: now.slice(0, 10),
      endDate: clean(snapshot.deadline, 40) || next.deadline,
      school: clean(snapshot.school, 240),
      issuer: clean(snapshot.school, 240),
      status: 'Draft',
      notes: `${clean(snapshot.funding, 3000)}\nVerify with the official sources in the Discover research card.`.trim(),
      materials: [], tasks: [], timeline: [],
    }
    const scholarships = Array.isArray(next.scholarships) ? [...next.scholarships] : []
    const index = scholarships.findIndex((item) => item.id === id)
    if (index >= 0) scholarships[index] = scholarship
    else scholarships.push(scholarship)
    next.scholarships = scholarships
  }

  if (accepted.has('discover-timeline') && changes.has('discover-timeline') && snapshot?.programId) {
    const id = `discover-enriched-${clean(snapshot.programId, 80)}`
    if (!(next.timeline || []).some((item) => item.id === id)) {
      next.timeline = [{
        id,
        title: 'Enriched from Discover',
        date: now.slice(0, 10),
        note: `${clean(snapshot.school, 240)} · ${clean(snapshot.program, 240)} · research snapshot`,
      }, ...(next.timeline || [])]
    }
  }
  next.updatedAt = now
  return next
}
