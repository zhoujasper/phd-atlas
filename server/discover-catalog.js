/**
 * Curated PhD program catalog + intake matching for the Discover surface.
 * Data is research snapshots (public program pages / typical cycles) — not live scraped.
 * Honesty: always surface verification notes; never invent official stipend guarantees.
 */

import {
  attachRequirements,
  attachRequirementsToPrograms,
  normalizeRequirements,
  requirementsStats,
} from './discover-requirements.js'
import { computeAdvancedDiscoverStats } from './discover-stats.js'
import { isGenericProgramLabel } from './discover-source-grounding.js'
import { dedupeDiscoverProgrammeRecords } from './discover-program-identity.js'

const CURRENT_YEAR = new Date().getFullYear()
export const MAX_DISCOVER_PERSISTED_PROGRAMS = 500

export const DISCOVER_REGIONS = [
  { key: 'US', label: 'United States', short: 'US', color: '#0F4D92', order: 1 },
  { key: 'UK', label: 'United Kingdom', short: 'UK', color: '#B64342', order: 2 },
  { key: 'EU', label: 'Europe', short: 'EU', color: '#42949E', order: 3 },
  { key: 'CA', label: 'Canada', short: 'CA', color: '#E2A52C', order: 4 },
  { key: 'SG', label: 'Singapore', short: 'SG', color: '#8B5CF6', order: 5 },
  { key: 'HK', label: 'Hong Kong', short: 'HK', color: '#3775BA', order: 6 },
  { key: 'CN', label: 'China', short: 'CN', color: '#C2410C', order: 7 },
  { key: 'AU', label: 'Australia', short: 'AU', color: '#059669', order: 8 },
  { key: 'OTHER', label: 'Global / other regions', short: 'Global', color: '#64748B', order: 9 },
]

const INTEREST_AREAS = {
  'Machine Learning': ['deep learning', 'foundation models', 'representation learning', 'optimization'],
  NLP: ['language models', 'multilingual', 'evaluation', 'information extraction'],
  'Computer Vision': ['3D vision', 'multimodal', 'perception', 'generative vision'],
  Robotics: ['embodied AI', 'robot learning', 'planning', 'sim-to-real'],
  Systems: ['distributed systems', 'databases', 'privacy', 'ML systems'],
  HCI: ['human-AI collaboration', 'learning analytics', 'interaction', 'trustworthy AI'],
  'Computational Biology': ['genomics', 'single-cell', 'protein', 'biomedical NLP'],
  Security: ['trustworthy ML', 'privacy-preserving', 'adversarial', 'secure systems'],
}

