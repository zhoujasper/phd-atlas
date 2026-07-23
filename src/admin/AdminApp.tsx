import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ApiError,
  clearClientSessionCaches,
  getLatestSessionToken,
  phdApi,
  readSessionTokenSubject,
  sessionIdentityMatches,
  setSessionTokenHandler,
  setUnauthorizedHandler,
  type AdminSettings,
  type AdminUser,
  type AuthSession,
  type SystemEvent,
  type SystemInfo,
} from '../api/phdApi'
import { AdminScreen } from '../components/screens/AdminScreen'
import { AdminSetupScreen } from '../components/screens/AdminSetupScreen'
import { Clock, Languages, LockKeyhole, Moon, Server, ShieldCheck, Sun, UserRound } from 'lucide-react'
import { Select } from '../components/shared/Select'
import {
  applyDocumentLanguage,
  browserDefaultLanguage,
  languageOptions,
  resolveLanguage,
  type Language,
} from '../i18n'
import { safeParseJson } from '../appModel'
import { I18nContext, useI18nValue } from '../components/hooks/useI18n'
import { useToastQueue } from '../components/hooks/useToastQueue'
import { ThemeContext, useThemeProvider } from '../components/hooks/useTheme'
import { FormValidationPrompt } from '../components/shared/FormValidationPrompt'
import { LaunchScreen } from '../components/shared/LaunchScreen'
import { ToastStack } from '../components/shared/ToastView'
import { normalizeErrorMessage } from '../errorMessages'
import { PUBLIC_EDITION } from '../edition'

const ADMIN_SESSION_KEY = 'phd-atlas-admin-session'
const ADMIN_LANGUAGE_KEY = 'phd-atlas-admin-language'

function normalizeStoredLanguage(language: unknown): Language | null {
  return typeof language === 'string' ? resolveLanguage(language) : null
}

function readAdminLanguagePreference(): Language | null {
  try {
    return normalizeStoredLanguage(localStorage.getItem(ADMIN_LANGUAGE_KEY))
  } catch {
    return null
  }
}

