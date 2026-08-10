import { describe, expect, it } from 'vitest'

import {
  detectRichTextFormat,
  markdownToSafeHtml,
  renderRichTextEmail,
  renderStoredRichTextEmail,
  richTextToPlainText,
  sanitizeRichHtml,
} from './richText.js'

describe('shared rich-text rendering', () => {
  it('renders common GFM structures and the existing underline extension', () => {
    const html = markdownToSafeHtml(`## Research plan

- [x] Literature review
- [ ] Experiments

| Stage | Status |
| --- | --- |
| Proposal | Ready |

This is ++important++ and includes a footnote.[^source]

[^source]: Official programme page.`)

    expect(html).toContain('<h2>Research plan</h2>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<table>')
    expect(html).toContain('<u>important</u>')
    expect(html).toContain('Official programme page')
  })

  it('covers the remaining common Markdown block and inline vocabulary', () => {
    const html = markdownToSafeHtml(`### Methods

> Read the *paper* and ~~retire~~ revise the \`draft\`.

1. Prepare
   1. Validate

\`\`\`html
<p>Example</p>
\`\`\`

---

Contact <team@example.edu>.`)

    expect(html).toContain('<h3>Methods</h3>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<em>paper</em>')
    expect(html).toContain('<del>retire</del>')
    expect(html).toContain('<code>draft</code>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<pre><code class="language-html">')
    expect(html).toContain('<hr>')
    expect(html).toContain('href="mailto:team@example.edu"')
  })

  it('preserves safe semantic HTML used in authored notes and emails', () => {
    const html = sanitizeRichHtml(`<article>
      <figure><img src="https://example.edu/chart.png" alt="Chart"><figcaption>Results</figcaption></figure>
      <details open><summary>Method</summary><p><mark>Important</mark> <kbd>Ctrl</kbd></p></details>
      <dl><dt>State</dt><dd>Ready</dd></dl>
      <p>H<sub>2</sub>O and x<sup>2</sup> at <time datetime="2026-07-29">today</time>.</p>
    </article>`)

    expect(html).toContain('<article>')
    expect(html).toContain('<figure>')
    expect(html).toContain('<figcaption>Results</figcaption>')
    expect(html).toContain('<details open>')
    expect(html).toContain('<mark>Important</mark>')
    expect(html).toContain('<kbd>Ctrl</kbd>')
    expect(html).toContain('<dl>')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('<sup>2</sup>')
    expect(html).toContain('datetime="2026-07-29"')
  })

  it('removes active content and unsafe URLs from HTML', () => {
    const html = sanitizeRichHtml(
      '<p onclick="alert(1)">Safe <a href="javascript:alert(1)">link</a></p>' +
        '<script>alert(2)</script><img src="data:text/html,unsafe" onerror="alert(3)" alt="diagram">',
    )

    expect(html).toContain('<p>Safe link</p>')
    expect(html).toContain('diagram')
    expect(html).not.toMatch(/onclick|javascript:|<script|onerror|data:/i)
  })

  it('creates readable plain text without leaking Markdown syntax', () => {
    const text = richTextToPlainText(
      '# Update\n\n**Ready** for [review](https://example.com/review).\n\n- [x] Send draft',
      'markdown',
    )

    expect(text).toContain('Update')
    expect(text).toContain('Ready for review (https://example.com/review).')
    expect(text).toContain('- ☑ Send draft')
    expect(text).not.toMatch(/[#*[\]]/)
  })

  it('uses one sanitized structure for the stored preview and sent email', () => {
    const rendered = renderRichTextEmail(
      '## Next steps\n\n1. Review the **proposal**\n2. Visit <https://example.com>',
      'markdown',
    )

    expect(rendered.format).toBe('markdown')
    expect(rendered.contentHtml).toContain('<h2>Next steps</h2>')
    expect(rendered.contentHtml).toContain('<strong>proposal</strong>')
    expect(rendered.html).toMatch(/<h2 style="[^"]+">Next steps<\/h2>/)
    expect(rendered.html).toMatch(/<strong style="[^"]+">proposal<\/strong>/)
    expect(rendered.html).toContain('font-family:')
    expect(rendered.text).toContain('Review the proposal')
    expect(rendered.text).not.toContain('**proposal**')
  })

  it.each([
    {
      format: 'plain',
      source: 'Dear Professor,\nThank you for your time.',
      visibleBreak: /Dear Professor,<br>Thank you for your time\./,
    },
    {
      format: 'markdown',
      source: 'Dear **Professor**,\nThank you for your time.',
      visibleBreak: /Dear <strong(?: style="[^"]+")?>Professor<\/strong>,<br>\s*Thank you for your time\./,
    },
  ])('preserves a single $format line break in sent HTML', ({ format, source, visibleBreak }) => {
    const rendered = renderRichTextEmail(source, format)

    expect(rendered.contentHtml).toMatch(visibleBreak)
    expect(rendered.html).toMatch(visibleBreak)
    expect(rendered.text).toBe('Dear Professor,\nThank you for your time.')
  })

  it('reuses the immutable stored snapshot for delayed delivery and retries', () => {
    const rendered = renderStoredRichTextEmail({
      summary: '## A later local edit',
      bodyFormat: 'markdown',
      bodyHtml: '<h2>Queued snapshot</h2><p><strong>Ready</strong>.</p>',
      bodyText: 'Queued snapshot\n\nReady.',
    })

    expect(rendered.contentHtml).toContain('Queued snapshot')
    expect(rendered.html).toContain('Queued snapshot')
    expect(rendered.html).not.toContain('later local edit')
    expect(rendered.text).toBe('Queued snapshot\n\nReady.')
  })

  it('detects HTML before Markdown-looking characters inside HTML', () => {
    expect(detectRichTextFormat('<p><strong>Ready</strong></p>')).toBe('html')
    expect(detectRichTextFormat('<span>Inline HTML</span>')).toBe('html')
    expect(detectRichTextFormat('## Ready')).toBe('markdown')
    expect(detectRichTextFormat('Plain status update')).toBe('plain')
  })
})
