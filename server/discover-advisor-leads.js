import { findSchoolSourceEntry, isOfficialSchoolUrl } from './discover-source-grounding.js'
import { isLikelyAdvisorPersonName } from './discover-person-identity.js'

const DIRECTORY_ROOT = /\/(?:people|faculty|staff|directory|profiles?|experts?|researchers?|team|members?)\/?$/i
const GENERIC_NAME_WORDS = new Set([
  'about', 'academic', 'advice', 'advisory', 'an', 'and', 'at', 'beirat', 'board', 'central',
  'academy', 'ag', 'assemblies', 'cluster', 'college', 'committee', 'communication',
  'computer', 'course', 'courses', 'department', 'descriptions', 'doctoral',
  'der', 'directory', 'diversity', 'doctor', 'dr', 'faculty', 'geschaftsstelle', 'geschäftsstelle',
  'engineering', 'facilities', 'formalities', 'general', 'gesundheit', 'graduate',
  'group', 'habilitation', 'healthy', 'help', 'home', 'html', 'human',
  'interfaculty', 'investigator', 'investigators', 'it', 'leadership', 'management',
  'media', 'member', 'members', 'memoriam', 'office', 'of', 'people', 'person', 'phd',
  'principal', 'professor', 'pub',
  'profile', 'resources', 'rooms', 'research', 'researcher', 'school', 'staff',
  'staying', 'steering', 'student', 'students', 'studies', 'team', 'tubingen', 'tübingen',
  'university', 'universitat', 'universität', 'use', 'wissenschaftlicher',
])
const PERSON_PROFILE_SIGNAL = /\b(?:prof(?:essor)?|doctor|dr\.?|faculty|lecturer|researcher|principal investigator|group leader|biography|research interests?|publications?)\b/i
const SUPERVISOR_ROLE_SIGNAL = /\b(?:(?:full|associate|assistant|adjunct|emeritus|tenured)\s+)?professor\b|\b(?:principal investigator|group leader|lab(?:oratory)? head|faculty member|academic staff|research director|chair|reader|senior lecturer|lecturer)\b/i