function nextDeadline(month, day) {
  const now = new Date()
  let year = now.getFullYear()
  const candidate = new Date(year, month - 1, day)
  if (candidate < now) year += 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function pi(id, name, category, partial = {}) {
  return {
    id,
    name,
    category,
    hIndex: partial.hIndex ?? null,
    citations: partial.citations ?? null,
    scholarUrl: partial.scholarUrl || `https://scholar.google.com/scholar?q=${encodeURIComponent(name)}`,
    startedApprox: partial.startedApprox || '',
    labSize: partial.labSize || '—',
    wetDry: partial.wetDry || 'dry',
    research: partial.research || '',
    whyFit: partial.whyFit || '',
    recruiting: partial.recruiting || 'Check lab page',
    url: partial.url || '',
    email: partial.email || '',
    rank: partial.rank,
  }
}

/**
 * Curated snapshot catalog. IDs are stable for user state (hide/watch/notes).
 * Stipends and deadlines are approximate public figures — confirm officially.
 */
export const DISCOVER_PROGRAMS = [
  {
    id: 'prog_mit_eecs',
    region: 'US',
    school: 'MIT',
    program: 'EECS PhD',
    city: 'Cambridge, MA',
    country: 'United States',
    website: 'https://www.eecs.mit.edu/academics/graduate-programs/',
    stipendUSD: 48000,
    stipendLocal: '~$48k USD (typical RA/TA package)',
    stipendBasis: 'Department-published graduate funding norms (snapshot)',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Confirm current year package on EECS funding page; COL in Cambridge is high.',
    cohortSize: '~60–80/year (approx.)',
    degreeStructure: 'Coursework + quals + research thesis',
    applicationRoute: 'Department portal; faculty contact optional but helpful',
    deadlineAndTests: 'Dec 15 typical; GRE often optional/waived',
    deadlineIso: nextDeadline(12, 15),
    applicationRestrictions: 'Strong letters + research evidence expected',
    researchFocus: 'ML systems, robotics, vision, NLP, theory, hardware-software co-design',
    wetDryIntegration: 'Primarily dry; robotics labs may include hardware',
    fitScore: 8.5,
    fitRationale: 'Top-tier breadth for ML/robotics/HCI-adjacent work with dense PI pool.',
    siblingPrograms: 'Media Lab, CSAIL-affiliated tracks',
    sources: ['https://www.eecs.mit.edu/'],
    tags: ['Machine Learning', 'Systems', 'Robotics', 'NLP', 'Computer Vision'],
    multiApply: 'single',
    careerOutcomes: 'Academia + industry research labs; strong placement',
    admitBackgrounds: 'Research MS/BS with publications or strong project trail',
    intlNotes: 'International students routinely funded on standard packages',
    colIndex: 1.55,
    pis: [
      pi('pi_mit_1', 'Example Rising PI (ML Systems)', 'rising_star', {
        hIndex: 28, startedApprox: '2021', labSize: '8–12', wetDry: 'dry',
        research: 'Efficient training, inference systems, ML compilers',
        whyFit: 'Strong systems+ML intersection for applicants with systems background',
        recruiting: 'Often recruiting; check recent posts',
        email: 'rising.mlsys@example.edu',
      }),
      pi('pi_mit_2', 'Example Senior PI (Robotics)', 'famous_but_fits', {
        hIndex: 72, startedApprox: '2005', labSize: '20+', wetDry: 'both',
        research: 'Embodied intelligence, manipulation, planning',
        whyFit: 'Classic robotics fit if direction aligns; competitive',
        recruiting: 'Selective yearly intake',
      }),
      pi('pi_mit_3', 'Example Direction-Fit PI (HCI)', 'direction_fit', {
        hIndex: 41, startedApprox: '2014', labSize: '10–15', wetDry: 'dry',
        research: 'Human-AI collaboration, learning interfaces',
        whyFit: 'Good for human-centered AI applicants',
        recruiting: 'Open to strong fit students',
      }),
    ],
  },
  {
    id: 'prog_stanford_cs',
    region: 'US',
    school: 'Stanford University',
    program: 'Computer Science PhD',
    city: 'Stanford, CA',
    country: 'United States',
    website: 'https://cs.stanford.edu/admissions/phd',
    stipendUSD: 52000,
    stipendLocal: '~$50–55k USD range (snapshot)',
    stipendBasis: 'Typical RA stipend band for CS PhD',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Bay Area COL is among the highest; verify current CS funding FAQ.',
    cohortSize: '~50–70/year',
    degreeStructure: 'Research-first PhD with milestones',
    applicationRoute: 'Stanford Graduate Admissions + CS',
    deadlineAndTests: 'Early Dec typical; GRE not required for many cycles',
    deadlineIso: nextDeadline(12, 5),
    applicationRestrictions: 'Extremely competitive; research fit critical',
    researchFocus: 'Foundation models, NLP, vision, robotics, systems, theory',
    wetDryIntegration: 'Dry-heavy; some robotics hardware',
    fitScore: 9.0,
    fitRationale: 'Exceptional advisor density in modern AI; high bar.',
    siblingPrograms: 'EE, ICME',
    sources: ['https://cs.stanford.edu/'],
    tags: ['Machine Learning', 'NLP', 'Computer Vision', 'Systems', 'Robotics'],
    multiApply: 'single',
    careerOutcomes: 'Industry research + academia; strong Silicon Valley network',
    admitBackgrounds: 'Publications, research internships, outstanding letters',
    intlNotes: 'Fully funded international admits are standard when admitted',
    colIndex: 1.7,
    pis: [
      pi('pi_stan_1', 'Example Rising PI (Foundation Models)', 'rising_star', {
        hIndex: 32, startedApprox: '2022', labSize: '10–14', wetDry: 'dry',
        research: 'Alignment, evaluation, efficient LLMs',
        whyFit: 'Hot area; rising lab often seeks strong builders',
        recruiting: 'Actively building lab',
        email: 'fm.rising@example.edu',
      }),
      pi('pi_stan_2', 'Example Famous PI (NLP)', 'famous_but_fits', {
        hIndex: 95, startedApprox: '1998', labSize: '25+', wetDry: 'dry',
        research: 'NLP, language understanding, large models',
        whyFit: 'Best-in-class if topic match is precise',
        recruiting: 'Very selective',
      }),
      pi('pi_stan_3', 'Example Interesting PI (Vision)', 'interesting', {
        hIndex: 45, startedApprox: '2016', labSize: '12–18', wetDry: 'dry',
        research: '3D vision, multimodal learning',
        whyFit: 'Strong for vision-heavy applicants',
        recruiting: 'Regular PhD openings',
      }),
    ],
  },
  {
    id: 'prog_cmu_ml',
    region: 'US',
    school: 'Carnegie Mellon University',
    program: 'Machine Learning PhD / CSD PhD',
    city: 'Pittsburgh, PA',
    country: 'United States',
    website: 'https://www.ml.cmu.edu/academics/phd.html',
    stipendUSD: 43000,
    stipendLocal: '~$40–45k USD (snapshot)',
    stipendBasis: 'Typical SCS graduate stipend ranges',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Pittsburgh COL is more favorable than coastal peers.',
    cohortSize: 'ML PhD smaller; CSD larger',
    degreeStructure: 'Course + research; program-dependent',
    applicationRoute: 'Apply to MLD and/or CSD as appropriate',
    deadlineAndTests: 'Dec typical',
    deadlineIso: nextDeadline(12, 11),
    applicationRestrictions: 'Separate programs; check multi-apply rules carefully',
    researchFocus: 'Core ML, robotics, NLP, systems for ML',
    wetDryIntegration: 'Dry; robotics optional hardware',
    fitScore: 8.8,
    fitRationale: 'Outstanding ML culture and advisor depth; solid real stipend after COL.',
    siblingPrograms: 'RI, LTI, CSD',
    sources: ['https://www.ml.cmu.edu/'],
    tags: ['Machine Learning', 'Robotics', 'NLP', 'Systems'],
    multiApply: 'multi',
    careerOutcomes: 'Top academic and industry placement',
    admitBackgrounds: 'Strong mathematical + research profile',
    intlNotes: 'Standard funded packages for admits',
    colIndex: 1.05,
    pis: [
      pi('pi_cmu_1', 'Example Direction-Fit PI (Core ML)', 'direction_fit', {
        hIndex: 55, startedApprox: '2010', labSize: '15', wetDry: 'dry',
        research: 'Optimization, generalization, trustworthy ML',
        whyFit: 'Excellent for theory-informed ML applicants',
        recruiting: 'Takes students most years',
      }),
      pi('pi_cmu_2', 'Example Rising PI (Robot Learning)', 'rising_star', {
        hIndex: 24, startedApprox: '2020', labSize: '7–10', wetDry: 'both',
        research: 'Robot learning, sim-to-real',
        whyFit: 'Rising lab; good access to advisor',
        recruiting: 'Looking for strong robotics builders',
        email: 'robot.learn@example.edu',
      }),
    ],
  },
  {
    id: 'prog_uw_cs',
    region: 'US',
    school: 'University of Washington',
    program: 'Paul G. Allen School PhD',
    city: 'Seattle, WA',
    country: 'United States',
    website: 'https://www.cs.washington.edu/academics/phd',
    stipendUSD: 42000,
    stipendLocal: '~$40–44k USD (snapshot)',
    stipendBasis: 'Allen School funding norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Seattle COL elevated but below SF Bay.',
    cohortSize: '~40–60',
    degreeStructure: 'Research PhD with milestones',
    applicationRoute: 'Allen School graduate admissions',
    deadlineAndTests: 'Dec typical',
    deadlineIso: nextDeadline(12, 12),
    applicationRestrictions: 'Competitive; faculty fit matters',
    researchFocus: 'NLP, systems, ML, HCI, vision',
    wetDryIntegration: 'Dry',
    fitScore: 8.2,
    fitRationale: 'Strong NLP/HCI/systems cluster; industry proximity.',
    siblingPrograms: 'ECE',
    sources: ['https://www.cs.washington.edu/'],
    tags: ['NLP', 'Systems', 'HCI', 'Machine Learning'],
    multiApply: 'single',
    careerOutcomes: 'Big-tech research + academia',
    admitBackgrounds: 'Research experience preferred',
    intlNotes: 'Funded international admits common',
    colIndex: 1.35,
    pis: [
      pi('pi_uw_1', 'Example Famous PI (NLP)', 'famous_but_fits', {
        hIndex: 80, startedApprox: '2008', labSize: '20+', wetDry: 'dry',
        research: 'NLP, multilingual models, evaluation',
        whyFit: 'Premier NLP lab if direction matches',
        recruiting: 'Selective',
      }),
      pi('pi_uw_2', 'Example Rising PI (HCI)', 'rising_star', {
        hIndex: 22, startedApprox: '2021', labSize: '6–9', wetDry: 'dry',
        research: 'Human-AI interaction, accessibility',
        whyFit: 'Rising HCI-AI lab',
        recruiting: 'Open to interdisciplinary students',
      }),
    ],
  },
  {
    id: 'prog_berkeley_eecs',
    region: 'US',
    school: 'UC Berkeley',
    program: 'EECS PhD',
    city: 'Berkeley, CA',
    country: 'United States',
    website: 'https://eecs.berkeley.edu/academics/graduate/research-programs/',
    stipendUSD: 45000,
    stipendLocal: '~$43–48k USD (snapshot)',
    stipendBasis: 'EECS graduate funding snapshot',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Bay Area COL high; confirm GSI/GSR rates yearly.',
    cohortSize: 'Large EECS cohort',
    degreeStructure: 'Research PhD',
    applicationRoute: 'EECS graduate admissions',
    deadlineAndTests: 'Dec typical',
    deadlineIso: nextDeadline(12, 9),
    applicationRestrictions: 'Very competitive',
    researchFocus: 'AI, systems, theory, circuits, HCI-adjacent',
    wetDryIntegration: 'Dry-heavy',
    fitScore: 8.7,
    fitRationale: 'Elite AI + systems faculty density.',
    siblingPrograms: 'Statistics, BAIR-affiliated labs',
    sources: ['https://eecs.berkeley.edu/'],
    tags: ['Machine Learning', 'Systems', 'Security', 'Computer Vision'],
    multiApply: 'single',
    careerOutcomes: 'Top-tier placement',
    admitBackgrounds: 'Strong research record',
    intlNotes: 'Funded when admitted',
    colIndex: 1.65,
    pis: [
      pi('pi_berk_1', 'Example Direction-Fit PI (ML Security)', 'direction_fit', {
        hIndex: 48, startedApprox: '2012', labSize: '12–16', wetDry: 'dry',
        research: 'Trustworthy ML, privacy, security',
        whyFit: 'Great for security+ML dual interest',
        recruiting: 'Regular openings',
      }),
      pi('pi_berk_2', 'Example Interesting PI (Systems)', 'interesting', {
        hIndex: 38, startedApprox: '2015', labSize: '10', wetDry: 'dry',
        research: 'Data systems, ML systems',
        whyFit: 'Systems-for-AI path',
        recruiting: 'Check recent openings',
      }),
    ],
  },
  {
    id: 'prog_oxford_cs',
    region: 'UK',
    school: 'University of Oxford',
    program: 'DPhil in Computer Science',
    city: 'Oxford',
    country: 'United Kingdom',
    website: 'https://www.cs.ox.ac.uk/admissions/graduate/',
    stipendUSD: 28000,
    stipendLocal: 'UKRI-aligned stipend ~£19–22k (snapshot; convert yearly)',
    stipendBasis: 'UKRI doctoral stipend band + college fees package',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Funding often via scholarships (Clarendon, departmental); not automatic for all admits.',
    cohortSize: 'Selective',
    degreeStructure: '3–4 year research DPhil',
    applicationRoute: 'University application + supervisor alignment recommended',
    deadlineAndTests: 'Dec/Jan cycles common for funding',
    deadlineIso: nextDeadline(12, 1),
    applicationRestrictions: 'Supervisor fit important; funding competitive',
    researchFocus: 'AI, verification, quantum, systems, security',
    wetDryIntegration: 'Dry',
    fitScore: 7.8,
    fitRationale: 'Prestige + strong theory/AI; funding needs careful planning for internationals.',
    siblingPrograms: 'AIMS CDT tracks when open',
    sources: ['https://www.cs.ox.ac.uk/'],
    tags: ['Machine Learning', 'Security', 'Systems'],
    multiApply: 'single',
    careerOutcomes: 'Academia + UK/EU industry research',
    admitBackgrounds: 'Strong academic record + research proposal',
    intlNotes: 'International funding is scholarship-dependent — verify each cycle',
    colIndex: 1.25,
    pis: [
      pi('pi_ox_1', 'Example Direction-Fit PI (AI)', 'direction_fit', {
        hIndex: 42, startedApprox: '2011', labSize: '8–12', wetDry: 'dry',
        research: 'Machine learning theory and applications',
        whyFit: 'Solid UK AI path',
        recruiting: 'Funding-dependent',
      }),
      pi('pi_ox_2', 'Example Rising PI (Security)', 'rising_star', {
        hIndex: 19, startedApprox: '2020', labSize: '5–8', wetDry: 'dry',
        research: 'Security, privacy, trustworthy systems',
        whyFit: 'Accessible rising group',
        recruiting: 'Looking for DPhil students with funding',
      }),
    ],
  },
  {
    id: 'prog_cambridge_cs',
    region: 'UK',
    school: 'University of Cambridge',
    program: 'PhD in Computer Science',
    city: 'Cambridge',
    country: 'United Kingdom',
    website: 'https://www.cst.cam.ac.uk/admissions/phd',
    stipendUSD: 27500,
    stipendLocal: 'UKRI-aligned stipend band (snapshot)',
    stipendBasis: 'UK doctoral stipend norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Many admits need scholarships; confirm college + dept packages.',
    cohortSize: 'Selective',
    degreeStructure: 'Research PhD ~3–4 years',
    applicationRoute: 'Gates/department deadlines vary',
    deadlineAndTests: 'Early funding deadlines often Oct–Dec',
    deadlineIso: nextDeadline(12, 3),
    applicationRestrictions: 'Supervisor agreement often expected',
    researchFocus: 'ML, systems, graphics, security, NLP',
    wetDryIntegration: 'Dry',
    fitScore: 7.9,
    fitRationale: 'Strong research culture; funding and fit both critical.',
    siblingPrograms: 'CDTs when available',
    sources: ['https://www.cst.cam.ac.uk/'],
    tags: ['Machine Learning', 'Systems', 'Computer Vision', 'NLP'],
    multiApply: 'single',
    careerOutcomes: 'Academia + deep-tech',
    admitBackgrounds: 'First-class degree + research potential',
    intlNotes: 'International funding is competitive',
    colIndex: 1.22,
    pis: [
      pi('pi_cam_1', 'Example Interesting PI (Vision)', 'interesting', {
        hIndex: 50, startedApprox: '2009', labSize: '10–14', wetDry: 'dry',
        research: 'Computer vision, graphics',
        whyFit: 'Strong vision cluster',
        recruiting: 'Funding-dependent',
      }),
    ],
  },
  {
    id: 'prog_eth_cs',
    region: 'EU',
    school: 'ETH Zurich',
    program: 'Doctoral studies in Computer Science',
    city: 'Zurich',
    country: 'Switzerland',
    website: 'https://inf.ethz.ch/doctorate.html',
    stipendUSD: 65000,
    stipendLocal: 'CHF ~70–80k employment-style salary (snapshot)',
    stipendBasis: 'ETH doctoral employment contracts (public scales)',
    stipendConfidence: 'high',
    stipendFoundOfficial: true,
    stipendNotes: 'Doctoral students are typically employees; verify current salary tables.',
    cohortSize: 'Lab-driven hiring',
    degreeStructure: 'Research doctorate; often 4 years',
    applicationRoute: 'Often via open PhD positions + professor hire',
    deadlineAndTests: 'Rolling / position-based more than single deadline',
    deadlineIso: nextDeadline(11, 15),
    applicationRestrictions: 'PI-driven offers common',
    researchFocus: 'ML, robotics, systems, security, theory',
    wetDryIntegration: 'Both available depending on lab',
    fitScore: 8.6,
    fitRationale: 'Excellent real stipend and research quality; process is PI-centric.',
    siblingPrograms: 'Max Planck / ELLIS network links',
    sources: ['https://inf.ethz.ch/'],
    tags: ['Machine Learning', 'Robotics', 'Systems', 'Security'],
    multiApply: 'multi',
    careerOutcomes: 'EU academia + industry research',
    admitBackgrounds: 'Strong MS preferred in many labs',
    intlNotes: 'International PhD employment is common; visa support standard',
    colIndex: 1.45,
    pis: [
      pi('pi_eth_1', 'Example Famous PI (Robotics)', 'famous_but_fits', {
        hIndex: 70, startedApprox: '2006', labSize: '20+', wetDry: 'both',
        research: 'Robotics, learning for control',
        whyFit: 'World-class robotics',
        recruiting: 'Open positions posted',
      }),
      pi('pi_eth_2', 'Example Rising PI (ML)', 'rising_star', {
        hIndex: 26, startedApprox: '2021', labSize: '6–10', wetDry: 'dry',
        research: 'Probabilistic ML, causal methods',
        whyFit: 'Rising group with good mentoring bandwidth',
        recruiting: 'Hiring PhD researchers',
        email: 'eth.ml@example.ch',
      }),
    ],
  },
  {
    id: 'prog_epfl_ic',
    region: 'EU',
    school: 'EPFL',
    program: 'PhD in Computer and Communication Sciences',
    city: 'Lausanne',
    country: 'Switzerland',
    website: 'https://www.epfl.ch/education/phd/',
    stipendUSD: 62000,
    stipendLocal: 'CHF doctoral salary band (snapshot)',
    stipendBasis: 'EPFL doctoral employment',
    stipendConfidence: 'high',
    stipendFoundOfficial: true,
    stipendNotes: 'Confirm IC school open positions and salary grade.',
    cohortSize: 'Lab-driven',
    degreeStructure: 'Doctoral school + lab research',
    applicationRoute: 'Doctoral school + lab acceptance',
    deadlineAndTests: 'Multiple calls / rolling',
    deadlineIso: nextDeadline(12, 15),
    applicationRestrictions: 'English widely used; PI match key',
    researchFocus: 'ML, NLP, systems, security, HCI',
    wetDryIntegration: 'Dry-heavy',
    fitScore: 8.3,
    fitRationale: 'Strong EU AI hub with competitive compensation.',
    siblingPrograms: 'EDIC program',
    sources: ['https://www.epfl.ch/'],
    tags: ['Machine Learning', 'NLP', 'Systems', 'HCI'],
    multiApply: 'multi',
    careerOutcomes: 'Strong EU placement',
    admitBackgrounds: 'MS common',
    intlNotes: 'International doctoral employment standard',
    colIndex: 1.4,
    pis: [
      pi('pi_epfl_1', 'Example Direction-Fit PI (NLP)', 'direction_fit', {
        hIndex: 40, startedApprox: '2013', labSize: '10–14', wetDry: 'dry',
        research: 'NLP, multilingual models',
        whyFit: 'Strong EU NLP option',
        recruiting: 'Check open PhD calls',
      }),
    ],
  },
  {
    id: 'prog_toronto_cs',
    region: 'CA',
    school: 'University of Toronto',
    program: 'PhD in Computer Science',
    city: 'Toronto',
    country: 'Canada',
    website: 'https://web.cs.toronto.edu/graduate/phd',
    stipendUSD: 30000,
    stipendLocal: 'CAD package varies by funding source (snapshot ~C$30–40k)',
    stipendBasis: 'Department minimum funding commitment',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Confirm current minimum funding + teaching duties.',
    cohortSize: 'Medium-large',
    degreeStructure: 'Research PhD',
    applicationRoute: 'Department graduate admissions',
    deadlineAndTests: 'Dec typical',
    deadlineIso: nextDeadline(12, 1),
    applicationRestrictions: 'Competitive in ML',
    researchFocus: 'ML, vision, NLP, systems, theory',
    wetDryIntegration: 'Dry',
    fitScore: 8.0,
    fitRationale: 'Historic ML strength (Vector Institute proximity).',
    siblingPrograms: 'ECE',
    sources: ['https://web.cs.toronto.edu/'],
    tags: ['Machine Learning', 'Computer Vision', 'NLP'],
    multiApply: 'single',
    careerOutcomes: 'Academia + North American industry',
    admitBackgrounds: 'Research MS/BS with strong grades',
    intlNotes: 'Funded packages for admits; verify visa timelines',
    colIndex: 1.2,
    pis: [
      pi('pi_uoft_1', 'Example Famous PI (ML)', 'famous_but_fits', {
        hIndex: 100, startedApprox: '2000', labSize: '25+', wetDry: 'dry',
        research: 'Deep learning, representation learning',
        whyFit: 'Iconic ML environment',
        recruiting: 'Extremely selective',
      }),
      pi('pi_uoft_2', 'Example Rising PI (Vision)', 'rising_star', {
        hIndex: 21, startedApprox: '2022', labSize: '5–8', wetDry: 'dry',
        research: 'Multimodal learning, video understanding',
        whyFit: 'Rising lab with room to grow',
        recruiting: 'Seeking PhD students',
      }),
    ],
  },
  {
    id: 'prog_ubc_cs',
    region: 'CA',
    school: 'University of British Columbia',
    program: 'PhD in Computer Science',
    city: 'Vancouver',
    country: 'Canada',
    website: 'https://www.cs.ubc.ca/students/grad/graduate-programs',
    stipendUSD: 28000,
    stipendLocal: 'CAD minimum funding (snapshot)',
    stipendBasis: 'CS department funding commitment',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Vancouver COL is high relative to stipend — plan carefully.',
    cohortSize: 'Medium',
    degreeStructure: 'Research PhD',
    applicationRoute: 'Department application',
    deadlineAndTests: 'Dec/Jan',
    deadlineIso: nextDeadline(12, 15),
    applicationRestrictions: 'Supervisor interest helps',
    researchFocus: 'ML, graphics, systems, NLP, HCI',
    wetDryIntegration: 'Dry',
    fitScore: 7.4,
    fitRationale: 'Solid research quality; COL vs stipend tradeoff in Vancouver.',
    siblingPrograms: 'ECE',
    sources: ['https://www.cs.ubc.ca/'],
    tags: ['Machine Learning', 'HCI', 'Systems', 'Computer Vision'],
    multiApply: 'single',
    careerOutcomes: 'Canadian academia + tech',
    admitBackgrounds: 'Strong academic + research',
    intlNotes: 'International funding available when admitted',
    colIndex: 1.3,
    pis: [
      pi('pi_ubc_1', 'Example Direction-Fit PI (HCI)', 'direction_fit', {
        hIndex: 35, startedApprox: '2012', labSize: '8–12', wetDry: 'dry',
        research: 'HCI, visualization, human-AI',
        whyFit: 'Good HCI-AI fit',
        recruiting: 'Usually open',
      }),
    ],
  },
  {
    id: 'prog_nus_cs',
    region: 'SG',
    school: 'National University of Singapore',
    program: 'PhD in Computer Science',
    city: 'Singapore',
    country: 'Singapore',
    website: 'https://www.comp.nus.edu.sg/programmes/pg/phdcs/',
    stipendUSD: 28000,
    stipendLocal: 'SGD scholarship stipend band (snapshot)',
    stipendBasis: 'NUS research scholarship norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Scholarship schemes vary; confirm current SoC pages.',
    cohortSize: 'Medium',
    degreeStructure: 'Coursework + research',
    applicationRoute: 'School of Computing graduate admissions',
    deadlineAndTests: 'Multiple intakes',
    deadlineIso: nextDeadline(11, 1),
    applicationRestrictions: 'English program; competitive scholarships',
    researchFocus: 'AI, systems, security, data science',
    wetDryIntegration: 'Dry',
    fitScore: 7.6,
    fitRationale: 'Strong Asia hub with growing AI; tropical city lifestyle.',
    siblingPrograms: 'ISE, DSA',
    sources: ['https://www.comp.nus.edu.sg/'],
    tags: ['Machine Learning', 'Systems', 'Security', 'NLP'],
    multiApply: 'multi',
    careerOutcomes: 'Asia tech + academia',
    admitBackgrounds: 'Strong grades + research potential',
    intlNotes: 'International students common; scholarship competitive',
    colIndex: 1.15,
    pis: [
      pi('pi_nus_1', 'Example Rising PI (NLP)', 'rising_star', {
        hIndex: 23, startedApprox: '2020', labSize: '6–10', wetDry: 'dry',
        research: 'Multilingual NLP, LLMs',
        whyFit: 'Active Asia NLP research',
        recruiting: 'Open for strong students',
        email: 'nus.nlp@example.edu.sg',
      }),
      pi('pi_nus_2', 'Example Direction-Fit PI (Systems)', 'direction_fit', {
        hIndex: 40, startedApprox: '2010', labSize: '12', wetDry: 'dry',
        research: 'Distributed systems, cloud',
        whyFit: 'Systems path in SG',
        recruiting: 'Periodic openings',
      }),
    ],
  },
  {
    id: 'prog_ntu_scse',
    region: 'SG',
    school: 'Nanyang Technological University',
    program: 'PhD in Computer Science and Engineering',
    city: 'Singapore',
    country: 'Singapore',
    website: 'https://www.ntu.edu.sg/scse',
    stipendUSD: 27000,
    stipendLocal: 'SGD RSS/scholarship band (snapshot)',
    stipendBasis: 'NTU research scholarship norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Verify current SCSE graduate funding.',
    cohortSize: 'Medium',
    degreeStructure: 'Research PhD',
    applicationRoute: 'SCSE graduate admissions',
    deadlineAndTests: 'Multiple intakes',
    deadlineIso: nextDeadline(10, 31),
    applicationRestrictions: 'Scholarship tiers differ',
    researchFocus: 'AI, robotics, cybersecurity, data science',
    wetDryIntegration: 'Both',
    fitScore: 7.3,
    fitRationale: 'Competitive SG alternative with robotics strength.',
    siblingPrograms: 'EEE',
    sources: ['https://www.ntu.edu.sg/scse'],
    tags: ['Machine Learning', 'Robotics', 'Security'],
    multiApply: 'multi',
    careerOutcomes: 'Asia research + industry',
    admitBackgrounds: 'Strong STEM background',
    intlNotes: 'International PhD common',
    colIndex: 1.15,
    pis: [
      pi('pi_ntu_1', 'Example Interesting PI (Robotics)', 'interesting', {
        hIndex: 33, startedApprox: '2014', labSize: '10–15', wetDry: 'both',
        research: 'Robotics, embodied AI',
        whyFit: 'Hardware-friendly robotics',
        recruiting: 'Open positions often posted',
      }),
    ],
  },
  {
    id: 'prog_hku_cs',
    region: 'HK',
    school: 'University of Hong Kong',
    program: 'PhD in Computer Science',
    city: 'Hong Kong',
    country: 'Hong Kong',
    website: 'https://www.cs.hku.hk/',
    stipendUSD: 26000,
    stipendLocal: 'HKD PGS/scholarship band (snapshot)',
    stipendBasis: 'HKU postgraduate studentship norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'HK COL is high; confirm latest studentship amount.',
    cohortSize: 'Medium',
    degreeStructure: 'Research PhD 3–4 years',
    applicationRoute: 'Faculty graduate school',
    deadlineAndTests: 'Main round often Dec',
    deadlineIso: nextDeadline(12, 1),
    applicationRestrictions: 'English; competitive',
    researchFocus: 'AI, systems, security, data science',
    wetDryIntegration: 'Dry',
    fitScore: 7.2,
    fitRationale: 'Gateway to Greater Bay Area AI ecosystem.',
    siblingPrograms: 'Engineering tracks',
    sources: ['https://www.cs.hku.hk/'],
    tags: ['Machine Learning', 'Systems', 'Security'],
    multiApply: 'multi',
    careerOutcomes: 'HK/Mainland/global tech',
    admitBackgrounds: 'Strong academic record',
    intlNotes: 'International students welcome; scholarship important',
    colIndex: 1.35,
    pis: [
      pi('pi_hku_1', 'Example Direction-Fit PI (ML)', 'direction_fit', {
        hIndex: 36, startedApprox: '2013', labSize: '8–12', wetDry: 'dry',
        research: 'Machine learning, data mining',
        whyFit: 'Solid HK ML option',
        recruiting: 'Usually takes students',
      }),
    ],
  },
  {
    id: 'prog_tsinghua_cs',
    region: 'CN',
    school: 'Tsinghua University',
    program: 'PhD in Computer Science',
    city: 'Beijing',
    country: 'China',
    website: 'https://www.cs.tsinghua.edu.cn/',
    stipendUSD: 12000,
    stipendLocal: 'RMB stipend + possible top-ups (highly variable)',
    stipendBasis: 'Typical domestic PhD funding + lab top-up culture (snapshot)',
    stipendConfidence: 'low',
    stipendFoundOfficial: false,
    stipendNotes: 'Packages vary widely by lab and scholarship; verify with target PI.',
    cohortSize: 'Large',
    degreeStructure: 'Research PhD; language requirements vary by track',
    applicationRoute: 'International students office / department tracks',
    deadlineAndTests: 'Varies by CSC / school round',
    deadlineIso: nextDeadline(3, 1),
    applicationRestrictions: 'Language and admission track dependent',
    researchFocus: 'AI, systems, graphics, theory, security',
    wetDryIntegration: 'Dry-heavy',
    fitScore: 7.5,
    fitRationale: 'Top mainland CS strength; funding and language need careful planning.',
    siblingPrograms: 'IIIS, related institutes',
    sources: ['https://www.cs.tsinghua.edu.cn/'],
    tags: ['Machine Learning', 'Systems', 'Computer Vision', 'Security'],
    multiApply: 'multi',
    careerOutcomes: 'Mainland academia + tech giants',
    admitBackgrounds: 'Strong grades; publications help',
    intlNotes: 'CSC and university scholarships; Chinese/English tracks differ',
    colIndex: 0.85,
    pis: [
      pi('pi_th_1', 'Example Famous PI (AI)', 'famous_but_fits', {
        hIndex: 60, startedApprox: '2008', labSize: '20+', wetDry: 'dry',
        research: 'AI, multimodal learning',
        whyFit: 'Top mainland AI environment',
        recruiting: 'Competitive lab admissions',
      }),
      pi('pi_th_2', 'Example Rising PI (Systems)', 'rising_star', {
        hIndex: 18, startedApprox: '2021', labSize: '6–9', wetDry: 'dry',
        research: 'ML systems, cloud',
        whyFit: 'Rising systems lab',
        recruiting: 'Seeking students',
      }),
    ],
  },
  {
    id: 'prog_pku_cs',
    region: 'CN',
    school: 'Peking University',
    program: 'PhD in Computer Science',
    city: 'Beijing',
    country: 'China',
    website: 'https://cs.pku.edu.cn/',
    stipendUSD: 11000,
    stipendLocal: 'RMB stipend + lab top-up (variable)',
    stipendBasis: 'Typical domestic snapshot — verify per lab',
    stipendConfidence: 'low',
    stipendFoundOfficial: false,
    stipendNotes: 'Do not treat as guaranteed; ask PI about package.',
    cohortSize: 'Large',
    degreeStructure: 'Research PhD',
    applicationRoute: 'International / domestic tracks differ',
    deadlineAndTests: 'Spring cycles common for internationals',
    deadlineIso: nextDeadline(3, 15),
    applicationRestrictions: 'Track-dependent language requirements',
    researchFocus: 'AI, theory, systems, security',
    wetDryIntegration: 'Dry',
    fitScore: 7.4,
    fitRationale: 'Peer to Tsinghua in many CS areas.',
    siblingPrograms: 'CFCS',
    sources: ['https://cs.pku.edu.cn/'],
    tags: ['Machine Learning', 'Systems', 'Security', 'NLP'],
    multiApply: 'multi',
    careerOutcomes: 'Mainland research + industry',
    admitBackgrounds: 'Strong academic profile',
    intlNotes: 'Scholarship planning essential',
    colIndex: 0.85,
    pis: [
      pi('pi_pku_1', 'Example Direction-Fit PI (NLP)', 'direction_fit', {
        hIndex: 34, startedApprox: '2014', labSize: '10', wetDry: 'dry',
        research: 'NLP, knowledge graphs',
        whyFit: 'Strong Chinese NLP group',
        recruiting: 'Open most years',
      }),
    ],
  },
  {
    id: 'prog_anu_cs',
    region: 'AU',
    school: 'Australian National University',
    program: 'PhD in Computer Science',
    city: 'Canberra',
    country: 'Australia',
    website: 'https://cs.anu.edu.au/study/graduate-research',
    stipendUSD: 24000,
    stipendLocal: 'RTP stipend band AUD (snapshot)',
    stipendBasis: 'Australian RTP scholarship norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'RTP is competitive; confirm current AUD rate.',
    cohortSize: 'Medium',
    degreeStructure: '3–4 year research PhD',
    applicationRoute: 'HDR application + supervisor',
    deadlineAndTests: 'Scholarship rounds (often Aug/Oct and more)',
    deadlineIso: nextDeadline(8, 31),
    applicationRestrictions: 'Supervisor agreement important',
    researchFocus: 'AI, vision, systems, theory',
    wetDryIntegration: 'Dry',
    fitScore: 7.0,
    fitRationale: 'Strong AU research university; lifestyle/city quieter than Sydney.',
    siblingPrograms: 'CECS',
    sources: ['https://cs.anu.edu.au/'],
    tags: ['Machine Learning', 'Computer Vision', 'Systems'],
    multiApply: 'multi',
    careerOutcomes: 'AU academia + Asia-Pacific industry',
    admitBackgrounds: 'Honours/MS research background',
    intlNotes: 'International RTP competitive; tuition scholarships separate',
    colIndex: 1.1,
    pis: [
      pi('pi_anu_1', 'Example Interesting PI (Vision)', 'interesting', {
        hIndex: 30, startedApprox: '2015', labSize: '8', wetDry: 'dry',
        research: 'Computer vision, robotics perception',
        whyFit: 'Good AU vision option',
        recruiting: 'Scholarship-dependent',
      }),
    ],
  },
  {
    id: 'prog_unimelb_cis',
    region: 'AU',
    school: 'University of Melbourne',
    program: 'PhD in Computing and Information Systems',
    city: 'Melbourne',
    country: 'Australia',
    website: 'https://cis.unimelb.edu.au/study/graduate-research',
    stipendUSD: 24500,
    stipendLocal: 'RTP stipend band AUD (snapshot)',
    stipendBasis: 'Australian RTP norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Melbourne COL higher; verify stipend annually.',
    cohortSize: 'Medium',
    degreeStructure: 'Research PhD',
    applicationRoute: 'Faculty graduate research',
    deadlineAndTests: 'Scholarship rounds',
    deadlineIso: nextDeadline(10, 31),
    applicationRestrictions: 'Supervisor match recommended',
    researchFocus: 'AI, HCI, security, data science',
    wetDryIntegration: 'Dry',
    fitScore: 7.1,
    fitRationale: 'Strong CIS faculty; vibrant city.',
    siblingPrograms: 'Related engineering HDR',
    sources: ['https://cis.unimelb.edu.au/'],
    tags: ['Machine Learning', 'HCI', 'Security', 'NLP'],
    multiApply: 'multi',
    careerOutcomes: 'AU + global tech',
    admitBackgrounds: 'Research preparation required',
    intlNotes: 'International scholarships competitive',
    colIndex: 1.18,
    pis: [
      pi('pi_melb_1', 'Example Rising PI (HCI)', 'rising_star', {
        hIndex: 17, startedApprox: '2021', labSize: '5–7', wetDry: 'dry',
        research: 'Human-AI interaction',
        whyFit: 'Rising HCI lab',
        recruiting: 'Seeking HDR students',
      }),
    ],
  },
  {
    id: 'prog_mpi_is',
    region: 'EU',
    school: 'Max Planck Institute / ELLIS partners',
    program: 'PhD (IMPRS / partner university enrollment)',
    city: 'Tübingen / multiple',
    country: 'Germany',
    website: 'https://is.mpg.de/',
    stipendUSD: 42000,
    stipendLocal: 'TVöD / contract salary band (snapshot)',
    stipendBasis: 'German research institute contracts',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Enrollment is often via partner university; process differs from US apps.',
    cohortSize: 'Lab/cohort programs',
    degreeStructure: 'Research PhD with institute affiliation',
    applicationRoute: 'Open calls / IMPRS applications',
    deadlineAndTests: 'Call-based',
    deadlineIso: nextDeadline(11, 30),
    applicationRestrictions: 'Position-based hiring culture',
    researchFocus: 'ML, intelligent systems, robotics, computational neuroscience',
    wetDryIntegration: 'Both',
    fitScore: 8.1,
    fitRationale: 'Elite EU ML research without US-style app portal norms.',
    siblingPrograms: 'ELLIS PhD programs',
    sources: ['https://is.mpg.de/'],
    tags: ['Machine Learning', 'Robotics', 'Computational Biology'],
    multiApply: 'multi',
    careerOutcomes: 'EU academia excellence track',
    admitBackgrounds: 'Strong research MS preferred',
    intlNotes: 'English-friendly labs common; visa via employer',
    colIndex: 1.05,
    pis: [
      pi('pi_mpi_1', 'Example Famous PI (ML)', 'famous_but_fits', {
        hIndex: 75, startedApprox: '2007', labSize: '20+', wetDry: 'dry',
        research: 'Probabilistic ML, causality',
        whyFit: 'World-class ML theory/application',
        recruiting: 'Call-based',
      }),
      pi('pi_mpi_2', 'Example Rising PI (Robotics)', 'rising_star', {
        hIndex: 20, startedApprox: '2021', labSize: '6–9', wetDry: 'both',
        research: 'Learning for robotics',
        whyFit: 'Rising EU robotics group',
        recruiting: 'Open positions posted',
      }),
    ],
  },
  {
    id: 'prog_gatech_cs',
    region: 'US',
    school: 'Georgia Tech',
    program: 'PhD in Computer Science',
    city: 'Atlanta, GA',
    country: 'United States',
    website: 'https://www.cc.gatech.edu/degree-programs/phd-computer-science',
    stipendUSD: 36000,
    stipendLocal: '~$34–38k USD (snapshot)',
    stipendBasis: 'College of Computing funding norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Atlanta COL relatively moderate for a major US city.',
    cohortSize: 'Large',
    degreeStructure: 'Research PhD',
    applicationRoute: 'College of Computing',
    deadlineAndTests: 'Dec typical',
    deadlineIso: nextDeadline(12, 15),
    applicationRestrictions: 'Standard US PhD process',
    researchFocus: 'ML, systems, HCI, security, robotics',
    wetDryIntegration: 'Both',
    fitScore: 7.8,
    fitRationale: 'Strong breadth and better COL-adjusted stipend than coastal peers.',
    siblingPrograms: 'ECE, ML certificate pathways',
    sources: ['https://www.cc.gatech.edu/'],
    tags: ['Machine Learning', 'Systems', 'HCI', 'Security', 'Robotics'],
    multiApply: 'single',
    careerOutcomes: 'Strong industry + academia',
    admitBackgrounds: 'Research experience valued',
    intlNotes: 'Funded international admits standard',
    colIndex: 1.0,
    pis: [
      pi('pi_gt_1', 'Example Direction-Fit PI (Systems)', 'direction_fit', {
        hIndex: 44, startedApprox: '2011', labSize: '12–16', wetDry: 'dry',
        research: 'Systems, networking, ML infra',
        whyFit: 'Solid systems+AI infra path',
        recruiting: 'Regular PhD intake',
      }),
      pi('pi_gt_2', 'Example Rising PI (HCI)', 'rising_star', {
        hIndex: 16, startedApprox: '2022', labSize: '5–8', wetDry: 'dry',
        research: 'Human-centered AI, learning technologies',
        whyFit: 'Rising HCI-AI lab',
        recruiting: 'Building group',
        email: 'hci.ai@example.edu',
      }),
    ],
  },
  {
    id: 'prog_uiuc_cs',
    region: 'US',
    school: 'University of Illinois Urbana-Champaign',
    program: 'PhD in Computer Science',
    city: 'Urbana-Champaign, IL',
    country: 'United States',
    website: 'https://cs.illinois.edu/academics/graduate/phd-program',
    stipendUSD: 35000,
    stipendLocal: '~$33–37k USD (snapshot)',
    stipendBasis: 'CS graduate appointment norms',
    stipendConfidence: 'medium',
    stipendFoundOfficial: true,
    stipendNotes: 'Low COL city improves real stipend substantially.',
    cohortSize: 'Large',
    degreeStructure: 'Research PhD',
    applicationRoute: 'CS graduate admissions',
    deadlineAndTests: 'Dec typical',
    deadlineIso: nextDeadline(12, 15),
    applicationRestrictions: 'Competitive but broad faculty',
    researchFocus: 'Systems, ML, theory, HCI, security',
    wetDryIntegration: 'Dry',
    fitScore: 8.0,
    fitRationale: 'Elite systems + strong ML; excellent COL-adjusted living.',
    siblingPrograms: 'ECE',
    sources: ['https://cs.illinois.edu/'],
    tags: ['Systems', 'Machine Learning', 'HCI', 'Security'],
    multiApply: 'single',
    careerOutcomes: 'Top placement historically',
    admitBackgrounds: 'Strong CS foundation',
    intlNotes: 'Large international cohort historically',
    colIndex: 0.9,
    pis: [
      pi('pi_uiuc_1', 'Example Famous PI (Systems)', 'famous_but_fits', {
        hIndex: 68, startedApprox: '2004', labSize: '15–20', wetDry: 'dry',
        research: 'Distributed systems, storage',
        whyFit: 'Classic systems excellence',
        recruiting: 'Selective',
      }),
      pi('pi_uiuc_2', 'Example Rising PI (ML)', 'rising_star', {
        hIndex: 19, startedApprox: '2021', labSize: '6–9', wetDry: 'dry',
        research: 'Efficient ML, foundation models',
        whyFit: 'Rising ML systems group',
        recruiting: 'Actively recruiting',
      }),
    ],
  },
]

const BUILTIN_FIXTURE_PROGRAM_IDS = new Set(DISCOVER_PROGRAMS.map((program) => program.id))
const BUILTIN_FIXTURE_PI_IDS = new Set(DISCOVER_PROGRAMS.flatMap((program) => (
  (program.pis || []).map((advisor) => advisor.id)
)))

/**
 * The bundled catalogue is a UI/test fixture, never user decision evidence.
 * Match stable fixture identities and explicit legacy markers rather than
 * names such as "Example University", which a user could legitimately type.
 */
export function isBuiltInDiscoverFixtureProgram(raw) {
  if (!raw || typeof raw !== 'object') return false
  if (raw.provenance === 'official_catalog' || raw.catalogSource === 'builtin') return true
  if (BUILTIN_FIXTURE_PROGRAM_IDS.has(String(raw.id || ''))) return true
  return (Array.isArray(raw.pis) ? raw.pis : []).some((advisor) => (
    BUILTIN_FIXTURE_PI_IDS.has(String(advisor?.id || ''))
  ))
}

/**
 * Collapse only strong programme identities. This is intentionally separate
 * from storage normalization so an explicit user-authored row is never
 * deleted merely because a verified research row supersedes it in the ranked
 * decision view.
 */
export function dedupeDiscoverDecisionPrograms(programs) {
  return dedupeDiscoverProgrammeRecords(programs)
}

export function getDiscoverCatalogMeta() {
  return {
    title: 'PhD Program Discover',
    subtitle: 'Find programs, advisors, and fit — research snapshots you can rank and import',
    currency: 'USD',
    stipendFloorDefault: 35000,
    currentYear: CURRENT_YEAR,
    regions: DISCOVER_REGIONS,
    interestAreas: INTEREST_AREAS,
    honestyNote:
      'Stipends, deadlines, and h-index figures are research snapshots and may be outdated. Always verify on official program pages before applying.',
    updatedAt: `${CURRENT_YEAR}-07-01`,
  }
}

export function getDiscoverCatalog() {
  return {
    meta: getDiscoverCatalogMeta(),
    programs: attachRequirementsToPrograms(
      DISCOVER_PROGRAMS.map((program) => ({
        ...program,
        pis: program.pis.map((item) => ({ ...item })),
      })),
    ),
  }
}

export function findProgramById(programId, state = null) {
  const programs = state ? getActivePrograms(state) : DISCOVER_PROGRAMS
  return programs.find((program) => program.id === programId) || null
}

export function findPiById(programId, piId, state = null) {
  const program = findProgramById(programId, state)
  if (!program) return null
  return (program.pis || []).find((item) => item.id === piId) || null
}

function slugId(value, prefix = 'prog') {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return `${prefix}_${base || 'item'}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizePi(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim().slice(0, 120)
  if (!name) return null
  const category = ['rising_star', 'direction_fit', 'interesting', 'famous_but_fits'].includes(raw.category)
    ? raw.category
    : 'direction_fit'
  return {
    id: String(raw.id || slugId(name, 'pi')).slice(0, 80),
    name,
    category,
    hIndex: raw.hIndex == null || raw.hIndex === '' ? null : Number(raw.hIndex),
    citations: raw.citations == null || raw.citations === '' ? null : Number(raw.citations),
    scholarUrl: String(raw.scholarUrl || `https://scholar.google.com/scholar?q=${encodeURIComponent(name)}`).slice(0, 500),
    startedApprox: String(raw.startedApprox || '').slice(0, 40),
    labSize: String(raw.labSize || '—').slice(0, 40),
    wetDry: ['dry', 'wet', 'both', 'unknown'].includes(raw.wetDry) ? raw.wetDry : 'unknown',
    research: String(raw.research || '').slice(0, 2000),
    whyFit: String(raw.whyFit || '').slice(0, 2000),
    recruiting: String(raw.recruiting || 'Check lab page').slice(0, 200),
    url: String(raw.url || '').slice(0, 500),
    email: String(raw.email || '').slice(0, 160),
    rank: Number.isFinite(Number(raw.rank)) ? Number(raw.rank) : index + 1,
  }
}

