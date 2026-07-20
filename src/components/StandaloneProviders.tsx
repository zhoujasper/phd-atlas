import type { ReactNode } from 'react'
import { I18nContext, useI18nValue } from './hooks/useI18n'
import { ThemeContext, useThemeProvider } from './hooks/useTheme'
import { browserDefaultLanguage, resolveLanguage, type Language } from '../i18n'
import { FormValidationPrompt } from './shared/FormValidationPrompt'

function standaloneLanguage(): Language {
  try {
    const parsed = JSON.parse(localStorage.getItem('phd-atlas-session') ?? 'null') as {
      user?: { settings?: { language?: string } }
    } | null
    const storedLanguage = parsed?.user?.settings?.language
    if (storedLanguage) return resolveLanguage(storedLanguage)
  } catch {
    // Fall through to the browser locale when saved app state is unavailable.
  }
  return browserDefaultLanguage()
}

function standaloneNamespaces(pathname = window.location.pathname) {
  if (pathname.startsWith('/share/')) return ['core', 'shared', 'shareViewer', 'share', 'dossier']
  if (pathname.startsWith('/asset-upload/')) return ['core', 'shared', 'assetUpload', 'profile', 'share']
  if (pathname.startsWith('/team/accept-invite/')) return ['core', 'shared', 'team']
  if (pathname.startsWith('/reset-password/')) return ['core', 'shared', 'resetPassword']
  if (['/upgrade-pro', '/pro', '/membership'].includes(pathname)) return ['core', 'shared', 'upgrade', 'settings']
  return ['core', 'shared']
}

export function StandaloneProviders({ children }: { children: ReactNode }) {
  const rawTheme = typeof localStorage !== 'undefined' && localStorage.getItem('phd-atlas-theme') || undefined
  const theme: 'light' | 'dark' = rawTheme === 'dark' || rawTheme === 'light' ? rawTheme
    : (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const themeProvider = useThemeProvider(theme)
  const lang = standaloneLanguage()
  const i18nValue = useI18nValue(lang, standaloneNamespaces())

  return (
    <ThemeContext.Provider value={themeProvider}>
      <I18nContext.Provider value={i18nValue}>
        <FormValidationPrompt />
        {children}
      </I18nContext.Provider>
    </ThemeContext.Provider>
  )
}
