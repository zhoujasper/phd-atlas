import {
  PHASE12_SOURCE_ADAPTERS,
  PHASE12_SOURCE_REGISTRY,
  validatePhase12Registry,
} from '../server/sources/sourceRegistry.js'

const live = process.argv.includes('--live')
const details = process.argv.includes('--details')
const sourceFilter = process.argv.find((argument) => argument.startsWith('--source='))
  ?.slice('--source='.length)
  .trim() || ''

const registry = validatePhase12Registry(PHASE12_SOURCE_REGISTRY)
const report = {
  phase: 12,
  notRun: !live,
  reason: live ? undefined : '沙箱无外网',
  registry,
  adapters: PHASE12_SOURCE_REGISTRY.map((config) => ({
    id: config.id,
    name: config.name,
    kind: config.kind,
    enabled: config.enabled,
    rateLimitPerMin: config.rateLimitPerMin,
    concurrency: config.concurrency,
    cacheTtlMs: config.cacheTtlMs,
    robotsPolicy: config.robotsPolicy,
    timeoutMs: config.timeoutMs,
  })),
}

const defaultQueries = {
  'nsf-awards': { keyword: 'machine learning', limit: 25 },
  'nih-reporter': {
    keyword: 'machine learning',
    fiscalYears: [2024, 2025, 2026],
    limit: 50,
  },
  'openalex-works': {
    search: 'machine learning doctoral research',
    countryCode: 'US',
    limit: 25,
  },
  'gradcafe-results': {
    keyword: 'PhD computer science',
    year: new Date().getUTCFullYear() - 1,
  },
  'reddit-submissions': {
    keyword: 'PhD admissions timeline',
    limit: 25,
  },
}

function completeness(records) {
  const requiredFields = {
    'nsf-awards': ['id', 'title', 'piName', 'startDate', 'expDate'],
    'nih-reporter': ['applicationId', 'projectNumber', 'title', 'piName'],
    'openalex-works': ['id', 'title', 'authors', 'publicationDate'],
    'gradcafe-results': ['school', 'program', 'decision'],
    'reddit-submissions': ['id', 'title', 'permalink'],
  }
  const fields = requiredFields[records[0]?.sourceId] || []
  const total = records.length * fields.length
  const present = records.reduce((count, record) => (
    count + fields.filter((field) => Boolean(record.value?.[field])).length
  ), 0)
  return {
    recordCount: records.length,
    fieldCount: fields.length,
    completenessRate: total ? Number((present / total).toFixed(4)) : null,
  }
}

if (!live) {
  if (!registry.passed) process.exitCode = 1
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  const adapters = sourceFilter
    ? PHASE12_SOURCE_ADAPTERS.filter((adapter) => adapter.config.id === sourceFilter)
    : PHASE12_SOURCE_ADAPTERS
  const results = []
  for (const adapter of adapters) {
    const startedAt = Date.now()
    try {
      const result = await adapter.run(defaultQueries[adapter.config.id] || {}, {
        fetchImpl: globalThis.fetch,
        timeoutMs: Number(process.env.PHASE12_LIVE_TIMEOUT_MS || 25_000),
        retry: { maxAttempts: 3 },
      })
      results.push({
        sourceId: adapter.config.id,
        status: result.status,
        recordCount: result.records.length,
        warnings: result.warnings,
        ...completeness(result.records),
        elapsedMs: Date.now() - startedAt,
        ...(details ? { meta: result.meta } : {}),
      })
    } catch (error) {
      results.push({
        sourceId: adapter.config.id,
        status: 'error',
        error: {
          name: error?.name,
          code: error?.code,
          message: error?.message,
        },
        elapsedMs: Date.now() - startedAt,
      })
    }
  }
  const unavailable = []
  const failures = results.filter((result) => result.status === 'error')
  report.live = {
    checkedAt: new Date().toISOString(),
    sourceCount: results.length,
    passedCount: results.length - failures.length - unavailable.length,
    unavailableCount: unavailable.length,
    failedCount: failures.length,
    passed: failures.length === 0 && results.length > 0,
    results,
  }
  if (failures.length) process.exitCode = 1
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