/** Normalize a user-supplied / AI program row into the catalog schema. */
export function normalizeCustomProgram(raw, { source = 'custom' } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const school = String(raw.school || raw.university || '').trim().slice(0, 160)
  const program = String(raw.program || raw.programName || '').trim().slice(0, 200)
  if (!school || !program) return null
  const id = String(raw.id || slugId(`${school}_${program}`, 'prog')).slice(0, 80)
  const region = String(raw.region || 'OTHER').trim().slice(0, 16) || 'OTHER'
  const pis = Array.isArray(raw.pis)
    ? raw.pis.map((item, index) => normalizePi(item, index)).filter(Boolean).slice(0, 20)
    : []
  const stipendUSD = raw.stipendUSD == null || raw.stipendUSD === ''
    ? null
    : Number(raw.stipendUSD)
  const inferredProvenance = source === 'ai'
    || raw.catalogSource === 'ai'
    || /^suggested_/i.test(id)
    || /AI[- ](?:suggested|research|catalog)/i.test(`${raw.stipendBasis || ''} ${raw.stipendNotes || ''}`)
    ? 'ai'
    : 'manual'
  const provenance = ['manual', 'ai', 'official_catalog'].includes(raw.provenance)
    ? raw.provenance
    : inferredProvenance
  const rawVerification = raw.verification && typeof raw.verification === 'object' ? raw.verification : {}
  const verification = {
    status: ['verified', 'partial', 'unverified'].includes(rawVerification.status)
      ? rawVerification.status
      : 'unverified',
    checkedAt: typeof rawVerification.checkedAt === 'string' ? rawVerification.checkedAt.slice(0, 40) : null,
    officialSourceCount: clamp(rawVerification.officialSourceCount, 0, 20, 0),
    advisorSourceCount: clamp(rawVerification.advisorSourceCount, 0, 20, 0),
    issues: Array.isArray(rawVerification.issues)
      ? rawVerification.issues.map((item) => String(item || '').slice(0, 240)).filter(Boolean).slice(0, 12)
      : [],
  }
  return {
    id,
    region,
    school,
    program,
    city: String(raw.city || '').slice(0, 120),
    country: String(raw.country || '').slice(0, 80),
    website: String(raw.website || '').slice(0, 500),
    stipendUSD: Number.isFinite(stipendUSD) ? stipendUSD : null,
    stipendLocal: String(raw.stipendLocal || (stipendUSD != null ? `~$${stipendUSD}` : 'Unknown')).slice(0, 200),
    stipendBasis: String(raw.stipendBasis || 'User/AI catalog entry — verify officially').slice(0, 400),
    stipendConfidence: ['high', 'medium', 'low', 'unknown'].includes(raw.stipendConfidence)
      ? raw.stipendConfidence
      : 'unknown',
    stipendFoundOfficial: Boolean(raw.stipendFoundOfficial),
    stipendNotes: String(raw.stipendNotes || 'Unverified catalog snapshot.').slice(0, 1000),
    cohortSize: String(raw.cohortSize || '—').slice(0, 120),
    degreeStructure: String(raw.degreeStructure || '—').slice(0, 200),
    applicationRoute: String(raw.applicationRoute || '—').slice(0, 300),
    deadlineAndTests: String(raw.deadlineAndTests || '—').slice(0, 400),
    deadlineIso: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.deadlineIso || ''))
      ? String(raw.deadlineIso)
      : '',
    applicationRestrictions: String(raw.applicationRestrictions || '').slice(0, 500),
    researchFocus: String(raw.researchFocus || '').slice(0, 2000),
    wetDryIntegration: String(raw.wetDryIntegration || 'unknown').slice(0, 80),
    fitScore: Math.max(0, Math.min(10, Number(raw.fitScore) || 6)),
    fitRationale: String(raw.fitRationale || '').slice(0, 2000),
    siblingPrograms: String(raw.siblingPrograms || '').slice(0, 300),
    sources: Array.isArray(raw.sources)
      ? raw.sources.map((item) => String(item).slice(0, 500)).filter(Boolean).slice(0, 20)
      : [],
    collectedAt: typeof raw.collectedAt === 'string' ? raw.collectedAt.slice(0, 40) : null,
    tuitionLocal: String(raw.tuitionLocal || '').slice(0, 240),
    tuitionNotes: String(raw.tuitionNotes || '').slice(0, 1200),
    rankingYear: Number.isInteger(Number(raw.rankingYear)) ? Number(raw.rankingYear) : null,
    qsWorldRank: Number.isInteger(Number(raw.qsWorldRank)) ? Number(raw.qsWorldRank) : null,
    qsSubjectRank: Number.isInteger(Number(raw.qsSubjectRank)) ? Number(raw.qsSubjectRank) : null,
    qsSubjectName: String(raw.qsSubjectName || '').slice(0, 160),
    theWorldRank: Number.isInteger(Number(raw.theWorldRank)) ? Number(raw.theWorldRank) : null,
    theSubjectRank: Number.isInteger(Number(raw.theSubjectRank)) ? Number(raw.theSubjectRank) : null,
    theSubjectName: String(raw.theSubjectName || '').slice(0, 160),
    rankingSources: Array.isArray(raw.rankingSources)
      ? raw.rankingSources.map((item) => String(item).slice(0, 500)).filter((item) => /^https:\/\//i.test(item)).slice(0, 8)
      : [],
    factSources: Object.fromEntries([
      'deadline', 'funding', 'tuition', 'restrictions', 'international',
      'outcomes', 'admissionsBackgrounds', 'degreeStructure', 'applicationRoute',
    ].map((key) => {
      const value = String(raw.factSources?.[key] || '').slice(0, 500)
      return [key, /^https:\/\//i.test(value) ? value : '']
    })),
    scholarships: Array.isArray(raw.scholarships)
      ? raw.scholarships.map((item) => ({
          name: String(item?.name || '').slice(0, 240),
          provider: String(item?.provider || '').slice(0, 240),
          amount: String(item?.amount || '').slice(0, 200),
          eligibility: String(item?.eligibility || '').slice(0, 1200),
          deadline: String(item?.deadline || '').slice(0, 120),
          url: String(item?.url || '').slice(0, 500),
          profileFit: String(item?.profileFit || '').slice(0, 1200),
          verifiedAt: typeof item?.verifiedAt === 'string' ? item.verifiedAt.slice(0, 40) : null,
        })).filter((item) => item.name && /^https:\/\//i.test(item.url)).slice(0, 12)
      : [],
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((item) => String(item).slice(0, 60)).filter(Boolean).slice(0, 20)
      : [],
    multiApply: ['multi', 'single', 'unknown'].includes(raw.multiApply) ? raw.multiApply : 'unknown',
    careerOutcomes: String(raw.careerOutcomes || '').slice(0, 1000),
    admitBackgrounds: String(raw.admitBackgrounds || '').slice(0, 1000),
    intlNotes: String(raw.intlNotes || '').slice(0, 1000),
    colIndex: Math.max(0.4, Math.min(2.5, Number(raw.colIndex) || 1)),
    pis,
    catalogSource: source,
    provenance,
    verification,
    requirements: normalizeRequirements(raw.requirements, {
      id,
      provenance,
      factSources: raw.factSources,
      multiApply: ['multi', 'single', 'unknown'].includes(raw.multiApply) ? raw.multiApply : 'unknown',
      deadlineIso: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.deadlineIso || ''))
        ? String(raw.deadlineIso)
        : '',
      deadlineAndTests: String(raw.deadlineAndTests || ''),
      applicationRestrictions: String(raw.applicationRestrictions || ''),
      applicationRoute: String(raw.applicationRoute || ''),
      degreeStructure: String(raw.degreeStructure || ''),
    }),
  }
}

