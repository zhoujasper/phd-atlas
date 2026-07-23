import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const root = process.env.NODE_ENV === 'test'
  ? path.join(projectRoot, 'logs', 'tmp', `discover-research-jobs-${process.pid}`)
  : path.join(projectRoot, 'storage', 'discover-research-jobs')

const RETRYABLE_RENAME_CODES = new Set(['EACCES', 'EBUSY', 'EEXIST', 'EPERM'])
export const DISCOVER_RESEARCH_PIPELINE_VERSION = 2

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function replaceCheckpoint(temporary, target) {
  try {
    await fs.rename(temporary, target)
    return
  } catch (error) {
    if (!RETRYABLE_RENAME_CODES.has(error?.code)) throw error
  }
  const previous = `${target}.previous-${process.pid}-${Date.now()}`
  let movedPrevious = false
  try {
    try {
      await fs.rename(target, previous)
      movedPrevious = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fs.rename(temporary, target)
        if (movedPrevious) await fs.rm(previous, { force: true })
        return
      } catch (error) {
        if (!RETRYABLE_RENAME_CODES.has(error?.code) || attempt === 5) throw error
        await sleep(25 * (2 ** attempt))
      }
    }
  } catch (error) {
    if (movedPrevious) {
      try {
        await fs.access(target)
      } catch {
        await fs.rename(previous, target).catch(() => undefined)
      }
    }
    throw error
  }
}

export function isDiscoverResearchCheckpointCompatible(checkpoint, state) {
  if (checkpoint?.pipelineVersion !== DISCOVER_RESEARCH_PIPELINE_VERSION) return false
  const checkpointIntake = checkpoint?.workingState?.intake
  const currentIntake = state?.intake
  if (!checkpointIntake || !currentIntake) return false
  return JSON.stringify(checkpointIntake) === JSON.stringify(currentIntake)
}

function checkpointPath(jobId) {
  const safe = String(jobId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 100)
  if (!safe) throw new Error('Invalid Discover research job id.')
  return path.join(root, `${safe}.json`)
}

export async function readDiscoverResearchCheckpoint(jobId) {
  const target = checkpointPath(jobId)
  try {
    const value = JSON.parse(await fs.readFile(target, 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  const directory = path.dirname(target)
  const prefix = `${path.basename(target)}.previous-`
  let candidates = []
  try {
    candidates = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => path.join(directory, entry.name))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const newest = (await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    mtimeMs: (await fs.stat(candidate)).mtimeMs,
  })))).sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const { candidate } of newest) {
    try {
      const value = JSON.parse(await fs.readFile(candidate, 'utf8'))
      await fs.rm(target, { force: true })
      await fs.rename(candidate, target)
      return value && typeof value === 'object' ? value : null
    } catch {
      // Continue to an older complete checkpoint if this one was interrupted.
    }
  }
  return null
}

export async function writeDiscoverResearchCheckpoint(jobId, value) {
  await fs.mkdir(root, { recursive: true })
  const target = checkpointPath(jobId)
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    // sourceIndex is a deterministic projection of crawls and accounted for
    // more than half of large checkpoints. Rebuild it on resume instead of
    // synchronously serializing the same page evidence twice on every batch.
    const { sourceIndex: _derivedSourceIndex, ...durableValue } = value || {}
    await fs.writeFile(temporary, JSON.stringify({
      version: 1,
      pipelineVersion: DISCOVER_RESEARCH_PIPELINE_VERSION,
      updatedAt: new Date().toISOString(),
      ...durableValue,
    }), 'utf8')
    await replaceCheckpoint(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function deleteDiscoverResearchCheckpoint(jobId) {
  const target = checkpointPath(jobId)
  await fs.rm(target, { force: true })
  const directory = path.dirname(target)
  const prefixes = [`${path.basename(target)}.tmp-`, `${path.basename(target)}.previous-`]
  try {
    const leftovers = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && prefixes.some((prefix) => entry.name.startsWith(prefix)))
      .map((entry) => fs.rm(path.join(directory, entry.name), { force: true }).catch(() => undefined))
    await Promise.all(leftovers)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
