import { isLikelyAdvisorPersonName } from './discover-person-identity.js'

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

function isGenericAdvisorTerminalUrl(value) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(String(value || '')).pathname)
  } catch {
    return false
  }
  const signal = pathname.toLowerCase().replace(/[/_-]+/g, ' ').trim()
  if (/\b(?:academic structure|administrative structure|governance(?: and compliance)?|organisation(?:al)? structure|organization(?:al)? structure|university leadership)\b/i.test(signal)) {
    return true
  }
  return /\/(?:faculty|people|staff|directory|research-staff|key-contacts|frequently-asked-questions|curriculum-vitae|team\/about)\/?$/i
    .test(pathname)
}

function percentile(values, fraction) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]
}

function round(value, digits = 3) {
  const scale = 10 ** digits
  return Math.round((Number(value) || 0) * scale) / scale
}

function isPlaceholder(value) {
  return /(?:\bexample\b|\bplaceholder\b|\bprofessor\s+(?:ada|lin)\b|\.example(?:[./]|$)|benchmark-)/i
    .test(String(value || ''))
}

function identityText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function institutionIdentity(value) {
  return identityText(value).replace(/^the\s+/, '')
}

function identityValues(primary, aliases = []) {
  return [...new Set([primary, ...(Array.isArray(aliases) ? aliases : [])]
    .map(identityText)
    .filter(Boolean))]
}

function hasIdentityMatch(returned, schoolValues, entityValues) {
  return returned.find((entry) => (
    schoolValues.includes(entry.schoolIdentity) && entityValues.includes(entry.entityIdentity)
  ))
}

function verifiedRecruiting(value) {
  const claim = String(value || '').trim()
  return Boolean(claim) && !/^(?:unknown|check|verify)/i.test(claim)
}

function advisorRichness(advisors) {
  const rows = advisors.map(({ pi }) => {
    const profileReceipt = pi?.profileMatch?.basis === 'applicant-profile+official-individual-profile'
      && canonicalUrl(pi.profileMatch.evidenceUrl) === canonicalUrl(pi.url)
    const scholarlyReceipt = pi?.scholarly?.match?.basis === 'institution-scoped-scholarly-record+official-individual-profile'
      && canonicalUrl(pi.scholarly.match.officialProfileUrl) === canonicalUrl(pi.url)
    const recentWorkCount = (pi?.scholarly?.recentWorks || []).filter((work) => (
      Boolean(String(work?.title || '').trim()) && Boolean(canonicalUrl(work?.source))
    )).length
    const stableIdentifier = Boolean(canonicalUrl(pi?.scholarly?.openAlexId) || canonicalUrl(pi?.scholarly?.orcid))
    const fields = [
      Boolean(canonicalUrl(pi?.url)),
      profileReceipt,
      Boolean(String(pi?.research || '').trim()),
      Boolean(String(pi?.email || '').trim()),
      verifiedRecruiting(pi?.recruiting),
      scholarlyReceipt,
      stableIdentifier,
      recentWorkCount > 0,
    ]
    return {
      profileReceipt,
      scholarlyReceipt,
      recentWorkCount,
      stableIdentifier,
      email: fields[3],
      recruiting: fields[4],
      research: fields[2],
      completeness: fields.filter(Boolean).length / fields.length,
    }
  })
  const total = Math.max(1, rows.length)
  return {
    advisors: rows.length,
    officialProfileCoverage: round(rows.filter((row) => row.profileReceipt).length / total),
    researchSummaryCoverage: round(rows.filter((row) => row.research).length / total),
    verifiedEmailCoverage: round(rows.filter((row) => row.email).length / total),
    verifiedRecruitingCoverage: round(rows.filter((row) => row.recruiting).length / total),
    scholarlyReceiptCoverage: round(rows.filter((row) => row.scholarlyReceipt).length / total),
    stableIdentifierCoverage: round(rows.filter((row) => row.stableIdentifier).length / total),
    recentWorksCoverage: round(rows.filter((row) => row.recentWorkCount > 0).length / total),
    recentWorks: rows.reduce((sum, row) => sum + row.recentWorkCount, 0),
    medianRecentWorks: percentile(rows.map((row) => row.recentWorkCount), 0.5),
    meanCompleteness: round(rows.reduce((sum, row) => sum + row.completeness, 0) / total),
  }
}

