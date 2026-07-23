const TRACKING_QUERY_KEYS = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i

const PROGRAMME_PATH_TOKEN = /(?:^|[-_])(?:phd|dphil|doctoral|doctorate)(?:$|[-_])|research[-_](?:degree|degrees|programme|programmes|program|programs)/i

const PROGRAMME_BOILERPLATE_WORDS = new Set([
  'a',
  'about',
  'admission',
  'admissions',
  'an',
  'and',
  'application',
  'applications',
  'apply',
  'applying',
  'degree',
  'degrees',
  'doctoral',
  'doctorate',
  'dphil',
  'get',
  'how',
  'information',
  'intro',
  'introduction',
  'of',
  'our',
  'overview',
  'phd',
  'programme',
  'programmes',
  'program',
  'programs',
  'study',
  'studies',
  'studying',
  'the',
  'to',
])

const EMPTY_TEXT_VALUES = new Set([
  '',
  '-',
  '—',
  'n/a',
  'none',
  'null',
  'tbd',
  'unknown',
])

const STATUS_SCORE = {
  unverified: 0,
  partial: 1,
  verified: 2,
}

function normaliseWords(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function schoolIdentity(value) {
  return normaliseWords(value)
    .filter((word) => !['the', 'of', 'at'].includes(word))
    .sort()
    .join(' ')
}

function programmeUrl(value) {
  const canonical = canonicalDiscoverProgramUrl(value)
  if (!canonical) return null
  try {
    return new URL(canonical)
  } catch {
    return null
  }
}

function pathSegments(url) {
  return String(url?.pathname || '')
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase()
      } catch {
        return segment.toLowerCase()
      }
    })
    .filter(Boolean)
}

function doctoralPathRoot(url) {
  const segments = pathSegments(url)
  const markerIndex = segments.findIndex((segment) => PROGRAMME_PATH_TOKEN.test(segment))
  if (markerIndex < 0) return ''
  return `/${segments.slice(0, markerIndex + 1).join('/')}`
}

function isAncestorPath(left, right) {
  const leftSegments = pathSegments(left)
  const rightSegments = pathSegments(right)
  if (leftSegments.length < 2 || rightSegments.length < 2) return false
  const [shorter, longer] = leftSegments.length <= rightSegments.length
    ? [leftSegments, rightSegments]
    : [rightSegments, leftSegments]
  return shorter.every((segment, index) => segment === longer[index])
}

function sameProgrammePageFamily(left, right) {
  if (!left || !right || left.hostname !== right.hostname) return false
  if (left.href === right.href) return true
  const leftRoot = doctoralPathRoot(left)
  const rightRoot = doctoralPathRoot(right)
  if (leftRoot && leftRoot === rightRoot) return true
  if (!isAncestorPath(left, right)) return false
  return [...pathSegments(left), ...pathSegments(right)].some((segment) => (
    PROGRAMME_PATH_TOKEN.test(segment)
  ))
}

function meaningfulText(value) {
  if (typeof value !== 'string') return value != null
  return !EMPTY_TEXT_VALUES.has(value.trim().toLowerCase())
}

function mergeMissingFields(preferred, fallback) {
  const merged = { ...fallback, ...preferred }
  for (const [key, value] of Object.entries(fallback || {})) {
    if (!meaningfulText(preferred?.[key]) && meaningfulText(value)) merged[key] = value
  }
  return merged
}

function uniqueUrls(values, max = 20) {
  const output = []
  const seen = new Set()
  for (const raw of values || []) {
    const identity = canonicalDiscoverProgramUrl(raw)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    output.push(String(raw))
    if (output.length >= max) break
  }
  return output
}

function mergePeople(preferred = [], fallback = []) {
  const output = []
  for (const person of [...preferred, ...fallback]) {
    if (!person || typeof person !== 'object') continue
    const url = canonicalDiscoverProgramUrl(person.url)
    const name = normaliseWords(person.name).join(' ')
    const existingIndex = output.findIndex((existing) => {
      const existingUrl = canonicalDiscoverProgramUrl(existing.url)
      if (url && existingUrl) return url === existingUrl
      return !url && !existingUrl && name && normaliseWords(existing.name).join(' ') === name
    })
    if (existingIndex < 0) {
      output.push(person)
      continue
    }
    output[existingIndex] = mergeMissingFields(output[existingIndex], person)
  }
  return output.slice(0, 20)
}

