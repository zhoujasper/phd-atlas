import { buildApplicantResearchProfile } from './discover-agent-plan.js'
import { DISCOVER_SOURCE_REGISTRY } from './discover-source-registry.js'

const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max)

export const APPLICATION_ENRICHMENT_PROTOCOL_VERSION = 'profile-grounded-deep-research-v2'

const AI_PURPOSES = Object.freeze([
  'program',
  'requirements',
  'funding',
  'advisor',
  'scholarship',
  'timeline',
])

export const AI_APPLICATION_ENRICHMENT_PLAN_SCHEMA = Object.freeze({
  name: 'discover_application_enrichment_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      searchQueries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            purpose: { type: 'string', enum: AI_PURPOSES },
          },
          required: ['query', 'purpose'],
        },
      },
      candidateUrls: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string' },
            purpose: { type: 'string', enum: AI_PURPOSES },
            reason: { type: 'string' },
          },
          required: ['url', 'purpose', 'reason'],
        },
      },
      missingEvidence: { type: 'array', items: { type: 'string' } },
    },
    required: ['searchQueries', 'candidateUrls', 'missingEvidence'],
  },
})

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
      applicationDeadline: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['date', 'source'],
      },
      applicationFee: {
        type: 'object',
        additionalProperties: false,
        properties: {
          amount: { type: 'number' },
          currency: { type: 'string' },
          waiverNotes: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['amount', 'currency', 'waiverNotes', 'source'],
      },
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
      checklist: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            details: { type: 'string' },
            due: { type: 'string' },
            source: { type: 'string' },
          },
          required: ['title', 'details', 'due', 'source'],
        },
      },
      scholarships: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            amount: { type: 'string' },
            deadline: { type: 'string' },
            eligibility: { type: 'string' },
            source: { type: 'string' },
          },
          required: ['name', 'amount', 'deadline', 'eligibility', 'source'],
        },
      },
      timeline: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            date: { type: 'string' },
            note: { type: 'string' },
            source: { type: 'string' },
          },
          required: ['title', 'date', 'note', 'source'],
        },
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
          deadline: { type: 'string' },
          fee: { type: 'string' },
        },
        required: ['research', 'requirements', 'funding', 'advisor', 'deadline', 'fee'],
      },
    },
    required: [
      'researchSummary',
      'fitRationale',
      'requirementsSummary',
      'fundingSummary',
      'applicationDeadline',
      'applicationFee',
      'suggestedAdvisor',
      'checklist',
      'scholarships',
      'timeline',
      'caveats',
      'sources',
      'factSources',
    ],
  },
})

function publicHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    const host = url.hostname.toLowerCase()
    const privateIpv4 = /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(host)
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || (url.port && url.port !== '443')
      || !host
      || host === 'localhost'
      || host.endsWith('.local')
      || privateIpv4
      || host === '::1'
    ) return null
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
  return [...text.matchAll(/https:\/\/[^\s<>"')\]]+/gi)]
    .map((match) => publicHttpsUrl(match[0]))
    .filter(Boolean)
}

function collectHttpsUrls(value, output, depth = 0, max = 96) {
  if (depth > 7 || output.length >= max || value === null || value === undefined) return
  if (typeof value === 'string') {
    output.push(...urlsInText(value).slice(0, max - output.length))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHttpsUrls(item, output, depth + 1, max)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectHttpsUrls(item, output, depth + 1, max)
  }
}

function uniqueStrings(values, max = 24, itemMax = 500) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value, itemMax))
    .filter(Boolean))).slice(0, max)
}

function boundedList(values, max, mapper) {
  return (Array.isArray(values) ? values : []).slice(0, max).map(mapper)
}

function compactDossierCards(cards) {
  return boundedList(cards, 24, (card) => ({
    title: clean(card?.title, 120),
    fields: boundedList(card?.fields, 24, (field) => ({
      label: clean(field?.label, 100),
      type: clean(field?.type, 24),
      value: clean(field?.value, 4000),
    })),
  }))
}

function compactMaterials(materials) {
  return boundedList(materials, 80, (material) => ({
    name: clean(material?.name, 240),
    type: clean(material?.type, 80),
    status: clean(material?.status, 80),
    group: clean(material?.group, 100),
    details: clean(material?.details, 2000),
    reminderDate: clean(material?.reminderDate, 40),
    requiredCount: Math.max(1, Math.min(12, Number(material?.requiredCount) || 1)),
    recommenderSlots: Array.isArray(material?.recommenders) ? Math.min(12, material.recommenders.length) : 0,
    filePresent: Boolean(material?.fileId || material?.versions?.length),
  }))
}

function compactTasks(tasks) {
  return boundedList(tasks, 80, (task) => ({
    title: clean(task?.title, 240),
    due: clean(task?.due, 40),
    done: Boolean(task?.done),
    details: clean(task?.details, 2000),
    reminderEnabled: Boolean(task?.reminderEnabled),
    attachmentRequired: Boolean(task?.attachmentRequired),
  }))
}

