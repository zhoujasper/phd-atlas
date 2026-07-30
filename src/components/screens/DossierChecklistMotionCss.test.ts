import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import dossierStyles from '../../index.css?raw'

const pointerFrameSource = dossierSource.match(
  /const paintFrame = \(allowAutoScroll: boolean\) => \{[\s\S]*?const runFrame = \(\) => \{/,
)?.[0] ?? ''

describe('dossier checklist motion', () => {
  it('rotates a resident wrapper with an interruptible fluid transition', () => {
    expect(dossierSource.match(/className="checklist-expand-glyph"/g)).toHaveLength(2)
    expect(dossierStyles).toMatch(
      /\.checklist-expand-glyph\s*\{[^}]*transform:\s*rotate\(0deg\)[^}]*transition:\s*transform 320ms var\(--ease-fluid\)/s,
    )
    expect(dossierStyles).toMatch(
      /\.checklist-expand-btn\.open \.checklist-expand-glyph\s*\{[^}]*transform:\s*rotate\(-180deg\)/s,
    )
    expect(dossierStyles).not.toMatch(/\.checklist-expand-btn\.open svg\s*\{/)
  })

  it('keeps pointer-frequency sorting off React and layout measurement paths', () => {
    expect(pointerFrameSource).toContain('session.overlay.style.transform')
    expect(pointerFrameSource).toContain('updateDropPreview()')
    expect(pointerFrameSource).not.toContain('getBoundingClientRect')
    expect(pointerFrameSource).not.toContain('querySelector')
    expect(pointerFrameSource).not.toMatch(/\bset[A-Z]\w*\(/)
    expect(dossierSource).not.toContain('setChecklistDropTarget')
    expect(dossierSource).not.toContain('renderChecklistDropSlot')
  })

  it('uses a fixed drag copy and compositor-only sibling previews without layout slots', () => {
    expect(dossierStyles).toMatch(
      /\.checklist-item\.checklist-drag-source\s*\{[^}]*transform:\s*translate3d\(0,\s*var\(--checklist-source-shift,\s*0\),\s*0\)[^}]*will-change:\s*transform/s,
    )
    expect(dossierStyles).toMatch(
      /\.checklist-item\.checklist-sort-displaced\s*\{[^}]*transform:\s*translate3d\(0,\s*var\(--checklist-sort-shift,\s*0\),\s*0\)[^}]*will-change:\s*transform/s,
    )
    expect(dossierStyles).toMatch(
      /\.checklist-item\.checklist-drag-overlay,[\s\S]*?position:\s*fixed;[\s\S]*?contain:\s*layout paint style;[\s\S]*?will-change:\s*transform;/,
    )
    expect(dossierStyles).not.toContain('.checklist-drop-slot')
  })

  it('continues edge scrolling while the pointer rests at the viewport edge', () => {
    expect(dossierSource).toContain('const keepAutoScrolling = allowAutoScroll && autoScroll()')
    expect(dossierSource).toMatch(
      /if \(keepAutoScrolling && session\.status === 'dragging'\) \{\s*session\.frame = window\.requestAnimationFrame\(runFrame\)/,
    )
    expect(dossierSource).toContain("prefers-reduced-motion: reduce")
  })
})
