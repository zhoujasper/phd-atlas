const VERIFIED_AT = '2026-07-22';

const PATH_HINTS = Object.freeze({
  faculty: [
    'faculty', 'faculties', 'people', 'staff', 'profile', 'profiles', 'professor',
    'researcher', 'researchers', 'expert', 'experts', 'academic', 'supervisor',
  ],
  lab: [
    'lab', 'labs', 'laboratory', 'group', 'groups', 'centre', 'centres', 'center',
    'centers', 'institute', 'institutes', 'research', 'project', 'projects',
  ],
  department: [
    'department', 'departments', 'faculty', 'faculties', 'school', 'schools',
    'college', 'colleges', 'institute', 'institutes', 'organisation',
    'organisations', 'unit', 'units', 'subject', 'subjects',
  ],
  program: [
    'phd', 'ph.d', 'doctoral', 'doctorate', 'doctor of philosophy', 'graduate',
    'postgraduate', 'higher degree research', 'research degree', 'program',
    'programme', 'admission', '101aa',
  ],
});

export const SCHOOL_ADAPTERS_BATCH_10 = [
  {
    school: 'The University of Melbourne',
    region: 'AU',
    allowedHosts: [
      'unimelb.edu.au',
      'findanexpert.unimelb.edu.au',
      'handbook.unimelb.edu.au',
    ],
    seeds: [
      {
        kind: 'departments',
        url: 'https://handbook.unimelb.edu.au/search?year=2026&types%5B%5D=subject',
      },
      {
        kind: 'faculty',
        url: 'https://findanexpert.unimelb.edu.au/searchresults?pageNumber=1&pageSize=20&q=professor',
      },
      {
        kind: 'research',
        url: 'https://findanexpert.unimelb.edu.au/searchresults?category=opportunity&pageNumber=1&pageSize=20&q=&sorting=mostRecent',
      },
      {
        kind: 'doctoral',
        url: 'https://handbook.unimelb.edu.au/2026/courses/101aa/attributes-outcomes-skills',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The University of Sydney',
    region: 'AU',
    allowedHosts: ['sydney.edu.au', 'www.sydney.edu.au', 'profiles.sydney.edu.au'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.sydney.edu.au/about-us/faculties-and-schools.html',
      },
      {
        kind: 'faculty',
        url: 'https://www.sydney.edu.au/medicine-health/about/our-people/academic-staff.html',
      },
      {
        kind: 'research',
        url: 'https://www.sydney.edu.au/research/our-research/centres.html',
      },
      {
        kind: 'doctoral',
        url: 'https://www.sydney.edu.au/courses/courses/pr/doctor-of-philosophy-arts-and-social-sciences0.html',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'UNSW Sydney',
    region: 'AU',
    allowedHosts: ['unsw.edu.au', 'www.unsw.edu.au'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.unsw.edu.au/about-us/excellence/faculties-schools',
      },
      {
        kind: 'faculty',
        url: 'https://www.unsw.edu.au/engineering/about-us/our-people',
      },
      {
        kind: 'research',
        url: 'https://www.unsw.edu.au/about-us/innovation-impact/centres-institutes',
      },
      { kind: 'doctoral', url: 'https://www.unsw.edu.au/research/hdr/phd' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Monash University',
    region: 'AU',
    allowedHosts: ['monash.edu', 'research.monash.edu', 'handbook.monash.edu'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://research.monash.edu/en/organisations/index/',
      },
      {
        kind: 'faculty',
        url: 'https://research.monash.edu/en/persons/index.php',
      },
      {
        kind: 'research',
        url: 'https://research.monash.edu/en/projects/index/',
      },
      {
        kind: 'doctoral',
        url: 'https://handbook.monash.edu/current/courses/0047',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The University of Queensland',
    region: 'AU',
    allowedHosts: ['uq.edu.au', 'about.uq.edu.au', 'research.uq.edu.au', 'study.uq.edu.au'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://about.uq.edu.au/faculties-institutes',
      },
      { kind: 'faculty', url: 'https://about.uq.edu.au/experts' },
      {
        kind: 'research',
        url: 'https://research.uq.edu.au/capabilities/research-centres',
      },
      {
        kind: 'doctoral',
        url: 'https://study.uq.edu.au/study-options/programs/doctor-philosophy-7501?year=2026',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The University of Adelaide',
    region: 'AU',
    allowedHosts: ['adelaide.edu.au'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://adelaide.edu.au/about/colleges-schools/',
      },
      { kind: 'faculty', url: 'https://adelaide.edu.au/people' },
      {
        kind: 'research',
        url: 'https://adelaide.edu.au/research/institutes-centres-concentrations/',
      },
      {
        kind: 'doctoral',
        url: 'https://adelaide.edu.au/study/degrees/doctor-of-philosophy/',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Technology Sydney',
    region: 'AU',
    allowedHosts: ['uts.edu.au', 'www.uts.edu.au'],
    seeds: [
      { kind: 'departments', url: 'https://www.uts.edu.au/about/faculties' },
      {
        kind: 'faculty',
        url: 'https://www.uts.edu.au/about/faculties/business/about/our-people',
      },
      {
        kind: 'research',
        url: 'https://www.uts.edu.au/research/centres/all-research-centres',
      },
      {
        kind: 'doctoral',
        url: 'https://www.uts.edu.au/for-students/admissions-entry/how-to-apply/masters-by-research-phd',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'RMIT University',
    region: 'AU',
    allowedHosts: ['rmit.edu.au', 'www.rmit.edu.au'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.rmit.edu.au/about/schools-colleges',
      },
      {
        kind: 'faculty',
        url: 'https://www.rmit.edu.au/about/schools-colleges/computing-technologies/people',
      },
      {
        kind: 'research',
        url: 'https://www.rmit.edu.au/research/centres-collaborations',
      },
      {
        kind: 'doctoral',
        url: 'https://www.rmit.edu.au/study-with-us/levels-of-study/research-programs/phd/phd-architecture--design-dr207',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The University of Western Australia',
    region: 'AU',
    allowedHosts: ['uwa.edu.au', 'www.uwa.edu.au', 'research-repository.uwa.edu.au'],
    seeds: [
      { kind: 'departments', url: 'https://www.uwa.edu.au/about/schools' },
      {
        kind: 'faculty',
        url: 'https://research-repository.uwa.edu.au/en/persons/index/',
      },
      {
        kind: 'research',
        url: 'https://www.uwa.edu.au/research/institutes-centres',
      },
      {
        kind: 'doctoral',
        url: 'https://www.uwa.edu.au/study/courses/doctor-of-philosophy',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Macquarie University',
    region: 'AU',
    allowedHosts: ['mq.edu.au', 'researchers.mq.edu.au', 'policies.mq.edu.au'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://researchers.mq.edu.au/en/organisations/index/',
      },
      {
        kind: 'faculty',
        url: 'https://researchers.mq.edu.au/en/persons/index.php',
      },
      {
        kind: 'research',
        url: 'https://researchers.mq.edu.au/en/projects/index/',
      },
      {
        kind: 'doctoral',
        url: 'https://policies.mq.edu.au/document/view.php?id=369&version=1',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Deakin University',
    region: 'AU',
    allowedHosts: ['deakin.edu.au', 'apps.deakin.edu.au'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://apps.deakin.edu.au/current-students-courses/allcourses.php',
      },
      {
        kind: 'faculty',
        url: 'https://apps.deakin.edu.au/current-students-courses/course.php?course=A800&version=2',
      },
      {
        kind: 'research',
        url: 'https://apps.deakin.edu.au/current-students-courses/course.php?course=S910&version=2',
      },
      {
        kind: 'doctoral',
        url: 'https://apps.deakin.edu.au/current-students-courses/course.php?course=A900&version=2',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
];
