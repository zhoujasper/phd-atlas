import { describe, expect, it } from 'vitest'
import adminScreenSource from './AdminScreen.tsx?raw'
import adminStyles from '../../styles/admin.css?raw'

describe('Admin system update progress motion', () => {
  it('moves the resident fill on the compositor instead of animating layout width', () => {
    const fillRule = adminStyles.match(/\.admin-update-progress-track > i\s*\{([^}]*)\}/s)?.[1] ?? ''

    expect(fillRule).toContain('inset: 0')
    expect(fillRule).toContain('transform: scaleX(0)')
    expect(fillRule).toContain('transform-origin: left center')
    expect(fillRule).toContain('transform 760ms var(--ease-out)')
    expect(fillRule).not.toMatch(/\bwidth\s*:/)
    expect(fillRule).not.toContain('transition: width')
    expect(adminScreenSource).toContain('style={{ transform: `scaleX(${updateTimelineProgress / 100})` }}')
    expect(adminScreenSource).not.toMatch(/style=\{\{\s*width:\s*`\$\{updateTimelineProgress/u)
  })

  it('runs a linear sheen whose reset happens beyond both clipped edges', () => {
    expect(adminStyles).toMatch(
      /\.admin-update-progress-downloading \.admin-update-progress-track > i::after\s*\{[^}]*width:\s*40%[^}]*transform:\s*translate3d\(-125%, 0, 0\)[^}]*animation:\s*admin-update-download-sheen 1\.45s linear infinite/s,
    )
    expect(adminStyles).toMatch(
      /@keyframes admin-update-download-sheen\s*\{\s*to\s*\{\s*transform:\s*translate3d\(350%, 0, 0\)/s,
    )
  })

  it('keeps terminal and stage indicators legible in forced colors', () => {
    expect(adminStyles).toMatch(
      /@media \(forced-colors:\s*active\)[\s\S]*?\.admin-update-progress-track\s*\{[^}]*border:\s*1px solid CanvasText[^}]*background:\s*Canvas/s,
    )
    expect(adminStyles).toMatch(
      /\.admin-update-progress-error \.admin-update-progress-track > i,[\s\S]*?background:\s*CanvasText/s,
    )
    expect(adminStyles).toMatch(
      /\.admin-update-progress-steps > i\.active\s*\{[^}]*outline:\s*2px solid Highlight[^}]*box-shadow:\s*none/s,
    )
    expect(adminStyles).toMatch(
      /\.admin-update-progress-steps > i\.failed\s*\{[^}]*border-color:\s*CanvasText[^}]*outline:\s*2px solid CanvasText/s,
    )
  })

  it('removes entrance, sheen, restart, fill, and step motion for reduced-motion users', () => {
    expect(adminStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.admin-update-progress,[\s\S]*?\.admin-update-progress-downloading \.admin-update-progress-track > i::after,[\s\S]*?\.admin-update-restart-pulse[\s\S]*?animation:\s*none !important/s,
    )
    expect(adminStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.admin-update-progress-track > i,[\s\S]*?\.admin-update-progress-steps > i,[\s\S]*?transition-duration:\s*0\.01ms !important/s,
    )
  })
})
