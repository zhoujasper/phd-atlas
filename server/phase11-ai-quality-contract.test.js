import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APPLICATION_ENRICHMENT_VERIFIER_SYSTEM } from './applicationEnrichmentPrompts.js'
import {
  APPLICATION_MAIL_DRAFT_SYSTEM,
  buildApplicationMailInstruction,
} from './applicationMailPrompts.js'
import {
  CURRENT_ENRICHMENT_SYSTEM,
  CURRENT_MAIL_SYSTEM,
  ENRICHMENT_SCENARIOS,
  MAIL_SCENARIOS,
} from '../tools/phase11-ai-quality-fixtures.mjs'

const prompt = APPLICATION_ENRICHMENT_VERIFIER_SYSTEM.toLowerCase()
const mailPrompt = APPLICATION_MAIL_DRAFT_SYSTEM.toLowerCase()

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()

const normalizedEvidence = (scenario) => normalize([
  scenario.program?.school,
  scenario.program?.program,
  ...(scenario.crawlerEvidence || []).flatMap((item) => [item?.title, item?.text]),
].join(' '))

const containsNumeric = (haystack, expected) => {
  const compact = haystack.replace(/[^a-z0-9]/g, '')
  const digits = String(expected).replace(/[^0-9]/g, '')
  return compact.includes(digits)
}

const containsDate = (haystack, expected) => {
  const [year, month, day] = String(expected).split('-').map(Number)
  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ]
  const compact = haystack.replace(/[^a-z0-9]/g, '')
  const dayPattern = new RegExp(`(?:^|[a-z])0?${day}(?:st|nd|rd|th)?[a-z0-9]`)
  return compact.includes(String(year))
    && compact.includes(monthNames[month - 1])
    && dayPattern.test(compact)
}

const advisorMatches = (scenario) => (
  [...(scenario.crawlerEvidence || []).flatMap((item) => [item?.title, item?.text]).join(' ')
    .matchAll(/\b(?:Dr\.?|Professor|Prof\.)\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?/g)]
    .map((match) => match[0])
)

describe('Phase 11 enrichment extraction contract', () => {
  it('uses the same verifier prompt in the evaluation harness and production', () => {
    expect(CURRENT_ENRICHMENT_SYSTEM).toBe(APPLICATION_ENRICHMENT_VERIFIER_SYSTEM)
  })

  it('keeps the anti-hallucination gates explicit', () => {
    expect(prompt).toContain('use only the server-fetched evidence pages')
    expect(prompt).toContain('never fill them from memory')
    expect(prompt).toContain('do not invent dates, fee amounts, waiver rules')
    expect(prompt).toContain('exact https source url that appears in crawlerevidence')
  })

  it('requires evidence-present fields to be extracted instead of left blank', () => {
    expect(prompt).toContain('evidence-present extraction is mandatory')
    expect(prompt).toContain('evidence-absent fields stay empty')
    expect(prompt).toContain('leave it empty only when no evidence page supports it')
  })

  it('makes research extraction explicit for programme/lab/faculty evidence', () => {
    expect(prompt).toContain('for researchsummary, extract the programme or lab research subject')
    expect(prompt).toContain('do not leave it blank merely because a dedicated research page was not crawled')
  })

  it('requires exhaustive requirements extraction across every evidence page', () => {
    expect(prompt).toContain('for requirementssummary, search every crawlerevidence page')
    expect(prompt).toContain('language of instruction or proficiency')
    expect(prompt).toContain('an omitted stated requirement is an extraction failure')
  })

  it('separates named-advisor evidence from recruitment inference', () => {
    expect(prompt).toContain('for suggestedadvisor, fill the name')
    expect(prompt).toContain('instead of blanking an explicitly named advisor')
    expect(prompt).toContain('do not infer that an advisor is recruiting')
  })

  for (const scenario of ENRICHMENT_SCENARIOS) {
    it(`${scenario.id} expected non-empty fields are supported by fixture evidence`, () => {
      const haystack = normalizedEvidence(scenario)
      const expected = scenario.expected

      if (expected.deadline) expect(containsDate(haystack, expected.deadline)).toBe(true)
      if (expected.feeAmount) expect(containsNumeric(haystack, expected.feeAmount)).toBe(true)
      if (expected.feeCurrency) expect(haystack).toContain(normalize(expected.feeCurrency))
      if (expected.advisorName) expect(haystack).toContain(normalize(expected.advisorName))
      for (const token of expected.requirementsContains || []) {
        expect(haystack).toContain(normalize(token))
      }
      for (const token of expected.researchContains || []) {
        expect(haystack).toContain(normalize(token))
      }
    })

    it(`${scenario.id} expected empty fields have no named-advisor evidence`, () => {
      if (scenario.expected.advisorName) return
      expect(advisorMatches(scenario)).toEqual([])
    })
  }
})

