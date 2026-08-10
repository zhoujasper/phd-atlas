import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { materializeUpdateDelta } from '../server/updateDelta.js'

const baseArgument = process.argv[2]
const deltaArgument = process.argv[3]
if (!baseArgument || !deltaArgument) {
  throw new Error(
    'Usage: node tools/verify-update-delta.mjs <base-package.tar.gz> <delta-package.tar.gz>',
  )
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-delta-test-'))
const outputPackagePath = path.join(tempRoot, 'materialized-update.tar.gz')
try {
  const result = await materializeUpdateDelta({
    deltaPackagePath: path.resolve(deltaArgument),
    basePackagePath: path.resolve(baseArgument),
    outputPackagePath,
    workRoot: path.join(tempRoot, 'work'),
  })
  console.log(
    `Verified differential update ${path.basename(deltaArgument)} `
    + `(${result.fromVersion} -> ${result.toVersion}, ${result.changedFileCount} changed, `
    + `${result.removedFileCount} removed) by reconstructing a complete validated package.`,
  )
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}
