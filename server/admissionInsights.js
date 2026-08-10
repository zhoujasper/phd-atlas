/**
 * Profile-aware reading of the admission-signal records.
 *
 * The deterministic layer in admissionSignals.js decides whether a record is
 * about the right person and the right programme. That question has a defensible
 * answer from the record's own fields, so it is never delegated to a model.
 *
 * What is left is judgement: which of this advisor's grants relate to what this
 * applicant actually works on, whether the funding picture supports taking a
 * student, and what is worth raising in a first email. That needs the
 * applicant's profile, and it is what this module asks the model for.
 *
 * The model is given only records that already passed verification, and it is
 * asked to reference them by index. It cannot introduce an award, a project or
 * a statistic, and anything it returns that does not point at a supplied record
 * is dropped on parse. Its judgement is presented as judgement, next to the
 * records, never merged into them as fact.
 */

const MAX_PROMPT_AWARDS = 12
const MAX_PROMPT_PROJECTS = 12
const MAX_PROMPT_WORKS = 15
const MAX_PROMPT_OUTCOMES = 20
const MAX_PROMPT_OFFICIAL_FACTS = 20
const MAX_PROMPT_PROFILE_ASSETS = 12
const MAX_ABSTRACT_CHARS = 700
const MAX_PROFILE_CHARS = 1_200

function trimmed(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * The applicant, as the model needs to see them: what they work on and what
 * they have written, with no contact details or attachment payloads.
 */
export function summarizeApplicantProfile(profileAssets = []) {
  return profileAssets
    .slice(0, MAX_PROMPT_PROFILE_ASSETS)
    .map((asset) => ({
      kind: trimmed(asset?.kind, 80),
      name: trimmed(asset?.name, 160),
      summary: trimmed(asset?.description, MAX_PROFILE_CHARS),
      ...(asset?.writingBrief?.researchFocus
        ? { researchFocus: trimmed(asset.writingBrief.researchFocus, 400) }
        : {}),
    }))
    .filter((asset) => asset.name || asset.summary)
}

function awardForPrompt(record, index) {
  const value = record?.value ?? {}
  return {
    index,
    title: trimmed(value.title, 300),
    pi: trimmed(value.piName, 160),
    organization: trimmed(value.awardeeName, 200),
    startDate: trimmed(value.startDate, 40),
    endDate: trimmed(value.expDate, 40),
    amountUsd: typeof value.estimatedTotalAmt === 'number' ? value.estimatedTotalAmt : null,
    active: value.activeAwd ?? null,
    program: trimmed(value.fundProgramName, 200),
    abstract: trimmed(value.abstractText, MAX_ABSTRACT_CHARS),
  }
}

function projectForPrompt(record, index) {
  const value = record?.value ?? {}
  return {
    index,
    title: trimmed(value.title, 300),
    pi: trimmed(value.piName, 160),
    organization: trimmed(value.organizationName, 200),
    startDate: trimmed(value.startDate, 40),
    endDate: trimmed(value.endDate, 40),
    amountUsd: typeof value.awardAmount === 'number' ? value.awardAmount : null,
    fiscalYear: value.fiscalYear ?? null,
    abstract: trimmed(value.abstractText, MAX_ABSTRACT_CHARS),
  }
}

function workForPrompt(record, index) {
  const value = record?.value ?? {}
  return {
    index,
    title: trimmed(value.title, 300),
    year: value.publicationYear ?? null,
    citedBy: value.citedByCount ?? null,
    topics: (value.topics ?? []).slice(0, 6).map((topic) => trimmed(topic, 80)),
  }
}

function outcomeForPrompt(record, index) {
  const value = record?.value ?? {}
  return {
    index,
    school: trimmed(value.school, 160),
    program: trimmed(value.program, 160),
    decision: trimmed(value.decision, 40),
    date: trimmed(value.date, 40),
  }
}

function officialFactForPrompt(record, index) {
  const value = record?.value ?? {}
  return {
    index,
    factType: trimmed(value.factType, 80),
    value: typeof value.value === 'number' ? value.value : null,
    unit: trimmed(value.unit, 40),
    year: Number.isInteger(Number(value.year)) ? Number(value.year) : null,
    statement: trimmed(value.statement, 500),
    sourceUrl: trimmed(record?.sourceUrl, 500),
  }
}

const SYSTEM_PROMPT = [
  'You are an admissions research analyst for a PhD applicant.',
  'You are given public funding, publication and admission-outcome records that have already been verified as belonging to the named professor and programme, plus a summary of the applicant.',
  'Your job is judgement over those records, not retrieval.',
  '',
  'Absolute rules:',
  '- Never introduce an award, project, publication, statistic, amount, date or person that is not in the supplied records.',
  '- Official admission facts are exact sentence-backed claims. Do not combine them into a derived acceptance rate or transfer a year between statements.',
  '- Refer to records only by their given index.',
  '- If a record looks like it belongs to a different person than the named professor, say so in mismatchedIndexes instead of using it.',
  '- Absence of a public award is not evidence a professor has no funding. Say "no public record found", never "unfunded".',
  '- If the records do not support a conclusion, say so plainly and leave the field short.',
  '',
  'Return JSON only, matching exactly:',
  '{',
  '  "fundingOutlook": string,',
  '  "fundingConfidence": "strong" | "moderate" | "weak" | "unknown",',
  '  "profileFit": string,',
  '  "relevantAwardIndexes": number[],',
  '  "relevantProjectIndexes": number[],',
  '  "relevantWorkIndexes": number[],',
  '  "mismatchedIndexes": [{ "kind": "award" | "project" | "work" | "outcome", "index": number, "reason": string }],',
  '  "outcomeReading": string,',
  '  "talkingPoints": string[],',
  '  "openQuestions": string[]',
  '}',
].join('\n')

/**
 * Builds the prompt pair. Kept separate from the request so the exact payload
 * sent to a provider can be asserted without a network call.
 */
export function buildAdmissionInsightsPrompts({
  application = {},
  profileAssets = [],
  outcomes = null,
  advisor = null,
  outputLanguage = 'en',
} = {}) {
  const awards = (advisor?.awards ?? []).slice(0, MAX_PROMPT_AWARDS).map(awardForPrompt)
  const projects = (advisor?.projects ?? []).slice(0, MAX_PROMPT_PROJECTS).map(projectForPrompt)
  const works = (advisor?.works ?? []).slice(0, MAX_PROMPT_WORKS).map(workForPrompt)
  const outcomeRows = (outcomes?.outcomes ?? []).slice(0, MAX_PROMPT_OUTCOMES).map(outcomeForPrompt)
  const officialFacts = (outcomes?.officialFacts ?? []).slice(0, MAX_PROMPT_OFFICIAL_FACTS).map(officialFactForPrompt)

  const user = {
    outputLanguage,
    target: {
      school: trimmed(application.school, 200),
      program: trimmed(application.program, 200),
      professor: trimmed(application.professor, 200),
      professorResearch: trimmed(application.professorResearch, 600),
    },
    applicant: summarizeApplicantProfile(profileAssets),
    // Counts travel with the rows so the model can tell "none found" from
    // "list truncated" without guessing.
    counts: {
      awards: advisor?.awards?.length ?? 0,
      projects: advisor?.projects?.length ?? 0,
      works: advisor?.works?.length ?? 0,
      verifiedOutcomes: outcomes?.outcomes?.length ?? 0,
      officialAdmissionFacts: outcomes?.officialFacts?.length ?? 0,
    },
    outcomeSummary: outcomes?.summary ?? null,
    awards,
    projects,
    works,
    outcomes: outcomeRows,
    officialAdmissionFacts: officialFacts,
  }

  return {
    system: SYSTEM_PROMPT,
    user: JSON.stringify(user),
    limits: {
      awards: awards.length,
      projects: projects.length,
      works: works.length,
      outcomes: outcomeRows.length,
    },
  }
}

function jsonFromCompletion(text) {
  const cleaned = String(text ?? '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  if (!cleaned) return null
  try {
    return JSON.parse(cleaned)
  } catch {
    // A provider that wrapped the object in prose still produced a usable
    // object; take the outermost braces rather than discarding the whole run.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function boundedIndexes(value, limit) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  for (const entry of value) {
    const index = Number(entry)
    // An index outside the supplied range refers to a record that was never
    // sent, so it cannot be shown next to one.
    if (Number.isSafeInteger(index) && index >= 0 && index < limit) seen.add(index)
  }
  return [...seen].sort((left, right) => left - right)
}

function boundedText(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : ''
}

function boundedList(value, limit, itemLimit) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => boundedText(entry, itemLimit))
    .filter(Boolean)
    .slice(0, limit)
}

