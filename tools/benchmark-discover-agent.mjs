#!/usr/bin/env node
/**
 * Benchmark the Discover agent's evidence availability.
 *
 * `--mode=fixture` runs a deterministic local hydration benchmark with no
 * provider or network traffic. `--mode=live` runs the full pipeline with the
 * key from PHD_ATLAS_TEST_AI_KEY and never writes it to disk.
 */
import {
  defaultDiscoverState,
  normalizeDiscoverState,
} from '../server/discover-catalog.js'
import { buildDiscoverResearchRun } from '../server/discover-research.js'
import { hydrateDiscoverOfficialEvidence } from '../server/discover-evidence-hydration.js'
import {
  buildDiscoverResearchRecordLedger,
  evaluateDiscoverResearchResult,
} from '../server/discover-live-evaluation.js'
import { validateDiscoverCapabilityProof } from '../server/discover-capability-proof.js'
import { testAiResearchKeyConnection } from '../server/aiProviders.js'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const LIVE_SCENARIOS = Object.freeze({
  'uk-neuro': Object.freeze({
    field: 'computational neuroscience',
    subfields: ['graph neural networks', 'brain connectivity', 'network dynamics'],
    regions: ['UK'],
    notes: 'Deep learning and causal methods for multimodal brain connectivity.',
    profile: {
      currentRole: 'research applicant',
      field: 'computational neuroscience',
      researchInterests: 'graph neural networks, brain connectivity, network dynamics',
      researchMethods: 'Python, deep learning, causal inference, graph modelling',
      achievements: 'research projects in computational modelling',
      goals: 'develop interpretable models of large-scale neural systems',
      location: 'United Kingdom',
    },
  }),
  'us-ca-neuro': Object.freeze({
    field: 'computational neuroscience',
    subfields: ['neuroimaging', 'causal inference', 'machine learning'],
    regions: ['US', 'CA'],
    notes: 'Interpretable machine learning for neuroimaging and neural dynamics.',
    profile: {
      currentRole: 'research applicant',
      field: 'computational neuroscience',
      researchInterests: 'neuroimaging, neural dynamics, interpretable machine learning',
      researchMethods: 'Python, causal inference, deep learning, statistical modelling',
      achievements: 'research projects in computational modelling',
      goals: 'connect mechanistic neuroscience with robust machine learning',
      location: 'United Kingdom',
    },
  }),
  'eu-neuro': Object.freeze({
    field: 'computational neuroscience',
    subfields: ['network neuroscience', 'dynamical systems', 'graph learning'],
    regions: ['EU'],
    notes: 'Graph learning and dynamical-systems methods for network neuroscience.',
    profile: {
      currentRole: 'research applicant',
      field: 'computational neuroscience',
      researchInterests: 'network neuroscience, graph learning, dynamical systems',
      researchMethods: 'Python, graph neural networks, time-series analysis, causal inference',
      achievements: 'research projects in computational modelling',
      goals: 'build reliable multiscale models of brain networks',
      location: 'United Kingdom',
    },
  }),
})

function argument(name, fallback = null) {
  const prefix = `--${name}=`
  const inline = process.argv.find((value) => value.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1 || index + 1 >= process.argv.length) return fallback
  return process.argv[index + 1]
}

function fixtureSourceIndex(count) {
  const schools = Array.from({ length: count }, (_, index) => {
    const host = `university-${index}.example`
    return {
      school: `University ${index}`,
      region: 'US',
      officialUrl: `https://${host}/`,
      allowedHosts: [host],
      pages: [],
      programPages: [],
      admissionsPages: [],
      advisorPages: [],
      fundingPages: [],
      researchPages: [],
    }
  })
  return { schools }
}

function fixturePrograms(count) {
  return Array.from({ length: count }, (_, index) => ({
    school: `University ${index}`,
    website: `https://university-${index}.example/phd`,
    sources: [`https://university-${index}.example/phd`],
    pis: [],
  }))
}

function fixtureFetch(programCount) {
  const directAttempts = new Map()
  return async (value) => {
    const url = String(value)
    if (url.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /', { status: 200 })
    }
    for (let index = 0; index < programCount; index += 1) {
      const target = `https://university-${index}.example/phd`
      if (url.endsWith(target.slice(target.lastIndexOf('/')))) {
        const attempts = (directAttempts.get(url) || 0) + 1
        directAttempts.set(url, attempts)
        if (attempts < 2) throw new Error('transient network outage')
        return new Response('<title>PhD programme</title><main>Official doctoral programme.</main>', { status: 200 })
      }
    }
    return new Response('', { status: 404 })
  }
}

