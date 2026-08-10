import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import selectionBarSource from './ExplorerSelectionBar.tsx?raw'

describe('explorer selection bar motion', () => {
  it('snaps the layout slot once and keeps the visible motion on the compositor', () => {
    const shellRule = coreStyles.match(
      /\.explorer-selection-presence\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const barRule = coreStyles.match(
      /\.explorer-selection-bar\s*\{([^}]*)\}/s,
    )?.[1] ?? ''

    expect(shellRule).toContain('display: block')
    expect(shellRule).toContain('contain: layout paint style')
    expect(shellRule).not.toContain('grid-template-rows')
    expect(shellRule).not.toContain('transition:')

    expect(selectionBarSource).toContain('useLayoutEffect')
    expect(barRule).toContain('opacity: 0')
    expect(barRule).toContain('transform: translate3d(0, -6px, 0) scale(0.985)')
    expect(barRule).toContain('opacity var(--explorer-selection-close-ms)')
    expect(barRule).toContain('transform var(--explorer-selection-close-ms)')
  })

  it('uses one entrance frame so rapid selection does not wait on a double frame', () => {
    expect(selectionBarSource).toContain('const enterFrameRef = useRef<number | null>(null)')
    expect(selectionBarSource).toContain('One frame is enough to mount the closed content')
    expect(selectionBarSource).not.toContain('frame2Ref')
    expect(selectionBarSource).not.toContain('grid-template-rows')
  })

  it('supports a page-level bottom dock without the decorative count dot', () => {
    expect(selectionBarSource).toContain("import { createPortal } from 'react-dom'")
    expect(selectionBarSource).toContain('? createPortal(selectionBar, document.body)')
    expect(selectionBarSource).toContain("presence?.setAttribute('hidden', '')")
    expect(selectionBarSource).toContain('new ResizeObserver(scheduleAnchorSync)')
    expect(selectionBarSource).toContain("'--explorer-selection-anchor-center-x'")
    expect(selectionBarSource).not.toContain('className="explorer-selection-dot"')
    expect(coreStyles).toMatch(
      /\.explorer-selection-presence\.is-viewport-bottom\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*max\(16px,[^}]*left:\s*var\(--explorer-selection-anchor-center-x,\s*50%\);[^}]*width:\s*min\(\s*740px,[^}]*--explorer-selection-anchor-width[^}]*transform:\s*translateX\(-50%\);/s,
    )
    expect(coreStyles).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.explorer-selection-presence\.is-viewport-bottom\s*\{[^}]*bottom:\s*calc\(var\(--mobile-tab-bar-height,\s*64px\) \+ 12px \+ env\(safe-area-inset-bottom,\s*0px\)\);/s,
    )
  })
})
