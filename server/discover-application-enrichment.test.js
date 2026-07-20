import { describe, expect, it } from 'vitest'
import {
  applyApplicationEnrichmentProposal,
  buildApplicationEnrichmentProposal,
  findBestDiscoverProgram,
  parseAiApplicationEnrichment,
} from './discover-application-enrichment.js'

const program = {
  id: 'prog_test',
  school: 'Example University',
  program: 'Computer Science PhD',
  website: 'https://cs.example.edu/phd',
  deadlineIso: '2027-12-01',
  deadlineAndTests: 'December 1; English test where required',
  applicationRestrictions: 'One application per cycle',
  applicationRoute: 'Department portal',
  researchFocus: 'Human-centered machine learning',
  fitRationale: 'Strong fit for human-AI collaboration',
  careerOutcomes: 'Research and academic careers',
  intlNotes: 'International applicants are considered',
  stipendLocal: '$40,000 per year',
  stipendBasis: 'Published department snapshot',
  stipendNotes: 'Verify the current cycle',
  stipendConfidence: 'medium',
  tags: ['Machine Learning', 'HCI'],
  sources: ['https://cs.example.edu/phd/funding'],
  pis: [{
    id: 'pi_test',
    name: 'Dr Alex Example',
    email: 'alex@example.edu',
    url: 'https://cs.example.edu/alex',
    research: 'Human-AI collaboration',
  }],
}

function application() {
  return {
    id: 'app_test',
    school: { name: 'Example University', country: 'United States', website: '' },
    program: 'PhD in Computer Science',
    deadline: '',
    professor: { english: '', chinese: '', email: '', phone: '', social: '', homepage: '', research: '', lab: '' },
    tags: ['HCI'],
    dossierCards: [],
    scholarships: [],
    timeline: [],
  }
}

describe('Discover application enrichment', () => {
  it('matches an existing application to the closest catalog program', () => {
    const match = findBestDiscoverProgram(application(), [
      { ...program, id: 'other', school: 'Other Institute', program: 'Physics PhD' },
      program,
    ])
    expect(match?.program.id).toBe('prog_test')
    expect(match?.score).toBeGreaterThan(50)
  })

  it('builds a reviewable proposal and leaves replacements unchecked', () => {
    const existing = application()
    existing.deadline = '2027-11-01'
    const proposal = buildApplicationEnrichmentProposal(existing, [program])
    expect(proposal.matchedProgram?.id).toBe('prog_test')
    expect(proposal.changes.some((change) => change.id === 'discover-dossier')).toBe(true)
    expect(proposal.changes.find((change) => change.id === 'application-deadline')).toMatchObject({
      mode: 'update',
      recommended: false,
    })
    expect(proposal.caveats[0]).toMatch(/snapshot/i)
  })

  it('applies only accepted fixed changes and upserts Discover records', () => {
    const existing = application()
    const proposal = buildApplicationEnrichmentProposal(existing, [program])
    const updated = applyApplicationEnrichmentProposal(existing, proposal, [
      'school-website',
      'discover-dossier',
      'discover-funding',
      'discover-timeline',
    ])
    expect(updated.school.website).toBe(program.website)
    expect(updated.deadline).toBe('')
    expect(updated.dossierCards).toHaveLength(1)
    expect(updated.scholarships).toHaveLength(1)
    expect(updated.timeline[0].id).toBe('discover-enriched-prog_test')

    const repeated = applyApplicationEnrichmentProposal(updated, proposal, [
      'discover-dossier',
      'discover-funding',
      'discover-timeline',
    ])
    expect(repeated.dossierCards).toHaveLength(1)
    expect(repeated.scholarships).toHaveLength(1)
    expect(repeated.timeline).toHaveLength(1)
  })

  it('sanitizes JSON-only AI enrichment and rejects malformed output', () => {
    expect(parseAiApplicationEnrichment('```json\n{"researchSummary":"Verified summary","caveats":["Review it"]}\n```')).toMatchObject({
      researchSummary: 'Verified summary',
      caveats: ['Review it'],
    })
    expect(parseAiApplicationEnrichment('not json')).toBeNull()
  })
})