function words(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function pageSignal(page) {
  let pathname = ''
  try {
    pathname = decodeURIComponent(new URL(page?.url).pathname)
  } catch {
    try { pathname = new URL(page?.url).pathname } catch { /* rejected later */ }
  }
  return words(`${page?.title || ''} ${page?.label || ''} ${pathname} ${page?.excerpt || ''}`).join(' ')
}

function declaredAdvisorSeed(page) {
  return (page?.declaredKinds || []).some((kind) => (
    ['advisor', 'faculty'].includes(String(kind || '').toLowerCase())
  ))
}

function supervisorProfileSignal(page) {
  return declaredAdvisorSeed(page)
    || SUPERVISOR_ROLE_SIGNAL.test(`${page?.title || ''} ${page?.label || ''} ${page?.excerpt || ''}`)
}

function profileUrlIdentity(value) {
  try {
    const url = new URL(String(value || ''))
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.hash = ''
    url.searchParams.delete('lang')
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    url.searchParams.sort()
    return url.href.replace(/\/$/, '')
  } catch {
    return String(value || '').trim()
  }
}

function multiPersonProfilePage(page) {
  let pathname = ''
  try { pathname = new URL(page?.url).pathname } catch { /* invalid URLs fail elsewhere */ }
  return /\b(?:leadership|team|members?|faculty|board|committee|research group)\b/i
    .test(`${pathname.replace(/[/_-]+/g, ' ')} ${page?.title || ''} ${page?.label || ''}`)
}

function profilePageIdentity(page, name = '') {
  const base = profileUrlIdentity(page?.url)
  return multiPersonProfilePage(page)
    ? `${base}\n${words(name).join(' ')}`
    : base
}

function matchScore(name, page) {
  const nameWords = words(name)
  if (!nameWords.length) return 0
  const signalWords = words(pageSignal(page))
  const signal = ` ${signalWords.join(' ')} `
  const signalSet = new Set(signalWords)
  const compactName = nameWords.join('')
  const exactWindow = signalWords.some((_, index) => (
    signalWords.slice(index, index + nameWords.length).join('') === compactName
  ))
  if (compactName.length >= 2 && exactWindow) return 1
  if (nameWords.length === 1) {
    const [only] = nameWords
    if (only.length < 2 || !signalSet.has(only)) return 0
    return [...only].some((character) => character.codePointAt(0) > 127) || only.length >= 4 ? 0.94 : 0
  }
  const last = nameWords.at(-1)
  if (!signal.includes(` ${last} `)) return 0
  let matchedWeight = 0.45
  const remainingWeight = 0.55 / Math.max(1, nameWords.length - 1)
  for (const word of nameWords.slice(0, -1)) {
    if (signalSet.has(word)) {
      matchedWeight += remainingWeight
      continue
    }
    const initialMatch = word.length === 1
      ? signalWords.some((candidate) => candidate.startsWith(word))
      : signalSet.has(word[0])
    if (initialMatch) matchedWeight += remainingWeight * 0.82
  }
  return matchedWeight
}

function isIndividualProfile(page, schoolEntry) {
  if (!page?.url || page?.promptInjectionSuspected || !isOfficialSchoolUrl(page.url, schoolEntry)) return false
  try {
    const url = new URL(page.url)
    const declaredAdvisor = declaredAdvisorSeed(page)
    const pathDepth = url.pathname.split('/').filter(Boolean).length
    return !DIRECTORY_ROOT.test(url.pathname)
      && (pathDepth >= 2 || (declaredAdvisor && pathDepth >= 1))
  } catch {
    return false
  }
}

function likelyPersonName(value, schoolName) {
  const clean = String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:prof(?:essor)?|dr)\.?\s+/i, '')
  if (!isLikelyAdvisorPersonName(clean)) return ''
  const tokens = clean.split(' ').filter(Boolean)
  if (tokens.length < 2 || tokens.length > 6) return ''
  const normalizedSchoolWords = new Set(words(schoolName))
  const normalized = words(clean)
  if (normalized.length < 2 || normalized.some((token) => GENERIC_NAME_WORDS.has(token))) return ''
  if (normalized.filter((token) => normalizedSchoolWords.has(token)).length >= Math.min(2, normalized.length)) return ''
  if (!tokens.every((token) => /^[\p{L}'’.]+$/u.test(token))) return ''
  return tokens.map((token) => token.length > 1
    ? `${token[0].toLocaleUpperCase()}${token.slice(1)}`
    : token.toLocaleUpperCase()).join(' ').slice(0, 180)
}

function profilePageName(page, schoolName) {
  const segments = [page?.label, page?.title]
    .flatMap((value) => String(value || '').split(/\s*(?:\||·|–|—|:)\s*|\s+-\s+/))
  try {
    const pathParts = decodeURIComponent(new URL(page?.url).pathname)
      .split('/')
      .filter(Boolean)
      .reverse()
    segments.push(...pathParts.slice(0, 2))
  } catch { /* invalid URLs are rejected by isIndividualProfile */ }
  const structuralName = segments.map((value) => likelyPersonName(value, schoolName)).find(Boolean)
  if (structuralName) return structuralName
  const academicName = String(page?.excerpt || '').match(
    /\bprof(?:essor)?\.?\s*(?:dr\.?\s*)?([\p{L}'’.-]+)\s+([\p{L}'’.-]+)/iu,
  )
  return academicName
    ? likelyPersonName(`${academicName[1]} ${academicName[2]}`, schoolName)
    : ''
}

/**
 * Match OpenAlex discovery names to links already found on an official faculty
 * directory. The output remains a crawl lead: it must be fetched and then pass
 * the individual-name grounding check before it can become a saved PI.
 */
export function deriveOfficialAdvisorProfileLeads(programs, sourceIndex, {
  maxProfilesPerSchool = 500,
} = {}) {
  const output = []
  const seenSchools = new Set()
  for (const program of programs || []) {
    const school = findSchoolSourceEntry(program, sourceIndex)
    if (!school || seenSchools.has(school.school)) continue
    seenSchools.add(school.school)
    const researchers = school.scholarlyEvidence?.candidateResearchers || []
    const pages = (school.advisorPages || []).filter((page) => (
      isIndividualProfile(page, school) && supervisorProfileSignal(page)
    ))
    const pis = []
    const seenUrls = new Set()
    for (const researcher of researchers) {
      const match = pages
        .map((page) => ({ page, score: matchScore(researcher?.name, page) }))
        .filter((entry) => entry.score >= 0.72)
        .sort((left, right) => right.score - left.score || Number(right.page.fetched) - Number(left.page.fetched))[0]
      const urlIdentity = profilePageIdentity(match?.page, researcher?.name)
      if (!match || seenUrls.has(urlIdentity)) continue
      seenUrls.add(urlIdentity)
      pis.push({
        name: String(researcher.name || '').slice(0, 180),
        url: match.page.url,
        openAlexId: researcher.openAlexId || null,
        orcid: researcher.orcid || null,
        scholarlyProfileUrl: researcher.profileUrl || null,
        scholarlyProviders: (researcher.providers || []).slice(0, 4),
        matchedQueries: (researcher.matchedQueries || []).slice(0, 8),
        leadOnly: true,
      })
      if (pis.length >= Math.min(500, Math.max(1, Number(maxProfilesPerSchool) || 500))) break
    }
    // A publication index is useful for ranking, but it must not become a
    // recall gate. Retain every remaining individually identified official
    // profile that exposes a conservative person name; the later official-page
    // grounding and deterministic profile matcher can still reject it or rank
    // it at zero when the applicant has no verified overlap.
    for (const page of pages) {
      if (page.fetched !== true || !PERSON_PROFILE_SIGNAL.test(`${page.title || ''} ${page.label || ''} ${page.excerpt || ''}`)) continue
      const name = profilePageName(page, school.school)
      if (!name) continue
      const urlIdentity = profilePageIdentity(page, name)
      if (seenUrls.has(urlIdentity)) continue
      seenUrls.add(urlIdentity)
      pis.push({ name, url: page.url, leadOnly: true })
      if (pis.length >= Math.min(500, Math.max(1, Number(maxProfilesPerSchool) || 500))) break
    }
    if (pis.length) output.push({
      ...program,
      pis,
      advisorLeadOnly: true,
    })
  }
  return output
}
