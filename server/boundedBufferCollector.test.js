import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { collectReadableToBoundedBuffer } from './boundedBufferCollector.js'

describe('bounded readable collector', () => {
  it('copies thousands of tiny chunks into one exact output without retaining pooled inputs', async () => {
    const source = Readable.from(Array.from({ length: 20_000 }, () => Buffer.from('x')))
    const output = await collectReadableToBoundedBuffer(source, { maxBytes: 64 * 1024 })

    expect(output.length).toBe(20_000)
    expect(output.toString('utf8')).toBe('x'.repeat(20_000))
    expect(output.buffer.byteLength).toBe(output.length)
  })

  it('destroys the producer and rejects without returning a partial output on overflow', async () => {
    const source = Readable.from(Array.from({ length: 2_000 }, () => Buffer.alloc(8, 1)))

    await expect(collectReadableToBoundedBuffer(source, {
      maxBytes: 1_024,
      createOverflowError: () => Object.assign(new Error('bounded overflow'), { code: 'BOUNDED_OVERFLOW' }),
    })).rejects.toMatchObject({ code: 'BOUNDED_OVERFLOW' })
    expect(source.destroyed).toBe(true)
  })
})
