import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadReleaseUpdate, parseSemver } from '../server/releaseUpdate.js'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index >= 0 ? String(args[index + 1] ?? '').trim() : ''
}

function usage() {
  return [
    'Usage: npm run verify:published-update -- --from <installed-version> [--tag <v-version>]',
    '',
    `The default tag is v${packageJson.version}.`,
  ].join('\n')
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(usage())
  process.exit(0)
}

const currentVersion = option('--from')
const tagName = option('--tag') || `v${packageJson.version}`
const parsedCurrent = parseSemver(currentVersion)
const parsedTarget = parseSemver(tagName)
if (
  !parsedCurrent
  || !parsedTarget
  || tagName !== `v${parsedTarget.value}`
  || args.some((value, index) => value.startsWith('-') && !['--from', '--tag'].includes(value) && args[index - 1] !== '--from' && args[index - 1] !== '--tag')
) {
  throw new Error(usage())
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-published-update-'))
let lastStatusKey = ''
let lastProgressBucket = -1

try {
  const downloaded = await downloadReleaseUpdate({
    tagName,
    currentVersion: parsedCurrent.value,
    destinationRoot: tempRoot,
    onStatus(status) {
      const key = `${status.phase}:${status.source ?? ''}`
      const progressBucket = status.total > 0
        ? Math.floor((Number(status.bytes ?? 0) / Number(status.total)) * 10)
        : -1
      if (key === lastStatusKey && progressBucket === lastProgressBucket) return
      lastStatusKey = key
      lastProgressBucket = progressBucket
      const progress = status.total > 0
        ? ` ${Math.min(100, Math.max(0, progressBucket * 10))}%`
        : ''
      console.log(`[published-update] ${status.phase} via ${status.source ?? 'n/a'}${progress}`)
    },
  })

  console.log(
    `[published-update] downloaded ${downloaded.fileName} `
    + `(${downloaded.size} bytes, sha256:${downloaded.sha256}) via `
    + `${downloaded.source.kind}:${downloaded.source.id}`,
  )
  const verification = spawnSync(
    process.execPath,
    [path.join(sourceRoot, 'tools', 'verify-update-package.mjs'), downloaded.packagePath],
    {
      cwd: sourceRoot,
      stdio: 'inherit',
    },
  )
  if (verification.error) throw verification.error
  if (verification.status !== 0) {
    throw new Error(`Published update package verification exited with status ${verification.status}.`)
  }
  console.log(`[published-update] ${currentVersion} -> ${tagName} verified successfully.`)
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}
