import { describe, expect, it } from 'vitest'
import type { ApplicationRecord } from './data/applications'
import { applicationPersistenceAcknowledged } from './persistenceAcknowledgement'
import {
  APPLICATION_MUTATION_ACK_PROTOCOL,
  type ApplicationMutationAcknowledgement,
  type ApplicationMutationPatchOperation,
  applyApplicationMutationAcknowledgement,
  applicationAuthorityContentHash,
  applicationAuthoredContentHash,
  applicationMutationAckCommitment,
  canonicalValueHash,
} from './applicationMutationAcknowledgement'

type VersionedApplicationRecord = ApplicationRecord & { updatedAt: string }

const application = (authoredValue: string, updatedAt = '2026-08-02T10:00:00.000Z'): VersionedApplicationRecord => ({
  id: 'app-proof',
  ownerId: 'owner-1',
  teamId: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt,
  school: { name: 'Example University', country: 'United Kingdom' },
  program: 'Doctoral programme',
  result: authoredValue,
  materials: [{ id: 'm1', name: 'Statement', fileId: 'server-vault-id' }],
  tasks: [],
  communications: [],
} as unknown as VersionedApplicationRecord)

async function acknowledgementFor({
  submitted,
  durable,
  mutation,
  patch = [],
}: {
  submitted: VersionedApplicationRecord
  durable: VersionedApplicationRecord
  mutation: unknown
  patch?: ApplicationMutationPatchOperation[]
}): Promise<ApplicationMutationAcknowledgement> {
  const acknowledgement = {
    protocol: APPLICATION_MUTATION_ACK_PROTOCOL,
    projectionVersion: 2 as const,
    id: submitted.id,
    updatedAt: durable.updatedAt,
    baseUpdatedAt: submitted.updatedAt,
    operationCount: Array.isArray(mutation) ? mutation.length : 0,
    mutationHash: await canonicalValueHash(mutation),
    baselineHash: await applicationAuthoredContentHash(submitted),
    applicationHash: await applicationAuthoredContentHash(durable),
    authorityPurpose: 'none' as const,
    authorityProjectionVersion: 1 as const,
    authorityHash: await applicationAuthorityContentHash(durable),
    patch,
    durable: true as const,
  }
  return {
    ...acknowledgement,
    canonicalHash: await canonicalValueHash(applicationMutationAckCommitment(acknowledgement)),
  }
}

describe('application mutation acknowledgement', () => {
  it('binds the proof to authored content rather than only id and updatedAt', async () => {
    const left = application('First nested value')
    const right = application('Different nested value')
    expect(await applicationAuthoredContentHash(left)).not.toBe(await applicationAuthoredContentHash(right))
  })

  it('reconstructs a server-proven nested field and leaves strict save policy able to reject stripping', async () => {
    const submitted = application('Must survive')
    const durable = application('', '2026-08-02T10:00:01.000Z')
    const valueHash = await canonicalValueHash('')
    const mutation = [{ op: 'set', path: '/result', value: '' }]
    const acknowledgement = await acknowledgementFor({
      submitted,
      durable,
      mutation,
      patch: [{ op: 'set', path: '/result', value: '', valueHash }],
    })

    const canonical = await applyApplicationMutationAcknowledgement(acknowledgement, submitted, {
      baseUpdatedAt: submitted.updatedAt,
      operationCount: mutation.length,
      mutationHash: await canonicalValueHash(mutation),
    })
    expect(canonical.result).toBe('')
    expect(applicationPersistenceAcknowledged(submitted, canonical, application('Before'))).toBe(false)
  })

  it('ignores server-owned vault references while still proving authored fields', async () => {
    const submitted = application('Durable authored value')
    const durable = {
      ...submitted,
      updatedAt: '2026-08-02T10:00:01.000Z',
      materials: [{ ...submitted.materials[0], fileId: 'different-server-id' }],
    }
    const mutation = [{ op: 'set', path: '/result', value: submitted.result }]
    const acknowledgement = await acknowledgementFor({ submitted, durable, mutation })

    await expect(applyApplicationMutationAcknowledgement(acknowledgement, submitted, {
      baseUpdatedAt: submitted.updatedAt,
      operationCount: mutation.length,
      mutationHash: await canonicalValueHash(mutation),
    })).resolves.toMatchObject({ result: submitted.result, updatedAt: durable.updatedAt })
  })

  it('rejects a tampered patch value even when the outer envelope remains well-shaped', async () => {
    const submitted = application('Before')
    const durable = application('After', '2026-08-02T10:00:01.000Z')
    const mutation = [{ op: 'set', path: '/result', value: 'After' }]
    const acknowledgement = await acknowledgementFor({
      submitted,
      durable,
      mutation,
      patch: [{
        op: 'set',
        path: '/result',
        value: 'After',
        valueHash: await canonicalValueHash('After'),
      }],
    })
    const [operation] = acknowledgement.patch
    if (!operation || (operation.op !== 'set' && operation.op !== 'add')) {
      throw new Error('Expected a value-bearing patch operation')
    }
    acknowledgement.patch = [{ ...operation, value: 'Attacker value' }]

    await expect(applyApplicationMutationAcknowledgement(acknowledgement, submitted, {
      baseUpdatedAt: submitted.updatedAt,
      operationCount: mutation.length,
      mutationHash: await canonicalValueHash(mutation),
    })).rejects.toMatchObject({ code: 'REQUEST_FAILED' })
  })

  it('hashes a multi-megabyte authored leaf incrementally without putting it in a compact patch', async () => {
    const submitted = application('x'.repeat(2 * 1024 * 1024))
    const durable = { ...submitted, updatedAt: '2026-08-02T10:00:01.000Z' }
    const mutation = [{ op: 'set', path: '/progress', value: 50 }]
    const acknowledgement = await acknowledgementFor({ submitted, durable, mutation })
    expect(JSON.stringify(acknowledgement).length).toBeLessThan(2_048)
    await expect(applyApplicationMutationAcknowledgement(acknowledgement, submitted, {
      baseUpdatedAt: submitted.updatedAt,
      operationCount: mutation.length,
      mutationHash: await canonicalValueHash(mutation),
    })).resolves.toMatchObject({ result: submitted.result })
  })
})
