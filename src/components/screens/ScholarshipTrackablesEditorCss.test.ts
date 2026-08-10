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
    expect(editor).toContain('border: 0')
    expect(editor).not.toContain('border-bottom')
    expect(editor).toContain('background: transparent')
    expect(normalizedStyles).not.toContain('.scholarship-row-title-editor::after {')
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

  it('uses the pointer as the primary drop target and keeps keyboard sorting as a measured fallback', () => {
    expect(dossierSource).toContain('const scholarshipPointerCollision: CollisionDetection')
    expect(dossierSource).toContain('const pointerCollisions = pointerWithin(args)')
    expect(dossierSource).toContain(
      'return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args)',
    )
    expect(dossierSource.match(/collisionDetection=\{scholarshipPointerCollision\}/g)).toHaveLength(2)
    expect(dossierSource).toContain('transition: SCHOLARSHIP_SORT_TRANSITION')
    expect(dossierSource).toContain('duration: 180')
  })

  it('keeps one resident drag copy and fades it in place without a second flight', () => {
    expect(dossierSource).toContain('<DragOverlay')
    expect(dossierSource).toContain('onDragStart={(event) => startTrackableDrag(event,')
    expect(dossierSource).toContain(
      'if (!reordered || scholarshipDragReducedMotionRef.current) finishScholarshipDragPreview(true)',
    )
    expect(dossierSource).toContain('dropAnimation={reducedMotion ? null : dropAnimation}')
    expect(dossierSource).toContain('const currentTransform = `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scaleX}, ${transform.scaleY})`')
    expect(dossierSource).toContain('{ transform: currentTransform, opacity: 0 }')
    expect(dossierSource).toContain('source.cloneNode(true) as HTMLElement')
    expect(dossierSource).toContain("preview.classList.add('scholarship-drag-preview')")
    expect(dossierSource).toContain('host.replaceChildren(preview.element)')
    expect(dossierSource).toContain('function ScholarshipTrackableDragOverlay')
    expect(dossierSource).toMatch(/createPortal\([\s\S]*?<DragOverlay[\s\S]*?document\.body/)
    expect(dossierSource).toContain('height: preview.height ? `${preview.height}px` : undefined')
    expect(dossierSource).not.toContain("active.node.style.opacity = '0'")
    expect(dossierSource).not.toContain('document.querySelectorAll<HTMLElement>(\'[data-scholarship-sortable-id]\')')
    expect(dossierSource).not.toContain('const finalX = targetRect.left - dragOverlay.rect.left')
    expect(dossierSource).not.toContain('const finalY = targetRect.top - dragOverlay.rect.top')
    expect(dossierSource).toContain('window.requestAnimationFrame(() =>')
    expect(dossierSource).toContain('animation.onfinish = finish')
    expect(dossierSource).not.toContain('scholarshipDragPreviewClearTimerRef')
    const preview = cssRule('.scholarship-mini-row.scholarship-drag-preview')
    const previewHost = cssRule('.scholarship-drag-preview-host')
    const overlay = cssRule('.scholarship-drag-overlay-layer')
    const dropSlot = cssRule('.scholarship-mini-row.is-dragging')
    expect(preview).toContain('contain: layout paint style')
    expect(preview).toContain('pointer-events: none')
    expect(preview).toContain('transform: none')
    expect(preview).toContain('0 18px 42px rgba(0, 0, 0, 0.14)')
    expect(previewHost).toContain('container-type: inline-size')
    expect(previewHost).not.toContain('max-width')
    expect(overlay).toContain('will-change: transform, opacity')
    expect(dropSlot).toContain('opacity: 0.52')
    expect(dropSlot).toContain('border-color: var(--border)')
    expect(dropSlot).toContain('box-shadow: none')
    expect(normalizedStyles).not.toMatch(/(?:^|\n)\.scholarship-mini-row\.is-dragging > \*\s*\{/)
    expect(normalizedStyles).not.toMatch(/(?:^|\n)\.scholarship-mini-row\.is-dragging::after\s*\{/)
  })

  it('exposes searchable, account-managed status controls for both trackable rows', () => {
    expect(dossierSource).toContain('create={scholarshipMaterialStatusCreateConfig(form, updateForm, material)}')
    expect(dossierSource).toContain('create={scholarshipTaskStatusCreateConfig(form, updateForm, task)}')
    expect(dossierSource).toContain('options={taskStatusOptions}')
    expect(dossierSource).toContain('searchable')
    expect(dossierSource).toContain('customChecklistStatuses')
    expect(dossierSource).toContain('className={`scholarship-check-btn${material.status === \'Submitted\' ? \' on\' : \'\'}`}')
    expect(dossierSource).toContain('<AnimatedCheckmark checked={material.status === \'Submitted\'} size={18} />')
  })

  it('reflows against the list container and preserves a reduced-motion path', () => {
    const list = cssRule('.scholarship-mini-list')

    expect(list).toContain('container-type: inline-size')
    expect(normalizedStyles).toMatch(
      /@container \(max-width:\s*620px\)\s*\{[\s\S]*?\.scholarship-mini-row\.material-row\s*\{[^}]*"drag check title"[^}]*"\. \. meta"/s,
    )
    expect(normalizedStyles).toMatch(
      /@container \(max-width:\s*620px\)\s*\{[\s\S]*?\.scholarship-mini-row\.task-row\s*\{[^}]*"drag check title"[^}]*"\. \. meta"/s,
    )
    expect(normalizedStyles).toMatch(
      /\.scholarship-row-meta\.task-meta\s*\{[^}]*minmax\(104px, 0\.82fr\)[^}]*minmax\(136px, 1fr\)/s,
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
