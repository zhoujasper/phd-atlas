import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../../api/phdApi'
import { getDict, preloadLanguage, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import type { PwaInstallStatus } from '../hooks/usePwaInstall'
import type { WebPushNotificationStatus } from '../hooks/useWebPushNotifications'
import { SettingsScreen } from './SettingsScreen'

const SETTINGS_SECTION_TEST_IDS = [
  'settings-appearance-section',
  'settings-ai-section',
  'settings-mail-section',
  'settings-security-section',
  'settings-usage-section',
  'settings-data-section',
]

function session(protocol: 'imap' | 'pop3' = 'imap', autoFetchMail = false): AuthSession {
  return {
    token: 'token_test',
    user: {
      id: 'user_test',
      name: 'Jasper',
      email: 'student@example.com',
      role: 'user',
      createdAt: '2026-07-01T00:00:00.000Z',
      lastLoginAt: null,
      settings: {
        language: 'en',
        highContrast: false,
        themeAccent: '#0071e3',
        membershipPlan: 'pro',
        sendFrom: 'student@example.com',
        receiveAt: 'student@example.com',
        receiveEmails: [{ address: 'student@example.com', isPrimary: true, notify: true, verified: true }],
        incomingProtocol: protocol,
        incomingHost: protocol === 'imap' ? 'imap.example.com' : 'pop.example.com',
        incomingPort: protocol === 'imap' ? 993 : 995,
        incomingUser: 'student@example.com',
        incomingTls: true,
        autoFetchMail,
      },
    },
    settings: {
      allowRegistration: true,
      notificationMailbox: 'admin@example.com',
      backupFrequency: 'daily',
      encryptionAtRest: true,
    },
    mailFetchStatus: {
      lastFetchedAt: '2026-07-10T08:00:00.000Z',
      lastHistorySyncAt: null,
      lastHistoryImported: 0,
      trackedAddressCount: 2,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  }
}

async function renderSettings(
  protocol: 'imap' | 'pop3' = 'imap',
  autoFetchMail = false,
  onTestIncomingMail = vi.fn().mockResolvedValue(undefined),
  sessionOverride?: AuthSession,
) {
  await preloadLanguage('en', ['settings'])
  const onFetchMailNow = vi.fn().mockResolvedValue(undefined)
  const onSyncMailHistory = vi.fn().mockResolvedValue(undefined)
  const onUpdateSetting = vi.fn()
  const onUpdateSettings = vi.fn()
  render(
    <I18nContext.Provider
      value={{
        lang: 'en',
        t: getDict('en'),
        format: tpl,
        tx: (path, fallback) => t('en', path, fallback),
      }}
    >
      <SettingsScreen
        session={sessionOverride ?? session(protocol, autoFetchMail)}
        onLanguage={vi.fn()}
        onHighContrast={vi.fn()}
        onDeleteAccount={vi.fn()}
        onUpdateSetting={onUpdateSetting}
        onUpdateSettings={onUpdateSettings}
        onTestIncomingMail={onTestIncomingMail}
        onFetchMailNow={onFetchMailNow}
        onSyncMailHistory={onSyncMailHistory}
      />
    </I18nContext.Provider>,
  )
  const user = userEvent.setup()
  const incomingSummary = screen.getByRole('button', { name: /Receiving settings/ })
  if (incomingSummary.getAttribute('aria-expanded') !== 'true') await user.click(incomingSummary)
  return { user, onUpdateSetting, onUpdateSettings, onTestIncomingMail, onFetchMailNow, onSyncMailHistory }
}

async function renderInstallSettings(language: 'en' | 'zh', installStatus: PwaInstallStatus) {
  await preloadLanguage(language, ['settings'])
  const onInstallApp = vi.fn().mockResolvedValue('accepted')
  const localizedSession = session()
  localizedSession.user.settings.language = language
  render(
    <I18nContext.Provider
      value={{
        lang: language,
        t: getDict(language),
        format: tpl,
        tx: (path, fallback) => t(language, path, fallback),
      }}
    >
      <SettingsScreen
        session={localizedSession}
        installStatus={installStatus}
        onInstallApp={onInstallApp}
        onLanguage={vi.fn()}
        onHighContrast={vi.fn()}
        onDeleteAccount={vi.fn()}
      />
    </I18nContext.Provider>,
  )
  return { user: userEvent.setup(), onInstallApp }
}

async function renderPushSettings(webPushStatus: WebPushNotificationStatus) {
  await preloadLanguage('en', ['settings'])
  const onEnableWebPush = vi.fn().mockResolvedValue('granted')
  const onDisableWebPush = vi.fn().mockResolvedValue(true)
  const onTestWebPush = vi.fn().mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
  render(
    <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
      <SettingsScreen
        session={session()}
        webPushStatus={webPushStatus}
        onEnableWebPush={onEnableWebPush}
        onDisableWebPush={onDisableWebPush}
        onTestWebPush={onTestWebPush}
        onLanguage={vi.fn()}
        onHighContrast={vi.fn()}
        onDeleteAccount={vi.fn()}
      />
    </I18nContext.Provider>,
  )
  return { user: userEvent.setup(), onEnableWebPush, onDisableWebPush, onTestWebPush }
}

describe('SettingsScreen notification delivery preferences', () => {
  it('lets the user turn batched email notifications off without changing the receiving mailbox', async () => {
    const { user, onUpdateSettings } = await renderSettings()
    await user.click(screen.getByRole('button', { name: /Receive emails/ }))

    await user.click(screen.getByRole('switch', { name: 'Email notifications' }))

    expect(onUpdateSettings).toHaveBeenCalledWith({ emailNotificationsEnabled: false })
  })
})

describe('SettingsScreen share scope editor', () => {
  it('lets an existing share link update its selected pages from the scope chip', async () => {
    await preloadLanguage('en', ['settings', 'share'])
    const onUpdateShare = vi.fn()
    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          allShares={[{
            applicationId: 'application_1',
            applicationName: 'Example application',
            share: {
              id: 'share_1',
              token: 'scope-test-token',
              createdAt: '2026-07-21T09:00:00.000Z',
              expiresAt: '2026-07-28T09:00:00.000Z',
              permission: 'view',
              sections: ['overview', 'materials'],
            },
          }]}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
          onUpdateShare={onUpdateShare}
        />
      </I18nContext.Provider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Shared pages: 2 pages' }))
    const picker = screen.getByRole('dialog', { name: 'Shared pages' })
    await user.click(within(picker).getByRole('button', { name: 'Tasks' }))
    await user.click(within(picker).getByRole('button', { name: 'Save' }))

    expect(onUpdateShare).toHaveBeenCalledWith(
      'application_1',
      'share_1',
      '2026-07-28T09:00:00.000Z',
      'view',
      ['overview', 'materials', 'tasks'],
    )
  })

  it('lists and revokes attachment-upload links from the same manager', async () => {
    await preloadLanguage('en', ['settings', 'share'])
    const onRevokeAssetShare = vi.fn()
    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          allShares={[{
            kind: 'asset-upload',
            assetId: 'asset_1',
            assetName: 'Reference letter',
            share: {
              id: 'asset_share_1',
              token: 'upload-test-token',
              url: '/asset-upload/upload-test-token',
              createdAt: '2026-07-21T09:00:00.000Z',
              expiresAt: '2026-07-28T09:00:00.000Z',
            },
          }]}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
          onRevokeAssetShare={onRevokeAssetShare}
        />
      </I18nContext.Provider>,
    )
    const user = userEvent.setup()

    expect(screen.getByText('Reference letter')).toBeInTheDocument()
    expect(screen.getAllByText('Attachment upload')).toHaveLength(2)
    expect(screen.getByText('/asset-upload/upload-test-token')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revoke share link' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Revoke share link' })
    await user.click(within(dialog).getByRole('button', { name: 'Revoke share link' }))

    await waitFor(() => {
      expect(onRevokeAssetShare).toHaveBeenCalledWith('asset_1', 'asset_share_1')
    })
  })
})

