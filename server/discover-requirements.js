/**
 * Structured application requirements for Discover programs.
 * Snapshots — always verify on official pages.
 */

function nextDeadline(month, day) {
  const now = new Date()
  let year = now.getFullYear()
  const candidate = new Date(year, month - 1, day)
  if (candidate < now) year += 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function ddl(id, label, month, day, kind = 'application', certainty = 'typical', notes = '') {
  return {
    id,
    label,
    date: month && day ? nextDeadline(month, day) : null,
    kind,
    certainty,
    notes,
  }
}

function tests(gre, english = 'required_if_intl', extra = []) {
  return [
    { id: 'gre', name: 'GRE', status: gre, notes: gre === 'not_required' ? 'Often not required in recent cycles' : '' },
    {
      id: 'english',
      name: 'TOEFL / IELTS',
      status: english,
      notes: english === 'required_if_intl' ? 'Usually required for non-native English applicants' : '',
    },
    ...extra,
  ]
}

function materials(letterCount = 3, extras = []) {
  return [
    { id: 'cv', name: 'Academic CV', required: true },
    { id: 'sop', name: 'Statement of Purpose / Personal Statement', required: true },
    { id: 'transcript', name: 'Transcripts', required: true },
    { id: 'letters', name: 'Recommendation letters', required: true, count: letterCount },
    { id: 'rp', name: 'Research statement / proposal', required: false, notes: 'Often recommended for research-fit programs' },
    ...extras,
  ]
}

function fees(amountUSD, waiverAvailable, notes = '') {
  return {
    amountUSD: amountUSD == null ? null : amountUSD,
    currency: 'USD',
    waiverAvailable: Boolean(waiverAvailable),
    notes,
  }
}

function restrictions({ multiApply = 'unknown', supervisorContact = 'optional', priorDegree = 'Bachelor’s or equivalent', intlEligible = true, other = [], summary = '' }) {
  return {
    multiApply,
    supervisorContact,
    priorDegree,
    intlEligible,
    other,
    summary,
  }
}

function route(type, label, steps, notes = '') {
  return { type, label, steps, notes }
}

/** Per-program structured requirement overrides (merged onto smart defaults). */
const OVERRIDES = {
  prog_mit_eecs: {
    deadlines: [
      ddl('main', 'EECS PhD deadline', 12, 15, 'application', 'typical', 'Confirm annual MIT EECS date'),
      ddl('funding', 'Internal fellowship consideration', 12, 15, 'funding', 'typical'),
    ],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(3, [{ id: 'writing', name: 'Writing sample (some areas)', required: false }]),
    fees: fees(75, true, 'Fee waiver available in some cases — check Grad Admissions'),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'optional',
      priorDegree: 'Strong BS/MS with research evidence',
      summary: 'Single EECS application; research fit and letters matter more than cold email.',
      other: ['Extremely competitive', 'Research experience strongly preferred'],
    }),
    route: route('portal', 'MIT Graduate Admissions portal', [
      'Create applicant account',
      'Select EECS PhD',
      'Upload materials & recommenders',
      'Pay fee / waiver',
      'Submit before deadline',
    ]),
    degreeMilestones: ['Coursework', 'Qualifying exam', 'Thesis proposal', 'Defense'],
    verified: { deadlines: false, restrictions: false, fees: false },
  },
  prog_stanford_cs: {
    deadlines: [ddl('main', 'CS PhD deadline', 12, 5, 'application', 'typical')],
    tests: tests('not_required', 'required_if_intl'),
    materials: materials(3),
    fees: fees(125, true, 'Need-based fee waivers may be available'),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'optional',
      summary: 'Faculty contact optional; research match is critical.',
      other: ['Very high bar for publications / research depth'],
    }),
    route: route('portal', 'Stanford Graduate Admissions + CS', [
      'University application',
      'CS program materials',
      'Recommender invites',
      'Submit',
    ]),
    degreeMilestones: ['Research milestones', 'Candidacy', 'Dissertation'],
  },
  prog_cmu_ml: {
    deadlines: [ddl('main', 'ML / CSD PhD deadline', 12, 11, 'application', 'typical')],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(3),
    fees: fees(75, true),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'optional',
      summary: 'May apply to multiple SCS units — check current multi-apply policy.',
      other: ['MLD and CSD have separate processes'],
    }),
    route: route('portal', 'SCS graduate applications', [
      'Choose MLD and/or CSD',
      'Upload materials',
      'Submit each program application as required',
    ]),
    degreeMilestones: ['Courses', 'Research', 'Thesis'],
  },
  prog_uw_cs: {
    deadlines: [ddl('main', 'Allen School PhD deadline', 12, 12, 'application', 'typical')],
    tests: tests('not_required', 'required_if_intl'),
    materials: materials(3),
    fees: fees(85, true),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'recommended',
      summary: 'Faculty interest helps but is not always required.',
    }),
    route: route('portal', 'Allen School graduate admissions', ['Portal application', 'Materials', 'Submit']),
  },
  prog_berkeley_eecs: {
    deadlines: [ddl('main', 'EECS PhD deadline', 12, 9, 'application', 'typical')],
    tests: tests('not_required', 'required_if_intl'),
    materials: materials(3),
    fees: fees(135, true),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'optional',
      summary: 'Highly competitive; strong research trajectory expected.',
    }),
    route: route('portal', 'UC Berkeley Graduate Division + EECS', ['University app', 'EECS materials', 'Submit']),
  },
  prog_oxford_cs: {
    deadlines: [
      ddl('funding', 'Funding deadline (main)', 12, 1, 'funding', 'typical', 'Funding rounds often earlier'),
      ddl('main', 'Program deadline', 1, 9, 'application', 'typical'),
    ],
    tests: tests('not_required', 'required_if_intl', [{ id: 'gre_subj', name: 'Subject tests', status: 'not_required' }]),
    materials: materials(3, [{ id: 'proposal', name: 'Research proposal', required: true }]),
    fees: fees(75, true, 'Application fee; scholarships separate'),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'recommended',
      priorDegree: 'Strong first degree; Master’s often preferred',
      summary: 'Supervisor alignment and funding are central in UK DPhil process.',
      other: ['Funding not automatic for all admits'],
    }),
    route: route('portal', 'University of Oxford graduate application', [
      'Identify supervisor / research group',
      'University application',
      'College preferences',
      'Funding applications',
    ]),
    degreeMilestones: ['Transfer of status', 'Confirmation', 'Thesis'],
  },
  prog_cambridge_cs: {
    deadlines: [
      ddl('funding', 'Funding deadline', 12, 3, 'funding', 'typical'),
      ddl('main', 'Course deadline', 1, 15, 'application', 'typical'),
    ],
    tests: tests('not_required', 'required_if_intl'),
    materials: materials(2, [{ id: 'proposal', name: 'Research proposal', required: true }]),
    fees: fees(70, true),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'recommended',
      summary: 'Early funding deadlines; supervisor agreement often expected.',
    }),
    route: route('portal', 'Cambridge postgraduate application', ['Supervisor outreach', 'Portal app', 'Funding']),
  },
  prog_eth_cs: {
    deadlines: [ddl('rolling', 'Position / lab hiring', null, null, 'application', 'rolling', 'Often open PhD positions')],
    tests: tests('not_required', 'optional'),
    materials: materials(2, [{ id: 'cover', name: 'Cover letter / motivation', required: true }]),
    fees: fees(0, true, 'Often employment contract; not a classic app fee'),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'required',
      priorDegree: 'Master’s commonly expected',
      summary: 'PI-driven hiring culture; apply to open positions and contact labs.',
      other: ['Doctoral students often employees'],
    }),
    route: route('position', 'Open PhD positions + professor', [
      'Find open call or lab page',
      'Contact PI with CV + interests',
      'Interview / offer',
      'Enroll via ETH doctoral process',
    ]),
    degreeMilestones: ['Doctoral plan', 'Research', 'Defense'],
  },
  prog_epfl_ic: {
    deadlines: [
      ddl('call1', 'Doctoral school call', 4, 15, 'application', 'typical'),
      ddl('call2', 'Doctoral school call', 11, 15, 'application', 'typical'),
    ],
    tests: tests('not_required', 'optional'),
    materials: materials(2),
    fees: fees(0, true),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'required',
      priorDegree: 'Master’s preferred',
      summary: 'Lab acceptance + doctoral school; English-friendly.',
    }),
    route: route('mixed', 'EDIC / IC doctoral school + lab', ['Lab contact', 'Doctoral school application', 'Offer']),
  },
  prog_toronto_cs: {
    deadlines: [ddl('main', 'CS PhD deadline', 12, 1, 'application', 'typical')],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(3),
    fees: fees(125, true),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'recommended',
      summary: 'Competitive ML track; research experience valued.',
    }),
    route: route('portal', 'U of T CS graduate admissions', ['Online application', 'Materials', 'Submit']),
  },
  prog_ubc_cs: {
    deadlines: [ddl('main', 'CS PhD deadline', 12, 15, 'application', 'typical')],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(3),
    fees: fees(110, true),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'recommended',
      summary: 'Supervisor interest helps; COL in Vancouver is high.',
    }),
    route: route('portal', 'UBC CS graduate application', ['Portal', 'Materials', 'Submit']),
  },
  prog_nus_cs: {
    deadlines: [
      ddl('aug', 'August intake', 11, 1, 'application', 'typical'),
      ddl('jan', 'January intake', 5, 15, 'application', 'typical'),
    ],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(2),
    fees: fees(50, true, 'Scholarship schemes vary'),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'recommended',
      summary: 'Multiple intakes; competitive scholarships for internationals.',
    }),
    route: route('portal', 'NUS SoC graduate admissions', ['Choose intake', 'Apply online', 'Scholarship options']),
  },
  prog_ntu_scse: {
    deadlines: [ddl('main', 'Main scholarship round', 10, 31, 'funding', 'typical')],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(2),
    fees: fees(50, true),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'recommended',
      summary: 'Scholarship tiers differ; check SCSE pages each cycle.',
    }),
    route: route('portal', 'NTU SCSE graduate admissions', ['Online application', 'Scholarship', 'Submit']),
  },
  prog_hku_cs: {
    deadlines: [ddl('main', 'Main round', 12, 1, 'application', 'typical')],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(2),
    fees: fees(45, true),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'recommended',
      summary: 'English program; scholarship planning important.',
    }),
    route: route('portal', 'HKU Faculty graduate school', ['Online application', 'Materials', 'Submit']),
  },
  prog_tsinghua_cs: {
    deadlines: [ddl('intl', 'International / CSC round', 3, 1, 'application', 'typical')],
    tests: tests('not_required', 'required_if_intl', [{ id: 'hsk', name: 'HSK (some tracks)', status: 'required_if_intl' }]),
    materials: materials(2, [{ id: 'proposal', name: 'Research plan', required: true }]),
    fees: fees(0, true, 'Fees/scholarships track-dependent'),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'recommended',
      summary: 'Domestic vs international tracks differ; language requirements vary.',
      other: ['Verify Chinese/English track requirements'],
    }),
    route: route('mixed', 'International students office / department track', [
      'Choose track (CSC / university)',
      'Supervisor contact recommended',
      'Submit materials',
    ]),
  },
  prog_pku_cs: {
    deadlines: [ddl('intl', 'International round', 3, 15, 'application', 'typical')],
    tests: tests('not_required', 'required_if_intl'),
    materials: materials(2, [{ id: 'proposal', name: 'Research plan', required: true }]),
    fees: fees(0, true),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'recommended',
      summary: 'Track-dependent language and scholarship rules.',
    }),
    route: route('mixed', 'PKU international / department process', ['Track selection', 'Materials', 'Submit']),
  },
  prog_anu_cs: {
    deadlines: [
      ddl('rtp', 'RTP / scholarship round', 8, 31, 'funding', 'typical'),
      ddl('hdr', 'HDR application', null, null, 'application', 'rolling', 'Often rolling with scholarship rounds'),
    ],
    tests: tests('not_required', 'required_if_intl'),
    materials: materials(2, [{ id: 'proposal', name: 'Research proposal', required: true }]),
    fees: fees(0, true, 'RTP covers stipend for awardees; tuition scholarships separate'),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'required',
      priorDegree: 'Honours / Master’s research background preferred',
      summary: 'Supervisor agreement + competitive RTP scholarships.',
    }),
    route: route('mixed', 'HDR + supervisor', ['Find supervisor', 'HDR application', 'Scholarship round']),
  },
  prog_unimelb_cis: {
    deadlines: [ddl('rtp', 'Scholarship round', 10, 31, 'funding', 'typical')],
    tests: tests('not_required', 'required_if_intl'),
    materials: materials(2, [{ id: 'proposal', name: 'Research proposal', required: true }]),
    fees: fees(0, true),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'required',
      summary: 'Supervisor match + scholarship competitiveness.',
    }),
    route: route('mixed', 'Faculty graduate research', ['Supervisor', 'Application', 'Scholarship']),
  },
  prog_mpi_is: {
    deadlines: [ddl('call', 'IMPRS / open call', 11, 30, 'application', 'typical')],
    tests: tests('not_required', 'optional'),
    materials: materials(2, [{ id: 'cover', name: 'Motivation letter', required: true }]),
    fees: fees(0, true, 'Contract / institute employment style'),
    restrictions: restrictions({
      multiApply: 'multi',
      supervisorContact: 'required',
      priorDegree: 'Strong MS preferred',
      summary: 'Call-based / position-based; partner university enrollment.',
    }),
    route: route('position', 'Open calls / IMPRS', ['Watch calls', 'Apply package', 'Interview', 'Offer']),
  },
  prog_gatech_cs: {
    deadlines: [ddl('main', 'CS PhD deadline', 12, 15, 'application', 'typical')],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(3),
    fees: fees(75, true),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'optional',
      summary: 'Standard US PhD portal process.',
    }),
    route: route('portal', 'College of Computing application', ['Portal', 'Materials', 'Submit']),
  },
  prog_uiuc_cs: {
    deadlines: [ddl('main', 'CS PhD deadline', 12, 15, 'application', 'typical')],
    tests: tests('optional', 'required_if_intl'),
    materials: materials(3),
    fees: fees(70, true),
    restrictions: restrictions({
      multiApply: 'single',
      supervisorContact: 'optional',
      summary: 'Broad faculty; strong systems/ML reputation.',
    }),
    route: route('portal', 'Illinois CS graduate admissions', ['Portal', 'Materials', 'Submit']),
  },
}

