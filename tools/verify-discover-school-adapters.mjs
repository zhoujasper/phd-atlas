import { DISCOVER_SCHOOL_ADAPTERS } from '../server/discover-school-adapters/catalog.js'
import { validateSchoolAdapterCoverage } from '../server/discover-school-adapters/adapter-validator.js'
import { checkSchoolAdaptersLive } from '../server/discover-school-adapters/live-health.js'
import { DISCOVER_SOURCE_REGISTRY } from '../server/discover-source-registry.js'

const live = process.argv.includes('--live')
const summaryOnly = process.argv.includes('--summary')
const details = process.argv.includes('--details')
const progress = process.argv.includes('--progress')
const schoolArg = process.argv.find((arg) => arg.startsWith('--school='))
const exactSchoolArg = process.argv.find((arg) => arg.startsWith('--exact-school='))
const school = schoolArg ? schoolArg.slice('--school='.length).trim() : ''
const exactSchool = exactSchoolArg ? exactSchoolArg.slice('--exact-school='.length).trim() : ''
const numberArg = (name, fallback) => {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`))
  const parsed = Number(argument?.slice(name.length + 3))
  return Number.isFinite(parsed) ? parsed : fallback
}
const selectedAdapters = exactSchool
  ? DISCOVER_SCHOOL_ADAPTERS.filter((adapter) => adapter.school.toLowerCase() === exactSchool.toLowerCase())
  : school
    ? DISCOVER_SCHOOL_ADAPTERS.filter((adapter) => adapter.school.toLowerCase().includes(school.toLowerCase()))
  : DISCOVER_SCHOOL_ADAPTERS

const coverage = validateSchoolAdapterCoverage(
  DISCOVER_SCHOOL_ADAPTERS,
  DISCOVER_SOURCE_REGISTRY,
  { minimumSchools: 100 },
)

const report = { coverage }
if (!coverage.passed) process.exitCode = 1

if (live) {
  if (!selectedAdapters.length) {
    report.live = { passed: false, failures: [{ reason: `No adapter matched ${exactSchool || school}` }] }
    process.exitCode = 1
  } else {
    const result = await checkSchoolAdaptersLive(selectedAdapters, {
      concurrency: numberArg('concurrency', 4),
      timeoutMs: numberArg('timeout-ms', 15_000),
      perHostDelayMs: numberArg('per-host-delay-ms', 1_000),
      retries: numberArg('retry', 1),
      onProgress: progress
        ? ({ completed, total, result: row }) => {
            if (completed === 1 || completed % 25 === 0 || completed === total) {
              process.stderr.write(`[discover-adapters] ${completed}/${total} ${row?.school || ''} ${row?.kind || ''} ${row?.ok ? 'ok' : row?.reason || 'failed'}\n`)
            }
          }
        : undefined,
    })
    const schools = new Map()
    const byKind = {}
    const byReason = {}
    for (const row of result.results) {
      schools.set(row.school, (schools.get(row.school) ?? true) && row.ok)
      const kind = byKind[row.kind] || { total: 0, passed: 0, failed: 0 }
      kind.total += 1
      if (row.ok) kind.passed += 1
      else kind.failed += 1
      byKind[row.kind] = kind
      if (!row.ok) byReason[row.reason || 'unknown'] = (byReason[row.reason || 'unknown'] || 0) + 1
    }
    report.live = {
      checkedAt: result.checkedAt,
      schoolCount: result.schoolCount,
      seedCount: result.seedCount,
      passedSeedCount: result.passedSeedCount,
      failedSeedCount: result.failedSeedCount,
      fullyPassingSchoolCount: [...schools.values()].filter(Boolean).length,
      schoolsWithFailures: [...schools.values()].filter((value) => !value).length,
      failingSchoolNames: [...new Set(result.failures.map((row) => row.school))].sort(),
      byKind,
      byReason,
      passed: result.passed,
      failures: summaryOnly ? result.failures.slice(0, 30) : result.failures,
    }
    if (details) report.live.results = result.results
    if (!result.passed) process.exitCode = 1
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
