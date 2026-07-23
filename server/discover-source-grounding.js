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

const DOCTORAL_SIGNAL = /(?:^|[^\p{L}\p{N}])(?:ph\s*\.?\s*d\s*\.?|d\s*\.?\s*phil\s*\.?|doctoral|doctorate|doctor\s+of\s+philosophy|doctorat|doctorado|dottorato|doutor(?:ado|amento)|promotion(?:sstudium)?|博士|박사|ปริญญาเอก|tiến\s+sĩ|докторантур)(?=$|[^\p{L}\p{N}])/iu
const MASTERS_SIGNAL = /(?:^|[^\p{L}\p{N}])(?:masters?|master\s+of|m\s*\.?\s*sc\s*\.?|msc|m\s*\.?\s*phil\s*\.?|mphil|m\s*\.?\s*eng\s*\.?|meng|m\s*\.?\s*a\s*\.?)(?=$|[^\p{L}\p{N}])/iu
const UNDERGRADUATE_SIGNAL = /(?:^|[^\p{L}\p{N}])(?:undergraduate|bachelors?|bachelor\s+of|b\s*\.?\s*sc\s*\.?|bsc|b\s*\.?\s*eng\s*\.?|beng|b\s*\.?\s*a\s*\.?)(?=$|[^\p{L}\p{N}])/iu

function hasDoctoralSignal(value) {
  return DOCTORAL_SIGNAL.test(String(value || ''))
}

function hasNonDoctoralDegreeSignal(value) {
  const text = String(value || '')
  return MASTERS_SIGNAL.test(text) || UNDERGRADUATE_SIGNAL.test(text)
}

function isNonDoctoralOnlyIdentity(value) {
  return hasNonDoctoralDegreeSignal(value) && !hasDoctoralSignal(value)
}

const GENERIC_PROGRAM_LABELS = [
  /^(?:ph\.?d|dphil|doctoral)\s+opportunit(?:y|ies)\s+in\b/i,
  /^(?:not found|unknown|n\/?a|none|tbd|—|-+)$/i,
  /^(?:page\s+not\s+found|doctor\s+of\s+philosophy)$/i,
  /^(?:admissions?|admission\s+information|application\s+information)$/i,
  /^(?:program(?:me)?\s+information)(?:\s*(?:&|and|\/|[-—–])\s*(?:deadlines?|admissions?|requirements?))*$/i,
  /^(?:application\s+)?deadlines?(?:\s*(?:&|and|\/|[-—–])\s*(?:program(?:me)?\s+information|admissions?|requirements?))*$/i,
  /^(?:find|search|browse)\s+(?:(?:a|your)\s+)?(?:program(?:me)?s?|ph\.?d|doctoral(?:\s+degree)?)$/i,
  /^(?:ph\.?d|dphil|doctoral|doctorate)$/i,
  /^(?:get\s+)?(?:a\s+)?(?:ph\.?d|doctoral)\s+education\s+at\s+.+$/i,
  /^(?:ph\.?d|dphil)\s+program(?:me)?s?$/i,
  /^doctor\s+of\s+philosophy(?:\s*\(\s*ph\.?d\.?\s*\))?\s+program(?:me)?s?$/i,
  /^(?:doctoral|postgraduate|graduate)\s+(?:degrees?|stud(?:y|ies)|program(?:me)?s?|admissions?)$/i,
  /^(?:ph\.?d|doctoral)\s+program(?:me)?\s+at\s+.+$/i,
  /^(?:ph\.?d|dphil|doctorate|doctoral\s+stud(?:y|ies))\s+at\s+.+$/i,
  /^doctoral\s+stud(?:y|ies)\s+at\s+.+$/i,
  /^(?:about|overview\s+of|introduction\s+to)\s+(?:ph\.?d|doctoral|doctorate)\s+stud(?:y|ies)(?:\s+(?:at|in)\s+.+)?$/i,
  /^(?:guide\s+to|guidance\s+on)\s+(?:applying\s+for\s+)?(?:ph\.?d|doctoral|doctorate)\s+stud(?:y|ies)(?:\s+(?:at|in)\s+.+)?$/i,
  /^phds?\s+and\s+research\s+degrees?$/i,
  /^postgraduate\s+research\s+home$/i,
  /^postgraduate\s+research\s+programmes?(?:\s+and\s+centres?\s+for\s+doctoral\s+training)?$/i,
  /^(?:postgraduate|graduate)\s+research(?:\s+(?:degrees?|program(?:me)?s?|opportunit(?:y|ies)))?(?:\s+(?:at|in)\s+.+)?$/i,
  /^postgraduate\s+admissions?(?:\s*[|—-].*)?$/i,
  /^(?:ph\.?d|dphil|doctoral)\s+admissions?(?:\s*[|—–-].*)?$/i,
  /^(?:guide\s+to\s+)?doctoral\s+stud(?:y|ies)(?:\s+(?:at|in)\s+.+)?$/i,
  /^(?:ph\.?d|doctoral)\s+research(?:\s+(?:degrees?|program(?:me)?s?|opportunit(?:y|ies)))?(?:\s+(?:at|in)\s+.+)?$/i,
  /^research\s+(?:degrees?|program(?:me)?s?)(?:\s+in\s+.+)?$/i,
  /^(?:ph\.?d|dphil|doctoral)\s+program(?:me)?s(?:\s+in\s+.+)?$/i,
  /^(?:postgraduate|doctoral|ph\.?d)\s+student\s+(?:early\s+)?recruit(?:ing|ment)(?:\s*[|—–-].*)?$/i,
]