describe('Phase 11 mail drafting contract', () => {
  it('uses the same drafting prompt in the evaluation harness and production', () => {
    expect(CURRENT_MAIL_SYSTEM).toBe(APPLICATION_MAIL_DRAFT_SYSTEM)
    const indexSource = readFileSync(resolve(process.cwd(), 'server/index.js'), 'utf8')
    const evalSource = readFileSync(resolve(process.cwd(), 'tools/phase11-ai-quality-eval.mjs'), 'utf8')
    expect(indexSource).toContain("from './applicationMailPrompts.js'")
    expect(indexSource).toContain('APPLICATION_MAIL_DRAFT_SYSTEM')
    expect(indexSource).not.toContain("'You are PhD Atlas email drafting assistance. Draft but never send email.'")
    expect(evalSource).toContain("from '../server/applicationMailPrompts.js'")
    expect(evalSource).toContain('buildApplicationMailInstruction')
    expect(evalSource).not.toContain('function mailInstruction')
  })

  it('keeps anti-fabrication gates explicit for generation', () => {
    expect(mailPrompt).toContain('never fabricate academic history')
    expect(mailPrompt).toContain('supported by granted context')
    expect(mailPrompt).toContain('do not substitute a plausible value')
    expect(mailPrompt).toContain('do not add or change professor')
    expect(mailPrompt).toContain('do not mention documents or attachments')
  })

  it('requires requested context-supported facts to be included exactly', () => {
    expect(mailPrompt).toContain('include the exact value')
    expect(mailPrompt).toContain('omitting a requested, context-supported fact is a failure')
    expect(mailPrompt).toContain('do not use acceptance language when the user asks to decline')
  })

  it('separates English and Chinese politeness conventions', () => {
    expect(mailPrompt).toContain('natural chinese academic prose')
    expect(mailPrompt).toContain('not a translated english template')
    expect(mailPrompt).toContain('avoid generic openers')
    expect(mailPrompt).toContain('do not repeat the original formal salutation')
  })

  it('builds the same production instruction variants for compose, reply, and revision', () => {
    expect(buildApplicationMailInstruction({
      mode: 'compose',
      instructions: 'Introduce yourself.',
    })).toBe('Write a new email to the application professor. User request: Introduce yourself.')

    expect(buildApplicationMailInstruction({
      mode: 'reply',
      instructions: 'Confirm interest.',
    })).toBe('Write a reply to the selected incoming message. User request: Confirm interest.')

    expect(buildApplicationMailInstruction({
      mode: 'compose',
      instructions: 'Make it shorter.',
      currentDraft: {
        subject: 'Prospective applicant',
        body: 'I hope this email finds you well.',
      },
    })).toContain('Revise the current editable email using the user\'s request.')
    expect(buildApplicationMailInstruction({
      mode: 'compose',
      instructions: 'Make it shorter.',
      currentDraft: {
        subject: 'Prospective applicant',
        body: 'I hope this email finds you well.',
      },
    })).toContain('Subject: Prospective applicant')
  })

  const factualShouldContain = {
    'cold-contact-english': ['Tsinghua University', 'MSc in Computer Science', 'natural language processing'],
    'follow-up-no-reply': [],
    'interview-thank-you': ['interview', 'retrieval'],
    'admission-status': ['2027-CS-00142'],
    'decline-offer': [],
    'recommendation-letter': ['November 15, 2027', 'recommendation letter', 'portal'],
    'reply-incoming': ['transcript', 'research statement'],
    'chinese-cold-contact': ['Tsinghua University', 'Computer Science', '自然语言处理'],
    'revise-shorter': ['Tsinghua University', 'natural language processing'],
    'attach-cv': ['CV'],
  }

  for (const scenario of MAIL_SCENARIOS) {
    it(`${scenario.id} expected factual content is present in the granted context or user instruction`, () => {
      const haystack = normalize(JSON.stringify(scenario.context) + ' ' + scenario.instruction)
      for (const token of factualShouldContain[scenario.id] || []) {
        expect(haystack).toContain(normalize(token))
      }
    })

    it(`${scenario.id} forbidden tokens are not introduced by fixture context`, () => {
      const contextHaystack = normalize(JSON.stringify(scenario.context))
      const instructionHaystack = normalize(scenario.instruction)
      for (const token of scenario.expected.mustNotContain || []) {
        if (contextHaystack.includes(normalize(token))) continue
        expect(instructionHaystack).not.toContain(normalize(token))
      }
    })
  }
})
