import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nContext, useI18nValue } from './hooks/useI18n'
import { ThemeContext, useThemeProvider } from './hooks/useTheme'
import { applyDocumentLanguage, browserDefaultLanguage, resolveLanguage, type Language } from '../i18n'
import { FormValidationPrompt } from './shared/FormValidationPrompt'
import { StandalonePreferencesContext } from './shared/StandalonePreferencesContext'

const STANDALONE_LANGUAGE_PREFERENCE_KEY = 'phd-atlas-language'

function standaloneLanguage(): Language {
  try {
    const storedLanguage = localStorage.getItem(STANDALONE_LANGUAGE_PREFERENCE_KEY)
    if (storedLanguage) return resolveLanguage(storedLanguage)
  } catch {
    // Fall through to the browser locale when local storage is unavailable.
  }
  return browserDefaultLanguage()
}

function standaloneNamespaces(pathname = window.location.pathname) {
  // Shared editable links reuse the workspace dossier and its context menus.
  // Keep that namespace here rather than letting untranslated explorer keys leak
  // into a standalone shared session.
  if (pathname.startsWith('/share/')) return ['core', 'shared', 'shareViewer', 'share', 'dossier', 'workspace']
  if (pathname.startsWith('/asset-upload/')) return ['core', 'shared', 'assetUpload', 'profile', 'share']
  if (pathname.startsWith('/team/accept-invite/') || pathname.startsWith('/team/join/')) return ['core', 'shared', 'team']
  if (pathname.startsWith('/reset-password/')) return ['core', 'shared', 'resetPassword']
  if (['/upgrade-pro', '/pro', '/membership'].includes(pathname)) return ['core', 'shared', 'upgrade', 'settings']
  return ['core', 'shared']
}

export function StandaloneProviders({ children }: { children: ReactNode }) {
  const themeProvider = useThemeProvider()
  const [lang, setLang] = useState<Language>(standaloneLanguage)
  const namespaces = useMemo(() => standaloneNamespaces(), [])
  const i18nValue = useI18nValue(lang, namespaces)
  const changeLanguage = useCallback((nextLanguage: Language) => {
    const resolved = resolveLanguage(nextLanguage)
    setLang(resolved)
    try {
      localStorage.setItem(STANDALONE_LANGUAGE_PREFERENCE_KEY, resolved)
    } catch {
      // The current page still updates when browser storage is unavailable.
    }
  }, [])
  const preferenceValue = useMemo(() => ({ setLanguage: changeLanguage }), [changeLanguage])

  useEffect(() => {
    applyDocumentLanguage(lang)
  }, [lang])

  return (
    <ThemeContext.Provider value={themeProvider}>
      <I18nContext.Provider value={i18nValue}>
        <StandalonePreferencesContext.Provider value={preferenceValue}>
          <FormValidationPrompt />
          {children}
        </StandalonePreferencesContext.Provider>
      </I18nContext.Provider>
    </ThemeContext.Provider>
  )
}
