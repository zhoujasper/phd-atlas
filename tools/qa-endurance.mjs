import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installWorkerFatalDiagnostics } from './start-server.mjs'
import {
  parseQaConcurrencyArgs,
  runQaConcurrency,
  sanitizeQaDiagnostic,
} from './qa-concurrency.mjs'

if (
  process.env.PHD_ATLAS_QA_ENABLE_FATAL_DIAGNOSTICS === '1'
  && process.env.PHD_ATLAS_STORAGE_ROOT
) {
  installWorkerFatalDiagnostics(process.env.PHD_ATLAS_STORAGE_ROOT)
}

function normalizeEnduranceArg(argument) {
  const aliases = new Map([
    ['--duration-ms', '--endurance-duration-ms'],
    ['--connections-duration-ms', '--endurance-connections-duration-ms'],
    ['--scenarios', '--endurance-scenarios'],
    ['--autosave-users', '--endurance-autosave-users'],
    ['--sse-clients', '--endurance-sse-clients'],
    ['--websockets', '--endurance-websockets'],
    ['--rss-samples', '--endurance-rss-samples'],
    ['--read-interval-ms', '--endurance-read-interval-ms'],
  ])
  const equalsIndex = argument.indexOf('=')
  const name = equalsIndex < 0 ? argument : argument.slice(0, equalsIndex)
  const value = equalsIndex < 0 ? '' : argument.slice(equalsIndex)
  return `${aliases.get(name) ?? name}${value}`
}

export function qaEnduranceArgs(argv = []) {
  const normalized = argv.map(normalizeEnduranceArg)
  if (
    !normalized.includes('--endurance')
    && !normalized.includes('--no-endurance')
    && !normalized.some((argument) => argument.startsWith('--endurance-scenarios='))
  ) {
    // Endurance must be present before option parsing. The parser derives the
    // per-phase and overall supervisors from the selected scenario durations;
    // enabling it afterwards left the 5m + 5m + 10m sequential qualification
    // under the ordinary 15-minute wall clock and guaranteed a false timeout.
    normalized.push('--endurance')
  }
  return normalized
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = qaEnduranceArgs(process.argv.slice(2))
  const options = parseQaConcurrencyArgs(argv)

  const report = await runQaConcurrency(options)
  process.stdout.write(`${JSON.stringify(sanitizeQaDiagnostic(report), null, 2)}\n`)
  if (report.status !== 'pass') process.exitCode = 1
}
