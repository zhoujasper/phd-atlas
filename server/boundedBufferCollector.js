import { constants as bufferConstants } from 'node:buffer'

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024
const OWNED_SLAB_BYTES = 64 * 1024

function normalizedLimit(value) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > bufferConstants.MAX_LENGTH) {
    throw new RangeError('A bounded stream collector requires a safe positive byte limit.')
  }
  return parsed
}

/**
 * Collect a readable into bounded, owned allocations.
 *
 * PDFKit normally emits thousands of small Buffer views. Retaining those views
 * can retain substantially larger pooled backing stores, and Buffer.concat()
 * then briefly adds a second full output allocation. This collector copies each
 * chunk immediately into a small number of owned slabs and destroys the source
 * as soon as the declared limit is crossed. Slabs grow on demand, so a tiny PDF
 * does not reserve the complete 12 MiB ceiling. Finalization copies only the
 * actual bytes into one exact output buffer; peak collector ownership is less
 * than twice the logical output plus one slab and never exceeds twice the cap.
 */
export function collectReadableToBoundedBuffer(readable, {
  maxBytes = DEFAULT_MAX_BYTES,
  createOverflowError = () => {
    const error = new Error('Generated output exceeded its safe byte limit.')
    error.code = 'OUTPUT_TOO_LARGE'
    return error
  },
} = {}) {
  const capacity = normalizedLimit(maxBytes)

  return new Promise((resolve, reject) => {
    let slabs = []
    let slabUsed = []
    let allocatedBytes = 0
    let written = 0
    let settled = false

    const cleanup = () => {
      readable.removeListener('data', onData)
      readable.removeListener('end', onEnd)
      readable.removeListener('error', onError)
      readable.removeListener('close', onClose)
    }

    const fail = (error, { destroy = false } = {}) => {
      if (settled) return
      settled = true
      slabs = null
      slabUsed = null
      cleanup()
      // Keep an error listener attached while destroy(error) dispatches its
      // terminal event; otherwise Node treats that event as unhandled.
      if (destroy && !readable.destroyed) {
        readable.once('error', () => {})
        readable.destroy(error)
      }
      reject(error)
    }

    function onData(value) {
      if (settled) return
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      if (chunk.length > capacity - written) {
        const error = createOverflowError({ maxBytes: capacity, outputBytes: written + chunk.length })
        fail(error instanceof Error ? error : new Error(String(error)), { destroy: true })
        return
      }
      let sourceOffset = 0
      while (sourceOffset < chunk.length) {
        let slabIndex = slabs.length - 1
        let slab = slabs[slabIndex]
        let used = slabUsed[slabIndex] ?? 0
        if (!slab || used === slab.length) {
          const slabSize = Math.min(OWNED_SLAB_BYTES, capacity - allocatedBytes)
          slab = Buffer.allocUnsafe(slabSize)
          slabs.push(slab)
          slabUsed.push(0)
          allocatedBytes += slabSize
          slabIndex += 1
          used = 0
        }
        const copied = Math.min(chunk.length - sourceOffset, slab.length - used)
        chunk.copy(slab, used, sourceOffset, sourceOffset + copied)
        slabUsed[slabIndex] = used + copied
        sourceOffset += copied
      }
      written += chunk.length
    }

    function onEnd() {
      if (settled) return
      settled = true
      cleanup()
      // Buffer.allocUnsafe() may receive a larger allocator backing store on
      // some Node/platform combinations even when the Buffer view has the
      // requested length. An explicit ArrayBuffer preserves the collector's
      // exact-owned-output contract across runtimes.
      const output = written === 0
        ? Buffer.alloc(0)
        : Buffer.from(new ArrayBuffer(written))
      let outputOffset = 0
      for (let index = 0; index < slabs.length; index += 1) {
        const used = slabUsed[index]
        if (!used) continue
        slabs[index].copy(output, outputOffset, 0, used)
        outputOffset += used
      }
      slabs = null
      slabUsed = null
      resolve(output)
    }

    function onError(error) {
      fail(error)
    }

    function onClose() {
      if (settled || readable.readableEnded) return
      const error = new Error('Generated output stream closed before completion.')
      error.code = 'OUTPUT_STREAM_CLOSED'
      fail(error)
    }

    readable.on('data', onData)
    readable.once('end', onEnd)
    readable.once('error', onError)
    readable.once('close', onClose)
  })
}