export function normalizeCustomPrograms(list, { source = 'custom', max = 160 } = {}) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const item of list) {
    if (isBuiltInDiscoverFixtureProgram(item)) continue
    const program = normalizeCustomProgram(item, { source })
    if (!program || seen.has(program.id)) continue
    seen.add(program.id)
    out.push(program)
    if (out.length >= max) break
  }
  return out
}

export function normalizeAiEnrichments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!key || !entry || typeof entry !== 'object') continue
    out[String(key).slice(0, 80)] = {
      fitRationale: String(entry.fitRationale || '').slice(0, 2000),
      researchFocus: String(entry.researchFocus || '').slice(0, 2000),
      strategy: String(entry.strategy || entry.tips || '').slice(0, 2000),
      tips: String(entry.tips || '').slice(0, 2000),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    }
    if (Object.keys(out).length >= 200) break
  }
  return out
}

/** Merge built-in + custom programs, apply AI enrichment overlays. */
export function getActivePrograms(state = defaultDiscoverState()) {
  const source = ['builtin', 'custom', 'merged'].includes(state.catalogSource)
    ? state.catalogSource
    : 'merged'
  const custom = normalizeCustomPrograms(state.customPrograms, { source: 'custom', max: MAX_DISCOVER_PERSISTED_PROGRAMS })
  let programs = []
  if (source === 'custom') {
    programs = custom
  } else if (source === 'builtin') {
    programs = DISCOVER_PROGRAMS.map((item) => ({ ...item, catalogSource: 'builtin' }))
  } else {
    const map = new Map()
    for (const item of DISCOVER_PROGRAMS) map.set(item.id, { ...item, catalogSource: 'builtin' })
    for (const item of custom) map.set(item.id, { ...item, catalogSource: item.catalogSource || 'custom' })
    programs = Array.from(map.values())
  }

  // Once a live official-source run has completed, the research result is a
  // decision set. Do not let legacy demo rows, imported placeholders, or old
  // unsourced AI suggestions look like part of that result. They remain stored
  // (and can be revisited from data management), but are never ranked or shown
  // as a verified Discover recommendation.
  if (state.officialResearchOnly) {
    programs = programs.filter((program) => (
      program.provenance === 'ai'
      && !isBuiltInDiscoverFixtureProgram(program)
      && !isGenericProgramLabel(program.program)
      && program.sources?.some((sourceUrl) => /^https:\/\//i.test(sourceUrl))
      && ['verified', 'partial'].includes(program.verification?.status)
      && Number(program.verification?.officialSourceCount || 0) > 0
    ))
  }

  programs = dedupeDiscoverDecisionPrograms(programs)

  const enrichments = normalizeAiEnrichments(state.aiEnrichments)
  return attachRequirementsToPrograms(programs).map((program) => {
    const enrichment = enrichments[program.id]
    if (!enrichment) return { ...program, pis: (program.pis || []).map((pi) => ({ ...pi })) }
    return {
      ...program,
      fitRationale: enrichment.fitRationale || program.fitRationale,
      researchFocus: enrichment.researchFocus || program.researchFocus,
      aiStrategy: enrichment.strategy || '',
      aiTips: enrichment.tips || '',
      aiEnrichedAt: enrichment.updatedAt,
      pis: (program.pis || []).map((pi) => ({ ...pi })),
    }
  })
}

export function exportCatalogPayload(state) {
  const programs = getActivePrograms(state)
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    catalogSource: state.catalogSource || 'merged',
    meta: getDiscoverCatalogMeta(),
    programs,
    customPrograms: normalizeCustomPrograms(state.customPrograms),
    aiEnrichments: normalizeAiEnrichments(state.aiEnrichments),
  }
}

