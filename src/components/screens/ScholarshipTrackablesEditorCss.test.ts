import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import dossierStyles from '../../index.css?raw'

const normalizedStyles = dossierStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedStyles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('Scholarship materials and tasks editor', () => {
  it('makes editable titles explicit and lets long content grow instead of clipping', () => {
    const editor = cssRule('.scholarship-row-title-editor')
    const textarea = cssRule('.scholarship-row-title-editor textarea')

    expect(dossierSource).toContain('function ScholarshipRowTitleEditor')
    expect(dossierSource).toContain('<PencilLine size={13} aria-hidden="true" />')
    expect(dossierSource).toContain('wrap="soft"')
    expect(editor).toContain('border: 1px solid var(--border)')
    expect(editor).toContain('background: var(--surface)')
    expect(textarea).toContain('white-space: pre-wrap')
    expect(textarea).toContain('overflow-wrap: anywhere')
    expect(textarea).toContain('max-height: 76px')
  })

  it('keeps status and due date visibly labeled without flattening their controls', () => {
    const field = cssRule('.scholarship-row-field')
    const label = cssRule('.scholarship-row-field > span')

    expect(dossierSource).toContain('<span>{tx(\'dossier.status\')}</span>')
    expect(dossierSource).toContain('<span>{tx(\'dossier.dueDate\')}</span>')
    expect(field).toContain('display: grid')
    expect(label).toContain('font-size: 10px')
    expect(normalizedStyles).not.toMatch(
      /(?:^|\n)\.scholarship-mini-row input\s*\{[^}]*border:\s*none/s,
    )
  })

  it('uses handle-only sortable rows for interactive material and task records', () => {
    const handle = cssRule('.scholarship-row-drag-handle')

    expect(dossierSource).toContain('function SortableScholarshipRow')
    expect(dossierSource).toContain('useSortable({ id })')
    expect(dossierSource).toContain('className="scholarship-row-drag-handle"')
    expect(dossierSource).toContain('reorderScholarshipRows(form.materials')
    expect(dossierSource).toContain('reorderScholarshipRows(form.tasks')
    expect(dossierSource).toContain('sortableKeyboardCoordinates')
    expect(handle).toContain('cursor: grab')
    expect(handle).toContain('touch-action: none')
  })

  it('reflows against the list container and preserves a reduced-motion path', () => {
    const list = cssRule('.scholarship-mini-list')

    expect(list).toContain('container-type: inline-size')
    expect(normalizedStyles).toMatch(
      /@container \(max-width:\s*620px\)\s*\{[\s\S]*?\.scholarship-mini-row\.material-row\s*\{[^}]*"drag title remove"[^}]*"\. meta meta"/s,
    )
    expect(normalizedStyles).toMatch(
      /@container \(max-width:\s*620px\)\s*\{[\s\S]*?\.scholarship-mini-row\.task-row\s*\{[^}]*"drag check title remove"[^}]*"\. \. meta meta"/s,
    )
    expect(normalizedStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.scholarship-mini-row,[\s\S]*?transition-duration:\s*0\.01ms !important/s,
    )
  })

  it('keeps completion feedback continuously mounted', () => {
    expect(dossierSource).toContain('<AnimatedCheckmark checked={task.done} size={18} />')
    expect(dossierSource).not.toContain(
      "{task.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}",
    )
  })
})
