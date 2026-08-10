import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import dossierStyles from '../../index.css?raw'

const pointerFrameSource = dossierSource.match(
  /const paintFrame = \(allowAutoScroll: boolean\) => \{[\s\S]*?const runFrame = \(\) => \{/,
)?.[0] ?? ''
const checklistSettleSource = dossierSource.match(
  /const settleChecklistOverlay = useCallback\([\s\S]*?\r?\n  \)\r?\n\s*const commitChecklistDrag/,
)?.[0] ?? ''
const checklistFinishSource = dossierSource.match(
  /const finish = \(commit: boolean, immediate = false\) => \{[\s\S]*?\r?\n      session\.finish = finish/,
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
    // Group headings are displaced by the same slot as the rows they travel
    // with, so a group's title stays attached to its group during the preview.
    expect(dossierStyles).toMatch(
      /\.checklist-item\.checklist-sort-displaced,\s*\.checklist-group-header\.checklist-sort-displaced\s*\{[^}]*transform:\s*translate3d\(0,\s*var\(--checklist-sort-shift,\s*0\),\s*0\)[^}]*will-change:\s*transform/s,
    )
    expect(dossierStyles).toMatch(
      /\.checklist-item\.checklist-drag-overlay,[\s\S]*?position:\s*fixed;[\s\S]*?contain:\s*layout paint style;[\s\S]*?will-change:\s*transform;/,
    )
    expect(dossierStyles).toMatch(
      /\.checklist-sort-settling \.checklist-item\.checklist-drag-source,[\s\S]*?transition:\s*none;/,
    )
    expect(dossierStyles).not.toContain('.checklist-drop-slot')
  })

  it('uses measured group headings and shifts the real empty slot without reflow', () => {
    expect(dossierSource).toContain('data-checklist-group-header={group}')
    expect(dossierSource).toContain('groupBoundaries')
    expect(dossierSource).toContain('session.groupGeometry')
    expect(dossierSource).toContain('session.groupHeaders.forEach')
    expect(dossierSource).toContain('session.previewRows')
    expect(dossierSource).toContain('session.previewGroupBoundaries')
    expect(dossierStyles).toMatch(
      /\.checklist-group-header\.checklist-sort-displaced\s*\{[^}]*position:\s*relative;/s,
    )
  })

  it('continues edge scrolling while the pointer rests at the viewport edge', () => {
    expect(dossierSource).toContain('const keepAutoScrolling = allowAutoScroll && autoScroll()')
    expect(dossierSource).toMatch(
      /if \(keepAutoScrolling && session\.status === 'dragging'\) \{\s*session\.frame = window\.requestAnimationFrame\(runFrame\)/,
    )
    expect(dossierSource).toContain("prefers-reduced-motion: reduce")
  })

  it('starts the optimistic reorder before measuring and animating the real drop target', () => {
    expect(checklistFinishSource).toContain('startTransition(() => commitChecklistDrag(session))')
    expect(checklistFinishSource).toMatch(
      /if \(immediateCommit\) \{[\s\S]*?flushSync\(\(\) => commitChecklistDrag\(session, true\)\)/,
    )
    expect(checklistFinishSource).not.toContain('requestIdleCallback')
    expect(checklistFinishSource).not.toContain('commitIdle')
    expect(checklistFinishSource).not.toContain('session.overlay.animate')
    expect(checklistSettleSource).toContain('const destination = liveItem.getBoundingClientRect()')
    expect(checklistSettleSource).toContain('const animation = session.overlay.animate')
    expect(checklistSettleSource).toContain('animation.onfinish = finishDropAnimation')
    expect(checklistSettleSource).toContain('animation.oncancel = finishDropAnimation')
    expect(checklistSettleSource).not.toContain('animation.finished')
  })

  it('keeps grouped drops on one visual handoff without delayed arrival state', () => {
    const commitSource = dossierSource.match(
      /const commitChecklistDrag = useCallback\([\s\S]*?\r?\n  \)\r?\n\r?\n  useLayoutEffect/,
    )?.[0] ?? ''
    expect(commitSource).not.toContain('setMaterialVisualGroupPins')
    expect(commitSource).not.toContain('releaseMaterialGroupPin')
  })

  it('waits for the committed order before releasing the settled transforms', () => {
    expect(dossierSource).toContain('session.expectedOrder')
    expect(dossierSource).toContain('session.commitObserved = true')
    expect(checklistSettleSource).toContain("element.style.removeProperty('--checklist-source-shift')")
    expect(checklistSettleSource).toContain("element.style.removeProperty('--checklist-sort-shift')")
    expect(dossierSource).toMatch(
      /currentOrder\.length !== session\.expectedOrder\.length[\s\S]*?session\.commitObserved = true[\s\S]*?settleChecklistOverlay\(session\)/,
    )
    expect(checklistSettleSource).toContain('element.dataset.checklistId === session.id')
    expect(checklistSettleSource).toContain('fill: \'forwards\'')
    expect(dossierSource).not.toContain('releaseAnimation')
    expect(dossierStyles).not.toContain('.checklist-item.checklist-drag-overlay.checklist-drag-release')
  })

  it('forces a slow pending commit before the watchdog may release the preview', () => {
    const watchdogSource = dossierSource.match(
      /session\.settleWatchdog = window\.setTimeout\(\(\) => \{[\s\S]*?getMotionDelay\(700\) \+ 200\)/,
    )?.[0] ?? ''
    expect(watchdogSource).toContain('session.skipDropAnimation = true')
    expect(watchdogSource).toContain('requestCommit(true)')
    expect(watchdogSource.indexOf('requestCommit(true)')).toBeLessThan(
      watchdogSource.indexOf('cleanupChecklistDrag(session)'),
    )
    expect(dossierSource).toContain('commitDraft(currentDraft, \'immediate\')')
  })
})
