// @vitest-environment node

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let storage
let testRoot
let userId

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-webauthn-durable-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(32).toString('base64url'))
  vi.resetModules()
  storage = await import('./storage.js')
  userId = (await storage.readStore()).users[0].id
})

afterAll(async () => {
  storage?.configureDurableStorageAcknowledgementFailpointForTests(null)
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
})

describe.sequential('WebAuthn durable challenge storage', () => {
  it('coalesces 100 concurrent challenge generations into one strong acknowledgement', async () => {
    const challenges = Array.from(
      { length: 100 },
      () => randomBytes(32).toString('base64url'),
    )
    const acknowledgementsBefore = storage.durableStorageAckDiagnostics().attempts
    await Promise.all(challenges.map((challenge) => storage.createWebAuthnChallenge({
      purpose: 'authentication',
      userId,
      challenge,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      metadata: { scope: 'app' },
    })))
    expect(storage.durableStorageAckDiagnostics().attempts).toBe(acknowledgementsBefore + 1)

    const database = new Database(storage.databasePath, { readonly: true })
    try {
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM webauthn_challenges WHERE used_at IS NULL',
      ).get().count).toBe(100)
    } finally {
      database.close()
    }

    let failOnce = true
    storage.configureDurableStorageAcknowledgementFailpointForTests(() => {
      if (!failOnce) return
      failOnce = false
      const error = new Error('Injected challenge claim durability failure.')
      error.code = 'INJECTED_CHALLENGE_DURABILITY_FAILURE'
      throw error
    })
    await expect(storage.claimWebAuthnChallenge({
      purpose: 'authentication',
      challenge: challenges[0],
    })).rejects.toMatchObject({ code: 'INJECTED_CHALLENGE_DURABILITY_FAILURE' })

    storage.configureDurableStorageAcknowledgementFailpointForTests(null)
    await expect(storage.claimWebAuthnChallenge({
      purpose: 'authentication',
      challenge: challenges[0],
    })).resolves.toBeNull()
    expect(storage.durableStorageAckDiagnostics().attempts).toBe(acknowledgementsBefore + 3)
  }, 120_000)
})
