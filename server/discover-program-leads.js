const PROGRAM_PAGE_TYPES = new Set(['program', 'admissions'])
const DECLARED_PROGRAM_KINDS = new Set(['doctoral', 'program', 'admissions'])
const DOCTORAL_LABEL = /(?:^|[^\p{L}\p{N}])(?:ph\s*\.?\s*d\s*\.?|d\s*\.?\s*phil\s*\.?|doctoral|doctorate|doctor\s+of\s+philosophy|doctorats?|doctorad[oa]s?|dottorat[oi]|doutor(?:ad[oa]s?|amento)|promotion(?:sstudium|en)?|博士|박사|ปริญญาเอก|tiến\s+sĩ|докторантур)(?=$|[^\p{L}\p{N}])/iu
const PERSON_OR_DIRECTORY_PATH = /\/(?:people[_-]?individual|people|persons?|faculty|staff|directory|profiles?|experts?|researchers?|team|members?)(?:\/|$)/i
const NEWS_OR_EVENT_PATH = /\/(?:[^/]+[-_])?(?:news(?:room)?|nouvelles|notizie|noticias|nachrichten|nieuws|nyheter|uutiset|новости|新闻|新聞|ニュース|뉴스|events?|calendar|stories|articles?|press|media|blogs?|announcements?)(?:[-_][^/]*)?(?:\/|$)/iu
const NON_PROGRAM_DETAIL_SLUG = /^(?:admissions?|apply|applications?|requirements?|deadlines?|funding|scholarships?|fees?|tuition|support|resources?|handbooks?|polic(?:y|ies)|regulations?|rules?|forms?|calls?|rankings?|results?|mobility|collaborations?|collaborazioni(?:[-_].*)?|mobilita(?:[-_].*)?|supporto(?:[-_].*)?|bandi(?:[-_].*)?|graduatorie(?:[-_].*)?|borse(?:[-_].*)?|regolament[oi](?:[-_].*)?|financement|candidature|mobilite|reglement|becas|convocatorias|movilidad|admision|bewerbung|finanzierung|stipendien|ordnung|募集|入試|招生|奨学金|奖学金|입학|장학금)$/iu
const STRONG_PROGRAM_PATH_TERMS = new Set([
  'phd', 'dphil', 'doctoral', 'doctorate',
  'program', 'programs', 'programme', 'programmes',
  'admission', 'admissions', 'degree', 'degrees', 'course', 'courses',
  'doctorat', 'doctorats', 'doctorado', 'doctorados', 'doctorada', 'doctoradas',
  'dottorato', 'dottorati', 'doutorado', 'doutorados', 'doutorada', 'doutoradas',
  'doktorat', 'promotion', 'promotionen',
  '博士', '박사', 'ปริญญาเอก', 'tiến sĩ', 'докторантур',
])

function cleanText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => cleanText(value, 120)).filter(Boolean))]
}

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
}

function parseOfficialUrl(value) {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || (parsed.port && parsed.port !== '443')
    ) return null
    parsed.hash = ''
    return parsed
  } catch {
    return null
  }
}

function canonicalUrl(value) {
  const parsed = parseOfficialUrl(value)
  if (!parsed) return ''
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString()
}

function sourceHosts(source) {
  const hosts = uniqueStrings(source?.allowedHosts).map(cleanHost)
  const official = parseOfficialUrl(source?.url || source?.officialUrl)
  if (official) hosts.push(cleanHost(official.hostname))
  return [...new Set(hosts.filter(Boolean))]
}

function isOfficialPage(url, source) {
  const parsed = parseOfficialUrl(url)
  if (!parsed) return false
  const hostname = cleanHost(parsed.hostname)
  return sourceHosts(source).some((allowed) => (
    hostname === allowed || hostname.endsWith(`.${allowed}`)
  ))
}