/**
 * Parse upload body: either `{ programs: [...] }`, `_research_data` style map,
 * or a bare program array. Returns normalized custom program list.
 */
export function parseCatalogUpload(body) {
  if (!body) return []
  if (Array.isArray(body)) return normalizeCustomPrograms(body)
  if (Array.isArray(body.programs)) return normalizeCustomPrograms(body.programs)
  if (Array.isArray(body.customPrograms)) return normalizeCustomPrograms(body.customPrograms)
  // phd-application-planner `_research_data.json` shape: { School: [ { program, facts, pis, out } ] }
  if (body && typeof body === 'object' && !body.programs) {
    const rows = []
    for (const [school, entries] of Object.entries(body)) {
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        const facts = entry.facts || entry
        const pis = entry.pis?.pis || entry.pis || []
        rows.push({
          school,
          program: entry.program || facts.program,
          region: entry.region || facts.region || 'OTHER',
          city: facts.city,
          country: facts.country,
          website: facts.website || facts.url,
          stipendUSD: facts.stipendUSD ?? facts.usd,
          stipendLocal: facts.stipendLocal,
          stipendBasis: facts.stipend_basis || facts.stipendBasis,
          stipendConfidence: facts.stipend_confidence || facts.stipendConfidence,
          stipendFoundOfficial: facts.stipend_foundOfficial ?? facts.stipendFoundOfficial,
          stipendNotes: facts.stipendNotes,
          cohortSize: facts.cohortSize,
          degreeStructure: facts.degreeStructure,
          applicationRoute: facts.applicationRoute,
          deadlineAndTests: facts.deadlineAndTests,
          deadlineIso: facts.deadlineIso,
          applicationRestrictions: facts.applicationRestrictions,
          researchFocus: facts.researchFocus,
          wetDryIntegration: facts.wetDryIntegration,
          fitScore: facts.fitScore ?? facts.fit,
          fitRationale: facts.fitRationale,
          siblingPrograms: facts.siblingPrograms,
          sources: facts.sources,
          tags: facts.tags || entry.tags,
          multiApply: facts.multi || facts.multiApply,
          careerOutcomes: entry.out?.careerOutcomes,
          admitBackgrounds: entry.out?.admitBackgrounds,
          intlNotes: entry.out?.intlNotes,
          colIndex: facts.colIndex,
          pis: Array.isArray(pis) ? pis : [],
        })
      }
    }
    if (rows.length) return normalizeCustomPrograms(rows)
  }
  return []
}

const DEFAULT_INTAKE = {
  field: '',
  subfields: [],
  regions: ['US', 'UK', 'EU', 'CA', 'SG', 'HK', 'CN', 'AU', 'OTHER'],
  stipendFloor: 35000,
  currency: 'USD',
  nPrograms: 20,
  nPisPerProgram: 6,
  piPreferences: ['rising_star', 'direction_fit'],
  risingStarBias: 'moderate',
  notes: '',
  interestTags: [],
  notifyMatches: true,
  notifyDeadlines: true,
  seedPrograms: [],
}

const DEFAULT_RANKER = {
  fit: 30,
  stipend: 20,
  city: 15,
  advisorDensity: 20,
  topics: 15,
}

export function defaultDiscoverState() {
  return {
    version: 1,
    intake: {
      ...DEFAULT_INTAKE,
      subfields: [],
      regions: [...DEFAULT_INTAKE.regions],
      piPreferences: [...DEFAULT_INTAKE.piPreferences],
      interestTags: [],
      seedPrograms: [],
    },
    intakeCompleted: false,
    deletedProgramIds: [],
    hiddenProgramIds: [],
    hiddenPiIds: [],
    watchedProgramIds: [],
    piNotes: {},
    programNotes: {},
    ranker: { ...DEFAULT_RANKER },
    interestPicks: [],
    lastResearchAt: null,
    lastMatchIds: [],
    researchRuns: 0,
    /** Built-in rows are UI fixtures only; users start from verified research. */
    catalogSource: 'custom',
    officialResearchOnly: true,
    /** User-uploaded / AI-suggested programs (stable ids). */
    customPrograms: [],
    /** AI enrichment overlays keyed by program id. */
    aiEnrichments: {},
    lastAiResearchAt: null,
    preferredAiKeyId: null,
    preferredAiKeyIds: [],
    researchJob: null,
  }
}

function asStringArray(value, max = 40) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, max)
}

function clamp(n, min, max, fallback) {
  const value = Number(n)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeResearchJob(value) {
  if (!value || typeof value !== 'object') return null
  const status = ['queued', 'running', 'completed', 'failed'].includes(value.status) ? value.status : null
  const id = String(value.id || '').trim().slice(0, 100)
  const queuedAt = typeof value.queuedAt === 'string' ? value.queuedAt.slice(0, 40) : ''
  if (!status || !id || !queuedAt) return null
  return {
    id,
    status,
    queuedAt,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt.slice(0, 40) : null,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt.slice(0, 40) : null,
    message: typeof value.message === 'string' ? value.message.slice(0, 600) : null,
    errorCode: typeof value.errorCode === 'string' ? value.errorCode.slice(0, 80) : null,
    sourceCount: clamp(value.sourceCount, 0, 500, 0),
    keyIds: asStringArray(value.keyIds, 12),
    teamId: typeof value.teamId === 'string' ? value.teamId.slice(0, 128) : null,
    targetUserId: typeof value.targetUserId === 'string' ? value.targetUserId.slice(0, 128) : null,
    requestedByUserId: typeof value.requestedByUserId === 'string' ? value.requestedByUserId.slice(0, 128) : null,
    request: value.request && typeof value.request === 'object' ? {
      useAi: value.request.useAi !== false,
      acceptSuggestions: value.request.acceptSuggestions !== false,
      notify: value.request.notify !== false,
      keyIds: asStringArray(value.request.keyIds, 12),
    } : null,
  }
}

const DISCOVER_SOURCE_PAGE_TYPES = new Set(['advisor', 'program', 'admissions', 'funding', 'research', 'homepage'])
const DISCOVER_SOURCE_PAGE_LIMIT = 180
const DISCOVER_SOURCE_EVIDENCE_TYPES = new Set(['program', 'admissions', 'funding', 'research'])
const DISCOVER_SOURCE_EVIDENCE_DECLARATIONS = new Set([
  'advisor',
  'advisors',
  'admission',
  'admissions',
  'department',
  'departments',
  'doctoral',
  'doctorate',
  'dphil',
  'faculty',
  'funding',
  'lab',
  'labs',
  'laboratory',
  'phd',
  'program',
  'programme',
  'programs',
  'programmes',
  'research',
])

function normalizeDiscoverSourceUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString().slice(0, 500)
  } catch {
    return null
  }
}

function normalizeDiscoverSourcePage(value) {
  if (!value || typeof value !== 'object') return null
  const url = normalizeDiscoverSourceUrl(value.url)
  if (!url) return null
  return {
    url,
    title: typeof value.title === 'string' ? value.title.slice(0, 240) : null,
    label: typeof value.label === 'string' ? value.label.slice(0, 240) : null,
    types: asStringArray(value.types, 8).filter((type) => DISCOVER_SOURCE_PAGE_TYPES.has(type)),
    discoveredFrom: asStringArray(value.discoveredFrom, 12)
      .map(normalizeDiscoverSourceUrl)
      .filter(Boolean),
    fetched: Boolean(value.fetched),
    individualAdvisor: Boolean(value.individualAdvisor),
    declaredKinds: asStringArray(value.declaredKinds, 8),
    promptInjectionSuspected: Boolean(value.promptInjectionSuspected),
  }
}

