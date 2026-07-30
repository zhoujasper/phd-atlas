import { findSchoolSourceEntry, isOfficialSchoolUrl } from './discover-source-grounding.js'

const DIRECTORY_ROOT = /\/(?:people|faculty|staff|directory|profiles?|experts?|researchers?|team|members?)\/?$/i

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
  return words(`${page?.title || ''} ${page?.label || ''} ${pathname}`).join(' ')
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
    return !DIRECTORY_ROOT.test(url.pathname)
      && url.pathname.split('/').filter(Boolean).length >= 2
  } catch {
    return false
  }
}

/**
 * Match OpenAlex discovery names to links already found on an official faculty
 * directory. The output remains a crawl lead: it must be fetched and then pass
 * the individual-name grounding check before it can become a saved PI.
 */
export function deriveOfficialAdvisorProfileLeads(programs, sourceIndex, {
  maxProfilesPerSchool = 10,
} = {}) {
  const output = []
  const seenSchools = new Set()
  for (const program of programs || []) {
    const school = findSchoolSourceEntry(program, sourceIndex)
    if (!school || seenSchools.has(school.school)) continue
    seenSchools.add(school.school)
    const researchers = school.scholarlyEvidence?.candidateResearchers || []
    const pages = (school.advisorPages || []).filter((page) => isIndividualProfile(page, school))
    const pis = []
    const seenUrls = new Set()
    for (const researcher of researchers) {
      const match = pages
        .map((page) => ({ page, score: matchScore(researcher?.name, page) }))
        .filter((entry) => entry.score >= 0.72)
        .sort((left, right) => right.score - left.score || Number(right.page.fetched) - Number(left.page.fetched))[0]
      if (!match || seenUrls.has(match.page.url)) continue
      seenUrls.add(match.page.url)
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
      if (pis.length >= Math.min(40, Math.max(1, Number(maxProfilesPerSchool) || 10))) break
    }
    if (pis.length) output.push({
      ...program,
      pis,
      advisorLeadOnly: true,
    })
  }
  return output
}
