import { describe, expect, it } from 'vitest'
import {
  buildAdmissionInsightsPrompts,
  parseAdmissionInsightsResponse,
  summarizeApplicantProfile,
} from './admissionInsights.js'

const advisor = {
  awards: [
    {
      value: {
        title: 'Vision and language grounding',
        piName: 'Ada Turing',
        awardeeName: 'Example University',
        startDate: '2024-01-01',
        expDate: '2028-12-31',
        estimatedTotalAmt: 500_000,
        abstractText: 'A'.repeat(2_000),
      },
    },
  ],
  projects: [],
  works: [{ value: { title: 'A paper', publicationYear: 2025, citedByCount: 12, topics: ['vision'] } }],
}

const outcomes = {
  summary: { total: 3, accepted: 1, rejected: 2, acceptedShare: null },
  outcomes: [{ value: { school: 'Example University', program: 'PhD CS', decision: 'accepted', date: '2025-02-01' } }],
}

describe('summarizeApplicantProfile', () => {
  it('carries what the applicant works on and drops attachment payloads', () => {
    const summary = summarizeApplicantProfile([
      {
        kind: 'statement',
        name: 'Personal statement',
        description: 'Multimodal learning for low-resource languages.',
        attachments: [{ fileId: 'secret', dataUrl: 'data:...' }],
        writingBrief: { researchFocus: 'multimodal alignment' },
      },
      { kind: 'cv', name: '', description: '' },
    ])
    expect(summary).toEqual([{
      kind: 'statement',
      name: 'Personal statement',
      summary: 'Multimodal learning for low-resource languages.',
      researchFocus: 'multimodal alignment',
    }])
    expect(JSON.stringify(summary)).not.toContain('secret')
  })
})

describe('buildAdmissionInsightsPrompts', () => {
  it('indexes every supplied record and bounds the abstracts', () => {
    const prompts = buildAdmissionInsightsPrompts({
      application: { school: 'Example University', program: 'PhD CS', professor: 'Ada Turing' },
      profileAssets: [{ kind: 'statement', name: 'SOP', description: 'vision-language' }],
      advisor,
      outcomes,
    })
    const payload = JSON.parse(prompts.user)
    expect(payload.awards[0].index).toBe(0)
    expect(payload.awards[0].abstract.length).toBeLessThan(800)
    expect(payload.target.professor).toBe('Ada Turing')
    expect(payload.applicant[0].summary).toBe('vision-language')
    expect(prompts.limits).toEqual({ awards: 1, projects: 0, works: 1, outcomes: 1 })
    expect(prompts.system).toContain('Never introduce an award')
  })

  it('reports true counts alongside a truncated list', () => {
    const many = { awards: Array.from({ length: 30 }, () => advisor.awards[0]), projects: [], works: [] }
    const payload = JSON.parse(buildAdmissionInsightsPrompts({ advisor: many }).user)
    expect(payload.awards.length).toBe(12)
    // Without the real count a model cannot tell a short list from a full one.
    expect(payload.counts.awards).toBe(30)
  })
})

describe('parseAdmissionInsightsResponse', () => {
  const limits = { awards: 2, projects: 1, works: 1, outcomes: 1 }

  it('accepts a well-formed answer', () => {
    const result = parseAdmissionInsightsResponse(JSON.stringify({
      fundingOutlook: 'One active award runs through 2028.',
      fundingConfidence: 'strong',
      profileFit: 'Overlaps on vision-language grounding.',
      relevantAwardIndexes: [0, 1],
      relevantProjectIndexes: [],
      relevantWorkIndexes: [0],
      mismatchedIndexes: [{ kind: 'work', index: 0, reason: 'different Turing' }],
      outcomeReading: 'Sample is too small to read a rate.',
      talkingPoints: ['Ask about the 2028 renewal'],
      openQuestions: ['Is the group taking students this cycle?'],
    }), limits)

    expect(result.fundingConfidence).toBe('strong')
    expect(result.relevantAwardIndexes).toEqual([0, 1])
    expect(result.mismatchedIndexes).toEqual([{ kind: 'work', index: 0, reason: 'different Turing' }])
    expect(result.talkingPoints).toEqual(['Ask about the 2028 renewal'])
  })

  it('drops indexes pointing at records the model was never given', () => {
    // A model that invents index 7 is inventing an award. It must not become a
    // highlighted row next to real ones.
    const result = parseAdmissionInsightsResponse(JSON.stringify({
      relevantAwardIndexes: [0, 7, -1, 'x'],
      relevantWorkIndexes: [4],
      mismatchedIndexes: [{ kind: 'award', index: 9, reason: 'nope' }, { kind: 'nonsense', index: 0 }],
    }), limits)
    expect(result.relevantAwardIndexes).toEqual([0])
    expect(result.relevantWorkIndexes).toEqual([])
    expect(result.mismatchedIndexes).toEqual([])
  })

  it('reads an object a provider wrapped in prose or a fence', () => {
    expect(parseAdmissionInsightsResponse('```json\n{"fundingConfidence":"weak"}\n```', limits)
      .fundingConfidence).toBe('weak')
    expect(parseAdmissionInsightsResponse('Here you go: {"fundingConfidence":"moderate"} — done', limits)
      .fundingConfidence).toBe('moderate')
  })

  it('falls back to unknown rather than echoing an unrecognised confidence', () => {
    expect(parseAdmissionInsightsResponse('{"fundingConfidence":"certain"}', limits)
      .fundingConfidence).toBe('unknown')
    expect(parseAdmissionInsightsResponse('not json at all', limits)).toBeNull()
  })
})
