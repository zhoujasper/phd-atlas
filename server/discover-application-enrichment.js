const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max)

function normalizedWords(value) {
  return new Set(clean(value, 300)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1))
}

function similarity(left, right) {
  const a = normalizedWords(left)
  const b = normalizedWords(right)
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const word of a) if (b.has(word)) overlap += 1
  return (2 * overlap) / (a.size + b.size)
}

function hostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function matchScore(application, program) {
  const school = similarity(application?.school?.name, program?.school)
  const degree = similarity(application?.program, program?.program)
  const appHost = hostname(application?.school?.website)
  const programHost = hostname(program?.website)
  const host = appHost && programHost && (appHost === programHost || appHost.endsWith(`.${programHost}`) || programHost.endsWith(`.${appHost}`)) ? 1 : 0
  return Math.round((school * 0.68 + degree * 0.27 + host * 0.05) * 100)
}

export function findBestDiscoverProgram(application, programs) {
  const candidates = (Array.isArray(programs) ? programs : [])
    .map((program) => ({ program, score: matchScore(application, program) }))
    .sort((a, b) => b.score - a.score)
  return candidates[0]?.score >= 32 ? candidates[0] : null
}

function uniqueStrings(values, max = 24) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value, 500))
    .filter(Boolean))).slice(0, max)
}

function createChange({
  id,
  target,
  category,
  before = '',
  after = '',
  source = 'catalog',
  confidence = 'medium',
  sources = [],
  forceMode,
}) {
  const current = clean(before)
  const next = clean(after)
  if (!next || current === next) return null
  const mode = forceMode || (current ? 'update' : 'fill')
  return {
    id,
    target,
    category,
    mode,
    before: current,
    after: next,
    source,
    confidence,
    recommended: mode !== 'update',
    sources: uniqueStrings(sources, 12),
  }
}

function safeAi(ai) {
  if (!ai || typeof ai !== 'object') return null
  const advisor = ai.suggestedAdvisor && typeof ai.suggestedAdvisor === 'object'
    ? {
        name: clean(ai.suggestedAdvisor.name, 180),
        email: clean(ai.suggestedAdvisor.email, 240),
        homepage: clean(ai.suggestedAdvisor.homepage, 500),
        research: clean(ai.suggestedAdvisor.research, 1200),
      }
    : null
  return {
    researchSummary: clean(ai.researchSummary, 1600),
    fitRationale: clean(ai.fitRationale, 1600),
    requirementsSummary: clean(ai.requirementsSummary, 1600),
    fundingSummary: clean(ai.fundingSummary, 1200),
    caveats: uniqueStrings(ai.caveats, 8),
    sources: uniqueStrings(ai.sources, 12),
    suggestedAdvisor: advisor?.name ? advisor : null,
  }
}