function mergeScholarships(preferred = [], fallback = []) {
  const output = []
  const seen = new Set()
  for (const scholarship of [...preferred, ...fallback]) {
    if (!scholarship || typeof scholarship !== 'object') continue
    const identity = canonicalDiscoverProgramUrl(scholarship.url)
      || normaliseWords(`${scholarship.name || ''} ${scholarship.provider || ''}`).join(' ')
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    output.push(scholarship)
  }
  return output.slice(0, 12)
}

function mergeVerification(preferred, fallback) {
  const left = preferred && typeof preferred === 'object' ? preferred : {}
  const right = fallback && typeof fallback === 'object' ? fallback : {}
  const status = (STATUS_SCORE[left.status] || 0) >= (STATUS_SCORE[right.status] || 0)
    ? left.status
    : right.status
  return {
    ...right,
    ...left,
    status: status || 'unverified',
    checkedAt: [left.checkedAt, right.checkedAt].filter(Boolean).sort().at(-1) || null,
    officialSourceCount: Math.max(
      Number(left.officialSourceCount) || 0,
      Number(right.officialSourceCount) || 0,
    ),
    advisorSourceCount: Math.max(
      Number(left.advisorSourceCount) || 0,
      Number(right.advisorSourceCount) || 0,
    ),
    issues: [...new Set([...(left.issues || []), ...(right.issues || [])])].slice(0, 12),
  }
}

/**
 * Canonical identity for programme URLs. Tracking parameters and cosmetic URL
 * differences cannot create a second decision row, while meaningful query
 * parameters remain part of the identity.
 */
export function canonicalDiscoverProgramUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return url.href.replace(/\/$/, '')
  } catch {
    return ''
  }
}

/**
 * Return only the subject/project-bearing part of a programme title. Generic
 * institution-wide labels such as "About the PhD programme at DTU" return an
 * empty string; explicit subjects such as "PhD in Education" remain specific.
 */
export function discoverProgramSubjectIdentity(program) {
  let title = String(program?.program || '')
    .replace(/\bdoctor\s+of\s+philosophy\b/gi, 'PhD')
    .replace(/\bph\s*\.?\s*d\.?/gi, 'PhD')
    .replace(/\bd\s*\.?\s*phil\.?/gi, 'DPhil')
    .replace(/\bget\s+(?:a|an|the)?\s*phd\s+education\b/gi, 'PhD')
    .replace(/^\s*about\s+(?:the\s+)?/i, '')
    .split(/\s+(?:\||—|–)\s+/)[0]
    .trim()

  // The phrase after "at/from/by" names the institution, not the subject.
  title = title.replace(/\s+(?:at|from|by)\s+[^,;]+$/i, '').trim()

  const explicitSubject = title.match(
    /\b(?:phd|dphil|doctoral(?:\s+(?:degree|programme|program))?|doctorate)\s+(?:programme\s+|program\s+)?(?:in|of)\s+(.+)$/i,
  )?.[1]
  const source = explicitSubject || title
  return normaliseWords(source)
    .filter((word) => !PROGRAMME_BOILERPLATE_WORDS.has(word))
    .join(' ')
}

/**
 * Strong pairwise identity only. A shared doctoral directory is insufficient:
 * both rows must describe the same concrete subject, or both must be
 * institution-wide overview/process pages in the same doctoral page family.
 */
export function isSameDiscoverProgramme(left, right) {
  if (!left || !right) return false
  const leftSubject = discoverProgramSubjectIdentity(left)
  const rightSubject = discoverProgramSubjectIdentity(right)

  // Never collapse two concrete projects merely because a portal URL or
  // doctoral directory is shared.
  if (leftSubject && rightSubject && leftSubject !== rightSubject) return false
  if (Boolean(leftSubject) !== Boolean(rightSubject)) return false

  const leftUrl = programmeUrl(left.website)
  const rightUrl = programmeUrl(right.website)
  const sameHost = Boolean(leftUrl && rightUrl && leftUrl.hostname === rightUrl.hostname)
  const sameSchool = schoolIdentity(left.school) === schoolIdentity(right.school)

  if (leftUrl && rightUrl && sameProgrammePageFamily(leftUrl, rightUrl)) {
    return sameHost && (sameSchool || doctoralPathRoot(leftUrl) === doctoralPathRoot(rightUrl))
  }

  if (leftSubject) return leftSubject === rightSubject && (sameSchool || sameHost)

  const leftTitle = normaliseWords(left.program).join(' ')
  const rightTitle = normaliseWords(right.program).join(' ')
  return Boolean(leftTitle && leftTitle === rightTitle && sameSchool)
}

