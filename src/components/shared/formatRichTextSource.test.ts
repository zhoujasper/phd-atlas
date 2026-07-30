import { describe, expect, it } from 'vitest'

import { formatRichTextSource } from './formatRichTextSource'

describe('rich-text source formatter', () => {
  it('formats HTML with stable indentation', async () => {
    await expect(
      formatRichTextSource('<section><h2>Plan</h2><p>Ready</p></section>', 'html'),
    ).resolves.toBe('<section>\n  <h2>Plan</h2>\n  <p>Ready</p>\n</section>')
  })

  it('normalizes Markdown list indentation without reflowing prose', async () => {
    const source = '## Plan\n\n- first\n    - nested\n\nA deliberately short paragraph.'
    const formatted = await formatRichTextSource(source, 'markdown')

    expect(formatted).toContain('  - nested')
    expect(formatted).toContain('A deliberately short paragraph.')
    expect(formatted).not.toMatch(/\n$/)
  })

  it('leaves plain text and empty values untouched', async () => {
    await expect(formatRichTextSource('Plain text', 'plain')).resolves.toBe('Plain text')
    await expect(formatRichTextSource('', 'markdown')).resolves.toBe('')
  })
})