describe('SettingsScreen calendar feed', () => {
  it('shows an immediate loading state while the first private subscription link is created', async () => {
    await preloadLanguage('en', ['settings'])
    let resolveUpdate!: () => void
    const updatePromise = new Promise<void>((resolve) => {
      resolveUpdate = resolve
    })
    const onUpdateSettings = vi.fn(() => updatePromise)

    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
          onUpdateSettings={onUpdateSettings}
        />
      </I18nContext.Provider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Enable Calendar Feed' }))

    const calendarCard = document.querySelector('.calendar-feed-card') as HTMLElement
    const pendingButton = within(calendarCard).getByRole('button', { name: 'Enabling calendar feed…' })
    expect(calendarCard).toHaveAttribute('aria-busy', 'true')
    expect(within(calendarCard).getByRole('status')).toHaveTextContent('Enabling')
    expect(pendingButton).toBeDisabled()
    expect(pendingButton).toHaveAttribute('aria-busy', 'true')
    expect(pendingButton.querySelector('.spin-icon')).toBeInTheDocument()
    expect(onUpdateSettings).toHaveBeenCalledTimes(1)
    expect(onUpdateSettings).toHaveBeenCalledWith(
      { generateCalendarToken: true },
      'Calendar feed enabled.',
    )

    await act(async () => {
      resolveUpdate()
      await updatePromise
    })

    await waitFor(() => {
      expect(within(calendarCard).getByRole('button', { name: 'Enable Calendar Feed' })).toBeEnabled()
      expect(calendarCard).not.toHaveAttribute('aria-busy')
    })
  })
})

