import { describe, expect, it } from 'vitest'
import { escapeCsvValue, parseCsvRows, stringifyCsvRows } from './csv'

describe('shared CSV helpers', () => {
  it('parses BOM, CRLF, quoted commas, line breaks, and escaped quotes', () => {
    expect(parseCsvRows(
      '\uFEFFemail,note\r\nstudent@example.edu,"One, two"\r\nteacher@example.edu,"Line 1\nLine ""2"""',
    )).toEqual([
      ['email', 'note'],
      ['student@example.edu', 'One, two'],
      ['teacher@example.edu', 'Line 1\nLine "2"'],
    ])
  })

  it('serializes values using the same quoting contract', () => {
    const rows = [
      ['email', 'note'],
      ['student@example.edu', 'Name, "quoted"'],
    ]
    const csv = stringifyCsvRows(rows)

    expect(csv).toBe('email,note\nstudent@example.edu,"Name, ""quoted"""')
    expect(parseCsvRows(csv)).toEqual(rows)
    expect(escapeCsvValue('plain')).toBe('plain')
  })
})
