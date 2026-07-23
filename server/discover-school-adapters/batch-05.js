const VERIFIED_AT = '2026-07-22'

const EUROPE_PATH_HINTS = Object.freeze({
  faculty: Object.freeze([
    'faculty',
    'people',
    'person',
    'persons',
    'staff',
    'academic',
    'academics',
    'profile',
    'profiles',
    'directory',
    'researcher',
    'researchers',
    'professor',
    'professors',
    'supervisor',
    'enseignant',
    'enseignants',
    'chercheur',
    'chercheurs',
    'personnel',
    'personen',
    'medewerkers',
    'wetenschappers',
    'team',
  ]),
  lab: Object.freeze([
    'research',
    'lab',
    'labs',
    'laboratory',
    'laboratories',
    'group',
    'groups',
    'centre',
    'centres',
    'center',
    'centers',
    'institute',
    'institutes',
    'instituut',
    'instituten',
    'onderzoek',
    'laboratoire',
    'laboratoires',
    'recherche',
    'unit',
    'units',
    'network',
    'networks',
    'theme',
    'themes',
  ]),
  department: Object.freeze([
    'department',
    'departments',
    'faculty',
    'faculties',
    'school',
    'schools',
    'college',
    'colleges',
    'institute',
    'institutes',
    'organisation',
    'organization',
    'academic-unit',
    'faculte',
    'facultes',
    'departement',
    'departements',
    'fakultaet',
    'fakultaeten',
    'division',
    'divisions',
  ]),
  program: Object.freeze([
    'phd',
    'ph-d',
    'doctoral',
    'doctorate',
    'doctorat',
    'promotion',
    'graduate',
    'postgraduate',
    'program',
    'programs',
    'programme',
    'programmes',
    'research-degree',
    'research-degrees',
    'doctoral-programme',
    'doctoral-programmes',
    'doctoral-school',
    'doctoral-schools',
  ]),
})

