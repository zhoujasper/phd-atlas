import { describe, expect, it } from 'vitest'
import { SourceStructureChangedError } from './sourceErrors.js'
import {
  findByClass,
  findByTag,
  parseHtml,
  requireTableRows,
  textContent,
} from './sourceHtml.js'

describe('source HTML helpers', () => {
  it('parses and traverses an HTML tree', () => {
    const tree = parseHtml(`<!doctype html><html><body>
      <table class="results"><tbody><tr><td>Accepted</td></tr></tbody></table>
    </body></html>`)

    const table = findByClass(tree, 'results')
    const row = findByTag(table, 'tr')
    expect(row).toHaveLength(1)
    expect(textContent(row[0])).toContain('Accepted')
  })

  it('fails closed when the required table disappears', () => {
    const tree = parseHtml('<html><body><div>No survey table</div></body></html>')
    expect(() => requireTableRows(tree, 'gradcafe')).toThrow(SourceStructureChangedError)
  })
})
