import { describe, expect, it } from 'vitest'
import {
  comparePersonNames,
  institutionsAgree,
  programOverlap,
  searchablePersonName,
  verifyAdvisorRecord,
  verifyOutcomeRecord,
} from './sourceRelevance.js'

describe('comparePersonNames', () => {
  it('treats the orderings and honorifics agencies actually use as the same person', () => {
    expect(comparePersonNames('Fei-Fei Li', 'Fei-Fei Li')).toBe('exact')
    expect(comparePersonNames('Fei-Fei Li', 'Li, Fei-Fei')).toBe('exact')
    expect(comparePersonNames('Prof. Hannah Lee', 'Hannah Lee, PhD')).toBe('exact')
    expect(comparePersonNames('Müller, Jan', 'Jan Muller')).toBe('exact')
  })

  it('accepts a middle name on one side only', () => {
    expect(comparePersonNames('Kevin Collins', 'Kevin Michael Collins')).toBe('strong')
  })

  it('matches a name filed in the other order without a comma to signal it', () => {
    // OpenAlex records Fei-Fei Li as "Li Fei-Fei". Same tokens, no separator.
    expect(comparePersonNames('Fei-Fei Li', 'Li Fei-Fei')).toBe('exact')
    expect(comparePersonNames('Jian Wang', 'Wang Jian')).toBe('exact')
  })

  it('keeps an initials-only agreement separate from a real match', () => {
    // RePORTER and NSF both record plenty of "D Kim". That is worth showing as
    // a candidate and never worth counting as the advisor on its own.
    expect(comparePersonNames('Daniel Kim', 'D. Kim')).toBe('initial')
    expect(comparePersonNames('Daniel Kim', 'Diana Kim')).toBe('initial')
  })

  it('refuses a shared given name or a bare surname', () => {
    expect(comparePersonNames('Kevin Collins', 'Kevin Smith')).toBe('none')
    expect(comparePersonNames('Daniel Kim', 'Susan Kim')).toBe('none')
    expect(comparePersonNames('Daniel Kim', 'Kim')).toBe('none')
    expect(comparePersonNames('', 'Daniel Kim')).toBe('none')
  })
})

describe('searchablePersonName', () => {
  it('strips the title people type but agencies never store', () => {
    // Verified against the live NSF API: pdPIName="Prof. Fei-Fei Li" returns
    // nothing, pdPIName="Fei-Fei Li" returns her awards. Leaving the honorific
    // on makes every lookup silently empty.
    expect(searchablePersonName('Prof. Fei-Fei Li')).toBe('Fei-Fei Li')
    expect(searchablePersonName('Dr. Hannah Lee, PhD')).toBe('Hannah Lee')
    expect(searchablePersonName('Professor Maya Patel')).toBe('Maya Patel')
  })

  it('keeps the spelling agencies index on, including accents and order', () => {
    expect(searchablePersonName('Prof. Müller, Jan')).toBe('Jan Müller')
    expect(searchablePersonName('Li, Fei-Fei')).toBe('Fei-Fei Li')
  })

  it('returns nothing for a field holding only a title', () => {
    expect(searchablePersonName('Prof.')).toBe('')
    expect(searchablePersonName('   ')).toBe('')
  })
})

describe('institutionsAgree', () => {
  it('ignores the words every institution shares', () => {
    expect(institutionsAgree('University of Toronto', 'Toronto')).toBe(true)
    expect(institutionsAgree('SUNY at Buffalo', 'State University of New York at Buffalo')).toBe(true)
    expect(institutionsAgree('Stanford University', 'Yale University')).toBe(false)
  })

  it('reports "unknown" rather than a verdict when one side is missing', () => {
    expect(institutionsAgree('', 'Yale University')).toBeNull()
    expect(institutionsAgree('Yale University', 'University')).toBeNull()
  })
})

describe('programOverlap', () => {
  it('scores on distinctive words, not on degree level', () => {
    expect(programOverlap('PhD Computer Science', 'Computer Science PhD')).toBe(1)
    expect(programOverlap('PhD Computer Science', 'PhD Bioinformatics')).toBe(0)
    expect(programOverlap('PhD Computer Science', 'MS in Computer Engineering')).toBe(0.5)
    expect(programOverlap('PhD', 'Doctoral programme')).toBeNull()
  })
})

describe('verifyAdvisorRecord', () => {
  it('verifies a full-name match even when the institution differs', () => {
    // People move. An exact name is stronger evidence than a stale affiliation.
    const result = verifyAdvisorRecord({
      advisorName: 'Ada Turing',
      institution: 'Stanford University',
      names: ['Ada Turing'],
      organizations: ['Example University'],
    })
    expect(result.verified).toBe(true)
    expect(result.nameMatch).toBe('exact')
    expect(result.institutionMatch).toBe(false)
  })

  it('refuses an initials-only match at a different institution', () => {
    const result = verifyAdvisorRecord({
      advisorName: 'Daniel Kim',
      institution: 'University of Toronto',
      names: ['David Kim'],
      organizations: ['SUNY at Buffalo'],
    })
    expect(result.verified).toBe(false)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.reasons).toContain('institution-mismatch')
  })

  it('accepts an initials-only match when the institution agrees', () => {
    const result = verifyAdvisorRecord({
      advisorName: 'Daniel Kim',
      institution: 'University of Toronto',
      names: ['D. Kim'],
      organizations: ['University of Toronto'],
    })
    expect(result.verified).toBe(true)
  })

  it('gives an unrelated record no confidence at all', () => {
    // The reported bug: NSF answered an unmatched query with its newest awards
    // and every one of them was rendered as this professor's funding.
    const result = verifyAdvisorRecord({
      advisorName: 'Alice Chen',
      institution: 'University of Cambridge',
      names: ['Andrew Murray', 'Beth Stone'],
      organizations: ['SUNY at Buffalo'],
    })
    expect(result.verified).toBe(false)
    expect(result.confidence).toBe(0)
    expect(result.reasons).toEqual(['name-mismatch'])
  })

  it('checks every credited investigator, not only the first', () => {
    const result = verifyAdvisorRecord({
      advisorName: 'Ada Turing',
      institution: 'Example University',
      names: ['Grace Hopper', 'Ada Turing'],
      organizations: ['Example University'],
    })
    expect(result.verified).toBe(true)
    expect(result.matchedName).toBe('Ada Turing')
  })
})

describe('verifyOutcomeRecord', () => {
  it('counts a row only when it names this school and programme', () => {
    expect(verifyOutcomeRecord({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      candidateSchool: 'Stanford University',
      candidateProgram: 'PhD Computer Science',
    }).verified).toBe(true)
  })

  it('rejects another school and another field', () => {
    expect(verifyOutcomeRecord({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      candidateSchool: 'Example University',
      candidateProgram: 'PhD Bioinformatics',
    }).verified).toBe(false)

    expect(verifyOutcomeRecord({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      candidateSchool: 'Stanford University',
      candidateProgram: 'PhD Bioinformatics',
    }).verified).toBe(false)
  })

  it('will not attribute a row whose school cannot be compared', () => {
    expect(verifyOutcomeRecord({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      candidateSchool: '',
      candidateProgram: 'PhD Computer Science',
    }).verified).toBe(false)
  })
})
