/**
 * Relevance verification for public-source records.
 *
 * The source APIs are not exact-match search engines. NSF's Award Search
 * silently ignores a `keyword` it cannot satisfy and answers with the newest
 * awards instead of an empty set, and a NIH RePORTER body carrying no criteria
 * is a valid request for the first page of every active project. Both were
 * being rendered under the heading "this professor's funding", which is how a
 * panel ends up confidently showing twenty five awards belonging to strangers.
 *
 * So a returned row is a *candidate*, never an answer. Everything here decides
 * whether a candidate actually names the person or programme that was asked
 * about, using only fields the record itself carries. A record that cannot be
 * tied back to the query is reported as unverified rather than shown as fact.
 */

/**
 * Honorifics and post-nominals that carry no identity. Single letters are
 * deliberately absent: "D. Kim" is an initial, not a degree, and dropping it
 * would leave a bare surname that matches every Kim in the agency.
 */
const NAME_NOISE = new Set([
  'prof', 'professor', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'mx',
  'phd', 'md', 'msc', 'bsc', 'jr', 'sr', 'ii', 'iii', 'iv',
  'emeritus', 'emerita', 'assoc', 'associate', 'asst', 'assistant', 'adjunct', 'visiting',
])

/** Degree suffixes are removed as whole phrases before any letter becomes a token. */
const DEGREE_SUFFIX = /[,\s]+(ph\s*\.?\s*d|m\s*\.?\s*d|m\s*\.?\s*s\s*\.?\s*c?|b\s*\.?\s*a|b\s*\.?\s*s|m\s*\.?\s*a)\s*\.?\s*$/i

/** Words shared by so many institutions that matching on them means nothing. */
const INSTITUTION_NOISE = new Set([
  'university', 'universite', 'universitat', 'universidad', 'universita', 'univ',
  'college', 'institute', 'institution', 'school', 'academy', 'center', 'centre',
  'department', 'dept', 'faculty', 'laboratory', 'lab', 'hospital', 'medical',
  'the', 'of', 'at', 'and', 'for', 'in', 'de', 'la', 'los', 'el', 'du', 'des',
  'state', 'national', 'international', 'system', 'campus', 'main', 'inc', 'llc',
])

/** Degree and level words that appear in every programme title. */
const PROGRAM_NOISE = new Set([
  'phd', 'ph', 'd', 'doctor', 'doctoral', 'doctorate', 'ms', 'msc', 'ma', 'meng', 'mphil',
  'master', 'masters', 'bachelor', 'bs', 'ba', 'bsc', 'graduate', 'undergraduate',
  'program', 'programme', 'degree', 'studies', 'study', 'department', 'dept',
  'school', 'college', 'faculty', 'the', 'of', 'in', 'and', 'for', 'at',
])

/**
 * Lowercases, strips diacritics and punctuation, and collapses whitespace so
 * "Fei-Fei Li", "FEI FEI LI" and "Li, Fei‑Fei" compare as the same string.
 */
export function normalizeForMatch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    // Combining diacritics, so "Müller" and "Muller" compare equal.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Keep CJK alongside Latin: a professor may be recorded under either.
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .trim()
}

function tokens(value, noise) {
  return normalizeForMatch(value)
    .split(' ')
    .filter((token) => token && !noise.has(token))
}

/**
 * "Li, Fei-Fei" and "Fei-Fei Li" name the same person. A single leading comma
 * is the only reordering worth honouring; anything else is left as written.
 */
function nameParts(value) {
  const raw = String(value ?? '').replace(DEGREE_SUFFIX, '')
  const comma = raw.indexOf(',')
  const reordered = comma > 0
    ? `${raw.slice(comma + 1)} ${raw.slice(0, comma)}`
    : raw
  return tokens(reordered, NAME_NOISE)
}

/**
 * The form of a name to send to a search API.
 *
 * Agencies store "Fei-Fei Li", never "Prof. Fei-Fei Li", and they match the PI
 * field literally: asking NSF for `pdPIName=Prof. Fei-Fei Li` returns nothing
 * at all while `pdPIName=Fei-Fei Li` returns her awards. People type the title
 * into the professor field as a matter of course, so stripping it here is the
 * difference between a working lookup and one that is silently always empty.
 *
 * Only the query is normalized. Display and verification keep the name the
 * user actually wrote.
 */
export function searchablePersonName(value) {
  const parts = nameParts(value)
  if (parts.length === 0) return ''
  // nameParts lowercases for comparison; recover the original spelling for the
  // tokens that survived, so accents and capitalisation reach the API intact.
  const original = String(value ?? '').replace(DEGREE_SUFFIX, '')
  const comma = original.indexOf(',')
  const reordered = comma > 0
    ? `${original.slice(comma + 1)} ${original.slice(0, comma)}`
    : original
  const kept = reordered
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token && !NAME_NOISE.has(normalizeForMatch(token)))
  return kept.join(' ').trim()
}

/**
 * Compares two personal names and reports how strongly they agree.
 *
 * `exact` -- every meaningful token matches.
 * `strong` -- surname and given name both match, with extra middle names on
 *   one side only. This is the ordinary "Kevin Collins" vs "Kevin M Collins".
 * `initial` -- surname matches and the given names agree only on their first
 *   letter. Enough to show, not enough to assert.
 * `none` -- no defensible link.
 */