export const SCHOOL_ADAPTERS_BATCH_05 = [
  {
    school: 'Durham University',
    region: 'UK',
    allowedHosts: ['www.durham.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://www.durham.ac.uk/departments/' },
      {
        kind: 'faculty',
        url: 'https://www.durham.ac.uk/departments/academic/computer-science/about-us/staff/',
      },
      {
        kind: 'research',
        url: 'https://www.durham.ac.uk/research/institutes-and-centres/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.durham.ac.uk/study/postgraduate/research-degrees/',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Queen Mary University of London',
    region: 'UK',
    allowedHosts: ['www.qmul.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://www.qmul.ac.uk/schools/' },
      {
        kind: 'faculty',
        url: 'https://www.qmul.ac.uk/law/people/academic-staff/',
      },
      {
        kind: 'research',
        url: 'https://www.qmul.ac.uk/research/faculties-and-research-centres/interdisciplinary-research-centres/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.qmul.ac.uk/postgraduate/research/subjects/',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Lancaster University',
    region: 'UK',
    allowedHosts: ['www.lancaster.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.lancaster.ac.uk/about-us/faculties-and-departments/',
      },
      { kind: 'faculty', url: 'https://www.lancaster.ac.uk/law/people/' },
      {
        kind: 'research',
        url: 'https://www.lancaster.ac.uk/social-sciences/research/research-centres/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.lancaster.ac.uk/sci-tech/study/phd/',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of York',
    region: 'UK',
    allowedHosts: ['www.york.ac.uk', 'www.cs.york.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.york.ac.uk/about/departments/academic/',
      },
      { kind: 'faculty', url: 'https://www.cs.york.ac.uk/people/?mode=roles' },
      {
        kind: 'research',
        url: 'https://www.york.ac.uk/about/departments/research/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.york.ac.uk/study/postgraduate/courses/all?mode=research',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Exeter',
    region: 'UK',
    allowedHosts: ['www.exeter.ac.uk', 'computerscience.exeter.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://www.exeter.ac.uk/departments/' },
      { kind: 'faculty', url: 'https://computerscience.exeter.ac.uk/people/' },
      { kind: 'research', url: 'https://www.exeter.ac.uk/research/centres/' },
      {
        kind: 'doctoral',
        url: 'https://www.exeter.ac.uk/study/pg-research/',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Cardiff University',
    region: 'UK',
    allowedHosts: ['www.cardiff.ac.uk', 'profiles.cardiff.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.cardiff.ac.uk/help/contact-us/courses/academic-schools',
      },
      { kind: 'faculty', url: 'https://profiles.cardiff.ac.uk/' },
      {
        kind: 'research',
        url: 'https://www.cardiff.ac.uk/research/explore/research-units?root_node_selection=202510',
      },
      {
        kind: 'doctoral',
        url: 'https://www.cardiff.ac.uk/study/postgraduate/research?root_node_selection=202510',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Liverpool',
    region: 'UK',
    allowedHosts: ['www.liverpool.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://www.liverpool.ac.uk/departments/' },
      {
        kind: 'faculty',
        url: 'https://www.liverpool.ac.uk/computer-science-and-informatics/staff/',
      },
      {
        kind: 'research',
        url: 'https://www.liverpool.ac.uk/computer-science-and-informatics/research/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.liverpool.ac.uk/courses/postgraduate-research',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'ETH Zurich',
    region: 'EU',
    allowedHosts: ['ethz.ch'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://ethz.ch/en/the-eth-zurich/organisation/departments-and-competence-centres.html',
      },
      {
        kind: 'faculty',
        url: 'https://ethz.ch/en/the-eth-zurich/working-teaching-and-research/faculty.html',
      },
      {
        kind: 'research',
        url: 'https://ethz.ch/en/the-eth-zurich/organisation/departments-and-competence-centres/competence-centres.html',
      },
      {
        kind: 'doctoral',
        url: 'https://ethz.ch/en/doctorate/doctoral-study-programmes.html',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'EPFL',
    region: 'EU',
    allowedHosts: ['www.epfl.ch'],
    seeds: [
      { kind: 'departments', url: 'https://www.epfl.ch/schools/' },
      {
        kind: 'faculty',
        url: 'https://www.epfl.ch/schools/ic/about/faculty-members/',
      },
      { kind: 'research', url: 'https://www.epfl.ch/research/domains/' },
      { kind: 'doctoral', url: 'https://www.epfl.ch/education/phd/programs/' },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Technical University of Munich',
    region: 'EU',
    allowedHosts: ['www.tum.de', 'www.professoren.tum.de'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.tum.de/en/research/schools-research-centers',
      },
      { kind: 'faculty', url: 'https://www.professoren.tum.de/en/' },
      { kind: 'research', url: 'https://www.tum.de/en/research/' },
      {
        kind: 'doctoral',
        url: 'https://www.tum.de/en/about-tum/careers-and-jobs/doctorate',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Ludwig Maximilian University of Munich',
    region: 'EU',
    allowedHosts: ['www.lmu.de', 'www.med.lmu.de'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.lmu.de/en/about-lmu/structure/faculties/index.html?no_redirect=true',
      },
      {
        kind: 'faculty',
        url: 'https://www.med.lmu.de/en/faculty/who-we-are/professors/',
      },
      { kind: 'research', url: 'https://www.lmu.de/en/research/' },
      {
        kind: 'doctoral',
        url: 'https://www.lmu.de/en/study/degree-students/applications-for-admission/guidelines-and-faqs/guide-to-applying-for-doctoral-studies/',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Technical University of Berlin',
    region: 'EU',
    allowedHosts: ['www.tu.berlin'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.tu.berlin/en/about/organization/faculties-central-institutes',
      },
      {
        kind: 'faculty',
        url: 'https://www.tu.berlin/en/eecs/institutions/professors-chairs',
      },
      { kind: 'research', url: 'https://www.tu.berlin/en/eecs/research' },
      {
        kind: 'doctoral',
        url: 'https://www.tu.berlin/en/research/advancement-of-junior-scholars/cjs/weitere-seiten/advancement-of-junior-scholars/doctorate',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Karlsruhe Institute of Technology',
    region: 'EU',
    allowedHosts: ['www.kit.edu', 'www.ciw.kit.edu'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.kit.edu/kit/english/organization.php',
      },
      { kind: 'faculty', url: 'https://www.ciw.kit.edu/english/whoiswho.php' },
      {
        kind: 'research',
        url: 'https://www.kit.edu/research/research-networks.php',
      },
      {
        kind: 'doctoral',
        url: 'https://www.kit.edu/research/phdprograms.php',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Heidelberg University',
    region: 'EU',
    allowedHosts: ['www.uni-heidelberg.de', 'www.awi.uni-heidelberg.de'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.uni-heidelberg.de/en/institutions/faculties/institutes-and-departments-of-the-faculties',
      },
      { kind: 'faculty', url: 'https://www.awi.uni-heidelberg.de/en/people' },
      {
        kind: 'research',
        url: 'https://www.uni-heidelberg.de/en/institutions/research-institutions',
      },
      {
        kind: 'doctoral',
        url: 'https://www.uni-heidelberg.de/en/study/application-enrolment/enrolment/enrolment-in-a-doctoral-programme',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Delft University of Technology',
    region: 'EU',
    allowedHosts: ['www.tudelft.nl', 'mavlab.tudelft.nl', 'research.tudelft.nl'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.tudelft.nl/en/about-tu-delft/organisation/faculties',
      },
      { kind: 'faculty', url: 'https://mavlab.tudelft.nl/people/' },
      { kind: 'research', url: 'https://research.tudelft.nl/' },
      {
        kind: 'doctoral',
        url: 'https://www.tudelft.nl/en/education/programmes/phd',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Amsterdam',
    region: 'EU',
    allowedHosts: ['www.uva.nl'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.uva.nl/en/about-the-uva/organisation/graduate-schools-and-colleges/teaching-organisation.html',
      },
      {
        kind: 'faculty',
        url: 'https://www.uva.nl/en/discipline/media-studies/about-us/staff/staff.html',
      },
      {
        kind: 'research',
        url: 'https://www.uva.nl/en/research/research-environment/research-organisation/research-organisation.html',
      },
      { kind: 'doctoral', url: 'https://www.uva.nl/en/research/phd/phd.html' },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Leiden University',
    region: 'EU',
    allowedHosts: [
      'www.organisatiegids.universiteitleiden.nl',
      'www.universiteitleiden.nl',
    ],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.organisatiegids.universiteitleiden.nl/en',
      },
      {
        kind: 'faculty',
        url: 'https://www.universiteitleiden.nl/en/social-behavioural-sciences/political-science/staff',
      },
      {
        kind: 'research',
        url: 'https://www.universiteitleiden.nl/en/research/our-research-organisation/research-institutes',
      },
      {
        kind: 'doctoral',
        url: 'https://www.universiteitleiden.nl/en/education/phd-programmes',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Eindhoven University of Technology',
    region: 'EU',
    allowedHosts: ['research.tue.nl', 'www.tue.nl'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://research.tue.nl/en/organisations/index/',
      },
      { kind: 'faculty', url: 'https://research.tue.nl/en/persons/index/' },
      { kind: 'research', url: 'https://www.tue.nl/en/research/research-groups' },
      {
        kind: 'doctoral',
        url: 'https://www.tue.nl/en/education/graduate-school/phd',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Utrecht University',
    region: 'EU',
    allowedHosts: ['www.uu.nl', 'research-portal.uu.nl'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.uu.nl/en/organisation/governance-and-organisation/faculties',
      },
      {
        kind: 'faculty',
        url: 'https://www.uu.nl/en/organisation/governance-and-organisation/professors',
      },
      {
        kind: 'research',
        url: 'https://research-portal.uu.nl/en/organisations/faculties/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.uu.nl/en/organisation/graduate-school-of-natural-sciences',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'RWTH Aachen University',
    region: 'EU',
    allowedHosts: ['www.jara.org', 'combi.rwth-aachen.de'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.jara.org/en/research/member-institutes',
      },
      { kind: 'faculty', url: 'https://combi.rwth-aachen.de/en/team' },
      { kind: 'research', url: 'https://www.jara.org/en/research' },
      {
        kind: 'doctoral',
        url: 'https://www.jara.org/en/research/center-for-simulation-and-data-sciences/qualification-career',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'KU Leuven',
    region: 'EU',
    allowedHosts: ['www.kuleuven.be', 'research.kuleuven.be'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.kuleuven.be/english/faculties_schools',
      },
      {
        kind: 'faculty',
        url: 'https://www.kuleuven.be/wieiswie/en/person/search',
      },
      { kind: 'research', url: 'https://research.kuleuven.be/en' },
      {
        kind: 'doctoral',
        url: 'https://www.kuleuven.be/english/apply/application-instructions/instructions-doctoral',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Ghent University',
    region: 'EU',
    allowedHosts: ['www.ugent.be', 'research.ugent.be'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.ugent.be/en/ghentuniv/faculty/overview.htm',
      },
      {
        kind: 'faculty',
        url: 'https://www.ugent.be/en/research/doctoralresearch/faculty-pages-phd-students.htm',
      },
      { kind: 'research', url: 'https://research.ugent.be/web/svo/en' },
      {
        kind: 'doctoral',
        url: 'https://www.ugent.be/en/research/doctoralresearch',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Paris-Saclay University',
    region: 'EU',
    allowedHosts: [
      'www.universite-paris-saclay.fr',
      'www.imo.universite-paris-saclay.fr',
    ],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.universite-paris-saclay.fr/en/graduate-schools',
      },
      {
        kind: 'faculty',
        url: 'https://www.imo.universite-paris-saclay.fr/en/people/',
      },
      {
        kind: 'research',
        url: 'https://www.universite-paris-saclay.fr/en/research/lines-research',
      },
      {
        kind: 'doctoral',
        url: 'https://www.universite-paris-saclay.fr/en/node/60348',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Institut Polytechnique de Paris',
    region: 'EU',
    allowedHosts: ['www.ip-paris.fr', 'www.telecom-paris.fr'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.ip-paris.fr/en/research/research-departments-laboratories-centers-and-projects/departments',
      },
      {
        kind: 'faculty',
        url: 'https://www.telecom-paris.fr/en/research/faculty',
      },
      {
        kind: 'research',
        url: 'https://www.ip-paris.fr/en/research/research-departments-laboratories-centers-and-projects/laboratories',
      },
      {
        kind: 'doctoral',
        url: 'https://www.ip-paris.fr/en/education/phd-programs/ip-paris-doctoral-school',
      },
    ],
    pathHints: EUROPE_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
]