function pageDeclaredKinds(page) {
  return uniqueStrings([
    ...(Array.isArray(page?.declaredKinds) ? page.declaredKinds : []),
    page?.declaredKind,
  ]).map((kind) => kind.toLowerCase())
}

function declaredProgramUrls(source) {
  return new Set((source?.seeds || [])
    .filter((seed) => DECLARED_PROGRAM_KINDS.has(cleanText(seed?.kind, 32).toLowerCase()))
    .map((seed) => canonicalUrl(seed?.url))
    .filter(Boolean))
}

function decodedPathname(value) {
  try {
    const pathname = new URL(value).pathname
    try { return decodeURIComponent(pathname) } catch { return pathname }
  } catch {
    return ''
  }
}

function hasDoctoralName(page) {
  return [page?.title, page?.label].some((value) => DOCTORAL_LABEL.test(cleanText(value, 220)))
}

function hasStrongProgramPath(value) {
  const signal = normalizeForMatch(decodedPathname(value))
  const terms = signal.split(' ').filter(Boolean)
  return terms.some((term) => STRONG_PROGRAM_PATH_TERMS.has(term))
    || includesWholeTerm(signal, 'ph d')
    || includesWholeTerm(signal, 'd phil')
}

function isExcludedContentPath(value) {
  const pathname = decodedPathname(value)
  const slug = pathname.split('/').filter(Boolean).at(-1) || ''
  return PERSON_OR_DIRECTORY_PATH.test(pathname)
    || NEWS_OR_EVENT_PATH.test(pathname)
    || NON_PROGRAM_DETAIL_SLUG.test(slug)
}

function programDeclaration(page, source, declaredPageUrls) {
  const kinds = pageDeclaredKinds(page)
  if (kinds.some((kind) => DECLARED_PROGRAM_KINDS.has(kind))) {
    return { basis: 'page-metadata', kinds }
  }
  if (declaredProgramUrls(source).has(canonicalUrl(page?.url))) {
    return { basis: 'source-doctoral-seed', kinds }
  }
  if (declaredPageUrls.has(canonicalUrl(page?.url))) {
    return { basis: 'source-index-program-bucket', kinds }
  }
  if (hasDoctoralName(page) && hasStrongProgramPath(page?.url) && !isExcludedContentPath(page?.url)) {
    return { basis: 'dual-page-signals', kinds }
  }
  return null
}

function normalizeFieldTerms(value) {
  const raw = Array.isArray(value) ? value : [value]
  const terms = raw.flatMap((item) => cleanText(item, 240).split(/[,;\n]/))
  const byNormalized = new Map()
  for (const term of terms) {
    const display = cleanText(term, 120)
    const normalized = normalizeForMatch(display)
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, display)
  }
  return [...byNormalized].map(([normalized, display]) => ({ normalized, display }))
}

