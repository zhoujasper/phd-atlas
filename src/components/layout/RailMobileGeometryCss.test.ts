import { describe, expect, it } from 'vitest'
import mobileStyles from '../../styles/mobile.css?raw'

const normalizedMobileStyles = mobileStyles.replace(/\r\n/g, '\n')

describe('mobile rail geometry CSS', () => {
  it('keeps document scrolling without reserving a visible root scrollbar strip', () => {
    expect(normalizedMobileStyles).toMatch(
      /html\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*scrollbar-width:\s*none;/s,
    )
    expect(normalizedMobileStyles).toMatch(
      /body\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*scrollbar-width:\s*none;/s,
    )
    expect(normalizedMobileStyles).toMatch(
      /html::-webkit-scrollbar,\s*body::-webkit-scrollbar\s*\{[^}]*display:\s*none;[^}]*width:\s*0;[^}]*height:\s*0;/s,
    )
  })

  it('centers the personal active surface with the same width as its destination', () => {
    expect(normalizedMobileStyles).toMatch(
      /\.atlas-rail\s*\{[^}]*--mobile-rail-item-width:\s*50px;/s,
    )
    expect(normalizedMobileStyles).toMatch(
      /\.rail-btn,\s*\.rail-bottom-stack \.rail-mode-toggle\s*\{[^}]*width:\s*var\(--mobile-rail-item-width\);/s,
    )
    expect(normalizedMobileStyles).toMatch(
      /\.rail-active-indicator\s*\{[^}]*left:\s*calc\(\s*\(100% \/ var\(--rail-item-count,\s*4\) - var\(--mobile-rail-item-width\)\) \/ 2\s*\+ var\(--rail-active-x,\s*0%\)\s*\);[^}]*width:\s*var\(--mobile-rail-item-width\);/s,
    )
  })
})
