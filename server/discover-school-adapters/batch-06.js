export const SCHOOL_ADAPTERS_BATCH_06 = [
  {
    school: 'Sorbonne University',
    region: 'EU',
    allowedHosts: [
      'sorbonne-universite.fr',
      'www.sorbonne-universite.fr',
      'lettres.sorbonne-universite.fr',
    ],
    seeds: [
      {
        kind: 'faculty',
        url: 'https://lettres.sorbonne-universite.fr/personnes',
      },
      {
        kind: 'departments',
        url: 'https://lettres.sorbonne-universite.fr/en/faculty-arts-languages-literature-and-humanities/schools-and-departments',
      },
      {
        kind: 'research',
        url: 'https://lettres.sorbonne-universite.fr/recherche/structures-de-recherche',
      },
      {
        kind: 'doctoral',
        url: 'https://lettres.sorbonne-universite.fr/recherche/doctorat',
      },
    ],
    pathHints: {
      faculty: ['personnes', 'personnel', 'enseignant', 'chercheur', 'annuaire', 'faculty'],
      lab: ['laboratoire', 'laboratoires', 'recherche', 'structure', 'unite', 'equipe'],
      department: ['department', 'departments', 'school', 'faculte', 'ufr'],
      program: ['doctorat', 'doctoral', 'phd', 'ecole-doctorale', 'these'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'University Grenoble Alpes',
    region: 'EU',
    allowedHosts: [
      'univ-grenoble-alpes.fr',
      'www.univ-grenoble-alpes.fr',
      'inspe.univ-grenoble-alpes.fr',
      'doctorat.univ-grenoble-alpes.fr',
    ],
    seeds: [
      {
        kind: 'faculty',
        url: 'https://inspe.univ-grenoble-alpes.fr/recherche/annuaire-des-enseignants-chercheurs-1442691.kjsp',
      },
      {
        kind: 'departments',
        url: 'https://www.univ-grenoble-alpes.fr/about/organization/the-research-departments-and-doctoral-college/',
      },
      {
        kind: 'research',
        url: 'https://www.univ-grenoble-alpes.fr/chercheur-enseignant-chercheur-ou-doctorant/consulter-la-liste-des-laboratoires/',
      },
      {
        kind: 'doctoral',
        url: 'https://doctorat.univ-grenoble-alpes.fr/english/',
      },
    ],
    pathHints: {
      faculty: ['annuaire', 'enseignant', 'chercheur', 'personnel', 'faculty', 'people'],
      lab: ['laboratoire', 'laboratoires', 'recherche', 'research', 'equipe', 'group'],
      department: ['department', 'departments', 'pole', 'poles', 'faculte', 'ecole'],
      program: ['doctorat', 'doctoral', 'phd', 'ecole-doctorale', 'graduate'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'Ecole normale superieure',
    region: 'EU',
    allowedHosts: [
      'ens.psl.eu',
      'www.ens.psl.eu',
      'phys.ens.psl.eu',
      'www.phys.ens.psl.eu',
    ],
    seeds: [
      { kind: 'faculty', url: 'https://www.phys.ens.psl.eu/en/annuaire' },
      { kind: 'departments', url: 'https://www.ens.psl.eu/en/academics/departments' },
      { kind: 'research', url: 'https://www.ens.psl.eu/en/leading-edge-research' },
      {
        kind: 'doctoral',
        url: 'https://www.ens.psl.eu/en/academics/academic-programs/phd-programs',
      },
    ],
    pathHints: {
      faculty: ['annuaire', 'faculty', 'people', 'person', 'researcher', 'chercheur'],
      lab: ['laboratory', 'laboratories', 'lab', 'research', 'unit', 'laboratoire'],
      department: ['department', 'departments', 'school', 'departement'],
      program: ['phd', 'doctoral', 'doctorat', 'graduate', 'academic-programs'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'KTH Royal Institute of Technology',
    region: 'EU',
    allowedHosts: ['kth.se', 'www.kth.se'],
    seeds: [
      {
        kind: 'faculty',
        url: 'https://www.kth.se/en/om/kontakt/sok-anstallda-pa-kth-1.448246',
      },
      {
        kind: 'departments',
        url: 'https://www.kth.se/en/forskning/omraden/institutioner-1.1167392',
      },
      {
        kind: 'research',
        url: 'https://www.kth.se/en/forskning/sarskilda-forskningssatsningar/kompetenscentra/centrumbildningar-1.1156831',
      },
      {
        kind: 'doctoral',
        url: 'https://www.kth.se/en/studies/phd/programmes-1.325286',
      },
    ],
    pathHints: {
      faculty: ['employee', 'employees', 'staff', 'faculty', 'people', 'anstallda', 'personal'],
      lab: ['research', 'research-group', 'research-centre', 'forskargrupp', 'forskning', 'centrum'],
      department: ['department', 'departments', 'institution', 'institutioner', 'school', 'skola'],
      program: ['phd', 'doctoral', 'programme', 'programmes', 'forskarutbildning'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'Chalmers University of Technology',
    region: 'EU',
    allowedHosts: ['chalmers.se', 'www.chalmers.se'],
    seeds: [
      { kind: 'faculty', url: 'https://www.chalmers.se/en/centres/chair/faculty/' },
      { kind: 'departments', url: 'https://www.chalmers.se/en/departments/' },
      {
        kind: 'research',
        url: 'https://www.chalmers.se/en/centres/wingquist/research/research-groups/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.chalmers.se/en/research/we-train-new-researchers/about-doctoral-studies/',
      },
    ],
    pathHints: {
      faculty: ['faculty', 'people', 'person', 'staff', 'researcher', 'forskare'],
      lab: ['research-group', 'research-groups', 'lab', 'laboratory', 'centre', 'forskargrupp'],
      department: ['department', 'departments', 'division', 'institution'],
      program: ['doctoral', 'phd', 'graduate-school', 'forskarutbildning', 'doktorand'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'Lund University',
    region: 'EU',
    allowedHosts: [
      'lunduniversity.lu.se',
      'www.lunduniversity.lu.se',
      'portal.research.lu.se',
    ],
    seeds: [
      { kind: 'faculty', url: 'https://portal.research.lu.se/en/persons/index.html' },
      {
        kind: 'departments',
        url: 'https://www.lunduniversity.lu.se/about-university/faculties-departments-and-centres',
      },
      {
        kind: 'research',
        url: 'https://www.lunduniversity.lu.se/about-university/faculties-departments-and-centres/institutes-and-research-centres',
      },
      {
        kind: 'doctoral',
        url: 'https://www.lunduniversity.lu.se/study/study-opportunities-lund-university/doctoral-studies',
      },
    ],
    pathHints: {
      faculty: ['persons', 'profiles', 'faculty', 'people', 'staff', 'forskare'],
      lab: ['research-centre', 'research-centres', 'institute', 'group', 'forskargrupp'],
      department: ['department', 'departments', 'faculty', 'faculties', 'institution'],
      program: ['doctoral', 'phd', 'graduate', 'doctoral-studies', 'forskarutbildning'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'Uppsala University',
    region: 'EU',
    allowedHosts: ['uu.se', 'www.uu.se'],
    seeds: [
      {
        kind: 'faculty',
        url: 'https://www.uu.se/en/contact-and-organisation/organisation?query=TM3%3A15',
      },
      { kind: 'departments', url: 'https://www.uu.se/en/department.html' },
      { kind: 'research', url: 'https://www.uu.se/en/research/research-areas' },
      { kind: 'doctoral', url: 'https://www.uu.se/en/study/phd-studies' },
    ],
    pathHints: {
      faculty: ['academic-staff', 'staff', 'people', 'person', 'forskare', 'personal'],
      lab: ['research-area', 'research-areas', 'research-group', 'forskargrupp', 'forskning'],
      department: ['department', 'departments', 'organisation', 'institution'],
      program: ['phd', 'doctoral', 'phd-studies', 'forskarutbildning', 'doktorand'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'Aalto University',
    region: 'EU',
    allowedHosts: ['aalto.fi', 'www.aalto.fi', 'research.aalto.fi'],
    seeds: [
      {
        kind: 'faculty',
        url: 'https://research.aalto.fi/en/organisations/aalto-university/',
      },
      {
        kind: 'departments',
        url: 'https://www.aalto.fi/en/aalto-university/schools-departments-and-units',
      },
      { kind: 'research', url: 'https://www.aalto.fi/en/school-of-engineering/research' },
      {
        kind: 'doctoral',
        url: 'https://www.aalto.fi/en/doctoral-education/doctoral-programmes',
      },
    ],
    pathHints: {
      faculty: ['profiles', 'persons', 'faculty', 'people', 'researcher', 'tutkijat'],
      lab: ['research', 'research-group', 'research-groups', 'lab', 'tutkimusryhma'],
      department: ['school', 'schools', 'department', 'departments', 'unit', 'laitos'],
      program: ['doctoral', 'doctoral-programmes', 'phd', 'tohtori', 'graduate'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'University of Helsinki',
    region: 'EU',
    allowedHosts: ['helsinki.fi', 'www.helsinki.fi', 'researchportal.helsinki.fi'],
    seeds: [
      {
        kind: 'faculty',
        url: 'https://researchportal.helsinki.fi/en/persons/index/',
      },
      {
        kind: 'departments',
        url: 'https://www.helsinki.fi/en/research/research-units-and-infrastructures/faculties-and-field-specific-units',
      },
      {
        kind: 'research',
        url: 'https://researchportal.helsinki.fi/en/organisations/university-of-helsinki/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.helsinki.fi/en/admissions-and-education/apply-doctoral-programmes/doctoral-programmes',
      },
    ],
    pathHints: {
      faculty: ['persons', 'profiles', 'faculty', 'researcher', 'staff', 'tutkijat'],
      lab: ['research-unit', 'research-units', 'research-group', 'laboratory', 'tutkimusryhma'],
      department: ['faculty', 'faculties', 'department', 'unit', 'institute', 'laitos'],
      program: ['doctoral', 'doctoral-programmes', 'phd', 'tohtori', 'apply'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'University of Copenhagen',
    region: 'EU',
    allowedHosts: [
      'ku.dk',
      'www.ku.dk',
      'about.ku.dk',
      'research.ku.dk',
      'researchprofiles.ku.dk',
      'phd.ku.dk',
    ],
    seeds: [
      {
        kind: 'faculty',
        url: 'https://researchprofiles.ku.dk/en/organisations/university-of-copenhagen',
      },
      { kind: 'departments', url: 'https://about.ku.dk/organisation/departments/' },
      { kind: 'research', url: 'https://research.ku.dk/areas/centres/' },
      { kind: 'doctoral', url: 'https://phd.ku.dk/english/' },
    ],
    pathHints: {
      faculty: ['profiles', 'persons', 'faculty', 'people', 'researcher', 'forskere'],
      lab: ['research-centre', 'research-centres', 'centres', 'group', 'forskningscenter'],
      department: ['department', 'departments', 'faculty', 'institute', 'institut'],
      program: ['phd', 'doctoral', 'graduate-school', 'forskeruddannelse'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'Aarhus University',
    region: 'EU',
    allowedHosts: [
      'au.dk',
      'www.au.dk',
      'international.au.dk',
      'tech.au.dk',
      'pure.au.dk',
      'phd.au.dk',
    ],
    seeds: [
      {
        kind: 'faculty',
        url: 'https://pure.au.dk/portal/en/organisations/department-of-computer-science/',
      },
      { kind: 'departments', url: 'https://international.au.dk/research/' },
      {
        kind: 'research',
        url: 'https://tech.au.dk/en/about-the-faculty/departments-and-centres/',
      },
      { kind: 'doctoral', url: 'https://phd.au.dk/phd-programmes' },
    ],
    pathHints: {
      faculty: ['profiles', 'persons', 'faculty', 'people', 'staff', 'forskere'],
      lab: ['research', 'centre', 'centres', 'research-group', 'forskningscenter'],
      department: ['department', 'departments', 'school', 'schools', 'institut'],
      program: ['phd', 'phd-programmes', 'doctoral', 'graduate-school', 'forskeruddannelse'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'Technical University of Denmark',
    region: 'EU',
    allowedHosts: ['dtu.dk', 'www.dtu.dk', 'physics.dtu.dk'],
    seeds: [
      { kind: 'faculty', url: 'https://physics.dtu.dk/about/staff/staff_list' },
      {
        kind: 'departments',
        url: 'https://www.dtu.dk/english/about/organization/departments',
      },
      {
        kind: 'research',
        url: 'https://www.dtu.dk/english/Research/Departments-and-groups.aspx',
      },
      { kind: 'doctoral', url: 'https://www.dtu.dk/english/education/phd/intro' },
    ],
    pathHints: {
      faculty: ['staff', 'staff-list', 'people', 'faculty', 'professor', 'medarbejdere'],
      lab: ['research', 'research-group', 'groups', 'centre', 'laboratory', 'forskningsgruppe'],
      department: ['department', 'departments', 'organization', 'institute', 'institut'],
      program: ['phd', 'doctoral', 'graduate-school', 'forskeruddannelse'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'TU Wien',
    region: 'EU',
    allowedHosts: ['tuwien.at', 'www.tuwien.at'],
    seeds: [
      { kind: 'faculty', url: 'https://www.tuwien.at/en/mg/asc/asc-staff' },
      {
        kind: 'departments',
        url: 'https://www.tuwien.at/en/tu-wien/organisation/faculties-and-institutes/',
      },
      { kind: 'research', url: 'https://www.tuwien.at/en/research/profile/' },
      {
        kind: 'doctoral',
        url: 'https://www.tuwien.at/en/research/tuw-doctoral-center/doctoral-colleges',
      },
    ],
    pathHints: {
      faculty: ['staff', 'people', 'faculty', 'professor', 'mitarbeiter', 'personen'],
      lab: ['research', 'research-unit', 'group', 'laboratory', 'forschung', 'arbeitsgruppe'],
      department: ['faculty', 'faculties', 'institute', 'institutes', 'fakultaet'],
      program: ['doctoral', 'doctoral-colleges', 'phd', 'doktorat', 'doktoratskolleg'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'University of Vienna',
    region: 'EU',
    allowedHosts: [
      'univie.ac.at',
      'www.univie.ac.at',
      'ufind.univie.ac.at',
      'doktorat.univie.ac.at',
    ],
    seeds: [
      { kind: 'faculty', url: 'https://ufind.univie.ac.at/en/index.html' },
      {
        kind: 'departments',
        url: 'https://www.univie.ac.at/en/about-us/organisation-and-structure',
      },
      { kind: 'research', url: 'https://www.univie.ac.at/en/research' },
      {
        kind: 'doctoral',
        url: 'https://doktorat.univie.ac.at/en/doctoralphd-programmes/',
      },
    ],
    pathHints: {
      faculty: ['ufind', 'staff', 'people', 'person', 'faculty', 'mitarbeiter'],
      lab: ['research', 'research-group', 'platform', 'centre', 'forschung', 'arbeitsgruppe'],
      department: ['faculty', 'faculties', 'department', 'centre', 'fakultaet', 'institut'],
      program: ['doctoral', 'phd', 'doctoralphd-programmes', 'doktorat', 'doctoral-school'],
    },
    verifiedAt: '2026-07-22',
  },
  {
    school: 'Politecnico di Milano',
    region: 'EU',
    allowedHosts: ['polimi.it', 'www.polimi.it', 'www.deib.polimi.it'],
    seeds: [
      { kind: 'faculty', url: 'https://www.deib.polimi.it/eng/people' },
      { kind: 'departments', url: 'https://www.polimi.it/en/research/departments' },
      { kind: 'research', url: 'https://www.polimi.it/en/research/laboratories' },
      {
        kind: 'doctoral',
        url: 'https://www.polimi.it/en/phd/prospective-phd-candidates/phd-programmes',
      },
    ],
    pathHints: {
      faculty: ['people', 'faculty', 'staff', 'professor', 'docenti', 'ricercatori'],
      lab: ['laboratories', 'laboratory', 'lab', 'research', 'laboratori', 'ricerca'],
      department: ['department', 'departments', 'dipartimento', 'dipartimenti'],
      program: ['phd', 'phd-programmes', 'doctoral', 'dottorato', 'prospective'],
    },
    verifiedAt: '2026-07-22',
  },
]