const CONFIDENCE = new Set(['strong', 'moderate', 'weak', 'unknown'])
const MISMATCH_KINDS = new Set(['award', 'project', 'work', 'outcome'])

/**
 * Validates the model's answer against the records it was actually given.
 * Anything pointing outside that set is dropped rather than rendered, so a
 * hallucinated index can never become a row in the panel.
 */
export function parseAdmissionInsightsResponse(text, limits = {}) {
  const parsed = jsonFromCompletion(text)
  if (!parsed || typeof parsed !== 'object') return null

  const mismatched = Array.isArray(parsed.mismatchedIndexes)
    ? parsed.mismatchedIndexes
      .map((entry) => {
        const kind = String(entry?.kind ?? '')
        const index = Number(entry?.index)
        const limit = limits[`${kind}s`] ?? 0
        if (!MISMATCH_KINDS.has(kind)) return null
        if (!Number.isSafeInteger(index) || index < 0 || index >= limit) return null
        return { kind, index, reason: boundedText(entry?.reason, 300) }
      })
      .filter(Boolean)
      .slice(0, 20)
    : []

  return {
    fundingOutlook: boundedText(parsed.fundingOutlook, 1_200),
    fundingConfidence: CONFIDENCE.has(parsed.fundingConfidence) ? parsed.fundingConfidence : 'unknown',
    profileFit: boundedText(parsed.profileFit, 1_500),
    relevantAwardIndexes: boundedIndexes(parsed.relevantAwardIndexes, limits.awards ?? 0),
    relevantProjectIndexes: boundedIndexes(parsed.relevantProjectIndexes, limits.projects ?? 0),
    relevantWorkIndexes: boundedIndexes(parsed.relevantWorkIndexes, limits.works ?? 0),
    mismatchedIndexes: mismatched,
    outcomeReading: boundedText(parsed.outcomeReading, 1_200),
    talkingPoints: boundedList(parsed.talkingPoints, 6, 400),
    openQuestions: boundedList(parsed.openQuestions, 6, 400),
  }
}