describe('SettingsScreen section navigation', () => {
  it('keeps mobile utilities in their intended settings hierarchy', async () => {
    await preloadLanguage('en', ['settings'])
    const onToggleTheme = vi.fn()
    const onOpenNotifications = vi.fn()
    const onLogout = vi.fn()
    const calendarSession = session()
    calendarSession.user.settings.calendarToken = 'private-calendar-token'

    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={calendarSession}
          theme="light"
          onToggleTheme={onToggleTheme}
          onOpenNotifications={onOpenNotifications}
          onLogout={onLogout}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const appearance = document.getElementById('settings-appearance-section') as HTMLElement
    expect(within(appearance).getByRole('switch', { name: 'Dark mode' })).toBeInTheDocument()
    expect(within(appearance).queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
    expect(within(appearance).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(document.querySelector('.settings-mobile-notification-action')).toHaveAccessibleName('Notifications')
    expect(document.querySelector('.settings-mobile-signout-action')).toHaveAccessibleName('Sign out')
    expect(document.querySelectorAll('.calendar-provider-grid > .calendar-provider-link')).toHaveLength(3)
  })

  it('reveals a deferred target and keeps its highlight stable after scrolling', async () => {
    await preloadLanguage('en', ['settings'])
    const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    const rectDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
    const sectionOffsets: Record<string, number> = {
      'settings-appearance-section': 148,
      'settings-ai-section': 977,
      'settings-mail-section': 1147,
      'settings-security-section': 1762,
      'settings-usage-section': 1903,
      'settings-data-section': 2246,
    }

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 Chrome/140.0.0.0',
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.classList.contains('settings-screen') ? 3000 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList.contains('settings-screen') ? 900 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        this.scrollTop = Number(options.top ?? this.scrollTop)
        this.dispatchEvent(new Event('scroll'))
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        if (this.classList.contains('settings-screen')) return new DOMRect(0, 0, 1200, 900)
        const offset = sectionOffsets[this.id]
        if (offset === undefined) return new DOMRect(0, 0, 0, 0)
        const scrollTop = document.querySelector<HTMLElement>('.settings-screen')?.scrollTop ?? 0
        return new DOMRect(0, offset - scrollTop, 1000, 100)
      },
    })

    const rendered = render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
          deferProgressiveReveal
        />
      </I18nContext.Provider>,
    )

    try {
      const root = document.querySelector<HTMLElement>('.settings-screen')
      const securityButton = screen.getByRole('button', { name: 'Security' })
      expect(root).not.toBeNull()
      expect(document.getElementById('settings-security-section')).not.toBeInTheDocument()

      await userEvent.setup().click(securityButton)

      await waitFor(() => expect(document.getElementById('settings-security-section')).toBeInTheDocument())
      await waitFor(() => expect(root?.scrollTop).toBe(1762))
      expect(securityButton).toHaveClass('active')
      expect(securityButton).toHaveAttribute('aria-current', 'location')

      root?.dispatchEvent(new Event('scrollend'))
      root?.dispatchEvent(new Event('scroll'))

      await waitFor(() => expect(securityButton).toHaveClass('active'))
      expect(screen.getByRole('button', { name: 'Usage and limits' })).not.toHaveClass('active')
    } finally {
      rendered.unmount()
      if (userAgentDescriptor) Object.defineProperty(window.navigator, 'userAgent', userAgentDescriptor)
      else Reflect.deleteProperty(window.navigator, 'userAgent')
      if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
      else Reflect.deleteProperty(window, 'matchMedia')
      if (scrollHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
      if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
      if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
      if (rectDescriptor) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', rectDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect')
    }
  })

  it('uses the document scroll root on phones and horizontally follows the active section', async () => {
    await preloadLanguage('en', ['settings'])
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const elementScrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    const rectDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
    const windowScrollYDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')
    const windowInnerHeightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    const windowScrollToDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollTo')
    const sectionOffsets: Record<string, number> = {
      'settings-appearance-section': 120,
      'settings-ai-section': 620,
      'settings-mail-section': 1000,
      'settings-security-section': 1480,
      'settings-usage-section': 1900,
      'settings-data-section': 2300,
    }
    let windowScrollTop = 0
    const windowScrollTo = vi.fn((options: ScrollToOptions) => {
      windowScrollTop = Number(options.top ?? windowScrollTop)
    })
    const navScrollTo = vi.fn()

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        if (this === document.documentElement) return 3400
        if (this.classList.contains('settings-screen')) return 2600
        return 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this.classList.contains('settings-index-nav') ? 624 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList.contains('settings-screen') ? 2600 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList.contains('settings-index-nav') ? 320 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        if (this.classList.contains('settings-index-nav')) {
          this.scrollLeft = Number(options.left ?? this.scrollLeft)
          navScrollTo(options)
          return
        }
        this.scrollTop = Number(options.top ?? this.scrollTop)
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        if (this.classList.contains('settings-index-nav')) return new DOMRect(0, 0, 320, 44)
        if (this.dataset.settingsSection) {
          const index = SETTINGS_SECTION_TEST_IDS.indexOf(this.dataset.settingsSection)
          const left = index * 104 - (this.parentElement?.scrollLeft ?? 0)
          return new DOMRect(left, 0, 104, 44)
        }
        const offset = sectionOffsets[this.id]
        if (offset !== undefined) return new DOMRect(0, offset - windowScrollTop, 390, 120)
        return new DOMRect(0, -windowScrollTop, 390, 2600)
      },
    })
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => windowScrollTop,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    })
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: windowScrollTo,
    })

    const rendered = render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    try {
      const user = userEvent.setup()
      const dataButton = screen.getByRole('button', { name: 'Data management' })
      await user.click(dataButton)

      await waitFor(() => expect(windowScrollTo).toHaveBeenCalledWith({ top: 2300, behavior: 'smooth' }))
      await waitFor(() => expect(navScrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' })))
      expect(dataButton).toHaveClass('active')
      expect(navScrollTo.mock.calls.some(([options]) => Number(options.left) > 0)).toBe(true)

      window.dispatchEvent(new Event('scrollend'))
      await new Promise((resolve) => window.setTimeout(resolve, 340))
      windowScrollTop = 1000
      window.dispatchEvent(new Event('scroll'))

      const mailButton = screen.getByRole('button', { name: /Email configuration/i })
      await waitFor(() => expect(mailButton).toHaveClass('active'))
      await waitFor(() => {
        const lastOptions = navScrollTo.mock.calls[navScrollTo.mock.calls.length - 1]?.[0] as ScrollToOptions
        expect(Number(lastOptions.left)).toBeLessThan(304)
      })
    } finally {
      rendered.unmount()
      if (scrollHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
      if (scrollWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
      if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
      if (clientWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      if (elementScrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', elementScrollToDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
      if (rectDescriptor) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', rectDescriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect')
      if (windowScrollYDescriptor) Object.defineProperty(window, 'scrollY', windowScrollYDescriptor)
      else Reflect.deleteProperty(window, 'scrollY')
      if (windowInnerHeightDescriptor) Object.defineProperty(window, 'innerHeight', windowInnerHeightDescriptor)
      else Reflect.deleteProperty(window, 'innerHeight')
      if (windowScrollToDescriptor) Object.defineProperty(window, 'scrollTo', windowScrollToDescriptor)
      else Reflect.deleteProperty(window, 'scrollTo')
    }
  })
})

describe('SettingsScreen profile preset restore', () => {
  it('opens the inline confirmation and restores the default presets', async () => {
    const { user, onUpdateSettings } = await renderSettings()
    const restore = document.querySelector<HTMLDivElement>('.settings-inline-restore')

    expect(restore).not.toBeNull()
    await user.click(within(restore!).getByRole('button', { name: 'Restore defaults' }))
    expect(restore).toHaveClass('is-open')

    await user.click(restore!.querySelector<HTMLButtonElement>('.inline-confirm-commit')!)

    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ profilePresets: expect.any(Array) }),
      'Personal profile presets restored',
    )
    expect(restore).not.toHaveClass('is-open')
  })
})

