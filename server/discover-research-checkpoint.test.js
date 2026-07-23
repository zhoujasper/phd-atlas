import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DISCOVER_RESEARCH_PIPELINE_VERSION,
  deleteDiscoverResearchCheckpoint,
  isDiscoverResearchCheckpointCompatible,
  readDiscoverResearchCheckpoint,
  writeDiscoverResearchCheckpoint,
} from './discover-research-checkpoint.js'

const jobIds = []
const checkpointRoot = path.join(process.cwd(), 'logs', 'tmp', `discover-research-jobs-${process.pid}`)

function checkpointFile(jobId) {
  return path.join(checkpointRoot, `${jobId}.json`)
}

afterEach(async () => {
  await Promise.all(jobIds.splice(0).map((jobId) => deleteDiscoverResearchCheckpoint(jobId)))
})

describe('Discover research checkpoints', () => {
  it('replaces an existing durable checkpoint without leaving a stale snapshot', async () => {
    const jobId = `checkpoint_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)

    await writeDiscoverResearchCheckpoint(jobId, { stage: 'crawling', workingState: { intake: { field: 'AI' } } })
    await writeDiscoverResearchCheckpoint(jobId, { stage: 'portals', workingState: { intake: { field: 'AI' } } })

    await expect(readDiscoverResearchCheckpoint(jobId)).resolves.toMatchObject({
      version: 1,
      pipelineVersion: DISCOVER_RESEARCH_PIPELINE_VERSION,
      stage: 'portals',
      workingState: { intake: { field: 'AI' } },
    })
  })

  it('does not duplicate the derived source index in durable checkpoints', async () => {
    const jobId = `checkpoint_compact_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)

    await writeDiscoverResearchCheckpoint(jobId, {
      stage: 'verifying',
      crawls: [{ source: { school: 'Example University' }, pages: [{ url: 'https://example.edu/phd' }] }],
      sourceIndex: { schools: [{ school: 'Example University', pages: new Array(100).fill({ excerpt: 'derived' }) }] },
      workingState: { intake: { field: 'AI' } },
    })

    const checkpoint = await readDiscoverResearchCheckpoint(jobId)
    expect(checkpoint.crawls).toHaveLength(1)
    expect(checkpoint).not.toHaveProperty('sourceIndex')
  })

  it('resumes only when the saved intake still matches the current research scope', () => {
    const checkpoint = {
      pipelineVersion: DISCOVER_RESEARCH_PIPELINE_VERSION,
      workingState: { intake: { field: 'AI', regions: ['US'], nPrograms: 12 } },
    }
    expect(isDiscoverResearchCheckpointCompatible(checkpoint, {
      intake: { field: 'AI', regions: ['US'], nPrograms: 12 },
    })).toBe(true)
    expect(isDiscoverResearchCheckpointCompatible(checkpoint, {
      intake: { field: 'Quantum', regions: ['US'], nPrograms: 12 },
    })).toBe(false)
    expect(isDiscoverResearchCheckpointCompatible({ ...checkpoint, pipelineVersion: 1 }, {
      intake: { field: 'AI', regions: ['US'], nPrograms: 12 },
    })).toBe(false)
  })

  it('recovers and promotes the newest complete previous checkpoint when the target is corrupt', async () => {
    const jobId = `checkpoint_recover_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)
    const target = checkpointFile(jobId)

    await writeDiscoverResearchCheckpoint(jobId, {
      stage: 'advisors',
      workingState: { intake: { field: 'AI' } },
      completedAdvisorBatches: [0, 1],
    })
    const previous = `${target}.previous-fixture`
    await fs.rename(target, previous)
    await fs.writeFile(target, '{interrupted', 'utf8')

    await expect(readDiscoverResearchCheckpoint(jobId)).resolves.toMatchObject({
      stage: 'advisors',
      completedAdvisorBatches: [0, 1],
    })
    await expect(fs.readFile(target, 'utf8')).resolves.toContain('"stage":"advisors"')
    await expect(fs.access(previous)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('finalizes a completed job by deleting target and interrupted-write remnants', async () => {
    const jobId = `checkpoint_finalize_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)
    const target = checkpointFile(jobId)

    await writeDiscoverResearchCheckpoint(jobId, {
      stage: 'verifying',
      workingState: { intake: { field: 'AI' } },
    })
    await fs.writeFile(`${target}.tmp-fixture`, 'partial', 'utf8')
    await fs.writeFile(`${target}.previous-fixture`, 'previous', 'utf8')

    await deleteDiscoverResearchCheckpoint(jobId)

    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' })
    const leftovers = (await fs.readdir(checkpointRoot))
      .filter((entry) => entry.startsWith(`${jobId}.json.`))
    expect(leftovers).toEqual([])
  })
})
