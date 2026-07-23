const VERIFIED_AT = '2026-07-22'

const UK_PATH_HINTS = Object.freeze({
  faculty: Object.freeze([
    'faculty',
    'people',
    'person',
    'staff',
    'academic',
    'academics',
    'profile',
    'profiles',
    'directory',
    'researcher',
    'professor',
    'supervisor',
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
    'theme',
    'themes',
  ]),
  department: Object.freeze([
    'department',
    'departments',
    'school',
    'schools',
    'faculty',
    'faculties',
    'college',
    'colleges',
    'division',
    'divisions',
    'academic-structure',
  ]),
  program: Object.freeze([
    'phd',
    'dphil',
    'mphil',
    'doctoral',
    'doctorate',
    'graduate',
    'postgraduate',
    'research-degree',
    'research-degrees',
    'programme',
    'programmes',
    'prospective-students',
    'doctoral-training',
  ]),
})

export const SCHOOL_ADAPTERS_BATCH_04 = [
  {
    school: 'University of Oxford',
    region: 'UK',
    allowedHosts: ['www.mpls.ox.ac.uk', 'www.cs.ox.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://www.mpls.ox.ac.uk/departments' },
      { kind: 'faculty', url: 'https://www.cs.ox.ac.uk/people/faculty.html' },
      { kind: 'research', url: 'https://www.cs.ox.ac.uk/research/' },
      { kind: 'doctoral', url: 'https://www.cs.ox.ac.uk/admissions/graduate/' },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Cambridge',
    region: 'UK',
    allowedHosts: ['www.cam.ac.uk', 'www.cst.cam.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.cam.ac.uk/colleges-and-departments/department-a-z',
      },
      {
        kind: 'faculty',
        url: 'https://www.cst.cam.ac.uk/people/directory/faculty%2C-staff',
      },
      { kind: 'research', url: 'https://www.cst.cam.ac.uk/research/groups' },
      { kind: 'doctoral', url: 'https://www.cst.cam.ac.uk/admissions/phd' },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Imperial College London',
    region: 'UK',
    allowedHosts: ['www.imperial.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.imperial.ac.uk/faculties-and-departments/',
      },
      { kind: 'faculty', url: 'https://www.imperial.ac.uk/computing/people/' },
      { kind: 'research', url: 'https://www.imperial.ac.uk/computing/research/' },
      {
        kind: 'doctoral',
        url: 'https://www.imperial.ac.uk/computing/prospective-students/phd/',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University College London',
    region: 'UK',
    allowedHosts: ['www.ucl.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.ucl.ac.uk/about/leadership/governance-and-compliance/academic-structure',
      },
      {
        kind: 'faculty',
        url: 'https://www.ucl.ac.uk/engineering/computer-science/people/academic-staff-ucl-profiles',
      },
      {
        kind: 'research',
        url: 'https://www.ucl.ac.uk/engineering/computer-science/research/research-groups-and-centres',
      },
      {
        kind: 'doctoral',
        url: 'https://www.ucl.ac.uk/engineering/computer-science/study/postgraduate-research/computer-science-mphilphd',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The University of Edinburgh',
    region: 'UK',
    allowedHosts: ['www.ed.ac.uk', 'informatics.ed.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.ed.ac.uk/schools-departments/colleges-schools',
      },
      { kind: 'faculty', url: 'https://informatics.ed.ac.uk/people' },
      { kind: 'research', url: 'https://informatics.ed.ac.uk/research' },
      {
        kind: 'doctoral',
        url: 'https://informatics.ed.ac.uk/study-with-us/our-degrees/postgraduate-research-programmes-and-centres-doctoral-training',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The University of Manchester',
    region: 'UK',
    allowedHosts: ['www.manchester.ac.uk', 'www.cs.manchester.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.manchester.ac.uk/about/structure/faculties-schools/',
      },
      {
        kind: 'faculty',
        url: 'https://www.cs.manchester.ac.uk/about/people/academic-and-research-staff/',
      },
      {
        kind: 'research',
        url: 'https://www.cs.manchester.ac.uk/research/centres-and-institutes/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.cs.manchester.ac.uk/study/postgraduate-research/research-programmes/',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Bristol',
    region: 'UK',
    allowedHosts: ['www.bristol.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://www.bristol.ac.uk/faculties/' },
      { kind: 'faculty', url: 'https://www.bristol.ac.uk/people/contactdirectory/' },
      {
        kind: 'research',
        url: 'https://www.bristol.ac.uk/science-engineering/research/groups-centres/',
      },
      { kind: 'doctoral', url: 'https://www.bristol.ac.uk/study/postgraduate/research/' },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Warwick',
    region: 'UK',
    allowedHosts: ['warwick.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://warwick.ac.uk/fac/sci/dcs/' },
      { kind: 'faculty', url: 'https://warwick.ac.uk/fac/sci/dcs/people/' },
      { kind: 'research', url: 'https://warwick.ac.uk/fac/sci/dcs/research/' },
      {
        kind: 'doctoral',
        url: 'https://warwick.ac.uk/fac/sci/dcs/research/cscdt/',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: "King's College London",
    region: 'UK',
    allowedHosts: ['www.kcl.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://www.kcl.ac.uk/informatics' },
      { kind: 'faculty', url: 'https://www.kcl.ac.uk/informatics/about/people' },
      { kind: 'research', url: 'https://www.kcl.ac.uk/informatics/research/groups' },
      {
        kind: 'doctoral',
        url: 'https://www.kcl.ac.uk/informatics/study-with-us/research-degrees',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Glasgow',
    region: 'UK',
    allowedHosts: ['www.gla.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://www.gla.ac.uk/schools/' },
      { kind: 'faculty', url: 'https://www.gla.ac.uk/schools/computing/staff/' },
      { kind: 'research', url: 'https://www.gla.ac.uk/schools/computing/research/' },
      {
        kind: 'doctoral',
        url: 'https://www.gla.ac.uk/schools/computing/postgraduateresearch/prospectivestudents/',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Birmingham',
    region: 'UK',
    allowedHosts: ['www.birmingham.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.birmingham.ac.uk/about/colleges-schools-and-departments',
      },
      {
        kind: 'faculty',
        url: 'https://www.birmingham.ac.uk/about/college-of-engineering-and-physical-sciences/computer-science/people',
      },
      {
        kind: 'research',
        url: 'https://www.birmingham.ac.uk/research/centres-institutes/research-in-computer-science',
      },
      {
        kind: 'doctoral',
        url: 'https://www.birmingham.ac.uk/study/postgraduate/subjects/computer-science-and-data-science-courses/computer-science-phd',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The University of Sheffield',
    region: 'UK',
    allowedHosts: ['www.sheffield.ac.uk', 'sheffield.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://sheffield.ac.uk/departments' },
      { kind: 'faculty', url: 'https://sheffield.ac.uk/cs/people/academic' },
      { kind: 'research', url: 'https://sheffield.ac.uk/cs/research/centres' },
      { kind: 'doctoral', url: 'https://sheffield.ac.uk/cs/phd-study' },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Southampton',
    region: 'UK',
    allowedHosts: ['www.southampton.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.southampton.ac.uk/about/faculties-schools-departments',
      },
      { kind: 'faculty', url: 'https://www.southampton.ac.uk/people?page=0' },
      { kind: 'research', url: 'https://www.southampton.ac.uk/research' },
      {
        kind: 'doctoral',
        url: 'https://www.southampton.ac.uk/study/postgraduate-research',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Nottingham',
    region: 'UK',
    allowedHosts: ['www.nottingham.ac.uk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.nottingham.ac.uk/computerscience/index.aspx',
      },
      {
        kind: 'faculty',
        url: 'https://www.nottingham.ac.uk/computerscience/people/index.aspx/',
      },
      {
        kind: 'research',
        url: 'https://www.nottingham.ac.uk/computerscience/research/research-groups.aspx',
      },
      {
        kind: 'doctoral',
        url: 'https://www.nottingham.ac.uk/pgstudy/course/research/computer-science-phd',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Leeds',
    region: 'UK',
    allowedHosts: ['eps.leeds.ac.uk'],
    seeds: [
      { kind: 'departments', url: 'https://eps.leeds.ac.uk/' },
      { kind: 'faculty', url: 'https://eps.leeds.ac.uk/computing/stafflist' },
      {
        kind: 'research',
        url: 'https://eps.leeds.ac.uk/research-innovation/doc/research-groups',
      },
      {
        kind: 'doctoral',
        url: 'https://eps.leeds.ac.uk/homepage/229/research-degrees---computing',
      },
    ],
    pathHints: UK_PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
]
