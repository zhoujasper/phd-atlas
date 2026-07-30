import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import loadingStyles from '../../styles/loading.css?raw'
import { PendingLabel } from './PendingLabel'

describe('PendingLabel', () => {
  it('keeps a stable accessible label while animating terminal dots separately', () => {
    render(<PendingLabel label="处理中…" />)

    expect(screen.getByText('处理中…', { selector: '.sr-only' })).toBeTruthy()
    expect(document.querySelector('.pending-label-copy')?.textContent).toBe('处理中...')
    expect(document.querySelector('.pending-label-spinner')).toBeTruthy()
  })

  it('uses compositor-only motion with a static reduced-motion fallback', () => {
    expect(loadingStyles).toMatch(
      /\.pending-label-spinner\s*\{[^}]*animation:\s*pending-label-spin 760ms linear infinite/s,
    )
    expect(loadingStyles).toMatch(
      /\.pending-label-dots\s*\{[^}]*clip-path:[^}]*animation:\s*pending-label-dots/s,
    )
    expect(loadingStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pending-label-spinner,[\s\S]*?\.pending-label-dots\s*\{[^}]*animation:\s*none/s,
    )
  })
})
