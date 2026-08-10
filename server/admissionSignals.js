import { gradcafeResultsSource } from './sources/gradcafeResults.js'
import { redditSubmissionsSource } from './sources/redditSubmissions.js'
import { nsfAwardsSource } from './sources/nsfAwards.js'
import { nihReporterSource } from './sources/nihReporter.js'
import { openalexWorksSource } from './sources/openalexWorks.js'
import { ukriGatewayProjectsSource } from './sources/ukriGatewayProjects.js'
import { officialProgramHistorySource } from './sources/officialProgramHistory.js'
import {
  searchablePersonName,
  verifyAdvisorRecord,
  verifyOutcomeRecord,
} from './sources/sourceRelevance.js'

/**
 * Product-facing aggregation over the Phase 12 source adapters.
 *
 * The adapters were built and tested but nothing imported them, so none of the
 * data ever reached a screen. This module is the missing layer: it turns an
 * application (school, programme, cycle) and an advisor (name, institution)
 * into the two questions applicants actually ask -- how did this programme
 * decide in past cycles, and can this professor currently fund a student.
 *
 * One failing source must never take the others down with it. A refused HTML
 * page, an expired quota, and missing Reddit credentials are all normal states
 * here, so every source is reported with its own status and the caller renders
 * what it got. Provenance rides along with each record; nothing in the response
 * is presented as fact without the URL and fetch time it came from.
 */

const OUTCOME_SOURCES = Object.freeze([
  officialProgramHistorySource,
  gradcafeResultsSource,
  redditSubmissionsSource,
])
const ADVISOR_SOURCES = Object.freeze([
  nsfAwardsSource,
  nihReporterSource,
  ukriGatewayProjectsSource,
  openalexWorksSource,
])

const MAX_OUTCOME_RECORDS = 60
const MAX_DISCUSSION_RECORDS = 20
const MAX_ADVISOR_RECORDS_PER_SOURCE = 25

/** GradCafe writes decisions in prose; these are the buckets worth counting. */
const DECISION_BUCKETS = Object.freeze({
  accepted: 'accepted',
  admitted: 'accepted',
  rejected: 'rejected',
  waitlisted: 'waitlisted',
  'wait listed': 'waitlisted',
  interview: 'interview',
  pending: 'pending',
})

export function normalizeDecision(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return null
  return DECISION_BUCKETS[text] || DECISION_BUCKETS[text.replace(/\s+/g, '')] || null
}