describe('SettingsScreen mail sync controls', () => {
  it('restores a server-side sync after refresh and prevents duplicate jobs', async () => {
    const activeSession = session('imap')
    activeSession.mailFetchStatus!.syncJob = {
      id: 'mail-sync-test',
      mode: 'history',
      status: 'running',
      createdAt: '2026-07-10T08:01:00.000Z',
      startedAt: '2026-07-10T08:01:01.000Z',
      completedAt: null,
      result: null,
      errorCode: null,
      errorMessage: null,
    }

    const { onFetchMailNow, onSyncMailHistory } = await renderSettings(
      'imap',
      false,
      vi.fn().mockResolvedValue(undefined),
      activeSession,
    )

    expect(screen.getByText('The server is syncing in the background. You can safely refresh or leave this page.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync new mail' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Syncing previous mail…' })).toBeDisabled()
    expect(onFetchMailNow).not.toHaveBeenCalled()
    expect(onSyncMailHistory).not.toHaveBeenCalled()
  })

  it('shows the strict application-only scope and starts historical IMAP sync', async () => {
    const { user, onSyncMailHistory } = await renderSettings('imap')

    expect(screen.getByRole('button', { name: /Receiving settings/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Application-only mailbox filter')).toBeInTheDocument()
    expect(screen.getByText(/2 tracked/)).toBeInTheDocument()
    expect(screen.getByText('Previous mail has not been synced yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sync previous mail' }))

    // Already-saved settings go straight to the enqueue endpoint in one request,
    // so an immediate browser refresh cannot interrupt a preliminary save call.
    expect(onSyncMailHistory).toHaveBeenCalledWith(undefined)
  })

  it('saves the visible IMAP form atomically when automatic sync is enabled', async () => {
    const { user, onUpdateSettings } = await renderSettings('imap')

    await user.click(screen.getByRole('switch', { name: 'Automatically import professor correspondence' }))

    expect(onUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
      incomingProtocol: 'imap',
      incomingHost: 'imap.example.com',
      incomingPort: 993,
      incomingUser: 'student@example.com',
      autoFetchMail: true,
    }), 'Mail settings saved.')
  })

  it('disables automatic and historical sync for POP3 because sent folders require IMAP', async () => {
    await renderSettings('pop3')

    expect(screen.getByRole('switch', { name: 'Automatically import professor correspondence' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sync previous mail' })).toBeDisabled()
  })

  it('smoothly collapses and restores the IMAP requirement when the protocol changes', async () => {
    const { user } = await renderSettings('pop3')
    const warningPanel = screen.getByText('Automatic, sent-mail, and historical sync require IMAP.').closest('.mail-protocol-note-collapse')

    expect(warningPanel).toHaveAttribute('data-collapsible-open', 'true')
    expect(warningPanel).toHaveAttribute('aria-hidden', 'false')

    await user.click(screen.getByRole('button', { name: 'Incoming protocol' }))
    await user.click(screen.getByRole('option', { name: 'IMAP' }))

    expect(warningPanel).toHaveAttribute('data-collapsible-open', 'false')
    expect(warningPanel).toHaveAttribute('aria-hidden', 'true')

    await user.click(screen.getByRole('button', { name: 'Incoming protocol' }))
    await user.click(screen.getByRole('option', { name: 'POP3' }))

    expect(warningPanel).toHaveAttribute('data-collapsible-open', 'true')
    expect(warningPanel).toHaveAttribute('aria-hidden', 'false')
  })

  it('still lets an existing POP3 auto-fetch setting be turned off', async () => {
    const { user, onUpdateSetting } = await renderSettings('pop3', true)
    const toggle = screen.getByRole('switch', { name: 'Automatically import professor correspondence' })

    expect(toggle).not.toBeDisabled()
    await user.click(toggle)
    expect(onUpdateSetting).toHaveBeenCalledWith('autoFetchMail', false)
  })

  it.each(['success', 'failure'] as const)('smoothly restores the connection test action after %s', async (outcome) => {
    let settleTest: (() => void) | undefined
    const onTestIncomingMail = vi.fn().mockImplementation(() => new Promise<void>((resolve, reject) => {
      settleTest = outcome === 'success' ? resolve : () => reject(new Error('Connection failed'))
    }))
    const { user } = await renderSettings('imap', false, onTestIncomingMail)
    const testButton = screen.getByRole('button', { name: 'Test connection' })

    await user.click(testButton)

    expect(onTestIncomingMail).toHaveBeenCalledWith(expect.objectContaining({
      incomingProtocol: 'imap',
      incomingHost: 'imap.example.com',
      incomingPort: 993,
      incomingUser: 'student@example.com',
    }))
    expect(testButton).toHaveAttribute('aria-busy', 'true')
    expect(testButton).toHaveAccessibleName('Testing connection…')
    expect(testButton.querySelector('.mail-test-action-idle')).toHaveAttribute('data-present', 'false')
    expect(testButton.querySelector('.mail-test-action-pending')).toHaveAttribute('data-present', 'true')
    expect(testButton.querySelector('.spin-icon')).toBeInTheDocument()

    act(() => settleTest?.())

    await waitFor(() => expect(testButton).toHaveAttribute('aria-busy', 'false'))
    expect(testButton).toHaveAccessibleName('Test connection')
    expect(testButton.querySelector('.mail-test-action-idle')).toHaveAttribute('data-present', 'true')
    expect(testButton.querySelector('.mail-test-action-pending')).toHaveAttribute('data-present', 'false')
  })
})

describe('SettingsScreen receiving delivery and passkey editing', () => {
  it('confirms a receiving-mailbox removal before playing its exit state', async () => {
    await preloadLanguage('en', ['settings'])
    const onUpdateSettings = vi.fn()
    const mailboxSession = session()
    mailboxSession.user.settings.receiveEmails = [
      { address: 'student@example.com', isPrimary: true, notify: true, verified: true },
      { address: 'pending@example.com', isPrimary: false, notify: false, verified: false },
    ]
    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={mailboxSession}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
          onUpdateSettings={onUpdateSettings}
        />
      </I18nContext.Provider>,
    )

    const user = userEvent.setup()
    const mailboxCard = screen.getByRole('region', { name: 'Receive emails' })
    await user.click(within(mailboxCard).getByRole('button'))
    const pendingRow = document.querySelector<HTMLElement>('.receive-email-row.pending')
    expect(pendingRow).not.toBeNull()
    expect(pendingRow?.querySelector('.receive-email-meta')).toHaveTextContent('Pending verification')
    expect(pendingRow?.querySelector('.receive-email-actions')).not.toBeNull()

    await user.click(within(pendingRow!).getByRole('button', { name: 'Remove email' }))
    expect(within(pendingRow!).getByRole('button', { name: 'Cancel' })).toBeVisible()
    expect(within(pendingRow!).getByRole('button', { name: 'Confirm' })).toBeVisible()

    await user.click(within(pendingRow!).getByRole('button', { name: 'Cancel' }))
    expect(within(pendingRow!).getByRole('button', { name: 'Remove email' })).toBeVisible()

    await user.click(within(pendingRow!).getByRole('button', { name: 'Remove email' }))
    await user.click(within(pendingRow!).getByRole('button', { name: 'Confirm' }))
    expect(pendingRow).toHaveClass('is-removing')

    await waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({
      receiveEmails: [{ address: 'student@example.com', isPrimary: true, notify: true, verified: true }],
    }))
  })

  it('hands primary-mailbox status and action controls off through width-aware presence states', async () => {
    await preloadLanguage('en', ['settings'])
    const onUpdateSettings = vi.fn()
    const initialSession = session()
    initialSession.user.settings.receiveEmails = [
      { address: 'student@example.com', isPrimary: true, notify: true, verified: true },
      { address: 'backup@example.com', isPrimary: false, notify: true, verified: true },
    ]
    const renderScreen = (activeSession: AuthSession) => (
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={activeSession}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
          onUpdateSettings={onUpdateSettings}
        />
      </I18nContext.Provider>
    )
    const rendered = render(renderScreen(initialSession))
    const user = userEvent.setup()
    const mailboxCard = screen.getByRole('region', { name: 'Receive emails' })
    await user.click(within(mailboxCard).getByRole('button'))
    const backupRow = Array.from(document.querySelectorAll<HTMLElement>('.receive-email-row'))
      .find((row) => row.textContent?.includes('backup@example.com'))
    expect(backupRow).toBeDefined()

    await user.click(within(backupRow!).getByRole('button', { name: 'Make primary' }))
    expect(onUpdateSettings).toHaveBeenCalledWith({
      receiveEmails: [
        { address: 'student@example.com', isPrimary: false, notify: true, verified: true },
        { address: 'backup@example.com', isPrimary: true, notify: true, verified: true },
      ],
    })

    const promotedSession = session()
    promotedSession.user.settings.receiveEmails = [
      { address: 'student@example.com', isPrimary: false, notify: true, verified: true },
      { address: 'backup@example.com', isPrimary: true, notify: true, verified: true },
    ]
    rendered.rerender(renderScreen(promotedSession))

    const formerPrimaryRow = Array.from(document.querySelectorAll<HTMLElement>('.receive-email-row'))
      .find((row) => row.textContent?.includes('student@example.com'))
    const newPrimaryRow = Array.from(document.querySelectorAll<HTMLElement>('.receive-email-row'))
      .find((row) => row.textContent?.includes('backup@example.com'))
    expect(formerPrimaryRow?.querySelector('.mailbox-primary-status')).toHaveAttribute('data-present', 'false')
    expect(formerPrimaryRow?.querySelector('.mailbox-primary-action-stage')).toHaveAttribute('data-present', 'true')
    expect(newPrimaryRow?.querySelector('.mailbox-primary-status')).toHaveAttribute('data-present', 'true')
    expect(newPrimaryRow?.querySelector('.mailbox-primary-action-stage')).toHaveAttribute('data-present', 'false')
  })

  it('tests a receiving address through the administrator-managed system transport', async () => {
    await preloadLanguage('en', ['settings'])
    let resolveDelivery: (() => void) | undefined
    const onTestEmail = vi.fn(() => new Promise<void>((resolve) => {
      resolveDelivery = resolve
    }))
    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
          onTestEmail={onTestEmail}
        />
      </I18nContext.Provider>,
    )

    const receiveRow = document.querySelector<HTMLElement>('.receive-email-row')
    expect(receiveRow).not.toBeNull()
    const testButton = receiveRow?.querySelector<HTMLButtonElement>('.mail-test-btn')
    expect(testButton).not.toBeNull()
    await userEvent.setup().click(testButton!)

    expect(onTestEmail).toHaveBeenCalledWith(undefined, 'student@example.com', 'system')
    expect(testButton).toHaveAttribute('aria-busy', 'true')
    expect(testButton).toHaveAccessibleName('Sending…')
    expect(testButton).toBeDisabled()

    await act(async () => resolveDelivery?.())
    await waitFor(() => expect(testButton).toHaveAccessibleName('Test email sent'))
    expect(testButton).toHaveAttribute('data-state', 'success')
  })

  it('renames a saved passkey after a double click and enters a closing motion state', async () => {
    await preloadLanguage('en', ['settings'])
    const onRenamePasskey = vi.fn().mockResolvedValue(undefined)
    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          passkeyAvailable
          passkeys={[{
            id: 'passkey-1',
            label: 'MacBook Touch ID',
            createdAt: '2026-07-01T08:00:00.000Z',
            lastUsedAt: null,
            transports: ['internal'],
            deviceType: 'singleDevice',
            backedUp: false,
          }]}
          onRenamePasskey={onRenamePasskey}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const user = userEvent.setup()
    const passkeySummary = document.querySelector<HTMLButtonElement>('.passkey-card .mail-config-summary')
    expect(passkeySummary).not.toBeNull()
    await user.click(passkeySummary!)
    await user.dblClick(screen.getByRole('button', { name: 'MacBook Touch ID' }))
    const input = screen.getByRole('textbox', { name: 'Device name' })
    await user.clear(input)
    await user.type(input, 'Office MacBook')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(onRenamePasskey).toHaveBeenCalledWith('passkey-1', 'Office MacBook'))
    expect(input.closest('.passkey-row')).toHaveClass('is-rename-closing')
  })

  it('keeps a confirmed passkey mounted with its smooth removal class', async () => {
    await preloadLanguage('en', ['settings'])
    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          passkeyAvailable
          passkeys={[{
            id: 'passkey-remove',
            label: 'Lab MacBook',
            createdAt: '2026-07-01T08:00:00.000Z',
            lastUsedAt: null,
            transports: ['internal'],
            deviceType: 'singleDevice',
            backedUp: false,
          }]}
          removingPasskeyIds={new Set(['passkey-remove'])}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    await userEvent.setup().click(document.querySelector<HTMLButtonElement>('.passkey-card .mail-config-summary')!)
    expect(document.querySelector('.passkey-row')).toHaveClass('is-removing')
  })
})

describe('SettingsScreen install experience', () => {
  it('offers the native install flow only when the browser prompt is ready', async () => {
    const { user, onInstallApp } = await renderInstallSettings('en', 'available')

    expect(screen.getByText('Install PhD Atlas')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Install app' }))

    expect(onInstallApp).toHaveBeenCalledTimes(1)
  })

  it('hides the install guidance after the app is installed', async () => {
    await renderInstallSettings('zh', 'installed')

    expect(screen.queryByText('安装 PhD Atlas')).not.toBeInTheDocument()
    expect(screen.queryByText('PhD Atlas 已安装')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '安装应用' })).not.toBeInTheDocument()
  })

  it('explains the controlled offline scope in Chinese before installation', async () => {
    const { user } = await renderInstallSettings('zh', 'available')

    const toggle = screen.getByRole('button', { name: '离线范围' })
    const panel = document.getElementById('settings-install-offline-scope')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('aria-hidden', 'true')

    await user.click(toggle)

    expect(screen.getByText(/离线数据仅保存在当前设备/)).toBeInTheDocument()
    expect(screen.getByText(/文件上传、邮件、AI、团队、分享、账户与备份操作仍需联网/)).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(panel).toHaveClass('open'))
  })
})

