import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
  cwd: projectRoot,
  encoding: 'utf8',
  windowsHide: true,
})
if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(result.stderr.trim() || 'Could not configure the local Git hooks path.')
}
console.log('Installed strict repository hooks from .githooks/.')
