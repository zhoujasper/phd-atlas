import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './hooks/useI18n'
import { useTheme } from './hooks/useTheme'
import { StandalonePreferences } from './shared/StandalonePreferences'
import { StandaloneProviders } from './StandaloneProviders'

const originalMatchMedia = window.matchMedia
const originalLanguage = Object.getOwnPropertyDescriptor(navigator, 'language')
const originalLanguages = Object.getOwnPropertyDescriptor(navigator, 'languages')

function mockBrowserPreferences({ dark, language }: { dark: boolean; language: string }) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? dark : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
  Object.defineProperty(navigator, 'language', { configurable: true, value: language })
  Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] })
}

function Probe({ controls = false }: { controls?: boolean }) {
  const { lang } = useI18n()
  const { theme } = useTheme()
  return (
    <div>
      <output data-testid="language">{lang}</output>
      <output data-testid="theme">{theme}</output>
      {controls ? <StandalonePreferences /> : null}
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('lang')
})

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
  if (originalLanguage) Object.defineProperty(navigator, 'language', originalLanguage)
  else Reflect.deleteProperty(navigator, 'language')
  if (originalLanguages) Object.defineProperty(navigator, 'languages', originalLanguages)
  else Reflect.deleteProperty(navigator, 'languages')
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('StandaloneProviders', () => {
  it('uses the visitor browser language and color scheme before a local choice exists', async () => {
    mockBrowserPreferences({ dark: true, language: 'zh-CN' })

    render(
      <StandaloneProviders>
        <Probe />
      </StandaloneProviders>,
    )

    expect(screen.getByTestId('language')).toHaveTextContent('zh')
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('lang', 'zh-CN')
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    })
  })

  it('persists language and appearance selections made on a public link', async () => {
    mockBrowserPreferences({ dark: true, language: 'en-US' })
    const user = userEvent.setup()

    render(
      <StandaloneProviders>
        <Probe controls />
      </StandaloneProviders>,
    )

    await user.click(screen.getByRole('button', { name: 'Light' }))
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(localStorage.getItem('phd-atlas-theme')).toBe('light')

    await user.click(screen.getByRole('button', { name: 'Language' }))
    await user.click(screen.getByRole('option', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByTestId('language')).toHaveTextContent('zh')
      expect(localStorage.getItem('phd-atlas-language')).toBe('zh')
      expect(document.documentElement).toHaveAttribute('lang', 'zh-CN')
    })
  })
})