function mergeDiscoverSourcePage(left, right) {
  const mergeStrings = (leftValues, rightValues, max) => (
    [...new Set([...(leftValues || []), ...(rightValues || [])])].slice(0, max)
  )
  return {
    ...left,
    title: left.title || right.title,
    label: left.label || right.label,
    types: mergeStrings(left.types, right.types, 8),
    discoveredFrom: mergeStrings(left.discoveredFrom, right.discoveredFrom, 12),
    fetched: left.fetched || right.fetched,
    individualAdvisor: left.individualAdvisor || right.individualAdvisor,
    declaredKinds: mergeStrings(left.declaredKinds, right.declaredKinds, 8),
    // Contamination is fail-closed across duplicate observations of a URL.
    promptInjectionSuspected: left.promptInjectionSuspected || right.promptInjectionSuspected,
  }
}

function discoverSourcePageRetentionTier(page) {
  if (!page.fetched) return 0
  // Keep contaminated fetched pages ahead of unfetched candidates for audit,
  // but never let their claimed types/declarations earn evidence priority.
  if (page.promptInjectionSuspected) return 1
  const declaredEvidence = page.declaredKinds.some((kind) => (
    DISCOVER_SOURCE_EVIDENCE_DECLARATIONS.has(String(kind || '').trim().toLowerCase())
  ))
  if (page.individualAdvisor || declaredEvidence) return 4
  const typedEvidence = page.types.some((type) => DISCOVER_SOURCE_EVIDENCE_TYPES.has(type))
  return typedEvidence ? 3 : 2
}

function normalizeDiscoverSourcePages(values) {
  const pagesByUrl = new Map()
  for (const rawPage of Array.isArray(values) ? values : []) {
    const page = normalizeDiscoverSourcePage(rawPage)
    if (!page) continue
    const existing = pagesByUrl.get(page.url)
    if (existing) {
      existing.page = mergeDiscoverSourcePage(existing.page, page)
      continue
    }
    pagesByUrl.set(page.url, { page, order: pagesByUrl.size })
  }
  return [...pagesByUrl.values()]
    .sort((left, right) => (
      discoverSourcePageRetentionTier(right.page) - discoverSourcePageRetentionTier(left.page)
      || left.order - right.order
    ))
    .slice(0, DISCOVER_SOURCE_PAGE_LIMIT)
    .map(({ page }) => page)
}

/**
 * Kept outside the normal Discover state so catalog polling stays light. This
 * is the durable, exportable JSON index of official site pages found by the
 * background worker.
 */
function normalizeScholarlyEvidence(value) {
  if (!value || typeof value !== 'object') return null
  const institutionRaw = value.institution && typeof value.institution === 'object' ? value.institution : null
  const institution = institutionRaw ? {
    openAlexId: normalizeDiscoverSourceUrl(institutionRaw.openAlexId),
    rorId: normalizeDiscoverSourceUrl(institutionRaw.rorId),
    displayName: String(institutionRaw.displayName || '').slice(0, 220),
    homepageUrl: normalizeDiscoverSourceUrl(institutionRaw.homepageUrl),
    domains: Array.isArray(institutionRaw.domains)
      ? institutionRaw.domains.map((item) => String(item || '').toLowerCase().slice(0, 160)).filter(Boolean).slice(0, 8)
      : [],
  } : null
  const candidateResearchers = []
  for (const raw of Array.isArray(value.candidateResearchers) ? value.candidateResearchers : []) {
    if (!raw || typeof raw !== 'object') continue
    const openAlexId = normalizeDiscoverSourceUrl(raw.openAlexId)
    const name = String(raw.name || '').trim().slice(0, 180)
    if (!openAlexId || !name) continue
    candidateResearchers.push({
      openAlexId,
      name,
      orcid: normalizeDiscoverSourceUrl(raw.orcid),
      profileUrl: normalizeDiscoverSourceUrl(raw.profileUrl) || openAlexId,
      score: clamp(raw.score, 0, 100000, 0),
      matchedQueries: Array.isArray(raw.matchedQueries)
        ? raw.matchedQueries.map((item) => String(item || '').slice(0, 120)).filter(Boolean).slice(0, 4)
        : [],
      recentWorks: (Array.isArray(raw.recentWorks) ? raw.recentWorks : []).map((work) => ({
        title: String(work?.title || '').slice(0, 300),
        year: clamp(work?.year, 1900, 2200, 0) || null,
        citedByCount: clamp(work?.citedByCount, 0, 10000000, 0),
        source: normalizeDiscoverSourceUrl(work?.source),
        matchedQuery: String(work?.matchedQuery || '').slice(0, 120),
      })).filter((work) => work.title && work.source).slice(0, 5),
    })
    if (candidateResearchers.length >= 15) break
  }
  return {
    provider: value.provider === 'openalex+ror' ? value.provider : 'openalex+ror',
    queriedAt: typeof value.queriedAt === 'string' ? value.queriedAt.slice(0, 40) : null,
    query: String(value.query || '').slice(0, 300),
    status: value.status === 'ok' ? 'ok' : 'unavailable',
    error: value.status === 'ok' ? null : String(value.error || '').slice(0, 160),
    institution,
    candidateResearchers,
  }
}

export function normalizeDiscoverSourceIndex(value) {
  if (!value || typeof value !== 'object') return null
  const schools = []
  for (const rawSchool of Array.isArray(value.schools) ? value.schools : []) {
    if (!rawSchool || typeof rawSchool !== 'object') continue
    const officialUrl = normalizeDiscoverSourceUrl(rawSchool.officialUrl)
    const school = String(rawSchool.school || '').trim().slice(0, 220)
    if (!officialUrl || !school) continue
    const pages = normalizeDiscoverSourcePages(rawSchool.pages)
    const entry = {
      school,
      region: String(rawSchool.region || '').slice(0, 32),
      officialUrl,
      allowedHosts: (Array.isArray(rawSchool.allowedHosts) ? rawSchool.allowedHosts : [])
        .map((host) => String(host || '').trim().toLowerCase().replace(/^www\./, ''))
        .filter((host) => /^[a-z0-9.-]+$/.test(host))
        .slice(0, 40),
      collectedAt: typeof rawSchool.collectedAt === 'string' ? rawSchool.collectedAt.slice(0, 40) : null,
      crawlStatus: ['ok', 'robots', 'blocked', 'unavailable', 'invalid-source'].includes(rawSchool.crawlStatus) ? rawSchool.crawlStatus : 'unavailable',
      health: rawSchool.health && typeof rawSchool.health === 'object' ? {
        status: ['ok', 'robots', 'blocked', 'unavailable', 'invalid-source'].includes(rawSchool.health.status)
          ? rawSchool.health.status
          : 'unavailable',
        attemptedAt: typeof rawSchool.health.attemptedAt === 'string' ? rawSchool.health.attemptedAt.slice(0, 40) : null,
        declaredSeedCount: clamp(rawSchool.health.declaredSeedCount, 0, 40, 0),
        sitemapCount: clamp(rawSchool.health.sitemapCount, 0, 40, 0),
        fetchedPageCount: clamp(rawSchool.health.fetchedPageCount, 0, 40, 0),
        candidatePageCount: clamp(rawSchool.health.candidatePageCount, 0, 500, 0),
        httpFailures: Array.isArray(rawSchool.health.httpFailures)
          ? rawSchool.health.httpFailures.map(Number).filter((status) => Number.isInteger(status) && status >= 100 && status <= 599).slice(0, 12)
          : [],
      } : null,
      fetchedPageCount: clamp(rawSchool.fetchedPageCount, 0, 24, 0),
      candidatePageCount: clamp(rawSchool.candidatePageCount, 0, 180, pages.length),
      pages,
      scholarlyEvidence: normalizeScholarlyEvidence(rawSchool.scholarlyEvidence),
    }
    for (const type of ['advisor', 'program', 'admissions', 'funding', 'research']) {
      entry[`${type}Pages`] = pages.filter((page) => page.types.includes(type))
    }
    schools.push(entry)
    if (schools.length >= 250) break
  }
  return {
    schemaVersion: value.schemaVersion === 2 ? 2 : 1,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt.slice(0, 40) : null,
    sourceCount: schools.length,
    schools,
    adapterCoverage: value.adapterCoverage && typeof value.adapterCoverage === 'object' ? {
      passed: Boolean(value.adapterCoverage.passed),
      requiredSchoolCount: clamp(value.adapterCoverage.requiredSchoolCount, 0, 1000, 100),
      registrySchoolCount: clamp(value.adapterCoverage.registrySchoolCount, 0, 1000, 0),
      coveredSchoolCount: clamp(value.adapterCoverage.coveredSchoolCount, 0, 1000, 0),
      fullyTypedSchoolCount: clamp(value.adapterCoverage.fullyTypedSchoolCount, 0, 1000, 0),
      seedCount: clamp(value.adapterCoverage.seedCount, 0, 100000, 0),
    } : null,
    opportunitySources: (Array.isArray(value.opportunitySources) ? value.opportunitySources : [])
      .map((source) => ({
        name: String(source?.name || '').slice(0, 160),
        url: normalizeDiscoverSourceUrl(source?.url),
        authority: 'lead-only',
        status: ['ok', 'partial', 'blocked', 'unavailable', 'robots', 'invalid-source'].includes(source?.status) ? source.status : 'unavailable',
        checkedAt: typeof source?.checkedAt === 'string' ? source.checkedAt.slice(0, 40) : null,
        fetchedPageCount: clamp(source?.fetchedPageCount, 0, 40, 0),
        candidatePageCount: clamp(source?.candidatePageCount, 0, 500, 0),
        httpFailures: Array.isArray(source?.httpFailures)
          ? source.httpFailures.map(Number).filter((status) => Number.isInteger(status) && status >= 100 && status <= 599).slice(0, 12)
          : [],
      }))
      .filter((source) => source.name && source.url)
      .slice(0, 40),
    quality: value.quality && typeof value.quality === 'object' ? {
      passed: Boolean(value.quality.passed),
      coveragePassed: value.quality.coveragePassed !== false,
      checkedAt: typeof value.quality.checkedAt === 'string' ? value.quality.checkedAt.slice(0, 40) : null,
      failures: asStringArray(value.quality.failures, 12),
      warnings: asStringArray(value.quality.warnings, 12),
      successfulSchoolCrawls: clamp(value.quality.successfulSchoolCrawls, 0, 500, 0),
      indexedAdvisorPages: clamp(value.quality.indexedAdvisorPages, 0, 100000, 0),
      aiProgramCount: clamp(value.quality.aiProgramCount, 0, 1000, 0),
      sourcedProgramCount: clamp(value.quality.sourcedProgramCount, 0, 1000, 0),
      officialProgramCoverage: clamp(value.quality.officialProgramCoverage, 0, 1, 0),
      crossSchoolSourceViolations: clamp(value.quality.crossSchoolSourceViolations, 0, 100000, 0),
      genericProgramRows: clamp(value.quality.genericProgramRows, 0, 1000, 0),
      verifiedAdvisorProfiles: clamp(value.quality.verifiedAdvisorProfiles, 0, 100000, 0),
      scholarlyInstitutionsResolved: clamp(value.quality.scholarlyInstitutionsResolved, 0, 500, 0),
    } : null,
  }
}

export function normalizeDiscoverState(raw) {
  const base = defaultDiscoverState()
  if (!raw || typeof raw !== 'object') return base
  const intakeRaw = raw.intake && typeof raw.intake === 'object' ? raw.intake : {}
  const rankerRaw = raw.ranker && typeof raw.ranker === 'object' ? raw.ranker : {}
  const rising = ['strong', 'moderate', 'neutral'].includes(intakeRaw.risingStarBias)
    ? intakeRaw.risingStarBias
    : base.intake.risingStarBias
  const hasLiveResearch = Number(raw.researchRuns || 0) > 0 || Boolean(raw.researchJob)
  const deletedProgramIds = asStringArray(raw.deletedProgramIds, 500)
  const deletedProgramIdSet = new Set(deletedProgramIds)
  const normalizedCustomPrograms = normalizeCustomPrograms(raw.customPrograms, { max: MAX_DISCOVER_PERSISTED_PROGRAMS })
  const durablePrograms = hasLiveResearch
    ? normalizedCustomPrograms.filter((program) => (
        program.provenance !== 'ai'
        || (
          !isGenericProgramLabel(program.program)
          && program.sources?.some((sourceUrl) => /^https:\/\//i.test(sourceUrl))
          && ['verified', 'partial'].includes(program.verification?.status)
          && Number(program.verification?.officialSourceCount || 0) > 0
        )
      ))
    : normalizedCustomPrograms
  const durableCustomPrograms = [
    ...dedupeDiscoverDecisionPrograms(durablePrograms.filter((program) => (
      program.provenance === 'ai' && !deletedProgramIdSet.has(program.id)
    ))),
    ...durablePrograms.filter((program) => program.provenance !== 'ai' && !deletedProgramIdSet.has(program.id)),
  ]
    .sort((left, right) => String(right.collectedAt || right.verification?.checkedAt || '')
      .localeCompare(String(left.collectedAt || left.verification?.checkedAt || '')))
    .slice(0, MAX_DISCOVER_PERSISTED_PROGRAMS)

  return {
    version: 1,
    intake: {
      field: String(intakeRaw.field ?? base.intake.field).slice(0, 200),
      subfields: asStringArray(intakeRaw.subfields, 20),
      regions: asStringArray(intakeRaw.regions, 12),
      stipendFloor: clamp(intakeRaw.stipendFloor, 0, 200000, base.intake.stipendFloor),
      currency: String(intakeRaw.currency ?? 'USD').slice(0, 8) || 'USD',
      nPrograms: clamp(intakeRaw.nPrograms, 5, 120, base.intake.nPrograms),
      nPisPerProgram: clamp(intakeRaw.nPisPerProgram, 1, 20, base.intake.nPisPerProgram),
      piPreferences: asStringArray(intakeRaw.piPreferences, 12),
      risingStarBias: rising,
      notes: String(intakeRaw.notes ?? '').slice(0, 4000),
      interestTags: asStringArray(intakeRaw.interestTags, 30),
      notifyMatches: intakeRaw.notifyMatches !== false,
      notifyDeadlines: intakeRaw.notifyDeadlines !== false,
      /** User-named seed schools for AI research (not full program objects). */
      seedPrograms: asStringArray(intakeRaw.seedPrograms, 30),
    },
    intakeCompleted: Boolean(raw.intakeCompleted),
    deletedProgramIds,
    hiddenProgramIds: asStringArray(raw.hiddenProgramIds, 200),
    hiddenPiIds: asStringArray(raw.hiddenPiIds, 400),
    watchedProgramIds: asStringArray(raw.watchedProgramIds, 200),
    piNotes: normalizeNotesMap(raw.piNotes, 200),
    programNotes: normalizeNotesMap(raw.programNotes, 200),
    ranker: {
      fit: clamp(rankerRaw.fit, 0, 100, DEFAULT_RANKER.fit),
      stipend: clamp(rankerRaw.stipend, 0, 100, DEFAULT_RANKER.stipend),
      city: clamp(rankerRaw.city, 0, 100, DEFAULT_RANKER.city),
      advisorDensity: clamp(rankerRaw.advisorDensity, 0, 100, DEFAULT_RANKER.advisorDensity),
      topics: clamp(rankerRaw.topics, 0, 100, DEFAULT_RANKER.topics),
    },
    interestPicks: asStringArray(raw.interestPicks, 30),
    lastResearchAt: typeof raw.lastResearchAt === 'string' ? raw.lastResearchAt : null,
    lastMatchIds: asStringArray(raw.lastMatchIds, 50),
    researchRuns: clamp(raw.researchRuns, 0, 100000, 0),
    // Built-in rows are design fixtures, not decision evidence. Once a user has
    // attempted live research, migrate the visible catalog to evidence-only
    // custom rows so sample programs and "Example" advisors cannot reappear.
    // Never expose the legacy sample catalogue or its "Example" advisors as
    // decision data. The empty state remains until official-source rows exist.
    catalogSource: 'custom',
    officialResearchOnly: true,
    customPrograms: durableCustomPrograms,
    aiEnrichments: normalizeAiEnrichments(raw.aiEnrichments),
    lastAiResearchAt: typeof raw.lastAiResearchAt === 'string' ? raw.lastAiResearchAt : null,
    preferredAiKeyId: typeof raw.preferredAiKeyId === 'string' ? raw.preferredAiKeyId.slice(0, 80) : null,
    preferredAiKeyIds: asStringArray(raw.preferredAiKeyIds, 12),
    researchJob: normalizeResearchJob(raw.researchJob),
  }
}

function normalizeNotesMap(value, maxEntries) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, note] of Object.entries(value)) {
    if (!key || typeof note !== 'string') continue
    out[String(key).slice(0, 80)] = note.slice(0, 4000)
    if (Object.keys(out).length >= maxEntries) break
  }
  return out
}

