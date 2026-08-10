import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

let storage
let testRoot

function clone(value) {
  return structuredClone(value)
}

function testUser(source, id) {
  return {
    ...clone(source),
    id,
    name: id,
    email: `${id}@example.test`,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    disabledAt: null,
    settings: {
      ...clone(source.settings),
      membershipPlan: 'pro',
      personalMembershipPlan: 'pro',
      storageQuotaMb: 100,
      teamProfileRecommenders: {},
    },
  }
}

function testApplication(source, {
  id,
  ownerId,
  teamId = null,
  deadline = '2027-01-01',
  marker = id,
  updatedAt = '2026-08-02T12:00:00.000Z',
  payloadSize = 0,
}) {
  return {
    ...clone(source),
    id,
    ownerId,
    teamId,
    school: {
      ...clone(source.school),
      name: marker,
      logo: undefined,
    },
    professor: {
      ...clone(source.professor),
      english: `${marker} professor`,
    },
    program: marker,
    deadline,
    notes: 'x'.repeat(payloadSize),
    createdAt: updatedAt,
    updatedAt,
  }
}

function testProfileAsset(source, {
  id,
  ownerId,
  teamId = null,
  marker = id,
  updatedAt = '2026-08-02T12:00:00.000Z',
}) {
  return {
    ...clone(source),
    id,
    ownerId,
    teamId,
    name: marker,
    description: marker,
    attachments: [],
    shares: [],
    updatedAt,
  }
}

async function mutateScopedApplication(userId, applicationId, mutate) {
  await storage.withWriteLock(async () => {
    const scoped = await storage.readScopedStore(userId, {
      includeProfileAssets: false,
      retainMemoryReservation: false,
    })
    const application = scoped.applications.find((candidate) => candidate.id === applicationId)
    if (!application) throw new Error(`Missing test application ${applicationId}.`)
    mutate(application)
    await storage.writeStore(scoped)
  })
}

async function mutateScopedProfileAsset(userId, assetId, mutate) {
  await storage.withWriteLock(async () => {
    const scoped = await storage.readScopedStore(userId, {
      includeApplications: false,
      retainMemoryReservation: false,
    })
    const asset = scoped.profileAssets.find((candidate) => candidate.id === assetId)
    if (!asset) throw new Error(`Missing test profile asset ${assetId}.`)
    mutate(asset)
    await storage.writeStore(scoped)
  })
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-workspace-stream-storage-'))
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'workspace-stream-storage-test-server-key')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'workspace-stream-storage-test-settings-key')
})

beforeEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true })
  await fs.mkdir(testRoot, { recursive: true })
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
})

afterEach(async () => {
  storage?.configureStoreHydrationMemoryAdmission(null)
  await storage?.shutdownStorage().catch(() => undefined)
  storage = null
  vi.resetModules()
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await fs.rm(testRoot, { recursive: true, force: true })
})

