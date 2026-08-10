const PROFILE_FIT_STOP_WORDS = new Set([
  'about', 'after', 'also', 'among', 'and', 'are', 'based', 'for', 'from', 'into',
  'method', 'methods', 'our', 'research', 'study', 'the', 'their', 'this', 'through',
  'using', 'with', 'work', 'working',
])

const EVIDENCE_PAGE_KEYS = [
  'pages',
  'advisorPages',
  'researchPages',
]

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}+#.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || url.username || url.password) return ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(?:fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return url.href.replace(/\/$/, '')
  } catch {
    return ''
  }
}

function boundedPhrases(values, limit = 24) {
  const output = []
  const seen = new Set()
  for (const raw of Array.isArray(values) ? values : [values]) {
    for (const part of String(raw || '').split(/[\n,;|/]+/)) {
      const phrase = normalizedText(part).slice(0, 120)
      const usefulWords = phrase.split(' ').filter((word) => (
        word.length >= 3 && !PROFILE_FIT_STOP_WORDS.has(word)
      ))
      if (!phrase || !usefulWords.length || seen.has(phrase)) continue
      seen.add(phrase)
      output.push(phrase)
      if (output.length >= limit) return output
    }
  }
  return output
}

function phraseSupported(phrase, evidence, evidenceWords) {
  if (!phrase || !evidence) return false
  if (evidence.includes(phrase)) return true
  const words = phrase.split(' ').filter((word) => (
    word.length >= 3 && !PROFILE_FIT_STOP_WORDS.has(word)
  ))
  if (!words.length) return false
  if (words.length === 1) return words[0].length >= 5 && evidenceWords.has(words[0])
  const matched = words.filter((word) => evidenceWords.has(word)).length
  return matched >= 2 && matched / words.length >= 0.67
}

function supportedPhrases(phrases, evidence) {
  const evidenceWords = new Set(evidence.split(' ').filter(Boolean))
  return phrases.filter((phrase) => phraseSupported(phrase, evidence, evidenceWords)).slice(0, 12)
}

function schoolForProgram(program, sourceIndex) {
  const schoolName = normalizedText(program?.school)
  return (sourceIndex?.schools || []).find((school) => normalizedText(school?.school) === schoolName) || null
}

function personNameWords(value) {
  return normalizedText(value)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
}

function personNameMatch(left, right) {
  const a = personNameWords(left)
  const b = personNameWords(right)
  if (a.length < 2 || b.length < 2 || a.at(-1) !== b.at(-1)) return null
  if (a.join(' ') === b.join(' ')) return 'exact'
  const aGiven = a.slice(0, -1)
  const bGiven = b.slice(0, -1)
  const compatible = Math.min(aGiven.length, bGiven.length) > 0
    && aGiven.every((word, index) => !bGiven[index] || word[0] === bGiven[index][0])
    && bGiven.every((word, index) => !aGiven[index] || word[0] === aGiven[index][0])
  return compatible ? 'initial' : null
}

function evidenceOverlap(candidate, officialEvidence) {
  const candidateWords = new Set(normalizedText([
    ...(candidate?.matchedQueries || []),
    ...(candidate?.matchedTopics || []).map((topic) => topic?.name),
    ...(candidate?.recentWorks || []).map((work) => work?.title),
  ].filter(Boolean).join(' ')).split(' ').filter((word) => word.length >= 4 && !PROFILE_FIT_STOP_WORDS.has(word)))
  if (!candidateWords.size) return 0
  const officialWords = new Set(officialEvidence.split(' ').filter(Boolean))
  return [...candidateWords].filter((word) => officialWords.has(word)).length / candidateWords.size
}

function scholarlyResearcherFor(pi, school, officialEvidence) {
  const candidates = (school?.scholarlyEvidence?.candidateResearchers || [])
    .map((candidate) => ({
      candidate,
      nameMatch: personNameMatch(pi?.name, candidate?.name),
      overlap: evidenceOverlap(candidate, officialEvidence),
    }))
    .filter((entry) => entry.nameMatch)
    .sort((left, right) => (
      Number(right.nameMatch === 'exact') - Number(left.nameMatch === 'exact')
      || right.overlap - left.overlap
    ))
  if (!candidates.length) return null
  const [best, second] = candidates
  if (best.nameMatch === 'initial' && best.overlap < 0.08) return null
  if (second && best.nameMatch === second.nameMatch && Math.abs(best.overlap - second.overlap) < 0.04) return null
  return best
}

function scholarlyReceipt(pi, school, official, checkedAt) {
  const matched = scholarlyResearcherFor(pi, school, official.evidence)
  if (!matched) return null
  const candidate = matched.candidate
  const recentWorks = (candidate.recentWorks || [])
    .filter((work) => canonicalUrl(work?.source))
    .slice(0, 20)
    .map((work) => ({
      title: String(work.title || '').slice(0, 300),
      year: Number.isInteger(Number(work.year)) ? Number(work.year) : null,
      citedByCount: Math.max(0, Number(work.citedByCount) || 0),
      source: canonicalUrl(work.source),
      matchedQuery: String(work.matchedQuery || '').slice(0, 120),
      matchedTopic: String(work.matchedTopic || '').slice(0, 120) || null,
    }))
  if (!candidate.openAlexId && !candidate.orcid && !candidate.profileUrl && !recentWorks.length) return null
  return {
    openAlexId: canonicalUrl(candidate.openAlexId) || null,
    orcid: canonicalUrl(candidate.orcid) || null,
    profileUrl: canonicalUrl(candidate.profileUrl) || null,
    providers: [...new Set((candidate.providers || []).map((value) => String(value).slice(0, 32)).filter(Boolean))].slice(0, 6),
    matchedQueries: [...new Set((candidate.matchedQueries || []).map((value) => String(value).slice(0, 120)).filter(Boolean))].slice(0, 12),
    recentWorks,
    match: {
      basis: 'institution-scoped-scholarly-record+official-individual-profile',
      nameMatch: matched.nameMatch,
      officialProfileUrl: official.url,
      institutionId: canonicalUrl(school?.scholarlyEvidence?.institution?.openAlexId) || null,
      checkedAt,
    },
  }
}

