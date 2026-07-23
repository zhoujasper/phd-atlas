import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyUpdatePackage,
  claimUpdateLock,
  clearUpdateLock,
} from '../server/systemUpdate.js'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '..')
const storageRoot = path.join(projectRoot, 'storage')
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1])
}
const packagePath = path.resolve(args.get('--package') ?? '')
const previousPid = Number(args.get('--pid') ?? 0)

async function processExists(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPreviousProcess() {
  const deadline = Date.now() + 60_000
  while (await processExists(previousPid)) {
    if (Date.now() >= deadline) throw new Error('The previous server process did not stop in time.')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function installDependencies(cwd) {
  return new Promise((resolve, reject) => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawn(npmCommand, ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd,
      windowsHide: true,
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`npm ci exited with code ${code}.`)))
  })
}

let exitCode = 0
let preserveUpdateLock = false
try {
  await claimUpdateLock(storageRoot, {
    packagePath,
    helperPid: process.pid,
  })
  await fs.access(packagePath)
  await waitForPreviousProcess()
  await applyUpdatePackage({
    packagePath,
    projectRoot,
    storageRoot,
    installDependencies,
  })
} catch (error) {
  exitCode = 1
  preserveUpdateLock = error?.code === 'UPDATE_ROLLBACK_FAILED'
    || error?.code === 'UPDATE_BOOT_ROLLBACK_FAILED'
  await fs.appendFile(
    path.join(storageRoot, 'update-helper.log'),
    `${new Date().toISOString()} ${error?.stack ?? error}\n`,
    'utf8',
  ).catch(() => {})
} finally {
  if (!preserveUpdateLock) {
    await clearUpdateLock(storageRoot, {
      packagePath,
      helperPid: process.pid,
    }).catch(() => {})
  }
}

process.exit(exitCode)
