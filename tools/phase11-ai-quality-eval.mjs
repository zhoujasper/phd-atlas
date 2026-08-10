import { completeChat, streamEmailDraft, supportsNativeOpenAiWebSearch } from '../server/aiProviders.js'
import {
  AI_APPLICATION_ENRICHMENT_OUTPUT_SCHEMA,
  buildApplicationEnrichmentContext,
} from '../server/discover-application-enrichment.js'
import {
  APPLICATION_MAIL_DRAFT_SYSTEM,
  buildApplicationMailInstruction,
} from '../server/applicationMailPrompts.js'
import {
  CURRENT_ENRICHMENT_SYSTEM,
  ENRICHMENT_SCENARIOS,
  MAIL_SCENARIOS,
} from './phase11-ai-quality-fixtures.mjs'

const args = new Set(process.argv.slice(2))
const mode = args.has('--mail')
  ? 'mail'
  : args.has('--enrichment')
    ? 'enrichment'
    : 'all'
const dryRun = args.has('--dry-run')
const limit = Number(args.has('--limit') ? process.argv[process.argv.indexOf('--limit') + 1] : 0)

const apiKey = process.env.PHD_ATLAS_TEST_AI_KEY
const key = {
  provider: 'openai',
  apiKey,
  baseUrl: process.env.PHD_ATLAS_TEST_AI_BASE_URL || 'https://sub2api.luchikey.com',
  model: process.env.PHD_ATLAS_TEST_AI_MODEL || 'gpt-5.6-luna',
  id: 'phase11-quality-eval',
  ownerId: 'phase11-quality-eval',
}

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()

const normalizeUrl = (value) => String(value || '')
  .replace(/\/+$/, '')
  .replace(/^https?:\/\//i, '')
  .toLowerCase()

function bounded(value, max = 12_000) {
  return String(value || '').slice(0, max)
}

function parseEmailDraft(output) {
  const text = String(output || '')
  const subjectMatch = text.match(/^Subject:\s*(.*)$/im)
  const subject = subjectMatch?.[1]?.trim() || ''
  const afterSubject = text.slice(subjectMatch?.[0]?.length || 0)
  const body = afterSubject.replace(/^\s*\r?\n+/, '').trim()
  return { subject, body }
}

function parseJsonText(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

function wordMetric(body, scenario) {
  const chineseChars = body.replace(/\s/g, '').match(/[\u3400-\u9fff]/g)?.length || 0
  const latinWords = body.trim().split(/\s+/).filter(Boolean).length
  const mixed = Math.max(latinWords, Math.ceil(body.length / 4))
  return scenario.id === 'chinese-cold-contact' ? Math.max(chineseChars, latinWords) : mixed
}

function scoreMail(scenario, draft) {
  const haystack = `${draft.subject}\n${draft.body}`
  const normalizedHaystack = normalize(haystack)
  const missingExpected = (scenario.expected.shouldContain || [])
    .filter((token) => !normalizedHaystack.includes(normalize(token)))
  const forbiddenFound = (scenario.expected.mustNotContain || [])
    .filter((token) => normalizedHaystack.includes(normalize(token)))
  const words = wordMetric(draft.body, scenario)
  const minWords = scenario.expected.minWords ?? 0
  const maxWords = scenario.expected.maxWords ?? Number.POSITIVE_INFINITY
  const flags = []
  if (!draft.subject) flags.push('missing-subject')
  if (!draft.body) flags.push('empty-body')
  if (missingExpected.length) flags.push(`missing-expected:${missingExpected.join(',')}`)
  if (forbiddenFound.length) flags.push(`forbidden-token:${forbiddenFound.join(',')}`)
  if (words < minWords || words > maxWords) flags.push(`length-${words}`)

  const usable = flags.length === 0
  return {
    scenarioId: scenario.id,
    usable,
    flags,
    words,
    subject: bounded(draft.subject, 240),
    body: bounded(draft.body),
  }
}

function collectOutputUrls(parsed) {
  const urls = []
  const visit = (value) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) urls.push(normalizeUrl(value))
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item)
    }
  }
  visit(parsed)
  return [...new Set(urls)]
}

function stringMatches(actual, expected) {
  if (expected === '') return !String(actual || '').trim()
  if (Array.isArray(expected)) {
    return expected.every((token) => normalize(actual).includes(normalize(token)))
  }
  return normalize(actual).includes(normalize(expected))
}

function scoreEnrichment(scenario, parsed, text) {
  const evidenceUrls = new Set(scenario.crawlerEvidence.map((item) => normalizeUrl(item.url)))
  const outputUrls = collectOutputUrls(parsed)
  const citationsOutsideEvidence = outputUrls.filter((url) => !evidenceUrls.has(url))
  const fieldResults = {}
  const checks = [
    ['deadline', parsed?.applicationDeadline?.date, scenario.expected.deadline],
    ['feeAmount', parsed?.applicationFee?.amount, scenario.expected.feeAmount],
    ['feeCurrency', parsed?.applicationFee?.currency, scenario.expected.feeCurrency],
    ['advisorName', parsed?.suggestedAdvisor?.name, scenario.expected.advisorName],
    ['requirements', parsed?.requirementsSummary, scenario.expected.requirementsContains],
    ['research', parsed?.researchSummary, scenario.expected.researchContains],
  ]
  for (const [name, actual, expected] of checks) {
    const correct = stringMatches(actual, expected)
    fieldResults[name] = {
      correct,
      expected,
      actual: bounded(actual, 1200),
    }
  }
  const requiredBlank = checks
    .filter(([, actual, expected]) => expected !== '' && !stringMatches(actual, expected))
    .map(([name]) => name)
  const emptyExpectedFilled = checks
    .filter(([, actual, expected]) => expected === '' && !stringMatches(actual, expected))
    .map(([name]) => name)
  const parsedOk = Boolean(parsed)
  const allCorrect = checks.every(([, actual, expected]) => stringMatches(actual, expected))
  const usable = parsedOk
    && allCorrect
    && citationsOutsideEvidence.length === 0
    && requiredBlank.length === 0
    && emptyExpectedFilled.length === 0

  return {
    scenarioId: scenario.id,
    usable,
    parsedOk,
    fieldResults,
    requiredBlank,
    emptyExpectedFilled,
    citationsOutsideEvidence,
    sources: parsed?.sources || [],
    rawText: bounded(text, 16_000),
  }
}