function compactScholarships(scholarships) {
  return boundedList(scholarships, 40, (scholarship) => ({
    name: clean(scholarship?.name, 240),
    amount: clean(scholarship?.amount, 500),
    startDate: clean(scholarship?.startDate, 40),
    endDate: clean(scholarship?.endDate, 40),
    school: clean(scholarship?.school, 240),
    issuer: clean(scholarship?.issuer, 240),
    status: clean(scholarship?.status, 80),
    notes: clean(scholarship?.notes, 2400),
    materials: boundedList(scholarship?.materials, 30, (item) => ({
      name: clean(item?.name, 240),
      status: clean(item?.status, 80),
      due: clean(item?.due, 40),
      details: clean(item?.details, 1200),
    })),
    tasks: compactTasks(scholarship?.tasks).slice(0, 30),
    timeline: boundedList(scholarship?.timeline, 30, (item) => ({
      title: clean(item?.title, 240),
      date: clean(item?.date, 40),
      note: clean(item?.note, 1200),
    })),
  }))
}

function compactTimeline(timeline) {
  return boundedList(timeline, 100, (item) => ({
    title: clean(item?.title, 240),
    date: clean(item?.date, 40),
    note: clean(item?.note, 2000),
  }))
}

function linkSurface(path) {
  const root = String(path?.[0] || '')
  if (root === 'checklist' || root === 'tasks') return 'checklist'
  if (root === 'funding') return 'funding'
  if (root === 'timeline') return 'timeline'
  if (root === 'applicantProfile') return 'profile'
  return 'dossier'
}

function collectLinkInventory(value, path = [], output = [], seen = new Set(), depth = 0) {
  if (depth > 8 || output.length >= 96 || value === null || value === undefined) return output
  if (typeof value === 'string') {
    for (const url of urlsInText(value)) {
      const canonical = canonicalUrl(url)
      if (!canonical || seen.has(canonical)) continue
      seen.add(canonical)
      output.push({
        url,
        surface: linkSurface(path),
        field: path.map((part) => String(part)).join('.').slice(0, 240),
      })
      if (output.length >= 96) break
    }
    return output
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectLinkInventory(value[index], [...path, index], output, seen, depth + 1)
    }
    return output
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectLinkInventory(item, [...path, key], output, seen, depth + 1)
    }
  }
  return output
}

/**
 * Build the bounded, explicit data contract for one enrichment run. File
 * bytes/storage identifiers, correspondence, reviews, shares and audit data
 * are intentionally excluded. The profile helper also strips identity and
 * writing-style fields that do not improve application research.
 */
