import { describe, expect, it } from 'vitest'
import { TeamPatchSchema, parseOrThrow } from './validation.js'

const VALID_ONE_PIXEL_PNG = [
  'data:image/png;base64,',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
].join('')

describe('organization logo validation', () => {
  it('accepts a valid PNG logo and allows rectangular PNG dimensions', () => {
    expect(parseOrThrow(TeamPatchSchema, { logoDataUrl: VALID_ONE_PIXEL_PNG }))
      .toEqual({ logoDataUrl: VALID_ONE_PIXEL_PNG })

    const rectangularBytes = Buffer.from(
      VALID_ONE_PIXEL_PNG.slice('data:image/png;base64,'.length),
      'base64',
    )
    rectangularBytes.writeUInt32BE(1200, 16)
    rectangularBytes.writeUInt32BE(300, 20)
    const rectangular = `data:image/png;base64,${rectangularBytes.toString('base64')}`

    expect(parseOrThrow(TeamPatchSchema, { logoDataUrl: rectangular }))
      .toEqual({ logoDataUrl: rectangular })
  })

  it('rejects non-PNG data and malformed PNG headers', () => {
    expect(() => parseOrThrow(TeamPatchSchema, {
      logoDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    })).toThrow()
    expect(() => parseOrThrow(TeamPatchSchema, {
      logoDataUrl: 'data:image/png;base64,SGVsbG8=',
    })).toThrow()
  })
})