export function parseAiApplicationEnrichment(text) {
  try {
    const cleaned = clean(text, 30_000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    return safeAi(JSON.parse(cleaned))
  } catch {
    return null
  }
}

function requirementSummary(program, ai) {
  if (ai?.requirementsSummary) return ai.requirementsSummary
  return [
    program.deadlineAndTests,
    program.applicationRestrictions,
    program.applicationRoute,
  ].map((value) => clean(value, 800)).filter(Boolean).join('\n')
}

function fundingSummary(program, ai) {
  if (ai?.fundingSummary) return ai.fundingSummary
  return [program.stipendLocal, program.stipendBasis, program.stipendNotes]
    .map((value) => clean(value, 800)).filter(Boolean).join('\n')
}

function snapshotPayload(program, ai, sources) {
  return {
    programId: clean(program.id, 80),
    school: clean(program.school, 240),
    program: clean(program.program, 240),
    website: clean(program.website, 500),
    deadline: clean(program.deadlineIso, 40),
    research: ai?.researchSummary || clean(program.researchFocus, 1600),
    fit: ai?.fitRationale || clean(program.fitRationale, 1600),
    funding: fundingSummary(program, ai),
    requirements: requirementSummary(program, ai),
    outcomes: clean(program.careerOutcomes, 1200),
    international: clean(program.intlNotes, 1200),
    sources,
  }
}

export function buildApplicationEnrichmentProposal(application, programs, aiInput = null) {
  const matched = findBestDiscoverProgram(application, programs)
  const ai = safeAi(aiInput)
  const generatedAt = new Date().toISOString()
  if (!matched) {
    return {
      applicationId: clean(application?.id, 100),
      generatedAt,
      usedAi: Boolean(ai),
      matchedProgram: null,
      changes: [],
      caveats: ['No sufficiently close program was found in the current Discover catalog. Add or research the program in Discover first.'],
      payload: {},
    }
  }

  const { program, score } = matched
  // Sources remain catalog-backed even when AI synthesizes the prose. This
  // prevents a model-generated URL from being promoted as verified evidence.
  const sources = uniqueStrings([program.website, ...(program.sources || [])], 12)
  const source = ai ? 'catalog_ai' : 'catalog'
  const confidence = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'
  const changes = []
  const push = (change) => { if (change) changes.push(change) }

  push(createChange({
    id: 'school-website', target: 'school.website', category: 'identity',
    before: application?.school?.website, after: program.website, confidence, sources,
  }))
  push(createChange({
    id: 'application-deadline', target: 'deadline', category: 'requirements',
    before: application?.deadline, after: program.deadlineIso, confidence, sources,
  }))

  const aiAdvisor = ai?.suggestedAdvisor
    ? (program.pis || []).find((candidate) => (
        similarity(candidate.name, ai.suggestedAdvisor.name) >= 0.75
        || (candidate.email && clean(candidate.email).toLowerCase() === clean(ai.suggestedAdvisor.email).toLowerCase())
      ))
    : null
  const advisor = aiAdvisor || (program.pis || [])[0] || null
  if (advisor) {
    const advisorSource = aiAdvisor ? 'catalog_ai' : 'catalog'
    push(createChange({
      id: 'advisor-name', target: 'professor.english', category: 'advisor',
      before: application?.professor?.english, after: advisor.name, source: advisorSource,
      confidence: aiAdvisor ? 'medium' : confidence, sources,
    }))
    push(createChange({
      id: 'advisor-email', target: 'professor.email', category: 'advisor',
      before: application?.professor?.email, after: advisor.email, source: advisorSource,
      confidence: advisor.email ? confidence : 'unknown', sources,
    }))
    push(createChange({
      id: 'advisor-homepage', target: 'professor.homepage', category: 'advisor',
      before: application?.professor?.homepage, after: advisor.homepage || advisor.url, source: advisorSource,
      confidence, sources,
    }))
    push(createChange({
      id: 'advisor-research', target: 'professor.research', category: 'research',
      before: application?.professor?.research, after: advisor.research || ai?.researchSummary, source,
      confidence, sources,
    }))
  }

  const mergedTags = uniqueStrings([...(application?.tags || []), ...(program.tags || []), 'discover-enriched'], 12)
  if (mergedTags.join('\n') !== uniqueStrings(application?.tags || [], 12).join('\n')) {
    push(createChange({
      id: 'research-tags', target: 'tags', category: 'research',
      before: (application?.tags || []).join(', '), after: mergedTags.join(', '), source,
      confidence, sources, forceMode: 'merge',
    }))
  }

  const snapshot = snapshotPayload(program, ai, sources)
  push(createChange({
    id: 'discover-dossier', target: 'dossier.discover', category: 'research',
    before: (application?.dossierCards || []).some((card) => card.id === `discover-research-${program.id}`) ? 'Existing Discover research snapshot' : '',
    after: 'Program fit, funding, requirements, outcomes and official sources', source,
    confidence, sources, forceMode: 'create',
  }))
  if (program.stipendLocal) {
    push(createChange({
      id: 'discover-funding', target: 'scholarship.discover', category: 'funding',
      before: (application?.scholarships || []).some((item) => item.id === `discover-stipend-${program.id}`) ? 'Existing stipend snapshot' : '',
      after: clean(program.stipendLocal, 500), source, confidence: program.stipendConfidence || confidence,
      sources, forceMode: 'create',
    }))
  }
  if (!(application?.timeline || []).some((item) => item.id === `discover-enriched-${program.id}`)) {
    push(createChange({
      id: 'discover-timeline', target: 'timeline.discover', category: 'workflow',
      after: 'Research snapshot added from Discover', source, confidence, sources, forceMode: 'create',
    }))
  }

  return {
    applicationId: clean(application?.id, 100),
    generatedAt,
    usedAi: Boolean(ai),
    matchedProgram: {
      id: clean(program.id, 80),
      school: clean(program.school, 240),
      program: clean(program.program, 240),
      matchScore: score,
    },
    changes,
    caveats: uniqueStrings([
      'Discover data is a research snapshot, not a live guarantee. Verify deadlines, funding and recruiting status on official pages.',
      ...(ai?.caveats || []),
      ...(score < 60 ? ['The catalog match is uncertain. Review the matched school and program before applying changes.'] : []),
    ], 10),
    payload: { snapshot, tags: mergedTags },
  }
}

function dossierCardFrom(snapshot, now) {
  const field = (id, label, value, type = 'textarea') => ({ id, label, value: clean(value, 4000), type, width: 'full' })
  return {
    id: `discover-research-${clean(snapshot.programId, 80)}`,
    title: 'Discover research snapshot',
    icon: 'sparkles',
    color: '#0071e3',
    width: 'full',
    fields: [
      field('research', 'Research focus', snapshot.research),
      field('fit', 'Why it may fit', snapshot.fit),
      field('funding', 'Funding snapshot', snapshot.funding),
      field('requirements', 'Application requirements', snapshot.requirements),
      field('outcomes', 'Career outcomes', snapshot.outcomes),
      field('international', 'International applicant notes', snapshot.international),
      field('sources', 'Official sources to verify', uniqueStrings(snapshot.sources, 12).join('\n'), 'textarea'),
    ].filter((item) => item.value),
    createdAt: now,
    updatedAt: now,
  }
}

export function applyApplicationEnrichmentProposal(application, proposal, acceptedChangeIds) {
  const accepted = new Set(Array.isArray(acceptedChangeIds) ? acceptedChangeIds : [])
  const changes = new Map((Array.isArray(proposal?.changes) ? proposal.changes : []).map((change) => [change.id, change]))
  const next = structuredClone(application)
  const now = new Date().toISOString()
  const applyText = (id, setter) => {
    const change = changes.get(id)
    if (accepted.has(id) && change?.after) setter(clean(change.after))
  }

  next.professor = { ...(next.professor || {}) }
  next.school = { ...(next.school || {}) }
  applyText('school-website', (value) => { next.school.website = value })
  applyText('application-deadline', (value) => { next.deadline = value })
  applyText('advisor-name', (value) => { next.professor.english = value })
  applyText('advisor-email', (value) => { next.professor.email = value })
  applyText('advisor-homepage', (value) => { next.professor.homepage = value })
  applyText('advisor-research', (value) => { next.professor.research = value })

  if (accepted.has('research-tags') && changes.has('research-tags')) {
    next.tags = uniqueStrings(proposal?.payload?.tags || changes.get('research-tags').after.split(','), 12)
  }

  const snapshot = proposal?.payload?.snapshot && typeof proposal.payload.snapshot === 'object'
    ? proposal.payload.snapshot
    : null
  if (accepted.has('discover-dossier') && changes.has('discover-dossier') && snapshot?.programId) {
    const card = dossierCardFrom(snapshot, now)
    const cards = Array.isArray(next.dossierCards) ? [...next.dossierCards] : []
    const index = cards.findIndex((item) => item.id === card.id)
    if (index >= 0) card.createdAt = cards[index].createdAt || now
    if (index >= 0) cards[index] = card
    else cards.push(card)
    next.dossierCards = cards
  }

  if (accepted.has('discover-funding') && changes.has('discover-funding') && snapshot?.programId) {
    const id = `discover-stipend-${clean(snapshot.programId, 80)}`
    const scholarship = {
      id,
      name: 'Program stipend (Discover snapshot)',
      amount: changes.get('discover-funding').after,
      startDate: now.slice(0, 10),
      endDate: clean(snapshot.deadline, 40) || next.deadline,
      school: clean(snapshot.school, 240),
      issuer: clean(snapshot.school, 240),
      status: 'Draft',
      notes: `${clean(snapshot.funding, 3000)}\nVerify with the official sources in the Discover research card.`.trim(),
      materials: [], tasks: [], timeline: [],
    }
    const scholarships = Array.isArray(next.scholarships) ? [...next.scholarships] : []
    const index = scholarships.findIndex((item) => item.id === id)
    if (index >= 0) scholarships[index] = scholarship
    else scholarships.push(scholarship)
    next.scholarships = scholarships
  }

  if (accepted.has('discover-timeline') && changes.has('discover-timeline') && snapshot?.programId) {
    const id = `discover-enriched-${clean(snapshot.programId, 80)}`
    if (!(next.timeline || []).some((item) => item.id === id)) {
      next.timeline = [{
        id,
        title: 'Enriched from Discover',
        date: now.slice(0, 10),
        note: `${clean(snapshot.school, 240)} · ${clean(snapshot.program, 240)} · research snapshot`,
      }, ...(next.timeline || [])]
    }
  }
  next.updatedAt = now
  return next
}
