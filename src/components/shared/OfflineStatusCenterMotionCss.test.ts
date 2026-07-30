import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'

describe('offline status compact motion', () => {
  it('uses one icon-first collapsed baseline on phone and desktop', () => {
    expect(coreStyles).toMatch(
      /\.offline-status-pill\s*\{[^}]*min-width:\s*30px[^}]*gap:\s*0[^}]*padding:\s*0 7px[^}]*overflow:\s*hidden/s,
    )
    expect(coreStyles).toMatch(
      /\.offline-status-pill-content\s*\{[^}]*max-width:\s*0[^}]*opacity:\s*0[^}]*transform:\s*translateX\(-4px\)[^}]*transition:\s*max-width\s+var\(--duration-slow\)/s,
    )
  })

  it('reveals status copy for a state announcement, an open panel, or keyboard focus', () => {
    expect(coreStyles).toMatch(
      /\.offline-status-center\.is-status-announcing \.offline-status-pill-content,\s*\.offline-status-center\.open \.offline-status-pill-content,\s*\.offline-status-pill:focus-visible \.offline-status-pill-content\s*\{[^}]*max-width:\s*min\(320px,\s*calc\(100vw - 58px\)\)[^}]*opacity:\s*1[^}]*transform:\s*translateX\(0\)/s,
    )
  })

  it('limits pointer-hover expansion to desktop-class fine pointers', () => {
    expect(coreStyles).toMatch(
      /@media \(hover:\s*hover\) and \(pointer:\s*fine\)\s*\{\s*\.offline-status-pill:hover \.offline-status-pill-content\s*\{[^}]*max-width:[^}]*opacity:\s*1[^}]*transform:\s*translateX\(0\)/s,
    )
  })

  it('keeps the compact handoff immediate for reduced-motion users', () => {
    expect(coreStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.offline-status-pill-content,[\s\S]*?\.offline-status-label,[\s\S]*?transition-duration:\s*0\.01ms !important/,
    )
  })
})
