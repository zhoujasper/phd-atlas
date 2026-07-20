import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD_ID_TOKEN = '__PHD_ATLAS_BUILD_ID__'

function collectFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const filePath = join(directory, entry.name)
      if (entry.isDirectory()) return collectFiles(root, filePath)
      if (!entry.isFile()) return []
      return [filePath]
    })
    .sort((left, right) => relative(root, left).localeCompare(relative(root, right)))
}

function normalizedRelativePath(root, filePath) {
  return relative(root, filePath).replaceAll('\\', '/')
}

export function createBuildId(outputRoot) {
  const root = resolve(outputRoot)
  const serviceWorkerPath = join(root, 'sw.js')
  const serviceWorkerSource = readFileSync(serviceWorkerPath, 'utf8')
  if (!serviceWorkerSource.includes(BUILD_ID_TOKEN)) {
    throw new Error(`Expected ${BUILD_ID_TOKEN} in ${serviceWorkerPath}.`)
  }

  const hash = createHash('sha256')
  for (const filePath of collectFiles(root)) {
    const fileName = normalizedRelativePath(root, filePath)
    const contents = filePath === serviceWorkerPath
      ? Buffer.from(serviceWorkerSource)
      : readFileSync(filePath)
    hash.update(fileName)
    hash.update('\0')
    hash.update(contents)
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

export function stampServiceWorker(outputRoot) {
  const root = resolve(outputRoot)
  const serviceWorkerPath = join(root, 'sw.js')
  const source = readFileSync(serviceWorkerPath, 'utf8')
  const buildId = createBuildId(root)
  const stamped = source.replaceAll(BUILD_ID_TOKEN, buildId)

  if (stamped.includes(BUILD_ID_TOKEN)) {
    throw new Error(`Could not stamp ${serviceWorkerPath}.`)
  }

  writeFileSync(serviceWorkerPath, stamped, 'utf8')
  return buildId
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null

if (invokedFile === currentFile) {
  const outputRoot = resolve(process.cwd(), process.argv[2] ?? 'dist')
  const buildId = stampServiceWorker(outputRoot)
  console.log(`Stamped service worker cache version ${buildId}`)
}
