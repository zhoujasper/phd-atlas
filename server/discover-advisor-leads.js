import { findSchoolSourceEntry, isOfficialSchoolUrl } from './discover-source-grounding.js'

const DIRECTORY_ROOT = /\/(?:people|faculty|staff|directory|profiles?|experts?|researchers?|team|members?)\/?$/i

function words(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function pageSignal(page) {
  let pathname = ''
  try { pathname = new URL(page?.url).pathname } catch { /* rejected later */ }
  return words(`${page?.title || ''} ${page?.label || ''} ${pathname}`).join(' ')
}

function matchScore(name, page) {
  const nameWords = words(name).filter((word) => word.length > 1)
  if (nameWords.length < 2) return 0
  const signal = ` ${pageSignal(page)} `
  const first = nameWords[0]
  const last = nameWords.at(-1)
  if (!signal.includes(` ${last} `)) return 0
  const matched = nameWords.filter((word) => signal.includes(` ${word} `)).length
  if (!signal.includes(` ${first} `) && matched < Math.min(2, nameWords.length)) return 0
  return matched / nameWords.length
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
        .filter((entry) => entry.score >= 0.66)
        .sort((left, right) => right.score - left.score || Number(right.page.fetched) - Number(left.page.fetched))[0]
      if (!match || seenUrls.has(match.page.url)) continue
      seenUrls.add(match.page.url)
      pis.push({
        name: String(researcher.name || '').slice(0, 180),
        url: match.page.url,
        openAlexId: researcher.openAlexId || null,
        matchedQueries: (researcher.matchedQueries || []).slice(0, 4),
        leadOnly: true,
      })
      if (pis.length >= Math.min(20, Math.max(1, Number(maxProfilesPerSchool) || 10))) break
    }
    if (pis.length) output.push({
      ...program,
      pis,
      advisorLeadOnly: true,
    })
  }
  return output
}
