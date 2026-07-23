import {
  findSchoolSourceEntry,
  groundDiscoverPrograms,
  isGenericProgramLabel,
  isOfficialSchoolUrl,
} from './discover-source-grounding.js'

const EVIDENCE_PAGE_KEYS = [
  'pages',
  'advisorPages',
  'programPages',
  'admissionsPages',
  'fundingPages',
  'researchPages',
]

function canonicalEvidenceUrl(value) {
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

function schoolEvidencePages(school) {
  return EVIDENCE_PAGE_KEYS.flatMap((key) => Array.isArray(school?.[key]) ? school[key] : [])
}

function cleanFetchedEvidenceUrls(sourceIndex) {
  const byUrl = new Map()
  for (const school of sourceIndex?.schools || []) {
    for (const page of schoolEvidencePages(school)) {
      const canonical = canonicalEvidenceUrl(page?.url)
      if (!canonical) continue
      const current = byUrl.get(canonical) || { url: page.url, fetched: false, poisoned: false }
      current.fetched ||= page?.fetched === true
      current.poisoned ||= page?.promptInjectionSuspected === true
      byUrl.set(canonical, current)
    }
  }
  return [...byUrl.values()]
    .filter((entry) => entry.fetched && !entry.poisoned)
    .map((entry) => entry.url)
}

function isPoisonedEvidenceUrl(value, school) {
  const canonical = canonicalEvidenceUrl(value)
  return Boolean(canonical) && schoolEvidencePages(school).some((page) => (
    canonicalEvidenceUrl(page?.url) === canonical && page?.promptInjectionSuspected === true
  ))
}

function programEvidenceValues(program) {
  return [
    program?.website,
    ...(program?.sources || []),
    ...(program?.rankingSources || []),
    ...(program?.pis || []).map((pi) => pi?.url),
    ...(program?.scholarships || []).map((item) => item?.url),
    ...Object.values(program?.factSources || {}),
  ].filter(Boolean)
}

export function assessDiscoverResearchQuality(state, sourceIndex, options = {}) {
  const schools = sourceIndex?.schools || []
  const aiPrograms = (state?.customPrograms || []).filter((program) => program.provenance === 'ai')
  const groundedResult = groundDiscoverPrograms(aiPrograms, sourceIndex, {
    allowedEvidenceUrls: cleanFetchedEvidenceUrls(sourceIndex),
    authoritativePis: true,
  })
  const groundedById = new Map(groundedResult.programs.map((program) => [program.id, program]))
  const groundingRejectionById = new Map(groundedResult.rejected.map((entry) => [entry.id, entry.reason]))
  const sourcedPrograms = aiPrograms.filter((program) => groundedById.has(program.id) && program.sources?.length)
  let crossSchoolSourceViolations = 0
  let verifiedAdvisorProfiles = 0
  let unverifiedProgramEvidenceRows = 0
  let unverifiedProgramSourceViolations = 0
  let unverifiedAdvisorProfiles = 0
  let unverifiedFieldFactSources = 0
  let promptInjectionEvidenceViolations = 0
  let duplicateProgramRows = 0
  const programIdentities = new Set()
  for (const program of aiPrograms) {
    const school = findSchoolSourceEntry(program, sourceIndex)
    if (!school) {
      crossSchoolSourceViolations += Math.max(1, program.sources?.length || 0)
      unverifiedProgramEvidenceRows += 1
      continue
    }
    crossSchoolSourceViolations += (program.sources || []).filter((url) => !isOfficialSchoolUrl(url, school)).length
    promptInjectionEvidenceViolations += programEvidenceValues(program)
      .filter((url) => isPoisonedEvidenceUrl(url, school)).length

    const grounded = groundedById.get(program.id)
    if (!grounded) {
      unverifiedProgramEvidenceRows += 1
    } else {
      const groundedSourceUrls = new Set((grounded.sources || []).map(canonicalEvidenceUrl).filter(Boolean))
      unverifiedProgramSourceViolations += (program.sources || []).filter((url) => (
        !groundedSourceUrls.has(canonicalEvidenceUrl(url))
      )).length
      if (canonicalEvidenceUrl(program.website) !== canonicalEvidenceUrl(grounded.website)) {
        unverifiedProgramSourceViolations += 1
      }

      for (const [field, sourceUrl] of Object.entries(program.factSources || {})) {
        if (!sourceUrl) continue
        if (canonicalEvidenceUrl(sourceUrl) !== canonicalEvidenceUrl(grounded.factSources?.[field])) {
          unverifiedFieldFactSources += 1
        }
      }

      const groundedAdvisorKeys = new Set((grounded.pis || []).map((pi) => (
        `${String(pi?.name || '').trim().toLowerCase()}|${canonicalEvidenceUrl(pi?.url)}`
      )))
      unverifiedAdvisorProfiles += (program.pis || []).filter((pi) => !groundedAdvisorKeys.has(
        `${String(pi?.name || '').trim().toLowerCase()}|${canonicalEvidenceUrl(pi?.url)}`,
      )).length
      verifiedAdvisorProfiles += grounded.pis?.length || 0
    }

    const website = canonicalEvidenceUrl(program.website)
    if (website) {
      const identity = `${String(school.school || '').trim().toLowerCase()}|${website}`
      if (programIdentities.has(identity)) duplicateProgramRows += 1
      else programIdentities.add(identity)
    }
  }
  const successfulSchoolCrawls = schools.filter((school) => school.crawlStatus === 'ok').length
  const indexedAdvisorPages = schools.reduce((total, school) => total + (school.advisorPages?.length || 0), 0)
  const scholarlyInstitutionsResolved = schools.filter((school) => school.scholarlyEvidence?.status === 'ok').length
  const genericProgramRows = aiPrograms.filter((program) => isGenericProgramLabel(program.program)).length
  const invalidProgramIdentityRows = aiPrograms.filter((program) => (
    ['generic-program-label', 'program-identity-not-specific'].includes(
      groundingRejectionById.get(program.id),
    )
  )).length
  const officialProgramCoverage = aiPrograms.length ? sourcedPrograms.length / aiPrograms.length : 0
  const requestedPrograms = Math.max(1, Number(options.requestedPrograms) || 5)
  const scopedSourceCount = Math.max(1, Number(options.scopedSourceCount) || schools.length || 1)
  const minimumReadableSites = Math.min(scopedSourceCount, Math.max(1, Number(options.minimumReadableSites) || 3))
  const minimumPrograms = Math.min(requestedPrograms, Math.max(1, Number(options.minimumPrograms) || 3))
  const minimumAdvisors = Math.min(minimumPrograms, Math.max(1, Number(options.minimumAdvisors) || 1))
  const failures = []
  const warnings = []
  // Coverage gates scale to the selected regions and requested result count.
  // The former fixed threshold of 100 made every US-only/UK-only run
  // mathematically impossible to pass even when its returned rows were valid.
  // Coverage shortfalls are useful, honest partial results rather than a reason
  // to discard every verified row. Only evidence-integrity failures block the
  // run; the caller persists warnings for the UI/source audit.
  if (successfulSchoolCrawls === 0) failures.push('no-readable-official-sites')
  else if (successfulSchoolCrawls < minimumReadableSites) warnings.push('insufficient-readable-official-sites')
  if (sourcedPrograms.length === 0) failures.push('no-source-grounded-programs')
  else if (sourcedPrograms.length < minimumPrograms) warnings.push('insufficient-source-grounded-programs')
  if (crossSchoolSourceViolations > 0) failures.push('cross-school-source-contamination')
  if (genericProgramRows > 0) failures.push('generic-program-labels-retained')
  if (invalidProgramIdentityRows > 0) failures.push('invalid-program-identities-retained')
  if (unverifiedProgramEvidenceRows > 0 || unverifiedProgramSourceViolations > 0) {
    failures.push('unverified-program-evidence-retained')
  }
  if (unverifiedAdvisorProfiles > 0) failures.push('unverified-advisor-profiles-retained')
  if (unverifiedFieldFactSources > 0) failures.push('unverified-field-facts-retained')
  if (promptInjectionEvidenceViolations > 0) failures.push('prompt-injection-evidence-retained')
  if (duplicateProgramRows > 0) failures.push('duplicate-program-url-retained')
  if (scholarlyInstitutionsResolved < 1) warnings.push('no-scholarly-institution-resolution')
  if (verifiedAdvisorProfiles < minimumAdvisors) warnings.push('insufficient-individually-verified-advisors')
  return {
    passed: failures.length === 0,
    coveragePassed: warnings.length === 0,
    checkedAt: new Date().toISOString(),
    failures,
    warnings,
    successfulSchoolCrawls,
    indexedAdvisorPages,
    aiProgramCount: aiPrograms.length,
    sourcedProgramCount: sourcedPrograms.length,
    officialProgramCoverage,
    crossSchoolSourceViolations,
    genericProgramRows,
    invalidProgramIdentityRows,
    unverifiedProgramEvidenceRows,
    unverifiedProgramSourceViolations,
    unverifiedAdvisorProfiles,
    unverifiedFieldFactSources,
    promptInjectionEvidenceViolations,
    duplicateProgramRows,
    verifiedAdvisorProfiles,
    scholarlyInstitutionsResolved,
    thresholds: { minimumReadableSites, minimumPrograms, minimumAdvisors },
  }
}
