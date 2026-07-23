import { createContext, useContext } from 'react'
import type { Language } from '../../i18n'

type StandalonePreferencesContextValue = {
  setLanguage: (language: Language) => void
}

/** Public-link providers own persistence; public surfaces only consume this compact control contract. */
export const StandalonePreferencesContext = createContext<StandalonePreferencesContextValue | null>(null)

export function useStandalonePreferences() {
  return useContext(StandalonePreferencesContext)
}
