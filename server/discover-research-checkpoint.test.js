import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decryptPayload, encryptPayload, isEncryptedPayload } from './crypto.js'
import {
  DISCOVER_RESEARCH_CHECKPOINT_DEFAULT_TTL_MS,
  DISCOVER_RESEARCH_PIPELINE_VERSION,
  cleanupDiscoverResearchCheckpoints,
  deleteDiscoverResearchCheckpoint,
  discoverResearchCheckpointTtlMs,
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
  delete process.env.DISCOVER_RESEARCH_CHECKPOINT_TTL_HOURS
  delete process.env.DISCOVER_RESEARCH_CHECKPOINT_MAX_BYTES
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

  it('encrypts applicant intake and PI details instead of writing plaintext to disk', async () => {
    const jobId = `checkpoint_secrets_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)
    const intakeSecret = 'confidential-intake-research-fit'
    const piSecret = 'private.pi@example.edu'

    await writeDiscoverResearchCheckpoint(jobId, {
      stage: 'advisors',
      workingState: {
        intake: { field: 'AI', notes: intakeSecret },
        customPrograms: [{ school: 'Example University', pis: [{ name: 'Private PI', email: piSecret }] }],
      },
    })

    const serialized = await fs.readFile(checkpointFile(jobId), 'utf8')
    expect(isEncryptedPayload(serialized)).toBe(true)
    expect(serialized).not.toContain(intakeSecret)
    expect(serialized).not.toContain(piSecret)
    expect(JSON.parse(decryptPayload(serialized))).toMatchObject({
      workingState: {
        intake: { notes: intakeSecret },
        customPrograms: [{ pis: [{ email: piSecret }] }],
      },
    })
  })

  it('reads a legacy plaintext checkpoint and encrypts it on the next write', async () => {
    const jobId = `checkpoint_legacy_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)
    const target = checkpointFile(jobId)
    const legacySecret = 'legacy-private-intake'
    await fs.mkdir(checkpointRoot, { recursive: true })
    await fs.writeFile(target, JSON.stringify({
      version: 1,
      pipelineVersion: DISCOVER_RESEARCH_PIPELINE_VERSION,
      updatedAt: new Date().toISOString(),
      stage: 'crawling',
      workingState: { intake: { field: 'AI', notes: legacySecret } },
    }), 'utf8')

    const legacy = await readDiscoverResearchCheckpoint(jobId)
    expect(legacy).toMatchObject({ stage: 'crawling', workingState: { intake: { notes: legacySecret } } })
    expect(await fs.readFile(target, 'utf8')).toContain(legacySecret)

    await writeDiscoverResearchCheckpoint(jobId, { ...legacy, stage: 'portals' })

    const migrated = await fs.readFile(target, 'utf8')
    expect(isEncryptedPayload(migrated)).toBe(true)
    expect(migrated).not.toContain(legacySecret)
    await expect(readDiscoverResearchCheckpoint(jobId)).resolves.toMatchObject({
      stage: 'portals',
      workingState: { intake: { notes: legacySecret } },
    })
  })

  it('expires checkpoints using the configurable TTL and keeps the 72-hour default', async () => {
    expect(discoverResearchCheckpointTtlMs()).toBe(DISCOVER_RESEARCH_CHECKPOINT_DEFAULT_TTL_MS)
    process.env.DISCOVER_RESEARCH_CHECKPOINT_TTL_HOURS = '0.001'
    const jobId = `checkpoint_expired_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)
    const target = checkpointFile(jobId)
    await fs.mkdir(checkpointRoot, { recursive: true })
    await fs.writeFile(target, encryptPayload(JSON.stringify({
      version: 1,
      pipelineVersion: DISCOVER_RESEARCH_PIPELINE_VERSION,
      updatedAt: new Date(Date.now() - 10_000).toISOString(),
      stage: 'crawling',
      workingState: { intake: { field: 'AI' } },
    })), 'utf8')

    await expect(readDiscoverResearchCheckpoint(jobId)).resolves.toBeNull()
    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('performs bounded cleanup of expired checkpoints and orphaned write artifacts', async () => {
    process.env.DISCOVER_RESEARCH_CHECKPOINT_TTL_HOURS = '0.001'
    const jobId = `checkpoint_cleanup_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)
    const target = checkpointFile(jobId)
    const temporary = `${target}.tmp-fixture`
    const previous = `${target}.previous-fixture`
    await fs.mkdir(checkpointRoot, { recursive: true })
    await fs.writeFile(temporary, 'partial', 'utf8')
    await fs.writeFile(previous, 'previous', 'utf8')
    const old = new Date(Date.now() - 20 * 60 * 1_000)
    await Promise.all([
      fs.utimes(temporary, old, old),
      fs.utimes(previous, old, old),
    ])

    const result = await cleanupDiscoverResearchCheckpoints()

    expect(result.scanned).toBeLessThanOrEqual(128)
    expect(result.deleted).toBeLessThanOrEqual(64)
    await expect(fs.access(temporary)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(previous)).rejects.toMatchObject({ code: 'ENOENT' })
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
    await fs.writeFile(target, 'payload:v3:aes-256-gcm:invalid-authenticated-ciphertext', 'utf8')

    await expect(readDiscoverResearchCheckpoint(jobId)).resolves.toMatchObject({
      stage: 'advisors',
      completedAdvisorBatches: [0, 1],
    })
    const recovered = await fs.readFile(target, 'utf8')
    expect(isEncryptedPayload(recovered)).toBe(true)
    expect(recovered).not.toContain('"stage":"advisors"')
    expect(JSON.parse(decryptPayload(recovered))).toMatchObject({ stage: 'advisors' })
    await expect(fs.access(previous)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects unsafe job ids and oversized checkpoints before they reach disk', async () => {
    await expect(writeDiscoverResearchCheckpoint('../outside', { stage: 'unsafe' }))
      .rejects.toThrow('Invalid Discover research job id')

    process.env.DISCOVER_RESEARCH_CHECKPOINT_MAX_BYTES = '1024'
    const jobId = `checkpoint_large_${Date.now()}_${Math.random().toString(36).slice(2)}`
    jobIds.push(jobId)
    const target = checkpointFile(jobId)
    await expect(writeDiscoverResearchCheckpoint(jobId, {
      stage: 'crawling',
      workingState: { intake: { notes: 'x'.repeat(2_000) } },
    })).rejects.toMatchObject({ code: 'DISCOVER_CHECKPOINT_TOO_LARGE' })
    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' })
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