function compareWithGoldSet(programs, advisors, goldSet) {
  if (!goldSet || typeof goldSet !== 'object') return null
  const goldPrograms = Array.isArray(goldSet.programs) ? goldSet.programs : []
  const goldAdvisors = Array.isArray(goldSet.advisors) ? goldSet.advisors : []
  const returnedPrograms = programs.map((program) => ({
    program,
    url: canonicalUrl(program.website),
    schoolIdentity: institutionIdentity(program.school),
    entityIdentity: identityText(program.program),
  }))
  const returnedAdvisors = advisors.map(({ program, pi }) => ({
    program,
    pi,
    url: canonicalUrl(pi.url),
    schoolIdentity: institutionIdentity(program.school),
    entityIdentity: identityText(pi.name),
  }))
  const programRows = goldPrograms.map((gold) => {
    const url = canonicalUrl(gold.officialUrl)
    const acceptedUrls = new Set([gold.officialUrl, ...(gold.officialUrlAliases || [])]
      .map(canonicalUrl).filter(Boolean))
    const schoolValues = identityValues(gold.school, gold.schoolAliases).map(institutionIdentity)
    const entityValues = identityValues(gold.program, gold.programAliases)
    const urlMatch = returnedPrograms.find((entry) => acceptedUrls.has(entry.url))
    const identityMatch = hasIdentityMatch(returnedPrograms, schoolValues, entityValues)
    return {
      school: String(gold.school || ''),
      program: String(gold.program || ''),
      officialUrl: url,
      foundByUrl: Boolean(urlMatch),
      // An exact canonical official URL is stronger identity evidence than a
      // title string, which may legitimately include degree suffixes such as
      // "MScR" or a localized display name.
      foundByIdentity: Boolean(identityMatch || urlMatch),
      returnedUrl: identityMatch?.url || urlMatch?.url || '',
    }
  })
  const advisorRows = goldAdvisors.map((gold) => {
    const url = canonicalUrl(gold.officialUrl)
    const acceptedUrls = new Set([gold.officialUrl, ...(gold.officialUrlAliases || [])]
      .map(canonicalUrl).filter(Boolean))
    const schoolValues = identityValues(gold.school, gold.schoolAliases).map(institutionIdentity)
    const entityValues = identityValues(gold.name, gold.nameAliases)
    const urlMatch = returnedAdvisors.find((entry) => acceptedUrls.has(entry.url))
    const identityMatch = hasIdentityMatch(returnedAdvisors, schoolValues, entityValues)
    return {
      school: String(gold.school || ''),
      name: String(gold.name || ''),
      officialUrl: url,
      foundByUrl: Boolean(urlMatch),
      foundByIdentity: Boolean(identityMatch || urlMatch),
      returnedUrl: identityMatch?.url || urlMatch?.url || '',
    }
  })
  const ratio = (rows, predicate) => round(rows.filter(predicate).length / Math.max(1, rows.length))
  return {
    checkedAt: goldSet.checkedAt || null,
    programs: {
      total: programRows.length,
      urlRecall: ratio(programRows, (row) => row.foundByUrl),
      identityRecall: ratio(programRows, (row) => row.foundByIdentity),
      missed: programRows.filter((row) => !row.foundByIdentity),
      urlMismatches: programRows.filter((row) => row.foundByIdentity && !row.foundByUrl),
    },
    advisors: {
      total: advisorRows.length,
      urlRecall: ratio(advisorRows, (row) => row.foundByUrl),
      identityRecall: ratio(advisorRows, (row) => row.foundByIdentity),
      missed: advisorRows.filter((row) => !row.foundByIdentity),
      urlMismatches: advisorRows.filter((row) => row.foundByIdentity && !row.foundByUrl),
    },
  }
}

