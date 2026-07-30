import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketingProductDemo } from './MarketingProductDemo'

describe('MarketingProductDemo', () => {
  it('lets visitors search, inspect advisors, and compare programs', () => {
    const { container } = render(<MarketingProductDemo surface="discover" />)
    const search = container.querySelector<HTMLInputElement>('.mpd-discover-search input')
    const modeButtons = container.querySelectorAll<HTMLButtonElement>('.mpd-discover-tabs > button')

    expect(container.querySelectorAll('.mpd-program-list > article')).toHaveLength(4)

    fireEvent.change(search as HTMLInputElement, { target: { value: 'Cambridge' } })
    expect(container.querySelectorAll('.mpd-program-list > article')).toHaveLength(2)
    expect(container.querySelector('.mpd-discover-inspector')?.textContent).toContain('Cambridge')

    fireEvent.click(modeButtons[1] as HTMLButtonElement)
    expect(container.querySelector('.mpd-advisor-list')).not.toBeNull()
    expect(container.querySelector('.mpd-discover-inspector')?.textContent).toContain('Cambridge')

    fireEvent.click(modeButtons[2] as HTMLButtonElement)
    expect(container.querySelectorAll('.mpd-compare-grid > article')).toHaveLength(2)

    const remove = container.querySelector<HTMLButtonElement>('.mpd-compare-grid > article header button')
    fireEvent.click(remove as HTMLButtonElement)
    expect(container.querySelectorAll('.mpd-compare-grid > article')).toHaveLength(1)
  })

  it('lets visitors switch profile views, filter assets, and choose a version', () => {
    const { container } = render(<MarketingProductDemo surface="profile" />)
    const viewButtons = container.querySelectorAll<HTMLButtonElement>(
      '.mpd-profile-library > header > nav button',
    )

    fireEvent.click(viewButtons[1] as HTMLButtonElement)
    expect(container.querySelectorAll('.mpd-profile-list > button')).toHaveLength(3)

    const search = container.querySelector<HTMLInputElement>('.mpd-profile-toolbar input')
    fireEvent.change(search as HTMLInputElement, { target: { value: 'Academic CV' } })
    expect(container.querySelectorAll('.mpd-profile-list > button')).toHaveLength(1)
    expect(container.querySelector('.mpd-profile-detail')?.textContent).toContain('Academic CV')

    const versions = container.querySelectorAll<HTMLButtonElement>('.mpd-profile-detail > div > button')
    fireEvent.click(versions[1] as HTMLButtonElement)
    expect(versions[1]?.getAttribute('aria-pressed')).toBe('true')

    const add = container.querySelector<HTMLButtonElement>('.mpd-profile-add')
    fireEvent.click(add as HTMLButtonElement)
    expect(add?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.mpd-profile-preset-sheet')?.classList.contains('is-open')).toBe(true)
  })

  it('shows calm empty states instead of unrelated inspector content', () => {
    const { container, rerender } = render(<MarketingProductDemo surface="discover" />)
    const discoverSearch = container.querySelector<HTMLInputElement>('.mpd-discover-search input')

    fireEvent.change(discoverSearch as HTMLInputElement, { target: { value: 'No matching programme' } })
    expect(container.querySelector('.mpd-discover-empty')).not.toBeNull()
    expect(container.querySelector('.mpd-discover-inspector')).toBeNull()

    rerender(<MarketingProductDemo surface="profile" />)
    const profileSearch = container.querySelector<HTMLInputElement>('.mpd-profile-toolbar input')
    fireEvent.change(profileSearch as HTMLInputElement, { target: { value: 'No matching asset' } })
    expect(container.querySelector('.mpd-profile-empty')).not.toBeNull()
    expect(container.querySelector('.mpd-profile-detail')).toBeNull()
  })
})