export function getUserDiscoverState(user) {
  const hasPersistedDiscover = Boolean(user?.settings?.discover && typeof user.settings.discover === 'object')
  const state = normalizeDiscoverState(user?.settings?.discover)
  return hasPersistedDiscover ? state : normalizeDiscoverState({
    ...state,
    catalogSource: 'custom',
    officialResearchOnly: true,
  })
}

export function setUserDiscoverState(user, nextState) {
  if (!user.settings || typeof user.settings !== 'object') user.settings = {}
  user.settings.discover = normalizeDiscoverState(nextState)
  return user.settings.discover
}

export function getUserDiscoverSourceIndex(user) {
  return normalizeDiscoverSourceIndex(user?.settings?.discoverSourceIndex)
}

export function setUserDiscoverSourceIndex(user, index) {
  if (!user.settings || typeof user.settings !== 'object') user.settings = {}
  user.settings.discoverSourceIndex = normalizeDiscoverSourceIndex(index)
  return user.settings.discoverSourceIndex
}

function mergeDiscoverSourcePages(current, previous) {
  const merged = new Map()
  for (const page of [...(current || []), ...(previous || [])]) {
    if (!page?.url || merged.has(page.url)) continue
    merged.set(page.url, page)
  }
  return [...merged.values()]
}

/**
 * Keeps prior fetched evidence available when a new bounded run checks a
 * different university slice. Current observations win for duplicate pages;
 * older clean pages remain so retained results still resolve after restart.
 */
export function mergeDiscoverSourceIndexes(previousValue, currentValue) {
  const previous = normalizeDiscoverSourceIndex(previousValue)
  const current = normalizeDiscoverSourceIndex(currentValue)
  if (!previous.schools.length) return current
  if (!current.schools.length) return previous

  const previousBySchool = new Map(previous.schools.map((school) => [school.school.toLowerCase(), school]))
  const currentSchoolKeys = new Set(current.schools.map((school) => school.school.toLowerCase()))
  const schools = current.schools.map((school) => {
    const prior = previousBySchool.get(school.school.toLowerCase())
    if (!prior) return school
    return {
      ...prior,
      ...school,
      allowedHosts: [...new Set([...(school.allowedHosts || []), ...(prior.allowedHosts || [])])],
      pages: mergeDiscoverSourcePages(school.pages, prior.pages),
      advisorPages: mergeDiscoverSourcePages(school.advisorPages, prior.advisorPages),
      programPages: mergeDiscoverSourcePages(school.programPages, prior.programPages),
      admissionsPages: mergeDiscoverSourcePages(school.admissionsPages, prior.admissionsPages),
      fundingPages: mergeDiscoverSourcePages(school.fundingPages, prior.fundingPages),
      researchPages: mergeDiscoverSourcePages(school.researchPages, prior.researchPages),
      scholarlyEvidence: school.scholarlyEvidence || prior.scholarlyEvidence || null,
    }
  })
  for (const school of previous.schools) {
    if (!currentSchoolKeys.has(school.school.toLowerCase())) schools.push(school)
  }

  return normalizeDiscoverSourceIndex({
    ...previous,
    ...current,
    generatedAt: current.generatedAt || previous.generatedAt,
    schools,
    adapterCoverage: current.adapterCoverage || previous.adapterCoverage,
    opportunitySources: current.opportunitySources?.length
      ? current.opportunitySources
      : previous.opportunitySources,
    quality: current.quality || previous.quality,
  })
}

function textBlob(program) {
  return [
    program.school,
    program.program,
    program.researchFocus,
    program.fitRationale,
    ...(program.tags || []),
    ...(program.pis || []).map((pi) => `${pi.name} ${pi.research} ${pi.whyFit}`),
  ]
    .join(' ')
    .toLowerCase()
}

function topicScore(program, intake, interestPicks) {
  const blob = textBlob(program)
  const terms = [
    ...(intake.subfields || []),
    ...(intake.interestTags || []),
    ...(interestPicks || []),
    intake.field || '',
  ]
    .map((item) => String(item).toLowerCase().trim())
    .filter((item) => item.length >= 2)

  if (!terms.length) return 0.55
  let hits = 0
  for (const term of terms) {
    if (blob.includes(term)) hits += 1
    // soft match on interest area keys
    for (const [area, kws] of Object.entries(INTEREST_AREAS)) {
      if (term === area.toLowerCase() || kws.some((kw) => term.includes(kw) || kw.includes(term))) {
        if (program.tags?.some((tag) => tag.toLowerCase() === area.toLowerCase()) || kws.some((kw) => blob.includes(kw))) {
          hits += 0.5
        }
      }
    }
  }
  return Math.max(0, Math.min(1, hits / Math.max(3, terms.length * 0.6)))
}

function stipendScore(program, floor) {
  if (program.stipendUSD == null) return 0.35
  if (program.stipendUSD < floor) return Math.max(0, 0.25 * (program.stipendUSD / Math.max(floor, 1)))
  const real = program.stipendUSD / (program.colIndex > 0 ? program.colIndex : 1)
  // Prefer higher real stipend; soft cap
  return Math.max(0.4, Math.min(1, real / 45000))
}

function cityScore(program) {
  // Prefer moderate COL (not extreme), still allow user ranker to reweight
  const col = program.colIndex || 1
  if (col <= 1.05) return 0.85
  if (col <= 1.25) return 0.7
  if (col <= 1.45) return 0.55
  return 0.4
}

function advisorDensityScore(program, intake) {
  const pis = program.pis || []
  if (!pis.length) return 0.2
  const prefs = new Set(intake.piPreferences || [])
  const fitting = pis.filter((item) => prefs.size === 0 || prefs.has(item.category) || item.category === 'direction_fit' || item.category === 'rising_star')
  let score = Math.min(1, fitting.length / Math.max(2, intake.nPisPerProgram || 6))
  if (intake.risingStarBias === 'strong') {
    const rising = pis.filter((item) => item.category === 'rising_star').length
    score = Math.min(1, score * 0.7 + (rising > 0 ? 0.3 : 0))
  } else if (intake.risingStarBias === 'neutral') {
    score = Math.min(1, score * 0.9 + 0.1)
  }
  return score
}

function baseFitScore(program, intake, interestPicks) {
  const catalogFit = Math.max(0, Math.min(10, Number(program.fitScore) || 5)) / 10
  const topics = topicScore(program, intake, interestPicks)
  const regionOk = !intake.regions?.length || intake.regions.includes(program.region)
  const regionFactor = regionOk ? 1 : 0.25
  const stipendOk = program.stipendUSD == null || program.stipendUSD >= (intake.stipendFloor || 0) * 0.85
  const stipendFactor = stipendOk ? 1 : 0.55
  return Math.max(0, Math.min(1, (catalogFit * 0.45 + topics * 0.55) * regionFactor * stipendFactor))
}

export function scoreProgram(program, state) {
  const intake = state.intake || DEFAULT_INTAKE
  const ranker = state.ranker || DEFAULT_RANKER
  const total = Math.max(1, ranker.fit + ranker.stipend + ranker.city + ranker.advisorDensity + ranker.topics)
  const dims = {
    fit: baseFitScore(program, intake, state.interestPicks),
    stipend: stipendScore(program, intake.stipendFloor || 0),
    city: cityScore(program),
    advisorDensity: advisorDensityScore(program, intake),
    topics: topicScore(program, intake, state.interestPicks),
  }
  const weighted =
    (dims.fit * ranker.fit +
      dims.stipend * ranker.stipend +
      dims.city * ranker.city +
      dims.advisorDensity * ranker.advisorDensity +
      dims.topics * ranker.topics) /
    total

  const realStipend =
    program.stipendUSD == null
      ? null
      : Math.round(program.stipendUSD / (program.colIndex > 0 ? program.colIndex : 1))

  const meetsFloor =
    program.stipendUSD == null ? null : program.stipendUSD >= (intake.stipendFloor || 0)

  return {
    ...program,
    meetsFloor,
    realStipendUSD: realStipend,
    matchScore: Math.round(weighted * 1000) / 10,
    matchDimensions: {
      fit: Math.round(dims.fit * 100),
      stipend: Math.round(dims.stipend * 100),
      city: Math.round(dims.city * 100),
      advisorDensity: Math.round(dims.advisorDensity * 100),
      topics: Math.round(dims.topics * 100),
    },
    fittingPiCount: (program.pis || []).filter((item) =>
      ['rising_star', 'direction_fit'].includes(item.category),
    ).length,
  }
}

export function rankPrograms(state, { includeHidden = false } = {}) {
  const hidden = new Set(state.hiddenProgramIds || [])
  const scored = getActivePrograms(state)
    .filter((program) => includeHidden || !hidden.has(program.id))
    .map((program) => scoreProgram(program, state))
    .map((program) => ({
      ...program,
      pis: (program.pis || [])
        .filter((pi) => includeHidden || !(state.hiddenPiIds || []).includes(pi.id))
        .slice(0, Math.max(1, state.intake?.nPisPerProgram || 6)),
    }))
    .sort((a, b) => b.matchScore - a.matchScore || (b.fitScore || 0) - (a.fitScore || 0))

  return scored.slice(0, Math.max(5, state.intake?.nPrograms || 20))
}

export function listAllScoredPrograms(state) {
  const hidden = new Set(state.hiddenProgramIds || [])
  return getActivePrograms(state).map((program) => {
    const scored = scoreProgram(program, state)
    return {
      ...scored,
      hidden: hidden.has(program.id),
      watched: (state.watchedProgramIds || []).includes(program.id),
      note: state.programNotes?.[program.id] || '',
      pis: (program.pis || []).map((pi) => ({
        ...pi,
        hidden: (state.hiddenPiIds || []).includes(pi.id),
        note: state.piNotes?.[pi.id] || '',
      })),
    }
  }).sort((a, b) => b.matchScore - a.matchScore)
}

export function listAllPis(state) {
  const programs = listAllScoredPrograms(state)
  const rows = []
  for (const program of programs) {
    for (const pi of program.pis || []) {
      rows.push({
        ...pi,
        programId: program.id,
        school: program.school,
        program: program.program,
        region: program.region,
        city: program.city,
        matchScore: program.matchScore,
      })
    }
  }
  return rows.sort((a, b) => {
    if (a.hidden !== b.hidden) return a.hidden ? 1 : -1
    return (b.hIndex || 0) - (a.hIndex || 0)
  })
}

