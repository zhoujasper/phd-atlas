import { describe, expect, it } from 'vitest'
import {
  groundDiscoverPrograms,
  isGenericProgramLabel,
  isOfficialSchoolUrl,
} from './discover-source-grounding.js'
import { attachScholarlyEvidence, collectScholarlyEvidence } from './discover-scholarly-data.js'

const sourceIndex = {
  schools: [{
    school: 'Example University',
    region: 'US',
    officialUrl: 'https://www.example.edu',
    programPages: [
      { url: 'https://www.example.edu/cs/phd', types: ['program'], fetched: true },
      { url: 'https://www.example.edu/graduate/admissions', types: ['program', 'admissions'], fetched: true },
    ],
    advisorPages: [{
      url: 'https://www.example.edu/cs/people/ada-lovelace',
      title: 'Ada Lovelace | Computer Science',
      types: ['advisor'],
      fetched: true,
    }],
  }],
}

describe('Discover official-source grounding', () => {
  it('rejects university-wide and placeholder labels as non-programmes', () => {
    for (const label of [
      'Find a Program',
      'Find Your PhD',
      'Doctoral Degrees',
      'PhD',
      'PhD programme at DTU',
      'Doctoral study at the University of Copenhagen',
      'Postgraduate research programmes and Centres for Doctoral Training',
      'Postgraduate Admissions | HKUST CSE',
      'PhD Programmes',
      'PhD Programme',
      'Ph.D. Programs | UCI',
      'PhD Admissions',
      'PhD research at UvA',
      'Research Degrees in Computer Science',
      'Research programmes',
      'Guide to doctoral studies at LMU',
      'Admission',
      'Program Information & Deadlines',
      'About doctoral studies',
      'PhD at the University of Copenhagen',
      'Doctorate at TUM',
      'Get a PhD education at DTU',
      'Guide to applying for doctoral studies',
      'Doctor of Philosophy (Ph.D.) Programs',
      'Doctor of Philosophy (Ph.D.) Programs - UC Irvine Donald Bren School of Information & Computer Sciences',
      'Postgraduate Research home | PhD and Research Degrees | University of Exeter',
      'Postgraduate Student Early Recruiting',
      'Doctoral programmes in Computer Science',
      'NQCP',
      'Doctor of Philosophy',
      'Page not found',
      'Postgraduate Research',
      'Postgraduate research opportunities in Computer Science',
      'Master of Quantum Science and Technology',
      'MSc Computer Science',
      'MPhil in Computer Science',
      'Bachelor of Science in Computer Science',
      'Undergraduate Computer Science',
      'not found',
    ]) expect(isGenericProgramLabel(label)).toBe(true)
    expect(isGenericProgramLabel('PhD in Computer Science')).toBe(false)
    expect(isGenericProgramLabel('PhD Program in Computer Science')).toBe(false)
    expect(isGenericProgramLabel('Doctoral Program in Computer Science')).toBe(false)
    expect(isGenericProgramLabel('Doctoral Programme in Quantum Science and Technology')).toBe(false)
    expect(isGenericProgramLabel('Scalable Verification for Quantum Systems')).toBe(false)
    expect(isGenericProgramLabel('MPhil-PhD in Computer Science')).toBe(false)
  })

  it('rejects the broad and wrong-degree official pages exposed by the live Lingsuan run', () => {
    const leakedPages = [
      {
        id: 'ucla_master',
        school: 'University of California, Los Angeles',
        officialUrl: 'https://grad.ucla.edu/',
        url: 'https://grad.ucla.edu/programs/physical-sciences/physics-and-astronomy-department/master-of-quantum-science-and-technology/',
        title: 'Master of Quantum Science and Technology',
        candidate: 'PhD in Quantum Science and Technology',
        excerpt: 'A professional master degree. Related research navigation also links to PhD opportunities.',
      },
      {
        id: 'ustc_admission',
        school: 'University of Science and Technology of China',
        officialUrl: 'https://oic.ustc.edu.cn/',
        url: 'https://oic.ustc.edu.cn/en/student/school-and-graduate-degree-program-list/',
        title: 'Admission',
        candidate: 'PhD in Computer Science',
        excerpt: 'University-wide graduate degree list, including doctoral study and Computer Science.',
      },
      {
        id: 'colorado_deadlines',
        school: 'University of Colorado Boulder',
        officialUrl: 'https://www.colorado.edu/',
        url: 'https://www.colorado.edu/graduateschool/admissions/where-begin/program-information-deadlines',
        title: 'Program Information & Deadlines',
        candidate: 'PhD in Computer Science',
        excerpt: 'Search deadlines for graduate programmes, including Computer Science PhD study.',
      },
      {
        id: 'chalmers_overview',
        school: 'Chalmers University of Technology',
        officialUrl: 'https://www.chalmers.se/',
        url: 'https://www.chalmers.se/en/research/we-train-new-researchers/about-doctoral-studies/',
        title: 'About doctoral studies',
        candidate: 'PhD in Computer Science',
        excerpt: 'Institution-wide information about doctoral studies and Computer Science research.',
      },
      {
        id: 'copenhagen_overview',
        school: 'University of Copenhagen',
        officialUrl: 'https://phd.ku.dk/',
        url: 'https://phd.ku.dk/english/',
        title: 'PhD at the University of Copenhagen',
        candidate: 'PhD in Computer Science',
        excerpt: 'General PhD information across the university, including Computer Science.',
      },
      {
        id: 'tum_overview',
        school: 'Technical University of Munich',
        officialUrl: 'https://www.tum.de/',
        url: 'https://www.tum.de/en/about-tum/careers-and-jobs/doctorate',
        title: 'Doctorate at TUM',
        candidate: 'PhD in Computer Science',
        excerpt: 'General doctorate guidance and links to Computer Science research.',
      },
      {
        id: 'lmu_guide',
        school: 'Ludwig Maximilian University of Munich',
        officialUrl: 'https://www.lmu.de/',
        url: 'https://www.lmu.de/en/study/degree-students/applications-for-admission/guidelines-and-faqs/guide-to-applying-for-doctoral-studies/',
        title: 'Guide to applying for doctoral studies',
        candidate: 'PhD in Computer Science',
        excerpt: 'University-wide application guidance mentioning Computer Science doctoral study.',
      },
      {
        id: 'uci_directory',
        school: 'University of California, Irvine',
        officialUrl: 'https://ics.uci.edu/',
        url: 'https://ics.uci.edu/academics/graduate-programs/graduate-research-phd-programs/',
        title: 'Doctor of Philosophy (Ph.D.) Programs',
        candidate: 'PhD in Computer Science',
        excerpt: 'Directory of several PhD programs, including Computer Science and other disciplines.',
      },
      {
        id: 'dtu_overview',
        school: 'Technical University of Denmark',
        officialUrl: 'https://www.dtu.dk/',
        url: 'https://www.dtu.dk/english/education/phd',
        title: 'Get a PhD education at DTU',
        candidate: 'Get a PhD education at DTU',
        excerpt: 'Institution-wide PhD overview with links to Computer Science and other departments.',
        expectedReason: 'generic-program-label',
      },
      {
        id: 'dtu_intro',
        school: 'Technical University of Denmark',
        officialUrl: 'https://www.dtu.dk/',
        url: 'https://www.dtu.dk/english/education/phd/intro',
        title: 'PhD programme at DTU',
        candidate: 'PhD in Computer Science',
        excerpt: 'Institution-wide PhD overview with links to Computer Science and other departments.',
      },
    ]

    for (const fixture of leakedPages) {
      const page = {
        url: fixture.url,
        title: fixture.title,
        label: fixture.title,
        types: ['program', 'admissions'],
        declaredKinds: ['doctoral'],
        excerpt: fixture.excerpt,
        fetched: true,
      }
      const result = groundDiscoverPrograms([{
        id: fixture.id,
        school: fixture.school,
        program: fixture.candidate,
        website: fixture.url,
        sources: [fixture.url],
      }], {
        schools: [{
          school: fixture.school,
          officialUrl: fixture.officialUrl,
          crawlStatus: 'ok',
          pages: [page],
          programPages: [page],
          admissionsPages: [page],
        }],
      })

      expect(result.programs, fixture.id).toEqual([])
      expect(result.rejected, fixture.id).toEqual([{
        id: fixture.id,
        reason: fixture.expectedReason || 'program-identity-not-specific',
      }])
    }
  })

  it('keeps a specific combined MPhil-PhD programme while rejecting MPhil-only pages', () => {
    const combinedUrl = 'https://www.example.edu/graduate/mphil-phd-computer-science'
    const mphilOnlyUrl = 'https://www.example.edu/graduate/mphil-computer-science'
    const combinedPage = {
      url: combinedUrl,
      title: 'MPhil-PhD in Computer Science',
      label: 'MPhil-PhD in Computer Science',
      types: ['program'],
      declaredKinds: ['doctoral'],
      excerpt: 'An integrated MPhil and PhD doctoral programme in Computer Science.',
      fetched: true,
    }
    const mphilOnlyPage = {
      url: mphilOnlyUrl,
      title: 'MPhil in Computer Science',
      types: ['program'],
      excerpt: 'Master of Philosophy programme. Related links include PhD study.',
      fetched: true,
    }
    const result = groundDiscoverPrograms([
      {
        id: 'combined_mphil_phd',
        school: 'Example University',
        program: 'MPhil-PhD in Computer Science',
        website: combinedUrl,
        sources: [combinedUrl],
      },
      {
        id: 'mphil_only',
        school: 'Example University',
        program: 'MPhil in Computer Science',
        website: mphilOnlyUrl,
        sources: [mphilOnlyUrl],
      },
    ], {
      schools: [{
        school: 'Example University',
        officialUrl: 'https://www.example.edu/',
        pages: [combinedPage, mphilOnlyPage],
        programPages: [combinedPage, mphilOnlyPage],
      }],
    })

    expect(result.programs.map((program) => program.id)).toEqual(['combined_mphil_phd'])
    expect(result.rejected).toContainEqual({ id: 'mphil_only', reason: 'generic-program-label' })
  })

  it('requires degree identity in the title or URL instead of trusting a declared doctoral bucket', () => {
    const genericUrl = 'https://www.cs.ox.ac.uk/admissions/graduate/'
    const genericPage = {
      url: genericUrl,
      title: 'Department of Computer Science, University of Oxford',
      types: ['admissions', 'program', 'research'],
      declaredKinds: ['doctoral', 'research'],
      excerpt: 'Graduate admissions information includes DPhil study.',
      fetched: true,
    }
    const result = groundDiscoverPrograms([{
      id: 'oxford-generic-graduate-page',
      school: 'University of Oxford',
      program: 'DPhil in Computer Science',
      website: genericUrl,
      sources: [genericUrl],
    }], {
      schools: [{
        school: 'University of Oxford',
        officialUrl: 'https://www.ox.ac.uk/',
        allowedHosts: ['cs.ox.ac.uk'],
        pages: [genericPage],
        programPages: [genericPage],
        admissionsPages: [genericPage],
      }],
    })

    expect(result.programs).toEqual([])
    expect(result.rejected).toEqual([{
      id: 'oxford-generic-graduate-page',
      reason: 'program-identity-not-specific',
    }])
  })

  it('drops research-area and generic admissions URLs while retaining the exact UBC PhD page', () => {
    const researchAreaUrl = 'https://www.cs.ubc.ca/cs-research/research-area/program-analysis-verification'
    const admissionsUrl = 'https://www.cs.ubc.ca/admission'
    const exactUrl = 'https://www.grad.ubc.ca/prospective-students/graduate-degree-programs/phd-computer-science'
    const pages = [
      {
        url: researchAreaUrl,
        title: 'Program Analysis & Verification | Computer Science at UBC',
        types: ['research', 'program', 'admissions'],
        declaredKinds: ['doctoral'],
        fetched: true,
      },
      {
        url: admissionsUrl,
        title: 'Admission Processes | Computer Science at UBC',
        types: ['admissions', 'program'],
        declaredKinds: ['doctoral'],
        fetched: true,
      },
      {
        url: exactUrl,
        title: 'Doctor of Philosophy in Computer Science (PhD) | Graduate School at UBC',
        types: ['program', 'admissions', 'research'],
        declaredKinds: ['doctoral', 'research'],
        fetched: true,
      },
    ]
    const result = groundDiscoverPrograms([{
      id: 'ubc-cs-phd',
      school: 'University of British Columbia',
      program: 'Computer Science PhD',
      website: researchAreaUrl,
      sources: [researchAreaUrl, admissionsUrl, exactUrl],
    }], {
      schools: [{
        school: 'University of British Columbia',
        officialUrl: 'https://www.ubc.ca/',
        allowedHosts: ['cs.ubc.ca', 'grad.ubc.ca'],
        pages,
        programPages: pages,
        admissionsPages: pages,
      }],
    })

    expect(result.rejected).toEqual([])
    expect(result.programs).toHaveLength(1)
    expect(result.programs[0].website).toBe(exactUrl)
    expect(result.programs[0].sources).toEqual([exactUrl])
  })

  it('requires an indexed programme page to have been fetched', () => {
    const programUrl = 'https://www.example.edu/cs/phd'
    const result = groundDiscoverPrograms([{
      id: 'unfetched_program',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        programPages: [{ url: programUrl, types: ['program'], fetched: false }],
      }],
    })

    expect(result.programs).toEqual([])
    expect(result.rejected).toEqual([{
      id: 'unfetched_program',
      reason: 'no-program-specific-official-source',
    }])
  })

  it('rejects a URL when any indexed evidence bucket marks it as injected', () => {
    const programUrl = 'https://www.example.edu/cs/phd'
    const result = groundDiscoverPrograms([{
      id: 'cross_bucket_poison',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{
          url: `${programUrl}?utm_source=poisoned-copy`,
          types: ['program'],
          fetched: true,
          promptInjectionSuspected: true,
        }],
        programPages: [{ url: programUrl, types: ['program'], fetched: true }],
      }],
    })

    expect(result.programs).toEqual([])
    expect(result.rejected[0]?.reason).toBe('no-program-specific-official-source')
  })

  it('deduplicates programme sources by canonical URL', () => {
    const result = groundDiscoverPrograms([{
      id: 'canonical_sources',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: [
        'https://www.example.edu/cs/phd?utm_source=newsletter',
        'https://example.edu/cs/phd#overview',
      ],
    }], sourceIndex)

    expect(result.programs[0].sources).toHaveLength(1)
  })

  it('rejects prompt-injection-marked programme and advisor pages', () => {
    const poisonedProgram = 'https://www.example.edu/cs/poisoned-phd'
    const poisonedAdvisor = 'https://www.example.edu/cs/people/poisoned-person'
    const poisonedIndex = {
      schools: [{
        ...sourceIndex.schools[0],
        programPages: [{ url: poisonedProgram, fetched: true, promptInjectionSuspected: true }],
        advisorPages: [{
          url: poisonedAdvisor,
          title: 'Poisoned Person | Computer Science',
          fetched: true,
          promptInjectionSuspected: true,
        }],
      }],
    }
    const result = groundDiscoverPrograms([{
      id: 'poisoned',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: poisonedProgram,
      sources: [poisonedProgram],
      pis: [{ name: 'Poisoned Person', url: poisonedAdvisor }],
    }], poisonedIndex, { allowedEvidenceUrls: [poisonedProgram, poisonedAdvisor] })

    expect(result.programs).toHaveLength(0)
    expect(result.rejected).toEqual([{ id: 'poisoned', reason: 'no-program-specific-official-source' }])
  })

  it('accepts a different official university subdomain but not a lookalike domain', () => {
    const mitIndex = {
      schools: [{
        school: 'Massachusetts Institute of Technology', region: 'US', officialUrl: 'https://oge.mit.edu',
        allowedHosts: ['mit.edu'],
        programPages: [{
          url: 'https://www.eecs.mit.edu/academics/graduate-programs/',
          title: 'EECS PhD Program',
          types: ['program'],
          fetched: true,
        }],
        advisorPages: [],
      }],
    }
    const result = groundDiscoverPrograms([
      {
        id: 'mit_eecs', school: 'MIT', program: 'EECS PhD',
        website: 'https://www.eecs.mit.edu/academics/graduate-programs/',
        sources: ['https://www.eecs.mit.edu/academics/graduate-programs/'],
      },
      {
        id: 'lookalike', school: 'MIT', program: 'Unverified PhD',
        website: 'https://mit.edu.example.com/phd', sources: ['https://mit.edu.example.com/phd'],
      },
    ], mitIndex)

    expect(result.programs.map((program) => program.id)).toEqual(['mit_eecs'])
    expect(result.rejected).toEqual([{ id: 'lookalike', reason: 'no-program-specific-official-source' }])
  })

  it('accepts an explicitly curated alternate school host and rejects suffix lookalikes', () => {
    const alternateIndex = {
      schools: [{
        school: 'Example University',
        region: 'US',
        officialUrl: 'https://www.example.edu',
        allowedHosts: ['example.edu', 'doctoral.example-research.org'],
        programPages: [{
          url: 'https://doctoral.example-research.org/programs/phd',
          title: 'Computer Science PhD',
          types: ['program'],
          fetched: true,
        }],
        advisorPages: [],
      }],
    }
    const result = groundDiscoverPrograms([
      {
        id: 'alternate_host', school: 'Example University', program: 'Computer Science PhD',
        website: 'https://doctoral.example-research.org/programs/phd',
        sources: ['https://doctoral.example-research.org/programs/phd'],
      },
      {
        id: 'alternate_lookalike', school: 'Example University', program: 'Computer Science PhD',
        website: 'https://doctoral.example-research.org.evil.example/programs/phd',
        sources: ['https://doctoral.example-research.org.evil.example/programs/phd'],
      },
    ], alternateIndex)

    expect(result.programs.map((program) => program.id)).toEqual(['alternate_host'])
    expect(result.rejected).toEqual([{ id: 'alternate_lookalike', reason: 'no-program-specific-official-source' }])
  })

  it('does not expand trust across consortium members or shared-hosting tenants', () => {
    expect(isOfficialSchoolUrl('https://dauphine.psl.eu/formations/doctorat', {
      school: 'École normale supérieure',
      officialUrl: 'https://www.ens.psl.eu/',
      allowedHosts: ['ens.psl.eu'],
    })).toBe(false)
    expect(isOfficialSchoolUrl('https://attacker.github.io/phd', {
      school: 'Example University',
      officialUrl: 'https://school.github.io/',
      allowedHosts: ['school.github.io'],
    })).toBe(false)
  })

  it('keeps only program records with a same-university official source and grounds PI pages', () => {
    const result = groundDiscoverPrograms([
      {
        id: 'example_cs',
        school: 'Example University',
        program: 'Computer Science PhD',
        website: 'https://www.example.edu/cs/phd',
        sources: [
          'https://www.example.edu/cs/phd',
          'https://www.example.edu/graduate/admissions',
          'https://other.example/program',
        ],
        pis: [{ name: 'Ada Lovelace', research: 'Algorithms', whyFit: 'Theory', recruiting: 'Open' }],
      },
      {
        id: 'wrong_domain',
        school: 'Example University',
        program: 'Unverified PhD',
        website: 'https://other.example/program',
        sources: ['https://other.example/program'],
      },
    ], sourceIndex)

    expect(result.programs).toHaveLength(1)
    expect(result.programs[0]).toMatchObject({
      school: 'Example University',
      website: 'https://www.example.edu/cs/phd',
      verification: { status: 'verified', officialSourceCount: 1, advisorSourceCount: 1 },
    })
    expect(result.programs[0].sources).toEqual(['https://www.example.edu/cs/phd'])
    expect(result.programs[0].pis[0].url).toBe('https://www.example.edu/cs/people/ada-lovelace')
    expect(result.rejected).toEqual([{ id: 'wrong_domain', reason: 'no-program-specific-official-source' }])
  })

  it('rejects generic opportunity labels even when they cite an official domain', () => {
    const result = groundDiscoverPrograms([{
      id: 'generic_program',
      school: 'Example University',
      program: 'PhD opportunity in Quantum Computing',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      pis: [],
    }], sourceIndex)

    expect(result.programs).toHaveLength(0)
    expect(result.rejected).toEqual([{ id: 'generic_program', reason: 'generic-program-label' }])
  })

  it('rejects a university homepage because it is not programme-specific evidence', () => {
    const result = groundDiscoverPrograms([{
      id: 'homepage_only',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/',
      sources: ['https://www.example.edu/'],
      pis: [],
    }], sourceIndex)

    expect(result.programs).toHaveLength(0)
    expect(result.rejected).toEqual([{ id: 'homepage_only', reason: 'no-program-specific-official-source' }])
  })

  it('rejects a fetched news page whose URL merely contains programme keywords', () => {
    const newsUrl = 'https://www.example.edu/news/new-phd-program-launch'
    const result = groundDiscoverPrograms([{
      id: 'news_as_program',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: newsUrl,
      sources: [newsUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{
          url: newsUrl,
          title: 'New Computer Science PhD program launch',
          types: ['program'],
          fetched: true,
        }],
        programPages: [{
          url: newsUrl,
          title: 'New Computer Science PhD program launch',
          types: ['program'],
          fetched: true,
        }],
        admissionsPages: [],
        researchPages: [{
          url: newsUrl,
          title: 'New Computer Science PhD program launch',
          types: ['research'],
          fetched: true,
        }],
      }],
    }, { allowedEvidenceUrls: [newsUrl] })

    expect(result.programs).toEqual([])
    expect(result.rejected[0]?.reason).toBe('no-program-specific-official-source')
  })

  it('does not let a general admissions page prove an invented subject programme', () => {
    const admissionsUrl = 'https://www.example.edu/graduate/admissions'
    const result = groundDiscoverPrograms([{
      id: 'invented_subject',
      school: 'Example University',
      program: 'Quantum Robotics PhD',
      website: admissionsUrl,
      sources: [admissionsUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{ url: admissionsUrl, title: 'Graduate Admissions', types: ['admissions'], fetched: true }],
        programPages: [],
        admissionsPages: [{ url: admissionsUrl, title: 'Graduate Admissions', types: ['admissions'], fetched: true }],
      }],
    }, { allowedEvidenceUrls: [admissionsUrl] })

    expect(result.programs).toEqual([])
  })

  it('does not let a same-subject undergraduate page prove a doctoral programme', () => {
    const undergraduateUrl = 'https://www.example.edu/undergraduate/computer-science'
    const result = groundDiscoverPrograms([{
      id: 'wrong_degree_level',
      school: 'Example University',
      program: 'PhD in Computer Science',
      website: undergraduateUrl,
      sources: [undergraduateUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{
          url: undergraduateUrl,
          title: 'BSc Computer Science',
          excerpt: 'Undergraduate Bachelor of Science course.',
          types: ['program'],
          fetched: true,
        }],
        programPages: [{
          url: undergraduateUrl,
          title: 'BSc Computer Science',
          types: ['program'],
          fetched: true,
        }],
      }],
    }, { allowedEvidenceUrls: [undergraduateUrl] })

    expect(result.programs).toEqual([])
  })

  it('does not let an MSc page navigation link self-certify a PhD programme', () => {
    const mastersUrl = 'https://www.example.edu/masters/computer-science'
    const result = groundDiscoverPrograms([{
      id: 'masters_navigation_leak',
      school: 'Example University',
      program: 'PhD in Computer Science',
      website: mastersUrl,
      sources: [mastersUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{
          url: mastersUrl,
          title: 'MSc Computer Science',
          excerpt: 'Master of Science course. Related links: PhD programmes.',
          types: ['program'],
          fetched: true,
        }],
        programPages: [{
          url: mastersUrl,
          title: 'MSc Computer Science',
          types: ['program'],
          fetched: true,
        }],
      }],
    }, { allowedEvidenceUrls: [mastersUrl] })

    expect(result.programs).toEqual([])
  })

  it('rejects compound news paths even when the crawler inferred a programme type', () => {
    const newsUrl = 'https://www.example.edu/news-and-events/computer-science-phd-launch'
    const page = {
      url: newsUrl,
      title: 'Computer Science PhD launch',
      types: ['program'],
      fetched: true,
    }
    const result = groundDiscoverPrograms([{
      id: 'compound_news_path',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: newsUrl,
      sources: [newsUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [page],
        programPages: [page],
      }],
    }, { allowedEvidenceUrls: [newsUrl] })

    expect(result.programs).toEqual([])
  })

  it('never promotes an advisor biography into programme evidence', () => {
    const bioUrl = 'https://www.example.edu/bio/ada-lovelace'
    const page = {
      url: bioUrl,
      title: 'Ada Lovelace biography',
      excerpt: 'Professor Lovelace supervises students in the Computer Science PhD.',
      types: ['advisor', 'program'],
      fetched: true,
      individualAdvisor: false,
    }
    const result = groundDiscoverPrograms([{
      id: 'bio_as_program',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: bioUrl,
      sources: [bioUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [page],
        advisorPages: [page],
        programPages: [page],
      }],
    }, { allowedEvidenceUrls: [bioUrl] })

    expect(result.programs).toEqual([])
  })

  it('does not confuse a faculty-of-science programme path with a people directory', () => {
    const programUrl = 'https://www.example.edu/faculty-of-science/study/phd-computer-science'
    const result = groundDiscoverPrograms([{
      id: 'faculty_of_science',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        programPages: [{
          url: programUrl,
          title: 'PhD in Computer Science',
          types: ['program'],
          fetched: true,
        }],
      }],
    })

    expect(result.programs.map((program) => program.id)).toEqual(['faculty_of_science'])
  })

  it('allows an explicit doctoral programme nested under an academic faculty path', () => {
    const programUrl = 'https://www.example.edu/faculty/engineering/study/phd-computer-science'
    const result = groundDiscoverPrograms([{
      id: 'academic_faculty_path',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{
          url: programUrl,
          title: 'PhD in Computer Science',
          types: ['program'],
          fetched: true,
          individualAdvisor: false,
        }],
        programPages: [{
          url: programUrl,
          title: 'PhD in Computer Science',
          types: ['program'],
          fetched: true,
          individualAdvisor: false,
        }],
      }],
    })

    expect(result.programs.map((program) => program.id)).toEqual(['academic_faculty_path'])
  })

  it('does not accept a faculty directory as an individual advisor profile', () => {
    const result = groundDiscoverPrograms([{
      id: 'directory_pi',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      pis: [{ name: 'Grace Hopper', url: 'https://www.example.edu/cs/faculty', recruiting: 'accepting' }],
    }], sourceIndex)

    expect(result.programs).toHaveLength(1)
    expect(result.programs[0].pis).toEqual([])
    expect(result.programs[0].verification.status).toBe('partial')
  })

  it('does not accept a directory row whose page title happens to contain the advisor name', () => {
    const directoryUrl = 'https://www.example.edu/cs/faculty-directory'
    const result = groundDiscoverPrograms([{
      id: 'named_directory_pi',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      pis: [{ name: 'Grace Hopper', url: directoryUrl }],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        advisorPages: [{
          url: directoryUrl,
          title: 'Grace Hopper | Faculty Directory',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: false,
        }],
      }],
    })

    expect(result.programs[0].pis).toEqual([])
  })

  it('does not accept a fetched news story as an individual advisor profile', () => {
    const newsUrl = 'https://www.example.edu/news/ada-lovelace-award'
    const result = groundDiscoverPrograms([{
      id: 'news_pi',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      pis: [{
        name: 'Ada Lovelace',
        url: newsUrl,
        email: 'invented@example.edu',
        recruiting: 'Accepting students now',
      }],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{ url: newsUrl, title: 'Ada Lovelace wins an award', types: ['advisor'], fetched: true }],
        advisorPages: [{
          url: newsUrl,
          title: 'Ada Lovelace wins an award',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: false,
        }],
      }],
    }, { allowedEvidenceUrls: ['https://www.example.edu/cs/phd', newsUrl] })

    expect(result.programs[0].pis).toEqual([])
  })

  it('retains advisor email and recruiting claims only when the fetched profile text supports them', () => {
    const advisorUrl = 'https://www.example.edu/cs/people/ada-lovelace'
    const supportedIndex = {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{
          url: advisorUrl,
          title: 'Ada Lovelace',
          excerpt: 'Contact ada@example.edu. I am recruiting PhD students for the next intake.',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: true,
        }],
        advisorPages: [{
          url: advisorUrl,
          title: 'Ada Lovelace',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: true,
        }],
      }],
    }
    const candidate = {
      id: 'supported_pi_claims',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      pis: [{
        name: 'Ada Lovelace',
        url: advisorUrl,
        email: 'ada@example.edu',
        recruiting: 'Recruiting PhD students',
      }],
    }

    const supported = groundDiscoverPrograms([candidate], supportedIndex)
    expect(supported.programs[0].pis[0]).toMatchObject({
      email: 'ada@example.edu',
      recruiting: 'Recruiting PhD students',
    })

    const unsupported = groundDiscoverPrograms([{
      ...candidate,
      id: 'unsupported_pi_claims',
      pis: [{
        ...candidate.pis[0],
        email: 'invented@example.edu',
      }],
    }], supportedIndex)
    expect(unsupported.programs[0].pis[0].email).toBe('')

    const negativeIndex = {
      schools: [{
        ...supportedIndex.schools[0],
        pages: [{
          url: advisorUrl,
          title: 'Ada Lovelace',
          excerpt: 'We are not accepting PhD students at this time.',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: true,
        }],
      }],
    }
    const contradicted = groundDiscoverPrograms([{
      ...candidate,
      id: 'contradicted_recruiting_claim',
    }], negativeIndex)
    expect(contradicted.programs[0].pis[0].recruiting).toMatch(/^Not accepting PhD students/)

    const notLookingIndex = {
      schools: [{
        ...negativeIndex.schools[0],
        pages: [{
          url: advisorUrl,
          title: 'Ada Lovelace',
          excerpt: 'I am not looking for PhD students at this time.',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: true,
        }],
      }],
    }
    const notLooking = groundDiscoverPrograms([{
      ...candidate,
      id: 'not_looking_recruiting_claim',
    }], notLookingIndex)
    expect(notLooking.programs[0].pis[0].recruiting).toMatch(/^Not accepting PhD students/)
  })

  it('grounds Unicode programme and advisor names without ASCII-only loss', () => {
    const programUrl = 'https://example.edu/doctoral/computer-science'
    const advisorUrl = 'https://example.edu/people/zhang-wei'
    const result = groundDiscoverPrograms([{
      id: 'unicode_programme',
      school: '示例大学',
      program: '计算机科学博士',
      website: programUrl,
      sources: [programUrl],
      pis: [{ name: '张伟', url: advisorUrl }],
    }], {
      schools: [{
        school: '示例大学',
        region: 'CN',
        officialUrl: 'https://example.edu/',
        pages: [
          { url: programUrl, title: '计算机科学博士', types: ['program'], fetched: true },
          { url: advisorUrl, title: '张伟', types: ['advisor'], fetched: true, individualAdvisor: true },
        ],
        programPages: [{ url: programUrl, title: '计算机科学博士', types: ['program'], fetched: true }],
        advisorPages: [{
          url: advisorUrl,
          title: '张伟',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: true,
        }],
      }],
    })

    expect(result.programs[0]).toMatchObject({ program: '计算机科学博士' })
    expect(result.programs[0].pis[0]).toMatchObject({ name: '张伟', url: advisorUrl })
  })

  it('does not match short advisor names by substring collision', () => {
    const wrongAdvisorUrl = 'https://www.example.edu/cs/people/bob-lindsey'
    const result = groundDiscoverPrograms([{
      id: 'short_name_collision',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      pis: [{ name: 'Bo Li' }],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        advisorPages: [{
          url: wrongAdvisorUrl,
          title: 'Bob Lindsey',
          types: ['advisor'],
          fetched: true,
          individualAdvisor: true,
        }],
      }],
    })

    expect(result.programs[0].pis).toEqual([])
  })

  it('never accepts a person profile as the programme website even when the path mentions PhD', () => {
    const personUrl = 'https://www.example.edu/people/ada-lovelace/phd'
    const result = groundDiscoverPrograms([{
      id: 'person_as_program',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: personUrl,
      sources: [personUrl],
      pis: [],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        programPages: [{ url: personUrl, types: ['program', 'advisor'], fetched: true }],
      }],
    }, { allowedEvidenceUrls: [personUrl] })

    expect(result.programs).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('no-program-specific-official-source')
  })

  it('does not expand official trust from an unverified scholarly graph domain', () => {
    const result = groundDiscoverPrograms([{
      id: 'ror_domain',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://untrusted-research.example/programs/phd',
      sources: ['https://untrusted-research.example/programs/phd'],
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        scholarlyEvidence: { institution: { domains: ['untrusted-research.example'] } },
      }],
    })

    expect(result.programs).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('no-program-specific-official-source')
  })

  it('lets an authoritative verifier clear stale advisors with an explicit empty list', () => {
    const previous = {
      id: 'authoritative_pi',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      pis: [{ name: 'Ada Lovelace', url: 'https://www.example.edu/cs/people/ada-lovelace' }],
    }
    const raw = { ...previous, pis: [] }
    const retained = groundDiscoverPrograms([raw], sourceIndex, { previousPrograms: [previous] })
    const cleared = groundDiscoverPrograms([raw], sourceIndex, {
      previousPrograms: [previous],
      authoritativePis: true,
    })

    expect(retained.programs[0].pis).toHaveLength(1)
    expect(cleared.programs[0].pis).toHaveLength(0)
  })

  it('clears decision-critical facts that have no field-specific official source', () => {
    const result = groundDiscoverPrograms([{
      id: 'unsupported_facts',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      deadlineIso: '2027-01-15',
      stipendUSD: 99999,
      stipendLocal: '$99,999',
      tuitionLocal: '$1',
      applicationRestrictions: 'One application only',
      intlNotes: 'Guaranteed visa',
      qsWorldRank: 1,
      rankingSources: [],
    }], sourceIndex)

    expect(result.programs[0]).toMatchObject({
      deadlineIso: '',
      stipendUSD: null,
      stipendConfidence: 'unknown',
      tuitionLocal: '',
      applicationRestrictions: '',
      intlNotes: '',
      qsWorldRank: null,
    })
  })

  it('does not use fetched advisor or news pages as field-specific programme facts', () => {
    const advisorUrl = 'https://www.example.edu/cs/people/ada-lovelace'
    const newsUrl = 'https://www.example.edu/news/phd-funding-announcement'
    const result = groundDiscoverPrograms([{
      id: 'wrong_fact_page_types',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: 'https://www.example.edu/cs/phd',
      sources: ['https://www.example.edu/cs/phd'],
      deadlineIso: '2027-01-01',
      stipendUSD: 50000,
      factSources: { deadline: advisorUrl, funding: newsUrl },
    }], {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [
          { url: advisorUrl, types: ['advisor'], fetched: true, individualAdvisor: true },
          { url: newsUrl, types: ['research'], fetched: true },
        ],
        advisorPages: [{ url: advisorUrl, types: ['advisor'], fetched: true, individualAdvisor: true }],
        researchPages: [{ url: newsUrl, types: ['research'], fetched: true }],
      }],
    }, {
      allowedEvidenceUrls: ['https://www.example.edu/cs/phd', advisorUrl, newsUrl],
    })

    expect(result.programs[0]).toMatchObject({ deadlineIso: '', stipendUSD: null })
    expect(result.programs[0].factSources).toMatchObject({ deadline: '', funding: '' })
  })

  it('requires the cited page text to contain the claimed deadline and amounts', () => {
    const programUrl = 'https://www.example.edu/cs/phd'
    const unsupportedIndex = {
      schools: [{
        ...sourceIndex.schools[0],
        pages: [{
          url: programUrl,
          title: 'Computer Science PhD',
          excerpt: 'Applications are open. Funding information is available separately.',
          types: ['program'],
          fetched: true,
        }],
      }],
    }
    const candidate = {
      id: 'unsupported_fact_values',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
      deadlineIso: '2099-01-01',
      deadlineAndTests: 'January 1, 2099',
      stipendUSD: 999999,
      stipendLocal: '$999,999',
      tuitionLocal: '$888,888',
      factSources: { deadline: programUrl, funding: programUrl, tuition: programUrl },
    }

    const unsupported = groundDiscoverPrograms([candidate], unsupportedIndex, {
      allowedEvidenceUrls: [programUrl],
    })
    expect(unsupported.programs[0]).toMatchObject({
      deadlineIso: '',
      stipendUSD: null,
      tuitionLocal: '',
    })
    expect(unsupported.programs[0].factSources).toMatchObject({ deadline: '', funding: '', tuition: '' })

    const supportedIndex = {
      schools: [{
        ...unsupportedIndex.schools[0],
        pages: [{
          ...unsupportedIndex.schools[0].pages[0],
          excerpt: 'Application deadline: January 15, 2027. Annual stipend: $50,000. Tuition: $10,000.',
        }],
      }],
    }
    const supported = groundDiscoverPrograms([{
      ...candidate,
      id: 'supported_fact_values',
      deadlineIso: '2027-01-15',
      deadlineAndTests: 'January 15, 2027',
      stipendUSD: 50000,
      stipendLocal: '$50,000',
      tuitionLocal: '$10,000',
    }], supportedIndex, { allowedEvidenceUrls: [programUrl] })
    expect(supported.programs[0]).toMatchObject({
      deadlineIso: '2027-01-15',
      stipendUSD: 50000,
      tuitionLocal: '$10,000',
    })
  })

  it('rejects a school name that conflicts with the official URL owner', () => {
    const uclaUrl = 'https://www.ucla.edu/graduate/computer-science-phd'
    const result = groundDiscoverPrograms([{
      id: 'berkeley_name_ucla_url',
      school: 'University of California Berkeley',
      program: 'Computer Science PhD',
      website: uclaUrl,
      sources: [uclaUrl],
    }], {
      schools: [{
        school: 'University of California Los Angeles',
        region: 'US',
        officialUrl: 'https://www.ucla.edu/',
        allowedHosts: ['ucla.edu'],
        pages: [{ url: uclaUrl, title: 'Computer Science PhD', types: ['program'], fetched: true }],
        programPages: [{ url: uclaUrl, title: 'Computer Science PhD', types: ['program'], fetched: true }],
        advisorPages: [],
      }],
    })

    expect(result.programs).toEqual([])
    expect(result.rejected).toEqual([{ id: 'berkeley_name_ucla_url', reason: 'school-not-resolved' }])
  })

  it('keeps a declared common school abbreviation without weakening conflict checks', () => {
    const programUrl = 'https://www.umass.edu/computer-science-phd'
    const result = groundDiscoverPrograms([{
      id: 'umass_abbreviation',
      school: 'UMass Amherst',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
    }], {
      schools: [{
        school: 'University of Massachusetts Amherst',
        region: 'US',
        officialUrl: 'https://www.umass.edu/',
        allowedHosts: ['umass.edu'],
        pages: [{ url: programUrl, title: 'Computer Science PhD', types: ['program'], fetched: true }],
        programPages: [{ url: programUrl, title: 'Computer Science PhD', types: ['program'], fetched: true }],
        advisorPages: [],
      }],
    })

    expect(result.programs.map((program) => program.id)).toEqual(['umass_abbreviation'])
  })

  it('allows only URLs observed by the current research phase, even on the right school domain', () => {
    const observedProgram = 'https://www.example.edu/cs/phd'
    const unobservedFunding = 'https://www.example.edu/cs/funding-secret'
    const unobservedAdvisor = 'https://www.example.edu/cs/people/grace-hopper'
    const result = groundDiscoverPrograms([{
      id: 'phase_owned',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: observedProgram,
      sources: [observedProgram],
      stipendUSD: 99999,
      stipendLocal: '$99,999',
      factSources: { funding: unobservedFunding },
      pis: [{ name: 'Grace Hopper', url: unobservedAdvisor, recruiting: 'accepting' }],
    }], sourceIndex, {
      allowedEvidenceUrls: [observedProgram],
    })

    expect(result.programs).toHaveLength(1)
    expect(result.programs[0]).toMatchObject({ stipendUSD: null, stipendConfidence: 'unknown', pis: [] })
    expect(result.programs[0].factSources.funding).toBe('')
  })

  it('keeps unfetched candidate links as leads until a live citation observes them', () => {
    const programUrl = 'https://www.example.edu/cs/phd'
    const advisorUrl = 'https://www.example.edu/cs/people/grace-hopper'
    const candidateOnlyIndex = {
      schools: [{
        school: 'Example University',
        region: 'US',
        officialUrl: 'https://www.example.edu',
        programPages: [{ url: programUrl, types: ['program'], fetched: true }],
        advisorPages: [{
          url: advisorUrl,
          title: 'Grace Hopper',
          types: ['advisor'],
          fetched: false,
        }],
      }],
    }
    const candidate = {
      id: 'candidate_link',
      school: 'Example University',
      program: 'Computer Science PhD',
      website: programUrl,
      sources: [programUrl],
      pis: [{ name: 'Grace Hopper', url: advisorUrl }],
    }

    const notCited = groundDiscoverPrograms([candidate], candidateOnlyIndex, {
      allowedEvidenceUrls: [programUrl],
    })
    expect(notCited.programs[0].pis).toEqual([])

    const cited = groundDiscoverPrograms([candidate], candidateOnlyIndex, {
      allowedEvidenceUrls: [programUrl, advisorUrl],
    })
    expect(cited.programs[0].pis[0].url).toBe(advisorUrl)
  })
})

