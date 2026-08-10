import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  incrementalJsonChunks,
  releaseWorkspaceStreamPreparationAfterHandler,
  retainWorkspaceStreamPreparationForSources,
  WORKSPACE_STREAM_LARGE_CURSOR_PAYLOAD_BYTES,
  workspaceStreamHasLargeCursorSource,
} from './index.js'

function chunkedJson(value, size = 1024) {
  return [...incrementalJsonChunks(value, size)].join('')
}

describe('workspace sectional JSON streaming', () => {
  it('retains serialized preparation only when a cursor source has a row above the safety threshold', () => {
    const threshold = WORKSPACE_STREAM_LARGE_CURSOR_PAYLOAD_BYTES
    expect(workspaceStreamHasLargeCursorSource([])).toBe(false)
    expect(workspaceStreamHasLargeCursorSource([
      { maxPayloadBytes: 0 },
      { maxPayloadBytes: threshold },
      {},
    ])).toBe(false)
    expect(workspaceStreamHasLargeCursorSource([
      { maxPayloadBytes: 512 },
      { maxPayloadBytes: threshold + 1 },
    ])).toBe(true)

    const releaseSmall = vi.fn()
    expect(retainWorkspaceStreamPreparationForSources(
      [{ maxPayloadBytes: threshold }],
      releaseSmall,
    )).toBe(false)
    expect(releaseSmall).toHaveBeenCalledOnce()

    const releaseLarge = vi.fn()
    expect(retainWorkspaceStreamPreparationForSources(
      [{ maxPayloadBytes: threshold + 1 }],
      releaseLarge,
    )).toBe(true)
    expect(releaseLarge).not.toHaveBeenCalled()

    releaseWorkspaceStreamPreparationAfterHandler(true, releaseLarge)
    expect(releaseLarge).not.toHaveBeenCalled()

    releaseWorkspaceStreamPreparationAfterHandler(false, releaseSmall)
    expect(releaseSmall).toHaveBeenCalledTimes(2)
  })

  it('matches JSON.stringify for nested schema values and well-formed string escaping', () => {
    const sparse = []
    sparse.length = 4
    sparse[1] = undefined
    sparse[2] = Number.NaN
    sparse[3] = 'quote " slash \\ controls \b\f\n\r\t\u0000 emoji 😀 lone \ud800 \udc00'
    const shared = { label: 'shared' }
    const value = {
      number: 12.5,
      negativeZero: -0,
      infinity: Number.POSITIVE_INFINITY,
      omitted: undefined,
      function: () => {},
      date: new Date('2026-08-02T12:34:56.000Z'),
      boxed: Object('boxed'),
      sparse,
      sharedA: shared,
      sharedB: shared,
      custom: { toJSON: () => ({ safe: true }) },
    }

    expect(chunkedJson(value)).toBe(JSON.stringify(value))
    expect(JSON.parse(chunkedJson(value))).toEqual(JSON.parse(JSON.stringify(value)))
  })

  it('rejects cycles and BigInt exactly at the incremental serialization boundary', () => {
    const cyclic = { id: 'cycle' }
    cyclic.self = cyclic
    expect(() => chunkedJson(cyclic)).toThrow(/circular/u)
    expect(() => chunkedJson({ value: 1n })).toThrow(/BigInt/u)
  })

  it('streams one record above 16 MiB without producing an oversized token or chunk', () => {
    const source = 'x'.repeat((17 * 1024 * 1024) + 37)
    const actualHash = createHash('sha256')
    let chunks = 0
    let characters = 0
    let maximum = 0
    for (const chunk of incrementalJsonChunks(source, 96 * 1024)) {
      chunks += 1
      characters += chunk.length
      maximum = Math.max(maximum, chunk.length)
      actualHash.update(chunk)
    }

    const expectedHash = createHash('sha256').update('"').update(source).update('"').digest('hex')
    expect(actualHash.digest('hex')).toBe(expectedHash)
    expect(characters).toBe(source.length + 2)
    expect(maximum).toBeLessThanOrEqual(96 * 1024)
    expect(chunks).toBeGreaterThan(170)
  })
})