function evaluationSourcesForGoldSet(goldSet, regions) {
  if (!goldSet) return []
  const advisors = new Set(goldSet.advisors || [])
  const rows = new Map()
  for (const record of [...(goldSet.programs || []), ...(goldSet.advisors || [])]) {
    const school = String(record?.school || '').trim()
    const sourceUrl = String(record?.officialUrl || '').trim()
    if (!school || !sourceUrl) continue
    let url
    try { url = new URL(sourceUrl) } catch { continue }
    if (url.protocol !== 'https:') continue
    const current = rows.get(school) || {
      region: regions[0] || 'OTHER',
      country: '',
      school,
      url: `${url.origin}/`,
      allowedHosts: [],
      seeds: [],
      pathHints: {},
      adapterVerifiedAt: String(goldSet.checkedAt || '').slice(0, 10),
      sourceProvenance: 'independent-official-gold-evaluation',
      crawlPolicy: { maxPages: 24, followSitemaps: true },
    }
    if (!current.allowedHosts.includes(url.hostname)) current.allowedHosts.push(url.hostname)
    if (!current.seeds.some((seed) => seed.url === sourceUrl)) {
      current.seeds.push({ kind: advisors.has(record) ? 'advisor' : 'program', url: sourceUrl })
    }
    rows.set(school, current)
  }
  return [...rows.values()]
}

async function benchmarkFixture(retries) {
  const programCount = 12
  const sourceIndex = fixtureSourceIndex(programCount)
  const crawls = sourceIndex.schools.map((school) => ({
    source: {
      region: school.region,
      school: school.school,
      url: school.officialUrl,
      allowedHosts: school.allowedHosts,
      seeds: [],
      crawlPolicy: { maxPages: 8 },
    },
    pages: [],
    candidatePages: [],
    skipped: null,
    health: { status: 'ok' },
  }))
  const result = await hydrateDiscoverOfficialEvidence({
    crawls,
    sourceIndex,
    programs: fixturePrograms(programCount),
    fetchImpl: fixtureFetch(programCount),
    dnsLookup: null,
    concurrency: 4,
    retries,
    retryDelayMs: 0,
    includeDeclaredSeeds: false,
  })
  const fetched = result.additions.reduce(
    (total, addition) => total + (addition?.pages?.length || 0),
    0,
  )
  return {
    mode: 'fixture',
    retries,
    attemptedSourceCount: result.attemptedSourceCount,
    fetchedPages: fetched,
    evidenceAvailability: result.attemptedSourceCount
      ? Math.round((fetched / result.attemptedSourceCount) * 1000) / 10
      : 0,
    elapsedMs: 0,
  }
}