function defaultFromProgram(program) {
  const multi = program.multiApply === 'multi' || program.multiApply === 'single' ? program.multiApply : 'unknown'
  const deadlineIso = program.deadlineIso || null
  return {
    deadlines: deadlineIso
      ? [{
          id: 'main',
          label: 'Primary deadline',
          date: deadlineIso,
          kind: 'application',
          certainty: 'typical',
          notes: program.deadlineAndTests || '',
        }]
      : [{
          id: 'unknown',
          label: 'Deadline',
          date: null,
          kind: 'application',
          certainty: 'unknown',
          notes: program.deadlineAndTests || '',
        }],
    tests: tests('unknown', 'required_if_intl'),
    materials: materials(3),
    fees: fees(null, false, 'Verify application fee on official site'),
    restrictions: restrictions({
      multiApply: multi,
      supervisorContact: 'unknown',
      summary: program.applicationRestrictions || '',
      other: program.applicationRestrictions ? [program.applicationRestrictions] : [],
    }),
    route: route(
      'unknown',
      program.applicationRoute || 'See program page',
      program.applicationRoute ? [program.applicationRoute] : ['Check official admissions page'],
      program.applicationRoute || '',
    ),
    degreeMilestones: program.degreeStructure
      ? String(program.degreeStructure).split(/[·,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 6)
      : [],
    verified: { deadlines: false, restrictions: false, fees: false },
  }
}

function mergeRequirements(base, override) {
  if (!override) return base
  return {
    deadlines: override.deadlines || base.deadlines,
    tests: override.tests || base.tests,
    materials: override.materials || base.materials,
    fees: { ...base.fees, ...(override.fees || {}) },
    restrictions: { ...base.restrictions, ...(override.restrictions || {}) },
    route: { ...base.route, ...(override.route || {}) },
    degreeMilestones: override.degreeMilestones || base.degreeMilestones,
    verified: { ...base.verified, ...(override.verified || {}) },
  }
}

function unverifiedAiRequirements(requirements, program) {
  if (program?.provenance !== 'ai') return requirements
  const factSources = program?.factSources && typeof program.factSources === 'object'
    ? program.factSources
    : {}
  const hasDeadline = Boolean(factSources.deadline)
  const hasRestrictions = Boolean(factSources.restrictions)
  const hasInternational = Boolean(factSources.international)
  const hasAdmissionsBackgrounds = Boolean(factSources.admissionsBackgrounds)
  const hasRoute = Boolean(factSources.applicationRoute)
  const hasDegreeStructure = Boolean(factSources.degreeStructure)

  return {
    ...requirements,
    deadlines: hasDeadline
      ? requirements.deadlines
      : [{
          id: 'unknown',
          label: 'Deadline',
          date: null,
          kind: 'application',
          certainty: 'unknown',
          notes: '',
        }],
    // Discover does not yet retain field-level evidence URLs for tests,
    // materials, or application fees. Omitting them is safer than importing a
    // plausible-looking US-style template into every application.
    tests: [],
    materials: [],
    fees: fees(null, false, 'Not verified from a field-specific official source'),
    restrictions: {
      ...requirements.restrictions,
      multiApply: hasRestrictions ? requirements.restrictions?.multiApply || 'unknown' : 'unknown',
      supervisorContact: hasRestrictions ? requirements.restrictions?.supervisorContact || 'unknown' : 'unknown',
      priorDegree: hasAdmissionsBackgrounds ? requirements.restrictions?.priorDegree || '' : '',
      intlEligible: hasInternational ? requirements.restrictions?.intlEligible ?? null : null,
      other: hasRestrictions ? requirements.restrictions?.other || [] : [],
      summary: hasRestrictions ? requirements.restrictions?.summary || '' : '',
    },
    route: hasRoute
      ? requirements.route
      : route('unknown', 'Verify on official program page', ['Check official program page']),
    degreeMilestones: hasDegreeStructure ? requirements.degreeMilestones : [],
    verified: {
      deadlines: hasDeadline,
      restrictions: hasRestrictions || hasInternational || hasAdmissionsBackgrounds,
      fees: false,
    },
  }
}

export function normalizeRequirements(raw, program = {}) {
  if (raw && typeof raw === 'object' && Array.isArray(raw.deadlines)) {
    return unverifiedAiRequirements(mergeRequirements(defaultFromProgram(program), {
      deadlines: raw.deadlines.map((d, i) => ({
        id: String(d.id || `ddl_${i}`).slice(0, 40),
        label: String(d.label || 'Deadline').slice(0, 120),
        date: d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null,
        kind: ['application', 'funding', 'priority', 'interview', 'other'].includes(d.kind) ? d.kind : 'application',
        certainty: ['official', 'typical', 'rolling', 'unknown'].includes(d.certainty) ? d.certainty : 'unknown',
        notes: String(d.notes || '').slice(0, 500),
      })).slice(0, 8),
      tests: Array.isArray(raw.tests)
        ? raw.tests.map((t, i) => ({
            id: String(t.id || `test_${i}`).slice(0, 40),
            name: String(t.name || 'Test').slice(0, 80),
            status: t.status || 'unknown',
            notes: String(t.notes || '').slice(0, 300),
          })).slice(0, 12)
        : undefined,
      materials: Array.isArray(raw.materials)
        ? raw.materials.map((m, i) => ({
            id: String(m.id || `mat_${i}`).slice(0, 40),
            name: String(m.name || 'Material').slice(0, 120),
            required: Boolean(m.required),
            count: m.count != null ? Number(m.count) : undefined,
            notes: String(m.notes || '').slice(0, 300),
          })).slice(0, 16)
        : undefined,
      fees: raw.fees,
      restrictions: raw.restrictions,
      route: raw.route,
      degreeMilestones: raw.degreeMilestones,
      verified: raw.verified,
    }), program)
  }
  const base = defaultFromProgram(program)
  return unverifiedAiRequirements(mergeRequirements(base, OVERRIDES[program.id]), program)
}

export function attachRequirements(program) {
  if (!program) return program
  const requirements = normalizeRequirements(program.requirements, program)
  // Keep free-text fields in sync for import/back-compat
  const primary = requirements.deadlines.find((d) => d.date) || requirements.deadlines[0]
  return {
    ...program,
    requirements,
    deadlineIso: program.deadlineIso || primary?.date || program.deadlineIso,
    multiApply: requirements.restrictions?.multiApply || program.multiApply,
  }
}

export function attachRequirementsToPrograms(programs) {
  return (programs || []).map(attachRequirements)
}

/** Compact filter helpers used by API stats */
export function requirementsStats(programs) {
  let greOptional = 0
  let feeWaiver = 0
  let multi = 0
  let rolling = 0
  let upcoming45 = 0
  const today = new Date().toISOString().slice(0, 10)
  for (const p of programs || []) {
    const r = p.requirements
    if (!r) continue
    const gre = r.tests?.find((t) => t.id === 'gre')
    if (gre && ['optional', 'waived', 'not_required'].includes(gre.status)) greOptional += 1
    if (r.fees?.waiverAvailable) feeWaiver += 1
    if (r.restrictions?.multiApply === 'multi') multi += 1
    if (r.deadlines?.some((d) => d.certainty === 'rolling' || !d.date)) rolling += 1
    const dated = r.deadlines?.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date))[0]
    if (dated?.date) {
      const days = Math.round((new Date(`${dated.date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
      if (days >= 0 && days <= 45) upcoming45 += 1
    }
  }
  return { greOptional, feeWaiver, multi, rolling, upcoming45 }
}