function officialProfileEvidence(pi, school) {
  const target = canonicalUrl(pi?.url)
  if (!target || !school) return null
  const pages = EVIDENCE_PAGE_KEYS.flatMap((key) => Array.isArray(school?.[key]) ? school[key] : [])
    .filter((page) => (
      canonicalUrl(page?.url) === target
      && page?.fetched === true
      && page?.promptInjectionSuspected !== true
      && (
        page?.individualAdvisor === true
        || (page?.types || []).includes('advisor')
        || (page?.declaredKinds || []).some((kind) => (
          ['advisor', 'faculty'].includes(String(kind || '').toLowerCase())
        ))
      )
    ))
  if (!pages.length) return null
  const evidence = normalizedText(pages.flatMap((page) => [
    page?.title,
    page?.label,
    page?.excerpt,
  ]).filter(Boolean).join(' '))
  const lastName = String(pi?.name || '').trim().split(/\s+/).at(-1)?.toLocaleLowerCase() || ''
  const summary = [...new Set(pages
    .map((page) => {
      const text = String(page?.excerpt || '').replace(/\s+/g, ' ').trim()
      const index = lastName ? text.toLocaleLowerCase().indexOf(lastName) : -1
      const start = index >= 0 ? Math.max(0, index - 180) : 0
      return text.slice(start, start + 2_000)
    })
    .filter(Boolean))]
    .join(' ')
    .slice(0, 2_000)
  return evidence ? { url: String(pi.url), evidence, summary } : null
}

function matchScore(groups) {
  const weighted = [
    [groups.interests, groups.interestPool, 50],
    [groups.methods, groups.methodPool, 30],
    [groups.terms, groups.termPool, 20],
  ]
  let score = 0
  let activeWeight = 0
  for (const [matched, pool, weight] of weighted) {
    if (!pool.length) continue
    activeWeight += weight
    score += (matched.length / pool.length) * weight
  }
  return activeWeight ? Math.max(0, Math.min(100, Math.round((score / activeWeight) * 100))) : 0
}

function deterministicFitSummary(groups) {
  const parts = []
  if (groups.interests.length) parts.push(`research interests: ${groups.interests.join(', ')}`)
  if (groups.methods.length) parts.push(`methods: ${groups.methods.join(', ')}`)
  if (!parts.length && groups.terms.length) parts.push(`research direction: ${groups.terms.join(', ')}`)
  return parts.length
    ? `Verified official-profile overlap with your ${parts.join('; ')}.`
    : 'No explicit overlap with the supplied applicant profile was verified on the fetched official profile.'
}

/**
 * Replace free-form model fit prose with a reproducible comparison between the
 * applicant's own profile and the fetched official individual-advisor page.
 * The model may discover a person, but it cannot manufacture the retained fit.
 */
export function enrichDiscoverAdvisorProfileMatches(programs = [], sourceIndex = null, {
  applicantProfile = null,
  researchTerms = [],
  checkedAt = new Date().toISOString(),
} = {}) {
  const interestPool = boundedPhrases([
    applicantProfile?.researchInterests,
    applicantProfile?.goals,
  ], 20)
  const methodPool = boundedPhrases(applicantProfile?.researchMethods, 16)
  const termPool = boundedPhrases(researchTerms, 32)
  return (programs || []).map((program) => {
    const school = schoolForProgram(program, sourceIndex)
    return {
      ...program,
      pis: (program?.pis || []).map((pi) => {
        const official = officialProfileEvidence(pi, school)
        if (!official) {
          return {
            ...pi,
            research: '',
            whyFit: 'No fetched individual official profile was available to verify research fit.',
            profileMatch: {
              score: 0,
              confidence: 'unknown',
              matchedInterests: [],
              matchedMethods: [],
              matchedResearchTerms: [],
              evidenceUrl: '',
              checkedAt,
              basis: 'applicant-profile+official-individual-profile',
            },
          }
        }
        const groups = {
          interestPool,
          methodPool,
          termPool,
          interests: supportedPhrases(interestPool, official.evidence),
          methods: supportedPhrases(methodPool, official.evidence),
          terms: supportedPhrases(termPool, official.evidence),
        }
        const score = matchScore(groups)
        const scholarly = scholarlyReceipt(pi, school, official, checkedAt)
        const verifiedTopics = [...new Set([
          ...groups.interests,
          ...groups.methods,
          ...groups.terms,
        ])].slice(0, 16)
        return {
          ...pi,
          // The model-written biography is discarded. Preserve the bounded
          // fetched official-profile extract when available; every retained
          // sentence is therefore auditable at profileMatch.evidenceUrl.
          research: official.summary || (verifiedTopics.length
            ? `Official profile mentions ${verifiedTopics.join(', ')}.`
            : ''),
          whyFit: deterministicFitSummary(groups),
          profileMatch: {
            score,
            confidence: score >= 65 ? 'high' : score >= 35 ? 'medium' : score > 0 ? 'low' : 'unknown',
            matchedInterests: groups.interests,
            matchedMethods: groups.methods,
            matchedResearchTerms: groups.terms,
            evidenceUrl: official.url,
            checkedAt,
            basis: 'applicant-profile+official-individual-profile',
          },
          ...(scholarly ? { scholarly } : {}),
        }
      }),
    }
  })
}
