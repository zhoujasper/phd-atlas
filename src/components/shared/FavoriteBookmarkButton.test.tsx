import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import discoverStyles from '../../styles/discover.css?raw'
import { FavoriteBookmarkButton } from './FavoriteBookmarkButton'

function ControlledFavorite() {
  const [active, setActive] = useState(false)
  return (
    <FavoriteBookmarkButton
      active={active}
      label={active ? 'Remove favorite' : 'Add favorite'}
      onToggle={() => setActive((current) => !current)}
    />
  )
}

describe('FavoriteBookmarkButton', () => {
  it('keeps one bookmark mounted while adding and removing a favorite', () => {
    const { container } = render(<ControlledFavorite />)
    const initialIcon = container.querySelector('svg')
    expect(initialIcon).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add favorite' }))
    const addedButton = screen.getByRole('button', { name: 'Remove favorite' })
    expect(addedButton).toHaveAttribute('aria-pressed', 'true')
    expect(addedButton).toHaveClass('is-favorite', 'is-favorite-adding')
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    expect(container.querySelector('svg')).toBe(initialIcon)

    fireEvent.click(addedButton)
    const removedButton = screen.getByRole('button', { name: 'Add favorite' })
    expect(removedButton).toHaveAttribute('aria-pressed', 'false')
    expect(removedButton).toHaveClass('is-favorite-removing')
    expect(container.querySelector('svg')).toBe(initialIcon)
  })

  it('uses a red inner fill with short reduced-motion-safe wrapper animation', () => {
    const css = discoverStyles.replace(/\r\n/g, '\n')
    expect(css).toMatch(
      /\.favorite-bookmark-button\.is-favorite \.favorite-bookmark-glyph\s*\{[^}]*color:\s*var\(--danger\)/u,
    )
    expect(css).toMatch(
      /\.favorite-bookmark-button\.is-favorite \.favorite-bookmark-glyph svg\s*\{[^}]*fill:\s*currentColor/u,
    )
    expect(css).not.toMatch(
      /\.favorite-bookmark-button\.is-favorite[^{]*\{[^}]*background:\s*(?:var\(--danger|#[a-f0-9]*red)/iu,
    )
    expect(css).toContain('animation: discover-favorite-add 260ms')
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.favorite-bookmark-glyph[\s\S]*animation-duration:\s*0\.01ms !important/u,
    )
  })
})
