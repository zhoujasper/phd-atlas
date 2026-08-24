import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(desktopRoot)

const PLATFORM_TARGETS = Object.freeze({
  windows: Object.freeze({
    pattern(version) {
      return new RegExp(
        `^PhDAtlas-${escapeRegExp(version)}-win-(x64|arm64)-(setup|portable)\\.exe$`,
        'u',
      )
    },
    requiredKinds: Object.freeze(['portable', 'setup']),
  }),
  macos: Object.freeze({
    pattern(version) {
      return new RegExp(
        `^PhDAtlas-${escapeRegExp(version)}-mac-(x64|arm64)\\.(dmg|zip)$`,
        'u',
      )
    },
    requiredKinds: Object.freeze(['dmg', 'zip']),
  }),
})

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeDesktopReleasePlatform(value = process.platform) {
  if (value === 'win32' || value === 'windows') return 'windows'
  if (value === 'darwin' || value === 'macos') return 'macos'
  throw new Error(`Unsupported desktop release platform: ${value}`)
}

export async function collectDesktopReleaseArtifacts({
  outputDirectory,
  platform,
  version,
}) {
  const normalizedPlatform = normalizeDesktopReleasePlatform(platform)
  const target = PLATFORM_TARGETS[normalizedPlatform]
  const matches = []
  for (const name of await readdir(outputDirectory)) {
    const match = target.pattern(version).exec(name)
    if (!match) continue
    matches.push({
      name,
      path: path.join(outputDirectory, name),
      arch: match[1],
      kind: match[2],
    })
  }
  matches.sort((left, right) => left.name.localeCompare(right.name))

  const architectures = [...new Set(matches.map((entry) => entry.arch))]
  const kinds = [...new Set(matches.map((entry) => entry.kind))].sort()
  if (architectures.length !== 1) {
    throw new Error(
      `Expected one ${normalizedPlatform} desktop architecture, found: ${architectures.join(', ') || '(none)'}`,
    )
  }
  if (JSON.stringify(kinds) !== JSON.stringify([...target.requiredKinds].sort())) {
    throw new Error(
      `Expected ${target.requiredKinds.join(' and ')} ${normalizedPlatform} artifacts for ${version}; `
      + `found: ${matches.map((entry) => entry.name).join(', ') || '(none)'}`,
    )
  }
  return {
    platform: normalizedPlatform,
    version,
    arch: architectures[0],
    artifacts: matches,
  }
}

export async function prepareDesktopReleaseArtifacts(options) {
  const receipt = await collectDesktopReleaseArtifacts(options)
  const artifacts = []
  for (const entry of receipt.artifacts) {
    const contents = await readFile(entry.path)
    const sha256 = createHash('sha256').update(contents).digest('hex')
    const checksumPath = `${entry.path}.sha256`
    await writeFile(checksumPath, `${sha256}  ${entry.name}\n`)
    artifacts.push({
      name: entry.name,
      checksumName: path.basename(checksumPath),
      sha256,
      bytes: contents.byteLength,
    })
  }
  return {
    platform: receipt.platform,
    version: receipt.version,
    arch: receipt.arch,
    artifacts,
  }
}

function parseArguments(argv) {
  const options = {
    outputDirectory: path.join(projectRoot, 'dist-desktop'),
    platform: process.platform,
    version: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--platform') {
      options.platform = argv[index + 1]
      index += 1
    } else if (argument === '--output') {
      options.outputDirectory = path.resolve(argv[index + 1])
      index += 1
    } else if (argument === '--version') {
      options.version = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unknown desktop artifact argument: ${argument}`)
    }
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (!options.version) {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    options.version = packageJson.version
  }
  const receipt = await prepareDesktopReleaseArtifacts(options)
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
