import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGunzip, createGzip } from 'node:zlib'
import tar from 'tar-fs'
import {
  applyUpdatePackage,
  readActiveUpdatePackage,
  UPDATE_RESULT_NAME,
  UPDATE_RUNTIME_INVALID_NAME,
  validateUpdatePackage,
} from '../server/systemUpdate.js'

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

async function createPackageWithUnmanifestedRuntimeFile(sourcePackage) {
  const extractRoot = path.join(tempRoot, 'unmanifested-package')
  const outputPath = path.join(tempRoot, 'unmanifested-package.tar.gz')
  await fs.mkdir(extractRoot, { recursive: true })
  await pipeline(
    createReadStream(sourcePackage),
    createGunzip(),
    tar.extract(extractRoot),
  )
  await fs.writeFile(
    path.join(extractRoot, 'server', 'unmanifested-verification-sentinel.js'),
    'throw new Error("This unmanifested file must never be installed.")\n',
    'utf8',
  )
  await pipeline(
    tar.pack(extractRoot),
    createGzip(),
    createWriteStream(outputPath),
  )
  return outputPath
}

try {
  const validation = await validateUpdatePackage(packagePath, path.join(tempRoot, 'validation'))
  await fs.rm(validation.extractRoot, { recursive: true, force: true })

  const packageWithExtraFile = await createPackageWithUnmanifestedRuntimeFile(packagePath)
  let unmanifestedFileRejected = false
  try {
    await validateUpdatePackage(packageWithExtraFile, path.join(tempRoot, 'extra-file-validation'))
  } catch (error) {
    unmanifestedFileRejected = error?.code === 'INVALID_UPDATE_PACKAGE'
  }
  if (!unmanifestedFileRejected) {
    throw new Error('Update validation accepted an unmanifested runtime file.')
  }

  const successRoot = await createInstalledFixture('success')
  const successStorage = path.join(successRoot, 'storage')
  const stagedSuccessPackage = path.join(successStorage, 'staged-update.tar.gz')
  await fs.copyFile(packagePath, stagedSuccessPackage)
  const success = await applyUpdatePackage({
    packagePath: stagedSuccessPackage,
    projectRoot: successRoot,
    storageRoot: successStorage,
    installDependencies: async () => {},
    runtimePreflight: async () => {},
    allowSameVersion: true,
  })
  await fs.rm(stagedSuccessPackage, { force: true })
  const installedPackage = JSON.parse(await fs.readFile(path.join(successRoot, 'package.json'), 'utf8'))
  const activeUpdate = await readActiveUpdatePackage(successStorage)
  if (
    !success.ok
    || installedPackage.version !== validation.manifest.version
    || activeUpdate?.version !== validation.manifest.version
  ) {
    throw new Error('Update success-path verification did not install the manifest version.')
  }

  const rollbackRoot = await createInstalledFixture('rollback')
  const rollbackStorage = path.join(rollbackRoot, 'storage')
  let rollbackInstallCalls = 0
  let rollbackFailedAsExpected = false
  try {
    await applyUpdatePackage({
      packagePath,
      projectRoot: rollbackRoot,
      storageRoot: rollbackStorage,
      runtimePreflight: async () => {},
      allowSameVersion: true,
      installDependencies: async () => {
        rollbackInstallCalls += 1
        if (rollbackInstallCalls === 1) throw new Error('Intentional dependency-install failure')
      },
    })
  } catch (error) {
    rollbackFailedAsExpected = error?.code === 'UPDATE_APPLY_FAILED'
  }
  const restoredSentinel = await fs.readFile(path.join(rollbackRoot, 'server', 'pre-update-sentinel.txt'), 'utf8')
  const rollbackResult = JSON.parse(await fs.readFile(path.join(rollbackStorage, UPDATE_RESULT_NAME), 'utf8'))
  if (
    !rollbackFailedAsExpected
    || restoredSentinel !== 'previous-runtime'
    || rollbackResult.rollbackFailed
    || rollbackInstallCalls !== 2
  ) {
    throw new Error('Update rollback-path verification did not restore the previous runtime.')
  }

  const failedRollbackRoot = await createInstalledFixture('failed-rollback')
  const failedRollbackStorage = path.join(failedRollbackRoot, 'storage')
  let incompleteRollbackRejected = false
  try {
    await applyUpdatePackage({
      packagePath,
      projectRoot: failedRollbackRoot,
      storageRoot: failedRollbackStorage,
      runtimePreflight: async () => {},
      allowSameVersion: true,
      installDependencies: async () => {
        throw new Error('Intentional dependency restore failure')
      },
    })
  } catch (error) {
    incompleteRollbackRejected = error?.code === 'UPDATE_ROLLBACK_FAILED' && error?.rollbackFailed === true
  }
  const failedRollbackResult = JSON.parse(await fs.readFile(path.join(failedRollbackStorage, UPDATE_RESULT_NAME), 'utf8'))
  await fs.access(path.join(failedRollbackStorage, UPDATE_RUNTIME_INVALID_NAME))
  if (!incompleteRollbackRejected || !failedRollbackResult.rollbackFailed || !failedRollbackResult.rollbackError) {
    throw new Error('Update verification did not fail closed after an incomplete dependency rollback.')
  }

  console.log(`Verified update package ${path.basename(packagePath)} (manifest boundary + install + active replay source + rollback safety).`)
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}