function comparableTargetText(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function admissionSignalTargetForApplication(application = {}) {
  return {
    school: String(application?.school?.name ?? '').trim(),
    program: String(application?.program ?? '').trim(),
    advisorName: String(
      application?.professor?.english || application?.professor?.chinese || '',
    ).trim(),
  }
}

export function admissionSignalTargetMatches(reportTarget, currentTarget) {
  if (!reportTarget || !currentTarget) return false
  return comparableTargetText(reportTarget.school) === comparableTargetText(currentTarget.school)
    && comparableTargetText(reportTarget.program) === comparableTargetText(currentTarget.program)
    && comparableTargetText(searchablePersonName(reportTarget.advisorName))
      === comparableTargetText(searchablePersonName(currentTarget.advisorName))
}

/**
 * A decision date may arrive as an ISO string or as GradCafe's prose date. Only
 * values that parse are compared, so an unparsable date never wins "latest".
 */
function decisionTime(value) {
  if (!value) return null
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

export function summarizeAdmissionOutcomes(records = []) {
  const summary = {
    total: 0,
    accepted: 0,
    rejected: 0,
    waitlisted: 0,
    interview: 0,
    pending: 0,
    unclassified: 0,
    latestDecisionAt: null,
  }
  let latest = null
  for (const record of records) {
    const value = record?.value || {}
    summary.total += 1
    const bucket = normalizeDecision(value.decision)
    if (bucket) summary[bucket] += 1
    else summary.unclassified += 1
    const time = decisionTime(value.date)
    if (time !== null && (latest === null || time > latest)) {
      latest = time
      summary.latestDecisionAt = new Date(time).toISOString()
    }
  }
  // An acceptance rate over three results is noise, not a statistic.
  const decided = summary.accepted + summary.rejected + summary.waitlisted
  summary.acceptedShare = decided >= 4 ? Number((summary.accepted / decided).toFixed(3)) : null
  return summary
}

/**
 * Groups verified applicant-reported decisions by the year of the decision.
 *
 * This is deliberately derived from record dates, not from the date on which
 * PhD Atlas happened to query the source. A query-history snapshot is evidence
 * freshness; it is not an admissions cycle and must never be charted as one.
 */
export function summarizeAdmissionCycles(records = []) {
  const cycles = new Map()
  for (const record of records) {
    const timestamp = decisionTime(record?.value?.date)
    const cycle = timestamp === null ? 'unknown' : String(new Date(timestamp).getUTCFullYear())
    const rows = cycles.get(cycle) || []
    rows.push(record)
    cycles.set(cycle, rows)
  }
  return [...cycles.entries()]
    .map(([cycle, rows]) => ({ cycle, ...summarizeAdmissionOutcomes(rows) }))
    .sort((left, right) => {
      if (left.cycle === 'unknown') return 1
      if (right.cycle === 'unknown') return -1
      return Number(right.cycle) - Number(left.cycle)
    })
}

/**
 * Runs one adapter and always resolves. `status` separates the cases the UI has
 * to word differently: an empty result, a source the operator disabled, a
 * source that needs credentials, and a source that actually broke.
 */
export async function runSourceSafely(adapter, query, options = {}) {
  const config = adapter?.config || {}
  const base = { id: config.id || 'unknown', name: config.name || config.id || 'unknown' }
  try {
    const result = await adapter.run(query, options)
    const warnings = result.warnings || []
    const needsCredentials = warnings.some((warning) => String(warning).includes('credentials-missing'))
    return {
      ...base,
      status: needsCredentials ? 'not-configured' : result.status,
      records: result.records || [],
      warnings,
      meta: result.meta || {},
    }
  } catch (error) {
    return {
      ...base,
      status: 'error',
      records: [],
      warnings: [],
      meta: {},
      // The adapters throw typed errors; the name tells the UI whether this is
      // a transient refusal or markup that changed and needs a code fix.
      error: {
        kind: error?.name || 'Error',
        message: String(error?.message || 'Source request failed.').slice(0, 400),
      },
    }
  }
}

function boundedRecords(records, limit) {
  return records.slice(0, limit).map((record) => ({
    kind: record.kind,
    value: record.value,
    sourceId: record.sourceId,
    sourceUrl: record.sourceUrl,
    ...(record.apiUrl ? { apiUrl: record.apiUrl } : {}),
    fetchedAt: record.fetchedAt,
    confidence: record.confidence,
    ...(record.match ? { match: record.match } : {}),
  }))
}

/**
 * `recordCount` is what the source returned; `verifiedCount` is what survived
 * relevance checking. Showing only the first would claim twenty five results
 * for a professor who has none, which is the failure this layer exists to
 * prevent -- so the gap between the two is reported, not hidden.
 */
function sourceReport(outcome, verifiedCount) {
  return {
    id: outcome.id,
    name: outcome.name,
    status: outcome.status,
    recordCount: outcome.records.length,
    ...(verifiedCount === undefined ? {} : { verifiedCount }),
    warnings: outcome.warnings.slice(0, 5),
    ...(outcome.error ? { error: outcome.error } : {}),
  }
}

export function buildAdmissionOutcomesQueries(input = {}) {
  const school = String(input.school || '').trim()
  const program = String(input.program || '').trim()
  const year = input.year ? Number(input.year) : undefined
  return {
    'official-program-history': {
      school,
      program,
      officialUrl: String(input.officialUrl || '').trim(),
    },
    'gradcafe-results': {
      school,
      program,
      ...(Number.isFinite(year) ? { year } : {}),
    },
    // Reddit searches one query string rather than structured fields, so the
    // programme and school are joined the way an applicant would type them.
    'reddit-submissions': {
      school,
      program,
      keyword: [school, program].filter(Boolean).join(' ') || 'PhD admissions',
    },
  }
}

/**
 * Every key here has to be one the target adapter reads.
 *
 * This used to send `principalInvestigator`, `institution` and `organization`,
 * none of which any adapter looks at. NSF was left with a bare keyword and NIH
 * with no criteria at all, so NIH answered with the first page of every active
 * project in the agency and NSF with its newest awards -- both rendered as one
 * professor's funding record. Renaming a key here silently reintroduces that,
 * so the adapter contract is asserted in admissionSignals.test.js.
 */
export function buildAdvisorSignalQueries(input = {}) {
  const name = String(input.name || '').trim()
  const institution = String(input.institution || '').trim()
  // Agencies match the PI field literally and store no honorifics, so the title
  // people habitually type has to come off before the query goes out.
  const searchName = searchablePersonName(name)
  return {
    // `pi` becomes pdPIName, which NSF matches on properly and answers empty
    // when nobody matches. The institution is deliberately not sent as a
    // filter: NSF records the awardee organization, which is often not where
    // the professor is now, and a mismatch there should demote a record rather
    // than hide it. Verification below uses it instead.
    'nsf-awards': { pi: searchName },
    'nih-reporter': { pi: searchName },
    'ukri-gateway-projects': { name: searchName, institution, limit: 12 },
    'openalex-works': {
      authorName: searchName,
      institution,
      fromPublicationDate: '2021-01-01',
      sort: 'publication_date:desc',
    },
  }
}

/** Names this record credits, in whatever shape the adapter produced. */
function recordPersonNames(value = {}) {
  const names = []
  const push = (candidate) => {
    const text = String(candidate ?? '').trim()
    if (text && !names.includes(text)) names.push(text)
  }
  push(value.piName)
  for (const name of value.piNames ?? []) push(name)
  for (const name of value.coPiNames ?? []) push(name)
  for (const name of value.authors ?? []) push(name)
  return names
}

/** Organizations this record is attached to. */
function recordOrganizations(value = {}) {
  const organizations = []
  const push = (candidate) => {
    const text = String(candidate ?? '').trim()
    if (text && !organizations.includes(text)) organizations.push(text)
  }
  push(value.awardeeName)
  push(value.organizationName)
  for (const institution of value.institutions ?? []) push(institution)
  return organizations
}

/**
 * Attaches a relevance verdict to every advisor record and splits the verified
 * ones from the merely possible. Nothing is dropped outright -- a near miss is
 * still useful to a person checking by hand -- but only verified records are
 * allowed to speak for the advisor in the summary or the counts.
 */
export function classifyAdvisorRecords(records, { name, institution }) {
  const verified = []
  const possible = []
  for (const record of records) {
    const match = verifyAdvisorRecord({
      advisorName: name,
      institution,
      names: recordPersonNames(record.value),
      organizations: recordOrganizations(record.value),
    })
    const annotated = { ...record, match }
    if (match.verified) verified.push(annotated)
    else if (match.confidence > 0) possible.push(annotated)
  }
  // Strongest evidence first, so a truncated list keeps the best matches.
  const byConfidence = (left, right) => right.match.confidence - left.match.confidence
  return { verified: verified.sort(byConfidence), possible: possible.sort(byConfidence) }
}

/** Collapse index duplicates of the same paper version while retaining the
 * strongest, most-cited evidence row. Exact title duplicates are not extra
 * advisor evidence and make an index look richer than it is. */
export function dedupeAdvisorWorks(records = []) {
  const byWork = new Map()
  for (const record of records) {
    const doi = String(record?.value?.doi || '').trim().toLocaleLowerCase()
    const title = String(record?.value?.title || '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
    const key = title
      ? `title:${title}`
      : `doi:${doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')}`
    if (!title && !doi) continue
    const current = byWork.get(key)
    const score = Number(record?.match?.confidence || 0) * 1_000_000
      + Math.max(0, Number(record?.value?.citedByCount) || 0)
    const currentScore = Number(current?.match?.confidence || 0) * 1_000_000
      + Math.max(0, Number(current?.value?.citedByCount) || 0)
    if (!current || score > currentScore) byWork.set(key, record)
  }
  return [...byWork.values()].sort((left, right) => {
    const rightTime = decisionTime(right?.value?.publicationDate)
    const leftTime = decisionTime(left?.value?.publicationDate)
    if (rightTime !== null && leftTime !== null && rightTime !== leftTime) return rightTime - leftTime
    return Math.max(0, Number(right?.value?.citedByCount) || 0)
      - Math.max(0, Number(left?.value?.citedByCount) || 0)
  })
}

/**
 * Same idea for admission outcomes: a GradCafe row typed by an applicant only
 * counts toward this programme's statistics if it actually names it.
 */
export function classifyOutcomeRecords(records, { school, program }) {
  const verified = []
  const possible = []
  for (const record of records) {
    const match = verifyOutcomeRecord({
      school,
      program,
      candidateSchool: record.value?.school,
      candidateProgram: record.value?.program,
    })
    const annotated = { ...record, match }
    if (match.verified) verified.push(annotated)
    else possible.push(annotated)
  }
  return { verified, possible }
}

const DISCUSSION_GENERIC_TERMS = new Set([
  'and', 'at', 'college', 'degree', 'department', 'doctoral', 'doctorate', 'dphil',
  'engineering', 'for', 'in', 'institute', 'of', 'phd', 'program', 'programme',
  'school', 'science', 'studies', 'the', 'university',
])

function discussionTerms(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((term) => term && !DISCUSSION_GENERIC_TERMS.has(term))
}

function phraseAcronym(value) {
  const words = String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || []
  const acronym = words.filter((word) => !['and', 'at', 'of', 'the'].includes(word)).map((word) => word[0]).join('')
  return acronym.length >= 2 && acronym.length <= 8 ? acronym : ''
}

/** Reddit is discovery evidence, never an outcome row. Keep only discussions
 * that visibly name the target school and field; near misses remain separate. */
export function classifyDiscussionRecords(records, { school, program }) {
  const schoolTerms = discussionTerms(school)
  const programTerms = discussionTerms(program)
  const schoolAcronym = phraseAcronym(school)
  const programAcronym = phraseAcronym(program)
  const verified = []
  const possible = []
  for (const record of records || []) {
    const textTerms = new Set(discussionTerms(`${record?.value?.title || ''} ${record?.value?.selfText || ''}`))
    const schoolHits = schoolTerms.filter((term) => textTerms.has(term))
    const programHits = programTerms.filter((term) => textTerms.has(term))
    const schoolMatch = schoolHits.length > 0 || Boolean(schoolAcronym && textTerms.has(schoolAcronym))
    const programOverlap = programTerms.length
      ? programHits.length / programTerms.length
      : 1
    const programMatch = programOverlap >= 0.5 || Boolean(programAcronym && textTerms.has(programAcronym))
    const match = {
      verified: schoolMatch && programMatch,
      confidence: schoolMatch && programMatch ? 0.9 : schoolMatch ? 0.55 : 0.1,
      schoolMatch,
      programOverlap: Number(programOverlap.toFixed(3)),
      reasons: [
        schoolMatch ? 'target-school-visible-in-post' : 'target-school-not-visible-in-post',
        programMatch ? 'target-field-visible-in-post' : 'target-field-not-visible-in-post',
      ],
    }
    const annotated = { ...record, match }
    if (match.verified) verified.push(annotated)
    else possible.push(annotated)
  }
  return { verified, possible }
}

/**
 * Admission outcomes for one programme: past decisions plus applicant
 * discussion. Both sources are optional; the response says which answered.
 */
export async function collectAdmissionOutcomes(input = {}, options = {}) {
  const queries = buildAdmissionOutcomesQueries(input)
  const settled = await Promise.all(OUTCOME_SOURCES.map((adapter) => (
    runSourceSafely(adapter, queries[adapter.config.id] || {}, options)
  )))
  const byId = new Map(settled.map((outcome) => [outcome.id, outcome]))
  const gradcafe = byId.get('gradcafe-results')
  const reddit = byId.get('reddit-submissions')
  const official = byId.get('official-program-history')
  const school = input.school || ''
  const program = input.program || ''
  const { verified, possible } = classifyOutcomeRecords(gradcafe?.records || [], { school, program })
  const discussions = classifyDiscussionRecords(reddit?.records || [], { school, program })
  return {
    query: { school, program, year: input.year ?? null },
    // Only rows that name this programme are counted. An acceptance rate built
    // from another school's results is worse than no acceptance rate.
    summary: summarizeAdmissionOutcomes(verified),
    cycles: summarizeAdmissionCycles(verified),
    outcomes: boundedRecords(verified, MAX_OUTCOME_RECORDS),
    unmatchedOutcomes: boundedRecords(possible, MAX_OUTCOME_RECORDS),
    // Official numeric facts stay separate from applicant-reported decisions.
    // A cohort size or applications-received count is not an acceptance row.
    officialFacts: boundedRecords(official?.records || [], MAX_OUTCOME_RECORDS),
    officialPages: (official?.meta?.pages || []).slice(0, 20),
    discussions: boundedRecords(discussions.verified, MAX_DISCUSSION_RECORDS),
    unmatchedDiscussions: boundedRecords(discussions.possible, MAX_DISCUSSION_RECORDS),
    sources: settled.map((outcome) => sourceReport(
      outcome,
      outcome.id === 'gradcafe-results'
        ? verified.length
        : outcome.id === 'official-program-history'
          ? outcome.records.length
          : outcome.id === 'reddit-submissions'
            ? discussions.verified.length
            : undefined,
    )),
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Funding and publication signals for one advisor. An active award is the
 * single most decisive public signal that a professor can take a student.
 */
export async function collectAdvisorSignals(input = {}, options = {}) {
  const name = String(input.name || '').trim()
  const institution = String(input.institution || '').trim()
  // Without a usable name there is nothing to attribute a record to. Every
  // source here is person-scoped, so an unnamed query can only produce somebody
  // else's grants under this advisor's heading. A field holding only a title
  // ("Prof.") is as unusable as an empty one.
  if (!searchablePersonName(name)) {
    return {
      query: { name: '', institution },
      funding: { awardCount: 0, projectCount: 0, hasPublicAward: false, verified: true },
      awards: [], projects: [], works: [],
      possibleAwards: [], possibleProjects: [], possibleWorks: [],
      sources: ADVISOR_SOURCES.map((adapter) => ({
        id: adapter.config.id,
        name: adapter.config.name,
        status: 'empty',
        recordCount: 0,
        warnings: ['advisor-name-missing'],
      })),
      fetchedAt: new Date().toISOString(),
    }
  }

  const queries = buildAdvisorSignalQueries({ name, institution })
  const settled = await Promise.all(ADVISOR_SOURCES.map((adapter) => (
    runSourceSafely(adapter, queries[adapter.config.id] || {}, options)
  )))
  const byId = new Map(settled.map((outcome) => [outcome.id, outcome]))
  const classify = (sourceId) => classifyAdvisorRecords(byId.get(sourceId)?.records || [], { name, institution })
  const nsf = classify('nsf-awards')
  const nih = classify('nih-reporter')
  const ukri = classify('ukri-gateway-projects')
  const openalexRaw = classify('openalex-works')
  const openalex = {
    verified: dedupeAdvisorWorks(openalexRaw.verified),
    possible: dedupeAdvisorWorks(openalexRaw.possible),
  }

  const awards = boundedRecords(nsf.verified, MAX_ADVISOR_RECORDS_PER_SOURCE)
  const projects = boundedRecords(
    [...nih.verified, ...ukri.verified],
    MAX_ADVISOR_RECORDS_PER_SOURCE,
  )
  const works = boundedRecords(openalex.verified, MAX_ADVISOR_RECORDS_PER_SOURCE)
  return {
    query: { name, institution },
    // "Funded" here means a public grant record was returned *and* verified as
    // this person's, nothing more. The UI must keep it that way: absence of an
    // award is not proof of no funding, only that these agencies show none
    // under this name.
    funding: {
      awardCount: awards.length,
      projectCount: projects.length,
      hasPublicAward: awards.length > 0 || projects.length > 0,
      possibleAwardCount: nsf.possible.length,
      possibleProjectCount: nih.possible.length + ukri.possible.length,
    },
    awards,
    projects,
    works,
    // Near misses stay reachable but are never counted as this advisor's. They
    // are usually a different person sharing a surname and first initial.
    possibleAwards: boundedRecords(nsf.possible, MAX_ADVISOR_RECORDS_PER_SOURCE),
    possibleProjects: boundedRecords(
      [...nih.possible, ...ukri.possible],
      MAX_ADVISOR_RECORDS_PER_SOURCE,
    ),
    possibleWorks: boundedRecords(openalex.possible, MAX_ADVISOR_RECORDS_PER_SOURCE),
    sources: settled.map((outcome) => sourceReport(outcome, ({
      'nsf-awards': nsf.verified.length,
      'nih-reporter': nih.verified.length,
      'ukri-gateway-projects': ukri.verified.length,
      'openalex-works': openalex.verified.length,
    })[outcome.id])),
    fetchedAt: new Date().toISOString(),
  }
}
