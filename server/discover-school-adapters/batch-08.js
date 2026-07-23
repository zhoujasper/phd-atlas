const VERIFIED_AT = '2026-07-22';

const PATH_HINTS = Object.freeze({
  faculty: ['faculty', 'people', 'staff', 'profile', 'professor', 'researcher'],
  lab: ['lab', 'labs', 'laboratory', 'group', 'groups', 'centre', 'center', 'research'],
  department: ['department', 'departments', 'faculty', 'faculties', 'school', 'schools', 'institute', 'unit'],
  program: ['phd', 'doctoral', 'doctorate', 'graduate', 'program', 'programme', 'admission'],
});

export const SCHOOL_ADAPTERS_BATCH_08 = [
  {
    school: 'University of British Columbia',
    region: 'CA',
    allowedHosts: ['ubc.ca', 'science.ubc.ca', 'cs.ubc.ca', 'grad.ubc.ca'],
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
  {
    school: 'McGill University',
    region: 'CA',
    allowedHosts: ['mcgill.ca', 'www.mcgill.ca', 'cs.mcgill.ca'],
    seeds: [
      { kind: 'departments', url: 'https://www.mcgill.ca/science/about/departments' },
      { kind: 'faculty', url: 'https://www.cs.mcgill.ca/people/faculty/' },
      { kind: 'research', url: 'https://www.cs.mcgill.ca/research/' },
      { kind: 'doctoral', url: 'https://www.cs.mcgill.ca/graduate/phd/regulations/' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Waterloo',
    region: 'CA',
    allowedHosts: ['uwaterloo.ca'],
    seeds: [
      { kind: 'departments', url: 'https://uwaterloo.ca/faculties-academics-math' },
      { kind: 'faculty', url: 'https://uwaterloo.ca/computer-science/contacts' },
      {
        kind: 'research',
        url: 'https://uwaterloo.ca/computer-science/research/research-areas',
      },
      {
        kind: 'doctoral',
        url: 'https://uwaterloo.ca/future-graduate-students/programs/by-faculty/math/computer-science-doctor-philosophy-phd',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Alberta',
    region: 'CA',
    allowedHosts: [
      'ualberta.ca',
      'apps.ualberta.ca',
      'spaces.facsci.ualberta.ca',
      'www.preview.ualberta.ca',
    ],
    seeds: [
      {
        kind: 'departments',
        url: 'https://apps.ualberta.ca/directory/departments',
      },
      {
        kind: 'faculty',
        url: 'https://apps.ualberta.ca/directory/search/department/360300',
      },
      { kind: 'research', url: 'https://spaces.facsci.ualberta.ca/computing-science/' },
      {
        kind: 'doctoral',
        url: 'https://www.preview.ualberta.ca/en/graduate-programs/computing-science.html',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Universite de Montreal',
    region: 'CA',
    allowedHosts: ['umontreal.ca', 'diro.umontreal.ca', 'admission.umontreal.ca'],
    seeds: [
      { kind: 'departments', url: 'https://diro.umontreal.ca/accueil/' },
      {
        kind: 'faculty',
        url: 'https://diro.umontreal.ca/repertoire-departement/professeurs/',
      },
      {
        kind: 'research',
        url: 'https://diro.umontreal.ca/recherche/centre-groupes-chaires-et-laboratoires/',
      },
      {
        kind: 'doctoral',
        url: 'https://admission.umontreal.ca/programmes/doctorat-en-informatique/',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'McMaster University',
    region: 'CA',
    allowedHosts: ['mcmaster.ca', 'www.eng.mcmaster.ca'],
    seeds: [
      { kind: 'departments', url: 'https://www.eng.mcmaster.ca/departments/' },
      {
        kind: 'faculty',
        url: 'https://www.eng.mcmaster.ca/faculty-staff/faculty-directory/',
      },
      { kind: 'research', url: 'https://www.eng.mcmaster.ca/cas/research/' },
      {
        kind: 'doctoral',
        url: 'https://www.eng.mcmaster.ca/cas/degree-options/computer-science-phd/',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: "Queen's University",
    region: 'CA',
    allowedHosts: ['queensu.ca', 'www.cs.queensu.ca'],
    seeds: [
      { kind: 'departments', url: 'https://www.queensu.ca/artsci/departments' },
      {
        kind: 'faculty',
        url: 'https://www.cs.queensu.ca/people/?faculty=on&filter=&group=on&instructors=on&view=tiles',
      },
      { kind: 'research', url: 'https://www.cs.queensu.ca/research/groups/' },
      { kind: 'doctoral', url: 'https://www.cs.queensu.ca/graduate/phd/' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Western University',
    region: 'CA',
    allowedHosts: ['uwo.ca', 'www.uwo.ca', 'www.csd.uwo.ca'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.uwo.ca/sci/undergraduate/future_students/departments.html',
      },
      { kind: 'faculty', url: 'https://www.csd.uwo.ca/people/faculty/index.html' },
      {
        kind: 'research',
        url: 'https://www.csd.uwo.ca/graduate/future/about_western/research.html',
      },
      {
        kind: 'doctoral',
        url: 'https://www.csd.uwo.ca/graduate/current/degree_requirements.html',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Simon Fraser University',
    region: 'CA',
    allowedHosts: ['sfu.ca', 'www.sfu.ca'],
    seeds: [
      { kind: 'departments', url: 'https://www.sfu.ca/fas/about.html' },
      { kind: 'faculty', url: 'https://www.sfu.ca/fas/computing/people/faculty.html' },
      { kind: 'research', url: 'https://www.sfu.ca/fas/computing/research/' },
      {
        kind: 'doctoral',
        url: 'https://www.sfu.ca/fas/study/future-graduates/programs/phd-computing/',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Calgary',
    region: 'CA',
    allowedHosts: ['ucalgary.ca', 'science.ucalgary.ca', 'grad.ucalgary.ca'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://science.ucalgary.ca/departments-programs/departments',
      },
      {
        kind: 'faculty',
        url: 'https://science.ucalgary.ca/computer-science/contacts/faculty',
      },
      {
        kind: 'research',
        url: 'https://science.ucalgary.ca/computer-science/research/research-areas',
      },
      {
        kind: 'doctoral',
        url: 'https://grad.ucalgary.ca/future-students/graduate/discover-opportunities/explore-programs/computer-science-phd?page=1',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'National University of Singapore',
    region: 'SG',
    allowedHosts: ['nus.edu.sg', 'www.comp.nus.edu.sg'],
    seeds: [
      { kind: 'departments', url: 'https://www.comp.nus.edu.sg/about/depts/' },
      { kind: 'faculty', url: 'https://www.comp.nus.edu.sg/cs/people/' },
      { kind: 'research', url: 'https://www.comp.nus.edu.sg/cs/research/' },
      { kind: 'doctoral', url: 'https://www.comp.nus.edu.sg/programmes/pg/phdcs/' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Nanyang Technological University',
    region: 'SG',
    allowedHosts: ['ntu.edu.sg', 'www.ntu.edu.sg'],
    seeds: [
      { kind: 'departments', url: 'https://www.ntu.edu.sg/education/colleges-schools' },
      {
        kind: 'faculty',
        url: 'https://www.ntu.edu.sg/computing/computing-at-ntu/computing-faculty',
      },
      { kind: 'research', url: 'https://www.ntu.edu.sg/computing/research-groups' },
      {
        kind: 'doctoral',
        url: 'https://www.ntu.edu.sg/education/graduate-programme/ccds-phd-computing-datascience',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Singapore Management University',
    region: 'SG',
    allowedHosts: ['smu.edu.sg', 'www.smu.edu.sg', 'computing.smu.edu.sg'],
    seeds: [
      { kind: 'departments', url: 'https://computing.smu.edu.sg/' },
      {
        kind: 'faculty',
        url: 'https://computing.smu.edu.sg/people/full-time-faculty',
      },
      { kind: 'research', url: 'https://computing.smu.edu.sg/research' },
      { kind: 'doctoral', url: 'https://computing.smu.edu.sg/phd' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Singapore University of Technology and Design',
    region: 'SG',
    allowedHosts: ['sutd.edu.sg', 'www.sutd.edu.sg'],
    seeds: [
      { kind: 'departments', url: 'https://www.sutd.edu.sg/education/' },
      { kind: 'faculty', url: 'https://www.sutd.edu.sg/about/people/faculty' },
      { kind: 'research', url: 'https://www.sutd.edu.sg/research' },
      { kind: 'doctoral', url: 'https://www.sutd.edu.sg/admissions/graduate/phd/' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Tsinghua University',
    region: 'CN',
    allowedHosts: ['tsinghua.edu.cn', 'www.tsinghua.edu.cn', 'www.cs.tsinghua.edu.cn', 'yz.tsinghua.edu.cn'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.tsinghua.edu.cn/en/Schools___Departments.htm',
      },
      {
        kind: 'faculty',
        url: 'https://www.cs.tsinghua.edu.cn/csen/Faculty/Full_time_Faculty.htm',
      },
      { kind: 'research', url: 'https://www.cs.tsinghua.edu.cn/csen/Research.htm' },
      {
        kind: 'doctoral',
        url: 'https://yz.tsinghua.edu.cn/en/Programs/Doctoral_Degrees.htm',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Peking University',
    region: 'CN',
    allowedHosts: ['pku.edu.cn', 'english.pku.edu.cn', 'cs.pku.edu.cn'],
    seeds: [
      { kind: 'departments', url: 'https://english.pku.edu.cn/about.html' },
      {
        kind: 'faculty',
        url: 'https://cs.pku.edu.cn/English/People/Faculty/By_Last_Name/ALL.htm',
      },
      {
        kind: 'research',
        url: 'https://cs.pku.edu.cn/English/Research/Institutes.htm',
      },
      { kind: 'doctoral', url: 'https://cs.pku.edu.cn/English/Admission/Graduate.htm' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
];