export function isGenericProgramLabel(value) {
  const label = String(value || '')
    .replace(/\bph\s*\.?\s*d\.?/gi, 'PhD')
    .replace(/\bd\s*\.?\s*phil\.?/gi, 'DPhil')
    .replace(/\s+/g, ' ')
    .trim()
  const primaryLabel = label.split(/\s+(?:\||—|–)\s+/)[0].trim()
  const brandedDashPrefix = label.match(
    /^(.+?)\s+-\s+(?:(?:the\s+)?(?:university|college|institute|school|faculty|academy)\b|uc\s+[a-z])/i,
  )?.[1]?.trim()
  const labelVariants = [...new Set([label, primaryLabel, brandedDashPrefix].filter(Boolean))]
  const acronymOnly = /^[A-Z][A-Z0-9&.+-]{1,11}$/.test(primaryLabel)
  return !label || acronymOnly || labelVariants.some(isNonDoctoralOnlyIdentity) || GENERIC_PROGRAM_LABELS.some((pattern) => (
    labelVariants.some((variant) => pattern.test(variant))
  ))
}

function schoolAliases(value) {
  const words = normaliseWords(value)
  const content = words.filter((word) => !['the', 'of', 'and', 'at'].includes(word))
  const withoutUniversity = content.filter((word) => !['university', 'college', 'institute', 'technology'].includes(word))
  const acronym = content.filter((word) => !['university', 'of', 'the', 'and', 'at'].includes(word)).map((word) => word[0]).join('')
  const aliases = [content.join(' '), withoutUniversity.join(' '), acronym]
  const joined = words.join(' ')
  if (/massachusetts institute of technology|^mit$/.test(joined) || words.includes('mit')) aliases.push('mit')
  if (/university of california berkeley|^uc berkeley$|^ucb$/.test(joined) || words.includes('ucb')) aliases.push('uc berkeley', 'ucb')
  if (/hong kong university of science and technology|^hkust$/.test(joined) || words.includes('hkust')) aliases.push('hkust')
  if (/ecole polytechnique federale de lausanne|^epfl$/.test(joined) || words.includes('epfl')) aliases.push('epfl')
  if (/eth zurich|swiss federal institute of technology zurich/.test(joined) || words.includes('eth')) aliases.push('eth zurich', 'eth')
  if (/university of massachusetts amherst|umass amherst/.test(joined) || words.includes('umass')) {
    aliases.push('university massachusetts amherst', 'massachusetts amherst', 'umass amherst')
  }
  if (/ludwig maximilian university of munich|ludwig maximilians university munich|lmu munich/.test(joined) || words.includes('lmu')) {
    aliases.push('lmu munich', 'lmu')
  }
  if (/university of amsterdam|^uva$|uva amsterdam/.test(joined) || words.includes('uva')) {
    aliases.push('university amsterdam', 'uva amsterdam', 'uva')
  }
  if (/royal institute of technology|^kth$/.test(joined) || words.includes('kth')) aliases.push('kth')
  if (/technical university of denmark|^dtu$/.test(joined) || words.includes('dtu')) aliases.push('dtu')
  if (/delft university of technology|tu delft/.test(joined)) aliases.push('tu delft')
  return [...new Set(aliases.filter((alias) => alias.length >= 2))]
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

function hostBelongsTo(host, officialHost) {
  const left = String(host || '').toLowerCase().replace(/^www\./, '')
  const right = String(officialHost || '').toLowerCase().replace(/^www\./, '')
  return Boolean(left && right && (left === right || left.endsWith(`.${right}`)))
}

const RANKING_HOSTS = ['topuniversities.com', 'timeshighereducation.com']
const SCHOLARSHIP_HOSTS = ['ukri.org', 'daad.de', 'nsf.gov', 'canada.ca', 'csc.edu.cn', 'a-star.edu.sg', 'education.gov.au']

function trustedExternalUrl(value, allowedHosts) {
  const url = safeUrl(value)
  if (!url) return ''
  return allowedHosts.some((host) => hostBelongsTo(url.hostname, host)) ? url.href : ''
}

export function isOfficialSchoolUrl(value, schoolEntry) {
  const url = safeUrl(value)
  const official = safeUrl(schoolEntry?.officialUrl)
  if (!url || !official) return false
  const curatedDomains = Array.isArray(schoolEntry?.allowedHosts)
    ? schoolEntry.allowedHosts.map((host) => String(host || '').trim().toLowerCase()).filter(Boolean)
    : []
  return hostBelongsTo(url.hostname, official.hostname)
    || curatedDomains.some((domain) => hostBelongsTo(url.hostname, domain))
}

function overlapScore(left, right) {
  const a = new Set(schoolAliases(left))
  const b = new Set(schoolAliases(right))
  if ([...a].some((alias) => b.has(alias))) return 1
  const leftWords = new Set(normaliseWords(left).filter((word) => word.length > 2))
  const rightWords = new Set(normaliseWords(right).filter((word) => word.length > 2))
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length
  return shared / Math.max(1, Math.max(leftWords.size, rightWords.size))
}

export function findSchoolSourceEntry(program, sourceIndex) {
  const schools = sourceIndex?.schools || []
  const suppliedUrls = [...(program?.sources || []), program?.website].map(safeUrl).filter(Boolean)
  const byDomain = schools.find((school) => suppliedUrls.some((url) => isOfficialSchoolUrl(url.href, school)))
  if (byDomain && overlapScore(program?.school, byDomain.school) >= 0.72) return byDomain
  let best = null
  let score = 0
  for (const school of schools) {
    const candidate = overlapScore(program?.school, school.school)
    if (candidate > score) {
      score = candidate
      best = school
    }
  }
  return score >= 0.72 ? best : null
}

function matchingAdvisorPage(pi, schoolEntry, allowedEvidence = null) {
  return (schoolEntry?.advisorPages || []).find((page) => {
    if (!isObservedOfficialEvidenceUrl(page?.url, schoolEntry, allowedEvidence)) return false
    return advisorPageMatchesName(pi, page)
  }) || null
}

function canonicalUrl(value) {
  const url = safeUrl(value)
  if (!url) return ''
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
}

const SCHOOL_EVIDENCE_PAGE_KEYS = [
  'pages',
  'advisorPages',
  'programPages',
  'admissionsPages',
  'fundingPages',
  'researchPages',
]

function indexedPagesForUrl(value, schoolEntry, keys = SCHOOL_EVIDENCE_PAGE_KEYS) {
  const supplied = canonicalUrl(value)
  if (!supplied) return []
  return keys.flatMap((key) => Array.isArray(schoolEntry?.[key]) ? schoolEntry[key] : [])
    .filter((page) => canonicalUrl(page?.url) === supplied)
}

function indexedPageEntriesForUrl(value, schoolEntry, keys = SCHOOL_EVIDENCE_PAGE_KEYS) {
  const supplied = canonicalUrl(value)
  if (!supplied) return []
  return keys.flatMap((key) => (
    (Array.isArray(schoolEntry?.[key]) ? schoolEntry[key] : [])
      .filter((page) => canonicalUrl(page?.url) === supplied)
      .map((page) => ({ key, page }))
  ))
}

function hasPoisonedIndexedPage(value, schoolEntry) {
  return indexedPagesForUrl(value, schoolEntry)
    .some((page) => page?.promptInjectionSuspected === true)
}

function evidenceUrlSet(values) {
  if (values == null) return null
  return new Set((values || []).map(canonicalUrl).filter(Boolean))
}

function evidenceAllowed(value, allowedEvidence) {
  return allowedEvidence === null || allowedEvidence.has(canonicalUrl(value))
}

function isPersonOrDirectoryPath(value) {
  const url = safeUrl(value)
  if (!url) return false
  return /\/(?:people(?:[_-]?individual)?|persons?|personnel|faculty|staff|directory|profiles?|experts?|researchers?|team|members?|bio|biography|authors?)(?:[/.]|$)/i.test(url.pathname)
    || /\/(?:faculty|staff)[_-](?:directory|profiles?|staff)(?:[/.]|$)/i.test(url.pathname)
    || /\/(?:academic[_-]?staff|our[_-]?people|meet[_-](?:the[_-])?team)(?:[/.]|$)/i.test(url.pathname)
}

function isNonProgramContentPath(value) {
  const url = safeUrl(value)
  if (!url) return false
  return /\/(?:news(?:[-_]and[-_]events?)?|events?(?:[-_]and[-_]news)?|stories|awards?|press(?:[-_]releases?)?|media(?:[-_](?:centre|center))?|blog|alumni|privacy|careers?|jobs?)(?:\/|$)/i
    .test(url.pathname)
}

function pageHasEvidenceType(value, schoolEntry, expectedTypes) {
  const expected = new Set(expectedTypes)
  const bucketType = {
    advisorPages: 'advisor',
    programPages: 'program',
    admissionsPages: 'admissions',
    fundingPages: 'funding',
    researchPages: 'research',
  }
  return indexedPageEntriesForUrl(value, schoolEntry).some(({ key, page }) => (
    expected.has(bucketType[key]) || (page?.types || []).some((type) => expected.has(type))
  ))
}

function isFacultySchoolProgrammePath(value) {
  const url = safeUrl(value)
  if (!url || !/\/faculty\//i.test(url.pathname)) return false
  if (/\/faculty\/(?:directory|people|persons?|profiles?|staff|members?|team)(?:\/|$)/i.test(url.pathname)) return false
  return /(?:^|[/_-])(?:phd|dphil|doctoral|doctorate)(?:[/_.-]|$)/i.test(url.pathname)
}

function isObservedOfficialEvidenceUrl(value, schoolEntry, allowedEvidence = null) {
  if (!evidenceAllowed(value, allowedEvidence)) return false
  if (!isOfficialSchoolUrl(value, schoolEntry)) return false
  if (hasPoisonedIndexedPage(value, schoolEntry)) return false
  if (allowedEvidence !== null) return true
  return indexedPagesForUrl(value, schoolEntry).some((page) => page?.fetched === true)
}

const PROGRAM_LABEL_STOP_WORDS = new Set([
  'a', 'about', 'admission', 'admissions', 'an', 'and', 'application', 'applications',
  'apply', 'at', 'bachelor', 'bachelors', 'bsc', 'college', 'deadline', 'deadlines',
  'degree', 'degrees', 'department', 'dphil', 'doctoral', 'doctorate', 'doctor',
  'faculty', 'for', 'graduate', 'guide', 'in', 'information', 'institute', 'master',
  'masters', 'mphil', 'msc', 'of', 'overview', 'phd', 'phil', 'philosophy',
  'postgraduate', 'program', 'programme', 'programs', 'programmes', 'research', 'school',
  'studies', 'study', 'technology', 'the', 'undergraduate', 'university', 'with',
])

function decodedUrlIdentity(value) {
  const url = safeUrl(value)
  if (!url) return ''
  let pathname = url.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // Keep the encoded path when a remote site emits malformed escapes.
  }
  return `${pathname} ${url.search}`.replace(/[/?#&=_-]+/g, ' ')
}

function meaningfulProgramWords(value) {
  return normaliseWords(value)
    .filter((word) => word.length > 1 && !PROGRAM_LABEL_STOP_WORDS.has(word))
}

function textSupportsProgramWords(text, meaningful) {
  if (!meaningful.length) return false
  const evidenceWords = new Set(normaliseWords(text))
  const uniqueMeaningful = [...new Set(meaningful)]
  const shared = uniqueMeaningful.filter((word) => evidenceWords.has(word)).length
  const requiredShared = Math.min(2, uniqueMeaningful.length)
  if (shared >= requiredShared) return true
  const acronym = uniqueMeaningful.map((word) => word[0]).join('')
  return acronym.length >= 2 && acronym.length <= 12 && evidenceWords.has(acronym)
}

function programPageSupportsCandidate(value, candidate, schoolEntry) {
  const meaningful = meaningfulProgramWords(candidate?.program)
  if (!meaningful.length) return false
  const entries = indexedPageEntriesForUrl(value, schoolEntry, ['pages', 'programPages', 'admissionsPages'])
  const identityTexts = [...new Set(entries.flatMap(({ page }) => [
    page?.title,
    page?.label,
  ]).filter(Boolean))]
  const urlIdentity = decodedUrlIdentity(value)
  const primaryIdentity = [urlIdentity, ...identityTexts].filter(Boolean).join(' ')
  const excerpts = entries.map(({ page }) => page?.excerpt).filter(Boolean).join(' ')
  const declaredKinds = entries
    .flatMap(({ page }) => page?.declaredKinds || [])
    .map((kind) => String(kind || '').trim().toLowerCase())
    .filter(Boolean)

  // Page identity wins over navigation/body copy. A Master/MSc/MPhil-only or
  // undergraduate page cannot prove a doctorate merely because its body links
  // to a PhD page. Combined MPhil-PhD identities contain a doctoral signal and
  // remain eligible.
  if (isNonDoctoralOnlyIdentity(urlIdentity)
    || identityTexts.some((text) => isNonDoctoralOnlyIdentity(text))) {
    return false
  }

  // The field/project identity must be visible in the title, link label, or
  // URL. Excerpts can corroborate doctoral level, but cannot invent a subject
  // programme on a university-wide admissions/guide/directory page.
  if (!textSupportsProgramWords(primaryIdentity, meaningful)) return false

  const primaryHasDoctoralIdentity = hasDoctoralSignal(primaryIdentity)
  const declaredDoctoral = declaredKinds.some((kind) => (
    ['doctoral', 'doctorate', 'phd', 'dphil'].includes(kind)
  ))
  const excerptCorroboratesDoctoral = hasDoctoralSignal(excerpts)
  const hasSpecificNamedIdentity = identityTexts.some((text) => (
    !isGenericProgramLabel(text)
    && !isNonDoctoralOnlyIdentity(text)
    && textSupportsProgramWords(text, meaningful)
  ))
  const programTyped = entries.some(({ key, page }) => (
    key === 'programPages' || (page?.types || []).includes('program')
  ))
  const concreteProjectIdentity = /(?:^|[^\p{L}\p{N}])(?:doctoral\s+project|ph\.?d\s+project|studentship|research\s+project|project\s+title|position|vacanc(?:y|ies)|opportunit(?:y|ies))(?=$|[^\p{L}\p{N}])/iu
    .test(primaryIdentity)

  return primaryHasDoctoralIdentity
    || (hasSpecificNamedIdentity
      && concreteProjectIdentity
      && programTyped
      && (declaredDoctoral || excerptCorroboratesDoctoral))
}

function isProgramEvidenceBase(value, schoolEntry, allowedEvidence = null) {
  if (!isObservedOfficialEvidenceUrl(value, schoolEntry, allowedEvidence)) return false
  const url = safeUrl(value)
  if (!url) return false
  if (!pageHasEvidenceType(url.href, schoolEntry, ['program', 'admissions'])) return false
  if (isNonProgramContentPath(url.href)) return false
  if (indexedPagesForUrl(url.href, schoolEntry).some((page) => page?.individualAdvisor === true)) return false
  // Most /faculty and /people paths are person evidence, but some universities
  // use /faculty/<school>/study/phd... for an academic division. Permit only
  // that explicit doctoral-programme shape; individualAdvisor always wins.
  if (isPersonOrDirectoryPath(url.href) && !isFacultySchoolProgrammePath(url.href)) return false
  return true
}

export function isProgramEvidenceUrl(value, schoolEntry, allowedEvidence = null, candidate = null) {
  if (!isProgramEvidenceBase(value, schoolEntry, allowedEvidence)) return false
  return candidate ? programPageSupportsCandidate(value, candidate, schoolEntry) : true
}

function advisorPageMatchesName(pi, page) {
  if (isNonProgramContentPath(page?.url)) return false
  const nameWords = normaliseWords(pi?.name).filter((word) => word.length > 1)
  if (!nameWords.length) return false
  const first = nameWords[0]
  const last = nameWords[nameWords.length - 1]
  const pathname = safeUrl(page?.url)?.pathname || ''
  const pathWords = normaliseWords(pathname)
  const pathHasIdentity = pathWords.includes(last)
    && (nameWords.length === 1 || pathWords.includes(first) || pathWords.includes(first[0]))
  const textWords = new Set(normaliseWords(`${page?.title || ''} ${page?.label || ''} ${pathname}`))
  const textHasIdentity = textWords.has(last) && (
    nameWords.length === 1 || textWords.has(first) || textWords.has(first[0])
  )
  return textHasIdentity && (
    page?.individualAdvisor === true
    || (isPersonOrDirectoryPath(page?.url) && pathHasIdentity)
  )
}

function suppliedAdvisorProfileUrl(pi, schoolEntry, allowedEvidence = null) {
  if (!isObservedOfficialEvidenceUrl(pi?.url, schoolEntry, allowedEvidence)) return ''
  const supplied = canonicalUrl(pi?.url)
  const indexedMatch = (schoolEntry?.advisorPages || []).some((page) => (
    canonicalUrl(page?.url) === supplied && advisorPageMatchesName(pi, page)
  ))
  if (indexedMatch) return safeUrl(pi.url)?.href || ''
  return ''
}

function indexedEvidenceText(value, schoolEntry) {
  return indexedPagesForUrl(value, schoolEntry)
    .flatMap((page) => [page?.title, page?.label, page?.excerpt])
    .filter(Boolean)
    .join(' ')
}

function deadlineClaimSupported(candidate, sourceUrl, schoolEntry) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(candidate?.deadlineIso || '').trim())
  if (!match) return false
  const [, year, monthPadded, dayPadded] = match
  const month = Number(monthPadded)
  const day = Number(dayPadded)
  if (!month || month > 12 || !day || day > 31) return false
  const monthNames = [
    '', 'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ]
  const monthName = monthNames[month]
  const ordinalSuffix = day % 100 >= 11 && day % 100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th')
  const evidence = indexedEvidenceText(sourceUrl, schoolEntry)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
  const variants = [
    `${year}-${monthPadded}-${dayPadded}`,
    `${year}/${monthPadded}/${dayPadded}`,
    `${dayPadded}/${monthPadded}/${year}`,
    `${monthPadded}/${dayPadded}/${year}`,
    `${day} ${monthName} ${year}`,
    `${monthName} ${day} ${year}`,
    `${day}${ordinalSuffix} ${monthName} ${year}`,
    `${monthName} ${day}${ordinalSuffix} ${year}`,
    `${day} ${monthName.slice(0, 3)} ${year}`,
    `${monthName.slice(0, 3)} ${day} ${year}`,
    `${year}年${month}月${day}日`,
  ]
  return variants.some((variant) => evidence.includes(variant))
}

function amountOrTextClaimSupported(values, sourceUrl, schoolEntry) {
  const evidence = indexedEvidenceText(sourceUrl, schoolEntry)
  if (!evidence) return false
  const compactEvidence = evidence.toLowerCase().replace(/[,\s]/g, '')
  const numericClaims = new Set()
  for (const value of values || []) {
    if (Number.isFinite(Number(value)) && Number(value) >= 100) {
      numericClaims.add(String(Math.round(Number(value))))
    }
    for (const match of String(value || '').matchAll(/\d[\d,\s]*(?:\.\d+)?/g)) {
      const parsed = Number(match[0].replace(/[,\s]/g, ''))
      if (Number.isFinite(parsed) && parsed >= 100) numericClaims.add(String(Math.round(parsed)))
    }
  }
  if (numericClaims.size) return [...numericClaims].some((claim) => compactEvidence.includes(claim))

  const textualClaim = (values || [])
    .map((value) => String(value || '').trim())
    .find((value) => value && !/^(?:unknown|n\/?a|none|tbd|—|-)$/i.test(value))
  if (!textualClaim) return false
  const claimWords = normaliseWords(textualClaim).filter((word) => word.length > 2)
  if (!claimWords.length) return false
  const evidenceWords = new Set(normaliseWords(evidence))
  return claimWords.every((word) => evidenceWords.has(word))
}

function groundedAdvisorEmail(rawEmail, officialUrl, schoolEntry) {
  const email = String(rawEmail || '').trim().toLowerCase()
  const domain = email.split('@')[1]
  if (!email || !domain || !isOfficialSchoolUrl(`https://${domain}/`, schoolEntry)) return ''
  return indexedEvidenceText(officialUrl, schoolEntry).toLowerCase().includes(email) ? email : ''
}

function groundedRecruitingClaim(value, officialUrl, schoolEntry) {
  const claim = String(value || '').trim()
  if (!/(?:accepting|recruiting|seeking|looking for|open position)/i.test(claim)) {
    return 'Unknown — verify on the current official lab or faculty page'
  }
  const evidence = indexedEvidenceText(officialUrl, schoolEntry)
  const explicitlyClosed = /\b(?:not|no\s+longer|not\s+currently|currently\s+not|unable\s+to)\s+(?:be\s+)?(?:accepting|recruiting|seeking|looking\s+for)\b/i.test(evidence)
    || /\bno\s+(?:(?:ph\.?d|doctoral|graduate)\s+)?(?:openings?|positions?|vacanc(?:y|ies))\b/i.test(evidence)
  if (explicitlyClosed) {
    return 'Not accepting PhD students — the current official profile states there is no opening.'
  }
  const supportsClaim = /(?:accepting|recruiting|seeking|looking for)[\s\S]{0,80}(?:ph\.?d|doctoral|graduate)\s+(?:students?|candidates?)/i.test(evidence)
    || /(?:ph\.?d|doctoral|graduate)[\s\S]{0,80}(?:position|opening|vacanc|accepting|recruiting)/i.test(evidence)
  return supportsClaim ? claim : 'Unknown — verify on the current official lab or faculty page'
}

function groundedPis(pis, schoolEntry, allowedEvidence = null) {
  const out = []
  const seen = new Set()
  for (const raw of pis || []) {
    const supplied = suppliedAdvisorProfileUrl(raw, schoolEntry, allowedEvidence)
    const matched = supplied ? null : matchingAdvisorPage(raw, schoolEntry, allowedEvidence)
    const officialUrl = supplied || matched?.url || ''
    if (!officialUrl) continue
    const identity = canonicalUrl(officialUrl) || normaliseWords(raw?.name).join(' ')
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    out.push({
      ...raw,
      url: officialUrl,
      email: groundedAdvisorEmail(raw.email, officialUrl, schoolEntry),
      recruiting: groundedRecruitingClaim(raw.recruiting, officialUrl, schoolEntry),
    })
    if (out.length >= 20) break
  }
  return out
}

function groundedFactSources(raw, candidate, schoolEntry, allowedEvidence = null) {
  const factSources = raw && typeof raw === 'object' ? raw : {}
  const official = (value, types) => (
    !isPersonOrDirectoryPath(value)
    && !isNonProgramContentPath(value)
    && isObservedOfficialEvidenceUrl(value, schoolEntry, allowedEvidence)
    && pageHasEvidenceType(value, schoolEntry, types)
  )
    ? safeUrl(value)?.href || ''
    : ''
  const officialOrFunder = (value, types) => official(value, types)
    || (allowedEvidence !== null && evidenceAllowed(value, allowedEvidence)
      ? trustedExternalUrl(value, SCHOLARSHIP_HOSTS)
      : '')
  const deadline = official(factSources.deadline, ['program', 'admissions'])
  const funding = officialOrFunder(factSources.funding, ['program', 'funding'])
  const tuition = official(factSources.tuition, ['program', 'admissions', 'funding'])
  return {
    deadline: deadline && deadlineClaimSupported(candidate, deadline, schoolEntry) ? deadline : '',
    funding: funding && amountOrTextClaimSupported(
      [candidate?.stipendUSD, candidate?.stipendLocal],
      funding,
      schoolEntry,
    ) ? funding : '',
    tuition: tuition && amountOrTextClaimSupported([candidate?.tuitionLocal], tuition, schoolEntry) ? tuition : '',
    restrictions: official(factSources.restrictions, ['program', 'admissions']),
    international: officialOrFunder(factSources.international, ['program', 'admissions', 'funding']),
    outcomes: official(factSources.outcomes, ['program', 'research']),
    admissionsBackgrounds: official(factSources.admissionsBackgrounds, ['program', 'admissions']),
    degreeStructure: official(factSources.degreeStructure, ['program']),
    applicationRoute: official(factSources.applicationRoute, ['program', 'admissions']),
  }
}

/**
 * Enforces evidence ownership after every model call. A URL can only support a
 * program if it belongs to that program's resolved university domain. This is
 * intentionally performed in code, not left to a prompt.
 */
export function groundDiscoverPrograms(programs, sourceIndex, {
  previousPrograms = [],
  allowedEvidenceUrls = null,
  authoritativePis = false,
} = {}) {
  const previousById = new Map((previousPrograms || []).map((program) => [program.id, program]))
  const allowedEvidence = evidenceUrlSet(allowedEvidenceUrls)
  const grounded = []
  const rejected = []
  for (const raw of programs || []) {
    const previous = previousById.get(raw?.id)
    const candidate = {
      ...previous,
      ...raw,
      sources: [...(previous?.sources || []), ...(raw?.sources || [])],
      pis: authoritativePis && Array.isArray(raw?.pis)
        ? raw.pis
        : (raw?.pis?.length ? raw.pis : (previous?.pis || [])),
    }
    if (isGenericProgramLabel(candidate.program)) {
      rejected.push({ id: candidate.id, reason: 'generic-program-label' })
      continue
    }
    const schoolEntry = findSchoolSourceEntry(candidate, sourceIndex)
    if (!schoolEntry) {
      rejected.push({ id: candidate.id, reason: 'school-not-resolved' })
      continue
    }
    const sourcesByCanonicalUrl = new Map()
    let programIdentityRejected = false
    for (const value of candidate.sources || []) {
      const safe = safeUrl(value)?.href
      const canonical = canonicalUrl(value)
      if (isProgramEvidenceBase(value, schoolEntry, allowedEvidence)
        && !programPageSupportsCandidate(value, candidate, schoolEntry)) {
        programIdentityRejected = true
      }
      if (safe && canonical && isProgramEvidenceUrl(value, schoolEntry, allowedEvidence, candidate)
        && !sourcesByCanonicalUrl.has(canonical)) {
        sourcesByCanonicalUrl.set(canonical, safe)
      }
    }
    const sources = [...sourcesByCanonicalUrl.values()].slice(0, 20)
    if (isProgramEvidenceBase(candidate.website, schoolEntry, allowedEvidence)
      && !programPageSupportsCandidate(candidate.website, candidate, schoolEntry)) {
      programIdentityRejected = true
    }
    const website = isProgramEvidenceUrl(candidate.website, schoolEntry, allowedEvidence, candidate)
      ? safeUrl(candidate.website).href
      : sources[0] || ''
    if (!sources.length || !website) {
      rejected.push({
        id: candidate.id,
        reason: programIdentityRejected
          ? 'program-identity-not-specific'
          : 'no-program-specific-official-source',
      })
      continue
    }
    const pis = groundedPis(candidate.pis, schoolEntry, allowedEvidence)
    const rankingSources = [...new Set((candidate.rankingSources || [])
      .map((value) => allowedEvidence !== null && evidenceAllowed(value, allowedEvidence)
        ? trustedExternalUrl(value, RANKING_HOSTS)
        : '')
      .filter(Boolean))].slice(0, 8)
    const scholarships = (candidate.scholarships || []).filter((item) => (
      (!isPersonOrDirectoryPath(item?.url)
        && !isNonProgramContentPath(item?.url)
        && isObservedOfficialEvidenceUrl(item?.url, schoolEntry, allowedEvidence)
        && pageHasEvidenceType(item?.url, schoolEntry, ['program', 'funding'])
        || (allowedEvidence !== null && evidenceAllowed(item?.url, allowedEvidence)
          && trustedExternalUrl(item?.url, SCHOLARSHIP_HOSTS)))
    )).slice(0, 12)
    const factSources = groundedFactSources(candidate.factSources, candidate, schoolEntry, allowedEvidence)
    const hasQsSource = rankingSources.some((value) => safeUrl(value)?.hostname.replace(/^www\./, '') === 'topuniversities.com')
    const hasTheSource = rankingSources.some((value) => safeUrl(value)?.hostname.replace(/^www\./, '') === 'timeshighereducation.com')
    grounded.push({
      ...candidate,
      school: schoolEntry.school,
      region: candidate.region || schoolEntry.region,
      website,
      sources,
      pis,
      rankingSources,
      scholarships,
      factSources,
      deadlineIso: factSources.deadline ? candidate.deadlineIso : '',
      deadlineAndTests: factSources.deadline ? candidate.deadlineAndTests : '—',
      stipendUSD: factSources.funding ? candidate.stipendUSD : null,
      stipendLocal: factSources.funding ? candidate.stipendLocal : 'Unknown',
      stipendBasis: factSources.funding ? candidate.stipendBasis : 'No field-specific official funding source retained.',
      stipendConfidence: factSources.funding ? candidate.stipendConfidence : 'unknown',
      stipendFoundOfficial: Boolean(factSources.funding && candidate.stipendFoundOfficial),
      stipendNotes: factSources.funding ? candidate.stipendNotes : 'Funding not verified from an official field-specific source.',
      tuitionLocal: factSources.tuition ? candidate.tuitionLocal : '',
      tuitionNotes: factSources.tuition ? candidate.tuitionNotes : '',
      applicationRestrictions: factSources.restrictions ? candidate.applicationRestrictions : '',
      multiApply: factSources.restrictions ? candidate.multiApply : 'unknown',
      intlNotes: factSources.international ? candidate.intlNotes : '',
      careerOutcomes: factSources.outcomes ? candidate.careerOutcomes : '',
      admitBackgrounds: factSources.admissionsBackgrounds ? candidate.admitBackgrounds : '',
      degreeStructure: factSources.degreeStructure ? candidate.degreeStructure : '—',
      applicationRoute: factSources.applicationRoute ? candidate.applicationRoute : '—',
      rankingYear: hasQsSource || hasTheSource ? candidate.rankingYear : null,
      qsWorldRank: hasQsSource ? candidate.qsWorldRank : null,
      qsSubjectRank: hasQsSource ? candidate.qsSubjectRank : null,
      qsSubjectName: hasQsSource ? candidate.qsSubjectName : '',
      theWorldRank: hasTheSource ? candidate.theWorldRank : null,
      theSubjectRank: hasTheSource ? candidate.theSubjectRank : null,
      theSubjectName: hasTheSource ? candidate.theSubjectName : '',
      provenance: 'ai',
      verification: {
        status: pis.length ? 'verified' : 'partial',
        checkedAt: new Date().toISOString(),
        officialSourceCount: sources.length,
        advisorSourceCount: pis.length,
        issues: pis.length ? [] : ['No individually verified official advisor page was retained.'],
      },
    })
  }
  return { programs: grounded, rejected }
}