function fetchedEvidenceUrls(sourceIndex) {
  const urls = new Set()
  for (const school of sourceIndex?.schools || []) {
    for (const key of ['pages', 'programPages', 'advisorPages', 'admissionsPages', 'fundingPages', 'researchPages']) {
      for (const page of school?.[key] || []) {
        const url = canonicalUrl(page?.url)
        if (url && page?.fetched === true && page?.promptInjectionSuspected !== true) urls.add(url)
      }
    }
  }
  return urls
}

/**
 * Human-auditable returned-record ledger for local live reports. It contains
 * only normalized persisted fields and evidence receipts: no fetched page
 * bodies, provider credentials, prompts, or private application profile.
 */
export function buildDiscoverResearchRecordLedger(result) {
  return (result?.nextState?.customPrograms || [])
    .filter((program) => program?.provenance === 'ai')
    .map((program) => ({
      id: String(program.id || ''),
      school: String(program.school || ''),
      program: String(program.program || ''),
      website: canonicalUrl(program.website),
      verification: {
        status: String(program.verification?.status || 'unverified'),
        officialSourceCount: Math.max(0, Number(program.verification?.officialSourceCount) || 0),
        advisorSourceCount: Math.max(0, Number(program.verification?.advisorSourceCount) || 0),
        issues: (program.verification?.issues || []).map((value) => String(value)).slice(0, 12),
      },
      sources: (program.sources || []).map(canonicalUrl).filter(Boolean),
      advisors: (program.pis || []).map((pi) => ({
        id: String(pi.id || ''),
        name: String(pi.name || ''),
        officialProfileUrl: canonicalUrl(pi.url),
        email: String(pi.email || ''),
        recruiting: String(pi.recruiting || ''),
        research: String(pi.research || ''),
        profileMatch: pi.profileMatch ? {
          score: Math.max(0, Math.min(100, Number(pi.profileMatch.score) || 0)),
          confidence: String(pi.profileMatch.confidence || 'unknown'),
          matchedInterests: (pi.profileMatch.matchedInterests || []).map(String),
          matchedMethods: (pi.profileMatch.matchedMethods || []).map(String),
          matchedResearchTerms: (pi.profileMatch.matchedResearchTerms || []).map(String),
          evidenceUrl: canonicalUrl(pi.profileMatch.evidenceUrl),
          checkedAt: pi.profileMatch.checkedAt || null,
          basis: String(pi.profileMatch.basis || ''),
        } : null,
        scholarly: pi.scholarly ? {
          openAlexId: canonicalUrl(pi.scholarly.openAlexId) || null,
          orcid: canonicalUrl(pi.scholarly.orcid) || null,
          profileUrl: canonicalUrl(pi.scholarly.profileUrl) || null,
          providers: (pi.scholarly.providers || []).map(String),
          matchedQueries: (pi.scholarly.matchedQueries || []).map(String),
          recentWorks: (pi.scholarly.recentWorks || []).map((work) => ({
            title: String(work?.title || ''),
            year: Number.isInteger(Number(work?.year)) ? Number(work.year) : null,
            citedByCount: Math.max(0, Number(work?.citedByCount) || 0),
            source: canonicalUrl(work?.source),
            matchedQuery: String(work?.matchedQuery || ''),
            matchedTopic: work?.matchedTopic ? String(work.matchedTopic) : null,
          })).filter((work) => work.title && work.source),
          match: {
            basis: String(pi.scholarly.match?.basis || ''),
            nameMatch: String(pi.scholarly.match?.nameMatch || ''),
            officialProfileUrl: canonicalUrl(pi.scholarly.match?.officialProfileUrl),
            institutionId: canonicalUrl(pi.scholarly.match?.institutionId) || null,
            checkedAt: pi.scholarly.match?.checkedAt || null,
          },
        } : null,
      })),
    }))
}

/**
 * Redacted, deterministic acceptance report for a live Discover run. It audits
 * coverage, evidence ownership, profile matching, duplicates and obvious test
 * placeholders without copying page excerpts, credentials or profile text.
 */
