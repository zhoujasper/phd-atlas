import { describe, expect, it } from 'vitest'
import {
  detectRichTextFormat,
  htmlToMarkdown,
  markdownToSafeHtml,
  normalizeEscapedMultiline,
  sanitizeRichHtml,
} from './richText'

describe('rich text conversion', () => {
  it('decodes literal escape markers into real newlines', () => {
    expect(normalizeEscapedMultiline('a\\n\\nb\\r\\nc\\rd')).toBe('a\n\nb\nc\nd')
    expect(normalizeEscapedMultiline('already\nnormalized')).toBe('already\nnormalized')
  })

  it('detects plain text, Markdown, and HTML sources', () => {
    expect(detectRichTextFormat('plain note')).toBe('plain')
    expect(detectRichTextFormat('Needs **portfolio polish**')).toBe('markdown')
    expect(detectRichTextFormat('<p>Needs <strong>portfolio polish</strong></p>')).toBe('html')
  })

  it('renders common Markdown formatting into one safe HTML surface', () => {
    const html = markdownToSafeHtml('# Fit\n\nNeeds **polish**, ++review++, and [portal](https://example.edu).\n\n- Draft\n- Submit')

    expect(html).toContain('<h1>Fit</h1>')
    expect(html).toContain('<strong>polish</strong>')
    expect(html).toContain('<u>review</u>')
    expect(html).toContain('<ul>\n<li>Draft</li>\n<li>Submit</li>\n</ul>')
    expect(html).toContain('href="https://example.edu"')
  })

  it('uses standard Markdown semantics for soft, hard, and paragraph breaks', () => {
    expect(markdownToSafeHtml('Line one\nLine two')).toBe('<p>Line one\nLine two</p>')
    expect(markdownToSafeHtml('Line one  \nLine two')).toBe('<p>Line one<br>\nLine two</p>')
    expect(markdownToSafeHtml('Line one\\\nLine two')).toBe('<p>Line one<br>\nLine two</p>')
    expect(markdownToSafeHtml('Paragraph one\n\nParagraph two')).toBe('<p>Paragraph one</p>\n<p>Paragraph two</p>')
  })

  it('renders GFM tables, task lists, images, and footnotes', () => {
    const html = markdownToSafeHtml(`- [x] Ready

| Item | State |
| --- | --- |
| Proposal | Done |

![Diagram](https://example.edu/diagram.png)

Evidence.[^1]

[^1]: Official source.`)

    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<table>')
    expect(html).toContain('src="https://example.edu/diagram.png"')
    expect(html).toContain('class="footnotes"')
    expect(html).toContain('Official source')
  })

  it('removes executable HTML while preserving safe formatting and links', () => {
    const html = sanitizeRichHtml(`
      <p onclick="alert(1)">Hello <strong>world</strong><script>alert(1)</script></p>
      <a href="javascript:alert(1)">unsafe</a>
      <a href="https://example.edu" style="color:red">safe</a>
    `)

    expect(html).not.toMatch(/script|onclick|javascript:|style=/i)
    expect(html).toContain('<strong>world</strong>')
    expect(html).toContain('href="https://example.edu"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('serializes visual edits back to Markdown', () => {
    const markdown = htmlToMarkdown('<p>Hello <strong>world</strong> and <u>review</u>.</p><ol><li>Draft</li><li>Submit</li></ol>')

    expect(markdown).toContain('Hello **world** and ++review++.')
    expect(markdown).toContain('1. Draft')
    expect(markdown).toContain('2. Submit')
    expect(htmlToMarkdown('<p>Line one<br>Line two</p>')).toBe('Line one\\\nLine two')
  })
})
