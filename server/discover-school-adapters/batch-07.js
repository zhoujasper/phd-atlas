const VERIFIED_AT = '2026-07-22';

const PATH_HINTS = Object.freeze({
  faculty: ['faculty', 'people', 'staff', 'profile', 'professor', 'researcher'],
  lab: ['lab', 'labs', 'laboratory', 'group', 'groups', 'centre', 'center', 'research'],
  department: ['department', 'departments', 'faculty', 'faculties', 'school', 'institute', 'unit'],
  program: ['phd', 'doctoral', 'doctorate', 'graduate', 'program', 'programme'],
});

export const SCHOOL_ADAPTERS_BATCH_07 = [
  {
    school: 'Uppsala University',
    region: 'EU',
    allowedHosts: ['uu.se', 'www.uu.se'],
    seeds: [
      { kind: 'departments', url: 'https://www.uu.se/en/department.html' },
      {
        kind: 'faculty',
        url: 'https://www.uu.se/en/contact-and-organisation/organisation?query=X61%3A2',
      },
      {
        kind: 'research',
        url: 'https://www.uu.se/en/department/information-technology/research/research-groups',
      },
      { kind: 'doctoral', url: 'https://www.uu.se/en/study/phd-studies' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Aalto University',
    region: 'EU',
    allowedHosts: ['aalto.fi', 'www.aalto.fi'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.aalto.fi/en/aalto-university/schools-departments-and-units',
      },
      {
        kind: 'faculty',
        url: 'https://www.aalto.fi/en/department-of-computer-science/contact-us',
      },
      {
        kind: 'research',
        url: 'https://www.aalto.fi/en/department-of-computer-science/research-groups',
      },
      {
        kind: 'doctoral',
        url: 'https://www.aalto.fi/en/doctoral-education/doctoral-programmes',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Helsinki',
    region: 'EU',
    allowedHosts: ['helsinki.fi', 'www.helsinki.fi'],
    seeds: [
      { kind: 'departments', url: 'https://www.helsinki.fi/en/faculties-and-units' },
      {
        kind: 'faculty',
        url: 'https://www.helsinki.fi/en/about-us/people/researchers-and-teachers/professors',
      },
      {
        kind: 'research',
        url: 'https://www.helsinki.fi/en/research/research-units-and-infrastructures/research-groups',
      },
      {
        kind: 'doctoral',
        url: 'https://www.helsinki.fi/en/admissions-and-education/apply-doctoral-programmes/doctoral-programmes',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Copenhagen',
    region: 'EU',
    allowedHosts: ['ku.dk', 'www.ku.dk', 'about.ku.dk', 'di.ku.dk', 'phd.ku.dk'],
    seeds: [
      { kind: 'departments', url: 'https://about.ku.dk/organisation/departments/' },
      { kind: 'faculty', url: 'https://di.ku.dk/english/staff/' },
      { kind: 'research', url: 'https://di.ku.dk/english/research/groups/' },
      { kind: 'doctoral', url: 'https://phd.ku.dk/english/' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Aarhus University',
    region: 'EU',
    allowedHosts: ['au.dk', 'www.au.dk', 'international.au.dk', 'cs.au.dk', 'phd.au.dk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://international.au.dk/about/organisation/departments',
      },
      { kind: 'faculty', url: 'https://cs.au.dk/contact/researchers/' },
      { kind: 'research', url: 'https://cs.au.dk/research/' },
      { kind: 'doctoral', url: 'https://phd.au.dk/phd-programmes' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Technical University of Denmark',
    region: 'EU',
    allowedHosts: ['dtu.dk', 'www.dtu.dk', 'compute.dtu.dk', 'www.compute.dtu.dk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.dtu.dk/english/about/organization/departments',
      },
      { kind: 'faculty', url: 'https://www.compute.dtu.dk/about-us/staff' },
      { kind: 'research', url: 'https://www.compute.dtu.dk/sections' },
      { kind: 'doctoral', url: 'https://www.dtu.dk/english/education/phd/intro' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'TU Wien',
    region: 'EU',
    allowedHosts: ['tuwien.at', 'www.tuwien.at', 'informatics.tuwien.ac.at'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.tuwien.at/en/tu-wien/organisation/faculties-and-institutes/',
      },
      { kind: 'faculty', url: 'https://informatics.tuwien.ac.at/people/professors' },
      { kind: 'research', url: 'https://www.tuwien.at/en/research/facilities/' },
      {
        kind: 'doctoral',
        url: 'https://www.tuwien.at/en/studies/studies/doctoral-programmes',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Vienna',
    region: 'EU',
    allowedHosts: [
      'univie.ac.at',
      'www.univie.ac.at',
      'informatik.univie.ac.at',
      'doktorat.univie.ac.at',
    ],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.univie.ac.at/en/about-us/organisation-and-structure',
      },
      {
        kind: 'faculty',
        url: 'https://informatik.univie.ac.at/en/about-us/staff-directory/',
      },
      {
        kind: 'research',
        url: 'https://informatik.univie.ac.at/en/research/key-research-areas/',
      },
      {
        kind: 'doctoral',
        url: 'https://doktorat.univie.ac.at/en/doctoralphd-programmes/',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Politecnico di Milano',
    region: 'EU',
    allowedHosts: ['polimi.it', 'www.polimi.it', 'deib.polimi.it', 'www.deib.polimi.it'],
    seeds: [
      { kind: 'departments', url: 'https://www.polimi.it/en/research/departments' },
      { kind: 'faculty', url: 'https://www.deib.polimi.it/eng/people' },
      { kind: 'research', url: 'https://www.deib.polimi.it/eng/deib-labs' },
      {
        kind: 'doctoral',
        url: 'https://www.polimi.it/en/phd/prospective-phd-candidates/phd-programmes',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Bologna',
    region: 'EU',
    allowedHosts: ['unibo.it', 'www.unibo.it', 'disi.unibo.it'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.unibo.it/en/university/organisation-and-campuses/departments',
      },
      { kind: 'faculty', url: 'https://disi.unibo.it/en/department/people/faculty' },
      {
        kind: 'research',
        url: 'https://disi.unibo.it/en/research/research-laboratories',
      },
      {
        kind: 'doctoral',
        url: 'https://www.unibo.it/en/study/phd-professional-masters-specialisation-schools-and-other-programmes/phd/phd-programme',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Sapienza University of Rome',
    region: 'EU',
    allowedHosts: ['uniroma1.it', 'www.uniroma1.it', 'diag.uniroma1.it', 'www.diag.uniroma1.it'],
    seeds: [
      { kind: 'departments', url: 'https://www.uniroma1.it/en/pagina/structures' },
      { kind: 'faculty', url: 'https://www.diag.uniroma1.it/persone/docenti' },
      { kind: 'research', url: 'https://www.diag.uniroma1.it/research-labs' },
      { kind: 'doctoral', url: 'https://www.uniroma1.it/en/pagina/phd-programmes' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Barcelona',
    region: 'EU',
    allowedHosts: ['ub.edu', 'www.ub.edu', 'web.ub.edu'],
    seeds: [
      { kind: 'departments', url: 'https://web.ub.edu/en/departments' },
      {
        kind: 'faculty',
        url: 'https://web.ub.edu/en/web/facultat-farmacia-alimentacio/professorat',
      },
      {
        kind: 'research',
        url: 'https://web.ub.edu/en/web/departament-bioquimica-biomedicina/research-groups',
      },
      {
        kind: 'doctoral',
        url: 'https://web.ub.edu/en/web/informacio-academica/doctoral-programmes',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Autonomous University of Madrid',
    region: 'EU',
    allowedHosts: ['uam.es', 'www.uam.es'],
    seeds: [
      { kind: 'departments', url: 'https://www.uam.es/eps/escuela/dpto-ii' },
      {
        kind: 'faculty',
        url: 'https://www.uam.es/eps/escuela/dpto-ii/listado-pdi',
      },
      {
        kind: 'research',
        url: 'https://www.uam.es/uam/en/iuce/investigacion/equipos-y-grupos-de-investigacion',
      },
      { kind: 'doctoral', url: 'https://www.uam.es/uam/programas-doctorado' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Toronto',
    region: 'CA',
    allowedHosts: [
      'utoronto.ca',
      'www.utoronto.ca',
      'vpacademic.utoronto.ca',
      'toronto.edu',
      'web.cs.toronto.edu',
    ],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.vpacademic.utoronto.ca/academic-units/academic-unit-list-departments-edus/',
      },
      {
        kind: 'faculty',
        url: 'https://web.cs.toronto.edu/people/faculty-directory',
      },
      { kind: 'research', url: 'https://web.cs.toronto.edu/research/areas' },
      { kind: 'doctoral', url: 'https://web.cs.toronto.edu/graduate/programs' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of British Columbia',
    region: 'CA',
    allowedHosts: [
      'ubc.ca',
      'www.ubc.ca',
      'science.ubc.ca',
      'cs.ubc.ca',
      'www.cs.ubc.ca',
      'grad.ubc.ca',
      'www.grad.ubc.ca',
    ],
    seeds: [
      { kind: 'departments', url: 'https://science.ubc.ca/about/departments' },
      { kind: 'faculty', url: 'https://www.cs.ubc.ca/people/faculty' },
      { kind: 'research', url: 'https://www.cs.ubc.ca/research-groups' },
      {
        kind: 'doctoral',
        url: 'https://www.grad.ubc.ca/prospective-students/graduate-degree-programs/phd-computer-science',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
];
