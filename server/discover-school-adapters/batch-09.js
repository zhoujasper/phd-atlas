const VERIFIED_AT = '2026-07-22';

const PATH_HINTS = Object.freeze({
  faculty: ['faculty', 'people', 'staff', 'profile', 'professor', 'researcher'],
  lab: ['lab', 'labs', 'laboratory', 'group', 'groups', 'centre', 'center', 'research'],
  department: ['department', 'departments', 'faculty', 'faculties', 'school', 'schools', 'institute', 'unit'],
  program: ['phd', 'doctoral', 'doctorate', 'graduate', 'program', 'programme', 'admission'],
});

export const SCHOOL_ADAPTERS_BATCH_09 = [
  {
    school: 'Shanghai Jiao Tong University',
    region: 'CN',
    allowedHosts: ['sjtu.edu.cn', 'en.sjtu.edu.cn', 'cs.sjtu.edu.cn'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://en.sjtu.edu.cn/about-us/our-story/schools-colleges',
      },
      { kind: 'faculty', url: 'https://cs.sjtu.edu.cn/cse/en/S.aspx' },
      {
        kind: 'research',
        url: 'https://en.sjtu.edu.cn/about-us/our-story/institutes-centers',
      },
      { kind: 'doctoral', url: 'https://cs.sjtu.edu.cn/cse/en/PhD.aspx' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Zhejiang University',
    region: 'CN',
    allowedHosts: ['zju.edu.cn', 'www.zju.edu.cn', 'iczu.zju.edu.cn'],
    seeds: [
      { kind: 'departments', url: 'https://www.zju.edu.cn/english/74913/list.psp' },
      { kind: 'faculty', url: 'https://www.zju.edu.cn/english/74900/list.htm' },
      { kind: 'research', url: 'https://www.zju.edu.cn/english/74908/main.psp' },
      {
        kind: 'doctoral',
        url: 'https://iczu.zju.edu.cn/admissionsen/woctoralwwegreewwrograms/list.htm',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Fudan University',
    region: 'CN',
    allowedHosts: [
      'fudan.edu.cn',
      'www.fudan.edu.cn',
      'phys.fudan.edu.cn',
      'www.fdsm.fudan.edu.cn',
    ],
    seeds: [
      { kind: 'departments', url: 'https://www.fudan.edu.cn/en/142/list.htm' },
      { kind: 'faculty', url: 'https://phys.fudan.edu.cn/eng/faculty/list.htm' },
      { kind: 'research', url: 'https://www.fudan.edu.cn/en/143/list.htm' },
      {
        kind: 'doctoral',
        url: 'https://www.fdsm.fudan.edu.cn/en/programs/graduate.html',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'University of Science and Technology of China',
    region: 'CN',
    allowedHosts: [
      'ustc.edu.cn',
      'en.ustc.edu.cn',
      'en.cs.ustc.edu.cn',
      'oic.ustc.edu.cn',
    ],
    seeds: [
      { kind: 'departments', url: 'https://en.ustc.edu.cn/Schools.htm' },
      { kind: 'faculty', url: 'https://en.cs.ustc.edu.cn/Professor/list.htm' },
      {
        kind: 'research',
        url: 'https://en.ustc.edu.cn/Research/RESEARCH1/RESEARCH_INSTITUTIONS.htm',
      },
      {
        kind: 'doctoral',
        url: 'https://oic.ustc.edu.cn/en/student/school-and-graduate-degree-program-list/',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Nanjing University',
    region: 'CN',
    allowedHosts: ['nju.edu.cn', 'www.nju.edu.cn', 'cs.nju.edu.cn', 'njunju.nju.edu.cn'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.nju.edu.cn/en/Institutions/Schools_Departments.htm',
      },
      { kind: 'faculty', url: 'https://cs.nju.edu.cn/cs_en/Professors/list.htm' },
      { kind: 'research', url: 'https://cs.nju.edu.cn/cs_en/52963/list.htm' },
      {
        kind: 'doctoral',
        url: 'https://njunju.nju.edu.cn/EN/7c/ee/c7084a163054/page.htm',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The University of Hong Kong',
    region: 'HK',
    allowedHosts: ['hku.hk', 'www.hku.hk', 'cs.hku.hk', 'gradsch.hku.hk'],
    seeds: [
      { kind: 'departments', url: 'https://www.hku.hk/faculties/' },
      { kind: 'faculty', url: 'https://cs.hku.hk/people/academic-staff' },
      { kind: 'research', url: 'https://cs.hku.hk/research/research-groups' },
      {
        kind: 'doctoral',
        url: 'https://gradsch.hku.hk/prospective_students/programmes/doctor_of_philosophy',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'The Chinese University of Hong Kong',
    region: 'HK',
    allowedHosts: [
      'cuhk.edu.hk',
      'www.cuhk.edu.hk',
      'cse.cuhk.edu.hk',
      'www.cse.cuhk.edu.hk',
      'gs.cuhk.edu.hk',
      'www.gs.cuhk.edu.hk',
    ],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.cuhk.edu.hk/english/faculties/faculty-graduate-school.html',
      },
      { kind: 'faculty', url: 'https://www.cse.cuhk.edu.hk/people/faculty/' },
      {
        kind: 'research',
        url: 'https://www.cse.cuhk.edu.hk/research/research-centre-laboratory/',
      },
      {
        kind: 'doctoral',
        url: 'https://www.gs.cuhk.edu.hk/programmes/engineering/mphil-phd-computer-science-and-engineering',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Hong Kong University of Science and Technology',
    region: 'HK',
    allowedHosts: ['hkust.edu.hk', 'www.hkust.edu.hk', 'cse.hkust.edu.hk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://hkust.edu.hk/directory/academic-departments',
      },
      { kind: 'faculty', url: 'https://cse.hkust.edu.hk/admin/people/faculty/' },
      { kind: 'research', url: 'https://cse.hkust.edu.hk/pg/research/labs/' },
      { kind: 'doctoral', url: 'https://cse.hkust.edu.hk/pg/admissions/' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'City University of Hong Kong',
    region: 'HK',
    allowedHosts: ['cityu.edu.hk', 'www.cityu.edu.hk', 'cs.cityu.edu.hk', 'www.cs.cityu.edu.hk'],
    seeds: [
      {
        kind: 'departments',
        url: 'https://www.cs.cityu.edu.hk/en/about-us/department',
      },
      { kind: 'faculty', url: 'https://www.cs.cityu.edu.hk/people/academic-staff' },
      {
        kind: 'research',
        url: 'https://www.cs.cityu.edu.hk/en/research/research-areas/research-areas-overview',
      },
      {
        kind: 'doctoral',
        url: 'https://www.cs.cityu.edu.hk/academic-programmes/master-philosophy-doctor-philosophy/aims',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Tongji University',
    region: 'CN',
    allowedHosts: ['tongji.edu.cn', 'see-en.tongji.edu.cn'],
    seeds: [
      { kind: 'departments', url: 'https://see-en.tongji.edu.cn/about_Us/Departments.htm' },
      { kind: 'faculty', url: 'https://see-en.tongji.edu.cn/faculty/By_A_Z.htm' },
      { kind: 'research', url: 'https://see-en.tongji.edu.cn/research/Laboratories.htm' },
      { kind: 'doctoral', url: 'https://see-en.tongji.edu.cn/programs/PhD_Programs.htm' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Wuhan University',
    region: 'CN',
    allowedHosts: ['whu.edu.cn', 'en.whu.edu.cn'],
    seeds: [
      { kind: 'departments', url: 'https://en.whu.edu.cn/About/Schools___Departments.htm' },
      { kind: 'faculty', url: 'https://en.whu.edu.cn/Faculty.htm' },
      { kind: 'research', url: 'https://en.whu.edu.cn/Research/Research_Entities.htm' },
      {
        kind: 'doctoral',
        url: 'https://en.whu.edu.cn/jzbf/yl/Postgraduate_Education/Doctoral_Degree_Programs.htm',
      },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Harbin Institute of Technology',
    region: 'CN',
    allowedHosts: ['hit.edu.cn', 'en.hit.edu.cn', 'homepage.hit.edu.cn'],
    seeds: [
      { kind: 'departments', url: 'https://en.hit.edu.cn/11939/list.htm' },
      { kind: 'faculty', url: 'https://homepage.hit.edu.cn/home-index?lang=en' },
      { kind: 'research', url: 'https://en.hit.edu.cn/11961/list.htm' },
      { kind: 'doctoral', url: 'https://en.hit.edu.cn/11958/list.htm' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
  {
    school: 'Australian National University',
    region: 'AU',
    allowedHosts: ['anu.edu.au', 'www.anu.edu.au', 'comp.anu.edu.au'],
    seeds: [
      { kind: 'departments', url: 'https://www.anu.edu.au/about/academic-colleges' },
      { kind: 'faculty', url: 'https://comp.anu.edu.au/people/' },
      { kind: 'research', url: 'https://comp.anu.edu.au/research/' },
      { kind: 'doctoral', url: 'https://comp.anu.edu.au/study/research/' },
    ],
    pathHints: PATH_HINTS,
    verifiedAt: VERIFIED_AT,
  },
];
