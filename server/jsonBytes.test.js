import { describe, expect, it } from 'vitest'
import { jsonBytes } from './index.js'

const encodedBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

describe('allocation-bounded JSON byte counting', () => {
  it.each([
    [null],
    [true],
    [false],
    [0],
    [-12.5],
    [Number.NaN],
    ['plain ASCII'],
    ['引号"、反斜线\\、换行\n和 emoji 🧪'],
    ['\ud800 lone high surrogate'],
    ['\udc00 lone low surrogate'],
    [{ alpha: 1, beta: '二', nested: { ok: true } }],
    [[1, undefined, , '四']],
  ])('matches JSON.stringify UTF-8 bytes for %j', (value) => {
    expect(jsonBytes(value)).toBe(encodedBytes(value))
  })

  it('matches toJSON, boxed primitive, and omitted-property semantics', () => {
    const value = {
      date: new Date('2026-08-02T12:34:56.000Z'),
      boxed: new Number(42),
      omitted: undefined,
      ignored: () => 'ignored',
      custom: {
        toJSON(key) {
          return `${key}:normalized`
        },
      },
    }
    expect(jsonBytes(value)).toBe(encodedBytes(value))
  })

  it('handles deeply nested data without recursive stack growth', () => {
    let value = { end: true }
    for (let index = 0; index < 20_000; index += 1) value = { child: value }
    expect(jsonBytes(value)).toBe((20_000 * 10) + 12)
  })

  it('stops traversing after a caller byte cap is exceeded', () => {
    let touched = false
    const value = {
      first: 'x'.repeat(4_096),
      second: {
        toJSON() {
          touched = true
          return 'must-not-run'
        },
      },
    }
    const bytes = jsonBytes(value, 128)
    expect(bytes).toBeGreaterThan(128)
    expect(touched).toBe(false)
  })

  it('rejects the same unsupported cyclic and BigInt inputs as JSON.stringify', () => {
    const cyclic = {}
    cyclic.self = cyclic
    expect(() => jsonBytes(cyclic)).toThrow(/circular structure/iu)
    expect(() => jsonBytes({ value: 1n })).toThrow(/BigInt/u)
  })
})