function normalizeForMatch(value) {
  return cleanText(value, 500)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function includesWholeTerm(signal, term) {
  return (` ${signal} `).includes(` ${term} `)
}

function normalizedInputEntries(input) {
  const values = Array.isArray(input)
    ? input
    : (Array.isArray(input?.schools) ? input.schools : [])
  return values.map((entry) => {
    if (entry?.source) {
      return { source: entry.source, pages: entry.pages || [], declaredPageUrls: new Set() }
    }
    const typedProgramPages = [
      ...(entry?.programPages || []),
      ...(entry?.admissionsPages || []),
    ]
    return {
      source: {
        school: entry?.school,
        region: entry?.region,
        url: entry?.officialUrl,
        allowedHosts: entry?.allowedHosts,
        seeds: entry?.seeds,
      },
      pages: entry?.pages?.length ? entry.pages : typedProgramPages,
      declaredPageUrls: new Set(typedProgramPages.map((page) => canonicalUrl(page?.url)).filter(Boolean)),
    }
  })
}

function eligibleNames(page, fieldTerms) {
  return [
    { source: 'title', value: cleanText(page?.title, 220), sourcePriority: 1 },
    { source: 'label', value: cleanText(page?.label, 220), sourcePriority: 0 },
  ]
    .filter((candidate) => candidate.value && DOCTORAL_LABEL.test(candidate.value))
    .map((candidate) => {
      const signal = normalizeForMatch(candidate.value)
      const matchedFieldTerms = fieldTerms
        .filter((term) => includesWholeTerm(signal, term.normalized))
        .map((term) => term.display)
      return { ...candidate, matchedFieldTerms }
    })
    .sort((left, right) => (
      right.matchedFieldTerms.length - left.matchedFieldTerms.length
      || right.sourcePriority - left.sourcePriority
      || left.value.localeCompare(right.value)
    ))
}

function pageTypes(page) {
  return uniqueStrings(page?.types).map((type) => type.toLowerCase())
}

function boundedLimit(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 240
  return Math.min(1_000, Math.max(1, Math.floor(parsed)))
}

/**
 * Derive lead-only programme candidates from already-fetched official pages.
 *
 * This deliberately does not create a Discover programme record. The selected
 * candidate label is copied verbatim from the fetched page title or link label,
 * and callers must still ask the research agent to verify the exact programme.
 * A crawl result array or a source-index document with declaration metadata is
 * accepted. Source-index pages without declaration metadata fail closed.
 */
export function deriveOfficialProgramLeads(input, {
  fieldTerms = [],
  requireFieldMatch = false,
  limit = 240,
} = {}) {
  const normalizedTerms = normalizeFieldTerms(fieldTerms)
  const leads = []
  const seen = new Set()

  for (const { source, pages, declaredPageUrls } of normalizedInputEntries(input)) {
    const school = cleanText(source?.school, 220)
    const region = cleanText(source?.region, 32)
    if (!school || !sourceHosts(source).length) continue

    for (const page of pages || []) {
      const types = pageTypes(page)
      const url = canonicalUrl(page?.url)
      const declaration = programDeclaration(page, source, declaredPageUrls)
      if (
        page?.fetched !== true
        || page?.promptInjectionSuspected
        || !url
        || !types.some((type) => PROGRAM_PAGE_TYPES.has(type))
        || !declaration
        || !isOfficialPage(url, source)
        || isExcludedContentPath(url)
      ) continue

      const names = eligibleNames(page, normalizedTerms)
      if (!names.length) continue
      const selected = names[0]
      if (requireFieldMatch && normalizedTerms.length && !selected.matchedFieldTerms.length) continue

      const dedupeKey = `${school.toLowerCase()}\n${url}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const title = cleanText(page?.title, 220) || null
      const label = cleanText(page?.label, 220) || null
      leads.push({
        leadType: 'official-program-page',
        school,
        region,
        candidateLabel: selected.value,
        candidateLabelSource: selected.source,
        officialUrl: url,
        matchedFieldTerms: selected.matchedFieldTerms,
        fieldMatchScore: normalizedTerms.length
          ? Number((selected.matchedFieldTerms.length / normalizedTerms.length).toFixed(3))
          : null,
        verification: 'fetched-official-declared-page',
        canPersistProgramFact: false,
        evidence: {
          url,
          title,
          label,
          pageTypes: types.filter((type) => PROGRAM_PAGE_TYPES.has(type)),
          declaredKinds: declaration.kinds,
          declarationBasis: declaration.basis,
          fetched: true,
          official: true,
          untrusted: true,
        },
      })
    }
  }

  return leads
    .sort((left, right) => (
      (right.fieldMatchScore ?? -1) - (left.fieldMatchScore ?? -1)
      || Number(right.evidence.pageTypes.includes('program')) - Number(left.evidence.pageTypes.includes('program'))
      || left.school.localeCompare(right.school)
      || left.candidateLabel.localeCompare(right.candidateLabel)
      || left.officialUrl.localeCompare(right.officialUrl)
    ))
    .slice(0, boundedLimit(limit))
}