describe.sequential('memory-bounded workspace bootstrap storage cursors', () => {
  it('streams a large tenant while continuous unrelated writes commit between yielded rows', async () => {
    const setup = await storage.readStore()
    const sourceUser = setup.users[0]
    const sourceApplication = setup.applications[0]
    const ownerId = 'cursor_large_owner'
    const outsiderId = 'cursor_large_outsider'
    setup.users.push(testUser(sourceUser, ownerId), testUser(sourceUser, outsiderId))

    const expectedIds = []
    for (let index = 0; index < 12; index += 1) {
      const id = `cursor_large_${String(index).padStart(2, '0')}`
      expectedIds.push(id)
      setup.applications.push(testApplication(sourceApplication, {
        id,
        ownerId,
        deadline: `2027-01-${String(index + 1).padStart(2, '0')}`,
        payloadSize: 128 * 1024,
      }))
    }
    const outsiderApplicationId = 'cursor_large_outsider_app'
    setup.applications.push(testApplication(sourceApplication, {
      id: outsiderApplicationId,
      ownerId: outsiderId,
      marker: 'unrelated tenant',
    }))
    await storage.lockedWriteStore(setup)

    let activeLeases = 0
    let maxActiveLeases = 0
    let reservations = 0
    const acquire = (bytes) => {
      expect(bytes).toBeGreaterThanOrEqual(16 * 1024 * 1024)
      reservations += 1
      activeLeases += 1
      maxActiveLeases = Math.max(maxActiveLeases, activeLeases)
      let released = false
      return () => {
        if (released) return
        released = true
        activeLeases -= 1
      }
    }
    storage.configureStoreHydrationMemoryAdmission(acquire)

    const cursor = await storage.createScopedApplicationSectionCursor({
      userId: ownerId,
      personalOnly: true,
    })
    expect(cursor.count).toBe(expectedIds.length)
    expect(activeLeases).toBe(0)

    const streamedIds = []
    for await (const application of cursor.values) {
      streamedIds.push(application.id)
      // The row lease remains owned by the suspended generator while an async
      // serializer or another request gets an opportunity to run.
      expect(activeLeases).toBe(1)
      await Promise.resolve()
      expect(activeLeases).toBe(1)

      // Do not count the unrelated scoped write's own hydration reservation in
      // this cursor-specific lifecycle assertion. The outstanding row lease is
      // still live and its release closure remains valid.
      storage.configureStoreHydrationMemoryAdmission(null)
      try {
        await mutateScopedApplication(outsiderId, outsiderApplicationId, (outsider) => {
          outsider.program = `unrelated-${streamedIds.length}`
          outsider.updatedAt = new Date(Date.now() + streamedIds.length).toISOString()
        })
        expect(activeLeases).toBe(1)
      } finally {
        storage.configureStoreHydrationMemoryAdmission(acquire)
      }
    }

    expect(streamedIds).toEqual(expectedIds)
    expect(activeLeases).toBe(0)
    expect(maxActiveLeases).toBe(1)
    // Snapshot and final validation inspect only metadata columns and therefore
    // need no payload lease. Exactly one bounded lease is required per decoded
    // row, independent of the two fingerprint passes.
    expect(reservations).toBe(expectedIds.length)
  })

  it('reserves the largest scoped row before returning a stream cursor and releases it exactly once', async () => {
    const setup = await storage.readStore()
    const ownerId = 'cursor_preheader_owner'
    setup.users.push(testUser(setup.users[0], ownerId))
    setup.applications.push(
      testApplication(setup.applications[0], {
        id: 'cursor_preheader_small',
        ownerId,
        deadline: '2027-01-01',
        payloadSize: 64 * 1024,
      }),
      testApplication(setup.applications[0], {
        id: 'cursor_preheader_large',
        ownerId,
        deadline: '2027-01-02',
        payloadSize: 512 * 1024,
      }),
    )
    await storage.lockedWriteStore(setup)

    const refused = new Error('synthetic memory refusal before headers')
    let refusedReservations = 0
    storage.configureStoreHydrationMemoryAdmission(() => {
      refusedReservations += 1
      throw refused
    })
    await expect(storage.createScopedApplicationSectionCursor({
      userId: ownerId,
      personalOnly: true,
      reservePayloadMemory: true,
    })).rejects.toBe(refused)
    expect(refusedReservations).toBe(1)

    let activeLeases = 0
    let reservations = 0
    let releases = 0
    const requestedReservationBytes = []
    storage.configureStoreHydrationMemoryAdmission((bytes) => {
      expect(bytes).toBeGreaterThanOrEqual(512 * 1024)
      requestedReservationBytes.push(bytes)
      reservations += 1
      activeLeases += 1
      let released = false
      return () => {
        if (released) return
        released = true
        releases += 1
        activeLeases -= 1
      }
    })

    const cursor = await storage.createScopedApplicationSectionCursor({
      userId: ownerId,
      personalOnly: true,
      reservePayloadMemory: true,
    })
    expect(cursor.count).toBe(2)
    expect(cursor.maxPayloadBytes).toBeGreaterThanOrEqual(512 * 1024)
    expect(requestedReservationBytes).toEqual([
      storage.scopedReadOnlyStreamReservationBytes(cursor.maxPayloadBytes + 1024),
    ])
    expect(activeLeases).toBe(1)
    expect(reservations).toBe(1)

    const ids = []
    for await (const application of cursor.values) {
      ids.push(application.id)
      expect(activeLeases).toBe(1)
      expect(reservations).toBe(1)
    }
    expect(ids).toEqual(['cursor_preheader_small', 'cursor_preheader_large'])
    expect(activeLeases).toBe(0)
    expect(releases).toBe(1)
    cursor.release()
    expect(releases).toBe(1)

    const abandoned = await storage.createScopedApplicationSectionCursor({
      userId: ownerId,
      personalOnly: true,
      reservePayloadMemory: true,
    })
    expect(activeLeases).toBe(1)
    abandoned.release()
    abandoned.release()
    expect(activeLeases).toBe(0)
    expect(reservations).toBe(2)
    expect(releases).toBe(2)
    expect(requestedReservationBytes).toEqual([
      storage.scopedReadOnlyStreamReservationBytes(cursor.maxPayloadBytes + 1024),
      storage.scopedReadOnlyStreamReservationBytes(abandoned.maxPayloadBytes + 1024),
    ])
  })

  it('rejects a same-timestamp application payload mutation after streaming the changed row', async () => {
    const setup = await storage.readStore()
    const ownerId = 'cursor_changed_owner'
    setup.users.push(testUser(setup.users[0], ownerId))
    const stamp = '2026-08-02T13:00:00.000Z'
    setup.applications.push(
      testApplication(setup.applications[0], {
        id: 'cursor_changed_01',
        ownerId,
        deadline: '2027-01-01',
        updatedAt: stamp,
      }),
      testApplication(setup.applications[0], {
        id: 'cursor_changed_02',
        ownerId,
        deadline: '2027-02-01',
        updatedAt: stamp,
      }),
    )
    await storage.lockedWriteStore(setup)

    const cursor = await storage.createScopedApplicationSectionCursor({ userId: ownerId, personalOnly: true })
    const iterator = cursor.values[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { id: 'cursor_changed_01' },
    })

    await mutateScopedApplication(ownerId, 'cursor_changed_02', (application) => {
      application.program = 'changed without a version-stamp change'
      application.notes = 'same encoded length is not trusted either'
      application.updatedAt = stamp
    })

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        id: 'cursor_changed_02',
        program: 'changed without a version-stamp change',
      },
    })
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'WORKSPACE_REVISION_CHANGED',
      status: 409,
      retryable: true,
    })
  })

  it('binds Team applications to both the exact team and authorized owner set', async () => {
    const setup = await storage.readStore()
    const ownerA = 'cursor_team_student_a'
    const ownerB = 'cursor_team_student_b'
    setup.users.push(testUser(setup.users[0], ownerA), testUser(setup.users[0], ownerB))
    await storage.lockedWriteStore(setup)
    const teamA = await storage.createTeam(setup.users[0].id, 'Cursor Team A')
    const teamB = await storage.createTeam(setup.users[0].id, 'Cursor Team B')
    const withTeams = await storage.readStore()
    withTeams.applications.push(
      testApplication(withTeams.applications[0], {
        id: 'cursor_team_a_visible', ownerId: ownerA, teamId: teamA.id,
      }),
      testApplication(withTeams.applications[0], {
        id: 'cursor_team_a_hidden_owner', ownerId: ownerB, teamId: teamA.id,
      }),
      testApplication(withTeams.applications[0], {
        id: 'cursor_team_b_wrong_team', ownerId: ownerA, teamId: teamB.id,
      }),
    )
    await storage.lockedWriteStore(withTeams)

    const cursor = await storage.createScopedApplicationSectionCursor({
      mode: 'team',
      teamId: teamA.id,
      visibleOwnerIds: [ownerA],
    })
    const values = []
    for await (const application of cursor.values) values.push(application)

    expect(cursor.count).toBe(1)
    expect(values.map((application) => application.id)).toEqual(['cursor_team_a_visible'])
    expect(values[0]).toMatchObject({ ownerId: ownerA, teamId: teamA.id })
  })

  it('filters encrypted profile payloads by Team and detects same-timestamp relevant changes', async () => {
    const setup = await storage.readStore()
    const ownerId = 'cursor_profile_owner'
    const outsiderId = 'cursor_profile_outsider'
    setup.users.push(testUser(setup.users[0], ownerId), testUser(setup.users[0], outsiderId))
    const sourceAsset = setup.profileAssets[0]
    const stamp = '2026-08-02T14:00:00.000Z'
    setup.profileAssets.push(
      testProfileAsset(sourceAsset, {
        id: 'cursor_profile_01', ownerId, teamId: 'team_profile_a', updatedAt: stamp,
      }),
      testProfileAsset(sourceAsset, {
        id: 'cursor_profile_02', ownerId, teamId: 'team_profile_a', updatedAt: stamp,
      }),
      testProfileAsset(sourceAsset, {
        id: 'cursor_profile_wrong_team', ownerId, teamId: 'team_profile_b', updatedAt: stamp,
      }),
      testProfileAsset(sourceAsset, {
        id: 'cursor_profile_wrong_owner', ownerId: outsiderId, teamId: 'team_profile_a', updatedAt: stamp,
      }),
    )
    await storage.lockedWriteStore(setup)

    const cursor = await storage.createScopedProfileAssetSectionCursor({
      userId: ownerId,
      teamId: 'team_profile_a',
    })
    expect(cursor.count).toBe(2)
    const otherScope = await storage.createScopedProfileAssetSectionCursor({
      userId: ownerId,
      teamId: 'team_profile_b',
    })
    expect(cursor.fingerprint).not.toBe(otherScope.fingerprint)

    const iterator = cursor.values[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { id: 'cursor_profile_01', teamId: 'team_profile_a' },
    })
    await mutateScopedProfileAsset(ownerId, 'cursor_profile_02', (asset) => {
      asset.description = 'changed profile payload with the same timestamp'
      asset.updatedAt = stamp
    })
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        id: 'cursor_profile_02',
        description: 'changed profile payload with the same timestamp',
      },
    })
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'WORKSPACE_REVISION_CHANGED',
      status: 409,
    })
  })

  it('keeps the event loop responsive while fingerprinting and decoding more than 16 MiB', async () => {
    const setup = await storage.readStore()
    const ownerId = 'cursor_responsive_owner'
    setup.users.push(testUser(setup.users[0], ownerId))
    const sourceApplication = setup.applications[0]
    for (let index = 0; index < 24; index += 1) {
      setup.applications.push(testApplication(sourceApplication, {
        id: `cursor_responsive_${String(index).padStart(2, '0')}`,
        ownerId,
        deadline: `2028-01-${String(index + 1).padStart(2, '0')}`,
        payloadSize: 750 * 1024,
      }))
    }
    await storage.lockedWriteStore(setup)

    let ticks = 0
    let maximumLagMs = 0
    let expectedAt = performance.now() + 10
    const interval = setInterval(() => {
      const observedAt = performance.now()
      maximumLagMs = Math.max(maximumLagMs, observedAt - expectedAt)
      expectedAt = observedAt + 10
      ticks += 1
    }, 10)
    try {
      const cursor = await storage.createScopedApplicationSectionCursor({
        userId: ownerId,
        personalOnly: true,
      })
      expect(cursor.count).toBe(24)
      let streamed = 0
      for await (const application of cursor.values) {
        expect(application.ownerId).toBe(ownerId)
        streamed += 1
      }
      expect(streamed).toBe(24)
      await cursor.validate()
    } finally {
      clearInterval(interval)
    }
    expect(ticks).toBeGreaterThanOrEqual(8)
    expect(maximumLagMs).toBeLessThan(500)
  }, 60_000)

  it('streams thousands of tiny rows with one resident payload and cooperative progress', async () => {
    const setup = await storage.readStore()
    const ownerId = 'cursor_high_cardinality_owner'
    setup.users.push(testUser(setup.users[0], ownerId))
    const sourceApplication = setup.applications[0]
    const applicationCount = 2_000
    for (let index = 0; index < applicationCount; index += 1) {
      const application = testApplication(sourceApplication, {
        id: `cursor_tiny_${String(index).padStart(4, '0')}`,
        ownerId,
        marker: `tiny-${index}`,
        updatedAt: `2026-08-02T15:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      })
      // Keep the fixture cardinality-heavy rather than payload-heavy. The
      // separate >16 MiB regression above owns the large-row boundary.
      application.notes = ''
      application.materials = []
      application.tasks = []
      application.communications = []
      application.shares = []
      setup.applications.push(application)
    }
    await storage.lockedWriteStore(setup)

    let activeLeases = 0
    let maxActiveLeases = 0
    let reservations = 0
    storage.configureStoreHydrationMemoryAdmission(() => {
      reservations += 1
      activeLeases += 1
      maxActiveLeases = Math.max(maxActiveLeases, activeLeases)
      let released = false
      return () => {
        if (released) return
        released = true
        activeLeases -= 1
      }
    })

    let ticks = 0
    let maximumLagMs = 0
    let expectedAt = performance.now() + 10
    const interval = setInterval(() => {
      const observedAt = performance.now()
      maximumLagMs = Math.max(maximumLagMs, observedAt - expectedAt)
      expectedAt = observedAt + 10
      ticks += 1
    }, 10)
    try {
      const cursor = await storage.createScopedApplicationSectionCursor({
        userId: ownerId,
        personalOnly: true,
      })
      expect(cursor.count).toBe(applicationCount)
      let streamed = 0
      for await (const application of cursor.values) {
        expect(application.id).toBe(`cursor_tiny_${String(streamed).padStart(4, '0')}`)
        streamed += 1
      }
      expect(streamed).toBe(applicationCount)
    } finally {
      clearInterval(interval)
    }

    expect(activeLeases).toBe(0)
    expect(maxActiveLeases).toBe(1)
    expect(reservations).toBe(applicationCount)
    expect(ticks).toBeGreaterThanOrEqual(8)
    expect(maximumLagMs).toBeLessThan(500)
  }, 90_000)

  it('uses covering keyset indexes for personal, multi-owner, and Team scans', async () => {
    const setup = await storage.readStore()
    const ownerA = 'cursor_index_owner_a'
    const ownerB = 'cursor_index_owner_b'
    setup.users.push(testUser(setup.users[0], ownerA), testUser(setup.users[0], ownerB))
    await storage.lockedWriteStore(setup)
    const team = await storage.createTeam(setup.users[0].id, 'Cursor index Team')
    const withTeam = await storage.readStore()
    const sourceApplication = withTeam.applications[0]
    withTeam.applications.push(
      testApplication(sourceApplication, {
        id: 'cursor_index_a_blank_1', ownerId: ownerA, deadline: '', marker: 'a blank 1',
      }),
      testApplication(sourceApplication, {
        id: 'cursor_index_a_blank_2', ownerId: ownerA, deadline: '', marker: 'a blank 2',
      }),
      testApplication(sourceApplication, {
        id: 'cursor_index_a_date', ownerId: ownerA, deadline: '2028-01-01', marker: 'a date',
      }),
      testApplication(sourceApplication, {
        id: 'cursor_index_b_blank', ownerId: ownerB, deadline: '', marker: 'b blank',
      }),
      testApplication(sourceApplication, {
        id: 'cursor_index_team_late', ownerId: ownerA, teamId: team.id,
        deadline: '2028-03-01', marker: 'team late',
      }),
      testApplication(sourceApplication, {
        id: 'cursor_index_team_early', ownerId: ownerB, teamId: team.id,
        deadline: '', marker: 'team early',
      }),
    )
    await storage.lockedWriteStore(withTeam)

    const collectIds = async (cursor) => {
      const ids = []
      for await (const application of cursor.values) ids.push(application.id)
      return ids
    }
    await expect(collectIds(await storage.createScopedApplicationSectionCursor({
      userId: ownerA,
      personalOnly: true,
    }))).resolves.toEqual([
      'cursor_index_a_blank_1',
      'cursor_index_a_blank_2',
      'cursor_index_a_date',
    ])
    await expect(collectIds(await storage.createScopedApplicationSectionCursor({
      mode: 'owners',
      visibleOwnerIds: [ownerB, ownerA],
    }))).resolves.toEqual([
      'cursor_index_a_blank_1',
      'cursor_index_a_blank_2',
      'cursor_index_a_date',
      'cursor_index_team_late',
      'cursor_index_b_blank',
      'cursor_index_team_early',
    ])
    await expect(collectIds(await storage.createScopedApplicationSectionCursor({
      mode: 'team',
      teamId: team.id,
      visibleOwnerIds: [ownerA, ownerB],
    }))).resolves.toEqual([
      'cursor_index_team_early',
      'cursor_index_team_late',
    ])

    const database = new Database(path.join(testRoot, 'workspace.sqlite'), { readonly: true })
    try {
      const planDetails = (sql, ...parameters) => database
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...parameters)
        .map((row) => String(row.detail))
      const personalPlan = planDetails(
        `SELECT id FROM applications
         WHERE owner_id = ?
           AND (deadline > ? OR (deadline = ? AND id > ?))
         ORDER BY deadline ASC, id ASC LIMIT 1`,
        ownerA,
        '',
        '',
        'cursor_index_a_blank_1',
      )
      const ownersPlan = planDetails(
        `SELECT id FROM applications
         WHERE owner_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         ORDER BY owner_id ASC, deadline ASC, id ASC LIMIT 1`,
        JSON.stringify([ownerA, ownerB]),
      )
      const teamPlan = planDetails(
        `SELECT id FROM applications
         WHERE team_id = ?
           AND owner_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           AND (deadline > ? OR (deadline = ? AND id > ?))
         ORDER BY deadline ASC, id ASC LIMIT 1`,
        team.id,
        JSON.stringify([ownerA, ownerB]),
        '',
        '',
        'cursor_index_team_early',
      )
      expect(personalPlan.join('\n')).toContain('idx_applications_owner_deadline_id')
      expect(ownersPlan.join('\n')).toContain('idx_applications_owner_deadline_id')
      expect(teamPlan.join('\n')).toContain('idx_applications_team_deadline_id')
      expect([...personalPlan, ...ownersPlan, ...teamPlan].join('\n')).not.toContain('USE TEMP B-TREE')
    } finally {
      database.close()
    }
  }, 60_000)
})
