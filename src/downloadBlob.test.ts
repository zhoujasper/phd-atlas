import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNLOAD_URL_REVOKE_DELAY_MS, downloadBlob } from './downloadBlob'

describe('downloadBlob', () => {
  const createObjectURL = vi.fn(() => 'blob:phd-atlas-export')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('waits for the browser download manager before revoking the object URL', () => {
    const blob = new Blob(['application export'], { type: 'application/json' })

    downloadBlob(blob, 'phd-applications-all.json')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(document.body.querySelector('a')).toBeNull()

    vi.advanceTimersByTime(DOWNLOAD_URL_REVOKE_DELAY_MS)

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:phd-atlas-export')
  })
})