export function buildApplicationEnrichmentContext(application, applicantProfile = null) {
  const context = {
    dossier: {
      school: {
        name: clean(application?.school?.name, 240),
        country: clean(application?.school?.country, 120),
        website: clean(application?.school?.website, 500),
      },
      program: clean(application?.program, 240),
      deadline: clean(application?.deadline, 40),
      status: clean(application?.status, 80),
      priority: Number(application?.priority) || 0,
      tags: uniqueStrings(application?.tags, 30, 100),
      nextReminder: clean(application?.nextReminder, 40),
      result: clean(application?.result, 2400),
      notes: clean(application?.notes, 2400),
      links: boundedList(application?.links, 40, (item) => clean(item, 500)),
      professor: {
        name: clean(application?.professor?.english, 180),
        alternateName: clean(application?.professor?.chinese, 180),
        email: clean(application?.professor?.email, 240),
        additionalEmails: uniqueStrings(application?.professor?.correspondenceEmails, 9, 254),
        phone: clean(application?.professor?.phone, 80),
        social: clean(application?.professor?.social, 500),
        homepage: clean(application?.professor?.homepage, 500),
        research: clean(application?.professor?.research, 2400),
        lab: clean(application?.professor?.lab, 1000),
        labUrl: clean(application?.professor?.labUrl, 500),
        projectUrl: clean(application?.professor?.projectUrl, 500),
      },
      customCards: compactDossierCards(application?.dossierCards),
    },
    checklist: compactMaterials(application?.materials),
    tasks: compactTasks(application?.tasks),
    funding: {
      fees: boundedList(application?.fees, 30, (fee) => ({
        amount: Number(fee?.amount) || 0,
        currency: clean(fee?.currency, 10),
        paidDate: clean(fee?.paidDate, 40),
        waived: Boolean(fee?.waived),
        notes: clean(fee?.notes, 1000),
      })),
      scholarships: compactScholarships(application?.scholarships),
    },
    timeline: compactTimeline(application?.timeline),
    applicantProfile: buildApplicantResearchProfile(applicantProfile),
  }
  return {
    protocolVersion: APPLICATION_ENRICHMENT_PROTOCOL_VERSION,
    ...context,
    linkInventory: collectLinkInventory(context),
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

function seedKindForSurface(surface) {
  if (surface === 'funding') return 'funding'
  if (surface === 'timeline' || surface === 'checklist') return 'doctoral'
  return 'application'
}

function groupedReferenceSources(linkInventory, alreadyDeclared) {
  const grouped = new Map()
  for (const link of Array.isArray(linkInventory) ? linkInventory : []) {
    const url = publicHttpsUrl(link?.url)
    const canonical = canonicalUrl(url)
    if (!url || !canonical || alreadyDeclared.has(canonical)) continue
    const host = normalizedStaticHost(new URL(url).hostname)
    if (!grouped.has(host)) grouped.set(host, [])
    grouped.get(host).push({
      kind: seedKindForSurface(link.surface),
      url,
      untrusted: true,
      sourceSurface: clean(link.surface, 30),
    })
  }
  return [...grouped.entries()].slice(0, 32).map(([host, seeds]) => ({
    school: 'Application reference',
    region: 'APPLICATION',
    url: seeds[0].url,
    allowedHosts: [host],
    seeds: seeds.slice(0, 32),
    pathHints: [],
    evidenceTier: 'application-reference',
    crawlPolicy: {
      followSitemaps: false,
      maxPages: Math.min(32, Math.max(1, seeds.length)),
    },
  }))
}

/**
 * Exact catalogue/adaptor seeds remain the authoritative research root. Every
 * public HTTPS link explicitly present on the four application surfaces is
 * also returned in an isolated reference source: it is visited, but it never
 * becomes proof merely because the user or a page supplied it.
 */
export function extractApplicationResearchSources(application, program = null, suppliedLinkInventory = null) {
  const linkInventory = Array.isArray(suppliedLinkInventory)
    ? suppliedLinkInventory
    : buildApplicationEnrichmentContext(application).linkInventory
  const verifiedSource = resolveVerifiedApplicationSchoolSource(application, program)
  const declared = new Set()
  const sources = []
  if (verifiedSource) {
    const typedSeeds = []
    const pushTyped = (value, kind) => {
      const urls = []
      collectHttpsUrls(value, urls, 0, 64)
      for (const candidate of urls) {
        const url = sourceAllowsStaticUrl(candidate, verifiedSource)
        const canonical = canonicalUrl(url)
        if (!url || !canonical || declared.has(canonical)) continue
        declared.add(canonical)
        typedSeeds.push({ kind, url, untrusted: true })
      }
    }
    pushTyped({
      programWebsite: program?.website,
      programSources: program?.sources,
      requirementsSource: program?.factSources?.applicationRoute,
      deadlineSource: program?.factSources?.deadline,
    }, 'doctoral')
    pushTyped({ advisors: (program?.pis || []).map((pi) => [pi?.url, pi?.homepage]) }, 'faculty')
    pushTyped({
      fundingSource: program?.factSources?.funding,
      researchSource: program?.factSources?.research,
      scholarships: program?.scholarships,
    }, 'research')
    for (const link of linkInventory) pushTyped(link?.url, seedKindForSurface(link?.surface))
    for (const seed of verifiedSource.seeds || []) {
      const canonical = canonicalUrl(seed?.url)
      if (canonical) declared.add(canonical)
    }
    sources.push({
      school: verifiedSource.school,
      region: verifiedSource.region,
      url: verifiedSource.url,
      allowedHosts: [...verifiedSource.allowedHosts],
      seeds: [...typedSeeds.slice(0, 24), ...verifiedSource.seeds],
      pathHints: verifiedSource.pathHints,
      adapterVerifiedAt: verifiedSource.adapterVerifiedAt,
      evidenceTier: 'verified-school',
      crawlPolicy: {
        ...(verifiedSource.crawlPolicy || {}),
        maxPages: 24,
      },
    })
  }
  return [...sources, ...groupedReferenceSources(linkInventory, declared)]
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

export function applicationEnrichmentAllowedDomains(sources) {
  return uniqueStrings([
    ...(Array.isArray(sources) ? sources : []).flatMap((source) => [
      ...(source?.allowedHosts || []),
      hostname(source?.url),
    ]),
    ...TRUSTED_ENRICHMENT_EVIDENCE_DOMAINS,
  ], 100, 253).map(normalizedStaticHost).filter(Boolean)
}

function purposeSeedKind(purpose) {
  if (purpose === 'advisor') return 'faculty'
  if (purpose === 'funding' || purpose === 'scholarship') return 'funding'
  if (purpose === 'requirements' || purpose === 'timeline') return 'doctoral'
  return 'research'
}

export function parseAiApplicationEnrichmentPlan(text) {
  try {
    const parsed = JSON.parse(clean(text, 30_000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''))
    const purpose = (value) => AI_PURPOSES.includes(value) ? value : 'program'
    return {
      searchQueries: boundedList(parsed?.searchQueries, 18, (item) => ({
        query: clean(item?.query, 500),
        purpose: purpose(item?.purpose),
      })).filter((item) => item.query),
      candidateUrls: boundedList(parsed?.candidateUrls, 32, (item) => ({
        url: clean(item?.url, 500),
        purpose: purpose(item?.purpose),
        reason: clean(item?.reason, 500),
      })).filter((item) => item.url),
      missingEvidence: uniqueStrings(parsed?.missingEvidence, 16, 500),
    }
  } catch {
    return null
  }
}

export function extractPlannedApplicationResearchSources(plan, allowedDomains) {
  const roots = (Array.isArray(allowedDomains) ? allowedDomains : []).map(normalizedStaticHost).filter(Boolean)
  const grouped = new Map()
  for (const candidate of Array.isArray(plan?.candidateUrls) ? plan.candidateUrls : []) {
    const url = publicHttpsUrl(candidate?.url)
    if (!url) continue
    const host = normalizedStaticHost(new URL(url).hostname)
    if (!roots.some((root) => domainWithin(host, root))) continue
    if (!grouped.has(host)) grouped.set(host, [])
    grouped.get(host).push({
      kind: purposeSeedKind(candidate?.purpose),
      url,
      untrusted: true,
    })
  }
  return [...grouped.entries()].slice(0, 24).map(([host, seeds]) => ({
    school: 'Planned evidence',
    region: 'PLANNED',
    url: seeds[0].url,
    allowedHosts: [host],
    seeds: seeds.slice(0, 32),
    pathHints: [],
    evidenceTier: 'planned-candidate',
    crawlPolicy: {
      followSitemaps: false,
      maxPages: Math.min(32, Math.max(1, seeds.length)),
    },
  }))
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
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function matchScore(application, program) {
  const school = similarity(application?.school?.name, program?.school)
  const degree = similarity(application?.program, program?.program)
  const appHost = hostname(application?.school?.website)
  const programHost = hostname(program?.website)
  const host = appHost && programHost && (
    appHost === programHost
    || appHost.endsWith(`.${programHost}`)
    || programHost.endsWith(`.${appHost}`)
  ) ? 1 : 0
  return Math.round((school * 0.68 + degree * 0.27 + host * 0.05) * 100)
}

export function findBestDiscoverProgram(application, programs) {
  const candidates = (Array.isArray(programs) ? programs : [])
    .map((program) => ({ program, score: matchScore(application, program) }))
    .sort((a, b) => b.score - a.score)
  return candidates[0]?.score >= 32 ? candidates[0] : null
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

function isoDate(value) {
  const date = clean(value, 40)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ? '' : date
}

function emailAddress(value) {
  const email = clean(value, 240)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function safeAi(ai) {
  if (!ai || typeof ai !== 'object') return null
  const advisor = ai.suggestedAdvisor && typeof ai.suggestedAdvisor === 'object'
      ? {
        name: clean(ai.suggestedAdvisor.name, 180),
        email: emailAddress(ai.suggestedAdvisor.email),
        homepage: clean(ai.suggestedAdvisor.homepage, 500),
        research: clean(ai.suggestedAdvisor.research, 1200),
      }
    : null
  const feeAmount = Number(ai.applicationFee?.amount)
  return {
    researchSummary: clean(ai.researchSummary, 1600),
    fitRationale: clean(ai.fitRationale, 1600),
    requirementsSummary: clean(ai.requirementsSummary, 1600),
    fundingSummary: clean(ai.fundingSummary, 1600),
    applicationDeadline: {
      date: isoDate(ai.applicationDeadline?.date),
      source: clean(ai.applicationDeadline?.source, 500),
    },
    applicationFee: {
      amount: Number.isFinite(feeAmount) && feeAmount > 0 && feeAmount <= 10_000 ? feeAmount : 0,
      currency: clean(ai.applicationFee?.currency, 10).toUpperCase(),
      waiverNotes: clean(ai.applicationFee?.waiverNotes, 1000),
      source: clean(ai.applicationFee?.source, 500),
    },
    checklist: boundedList(ai.checklist, 16, (item) => ({
      title: clean(item?.title, 240),
      details: clean(item?.details, 1600),
      due: isoDate(item?.due),
      source: clean(item?.source, 500),
    })).filter((item) => item.title),
    scholarships: boundedList(ai.scholarships, 12, (item) => ({
      name: clean(item?.name, 240),
      amount: clean(item?.amount, 500),
      deadline: isoDate(item?.deadline),
      eligibility: clean(item?.eligibility, 1600),
      source: clean(item?.source, 500),
    })).filter((item) => item.name),
    timeline: boundedList(ai.timeline, 16, (item) => ({
      title: clean(item?.title, 240),
      date: isoDate(item?.date),
      note: clean(item?.note, 1600),
      source: clean(item?.source, 500),
    })).filter((item) => item.title && item.date),
    caveats: uniqueStrings(ai.caveats, 10, 1000),
    sources: uniqueStrings(ai.sources, 24),
    fetchedSources: uniqueStrings(ai.fetchedSources, 120),
    factSources: Object.fromEntries(
      ['research', 'requirements', 'funding', 'advisor', 'deadline', 'fee'].map((key) => [
        key,
        clean(ai.factSources?.[key], 500),
      ]),
    ),
    suggestedAdvisor: advisor?.name ? advisor : null,
    researchAudit: ai.researchAudit && typeof ai.researchAudit === 'object'
      ? {
          suppliedLinkCount: Math.max(0, Number(ai.researchAudit.suppliedLinkCount) || 0),
          fetchedPageCount: Math.max(0, Number(ai.researchAudit.fetchedPageCount) || 0),
          quarantinedPageCount: Math.max(0, Number(ai.researchAudit.quarantinedPageCount) || 0),
          plannedQueryCount: Math.max(0, Number(ai.researchAudit.plannedQueryCount) || 0),
          candidateUrlCount: Math.max(0, Number(ai.researchAudit.candidateUrlCount) || 0),
          sourceCount: Math.max(0, Number(ai.researchAudit.sourceCount) || 0),
          webSearchUsed: Boolean(ai.researchAudit.webSearchUsed),
          durationMs: Object.fromEntries(
            ['contextAndPlan', 'candidateCrawl', 'verification', 'total'].map((key) => [
              key,
              Math.max(0, Math.min(900_000, Number(ai.researchAudit.durationMs?.[key]) || 0)),
            ]),
          ),
        }
      : null,
  }
}

function canonicalUrl(value) {
  const url = publicHttpsUrl(value)
  return url ? url.replace(/\/$/, '') : ''
}

function evidenceSourceAllowed(ai, application, program, value) {
  const source = canonicalUrl(value)
  if (!source) return false
  const fetched = new Set((ai?.fetchedSources || []).map(canonicalUrl).filter(Boolean))
  if (!fetched.has(source)) return false
  const verifiedSource = resolveVerifiedApplicationSchoolSource(application, program)
  const host = hostname(source)
  return Boolean(
    sourceAllowsStaticUrl(source, verifiedSource)
    || [...TRUSTED_ENRICHMENT_EVIDENCE_DOMAINS].some((root) => domainWithin(host, root)),
  )
}

function factSourceAllowed(ai, application, program, key) {
  return evidenceSourceAllowed(ai, application, program, ai?.factSources?.[key])
}

function factSourceMatches(ai, application, program, key, itemSource) {
  return factSourceAllowed(ai, application, program, key)
    && canonicalUrl(ai?.factSources?.[key]) === canonicalUrl(itemSource)
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
    const parsed = JSON.parse(clean(text, 80_000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''))
    return safeAi(parsed)
  } catch {
    return null
  }
}

function verifiedEnrichmentSources(application, program, ai) {
  const verifiedSource = resolveVerifiedApplicationSchoolSource(application, program)
  if (!verifiedSource) return []
  const allowed = (value) => {
    const url = publicHttpsUrl(value)
    if (!url) return null
    const host = hostname(url)
    return sourceAllowsStaticUrl(url, verifiedSource)
      || ([...TRUSTED_ENRICHMENT_EVIDENCE_DOMAINS].some((root) => domainWithin(host, root)) ? url : null)
  }
  return uniqueStrings([
    program?.website,
    ...(program?.sources || []),
    ...(program?.rankingSources || []),
  ], 40).map(allowed).filter(Boolean)
    .concat((ai?.sources || []).filter((url) => evidenceSourceAllowed(ai, application, program, url)))
    .filter(Boolean)
    .slice(0, 12)
}

function requirementSummary(program, ai) {
  if (ai?.requirementsSummary) return ai.requirementsSummary
  return [
    program?.deadlineAndTests,
    program?.applicationRestrictions,
    program?.applicationRoute,
  ].map((value) => clean(value, 800)).filter(Boolean).join('\n')
}

function fundingSummary(program, ai) {
  if (ai?.fundingSummary) return ai.fundingSummary
  return [program?.stipendLocal, program?.stipendBasis, program?.stipendNotes]
    .map((value) => clean(value, 800)).filter(Boolean).join('\n')
}

function snapshotPayload(program, ai, sources) {
  return {
    programId: clean(program?.id, 80),
    school: clean(program?.school, 240),
    program: clean(program?.program, 240),
    website: clean(program?.website, 500),
    deadline: clean(program?.deadlineIso, 40),
    research: ai?.researchSummary || clean(program?.researchFocus, 1600),
    fit: ai?.fitRationale || clean(program?.fitRationale, 1600),
    funding: fundingSummary(program, ai),
    requirements: requirementSummary(program, ai),
    outcomes: clean(program?.careerOutcomes, 1200),
    international: clean(program?.intlNotes, 1200),
    tuition: clean(program?.tuitionLocal, 500),
    rankings: [
      program?.qsWorldRank ? `QS world #${program.qsWorldRank}` : '',
      program?.qsSubjectRank ? `QS ${clean(program.qsSubjectName, 160)} #${program.qsSubjectRank}` : '',
      program?.theWorldRank ? `THE world #${program.theWorldRank}` : '',
      program?.theSubjectRank ? `THE ${clean(program.theSubjectName, 160)} #${program.theSubjectRank}` : '',
    ].filter(Boolean).join(' · '),
    scholarships: (program?.scholarships || [])
      .map((item) => `${clean(item.name, 240)} · ${clean(item.amount, 200)} · ${clean(item.url, 500)}`)
      .join('\n'),
    sources,
  }
}

function stableToken(value) {
  const input = String(value || '')
  let hash = 2_166_136_261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36)
}

function normalizedTitle(value) {
  return clean(value, 300).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim()
}

function researchMetadata(ai) {
  const audit = ai?.researchAudit || {}
  return {
    protocolVersion: APPLICATION_ENRICHMENT_PROTOCOL_VERSION,
    stages: ['context', 'link-audit', 'search-plan', 'crawl', 'independent-verification'],
    suppliedLinkCount: Math.max(0, Number(audit.suppliedLinkCount) || 0),
    fetchedPageCount: Math.max(0, Number(audit.fetchedPageCount) || 0),
    quarantinedPageCount: Math.max(0, Number(audit.quarantinedPageCount) || 0),
    plannedQueryCount: Math.max(0, Number(audit.plannedQueryCount) || 0),
    candidateUrlCount: Math.max(0, Number(audit.candidateUrlCount) || 0),
    sourceCount: Math.max(0, Number(audit.sourceCount) || 0),
    webSearchUsed: Boolean(audit.webSearchUsed),
    durationMs: Object.fromEntries(
      ['contextAndPlan', 'candidateCrawl', 'verification', 'total'].map((key) => [
        key,
        Math.max(0, Math.min(900_000, Number(audit.durationMs?.[key]) || 0)),
      ]),
    ),
  }
}

export function buildApplicationEnrichmentProposal(application, programs, aiInput = null) {
  const candidateMatch = findBestDiscoverProgram(application, programs)
  const matched = candidateMatch && resolveVerifiedApplicationSchoolSource(application, candidateMatch.program)
    ? candidateMatch
    : null
  const rawAi = safeAi(aiInput)
  const generatedAt = new Date().toISOString()
  const program = matched?.program || null
  const research = researchMetadata(rawAi)
  if (!program) {
    return {
      applicationId: clean(application?.id, 100),
      applicationUpdatedAt: clean(application?.updatedAt, 40),
      generatedAt,
      usedAi: Boolean(rawAi),
      matchedProgram: null,
      changes: [],
      caveats: uniqueStrings([
        'No exact verified school adapter and close Discover program match were available, so researched pages were not promoted into application facts.',
        ...(rawAi?.caveats || []),
      ], 10, 1000),
      research,
      payload: {},
    }
  }

  const score = matched.score
  const sources = verifiedEnrichmentSources(application, program, rawAi)
  const ai = rawAi ? {
    ...rawAi,
    researchSummary: factSourceAllowed(rawAi, application, program, 'research') ? rawAi.researchSummary : '',
    fitRationale: factSourceAllowed(rawAi, application, program, 'research') ? rawAi.fitRationale : '',
    requirementsSummary: factSourceAllowed(rawAi, application, program, 'requirements') ? rawAi.requirementsSummary : '',
    fundingSummary: factSourceAllowed(rawAi, application, program, 'funding') ? rawAi.fundingSummary : '',
    applicationDeadline: factSourceMatches(
      rawAi,
      application,
      program,
      'deadline',
      rawAi.applicationDeadline?.source,
    )
      ? rawAi.applicationDeadline
      : { date: '', source: '' },
    applicationFee: factSourceMatches(
      rawAi,
      application,
      program,
      'fee',
      rawAi.applicationFee?.source,
    )
      ? rawAi.applicationFee
      : { amount: 0, currency: '', waiverNotes: '', source: '' },
    suggestedAdvisor: factSourceMatches(
      rawAi,
      application,
      program,
      'advisor',
      rawAi.suggestedAdvisor?.homepage,
    )
      && advisorUrlNamesPerson(rawAi.suggestedAdvisor)
      ? rawAi.suggestedAdvisor
      : null,
    checklist: rawAi.checklist.filter((item) => evidenceSourceAllowed(rawAi, application, program, item.source)),
    scholarships: rawAi.scholarships.filter((item) => evidenceSourceAllowed(rawAi, application, program, item.source)),
    timeline: rawAi.timeline.filter((item) => evidenceSourceAllowed(rawAi, application, program, item.source)),
  } : null
  const source = ai ? 'catalog_ai' : 'catalog'
  const confidence = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'
  const changes = []
  const push = (change) => {
    if (change && changes.length < 48) changes.push(change)
  }

  push(createChange({
    id: 'school-website',
    target: 'school.website',
    category: 'identity',
    before: application?.school?.website,
    after: program.website,
    confidence,
    sources,
  }))
  push(createChange({
    id: 'application-deadline',
    target: 'deadline',
    category: 'requirements',
    before: application?.deadline,
    after: ai?.applicationDeadline?.date || program.deadlineIso,
    source,
    confidence,
    sources,
  }))

  const matchedAiAdvisor = ai?.suggestedAdvisor
    ? (program.pis || []).find((candidate) => (
        similarity(candidate.name, ai.suggestedAdvisor.name) >= 0.75
        || (
          candidate.email
          && clean(candidate.email).toLowerCase() === clean(ai.suggestedAdvisor.email).toLowerCase()
        )
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
      id: 'advisor-name',
      target: 'professor.english',
      category: 'advisor',
      before: application?.professor?.english,
      after: advisor.name,
      source: advisorSource,
      confidence: aiAdvisor ? 'medium' : confidence,
      sources,
    }))
    push(createChange({
      id: 'advisor-email',
      target: 'professor.email',
      category: 'advisor',
      before: application?.professor?.email,
      after: advisor.email,
      source: advisorSource,
      confidence: advisor.email ? confidence : 'unknown',
      sources,
    }))
    push(createChange({
      id: 'advisor-homepage',
      target: 'professor.homepage',
      category: 'advisor',
      before: application?.professor?.homepage,
      after: advisor.homepage || advisor.url,
      source: advisorSource,
      confidence,
      sources,
    }))
    push(createChange({
      id: 'advisor-research',
      target: 'professor.research',
      category: 'research',
      before: application?.professor?.research,
      after: advisor.research || ai?.researchSummary,
      source,
      confidence,
      sources,
    }))
  }

  const mergedTags = uniqueStrings([...(application?.tags || []), ...(program.tags || []), 'discover-enriched'], 12, 80)
  if (mergedTags.join('\n') !== uniqueStrings(application?.tags || [], 12, 80).join('\n')) {
    push(createChange({
      id: 'research-tags',
      target: 'tags',
      category: 'research',
      before: (application?.tags || []).join(', '),
      after: mergedTags.join(', '),
      source,
      confidence,
      sources,
      forceMode: 'merge',
    }))
  }

  const snapshot = snapshotPayload(program, ai, sources)
  push(createChange({
    id: 'discover-dossier',
    target: 'dossier.discover',
    category: 'research',
    before: (application?.dossierCards || []).some((card) => card.id === `discover-research-${program.id}`)
      ? 'Existing Discover research snapshot'
      : '',
    after: 'Program fit, funding, requirements, outcomes and verified sources',
    source,
    confidence,
    sources,
    forceMode: 'create',
  }))

  if (program.stipendLocal) {
    push(createChange({
      id: 'discover-funding',
      target: 'scholarship.discover',
      category: 'funding',
      before: (application?.scholarships || []).some((item) => item.id === `discover-stipend-${program.id}`)
        ? 'Existing stipend snapshot'
        : '',
      after: clean(program.stipendLocal, 500),
      source,
      confidence: program.stipendConfidence || confidence,
      sources,
      forceMode: 'create',
    }))
  }

  const existingMaterialTitles = new Set((application?.materials || []).map((item) => normalizedTitle(item?.name)))
  const checklistSuggestions = (ai?.checklist || []).flatMap((item) => {
    const title = normalizedTitle(item.title)
    if (!title || existingMaterialTitles.has(title)) return []
    existingMaterialTitles.add(title)
    const changeId = `ai-checklist-${stableToken(`${item.title}|${item.source}`)}`.slice(0, 80)
    push(createChange({
      id: changeId,
      target: 'materials.ai',
      category: 'requirements',
      after: item.due ? `${item.title} · ${item.due}` : item.title,
      source: 'ai',
      confidence: 'medium',
      sources: [item.source],
      forceMode: 'create',
    }))
    return [{ changeId, ...item }]
  })

  const feeSuggestion = ai?.applicationFee?.amount > 0 && ai.applicationFee.currency
    && !(application?.fees || []).some((fee) => (
      Number(fee?.amount) === ai.applicationFee.amount
      && clean(fee?.currency, 10).toUpperCase() === ai.applicationFee.currency
    ))
    ? {
        changeId: `ai-fee-${stableToken(`${ai.applicationFee.amount}|${ai.applicationFee.currency}|${ai.applicationFee.source}`)}`,
        ...ai.applicationFee,
      }
    : null
  if (feeSuggestion) {
    push(createChange({
      id: feeSuggestion.changeId,
      target: 'fee.ai',
      category: 'funding',
      after: `${feeSuggestion.currency} ${feeSuggestion.amount}${feeSuggestion.waiverNotes ? ` · ${feeSuggestion.waiverNotes}` : ''}`,
      source: 'ai',
      confidence: 'medium',
      sources: [feeSuggestion.source],
      forceMode: 'create',
    }))
  }

  const existingScholarshipTitles = new Set((application?.scholarships || []).map((item) => normalizedTitle(item?.name)))
  const scholarshipSuggestions = (ai?.scholarships || []).flatMap((item) => {
    const title = normalizedTitle(item.name)
    if (!title || existingScholarshipTitles.has(title)) return []
    existingScholarshipTitles.add(title)
    const changeId = `ai-scholarship-${stableToken(`${item.name}|${item.source}`)}`.slice(0, 80)
    push(createChange({
      id: changeId,
      target: 'scholarship.ai',
      category: 'funding',
      after: [item.name, item.amount, item.deadline].filter(Boolean).join(' · '),
      source: 'ai',
      confidence: 'medium',
      sources: [item.source],
      forceMode: 'create',
    }))
    return [{ changeId, ...item }]
  })

  const existingTimeline = new Set((application?.timeline || []).map((item) => (
    `${normalizedTitle(item?.title)}|${isoDate(item?.date)}`
  )))
  const timelineSuggestions = (ai?.timeline || []).flatMap((item) => {
    const identity = `${normalizedTitle(item.title)}|${item.date}`
    if (!item.date || existingTimeline.has(identity)) return []
    existingTimeline.add(identity)
    const changeId = `ai-timeline-${stableToken(`${identity}|${item.source}`)}`.slice(0, 80)
    push(createChange({
      id: changeId,
      target: 'timeline.ai',
      category: 'workflow',
      after: `${item.date} · ${item.title}`,
      source: 'ai',
      confidence: 'medium',
      sources: [item.source],
      forceMode: 'create',
    }))
    return [{ changeId, ...item }]
  })

  if (!(application?.timeline || []).some((item) => item.id === `discover-enriched-${program.id}`)) {
    push(createChange({
      id: 'discover-timeline',
      target: 'timeline.discover',
      category: 'workflow',
      after: 'Research snapshot added from Discover',
      source,
      confidence,
      sources,
      forceMode: 'create',
    }))
  }

  return {
    applicationId: clean(application?.id, 100),
    applicationUpdatedAt: clean(application?.updatedAt, 40),
    generatedAt,
    usedAi: Boolean(rawAi),
    matchedProgram: {
      id: clean(program.id, 80),
      school: clean(program.school, 240),
      program: clean(program.program, 240),
      matchScore: score,
    },
    changes,
    caveats: uniqueStrings([
      'Discover data is a research snapshot, not a live guarantee. Verify deadlines, funding and recruiting status on official pages.',
      ...(rawAi?.caveats || []),
      ...(score < 60 ? ['The catalog match is uncertain. Review the matched school and program before applying changes.'] : []),
    ], 10, 1000),
    research,
    payload: {
      snapshot,
      tags: mergedTags,
      checklistSuggestions,
      feeSuggestion,
      scholarshipSuggestions,
      timelineSuggestions,
    },
  }
}

function dossierCardFrom(snapshot, now) {
  const field = (id, label, value, type = 'textarea') => ({
    id,
    label,
    value: clean(value, 4000),
    type,
    width: 'full',
  })
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
      field('sources', 'Official sources to verify', uniqueStrings(snapshot.sources, 12).join('\n')),
    ].filter((item) => item.value),
    createdAt: now,
    updatedAt: now,
  }
}

