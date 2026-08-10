import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { writeResponseChunk } from './index.js'

class CompressionStyleResponse extends EventEmitter {
  constructor() {
    super()
    this.compressionStream = new EventEmitter()
    this.destroyed = false
    this.writableEnded = false
  }

  on(type, listener) {
    if (type === 'drain') {
      this.compressionStream.on(type, listener)
      return this.compressionStream
    }
    return super.on(type, listener)
  }

  write() {
    return false
  }
}

describe('response backpressure ownership', () => {
  it('removes every redirected compression drain listener after sustained backpressure', async () => {
    const response = new CompressionStyleResponse()
    for (let index = 0; index < 32; index += 1) {
      const pending = writeResponseChunk(response, `chunk-${index}`)
      expect(response.compressionStream.listenerCount('drain')).toBe(1)
      response.compressionStream.emit('drain')
      await pending
      expect(response.compressionStream.listenerCount('drain')).toBe(0)
      expect(response.listenerCount('close')).toBe(0)
      expect(response.listenerCount('error')).toBe(0)
    }
  })

  it('removes the redirected drain listener when a backpressured client closes', async () => {
    const response = new CompressionStyleResponse()
    const pending = writeResponseChunk(response, 'pending')
    expect(response.compressionStream.listenerCount('drain')).toBe(1)
    response.emit('close')
    await expect(pending).rejects.toMatchObject({ code: 'CLIENT_DISCONNECTED' })
    expect(response.compressionStream.listenerCount('drain')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
    expect(response.listenerCount('error')).toBe(0)
  })
})
