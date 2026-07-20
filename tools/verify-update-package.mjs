import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyUpdatePackage, validateUpdatePackage } from '../server/systemUpdate.js'

const packagePath = path.resolve(process.argv[2] ?? '')
if (!process.argv[2]) {
  throw new Error('Usage: node tools/verify-update-package.mjs <package.tar.gz>')
}

const __filename = fileURLToPath(import.meta.url)
const sourceRoot = path.resolve(path.dirname(__filename), '..')
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-update-test-'))

async function createInstalledFixture(name) {
  const root = path.join(tempRoot, name)
  await fs.mkdir(path.join(root, 'storage'), { recursive: true })
  for (const entry of ['dist', 'server', 'tools', 'package.json', 'package-lock.json']) {
    await fs.cp(path.join(sourceRoot, entry), path.join(root, entry), { recursive: true })
  }
  await fs.writeFile(path.join(root, 'server', 'pre-update-sentinel.txt'), 'previous-runtime', 'utf8')
  return root
}

try {
  const validation = await validateUpdatePackage(packagePath, path.join(tempRoot, 'validation'))
  await fs.rm(validation.extractRoot, { recursive: true, force: true })

  const successRoot = await createInstalledFixture('success')
  const success = await applyUpdatePackage({
    packagePath,
    projectRoot: successRoot,
    storageRoot: path.join(successRoot, 'storage'),
    installDependencies: async () => {},
  })
  const installedPackage = JSON.parse(await fs.readFile(path.join(successRoot, 'package.json'), 'utf8'))
  if (!success.ok || installedPackage.version !== validation.manifest.version) {
    throw new Error('Update success-path verification did not install the manifest version.')
  }

  const rollbackRoot = await createInstalledFixture('rollback')
  let rollbackFailedAsExpected = false
  try {
    await applyUpdatePackage({
      packagePath,
      projectRoot: rollbackRoot,
      storageRoot: path.join(rollbackRoot, 'storage'),
      installDependencies: async () => {
        throw new Error('Intentional dependency-install failure')
      },
    })
  } catch {
    rollbackFailedAsExpected = true
  }
  const restoredSentinel = await fs.readFile(path.join(rollbackRoot, 'server', 'pre-update-sentinel.txt'), 'utf8')
  if (!rollbackFailedAsExpected || restoredSentinel !== 'previous-runtime') {
    throw new Error('Update rollback-path verification did not restore the previous runtime.')
  }

  console.log(`Verified update package ${path.basename(packagePath)} (install + rollback).`)
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}
