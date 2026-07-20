import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { CountrySelect } from './CountrySelect'

const translations: Record<string, string> = {
  'dossier.countryPlaceholder': 'Select country / region',
  'dossier.countrySearchPlaceholder': 'Search countries…',
  'dossier.countryNoMatches': 'No matching countries',
  'dossier.countryClear': 'Clear country',
  'dossier.continents.north_america': 'North America',
  'dossier.continents.south_america': 'South America',
  'dossier.continents.europe': 'Europe',
  'dossier.continents.asia': 'Asia',
  'dossier.continents.africa': 'Africa',
  'dossier.continents.oceania': 'Oceania',
  'dossier.continents.antarctica': 'Antarctica',
}

const i18n: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template) => template,
  tx: (path, fallback) => translations[path] ?? fallback ?? path,
}

const originalScrollIntoView = Element.prototype.scrollIntoView

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView
})

function renderCountrySelect(value = 'North Macedonia', onChange = vi.fn()) {
  render(
    <I18nContext.Provider value={i18n}>
      <CountrySelect value={value} onChange={onChange} ariaLabel="Country / Region" />
    </I18nContext.Provider>,
  )
  return onChange
}

describe('CountrySelect', () => {
  it('groups countries into independently collapsible continent sections', async () => {
    const user = userEvent.setup()
    renderCountrySelect()

    await user.click(screen.getByRole('button', { name: 'Country / Region' }))

    const europe = screen.getByRole('button', { name: /Europe/ })
    const northAmerica = screen.getByRole('button', { name: /North America/ })
    expect(europe).toHaveAttribute('aria-expanded', 'false')
    expect(northAmerica).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelectorAll('.country-select-group-panel.open')).toHaveLength(0)

    europe.focus()
    await user.keyboard('{Enter}')
    expect(europe).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Enter}')
    expect(europe).toHaveAttribute('aria-expanded', 'false')

    await user.click(northAmerica)
    expect(northAmerica).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(northAmerica.getAttribute('aria-controls') ?? '')).toHaveClass('open')

    await user.click(northAmerica)
    expect(northAmerica).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(northAmerica.getAttribute('aria-controls') ?? '')).not.toHaveClass('open')
  })

  it('automatically reveals matching groups while searching and still selects a country', async () => {
    const user = userEvent.setup()
    const onChange = renderCountrySelect('', vi.fn())

    await user.click(screen.getByRole('button', { name: 'Country / Region' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search countries…' }), 'Canada')

    const northAmerica = screen.getByRole('button', { name: /North America/ })
    expect(northAmerica).toHaveAttribute('aria-expanded', 'true')
    expect(northAmerica).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('option', { name: /Canada/ }))
    expect(onChange).toHaveBeenCalledWith('Canada')
  })
})
