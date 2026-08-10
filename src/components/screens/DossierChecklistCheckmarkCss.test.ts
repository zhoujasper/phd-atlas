import { describe, expect, it } from 'vitest'
import indexStyles from '../../index.css?raw'
import dossierSource from './DossierView.tsx?raw'

const checklistTickRule = indexStyles.match(
  /\.checklist-check-btn \.animated-checkmark-tick\s*\{[\s\S]*?\n\}/,
)?.[0] ?? ''
const checkedChecklistTickRule = indexStyles.match(
  /\.checklist-check-btn \.animated-checkmark\.is-checked \.animated-checkmark-tick\s*\{[\s\S]*?\n\}/,
)?.[0] ?? ''
const checklistTitleRule = indexStyles.match(/(?:^|\r?\n)\.checklist-item-title\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
const checklistTitleVisualRule = indexStyles.match(/(?:^|\r?\n)\.checklist-item-title-visual\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
const checklistDoneTitleRule = indexStyles.match(
  /\.checklist-item\.done \.checklist-item-title\s*\{[\s\S]*?\n\}/,
)?.[0] ?? ''
const checklistDoneTitleVisualRule = indexStyles.match(
  /\.checklist-item\.done \.checklist-item-title-visual\s*\{[\s\S]*?\n\}/,
)?.[0] ?? ''
const checklistTitleStrikeRule = indexStyles.match(
  /(?:^|\r?\n)\.checklist-item-title-visual::after\s*\{[\s\S]*?\n\}/,
)?.[0] ?? ''
const checklistStatusMotionRule = indexStyles.match(
  /(?:^|\r?\n)\.checklist-status-chip,\s*\.checklist-item \.material-pill\s*\{[\s\S]*?\n\}/,
)?.[0] ?? ''

describe('dossier checklist checkmark motion', () => {
  it('keeps the tick complete and reversibly animated instead of dash-drawing a partial mark', () => {
    expect(checklistTickRule).toContain('stroke-dasharray: none;')
    expect(checklistTickRule).toContain('stroke-dashoffset: 0;')
    expect(checklistTickRule).toContain('transform: scale(0.72);')
    expect(checklistTickRule).toContain('opacity 140ms var(--ease-out)')
    expect(checklistTickRule).toContain('transform 220ms var(--ease-fluid)')
    expect(checklistTickRule).not.toMatch(/stroke-dashoffset\s+\d/)
    expect(indexStyles).toContain('.checklist-check-btn .animated-checkmark-shape {')
    expect(indexStyles).toContain('fill 220ms var(--ease-fluid)')
    expect(checkedChecklistTickRule).toContain('opacity: 1;')
    expect(checkedChecklistTickRule).toContain('transform: scale(1);')
    expect(checkedChecklistTickRule).not.toContain('transition-delay:')
  })

  it('leaves enough room for the mounted SVG inside the clickable control', () => {
    const buttonRule = indexStyles.match(/\.checklist-check-btn\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(buttonRule).toContain('overflow: visible;')
    expect(buttonRule).toContain('line-height: 0;')
  })

  it('keeps one title layer visible while the color and strike line travel smoothly', () => {
    expect(checklistTitleRule).toContain('color: var(--text);')
    expect(checklistTitleRule).toContain('transition: color 240ms var(--ease-fluid);')
    expect(checklistTitleVisualRule).toContain('color: transparent;')
    expect(checklistTitleVisualRule).toContain('transition: none;')
    expect(checklistDoneTitleRule).toContain('color: var(--text-tertiary);')
    expect(checklistDoneTitleRule).not.toContain('opacity:')
    expect(checklistDoneTitleVisualRule).toContain('opacity: 1;')
    expect(checklistTitleStrikeRule).toContain('background: var(--text-tertiary);')
    expect(checklistTitleStrikeRule).not.toContain('transition-delay:')
  })

  it('transitions checklist status colors and dots on the same mounted chip', () => {
    expect(checklistStatusMotionRule).toContain('color 220ms var(--ease-fluid)')
    expect(checklistStatusMotionRule).toContain('background-color 220ms var(--ease-fluid)')
    expect(checklistStatusMotionRule).toContain('border-color 220ms var(--ease-fluid)')
    expect(indexStyles).toContain('.checklist-status-chip .status-pill-dot,')
    expect(indexStyles).toContain('.checklist-item .material-pill .status-pill-dot {')
  })

  it('commits the visible completion state without a frame or transition delay', () => {
    expect(dossierSource).toContain('const ChecklistCompletionButton = memo(function ChecklistCompletionButton')
    expect(dossierSource).toContain('onChangeRef.current(nextChecked)')
    expect(dossierSource).not.toContain('pendingCheckedRef')
    expect(dossierSource).not.toContain('startTransition(() => onChangeRef.current(')
    expect(dossierSource).toContain('aria-pressed={visualChecked}')
  })
})
