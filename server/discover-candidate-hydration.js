const DOCTORAL_SIGNAL = /(?:^|[^\p{L}\p{N}])(?:ph\s*\.?\s*d\s*\.?|d\s*\.?\s*phil\s*\.?|doctoral|doctorate|doctor\s+of\s+philosophy|doctorats?|doctorad[oa]s?|dottorat[oi]|doutor(?:ad[oa]s?|amento)|promotion(?:sstudium|en)?|博士|박사|ปริญญาเอก|tiến\s+sĩ|докторантур)(?=$|[^\p{L}\p{N}])/iu
const DOCTORAL_PATH = /(?:^|[/_.-])(?:phd|ph-d|dphil|doctoral|doctorate|doctorats?|doctorad[oa]s?|dottorat[oi]|doutorad[oa]s?|doktorat|promotion(?:en)?|博士|박사)(?:[/_.-]|$)/iu
const PROGRAM_PATH = /(?:^|[/_.-])(?:program|programs|programme|programmes|degree|degrees|course|courses|admission|admissions|graduate|postgraduate|research-degree|research-degrees)(?:[/_.-]|$)/iu
const EXCLUDED_PATH = /\/(?:(?:[^/]+[-_])?(?:news(?:room)?|nouvelles|notizie|noticias|nachrichten|nieuws|nyheter|uutiset|новости|新闻|新聞|ニュース|뉴스|events?|calendar|stories|articles?|press|media|blogs?|announcements?)(?:[-_][^/]*)?|people|persons?|faculty|staff|directory|profiles?|experts?|researchers?|team|members?)(?:\/|$)/iu

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return ''
    url.hash = ''
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return ''
  }
}

function decodedPath(value) {
  try {
    const url = new URL(String(value || ''))
    try { return decodeURIComponent(`${url.pathname}${url.search}`) } catch { return `${url.pathname}${url.search}` }
  } catch {
    return ''
  }
}

function pageTypes(page) {
  return new Set((page?.types || []).map((type) => String(type || '').toLowerCase()).filter(Boolean))
}

export function discoverCandidateHydrationScore(page) {
  const url = canonicalUrl(page?.url)
  const types = pageTypes(page)
  if (
    !url
    || page?.fetched === true
    || page?.promptInjectionSuspected === true
    || page?.individualAdvisor === true
    || (!types.has('program') && !types.has('admissions'))
  ) return Number.NEGATIVE_INFINITY
  const path = decodedPath(url)
  if (EXCLUDED_PATH.test(path)) return Number.NEGATIVE_INFINITY
  const label = `${String(page?.title || '')} ${String(page?.label || '')}`
  const doctoralLabel = DOCTORAL_SIGNAL.test(label)
  const doctoralPath = DOCTORAL_PATH.test(path)
  if (!doctoralLabel && !doctoralPath) return Number.NEGATIVE_INFINITY
  const relevance = Math.max(0, Number(page?.relevanceScore) || 0)
  const priority = Math.max(0, Number(page?.priority) || 0)
  const junkPenalty = Math.max(0, Number(page?.junkPenalty) || 0)
  return (
    (doctoralLabel ? 180 : 0)
    + (doctoralPath ? 120 : 0)
    + (PROGRAM_PATH.test(path) ? 45 : 0)
    + (types.has('program') ? 40 : 0)
    + (types.has('admissions') ? 12 : 0)
    + relevance * 2
    + Math.min(80, priority * 0.2)
    - junkPenalty
  )
}

/**
 * Turn the strongest already-indexed but unfetched doctoral links into bounded
 * hydration requests. These records are never persisted as programs; they only
 * cause the normal official crawler to fetch a page before deterministic and AI
 * discovery run.
 */
export function selectDiscoverCandidateHydrationPrograms(crawls = [], {
  schoolLimit = 20,
  perSchool = 2,
  totalLimit = 40,
} = {}) {
  const boundedSchoolLimit = Math.min(64, Math.max(1, Number(schoolLimit) || 20))
  const boundedPerSchool = Math.min(6, Math.max(1, Number(perSchool) || 2))
  const boundedTotal = Math.min(240, Math.max(1, Number(totalLimit) || 40))
  const schools = []
  for (const result of crawls || []) {
    const school = String(result?.source?.school || '').trim().slice(0, 220)
    if (!school) continue
    const pages = (result?.candidatePages || [])
      .map((page) => ({ page, score: discoverCandidateHydrationScore(page) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score || String(left.page.url).localeCompare(String(right.page.url)))
      .slice(0, boundedPerSchool)
    if (pages.length) {
      schools.push({
        school,
        region: String(result?.source?.region || '').trim().slice(0, 32),
        topScore: pages[0].score,
        pages,
      })
    }
  }
  schools.sort((left, right) => right.topScore - left.topScore || left.school.localeCompare(right.school))
  const selectedSchools = schools.slice(0, boundedSchoolLimit)
  const output = []
  for (let pageIndex = 0; pageIndex < boundedPerSchool && output.length < boundedTotal; pageIndex += 1) {
    for (const school of selectedSchools) {
      const entry = school.pages[pageIndex]
      if (!entry) continue
      const url = canonicalUrl(entry.page.url)
      if (!url) continue
      output.push({
        id: `candidate-hydration:${encodeURIComponent(school.school)}:${output.length + 1}`,
        school: school.school,
        region: school.region,
        program: String(entry.page.title || entry.page.label || 'Doctoral programme candidate').slice(0, 220),
        website: url,
        sources: [url],
        pis: [],
        candidateHydrationOnly: true,
        candidateHydrationScore: Number(entry.score.toFixed(3)),
      })
      if (output.length >= boundedTotal) break
    }
  }
  return output
}
