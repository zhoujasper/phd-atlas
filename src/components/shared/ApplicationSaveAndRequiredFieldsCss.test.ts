import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'

describe('application save status and required field polish', () => {
  it('keeps the bottom-right auto-save surface deliberately compact', () => {
    expect(coreStyles).toMatch(
      /\.application-save-indicator\s*\{[^}]*min-height:\s*26px[^}]*max-width:\s*min\(460px,[^}]*gap:\s*6px[^}]*padding:\s*3px 6px[^}]*font-size:\s*10px/s,
    )
    expect(coreStyles).toMatch(
      /\.application-save-indicator-actions button\s*\{[^}]*min-height:\s*22px[^}]*padding:\s*0 6px[^}]*font-size:\s*10px/s,
    )
  })

  it('uses one semantic required marker treatment beside field captions', () => {
    expect(coreStyles).toMatch(
      /\.field-required-mark\s*\{[^}]*margin-inline-start:\s*2px[^}]*color:\s*var\(--danger\)[^}]*letter-spacing:\s*0/s,
    )
  })
})
