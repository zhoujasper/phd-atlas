import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'

let app
let server
let baseUrl
let previousMutationMaxActive
let applicationPutBarrier = null

async function jsonRequest(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json()
  return {
    response,
    data: payload.data,
    payload,
    headers: Object.fromEntries(response.headers),
  }
}

function armApplicationPutBarrier(applicationId, arrivals = 2) {
  let release
  let resolveArrived
  const gate = new Promise((resolve) => { release = resolve })
  const arrived = new Promise((resolve) => { resolveArrived = resolve })
  applicationPutBarrier = {
    applicationId,
    arrivals,
    count: 0,
    updatedAt: [],
    gate,
    release,
    resolveArrived,
  }
  return {
    arrived,
    release: () => applicationPutBarrier?.release(),
    updatedAt: applicationPutBarrier.updatedAt,
  }
}

describe.sequential('application PUT concurrency contract', () => {
  beforeAll(async () => {
    previousMutationMaxActive = process.env.MUTATION_MAX_ACTIVE
    process.env.MUTATION_MAX_ACTIVE = '2'
    app = createApp({
      testHooks: {
        applicationPutAfterRead: async ({ applicationId, updatedAt }) => {
          const barrier = applicationPutBarrier
          if (!barrier || barrier.applicationId !== applicationId) return
          barrier.count += 1
          barrier.updatedAt.push(updatedAt)
          if (barrier.count === barrier.arrivals) barrier.resolveArrived()
          await barrier.gate
        },
      },
    })
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    applicationPutBarrier?.release()
    applicationPutBarrier = null
    await app?.locals.stopPersistedMailSyncWorker?.()
    await app?.locals.stopRecurringTasks?.()
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
    if (previousMutationMaxActive === undefined) delete process.env.MUTATION_MAX_ACTIVE
    else process.env.MUTATION_MAX_ACTIVE = previousMutationMaxActive
  })

  it('merges stale disjoint edits, rejects divergent edits, and auto-merges a true overlapping write', async () => {
    const login = await jsonRequest('/api/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@phd-atlas.local',
        password: 'admin123456',
      }),
    })
    expect(login.response.status, JSON.stringify(login.payload)).toBe(200)
    const token = login.data.token

    const created = await jsonRequest('/api/applications', token, {
      method: 'POST',
      body: JSON.stringify({
        professor: 'Professor Application Race',
        professorChinese: '',
        professorEmail: 'application-race@example.edu',
        professorHomepage: '',
        university: `Application Race ${Date.now()}`,
        country: 'United Kingdom',
        website: '',
        program: 'Original concurrency program',
        deadline: '2027-01-15',
        notes: '',
      }),
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
    const applicationPath = `/api/applications/${encodeURIComponent(created.data.id)}`
    expect(created.data).toMatchObject({
      protocol: 'phd-atlas-application-mutation-ack-v2',
      durable: true,
      id: expect.any(String),
    })

    const createdRead = await jsonRequest(applicationPath, token)
    expect(createdRead.response.status, JSON.stringify(createdRead.payload)).toBe(200)
    const createdApplication = createdRead.data
    expect(createdApplication).toMatchObject({
      id: created.data.id,
      professor: {
        english: 'Professor Application Race',
        email: 'application-race@example.edu',
      },
      school: { name: expect.stringContaining('Application Race') },
      program: 'Original concurrency program',
    })

    try {
      // A generic full-record PUT must carry either the record version or a
      // complete client baseline. Otherwise admission could serialize two old
      // request bodies and silently let the second overwrite the first.
      const versionlessBody = { ...createdApplication, program: 'Unsafe versionless program' }
      delete versionlessBody.updatedAt
      const versionlessWrite = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify(versionlessBody),
      })
      expect(versionlessWrite.response.status, JSON.stringify(versionlessWrite.payload)).toBe(428)
      expect(versionlessWrite.payload).toMatchObject({
        error: { code: 'APPLICATION_VERSION_REQUIRED' },
      })

      const blankVersionWrite = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify({ ...versionlessBody, updatedAt: '   ' }),
      })
      expect(blankVersionWrite.response.status, JSON.stringify(blankVersionWrite.payload)).toBe(428)
      expect(blankVersionWrite.payload).toMatchObject({
        error: { code: 'APPLICATION_VERSION_REQUIRED' },
      })

      const unchangedAfterRejectedWrites = await jsonRequest(applicationPath, token)
      expect(unchangedAfterRejectedWrites.response.status, JSON.stringify(unchangedAfterRejectedWrites.payload)).toBe(200)
      expect(unchangedAfterRejectedWrites.data.program).toBe(createdApplication.program)

      // These bodies were both authored from the same personal-application
      // baseline. The second request arrives after the first commit, exactly as
      // the production mutation admission queue serializes a busy account.
      const disjointBase = createdApplication
      const programWrite = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify({
          ...disjointBase,
          program: 'Preserved concurrent program',
          clientBaseApplication: disjointBase,
        }),
      })
      expect(programWrite.response.status, JSON.stringify(programWrite.payload)).toBe(200)
      expect(programWrite.data).toMatchObject({
        protocol: 'phd-atlas-application-mutation-ack-v2',
        durable: true,
        id: createdApplication.id,
      })

      const tagWrite = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify({
          ...disjointBase,
          tags: [...(disjointBase.tags ?? []), 'preserved-concurrent-tag'],
          clientBaseApplication: disjointBase,
        }),
      })
      expect(tagWrite.response.status, JSON.stringify(tagWrite.payload)).toBe(200)
      const afterTagWrite = await jsonRequest(applicationPath, token)
      expect(afterTagWrite.response.status, JSON.stringify(afterTagWrite.payload)).toBe(200)
      expect(afterTagWrite.data).toMatchObject({ program: 'Preserved concurrent program' })
      expect(afterTagWrite.data.tags).toContain('preserved-concurrent-tag')

      // A stale edit to the same field cannot be acknowledged and discarded.
      const conflictBase = afterTagWrite.data
      const firstConflictWrite = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify({
          ...conflictBase,
          program: 'First same-field value',
          clientBaseApplication: conflictBase,
        }),
      })
      expect(firstConflictWrite.response.status, JSON.stringify(firstConflictWrite.payload)).toBe(200)
      const afterFirstConflictWrite = await jsonRequest(applicationPath, token)
      expect(afterFirstConflictWrite.response.status, JSON.stringify(afterFirstConflictWrite.payload)).toBe(200)
      expect(afterFirstConflictWrite.data.program).toBe('First same-field value')
      const secondConflictWrite = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify({
          ...conflictBase,
          program: 'Second same-field value',
          clientBaseApplication: conflictBase,
        }),
      })
      expect(secondConflictWrite.response.status, JSON.stringify(secondConflictWrite.payload)).toBe(409)
      expect(secondConflictWrite.payload).toMatchObject({
        error: { code: 'APPLICATION_VERSION_CONFLICT', field: 'program' },
      })

      // Compatibility callers such as the standalone stress probe submit the
      // record's updatedAt without a full clientBaseApplication. Their first
      // write may succeed, but a second body authored from that old version
      // must receive 409 instead of overwriting the accepted field.
      const compatibilityBase = afterFirstConflictWrite.data
      const compatibilityProgramWrite = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify({ ...compatibilityBase, program: 'Compatibility program' }),
      })
      expect(compatibilityProgramWrite.response.status, JSON.stringify(compatibilityProgramWrite.payload)).toBe(200)
      const afterCompatibilityProgramWrite = await jsonRequest(applicationPath, token)
      expect(afterCompatibilityProgramWrite.response.status, JSON.stringify(afterCompatibilityProgramWrite.payload)).toBe(200)
      expect(afterCompatibilityProgramWrite.data.program).toBe('Compatibility program')
      const compatibilityTagWrite = await jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify({
          ...compatibilityBase,
          tags: [...(compatibilityBase.tags ?? []), 'stale-compatibility-tag'],
        }),
      })
      expect(compatibilityTagWrite.response.status, JSON.stringify(compatibilityTagWrite.payload)).toBe(409)
      expect(compatibilityTagWrite.payload).toMatchObject({
        error: { code: 'APPLICATION_VERSION_CONFLICT' },
      })

      // This is a true route-level barrier: both handlers have independently
      // hydrated and read the identical durable application before either can
      // write. Storage must accept one and the route must map the other to the
      // public application conflict contract, never return two lossy 200s.
      const overlapBase = afterCompatibilityProgramWrite.data
      const barrier = armApplicationPutBarrier(createdApplication.id)
      const overlappingRequests = [
        jsonRequest(applicationPath, token, {
          method: 'PUT',
          body: JSON.stringify({ ...overlapBase, program: 'Barrier program' }),
        }),
        jsonRequest(applicationPath, token, {
          method: 'PUT',
          body: JSON.stringify({
            ...overlapBase,
            tags: [...(overlapBase.tags ?? []), 'barrier-tag'],
          }),
        }),
      ]
      await barrier.arrived
      expect(new Set(barrier.updatedAt)).toEqual(new Set([overlapBase.updatedAt]))
      barrier.release()
      const overlapResults = await Promise.all(overlappingRequests)
      applicationPutBarrier = null
      expect(overlapResults.map(({ response }) => response.status).sort()).toEqual([200, 200])
      expect(overlapResults.some(({ headers }) => headers['x-phd-auto-merged'] === '1')).toBe(true)
      for (const result of overlapResults) {
        expect(result.data).toMatchObject({
          protocol: 'phd-atlas-application-mutation-ack-v2',
          durable: true,
          id: createdApplication.id,
        })
      }
      const finalRead = await jsonRequest(applicationPath, token)
      expect(finalRead.response.status, JSON.stringify(finalRead.payload)).toBe(200)
      expect(finalRead.data.program).toBe('Barrier program')
      expect(finalRead.data.tags).toContain('barrier-tag')

      // A PUT that hydrated before a later DELETE must not recreate the record
      // after the deletion commits. The trash snapshot belongs to the delete,
      // while the stale writer must terminate as a conflict/not-found result.
      const deleteRaceBase = finalRead.data
      const deleteRaceBarrier = armApplicationPutBarrier(createdApplication.id, 1)
      const lateWritePromise = jsonRequest(applicationPath, token, {
        method: 'PUT',
        body: JSON.stringify({
          ...deleteRaceBase,
          program: 'Must not survive deletion',
          clientBaseApplication: deleteRaceBase,
        }),
      })
      await deleteRaceBarrier.arrived
      const deleteResult = await jsonRequest(applicationPath, token, { method: 'DELETE' })
      expect(deleteResult.response.status, JSON.stringify(deleteResult.payload)).toBe(200)
      deleteRaceBarrier.release()
      const lateWrite = await lateWritePromise
      applicationPutBarrier = null
      expect([404, 409]).toContain(lateWrite.response.status)

      const afterDelete = await jsonRequest(applicationPath, token)
      expect(afterDelete.response.status).toBe(404)
      const trash = await jsonRequest('/api/applications/trash', token)
      expect(trash.response.status, JSON.stringify(trash.payload)).toBe(200)
      const deletedSnapshot = trash.data.find((item) => item.application?.id === createdApplication.id)
      expect(deletedSnapshot?.application?.program).toBe('Barrier program')
    } finally {
      applicationPutBarrier?.release()
      applicationPutBarrier = null
      await jsonRequest(applicationPath, token, { method: 'DELETE' })
    }
  })
})