function changedPayloadItems(payload, key, accepted) {
  return (Array.isArray(payload?.[key]) ? payload[key] : []).filter((item) => (
    item?.changeId && accepted.has(item.changeId)
  ))
}

function upsertRecords(existing, additions) {
  const records = Array.isArray(existing) ? [...existing] : []
  for (const addition of additions) {
    const index = records.findIndex((item) => item?.id === addition.id)
    if (index >= 0) records[index] = addition
    else records.push(addition)
  }
  return records
}

export function applyApplicationEnrichmentProposal(application, proposal, acceptedChangeIds) {
  const accepted = new Set(Array.isArray(acceptedChangeIds) ? acceptedChangeIds : [])
  const changes = new Map((Array.isArray(proposal?.changes) ? proposal.changes : []).map((change) => [change.id, change]))
  const next = structuredClone(application)
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
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
    next.tags = uniqueStrings(proposal?.payload?.tags || changes.get('research-tags').after.split(','), 12, 80)
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
      startDate: today,
      endDate: isoDate(snapshot.deadline) || isoDate(next.deadline) || today,
      school: clean(snapshot.school, 240),
      issuer: clean(snapshot.school, 240),
      status: 'Draft',
      notes: `${clean(snapshot.funding, 3000)}\nVerify with the official sources in the Discover research card.`.trim(),
      materials: [],
      tasks: [],
      timeline: [],
    }
    const scholarships = Array.isArray(next.scholarships) ? [...next.scholarships] : []
    const index = scholarships.findIndex((item) => item.id === id)
    if (index >= 0) scholarships[index] = scholarship
    else scholarships.push(scholarship)
    next.scholarships = scholarships
  }

  const checklistSuggestions = changedPayloadItems(proposal?.payload, 'checklistSuggestions', accepted)
  if (checklistSuggestions.length) {
    next.materials = upsertRecords(next.materials, checklistSuggestions.map((item) => ({
      id: `deep-research-material-${stableToken(item.changeId)}`,
      name: clean(item.title, 240),
      type: 'File',
      status: 'Draft',
      group: 'AI research',
      details: [
        clean(item.details, 1600),
        item.source ? `Source: ${clean(item.source, 500)}` : '',
      ].filter(Boolean).join('\n'),
      reminderEnabled: Boolean(item.due),
      reminderDate: isoDate(item.due),
      requiredCount: 1,
      recommenders: [],
      version: 'v1',
      updatedAt: now,
      versions: [],
    })))
  }

  const fee = proposal?.payload?.feeSuggestion
  if (fee?.changeId && accepted.has(fee.changeId) && changes.has(fee.changeId)) {
    next.fees = upsertRecords(next.fees, [{
      id: `deep-research-fee-${stableToken(fee.changeId)}`,
      amount: Number(fee.amount),
      currency: clean(fee.currency, 10).toUpperCase(),
      paidDate: null,
      waived: false,
      notes: [
        clean(fee.waiverNotes, 1000),
        fee.source ? `Source: ${clean(fee.source, 500)}` : '',
      ].filter(Boolean).join('\n'),
      createdAt: now,
    }])
  }

  const scholarshipSuggestions = changedPayloadItems(proposal?.payload, 'scholarshipSuggestions', accepted)
  if (scholarshipSuggestions.length) {
    next.scholarships = upsertRecords(next.scholarships, scholarshipSuggestions.map((item) => ({
      id: `deep-research-scholarship-${stableToken(item.changeId)}`,
      name: clean(item.name, 240),
      amount: clean(item.amount, 500),
      startDate: today,
      endDate: isoDate(item.deadline) || isoDate(next.deadline) || today,
      school: clean(next.school?.name, 240),
      issuer: clean(next.school?.name, 240),
      status: 'Draft',
      notes: [
        clean(item.eligibility, 1600),
        item.source ? `Source: ${clean(item.source, 500)}` : '',
      ].filter(Boolean).join('\n'),
      materials: [],
      tasks: [],
      timeline: [],
    })))
  }

  const timelineSuggestions = changedPayloadItems(proposal?.payload, 'timelineSuggestions', accepted)
  if (timelineSuggestions.length) {
    const additions = timelineSuggestions.map((item) => ({
        id: `deep-research-timeline-${stableToken(item.changeId)}`,
        title: clean(item.title, 240),
        date: isoDate(item.date),
        note: [
          clean(item.note, 1600),
          item.source ? `Source: ${clean(item.source, 500)}` : '',
        ].filter(Boolean).join('\n'),
      }))
    const additionsById = new Set(additions.map((item) => item.id))
    next.timeline = [...additions, ...(next.timeline || []).filter((item) => !additionsById.has(item?.id))]
  }

  if (accepted.has('discover-timeline') && changes.has('discover-timeline') && snapshot?.programId) {
    const id = `discover-enriched-${clean(snapshot.programId, 80)}`
    if (!(next.timeline || []).some((item) => item.id === id)) {
      next.timeline = [{
        id,
        title: 'Enriched from Discover',
        date: today,
        note: `${clean(snapshot.school, 240)} · ${clean(snapshot.program, 240)} · research snapshot`,
      }, ...(next.timeline || [])]
    }
  }
  next.updatedAt = now
  return next
}