describe('SettingsScreen device notifications', () => {
  it('offers an explicit opt-in action and exposes the covered notification types', async () => {
    const { user, onEnableWebPush } = await renderPushSettings('ready')

    expect(screen.getByText('Professor email')).toBeInTheDocument()
    expect(screen.getByText('Team messages')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Turn on notifications' }))

    expect(onEnableWebPush).toHaveBeenCalledTimes(1)
  })

  it('shows connecting feedback immediately while enable is pending', async () => {
    let resolveEnable: ((value: string) => void) | undefined
    const onEnableWebPush = vi.fn(() => new Promise<string>((resolve) => { resolveEnable = resolve }))
    await preloadLanguage('en', ['settings'])
    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SettingsScreen
          session={session()}
          webPushStatus="ready"
          onEnableWebPush={onEnableWebPush}
          onLanguage={vi.fn()}
          onHighContrast={vi.fn()}
          onDeleteAccount={vi.fn()}
        />
      </I18nContext.Provider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Turn on notifications' }))

    expect(screen.getByRole('button', { name: /Connecting/ })).toBeDisabled()
    expect(screen.getByText('Connecting')).toBeInTheDocument()

    await act(async () => {
      resolveEnable?.('granted')
    })
  })

  it('allows an enabled device subscription to be turned off', async () => {
    const { user, onDisableWebPush } = await renderPushSettings('enabled')

    await user.click(screen.getByRole('button', { name: 'Turn off' }))

    expect(onDisableWebPush).toHaveBeenCalledTimes(1)
  })

  it('sends a test alert and confirms the accepted device delivery', async () => {
    const { user, onTestWebPush } = await renderPushSettings('enabled')

    await user.click(screen.getByRole('button', { name: 'Send test alert' }))

    expect(onTestWebPush).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Test alert sent to 1 device(s).')).toBeInTheDocument()
  })
})

describe('SettingsScreen security controls', () => {
  it('reveals session duration controls from the same collapsible summary pattern', async () => {
    const { user } = await renderSettings()
    const summary = screen.getByRole('button', { name: /Sliding window/ })
    const panel = document.getElementById('session-settings-panel')

    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('aria-hidden', 'true')

    await user.click(summary)

    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(panel).toHaveAttribute('aria-hidden', 'false')
    // CollapsiblePanel applies `.open` after a closed paint frame so CSS can animate.
    await waitFor(() => expect(panel).toHaveClass('open'))
  })
})
