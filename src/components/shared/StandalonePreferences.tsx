import { Languages, Moon, Sun } from 'lucide-react'
import { languageOptions } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { useTheme } from '../hooks/useTheme'
import { Select } from './Select'
import { useStandalonePreferences } from './StandalonePreferencesContext'

export function StandalonePreferences({ className = '' }: { className?: string }) {
  const standalonePreferences = useStandalonePreferences()
  const { lang, tx } = useI18n()
  const { theme, toggleTheme } = useTheme()

  // AttachmentPreviewDialog is also used in the signed-in workspace. Keep the
  // public-only controls out of that surface unless a standalone provider opts in.
  if (!standalonePreferences) return null

  const nextThemeLabel = theme === 'dark' ? tx('settings.light') : tx('settings.dark')

  return (
    <div className={`standalone-preferences${className ? ` ${className}` : ''}`} aria-label={tx('preferences')}>
      <div className="standalone-language-control" title={tx('settings.language')}>
        <Languages size={14} aria-hidden="true" />
        <Select
          value={lang}
          options={languageOptions()}
          onChange={standalonePreferences.setLanguage}
          ariaLabel={tx('settings.language')}
          size="small"
          searchable={languageOptions().length > 6}
        />
      </div>
      <button type="button" className="icon-action" onClick={toggleTheme} title={nextThemeLabel} aria-label={nextThemeLabel}>
        {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
      </button>
    </div>
  )
}