describe('Discover scholarly graph adapter', () => {
  it('uses ROR/OpenAlex institution IDs and keeps per-subfield evidence', async () => {
    const fetchImpl = async (value) => {
      const url = new URL(value)
      if (url.hostname === 'api.ror.org') {
        return new Response(JSON.stringify({
          items: [{
            id: 'https://ror.org/05a28rw58',
            names: [{ value: 'Example University', types: ['ror_display'] }],
            domains: ['example.edu'],
          }],
        }), { status: 200 })
      }
      if (url.pathname.endsWith('/institutions')) {
        return new Response(JSON.stringify({
          results: [{
            id: 'https://openalex.org/I1',
            display_name: 'Example University',
            ror: 'https://ror.org/05a28rw58',
            homepage_url: 'https://www.example.edu/',
          }],
        }), { status: 200 })
      }
      if (url.pathname.endsWith('/works')) {
        const matchedQuery = url.searchParams.get('search')
        return new Response(JSON.stringify({
          results: [{
            id: 'https://openalex.org/W1',
            doi: 'https://doi.org/10.1000/example',
            display_name: `Evidence for ${matchedQuery}`,
            publication_year: 2025,
            cited_by_count: 20,
            authorships: [{
              author: { id: 'https://openalex.org/A1', display_name: 'Ada Lovelace' },
              institutions: [{ id: 'https://openalex.org/I1' }],
            }],
          }],
        }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }

    const entries = await collectScholarlyEvidence({
      schools: [{ ...sourceIndex.schools[0], crawlStatus: 'ok' }],
      query: ['formal methods', 'program verification'],
      fetchImpl,
    })
    expect(entries[0].evidence.status).toBe('ok')
    expect(entries[0].evidence.institution.rorId).toBe('https://ror.org/05a28rw58')
    expect(entries[0].evidence.candidateResearchers[0].matchedQueries).toEqual(['formal methods', 'program verification'])
    expect(entries[0].evidence.candidateResearchers[0].recentWorks[0].source).toBe('https://doi.org/10.1000/example')

    const attached = attachScholarlyEvidence(sourceIndex, entries)
    expect(attached.schemaVersion).toBe(2)
    expect(attached.schools[0].scholarlyEvidence.candidateResearchers[0].name).toBe('Ada Lovelace')
  })
})
