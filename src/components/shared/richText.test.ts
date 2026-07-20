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

    expect(html).toContain('<h3>Fit</h3>')
    expect(html).toContain('<strong>polish</strong>')
    expect(html).toContain('<u>review</u>')
    expect(html).toContain('<ul><li>Draft</li><li>Submit</li></ul>')
    expect(html).toContain('href="https://example.edu"')
  })

  it('uses standard Markdown semantics for soft, hard, and paragraph breaks', () => {
    expect(markdownToSafeHtml('Line one\nLine two')).toBe('<p>Line one Line two</p>')
    expect(markdownToSafeHtml('Line one  \nLine two')).toBe('<p>Line one<br>Line two</p>')
    expect(markdownToSafeHtml('Line one\\\nLine two')).toBe('<p>Line one<br>Line two</p>')
    expect(markdownToSafeHtml('Paragraph one\n\nParagraph two')).toBe('<p>Paragraph one</p><p>Paragraph two</p>')
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