async function benchmarkLive(retries) {
  const apiKey = process.env.PHD_ATLAS_TEST_AI_KEY
  if (!apiKey) throw new Error('PHD_ATLAS_TEST_AI_KEY is not set')
  const controller = new AbortController()
  // Without a deadline this runs until the caller gives up, and without
  // progress there is no way to tell a slow stage from a stuck one. A live
  // run crawls real sites and calls the provider once per program, so both
  // are required to get a usable measurement rather than a hang.
  const deadlineMs = Math.max(30_000, Number(argument('deadline-ms', '10800000')) || 10_800_000)
  const deadline = setTimeout(() => controller.abort(new Error('benchmark deadline reached')), deadlineMs)
  const started = Date.now()
  const stageAt = new Map()
  const onProgress = (event) => {
    const phase = event?.phase || event?.stage || event?.id || 'progress'
    if (!stageAt.has(phase)) {
      stageAt.set(phase, Date.now() - started)
      process.stderr.write(`[${String(Date.now() - started).padStart(7)}ms] ${phase}\n`)
    }
  }
  const scenarioName = String(argument('scenario', 'uk-neuro'))
  const scenario = LIVE_SCENARIOS[scenarioName]
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`)
  const provider = String(argument('provider', 'openai')).trim()
  const baseUrl = String(argument(
    'base-url',
    provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://sub2api.luchikey.com',
  )).trim()
  const model = String(argument(
    'model',
    provider === 'deepseek' ? 'deepseek-v4-flash' : 'gpt-5.6-luna',
  )).trim()
  const configuredConcurrency = Math.max(1, Math.min(
    2_500,
    Number(argument('concurrency', provider === 'deepseek' ? '2500' : '800')) || 1,
  ))
  const goldArgument = String(argument('gold', 'docs/discover-gold-set.json')).trim()
  const goldFocus = String(argument('gold-focus', 'false')).trim().toLowerCase() === 'true'
  let goldSet = null
  if (goldArgument) {
    try {
      const goldDocument = JSON.parse(await readFile(resolve(process.cwd(), goldArgument), 'utf8'))
      goldSet = goldDocument?.scenarios?.[scenarioName] || null
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  const checkpointArgument = String(argument('checkpoint', '')).trim()
  const checkpointPath = checkpointArgument ? resolve(process.cwd(), checkpointArgument) : ''
  let checkpoint = null
  if (checkpointPath) {
    try {
      checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  const onCheckpoint = checkpointPath
    ? async (value) => {
        const temporaryPath = `${checkpointPath}.tmp`
        await mkdir(dirname(checkpointPath), { recursive: true })
        await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temporaryPath, checkpointPath)
      }
    : null
  const state = normalizeDiscoverState({
    ...defaultDiscoverState(),
    intake: {
      ...defaultDiscoverState().intake,
      // Legacy count fields remain serialized for backward-compatible drafts,
      // but the evidence-exhaustive pipeline never reads them as result caps.
      field: String(argument('field', scenario.field)),
      subfields: String(argument('subfields', scenario.subfields.join(',')))
        .split(',').map((value) => value.trim()).filter(Boolean),
      regions: String(argument('regions', scenario.regions.join(','))).split(',').map((value) => value.trim()).filter(Boolean),
      notes: String(argument('notes', scenario.notes)),
    },
    researchRuns: 1,
    customPrograms: [],
    catalogSource: 'custom',
    officialResearchOnly: true,
    intakeCompleted: true,
  })
  let result
  const benchmarkKey = {
    id: `benchmark-env-key-${provider}`,
    provider,
    baseUrl,
    model,
    apiKey,
    ownerId: 'benchmark',
    maxConcurrency: configuredConcurrency,
  }
  let capability
  let capabilityVerification = { mode: 'live-probe', observedAt: null }
  try {
    const capabilityProofArgument = String(argument('capability-proof', '')).trim()
    if (capabilityProofArgument) {
      const proof = JSON.parse(await readFile(resolve(process.cwd(), capabilityProofArgument), 'utf8'))
      capability = validateDiscoverCapabilityProof(proof, {
        provider,
        baseUrl,
        model,
      })
      if (!capability) throw new Error('Capability proof is stale, incomplete, or does not match the benchmark target.')
      capabilityVerification = {
        mode: 'recent-live-proof',
        observedAt: capability.proofObservedAt,
      }
      onProgress({ phase: 'capability-proof-reused' })
    } else {
      capability = await testAiResearchKeyConnection(benchmarkKey, controller.signal)
    }
    result = await buildDiscoverResearchRun({
      state,
      input: { useAi: true, acceptSuggestions: true },
      aiKey: benchmarkKey,
      applicantProfile: scenario.profile,
      checkpoint,
      onCheckpoint,
      recordUsage: async () => undefined,
      evidenceHydrationOptions: { retries },
      onProgress,
      signal: controller.signal,
      evaluationSchoolAllowlist: goldFocus && goldSet
        ? goldSet.programs.flatMap((program) => [program.school, ...(program.schoolAliases || [])])
        : null,
      evaluationSources: goldFocus ? evaluationSourcesForGoldSet(goldSet, scenario.regions) : null,
    })
  } finally {
    clearTimeout(deadline)
  }
  const quality = result.sourceIndex?.quality || {}
  const stageTimings = Object.fromEntries(stageAt)
  const advisorCount = (result.nextState?.customPrograms || []).reduce(
    (total, program) => total + (program.pis?.length || 0),
    0,
  )
  const acceptance = evaluateDiscoverResearchResult(result, {
    scenario: scenarioName,
    requestedPrograms: null,
    requestedPis: null,
    coverageMode: 'evidence-exhaustive',
    evaluationScope: goldFocus ? 'independent-gold-schools' : 'selected-regions',
    goldSet,
    enforceRichness: true,
    enforceGoldCoverage: Boolean(goldSet),
  })
  return {
    schemaVersion: 3,
    mode: 'live',
    coverageMode: 'evidence-exhaustive',
    scenario: scenarioName,
    provider,
    model,
    configuredConcurrency,
    capability: capability?.capabilities || null,
    capabilityVerification,
    retries,
    elapsedMs: Date.now() - started,
    programCount: result.nextState?.customPrograms?.length || 0,
    advisorCount,
    sourcedProgramCount: quality.sourcedProgramCount || 0,
    verifiedAdvisorProfiles: quality.verifiedAdvisorProfiles || 0,
    stageTimings,
    warnings: quality.warnings || [],
    failures: quality.failures || [],
    funnel: result.sourceIndex?.funnel || null,
    acceptance,
    returnedRecords: buildDiscoverResearchRecordLedger(result),
  }
}

const mode = String(argument('mode', 'fixture'))
const retries = Math.max(0, Math.min(2, Number(argument('retries', '1')) || 0))
let result
try {
  result = mode === 'live'
    ? await benchmarkLive(retries)
    : await benchmarkFixture(retries)
} catch (error) {
  process.exitCode = 1
  result = {
    schemaVersion: 3,
    mode,
    status: 'error',
    passed: false,
    error: {
      name: String(error?.name || 'Error').slice(0, 120),
      code: String(error?.code || 'BENCHMARK_FAILED').slice(0, 120),
      message: String(error?.message || error).slice(0, 1_000),
      status: Number.isInteger(error?.status) ? error.status : null,
      upstreamStatus: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
      details: error?.details && typeof error.details === 'object' ? error.details : null,
    },
  }
}
const serialized = `${JSON.stringify(result, null, 2)}\n`
const output = argument('output', '')
if (output) {
  const outputPath = resolve(process.cwd(), output)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, serialized, { encoding: 'utf8', mode: 0o600 })
}
console.log(serialized.trimEnd())