async function runMailScenario(scenario, signal) {
  let output = ''
  const statuses = []
  const attachmentSelections = []
  const startedAt = Date.now()
  const usage = await streamEmailDraft({
    key,
    system: APPLICATION_MAIL_DRAFT_SYSTEM,
    instruction: buildApplicationMailInstruction({
      mode: scenario.mode,
      instructions: scenario.instruction,
      currentDraft: scenario.context.currentDraft,
    }),
    grantedContext: scenario.context,
    attachments: [],
    attachmentCandidates: scenario.context.emailAttachmentCandidates || [],
    signal,
    onStatus: (phase) => statuses.push(phase),
    onAttachmentSelection: (attachments) => attachmentSelections.push(...attachments),
    onText: (text) => {
      output += text
    },
  })
  const draft = parseEmailDraft(output)
  return {
    latencyMs: Date.now() - startedAt,
    usage,
    statuses,
    attachmentSelections,
    ...scoreMail(scenario, draft),
  }
}

async function runEnrichmentScenario(scenario, signal) {
  const applicationContext = buildApplicationEnrichmentContext(scenario.application, scenario.applicantProfile)
  const nativeWebSearch = supportsNativeOpenAiWebSearch(key)
  const startedAt = Date.now()
  const completion = await completeChat({
    key,
    system: CURRENT_ENRICHMENT_SYSTEM,
    user: JSON.stringify({
      protocolVersion: applicationContext.protocolVersion,
      applicationContext,
      matchedProgram: scenario.program,
      searchPlan: {
        searchQueries: [],
        candidateUrls: [],
        missingEvidence: [],
      },
      crawlerEvidence: scenario.crawlerEvidence,
    }),
    temperature: 0,
    maxTokens: 7600,
    webSearch: nativeWebSearch,
    allowedDomains: scenario.allowedDomains || [],
    outputSchema: nativeWebSearch ? AI_APPLICATION_ENRICHMENT_OUTPUT_SCHEMA : undefined,
    signal,
  })
  const parsed = parseJsonText(completion.text)
  return {
    latencyMs: Date.now() - startedAt,
    usage: completion.usage,
    webSearchUsed: Boolean(completion.webSearchUsed),
    ...scoreEnrichment(scenario, parsed, completion.text),
  }
}

function takeLimit(items) {
  return limit > 0 ? items.slice(0, limit) : items
}

async function main() {
  if (dryRun) {
    const report = {
      dryRun: true,
      keyConfigured: Boolean(apiKey),
      keySource: 'PHD_ATLAS_TEST_AI_KEY',
      provider: key.provider,
      model: key.model,
      mailScenarioCount: MAIL_SCENARIOS.length,
      enrichmentScenarioCount: ENRICHMENT_SCENARIOS.length,
      scenarios: [
        ...(mode === 'mail' || mode === 'all'
          ? takeLimit(MAIL_SCENARIOS).map((scenario) => ({ kind: 'mail', id: scenario.id, label: scenario.label }))
          : []),
        ...(mode === 'enrichment' || mode === 'all'
          ? takeLimit(ENRICHMENT_SCENARIOS).map((scenario) => ({ kind: 'enrichment', id: scenario.id, label: scenario.label }))
          : []),
      ],
    }
    console.log(JSON.stringify(report, null, 2))
    return
  }

  if (!apiKey) {
    console.error('PHD_ATLAS_TEST_AI_KEY is required for a real quality run.')
    process.exitCode = 2
    return
  }

  const signal = new AbortController().signal
  const report = {
    generatedAt: new Date().toISOString(),
    protocol: 'phase11-ai-quality-v1',
    provider: key.provider,
    model: key.model,
    mail: [],
    enrichment: [],
  }

  if (mode === 'mail' || mode === 'all') {
    for (const scenario of takeLimit(MAIL_SCENARIOS)) {
      report.mail.push(await runMailScenario(scenario, signal))
    }
  }
  if (mode === 'enrichment' || mode === 'all') {
    for (const scenario of takeLimit(ENRICHMENT_SCENARIOS)) {
      report.enrichment.push(await runEnrichmentScenario(scenario, signal))
    }
  }

  report.summary = {
    mailUsable: report.mail.filter((item) => item.usable).length,
    mailTotal: report.mail.length,
    enrichmentUsable: report.enrichment.filter((item) => item.usable).length,
    enrichmentTotal: report.enrichment.length,
    mailUsableRate: report.mail.length ? report.mail.filter((item) => item.usable).length / report.mail.length : null,
    enrichmentUsableRate: report.enrichment.length
      ? report.enrichment.filter((item) => item.usable).length / report.enrichment.length
      : null,
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    code: error?.code || error?.name,
    message: error?.message || String(error),
  }, null, 2))
  process.exitCode = 1
})