function persistAdminLanguagePreference(language: Language) {
  try {
    localStorage.setItem(ADMIN_LANGUAGE_KEY, language)
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function readStoredLanguage(): Language {
  const adminPreference = readAdminLanguagePreference()
  if (adminPreference) return adminPreference
  return browserDefaultLanguage()
}

function normalizeError(error: unknown, lang: Language = 'en') {
  return normalizeErrorMessage(error, lang)
}

function isAuthExpired(error: unknown) {
  return error instanceof ApiError &&
    error.status === 401 &&
    ['TOKEN_EXPIRED', 'UNAUTHORIZED', 'UNKNOWN_USER', 'ACCOUNT_DISABLED'].includes(error.code)
}

export function AdminApp() {
  const themeProvider = useThemeProvider()
  const [session, setSession] = useState<AuthSession | null>(() =>
    safeParseJson<AuthSession>(localStorage.getItem(ADMIN_SESSION_KEY)),
  )
  const [setupRequired, setSetupRequired] = useState<boolean | null>(() => (
    session || !PUBLIC_EDITION ? false : null
  ))
  const [email, setEmail] = useState(PUBLIC_EDITION ? '' : 'admin@phd-atlas.local')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [logs, setLogs] = useState<SystemEvent[]>([])
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [activeTab, setActiveTab] = useState<'systemConfig' | 'userManagement' | 'logManagement' | 'systemInfo'>('systemConfig')
  const [lang, setLang] = useState<Language>(() => readStoredLanguage())
  const langRef = useRef(lang)
  langRef.current = lang
  useEffect(() => {
    applyDocumentLanguage(lang)
  }, [lang])
  const initialSessionRef = useRef(session)
  const tabListRef = useRef<HTMLElement | null>(null)
  const activeTabButtonRef = useRef<HTMLButtonElement | null>(null)
  const { toasts, notify, dismissToast, pauseToast, resumeToast } = useToastQueue()
  const i18nValue = useI18nValue(lang, ['core', 'shared', 'admin', 'settings', 'team'])
  const tx = i18nValue.tx
  const languages = languageOptions()
  const changeLanguage = (next: Language) => {
    const resolved = resolveLanguage(next)
    persistAdminLanguagePreference(resolved)
    setLang(resolved)
  }
  const sessionTokenLineageRef = useRef<Set<string>>(new Set(session?.token ? [session.token] : []))
  const currentSessionUserIdRef = useRef<string | null>(session?.user.id ?? null)
  const sessionIdentityEpochRef = useRef(0)

  const rememberSessionToken = useCallback((token: string) => {
    sessionTokenLineageRef.current.add(token)
  }, [])

  const resetSessionTokenLineage = useCallback((token?: string) => {
    sessionTokenLineageRef.current = token ? new Set([token]) : new Set()
  }, [])

  const isCurrentSessionToken = useCallback((token?: string) => {
    return Boolean(token && sessionTokenLineageRef.current.has(token))
  }, [])

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const logout = useCallback(() => {
    sessionIdentityEpochRef.current += 1
    currentSessionUserIdRef.current = null
    resetSessionTokenLineage()
    clearClientSessionCaches()
    localStorage.removeItem(ADMIN_SESSION_KEY)
    setSession(null)
    setUsers([])
    setLogs([])
    setSettings(null)
    setError(null)
  }, [resetSessionTokenLineage])

  const loadAdminData = useCallback(async (s: AuthSession) => {
    const requestEpoch = sessionIdentityEpochRef.current
    const requestUserId = s.user.id
    try {
      if (!isCurrentSessionToken(s.token) || currentSessionUserIdRef.current !== requestUserId) return
      const [me, u, l, info] = await Promise.all([
        phdApi.me(s.token),
        phdApi.adminUsers(s.token),
        phdApi.adminLogs(s.token),
        phdApi.systemInfo(s.token).catch(() => null),
      ])
      if (
        requestEpoch !== sessionIdentityEpochRef.current
        || !isCurrentSessionToken(s.token)
        || currentSessionUserIdRef.current !== requestUserId
        || !sessionIdentityMatches(requestUserId, me.user.id, s.token)
      ) {
        return
      }
      if (me.user.role !== 'admin') {
        logout()
        return
      }
      const refreshedToken = getLatestSessionToken(s.token)
      if (!sessionIdentityMatches(requestUserId, me.user.id, refreshedToken)) return
      rememberSessionToken(refreshedToken)
      const nextSession = {
        ...s,
        token: refreshedToken,
        user: me.user,
        settings: me.settings,
      }
      setSession((current) => {
        if (
          !current
          || current.user.id !== requestUserId
          || sessionIdentityEpochRef.current !== requestEpoch
        ) {
          return current
        }
        return nextSession
      })
      const adminPreference = readAdminLanguagePreference()
      const sessionLanguage = normalizeStoredLanguage(nextSession.user.settings.language)
      if (adminPreference) {
        setLang(adminPreference)
      } else if (sessionLanguage) {
        setLang(sessionLanguage)
      }
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(nextSession))
      setUsers(u)
      setLogs(l)
      setSettings(me.settings)
      setSystemInfo(info)
    } catch (err) {
      if (isAuthExpired(err) && !isCurrentSessionToken(s.token)) return
      if (!isAuthExpired(err)) {
        setError(normalizeError(err, langRef.current))
      }
      logout()
    }
  }, [isCurrentSessionToken, logout, rememberSessionToken])

  // Registered once for the component's lifetime (not keyed on `session`) — see the matching
  // comment in App.tsx. isCurrentSessionToken already gates every call against the live token
  // lineage, so re-running this per session change only opened a window, right after a fresh
  // admin login, where a 401 landing before the next render's re-registration would silently no-op.
  useEffect(() => {
    setSessionTokenHandler((token, sourceToken) => {
      if (sourceToken && !isCurrentSessionToken(sourceToken)) return false
      const tokenSubject = readSessionTokenSubject(token)
      if (
        tokenSubject
        && currentSessionUserIdRef.current
        && tokenSubject !== currentSessionUserIdRef.current
      ) {
        return false
      }
      rememberSessionToken(token)
      setSession((current) => {
        if (!current || current.token === token) return current
        if (tokenSubject && current.user.id !== tokenSubject) return current
        const nextSession = { ...current, token }
        localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(nextSession))
        return nextSession
      })
      return true
    })
    setUnauthorizedHandler((_error, sourceToken) => {
      if (!isCurrentSessionToken(sourceToken)) return
      logout()
    })
    return () => {
      setSessionTokenHandler(null)
      setUnauthorizedHandler(null)
    }
  }, [isCurrentSessionToken, logout, rememberSessionToken])

  useEffect(() => {
    const s = initialSessionRef.current
    if (!s) return
    currentSessionUserIdRef.current = s.user.id
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(s))
    void loadAdminData(s)
  }, [loadAdminData])

  useEffect(() => {
    if (!PUBLIC_EDITION) return
    if (session) {
      setSetupRequired(false)
      return
    }
    let active = true
    phdApi.initialSetupStatus()
      .then((status) => {
        if (active) setSetupRequired(status.required)
      })
      .catch((err) => {
        if (!active) return
        setError(normalizeError(err, langRef.current))
        setSetupRequired(false)
      })
    return () => {
      active = false
    }
  }, [session])

  const tabDefs = [
    { id: 'systemConfig' as const, icon: ShieldCheck, label: tx('admin.tabs.systemConfig') },
    { id: 'userManagement' as const, icon: UserRound, label: tx('admin.tabs.userManagement') },
    { id: 'logManagement' as const, icon: Clock, label: tx('admin.tabs.logManagement') },
    { id: 'systemInfo' as const, icon: Server, label: tx('admin.tabs.systemInfo') },
  ]
  const updateTabIndicator = useCallback(() => {
    const tabList = tabListRef.current
    const activeButton = activeTabButtonRef.current
    if (!tabList || !activeButton) return
    const left = activeButton.offsetLeft
    const width = activeButton.offsetWidth
    tabList.style.setProperty('--admin-tab-indicator-left', `${left}px`)
    tabList.style.setProperty('--admin-tab-indicator-width', `${width}px`)
    tabList.style.setProperty('--admin-tab-indicator-opacity', '1')
  }, [])

  useLayoutEffect(() => {
    updateTabIndicator()
    const tabList = tabListRef.current
    if (!tabList) return
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateTabIndicator)
      return () => window.removeEventListener('resize', updateTabIndicator)
    }
    const resizeObserver = new ResizeObserver(updateTabIndicator)
    resizeObserver.observe(tabList)
    Array.from(tabList.children).forEach((child) => resizeObserver.observe(child))
    window.addEventListener('resize', updateTabIndicator)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateTabIndicator)
    }
  }, [activeTab, lang, updateTabIndicator])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const s = await phdApi.login(email, password, 'admin')
      if (s.user.role !== 'admin') {
        throw new Error(tx('admin.noPrivileges'))
      }
      if (
        currentSessionUserIdRef.current
        && currentSessionUserIdRef.current !== s.user.id
      ) {
        sessionIdentityEpochRef.current += 1
        clearClientSessionCaches()
      }
      currentSessionUserIdRef.current = s.user.id
      resetSessionTokenLineage(s.token)
      setSession(s)
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(s))
      await loadAdminData(s)
    } catch (err) {
      setError(normalizeError(err, lang))
    } finally {
      setBusy(false)
    }
  }

  async function handleInitialSetup(input: Parameters<typeof phdApi.completeInitialSetup>[0]) {
    setBusy(true)
    setError(null)
    try {
      const nextSession = await phdApi.completeInitialSetup(input)
      currentSessionUserIdRef.current = nextSession.user.id
      resetSessionTokenLineage(nextSession.token)
      setSetupRequired(false)
      setSession(nextSession)
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(nextSession))
      await loadAdminData(nextSession)
    } catch (err) {
      setError(normalizeError(err, lang))
    } finally {
      setBusy(false)
    }
  }

  async function refresh() {
    if (!session) return
    await loadAdminData(session)
  }

  if (session && !settings) {
    return (
      <ThemeContext.Provider value={themeProvider}>
        <I18nContext.Provider value={i18nValue}>
          <FormValidationPrompt />
          <h1 className="sr-only">{tx('admin.panelTitle')}</h1>
          <LaunchScreen variant="admin" message={tx('working')} />
        </I18nContext.Provider>
      </ThemeContext.Provider>
    )
  }

  if (!session && setupRequired === null) {
    return (
      <ThemeContext.Provider value={themeProvider}>
        <I18nContext.Provider value={i18nValue}>
          <FormValidationPrompt />
          <h1 className="sr-only">{tx('admin.setup.title')}</h1>
          <LaunchScreen variant="admin" message={tx('working')} />
        </I18nContext.Provider>
      </ThemeContext.Provider>
    )
  }

  if (!session && setupRequired) {
    return (
      <ThemeContext.Provider value={themeProvider}>
        <I18nContext.Provider value={i18nValue}>
          <FormValidationPrompt />
          <AdminSetupScreen
            busy={busy}
            error={error}
            language={lang}
            onSubmit={handleInitialSetup}
          />
        </I18nContext.Provider>
      </ThemeContext.Provider>
    )
  }

  // Admin login screen
  if (!session) {
    return (
      <ThemeContext.Provider value={themeProvider}>
        <I18nContext.Provider value={i18nValue}>
          <FormValidationPrompt />
          <main className="auth-canvas admin-auth-canvas route-content-reveal">
            <section className="auth-sheet" aria-label={tx('admin.loginAria')}>
            <div className="auth-preferences" aria-label={tx('preferences')}>
              <div className="auth-language-control" title={tx('settings.language')}>
                <Languages size={14} aria-hidden="true" />
                <Select
                  value={lang}
                  options={languages}
                  onChange={changeLanguage}
                  ariaLabel={tx('settings.language')}
                  size="small"
                  searchable={languages.length > 6}
                />
              </div>
              <button type="button" className="icon-action" onClick={themeProvider.toggleTheme} title={themeProvider.theme === 'dark' ? tx('settings.light') : tx('settings.dark')} aria-label={themeProvider.theme === 'dark' ? tx('settings.light') : tx('settings.dark')}>
                {themeProvider.theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
              </button>
            </div>
            <div className="auth-mark admin-auth-mark">
              <ShieldCheck size={24} aria-hidden="true" />
            </div>
            <h1>{tx('admin.panelTitle')}</h1>
            <p>{tx('admin.loginSubtitle')}</p>
            {error ? (
              <div className="admin-error" role="alert">
                <LockKeyhole size={14} aria-hidden="true" />
                {error}
              </div>
            ) : null}
            <form onSubmit={handleLogin}>
              <label>
                <span>{tx('admin.email')}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@phd-atlas.local"
                  autoFocus
                />
              </label>
              <label>
                <span>{tx('admin.password')}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tx('admin.passwordPlaceholder')}
                />
              </label>
              <button className="primary-action" type="submit" disabled={busy}>
                {busy ? tx('admin.verifying') : tx('admin.signIn')}
              </button>
            </form>
            <button
              className="text-action"
              type="button"
              onClick={() => {
                window.location.href = '/'
              }}
            >
              {tx('admin.backToSite')}
            </button>
            </section>
          </main>
        </I18nContext.Provider>
      </ThemeContext.Provider>
    )
  }

  return (
    <ThemeContext.Provider value={themeProvider}>
      <I18nContext.Provider value={i18nValue}>
        <FormValidationPrompt />
        <ToastStack toasts={toasts} onClose={dismissToast} onPause={pauseToast} onResume={resumeToast} />
        <div className="admin-shell route-content-reveal">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <ShieldCheck size={20} aria-hidden="true" />
            <strong>{tx('admin.topbarTitle')}</strong>
            <span className="admin-badge">{tx('admin.badge')}</span>
          </div>
          <nav
            ref={tabListRef}
            className="admin-topbar-tabs"
            role="tablist"
            aria-label={tx('admin.panelTitle')}
          >
            {tabDefs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  ref={isActive ? activeTabButtonRef : undefined}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`admin-topbar-tab ${isActive ? 'admin-topbar-tab-active' : ''}`}
                  onClick={() => startTransition(() => setActiveTab(tab.id))}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="admin-topbar-right">
            <span className="admin-user-label">{session.user.email}</span>
            <div className="admin-language-control" title={tx('settings.language')}>
              <Languages size={14} aria-hidden="true" />
              <Select
                value={lang}
                options={languages}
                onChange={changeLanguage}
                ariaLabel={tx('settings.language')}
                size="small"
                searchable={languages.length > 6}
              />
            </div>
            <button type="button" className="icon-action" onClick={themeProvider.toggleTheme} title={themeProvider.theme === 'dark' ? tx('settings.light') : tx('settings.dark')} aria-label={themeProvider.theme === 'dark' ? tx('settings.light') : tx('settings.dark')}>
              {themeProvider.theme === 'dark' ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            </button>
            <button type="button" className="quiet-action" onClick={logout}>
              {tx('signOut')}
            </button>
            <button
              type="button"
              className="text-action"
              style={{ width: 'auto', margin: 0 }}
              onClick={() => {
                window.location.href = '/'
              }}
            >
              {tx('admin.backToSiteShort')}
            </button>
          </div>
        </header>
        <div className="admin-body">
          <AdminScreen
            activeTab={activeTab}
            currentUserId={session.user.id}
            settings={settings!}
            users={users}
            logs={logs}
            systemInfo={systemInfo}
            token={session.token}
            onNotify={notify}
            onRegistration={async (allowed) => {
              try {
                const s = await phdApi.updateAdminSettings(session.token, { allowRegistration: allowed })
                setSettings(s)
                notify(tx('admin.configSaved'), 'success')
              } catch (err) {
                notify(normalizeError(err, lang), 'error')
              }
            }}
            onSettings={async (patch) => {
              try {
                const s = await phdApi.updateAdminSettings(session.token, patch)
                setSettings(s)
              } catch (err) {
                notify(normalizeError(err, lang), 'error')
                throw err
              }
            }}
            onTestSystemMail={async (patch, delivery) => {
              try {
                const s = await phdApi.updateAdminSettings(session.token, patch)
                setSettings(s)
                await phdApi.sendAdminTestEmail(session.token, delivery)
                await refresh()
              } catch (err) {
                notify(normalizeError(err, lang), 'error')
                throw err
              }
            }}
            onUserUpdate={async (userId, patch) => {
              try {
                const updated = await phdApi.updateAdminUser(session.token, userId, patch)
                setUsers((items) => items.map((item) => item.id === updated.id ? updated : item))
                await loadAdminData({ ...session, token: getLatestSessionToken(session.token) })
              } catch (err) {
                notify(normalizeError(err, lang), 'error')
                throw err
              }
            }}
            onUserDelete={async (userId) => {
              try {
                await phdApi.deleteAdminUser(session.token, userId)
                await refresh()
                notify(tx('admin.configSaved'), 'success')
              } catch (err) {
                notify(normalizeError(err, lang), 'error')
              }
            }}
            onExportLogs={async (format) => {
              try {
                const blob = await phdApi.downloadAdminLogs(session.token, format)
                downloadBlob(blob, `phd-atlas-system-log.${format}`)
              } catch (err) {
                notify(normalizeError(err, lang), 'error')
                throw err
              }
            }}
            onClearLogs={async () => {
              try {
                const result = await phdApi.clearAdminLogs(session.token)
                setLogs(result.logs)
                setSystemInfo((info) => info ? {
                  ...info,
                  counts: {
                    ...info.counts,
                    systemEvents: result.logs.length,
                  },
                } : info)
                notify(tx('admin.configSaved'), 'success')
              } catch (err) {
                notify(normalizeError(err, lang), 'error')
                throw err
              }
            }}
            onChangePassword={async (currentPassword, newPassword) => {
              await phdApi.changeAdminPassword(session.token, currentPassword, newPassword)
              return true
            }}
            onSystemUpdate={async (file) => {
              await phdApi.uploadSystemUpdate(session.token, file)
              return true
            }}
            onRefreshSystemInfo={async () => {
              try {
                const info = await phdApi.systemInfo(session.token)
                setSystemInfo(info)
              } catch (err) {
                notify(normalizeError(err, lang), 'error')
              }
            }}
          />
        </div>
        </div>
      </I18nContext.Provider>
    </ThemeContext.Provider>
  )
}