export function comparePersonNames(queryName, candidateName) {
  const query = nameParts(queryName)
  const candidate = nameParts(candidateName)
  if (query.length === 0 || candidate.length === 0) return 'none'

  const queryKey = query.join(' ')
  const candidateKey = candidate.join(' ')
  if (queryKey === candidateKey) return 'exact'

  // The same tokens in a different order is the same person written the other
  // way round. OpenAlex records Fei-Fei Li as "Li Fei-Fei" with no comma to
  // signal the inversion, and CJK-origin names are commonly filed either way.
  if (
    query.length === candidate.length
    && [...query].sort().join(' ') === [...candidate].sort().join(' ')
  ) return 'exact'

  // A surname is the one token both systems always record. Without it there is
  // nothing to anchor on, and matching on a given name alone invites every
  // "David" in the agency's database.
  const querySurname = query[query.length - 1]
  const candidateSurname = candidate[candidate.length - 1]
  if (querySurname !== candidateSurname) return 'none'

  const queryGiven = query.slice(0, -1)
  const candidateGiven = candidate.slice(0, -1)
  if (queryGiven.length === 0 || candidateGiven.length === 0) return 'none'

  if (queryGiven[0] === candidateGiven[0]) {
    const shorter = Math.min(queryGiven.length, candidateGiven.length)
    const allShared = queryGiven.slice(0, shorter).every((part, index) => part === candidateGiven[index])
    return allShared ? 'strong' : 'initial'
  }
  return queryGiven[0][0] === candidateGiven[0][0] ? 'initial' : 'none'
}

/**
 * True when two institution names plausibly denote the same place. Generic
 * words are dropped first, so "University of Toronto" and "Toronto" agree
 * while "Stanford University" and "Yale University" do not.
 */
export function institutionsAgree(queryInstitution, candidateInstitution) {
  const query = new Set(tokens(queryInstitution, INSTITUTION_NOISE))
  const candidate = new Set(tokens(candidateInstitution, INSTITUTION_NOISE))
  if (query.size === 0 || candidate.size === 0) return null
  for (const token of query) {
    if (candidate.has(token)) return true
  }
  return false
}

/** Shared distinctive words between two programme titles, 0..1. */
export function programOverlap(queryProgram, candidateProgram) {
  const query = new Set(tokens(queryProgram, PROGRAM_NOISE))
  const candidate = new Set(tokens(candidateProgram, PROGRAM_NOISE))
  if (query.size === 0 || candidate.size === 0) return null
  let shared = 0
  for (const token of query) {
    if (candidate.has(token)) shared += 1
  }
  return shared / query.size
}

const NAME_CONFIDENCE = Object.freeze({ exact: 1, strong: 0.9, initial: 0.55, none: 0 })

/**
 * Verdict for one advisor-owned record (an NSF award, a NIH project, a paper).
 *
 * `names` are every person the record credits. A record is verified when one of
 * them is the advisor beyond an initials coincidence; an initials-only hit is
 * downgraded further when the institution actively disagrees, because "J Smith
 * at a different university" is the single most common false positive.
 */
export function verifyAdvisorRecord({ advisorName, institution, names = [], organizations = [] }) {
  const reasons = []
  let best = 'none'
  let matchedName = null
  for (const name of names) {
    const verdict = comparePersonNames(advisorName, name)
    if (NAME_CONFIDENCE[verdict] > NAME_CONFIDENCE[best]) {
      best = verdict
      matchedName = name
    }
  }
  if (best === 'none') {
    return { verified: false, confidence: 0, nameMatch: 'none', institutionMatch: null, matchedName: null, reasons: ['name-mismatch'] }
  }
  reasons.push(`name-${best}`)

  let institutionMatch = null
  for (const organization of organizations) {
    const agrees = institutionsAgree(institution, organization)
    if (agrees === true) { institutionMatch = true; break }
    if (agrees === false) institutionMatch = false
  }
  if (institutionMatch === true) reasons.push('institution-match')
  else if (institutionMatch === false) reasons.push('institution-mismatch')

  let confidence = NAME_CONFIDENCE[best]
  if (institutionMatch === true) confidence = Math.min(1, confidence + 0.1)
  else if (institutionMatch === false) confidence = Math.max(0, confidence - 0.3)

  // An exact name stands on its own -- people move institutions. A full-name
  // match is trusted unless the institution actively disagrees. An initials-only
  // name at a different institution is a different person far more often than
  // not, so it needs the institution to agree before it counts as this advisor.
  const verified = best === 'exact'
    || (best === 'strong' && institutionMatch !== false)
    || (best === 'initial' && institutionMatch === true)

  return {
    verified,
    confidence: Number(confidence.toFixed(2)),
    nameMatch: best,
    institutionMatch,
    matchedName,
    reasons,
  }
}

/**
 * Verdict for one admission-outcome row. GradCafe rows are free text typed by
 * applicants, so the school has to agree and the programme has to share at
 * least one distinctive word before the row counts toward an acceptance rate.
 */
export function verifyOutcomeRecord({ school, program, candidateSchool, candidateProgram }) {
  const reasons = []
  const schoolMatch = institutionsAgree(school, candidateSchool)
  if (schoolMatch === false) {
    return { verified: false, confidence: 0, schoolMatch: false, programOverlap: null, reasons: ['school-mismatch'] }
  }
  if (schoolMatch === true) reasons.push('school-match')

  const overlap = programOverlap(program, candidateProgram)
  if (overlap !== null) reasons.push(overlap > 0 ? 'program-overlap' : 'program-mismatch')

  // Without a comparable school the row cannot be attributed at all; a shared
  // programme word alone would count "CS PhD" results from every university.
  const verified = schoolMatch === true && (overlap === null || overlap > 0)
  const confidence = verified ? Number(Math.min(1, 0.6 + (overlap ?? 0.2) * 0.4).toFixed(2)) : 0
  return { verified, confidence, schoolMatch, programOverlap: overlap, reasons }
}