export function evaluateDiscoverResearchResult(result, {
  scenario = 'unspecified',
  requestedPrograms = 1,
  requestedPis = 1,
  coverageMode = 'targeted',
  goldSet = null,
  enforceRichness = false,
  enforceGoldCoverage = false,
} = {}) {
  const programs = (result?.nextState?.customPrograms || [])
    .filter((program) => program?.provenance === 'ai')
  const advisors = programs.flatMap((program) => (program?.pis || []).map((pi) => ({ program, pi })))
  const sourceIndex = result?.sourceIndex || {}
  const quality = sourceIndex.quality || {}
  const fetchedUrls = fetchedEvidenceUrls(sourceIndex)
  const programCounts = programs.map((program) => program.pis?.length || 0)
  const uniqueSchools = new Set(programs.map((program) => String(program.school || '').trim().toLowerCase()).filter(Boolean))
  const programUrls = programs.map((program) => canonicalUrl(program.website)).filter(Boolean)
  const duplicateProgramUrls = programUrls.length - new Set(programUrls).size
  const advisorIdentities = advisors.map(({ program, pi }) => (
    `${String(program.id || canonicalUrl(program.website) || program.program).trim().toLowerCase()}|${String(pi.name || '').trim().toLowerCase()}|${canonicalUrl(pi.url)}`
  ))
  const crossProgramAdvisorIdentities = advisors.map(({ program, pi }) => (
    `${String(program.school || '').trim().toLowerCase()}|${String(pi.name || '').trim().toLowerCase()}|${canonicalUrl(pi.url)}`
  ))
  const duplicateAdvisors = advisorIdentities.length - new Set(advisorIdentities).size
  const crossProgramAdvisorRepeats = crossProgramAdvisorIdentities.length - new Set(crossProgramAdvisorIdentities).size
  const profileReceipts = advisors.filter(({ pi }) => (
    pi?.profileMatch?.basis === 'applicant-profile+official-individual-profile'
    && canonicalUrl(pi.profileMatch.evidenceUrl) === canonicalUrl(pi.url)
  )).length
  const evidenceBackedPrograms = programs.filter((program) => (
    canonicalUrl(program.website) && fetchedUrls.has(canonicalUrl(program.website))
  )).length
  const evidenceBackedAdvisors = advisors.filter(({ pi }) => (
    canonicalUrl(pi.url) && fetchedUrls.has(canonicalUrl(pi.url))
  )).length
  const richness = advisorRichness(advisors)
  const goldComparison = compareWithGoldSet(programs, advisors, goldSet)
  const placeholderRows = [
    ...programs.filter((program) => (
      isPlaceholder(program.id)
      || isPlaceholder(program.school)
      || isPlaceholder(program.program)
      || isPlaceholder(program.website)
    )).map((program) => `program:${program.id}`),
    ...advisors.filter(({ pi }) => (
      isPlaceholder(pi.id) || isPlaceholder(pi.name) || isPlaceholder(pi.url)
    )).map(({ program, pi }) => `advisor:${program.id}:${pi.id}`),
  ]
  const invalidAdvisorIdentityRows = advisors
    .filter(({ pi }) => !isLikelyAdvisorPersonName(pi?.name))
    .map(({ program, pi }) => `advisor:${program.id}:${pi.id}`)
  const genericAdvisorTerminalRows = advisors
    .filter(({ pi }) => isGenericAdvisorTerminalUrl(pi?.url))
    .map(({ program, pi }) => `advisor:${program.id}:${pi.id}`)
  const requestedProgramCount = Math.max(1, Number(requestedPrograms) || 1)
  const requestedAdvisorCount = requestedProgramCount * Math.max(1, Number(requestedPis) || 1)
  const evidenceExhaustive = coverageMode === 'evidence-exhaustive'
  const evidenceIntegrityFailures = [
    ...(quality.failures || []),
    ...(duplicateProgramUrls ? ['duplicate-program-urls'] : []),
    ...(duplicateAdvisors ? ['duplicate-advisors'] : []),
    ...(placeholderRows.length ? ['placeholder-output-retained'] : []),
    ...(invalidAdvisorIdentityRows.length ? ['non-person-advisor-identity-retained'] : []),
    ...(genericAdvisorTerminalRows.length ? ['generic-advisor-terminal-page-retained'] : []),
    ...(evidenceBackedPrograms !== programs.length ? ['program-url-not-in-fetched-evidence'] : []),
    ...(evidenceBackedAdvisors !== advisors.length ? ['advisor-url-not-in-fetched-evidence'] : []),
    ...(profileReceipts !== advisors.length ? ['advisor-profile-fit-receipt-missing'] : []),
  ]
  const coverageWarnings = [
    ...(quality.warnings || []),
    ...(!evidenceExhaustive && programs.length < requestedProgramCount ? ['requested-program-count-not-met'] : []),
    ...(!evidenceExhaustive && advisors.length < requestedAdvisorCount ? ['requested-advisor-count-not-met'] : []),
    ...(enforceRichness && richness.scholarlyReceiptCoverage < 0.35 ? ['advisor-scholarly-receipt-coverage-low'] : []),
    ...(enforceRichness && richness.recentWorksCoverage < 0.35 ? ['advisor-recent-work-coverage-low'] : []),
    ...(enforceGoldCoverage && goldComparison?.programs?.total > 0 && goldComparison.programs.identityRecall < 0.4
      ? ['gold-program-identity-recall-low'] : []),
    ...(enforceGoldCoverage && goldComparison?.advisors?.total > 0 && goldComparison.advisors.identityRecall < 0.4
      ? ['gold-advisor-identity-recall-low'] : []),
  ]
  return {
    schemaVersion: 1,
    scenario,
    passed: evidenceIntegrityFailures.length === 0 && coverageWarnings.length === 0,
    integrityPassed: evidenceIntegrityFailures.length === 0,
    coveragePassed: coverageWarnings.length === 0,
    requested: {
      mode: evidenceExhaustive ? 'evidence-exhaustive' : 'targeted',
      programs: evidenceExhaustive ? null : requestedProgramCount,
      advisorsPerProgram: evidenceExhaustive ? null : Math.max(1, Number(requestedPis) || 1),
      totalAdvisors: evidenceExhaustive ? null : requestedAdvisorCount,
    },
    returned: {
      programs: programs.length,
      uniqueSchools: uniqueSchools.size,
      advisors: advisors.length,
      programsWithAdvisors: programCounts.filter((count) => count > 0).length,
      medianAdvisorsPerProgram: percentile(programCounts, 0.5),
      p25AdvisorsPerProgram: percentile(programCounts, 0.25),
    },
    coverage: {
      programRecall: evidenceExhaustive ? null : round(programs.length / requestedProgramCount),
      advisorRecall: evidenceExhaustive ? null : round(advisors.length / requestedAdvisorCount),
      uniqueSchoolShare: round(uniqueSchools.size / Math.max(1, programs.length)),
    },
    evidence: {
      programsInFetchedEvidence: evidenceBackedPrograms,
      advisorsInFetchedEvidence: evidenceBackedAdvisors,
      deterministicProfileMatchReceipts: profileReceipts,
      verifiedAdvisorProfiles: Number(quality.verifiedAdvisorProfiles) || 0,
      profileMatchedAdvisorProfiles: Number(quality.profileMatchedAdvisorProfiles) || 0,
      crossSchoolSourceViolations: Number(quality.crossSchoolSourceViolations) || 0,
      unsupportedAdvisorFitClaims: Number(quality.unsupportedAdvisorFitClaims) || 0,
    },
    richness,
    goldComparison,
    duplicates: {
      programUrls: duplicateProgramUrls,
      advisors: duplicateAdvisors,
      crossProgramAdvisors: crossProgramAdvisorRepeats,
    },
    placeholderRows,
    invalidAdvisorIdentityRows,
    genericAdvisorTerminalRows,
    funnel: sourceIndex.funnel || null,
    evidenceIntegrityFailures: [...new Set(evidenceIntegrityFailures)],
    coverageWarnings: [...new Set(coverageWarnings)],
  }
}