export function computeDiscoverStats(state) {
  const programs = listAllScoredPrograms(state).filter((item) => !item.hidden)
  const withStipend = programs.filter((item) => item.stipendUSD != null)
  const avgStipend =
    withStipend.length > 0
      ? Math.round(withStipend.reduce((sum, item) => sum + item.stipendUSD, 0) / withStipend.length)
      : null
  const avgReal =
    withStipend.length > 0
      ? Math.round(withStipend.reduce((sum, item) => sum + (item.realStipendUSD || 0), 0) / withStipend.length)
      : null
  const byRegion = {}
  for (const program of programs) {
    byRegion[program.region] = (byRegion[program.region] || 0) + 1
  }
  const meetFloor = withStipend.filter((item) => item.meetsFloor).length
  const top = programs.slice(0, 5).map((item) => ({
    id: item.id,
    school: item.school,
    program: item.program,
    matchScore: item.matchScore,
    stipendUSD: item.stipendUSD,
    realStipendUSD: item.realStipendUSD,
  }))

  // Lightweight “Spearman-like” association: rank correlation stipend vs match (simplified)
  let stipendFitCorrelation = null
  if (withStipend.length >= 4) {
    const pairs = withStipend.map((item) => ({ x: item.stipendUSD, y: item.matchScore }))
    stipendFitCorrelation = Math.round(pearson(pairs) * 100) / 100
  }

  return {
    programCount: programs.length,
    piCount: programs.reduce((sum, item) => sum + (item.pis?.length || 0), 0),
    avgStipendUSD: avgStipend,
    avgRealStipendUSD: avgReal,
    meetFloorCount: meetFloor,
    byRegion,
    top,
    stipendFitCorrelation,
    requirements: requirementsStats(programs),
    colSeries: withStipend
      .map((item) => ({
        id: item.id,
        label: item.school,
        stipendUSD: item.stipendUSD,
        realStipendUSD: item.realStipendUSD,
        colIndex: item.colIndex,
        matchScore: item.matchScore,
      }))
      .sort((a, b) => (b.realStipendUSD || 0) - (a.realStipendUSD || 0))
      .slice(0, 12),
    upcomingDeadlines: programs
      .map((item) => {
        const primary = (item.requirements?.deadlines || [])
          .filter((d) => d.date)
          .sort((a, b) => a.date.localeCompare(b.date))[0]
        if (!primary?.date) return null
        return {
          id: item.id,
          school: item.school,
          program: item.program,
          deadline: primary.date,
          label: primary.label,
          certainty: primary.certainty,
          matchScore: item.matchScore,
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .slice(0, 12),
    advanced: computeAdvancedDiscoverStats(programs, {
      interestAreas: getDiscoverCatalogMeta().interestAreas,
    }),
  }
}

function pearson(pairs) {
  const n = pairs.length
  if (n < 2) return 0
  const xs = pairs.map((p) => p.x)
  const ys = pairs.map((p) => p.y)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  if (dx === 0 || dy === 0) return 0
  return num / Math.sqrt(dx * dy)
}

export function buildImportPayload(program, pi, { includeNotes = true, programNote = '', piNote = '' } = {}) {
  const enriched = attachRequirements(program)
  const req = enriched.requirements
  const primary = (req?.deadlines || []).find((d) => d.date) || req?.deadlines?.[0]
  const deadline = primary?.date || program.deadlineIso || ''
  const researchParts = [
    program.researchFocus,
    pi?.research,
    pi?.whyFit,
    includeNotes && programNote ? `My notes: ${programNote}` : '',
    includeNotes && piNote ? `PI notes: ${piNote}` : '',
  ].filter(Boolean)

  const professorName = pi?.name || 'TBD Advisor'
  const materialLines = (req?.materials || [])
    .map((m) => `- ${m.name}${m.required ? ' (required)' : ' (optional)'}${m.count ? ` ×${m.count}` : ''}`)
    .join('\n')
  const testLines = (req?.tests || [])
    .map((t) => `- ${t.name}: ${t.status}`)
    .join('\n')
  const notes = [
    `Imported from Discover · ${program.school} / ${program.program}`,
    program.fitRationale,
    primary ? `Deadline: ${primary.label} ${primary.date || primary.certainty}` : program.deadlineAndTests,
    req?.restrictions?.summary || program.applicationRestrictions,
    req?.route?.label ? `Route: ${req.route.label}` : program.applicationRoute,
    program.stipendLocal,
    program.tuitionLocal ? `Tuition: ${program.tuitionLocal}` : '',
    program.qsWorldRank ? `QS world rank: ${program.qsWorldRank}${program.rankingYear ? ` (${program.rankingYear})` : ''}` : '',
    program.qsSubjectRank ? `QS subject rank: ${program.qsSubjectRank} · ${program.qsSubjectName || ''}` : '',
    program.theWorldRank ? `THE world rank: ${program.theWorldRank}${program.rankingYear ? ` (${program.rankingYear})` : ''}` : '',
    ...(program.scholarships || []).map((item) => `Scholarship: ${item.name} · ${item.amount || 'amount not stated'} · ${item.url}`),
    program.intlNotes,
    materialLines ? `Materials:\n${materialLines}` : '',
    testLines ? `Tests:\n${testLines}` : '',
    req?.fees ? `Fee: ${req.fees.amountUSD != null ? `~$${req.fees.amountUSD}` : 'unknown'}${req.fees.waiverAvailable ? ' (waiver possible)' : ''}` : '',
    program.honestyNote || 'Verify all requirements on official pages before applying.',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    professor: professorName,
    professorChinese: '',
    professorEmail: (pi?.email && pi.email.includes('@')) ? pi.email : '',
    professorHomepage: pi?.url || program.website || '',
    university: program.school,
    country: program.country || 'United States',
    website: program.website || '',
    program: program.program,
    deadline,
    notes: notes.slice(0, 4000),
    researchSeed: researchParts.join(' · ').slice(0, 2000),
    tagsSeed: Array.from(new Set([
      ...(program.tags || []),
      ...(req?.restrictions?.multiApply === 'multi' ? ['multi-apply'] : []),
      ...(req?.fees?.waiverAvailable ? ['fee-waiver'] : []),
    ])).slice(0, 12),
    requirementsSnapshot: req,
  }
}

export function buildResearchAgents(state) {
  const regions = (state.intake?.regions || []).join(', ') || 'all regions'
  const field = state.intake?.field || 'your field'
  return [
    {
      id: 'agent_programs',
      name: 'Program Scout',
      description: `Scan programs in ${regions} for ${field}`,
      status: 'idle',
    },
    {
      id: 'agent_pis',
      name: 'PI Analyst',
      description: 'Match advisors by category, wet/dry, and recruiting signals',
      status: 'idle',
    },
    {
      id: 'agent_stipend',
      name: 'Stipend Verifier',
      description: 'Cross-check stipend snapshots vs floor and COL',
      status: 'idle',
    },
    {
      id: 'agent_outcomes',
      name: 'Outcomes Checker',
      description: 'Surface career outcomes and international-student notes',
      status: 'idle',
    },
  ]
}

export function runDiscoverResearch(state, { ai = null } = {}) {
  const ranked = rankPrograms(state)
  const topIds = ranked.slice(0, 8).map((item) => item.id)
  const previous = new Set(state.lastMatchIds || [])
  const newlySurfaced = topIds.filter((id) => !previous.has(id))
  const agents = buildResearchAgents(state).map((agent, index) => ({
    ...agent,
    status: 'done',
    detail:
      index === 0
        ? `Ranked ${ranked.length} programs`
        : index === 1
          ? `Reviewed advisors across top ${Math.min(8, ranked.length)} schools`
          : index === 2
            ? `${ranked.filter((p) => p.meetsFloor).length} meet stipend floor`
            : ai
              ? `AI strategy notes ready (${ai.provider || 'model'})`
              : `Insights ready for ${ranked.length} programs`,
  }))

  const topLabel = ranked
    .slice(0, 3)
    .map((item) => `${item.school} (${item.matchScore})`)
    .join(' · ')

  const baseSummary = topLabel
    ? `Top fits: ${topLabel}. Confirm stipends and deadlines on official pages.`
    : 'No programs matched current filters. Broaden regions or lower stipend floor.'

  return {
    runAt: new Date().toISOString(),
    matchedCount: ranked.length,
    topProgramIds: topIds,
    newlySurfacedIds: newlySurfaced,
    agents,
    summary: ai?.summary ? `${ai.summary} ${baseSummary}` : baseSummary,
    aiUsed: Boolean(ai),
    aiProvider: ai?.provider || null,
    aiModel: ai?.model || null,
    suggestedPrograms: ai?.suggestedPrograms || [],
    rankedPreview: ranked.slice(0, 8).map((item) => ({
      id: item.id,
      school: item.school,
      program: item.program,
      matchScore: item.matchScore,
      region: item.region,
      stipendUSD: item.stipendUSD,
      realStipendUSD: item.realStipendUSD,
    })),
  }
}

/** Build the prompt payload for LLM enrichment (honesty-first). */
export function buildAiResearchPrompt(state, ranked) {
  const intake = state.intake || DEFAULT_INTAKE
  const top = ranked.slice(0, 8).map((item) => ({
    id: item.id,
    school: item.school,
    program: item.program,
    region: item.region,
    city: item.city,
    matchScore: item.matchScore,
    stipendUSD: item.stipendUSD,
    realStipendUSD: item.realStipendUSD,
    researchFocus: item.researchFocus,
    fitRationale: item.fitRationale,
    tags: item.tags,
    multiApply: item.multiApply,
    intlNotes: item.intlNotes,
    piNames: (item.pis || []).slice(0, 4).map((pi) => ({
      name: pi.name,
      category: pi.category,
      research: pi.research,
    })),
  }))
  return {
    system: [
      'You are a careful PhD application research assistant inside PhD Atlas.',
      'Never invent official stipend amounts, hard deadlines, or h-index numbers.',
      'If unsure, say so. Prefer strategic fit analysis over fabricated facts.',
      'Respond with a single JSON object only (no markdown fences).',
      'Schema: {',
      '  "summary": string,',
      '  "enrichments": [{ "id": string, "fitRationale": string, "tips": string, "researchFocus"?: string }],',
      '  "suggestedPrograms": optional array of new program objects with fields:',
      '    school, program, region, city, country, website, researchFocus, fitScore(0-10), fitRationale, tags[],',
      '    stipendUSD (null if unknown), stipendNotes, deadlineAndTests, multiApply (multi|single|unknown),',
      '    colIndex (approx 0.8-1.7), pis:[{name, category, research, whyFit}]',
      '}',
      'suggestedPrograms: at most 3, only if clearly relevant; mark stipendConfidence unknown.',
    ].join(' '),
    user: JSON.stringify({
      intake: {
        field: intake.field,
        subfields: intake.subfields,
        regions: intake.regions,
        stipendFloor: intake.stipendFloor,
        piPreferences: intake.piPreferences,
        risingStarBias: intake.risingStarBias,
        interestTags: intake.interestTags,
        notes: intake.notes,
      },
      rankedPrograms: top,
      instruction:
        'Enrich fit rationales for the ranked programs and optionally suggest up to 3 additional programs.',
    }),
  }
}

export function parseAiResearchResponse(text, ranked, { verified = false } = {}) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Try to extract first {...} block
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1))
      } catch {
        return { summary: cleaned.slice(0, 800), enrichments: {}, suggestedPrograms: [] }
      }
    } else {
      return { summary: cleaned.slice(0, 800), enrichments: {}, suggestedPrograms: [] }
    }
  }

  const knownIds = new Set(ranked.map((item) => item.id))
  const enrichments = {}
  const now = new Date().toISOString()
  for (const entry of parsed.enrichments || []) {
    if (!entry || typeof entry !== 'object') continue
    const id = String(entry.id || '')
    if (!id || !knownIds.has(id)) continue
    enrichments[id] = {
      fitRationale: String(entry.fitRationale || '').slice(0, 2000),
      researchFocus: String(entry.researchFocus || '').slice(0, 2000),
      strategy: String(entry.tips || entry.strategy || '').slice(0, 2000),
      tips: String(entry.tips || '').slice(0, 2000),
      updatedAt: now,
    }
  }

  const suggestedPrograms = normalizeCustomPrograms(
    (parsed.suggestedPrograms || []).map((item) => ({
      ...item,
      collectedAt: item?.collectedAt || now,
      stipendConfidence: verified ? item?.stipendConfidence : 'unknown',
      stipendFoundOfficial: verified ? Boolean(item?.stipendFoundOfficial) : false,
      stipendNotes: item?.stipendNotes || (verified ? 'Checked against the cited official source.' : 'AI-suggested — verify all numbers on official pages.'),
      stipendBasis: item?.stipendBasis || (verified ? 'Official-source research' : 'AI research suggestion (unverified)'),
    })),
    { source: 'ai', max: 120 },
  )

  return {
    summary: String(parsed.summary || '').slice(0, 1200),
    enrichments,
    suggestedPrograms,
  }
}

export function discoverMatchNotificationCandidates(state, research, todayStr) {
  const candidates = []
  if (!state.intake?.notifyMatches) return candidates

  for (const id of research.newlySurfacedIds || []) {
    const program = findProgramById(id, state)
    if (!program) continue
    candidates.push({
      type: 'discover_match',
      applicationId: null,
      dedupeKey: `discover_match:${id}:${research.runAt?.slice(0, 10) || todayStr}`,
      triggerDate: todayStr,
      title: `New program match: ${program.school}`,
      body: `${program.program} in ${program.city} looks like a strong fit for your Discover criteria.`,
      titleZh: `新项目匹配：${program.school}`,
      bodyZh: `${program.program}（${program.city}）与你的 Discover 条件匹配度较高。`,
      targetPath: '/discover',
      targetTab: null,
      targetId: `discover-program-${id}`,
      metadata: { programId: id, school: program.school, program: program.program },
    })
  }

  if (state.intake?.notifyDeadlines) {
    for (const id of state.watchedProgramIds || []) {
      const program = findProgramById(id, state)
      if (!program?.deadlineIso) continue
      const remaining = daysBetween(todayStr, program.deadlineIso)
      if (remaining < 0 || remaining > 45) continue
      candidates.push({
        type: 'discover_deadline',
        applicationId: null,
        dedupeKey: `discover_deadline:${id}:${program.deadlineIso}`,
        triggerDate: program.deadlineIso,
        title: `Watched program deadline: ${program.school}`,
        body: `${program.program} typical cycle deadline ${program.deadlineIso} is in ${remaining} day${remaining === 1 ? '' : 's'} (verify officially).`,
        titleZh: `关注项目截止：${program.school}`,
        bodyZh: `${program.program} 典型周期截止日期 ${program.deadlineIso} 还有 ${remaining} 天（请以官方为准）。`,
        targetPath: '/discover',
        targetTab: null,
        targetId: `discover-program-${id}`,
        metadata: { programId: id, school: program.school, deadline: program.deadlineIso },
      })
    }
  }

  return candidates
}

function daysBetween(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00`).getTime()
  const to = new Date(`${toIso}T00:00:00`).getTime()
  return Math.round((to - from) / 86_400_000)
}