export function discoverProgramRecordScore(program) {
  const subjectWordCount = normaliseWords(discoverProgramSubjectIdentity(program)).length
  const verificationScore = STATUS_SCORE[program?.verification?.status] || 0
  const officialSources = Number(program?.verification?.officialSourceCount) || 0
  const advisorSources = Number(program?.verification?.advisorSourceCount) || 0
  const populatedFields = [
    'city',
    'country',
    'website',
    'stipendLocal',
    'degreeStructure',
    'applicationRoute',
    'deadlineAndTests',
    'deadlineIso',
    'applicationRestrictions',
    'researchFocus',
    'fitRationale',
    'tuitionLocal',
    'careerOutcomes',
    'admitBackgrounds',
    'intlNotes',
  ].filter((field) => meaningfulText(program?.[field])).length
  const websiteDepth = pathSegments(programmeUrl(program?.website)).length

  return (program?.provenance === 'ai' ? 400 : 0)
    + verificationScore * 2_000
    + subjectWordCount * 80
    + (program?.pis?.length || 0) * 100
    + advisorSources * 50
    + officialSources * 40
    + Object.values(program?.factSources || {}).filter(Boolean).length * 30
    + populatedFields * 8
    + (program?.sources?.length || 0) * 5
    + websiteDepth
}

export function mergeDiscoverProgrammeRecords(preferred, fallback) {
  const merged = mergeMissingFields(preferred || {}, fallback || {})
  const preferredFactSources = preferred?.factSources || {}
  const fallbackFactSources = fallback?.factSources || {}
  merged.id = preferred?.id || fallback?.id
  merged.program = preferred?.program || fallback?.program
  merged.school = preferred?.school || fallback?.school
  merged.website = preferred?.website || fallback?.website
  merged.sources = uniqueUrls([...(preferred?.sources || []), ...(fallback?.sources || [])], 20)
  merged.rankingSources = uniqueUrls([
    ...(preferred?.rankingSources || []),
    ...(fallback?.rankingSources || []),
  ], 8)
  merged.factSources = Object.fromEntries(
    [...new Set([...Object.keys(fallbackFactSources), ...Object.keys(preferredFactSources)])]
      .map((key) => [key, preferredFactSources[key] || fallbackFactSources[key] || '']),
  )
  merged.pis = mergePeople(preferred?.pis, fallback?.pis)
  merged.scholarships = mergeScholarships(preferred?.scholarships, fallback?.scholarships)
  merged.tags = [...new Set([...(preferred?.tags || []), ...(fallback?.tags || [])])].slice(0, 20)
  merged.verification = mergeVerification(preferred?.verification, fallback?.verification)
  return merged
}

/**
 * Bounded catalog/research dedupe. The list is intentionally small (<=160),
 * so pairwise strong-identity checks are clearer and safer than fuzzy hashes.
 */
export function dedupeDiscoverProgrammeRecords(programs = [], {
  scoreProgram = discoverProgramRecordScore,
  max = Number.POSITIVE_INFINITY,
} = {}) {
  const output = []
  for (const program of programs || []) {
    const existingIndex = output.findIndex((existing) => isSameDiscoverProgramme(existing, program))
    if (existingIndex < 0) {
      output.push(program)
      if (output.length >= max) break
      continue
    }
    const existing = output[existingIndex]
    const preferred = scoreProgram(program) > scoreProgram(existing) ? program : existing
    const fallback = preferred === program ? existing : program
    output[existingIndex] = mergeDiscoverProgrammeRecords(preferred, fallback)
  }
  return output.slice(0, max)
}
