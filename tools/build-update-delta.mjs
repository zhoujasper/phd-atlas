import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUpdateDeltaPackage } from '../server/updateDelta.js'

const baseArgument = process.argv[2]
const targetArgument = process.argv[3]
const outputArgument = process.argv[4]
if (!baseArgument || !targetArgument) {
  throw new Error(
    'Usage: node tools/build-update-delta.mjs <base-package.tar.gz> <target-package.tar.gz> [output.tar.gz]',
  )
}

const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolRoot, '..')
const basePackagePath = path.resolve(baseArgument)
const targetPackagePath = path.resolve(targetArgument)
const outputRoot = path.join(projectRoot, 'storage', 'update-packages')
const workRoot = path.join(projectRoot, 'storage', 'update-delta-work')
await fs.mkdir(outputRoot, { recursive: true })
await fs.mkdir(workRoot, { recursive: true })

const temporaryOutput = outputArgument
  ? path.resolve(outputArgument)
  : path.join(outputRoot, `.phd-atlas-delta-building-${process.pid}.tar.gz`)
const result = await createUpdateDeltaPackage({
  basePackagePath,
  targetPackagePath,
  outputPath: temporaryOutput,
  workRoot,
})
const canonicalOutput = outputArgument
  ? temporaryOutput
  : path.join(
      outputRoot,
      `phd-atlas-delta-${result.fromVersion}-to-${result.toVersion}-release.tar.gz`,
    )
if (canonicalOutput !== temporaryOutput) {
  await fs.rm(canonicalOutput, { force: true })
  await fs.rename(temporaryOutput, canonicalOutput)
}

const hash = createHash('sha256')
for await (const chunk of createReadStream(canonicalOutput)) hash.update(chunk)
const checksumPath = `${canonicalOutput}.sha256`
await fs.writeFile(
  checksumPath,
  `${hash.digest('hex')}  ${path.basename(canonicalOutput)}\n`,
  'ascii',
)

const savedBytes = result.fullSize - result.size
const reduction = result.fullSize > 0 ? savedBytes * 100 / result.fullSize : 0
console.log(`Differential update written to ${canonicalOutput}`)
console.log(`SHA-256 checksum written to ${checksumPath}`)
console.log(
  `Changed ${result.changedFileCount} files, removed ${result.removedFileCount}; `
  + `${result.size} bytes versus ${result.fullSize} bytes full (${reduction.toFixed(1)}% smaller).`,
)

