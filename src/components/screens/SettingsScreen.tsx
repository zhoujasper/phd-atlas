import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BellRing,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  HardDrive,
  History,
  KeyRound,
  Languages,
  Link,
  LoaderCircle,
  Mail,
  MonitorDown,
  Palette,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import type { AiKey, AiKeyInput, AuthSession, PasskeyCredentialSummary, UserSettings, UserSettingsPatch, WebPushTestResult } from '../../api/phdApi'
import {
  normalizeSharePermission,
  normalizeShareSections,
  shareSections,
  type BackupFrequency,
  type SharePermission,
  type ShareSection,
} from '../../data/applications'
import { contentLanguagesFromSettings } from '../../contentLanguages'
import { preloadLanguage } from '../../i18n'
import { CONTENT_LANGUAGE_NAMESPACES } from '../hooks/useI18n'
import { languageOptions, localeForLanguage, type Language } from '../../i18n'
import { defaultProfilePresets, remapBuiltInProfilePresets } from '../../profilePresets'
import { THEME_PRESETS, normalizeThemeAccent, type Theme } from '../hooks/useTheme'
import { useI18n } from '../hooks/useI18n'
import type { PwaInstallOutcome, PwaInstallStatus } from '../hooks/usePwaInstall'
import type { WebPushNotificationStatus } from '../hooks/useWebPushNotifications'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { AsyncActionButton } from '../shared/AsyncActionButton'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { InlineConfirm } from '../shared/InlineConfirm'
import { InlinePresence } from '../shared/InlinePresence'
import { InfoTooltip } from '../shared/InfoTooltip'
import { InlineTestEmailAction } from '../shared/InlineTestEmailAction'
import { CopyButton } from '../shared/CopyButton'
import { OverflowReveal } from '../shared/OverflowReveal'
import { Select } from '../shared/Select'
import { SwitchControl } from '../shared/SwitchControl'
import { VerificationResendAction } from '../shared/VerificationResendAction'
import { AiKeyManager } from '../shared/AiKeyManager'
import { AvatarCropDialog } from '../shared/AvatarCropDialog'
import { UserAvatar } from '../shared/UserAvatar'
import {
  TableCell,
  TableColGroup,
  TableHeaderCell,
  useTableColumnMenu,
} from '../shared/TableColumnChrome'
import type { TableColumnDef } from '../shared/useTableColumns'

type ReceiveEmail = {
  address: string
  isPrimary: boolean
  notify: boolean
  verified?: boolean
  verificationSentAt?: string
}

type ShareExpiryChoice = '1h' | '1d' | '7d' | '30d' | 'never'
type ShareSortColumn = 'application' | 'created' | 'expires' | 'permission'
type ShareSortState = { column: ShareSortColumn; direction: 'asc' | 'desc' }
type IncomingProtocol = 'pop3' | 'imap'
type BackupFrequencyChoice = BackupFrequency | 'off'
type SettingsSectionId =
  | 'settings-appearance-section'
  | 'settings-ai-section'
  | 'settings-mail-section'
  | 'settings-security-section'
  | 'settings-usage-section'
  | 'settings-data-section'

export type SharedLinkInfo = {
  applicationId: string
  applicationName: string
  share: {
    id: string
    token: string
    createdAt: string
    expiresAt: string | null
    permission?: SharePermission
    sections?: ShareSection[]
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_RECEIVE_EMAILS = 5
const DEFAULT_SHARE_QUOTA = 5
const SHARE_PAGE_SIZE = 10
const DEFAULT_USER_SESSION_MINUTES = 720
const RECEIVE_EMAIL_REMOVE_EXIT_MS = 380

/** Compact brand marks for calendar provider buttons (inline SVG, no external assets). */
function GoogleCalendarLogo() {
  return (
    <svg className="calendar-provider-logo-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#dadce0" strokeWidth="1" />
      <path d="M3 8.5h18" stroke="#1a73e8" strokeWidth="5" strokeLinecap="butt" />
      <path d="M3 8.5h18" stroke="#4285f4" strokeWidth="5" />
      <rect x="3" y="6" width="18" height="3.2" fill="#4285f4" />
      <rect x="3" y="6" width="4.5" height="3.2" fill="#ea4335" />
      <rect x="7.5" y="6" width="4.5" height="3.2" fill="#fbbc04" />
      <rect x="16.5" y="6" width="4.5" height="3.2" fill="#34a853" />
      <text x="12" y="18.2" textAnchor="middle" fill="#3c4043" fontSize="8.5" fontWeight="700" fontFamily="system-ui, -apple-system, sans-serif">31</text>
    </svg>
  )
}

function AppleCalendarLogo() {
  return (
    <svg className="calendar-provider-logo-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="3.5" width="18" height="17.5" rx="3.5" fill="#fff" stroke="rgba(0,0,0,0.08)" strokeWidth="0.75" />
      <path d="M3 9h18" fill="none" />
      <rect x="3" y="3.5" width="18" height="5.5" rx="3.5" fill="#ff3b30" />
      <rect x="3" y="6.5" width="18" height="2.5" fill="#ff3b30" />
      <text x="12" y="18.4" textAnchor="middle" fill="#1d1d1f" fontSize="9" fontWeight="650" fontFamily="system-ui, -apple-system, sans-serif">31</text>
    </svg>
  )
}

function OutlookCalendarLogo() {
  return (
    <svg className="calendar-provider-logo-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="7.5" y="3.5" width="13.5" height="17" rx="1.6" fill="#0078d4" />
      <path d="M9.2 6.4h2.6v2.2H9.2zm3.5 0h2.6v2.2h-2.6zm3.5 0H19v2.2h-2.8zM9.2 10h2.6v2.2H9.2zm3.5 0h2.6v2.2h-2.6zm3.5 0H19v2.2h-2.8zM9.2 13.6h2.6v2.2H9.2zm3.5 0h2.6v2.2h-2.6z" fill="#fff" opacity="0.92" />
      <rect x="2.2" y="7.2" width="11" height="11" rx="1.5" fill="#0f6cbd" />
      <ellipse cx="7.7" cy="12.7" rx="3.1" ry="3.2" fill="none" stroke="#fff" strokeWidth="1.55" />
    </svg>
  )
}
const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  'settings-appearance-section',
  'settings-ai-section',
  'settings-mail-section',
  'settings-security-section',
  'settings-usage-section',
  'settings-data-section',
]
const backupFrequencyOptions: Array<{ value: BackupFrequency; labelKey: string; fallback: string }> = [
  { value: '1m', labelKey: 'settings.backupEvery1m', fallback: 'Every minute' },
  { value: '5m', labelKey: 'settings.backupEvery5m', fallback: 'Every 5 minutes' },
  { value: '15m', labelKey: 'settings.backupEvery15m', fallback: 'Every 15 minutes' },
  { value: '30m', labelKey: 'settings.backupEvery30m', fallback: 'Every 30 minutes' },
  { value: '1h', labelKey: 'settings.backupEvery1h', fallback: 'Every hour' },
  { value: '3h', labelKey: 'settings.backupEvery3h', fallback: 'Every 3 hours' },
  { value: '6h', labelKey: 'settings.backupEvery6h', fallback: 'Every 6 hours' },
  { value: '12h', labelKey: 'settings.backupEvery12h', fallback: 'Every 12 hours' },
  { value: 'daily', labelKey: 'settings.backupEvery1d', fallback: 'Daily' },
]
const backupFrequencyChoices: Array<{ value: BackupFrequencyChoice; labelKey: string; fallback: string; proOnly?: boolean }> = [
  ...backupFrequencyOptions.map((option) => ({ ...option, proOnly: true })),
  { value: 'off', labelKey: 'settings.backupOff', fallback: 'Off' },
]
const backupLimitTiers = [1, 2, 5, 10, 20] as const
const EXPORT_FORMATS = [
  {
    id: 'json' as const,
    ext: 'JSON',
    Icon: FileJson,
    labelKey: 'settings.exportFormatJson',
    hintKey: 'settings.exportFormatJsonHint',
  },
  {
    id: 'csv' as const,
    ext: 'CSV',
    Icon: Table2,
    labelKey: 'settings.exportFormatCsv',
    hintKey: 'settings.exportFormatCsvHint',
  },
  {
    id: 'excel' as const,
    ext: 'XLS',
    Icon: FileSpreadsheet,
    labelKey: 'settings.exportFormatExcel',
    hintKey: 'settings.exportFormatExcelHint',
  },
  {
    id: 'pdf' as const,
    ext: 'PDF',
    Icon: FileText,
    labelKey: 'settings.exportFormatPdf',
    hintKey: 'settings.exportFormatPdfHint',
  },
]
const trashRetentionOptions = [1, 5, 10, 30, 60] as const
const sharePermissionOptions: Array<{ value: SharePermission; labelKey: string; fallback: string }> = [
  { value: 'view', labelKey: 'share.permission.view', fallback: 'View' },
  { value: 'upload', labelKey: 'share.permission.upload', fallback: 'Upload files' },
  { value: 'edit', labelKey: 'share.permission.edit', fallback: 'Edit' },
]

function normalizeBackupFrequency(value: string | undefined): BackupFrequency {
  return backupFrequencyOptions.some((option) => option.value === value)
    ? (value as BackupFrequency)
    : 'daily'
}

const shareExpiryOptions: Array<{ value: ShareExpiryChoice; labelKey: string; fallback: string }> = [
  { value: '1h', labelKey: 'share.expiry.1h', fallback: '1 hour' },
  { value: '1d', labelKey: 'share.expiry.1d', fallback: '1 day' },
  { value: '7d', labelKey: 'share.expiry.7d', fallback: '7 days' },
  { value: '30d', labelKey: 'share.expiry.30d', fallback: '30 days' },
  { value: 'never', labelKey: 'share.expiry.never', fallback: 'Never' },
]

const shareSortColumns: Array<{ column: ShareSortColumn; labelKey: string; fallback: string }> = [
  { column: 'application', labelKey: 'share.table.application', fallback: 'Application' },
  { column: 'created', labelKey: 'share.table.created', fallback: 'Created' },
  { column: 'expires', labelKey: 'share.table.expires', fallback: 'Expires' },
  { column: 'permission', labelKey: 'share.table.permission', fallback: 'Permission' },
]

const sessionDurationOptions = [
  { value: '15', labelKey: 'settings.sessionDuration15m', fallback: '15 minutes' },
  { value: '60', labelKey: 'settings.sessionDuration1h', fallback: '1 hour' },
  { value: '240', labelKey: 'settings.sessionDuration4h', fallback: '4 hours' },
  { value: '720', labelKey: 'settings.sessionDuration12h', fallback: '12 hours' },
  { value: '1440', labelKey: 'settings.sessionDuration1d', fallback: '1 day' },
  { value: '10080', labelKey: 'settings.sessionDuration7d', fallback: '7 days' },
  { value: '43200', labelKey: 'settings.sessionDuration30d', fallback: '30 days' },
]

function fallbackReceiveEmails(session: AuthSession): ReceiveEmail[] {
  const configured = session.user.settings.receiveEmails
  if (configured?.length) {
    return configured.slice(0, MAX_RECEIVE_EMAILS).map((email) => ({
      ...email,
      address: email.address.trim().toLowerCase(),
      verified: email.verified ?? true,
    }))
  }
  return [{
    address: session.user.settings.receiveAt || session.user.email,
    isPrimary: true,
    notify: true,
    verified: true,
  }]
}

function normalizeReceiveEmails(emails: ReceiveEmail[]) {
  const deduped = emails.reduce<ReceiveEmail[]>((items, email) => {
    const address = email.address.trim().toLowerCase()
    if (!address || items.some((item) => item.address === address) || items.length >= MAX_RECEIVE_EMAILS) return items
    items.push({
      ...email,
      address,
      verified: email.verified ?? false,
      isPrimary: Boolean(email.isPrimary && (email.verified ?? false)),
    })
    return items
  }, [])
  if (deduped.length === 0) return []

  const primaryIndex = deduped.findIndex((email) => email.isPrimary && email.verified)
  const fallbackPrimaryIndex = deduped.findIndex((email) => email.verified)
  return deduped.map((email, index) => ({
    ...email,
    isPrimary: index === (primaryIndex >= 0 ? primaryIndex : fallbackPrimaryIndex),
  }))
}

function formatShareExpiry(expiresAt: string | null, lang: string, tx: (path: string, fallback?: string) => string) {
  if (!expiresAt) return tx('share.neverExpires')
  return new Date(expiresAt).toLocaleString(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatShareTimestamp(value: string, lang: string) {
  return new Date(value).toLocaleString(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatPasskeyTimestamp(value: string | null | undefined, lang: string, tx: (path: string, fallback?: string) => string) {
  if (!value) return tx('settings.passkeyNeverUsed')
  return new Date(value).toLocaleString(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function expiresAtForShare(expiry: ShareExpiryChoice) {
  if (expiry === 'never') return null
  const durations: Record<Exclude<ShareExpiryChoice, 'never'>, number> = {
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  return new Date(Date.now() + durations[expiry]).toISOString()
}

function shareExpiryChoice(expiresAt: string | null): ShareExpiryChoice {
  if (!expiresAt) return 'never'
  const delta = new Date(expiresAt).getTime() - Date.now()
  if (delta <= 60 * 60 * 1000 * 1.5) return '1h'
  if (delta <= 24 * 60 * 60 * 1000 * 1.5) return '1d'
  if (delta <= 7 * 24 * 60 * 60 * 1000 * 1.5) return '7d'
  return '30d'
}

function formatShareScope(
  sections: ShareSection[] | undefined,
  tx: (path: string, fallback?: string) => string,
  format: (template: string, values: Record<string, string | number>) => string,
) {
  const normalized = normalizeShareSections(sections)
  const summary = normalized.length === shareSections.length
    ? tx('share.scope.all')
    : format(tx('share.scope.count'), { count: normalized.length })
  const labels = normalized.map((section) => tx(`share.sections.${section}`, section)).join(', ')
  return { summary, labels }
}

function formatBytes(bytes: number) {
  if (!bytes || bytes < 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function MailConfigCard({
  dataTour,
  ariaLabel,
  className,
  iconClassName,
  icon,
  eyebrow,
  title,
  summary,
  chipClassName,
  chipLabel,
  children,
}: {
  dataTour?: string
  ariaLabel: string
  className?: string
  iconClassName: string
  icon: ReactNode
  eyebrow: ReactNode
  title: ReactNode
  summary: ReactNode
  chipClassName: string
  chipLabel: ReactNode
  children: ReactNode
}) {
  // All mail config cards start collapsed and expand on demand.
  const [open, setOpen] = useState(false)

  return (
    <section className={`mail-config-card mail-collapsible ${className ?? ''} ${open ? 'expanded' : ''}`} aria-label={ariaLabel}>
      <button
        type="button"
        className="mail-config-summary"
        data-tour={dataTour}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`mail-config-icon ${iconClassName}`} aria-hidden="true">
          {icon}
        </span>
        <span className="mail-config-copy">
          <span className="eyebrow">{eyebrow}</span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <span className="mail-config-chips" aria-hidden="true">
          <span className={`mail-summary-chip ${chipClassName}`}>{chipLabel}</span>
        </span>
        <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
      </button>
      <CollapsiblePanel
        open={open}
        keepMounted
        collapseMs={260}
        className="mail-config-detail"
        innerClassName="mail-config-detail-inner"
      >
        {children}
      </CollapsiblePanel>
    </section>
  )
}

export function SettingsScreen({
  session,
  installStatus,
  onInstallApp,
  webPushStatus,
  onEnableWebPush,
  onDisableWebPush,
  onTestWebPush,
  onLanguage,
  onHighContrast,
  theme = 'light',
  onToggleTheme,
  onOpenNotifications,
  onLogout,
  onAccentColor,
  onAvatarSave,
  onUpdateSetting,
  onUpdateSettings,
  passkeys = [],
  removingPasskeyIds,
  passkeyAvailable = false,
  onCreatePasskey,
  onRenamePasskey,
  onDeletePasskey,
  onTestEmail,
  onSendReceiveEmailVerification,
  onTestIncomingMail,
  onFetchMailNow,
  onSyncMailHistory,
  onExport,
  onDeleteAccount,
  allShares = [],
  onRevokeShare,
  onUpdateShare,
  onReplayTutorial,
  aiKeys = [],
  onCreateAiKey,
  onUpdateAiKey,
  onDeleteAiKey,
  onTestAiKey,
  onResetAiKeyUsage,
  onNotify,
  deferProgressiveReveal = false,
}: {
  session: AuthSession
  installStatus?: PwaInstallStatus
  onInstallApp?: () => Promise<PwaInstallOutcome>
  webPushStatus?: WebPushNotificationStatus
  onEnableWebPush?: () => Promise<unknown>
  onDisableWebPush?: () => Promise<unknown>
  onTestWebPush?: () => Promise<WebPushTestResult>
  onLanguage: (language: Language) => void
  onHighContrast: (checked: boolean) => void
  theme?: Theme
  onToggleTheme?: () => void
  onOpenNotifications?: () => void
  onLogout?: () => void
  onAccentColor?: (color: string) => void
  onAvatarSave?: (avatarDataUrl: string) => Promise<boolean | void> | boolean | void
  onUpdateSetting?: (key: string, value: unknown) => void
  onUpdateSettings?: (patch: UserSettingsPatch, message?: string) => void
  passkeys?: PasskeyCredentialSummary[]
  /** Credentials kept mounted briefly while their confirmed removal collapses. */
  removingPasskeyIds?: ReadonlySet<string>
  passkeyAvailable?: boolean
  onCreatePasskey?: (label: string) => void
  onRenamePasskey?: (id: string, label: string) => Promise<void> | void
  onDeletePasskey?: (id: string) => void
  onTestEmail?: (patch?: Partial<UserSettings>, delivery?: string, source?: 'personal' | 'system') => Promise<void> | void
  onSendReceiveEmailVerification?: (email: string) => Promise<string | void> | string | void
  onTestIncomingMail?: (patch?: Partial<UserSettings>) => Promise<void> | void
  onFetchMailNow?: (patch?: Partial<UserSettings>) => Promise<void> | void
  onSyncMailHistory?: (patch?: Partial<UserSettings>) => Promise<void> | void
  onExport?: (format: 'json' | 'csv' | 'excel' | 'pdf') => void
  onDeleteAccount: () => void
  allShares?: SharedLinkInfo[]
  onRevokeShare?: (applicationId: string, shareId: string) => void
  onUpdateShare?: (applicationId: string, shareId: string, expiresAt: string | null, permission?: SharePermission) => void
  onReplayTutorial?: () => void
  aiKeys?: AiKey[]
  onCreateAiKey?: (input: AiKeyInput) => Promise<void> | void
  onUpdateAiKey?: (id: string, input: Partial<Pick<AiKeyInput, 'label' | 'model' | 'baseUrl' | 'apiKey'>>) => Promise<void> | void
  onDeleteAiKey?: (id: string) => Promise<void> | void
  onTestAiKey?: (id: string) => Promise<{ latencyMs: number; model?: string }>
  onResetAiKeyUsage?: (id: string) => Promise<void> | void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  /** Hold non-essential settings groups until the enclosing screen handoff ends. */
  deferProgressiveReveal?: boolean
}) {
  const lang = session.user.settings.language
  const accent = normalizeThemeAccent(session.user.settings.themeAccent)
  const { tx, format } = useI18n()
  const languages = languageOptions()
  const [contentLangPair, setContentLangPair] = useState(() => contentLanguagesFromSettings(session.user.settings))
  const [sendFrom, setSendFrom] = useState(session.user.settings.sendFrom || session.user.email)
  const [smtpHost, setSmtpHost] = useState(session.user.settings.smtpHost || '')
  const [smtpPort, setSmtpPort] = useState(String(session.user.settings.smtpPort ?? 587))
  const [smtpUser, setSmtpUser] = useState(session.user.settings.smtpUser || session.user.settings.sendFrom || session.user.email)
  // The server never returns the real secret (see session.user.settings.smtpPassSet) — this only ever holds a NEW value being typed.
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpTls, setSmtpTls] = useState(session.user.settings.smtpTls ?? true)

  // Keep dual content-language selects in sync with the session after a successful save/reload.
  useEffect(() => {
    setContentLangPair(contentLanguagesFromSettings(session.user.settings))
  }, [
    session.user.settings.contentLanguagePrimary,
    session.user.settings.contentLanguageSecondary,
  ])
  const [incomingProtocol, setIncomingProtocol] = useState<IncomingProtocol>(session.user.settings.incomingProtocol ?? 'imap')
  const [incomingHost, setIncomingHost] = useState(session.user.settings.incomingHost || '')
  const [incomingPort, setIncomingPort] = useState(String(session.user.settings.incomingPort ?? 995))
  const [incomingUser, setIncomingUser] = useState(session.user.settings.incomingUser || session.user.settings.receiveAt || session.user.email)
  const [incomingPass, setIncomingPass] = useState('')
  const [incomingTls, setIncomingTls] = useState(session.user.settings.incomingTls ?? true)
  const [incomingMailTesting, setIncomingMailTesting] = useState(false)
  const [mailSyncAction, setMailSyncAction] = useState<'new' | 'history' | null>(null)
  const [webPushTestState, setWebPushTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [webPushTestDelivery, setWebPushTestDelivery] = useState(0)
  /** Immediate click feedback so the enable/disable action never feels ignored while the hook settles. */
  const [webPushActionPending, setWebPushActionPending] = useState<'enable' | 'disable' | null>(null)
  const [offlineScopeOpen, setOfflineScopeOpen] = useState(false)
  const [selectedAccent, setSelectedAccent] = useState(accent)
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newEmailTouched, setNewEmailTouched] = useState(false)
  const [showAddEmail, setShowAddEmail] = useState(false)
  const [addEmailBusy, setAddEmailBusy] = useState(false)
  const [confirmRemoveEmailAddress, setConfirmRemoveEmailAddress] = useState<string | null>(null)
  const [removingReceiveEmailAddress, setRemovingReceiveEmailAddress] = useState<string | null>(null)
  const receiveEmailRemoveTimerRef = useRef<number | null>(null)
  const [sessionWindowOpen, setSessionWindowOpen] = useState(false)
  const [passkeyOpen, setPasskeyOpen] = useState(false)
  const [passkeyLabel, setPasskeyLabel] = useState('')
  const [renamingPasskeyId, setRenamingPasskeyId] = useState<string | null>(null)
  const [passkeyRenameDraft, setPasskeyRenameDraft] = useState('')
  const [passkeyRenameClosingId, setPasskeyRenameClosingId] = useState<string | null>(null)
  const [passkeyRenameSavingId, setPasskeyRenameSavingId] = useState<string | null>(null)
  const passkeyRenameTimerRef = useRef<number | null>(null)
  const [confirmDeletePasskey, setConfirmDeletePasskey] = useState<PasskeyCredentialSummary | null>(null)
  const [confirmRestoreProfilePresets, setConfirmRestoreProfilePresets] = useState(false)
  const [sharePage, setSharePage] = useState(0)
  const [shareSearch, setShareSearch] = useState('')
  const [shareSort, setShareSort] = useState<ShareSortState>({ column: 'created', direction: 'desc' })
  const [confirmRevokeShare, setConfirmRevokeShare] = useState<{ appId: string; shareId: string } | null>(null)
  const [settingsRevealStep, setSettingsRevealStep] = useState(() => {
    if (navigator.userAgent.toLowerCase().includes('jsdom')) return 3
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 3 : 0
  })
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('settings-appearance-section')
  const settingsIndexNavRef = useRef<HTMLElement | null>(null)
  const pendingSettingsScrollRef = useRef<SettingsSectionId | null>(null)
  const settingsScrollSequenceRef = useRef(0)
  const settingsScrollReleaseTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setSelectedAccent(accent)
  }, [accent])
  const receiveEmails = fallbackReceiveEmails(session)
  const backupFrequency = normalizeBackupFrequency(session.user.settings.backupFrequency ?? session.settings.backupFrequency)
  const isAdmin = session.user.role === 'admin'
  const encryptionAtRest = Boolean(session.settings.encryptionAtRest)
  const notifyCopyResult = useCallback((ok: boolean, detail: { label: string }) => {
    if (ok) {
      onNotify?.(format(tx('toast.copied'), { label: detail.label }), 'success')
      return
    }
    onNotify?.(tx('copyFailed'), 'error')
  }, [format, onNotify, tx])
  // Settings is the personal account surface. Team membership is a separate
  // workspace identity and must never replace the user's personal plan badge.
  const accountPlan = isAdmin
    ? 'admin'
    : (session.user.settings.personalMembershipPlan ?? session.user.settings.membershipPlan) === 'pro'
      ? 'pro'
      : 'free'
  const isPro = accountPlan !== 'free'
  const isTeam = false
  const maxBackupsLimit = isAdmin
    ? 100
    : isPro
      ? Math.min(20, Math.max(1, Number(session.settings.maxBackupsPerAppLimit ?? 20)))
      : 0
  const maxBackups = String(Math.min(maxBackupsLimit || 20, Number(session.user.settings.maxBackupsPerApp ?? (isAdmin ? 100 : 20))))
  const backupFrequencyValue: BackupFrequencyChoice = session.user.settings.autoBackup ? backupFrequency : 'off'
  const showBackupLimit = backupFrequencyValue !== 'off'
  const sessionDuration = String(session.user.settings.sessionDurationMinutes ?? DEFAULT_USER_SESSION_MINUTES)
  const sessionDurationOption = sessionDurationOptions.find((option) => option.value === sessionDuration) ?? sessionDurationOptions[1]
  const sessionDurationLabel = tx(sessionDurationOption.labelKey, sessionDurationOption.fallback)

  const shareTableColumns = useMemo<TableColumnDef[]>(() => [
    { id: 'application', label: tx('share.table.application', 'Application'), defaultWidth: 148, minWidth: 96 },
    { id: 'created', label: tx('share.table.created', 'Created'), defaultWidth: 118, minWidth: 88 },
    { id: 'expires', label: tx('share.table.expires', 'Expires'), defaultWidth: 128, minWidth: 96 },
    { id: 'permission', label: tx('share.table.permission', 'Permission'), defaultWidth: 124, minWidth: 100 },
    { id: 'link', label: tx('share.table.link', 'Link'), defaultWidth: 168, minWidth: 120 },
    { id: 'duration', label: tx('share.table.duration', 'Duration'), defaultWidth: 132, minWidth: 100 },
    { id: 'scope', label: tx('share.table.scope', 'Scope'), defaultWidth: 120, minWidth: 88 },
    { id: 'actions', label: tx('share.table.actions', 'Actions'), defaultWidth: 88, minWidth: 72, hideable: false, resizable: true },
  ], [tx])
  const {
    api: shareTableApi,
    openMenu: openShareTableMenu,
    menuNode: shareTableMenuNode,
  } = useTableColumnMenu('settings-share-links', shareTableColumns)
  const storageUsedBytes = Number(session.usage?.storageUsedBytes ?? 0)
  const storageQuotaBytes = session.usage?.storageQuotaBytes ?? (isAdmin
    ? null
    : Number(session.user.settings.storageQuotaMb ?? (isPro ? 100 : 5)) * 1024 * 1024)
  const storagePercent = storageQuotaBytes ? Math.min(100, Math.round((storageUsedBytes / storageQuotaBytes) * 100)) : 0
  const trashRetentionValue = session.user.settings.trashRetentionDays === null ? 'never' : String(session.user.settings.trashRetentionDays ?? 30)
  const activeShares = useMemo(
    () => allShares.filter(({ share }) => !share.expiresAt || new Date(share.expiresAt) >= new Date()),
    [allShares],
  )
  const normalizedShareSearch = shareSearch.trim().toLowerCase()
  const shareListReady = settingsRevealStep >= 3
  const visibleShares = useMemo(() => {
    if (!shareListReady) return []
    const filtered = normalizedShareSearch
      ? activeShares.filter(({ applicationName, share }) => {
          const permission = normalizeSharePermission(share.permission)
          const scope = formatShareScope(share.sections, tx, format)
          const haystack = [
            applicationName,
            `/share/${share.token}`,
            tx(`share.permission.${permission}`),
            scope.summary,
            scope.labels,
            formatShareExpiry(share.expiresAt, lang, tx),
            formatShareTimestamp(share.createdAt, lang),
          ].join(' ').toLowerCase()
          return haystack.includes(normalizedShareSearch)
        })
      : activeShares

    const direction = shareSort.direction === 'asc' ? 1 : -1
    const locale = localeForLanguage(lang)
    return [...filtered].sort((a, b) => {
      let compare = 0
      if (shareSort.column === 'application') {
        compare = a.applicationName.localeCompare(b.applicationName, locale)
      } else if (shareSort.column === 'created') {
        compare = a.share.createdAt.localeCompare(b.share.createdAt)
      } else if (shareSort.column === 'expires') {
        const aTime = a.share.expiresAt ? new Date(a.share.expiresAt).getTime() : Number.MAX_SAFE_INTEGER
        const bTime = b.share.expiresAt ? new Date(b.share.expiresAt).getTime() : Number.MAX_SAFE_INTEGER
        compare = aTime - bTime
      } else {
        compare = normalizeSharePermission(a.share.permission).localeCompare(normalizeSharePermission(b.share.permission))
      }
      if (compare !== 0) return compare * direction
      // Stable secondary sort: newest first
      return b.share.createdAt.localeCompare(a.share.createdAt)
    })
  }, [activeShares, format, lang, normalizedShareSearch, shareListReady, shareSort, tx])
  const shareQuota = Number(session.usage?.shareQuota ?? session.user.settings.shareQuota ?? DEFAULT_SHARE_QUOTA)
  const shareCreateQuota = Number(session.usage?.shareCreateQuota ?? session.user.settings.shareCreateQuota ?? shareQuota)
  const shareCreatedCount = Number(session.usage?.shareCreatedCount ?? session.user.settings.shareCreatedCount ?? activeShares.length)
  const sharePageCount = Math.max(1, Math.ceil(visibleShares.length / SHARE_PAGE_SIZE))
  const pagedShares = visibleShares.slice(sharePage * SHARE_PAGE_SIZE, (sharePage + 1) * SHARE_PAGE_SIZE)

  function toggleShareSort(column: ShareSortColumn) {
    setShareSort((current) => {
      if (current.column === column) {
        return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      // Dates default to newest / soonest-first; labels default to A-Z.
      const direction: 'asc' | 'desc' = column === 'created' || column === 'expires' ? 'desc' : 'asc'
      return { column, direction: column === 'expires' ? 'asc' : direction }
    })
  }

  function shareSortIndicator(column: ShareSortColumn) {
    if (shareSort.column !== column) return <ArrowUpDown size={12} aria-hidden="true" />
    return shareSort.direction === 'asc'
      ? <ArrowUp size={12} aria-hidden="true" />
      : <ArrowDown size={12} aria-hidden="true" />
  }
  const calendarToken = session.user.settings.calendarToken ?? ''
  const calendarHost = typeof window === 'undefined' ? '' : window.location.host
  const calendarOrigin = typeof window === 'undefined' ? '' : window.location.origin
  const calendarFeedPath = calendarToken ? `/api/calendar/feed?token=${encodeURIComponent(calendarToken)}` : ''
  const calendarFeedUrl = calendarToken && calendarOrigin ? `${calendarOrigin}${calendarFeedPath}` : ''
  const calendarWebcalUrl = calendarToken && calendarHost ? `webcal://${calendarHost}${calendarFeedPath}` : ''
  const calendarGoogleUrl = calendarWebcalUrl
    ? `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(calendarWebcalUrl)}`
    : ''
  const calendarOutlookUrl = calendarFeedUrl
    ? `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(calendarFeedUrl)}&name=${encodeURIComponent(tx('calendar.feedName', 'PhD Atlas deadlines'))}`
    : ''
  const requestCalendarToken = (message: string) => {
    onUpdateSettings?.({ generateCalendarToken: true }, message)
  }
  const sendFromValid = EMAIL_PATTERN.test(sendFrom.trim())
  const smtpPortNumber = Number(smtpPort)
  const smtpPortValid = Number.isInteger(smtpPortNumber) && smtpPortNumber >= 1 && smtpPortNumber <= 65535
  const outgoingConfigured = sendFromValid && smtpHost.trim().length > 0 && smtpPortValid
  const incomingPortNumber = Number(incomingPort)
  const incomingPortValid = Number.isInteger(incomingPortNumber) && incomingPortNumber >= 1 && incomingPortNumber <= 65535
  const incomingConfigured = incomingHost.trim().length > 0 && incomingPortValid && EMAIL_PATTERN.test(incomingUser.trim())
  const imapSyncReady = incomingConfigured && incomingProtocol === 'imap'
  const autoFetchMailEnabled = Boolean(session.user.settings.autoFetchMail)
  const trackedAddressCount = Number(session.mailFetchStatus?.trackedAddressCount ?? 0)
  const persistedMailSyncJob = session.mailFetchStatus?.syncJob
  const persistedMailSyncAction = persistedMailSyncJob && ['queued', 'running'].includes(persistedMailSyncJob.status)
    ? (persistedMailSyncJob.mode === 'history' ? 'history' : 'new')
    : null
  const effectiveMailSyncAction = mailSyncAction ?? persistedMailSyncAction
  const canSyncTrackedMail = imapSyncReady && trackedAddressCount > 0
  const mailSyncDisabledTitle = !incomingConfigured
    ? tx('settings.mailNeedsSetup')
    : incomingProtocol !== 'imap'
      ? tx('settings.imapSyncRequired')
      : trackedAddressCount === 0
        ? tx('settings.mailSyncScopeEmpty')
        : undefined
  const mailFetchStatusText = useMemo(() => {
    const status = session.mailFetchStatus
    if (!status) return null
    const formatAt = (value: string) =>
      new Date(value).toLocaleString(localeForLanguage(lang), { dateStyle: 'medium', timeStyle: 'short' })
    const errorIsNewer = status.lastErrorAt && (!status.lastFetchedAt || status.lastErrorAt > status.lastFetchedAt)
    if (errorIsNewer && status.lastErrorAt) {
      return format(tx('settings.mailFetchLastError'), { time: formatAt(status.lastErrorAt), code: status.lastErrorCode ?? '' })
    }
    if (status.lastFetchedAt) {
      return format(tx('settings.mailFetchLastChecked'), { time: formatAt(status.lastFetchedAt) })
    }
    return tx('settings.mailFetchNeverChecked')
  }, [session.mailFetchStatus, lang, tx, format])
  const mailHistoryStatusText = useMemo(() => {
    const status = session.mailFetchStatus
    if (!status?.lastHistorySyncAt) return tx('settings.mailHistoryNeverSynced')
    const time = new Date(status.lastHistorySyncAt).toLocaleString(localeForLanguage(lang), { dateStyle: 'medium', timeStyle: 'short' })
    return format(tx('settings.mailHistoryLastSynced'), {
      time,
      count: Number(status.lastHistoryImported ?? 0),
    })
  }, [session.mailFetchStatus, lang, tx, format])
  const verifiedEmailCount = receiveEmails.filter((email) => email.verified ?? true).length
  const primaryReceiveEmail = receiveEmails.find((email) => email.isPrimary) ?? receiveEmails[0]
  const newEmailAddress = newEmail.trim().toLowerCase()
  const newEmailValid = EMAIL_PATTERN.test(newEmailAddress)
  const newEmailDuplicate = receiveEmails.some((email) => email.address.toLowerCase() === newEmailAddress)
  const canAddEmail = receiveEmails.length < MAX_RECEIVE_EMAILS && newEmailValid && !newEmailDuplicate
  const webPushBusy = webPushStatus === 'enabling'
    || webPushStatus === 'disabling'
    || webPushActionPending !== null
  const webPushEnabling = webPushStatus === 'enabling' || webPushActionPending === 'enable'
  const webPushDisabling = webPushStatus === 'disabling' || webPushActionPending === 'disable'
  const webPushTitle = webPushStatus === 'enabled' || webPushDisabling
    ? tx('settings.pushEnabledTitle')
    : tx('settings.pushTitle')
  const webPushDescription = webPushStatus === 'enabled' || webPushDisabling
    ? tx('settings.pushEnabledDesc')
    : webPushStatus === 'denied'
      ? tx('settings.pushDeniedDesc')
      : webPushStatus === 'unsupported'
        ? tx('settings.pushUnsupportedDesc')
        : webPushStatus === 'error'
          ? tx('settings.pushErrorDesc')
          : tx('settings.pushReadyDesc')
  const webPushStatusLabel = webPushEnabling
    ? tx('settings.pushStatusEnabling')
    : webPushDisabling
      ? tx('settings.pushStatusDisabling')
      : webPushStatus === 'enabled'
        ? tx('settings.pushStatusEnabled')
        : webPushStatus === 'denied'
          ? tx('settings.pushStatusDenied')
          : webPushStatus === 'unsupported'
            ? tx('settings.pushStatusUnsupported')
            : webPushStatus === 'error'
              ? tx('settings.pushStatusError')
              : tx('settings.pushStatusReady')
  const webPushStatusTone = webPushEnabling
    ? 'enabling'
    : webPushDisabling
      ? 'disabling'
      : (webPushStatus ?? 'ready')
  const webPushTestFeedback = webPushTestState === 'sent'
    ? format(tx('settings.pushTestDelivered'), { count: webPushTestDelivery })
    : webPushTestState === 'error'
      ? tx('settings.pushTestError')
      : null

  const runEnableWebPush = async () => {
    if (!onEnableWebPush || webPushBusy) return
    setWebPushActionPending('enable')
    try {
      await onEnableWebPush()
    } finally {
      setWebPushActionPending(null)
    }
  }

  const runDisableWebPush = async () => {
    if (!onDisableWebPush || webPushBusy) return
    setWebPushActionPending('disable')
    try {
      await onDisableWebPush()
    } finally {
      setWebPushActionPending(null)
    }
  }

  useEffect(() => {
    setSendFrom(session.user.settings.sendFrom || session.user.email)
    setSmtpHost(session.user.settings.smtpHost || '')
    setSmtpPort(String(session.user.settings.smtpPort ?? 587))
    setSmtpUser(session.user.settings.smtpUser || session.user.settings.sendFrom || session.user.email)
    setSmtpPass('')
    setSmtpTls(session.user.settings.smtpTls ?? true)
    setIncomingProtocol(session.user.settings.incomingProtocol ?? 'imap')
    setIncomingHost(session.user.settings.incomingHost || '')
    setIncomingPort(String(session.user.settings.incomingPort ?? (
      (session.user.settings.incomingProtocol ?? 'imap') === 'imap' ? 993 : 995
    )))
    setIncomingUser(session.user.settings.incomingUser || session.user.settings.receiveAt || session.user.email)
    setIncomingPass('')
    setIncomingTls(session.user.settings.incomingTls ?? true)
  }, [
    session.user.email,
    session.user.settings.incomingHost,
    session.user.settings.incomingPort,
    session.user.settings.incomingProtocol,
    session.user.settings.incomingTls,
    session.user.settings.incomingUser,
    session.user.settings.receiveAt,
    session.user.settings.sendFrom,
    session.user.settings.smtpHost,
    session.user.settings.smtpPort,
    session.user.settings.smtpTls,
    session.user.settings.smtpUser,
  ])

  useEffect(() => {
    if (sharePage > sharePageCount - 1) {
      setSharePage(sharePageCount - 1)
    }
  }, [sharePage, sharePageCount])

  useEffect(() => {
    setSharePage(0)
  }, [normalizedShareSearch, shareSort.column, shareSort.direction])

  useEffect(() => {
    if (deferProgressiveReveal || settingsRevealStep >= 3) return undefined

    const timers = [70, 170, 280].map((delay, index) => window.setTimeout(() => {
      startTransition(() => setSettingsRevealStep((current) => Math.max(current, index + 1)))
    }, delay))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
    // This staged mount is intentionally scheduled once for each SettingsScreen mount.
    // It starts only after a native screen snapshot has finished when deferred.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferProgressiveReveal])

  useEffect(() => {
    const scrollRoot = document.querySelector<HTMLElement>('.settings-screen')
    if (!scrollRoot) return undefined
    const elementScrolls = scrollRoot.scrollHeight > scrollRoot.clientHeight + 1
    const scrollTarget: HTMLElement | Window = elementScrolls ? scrollRoot : window

    let frame = 0
    const updateActiveSection = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        // A clicked section owns the highlight until its programmatic scroll
        // settles. Otherwise the scroll spy flashes every section passed on the
        // way to the destination.
        if (pendingSettingsScrollRef.current) return
        const mountedSections = SETTINGS_SECTION_IDS
          .map((id) => document.getElementById(id))
          .filter((node): node is HTMLElement => Boolean(node))
        if (mountedSections.length === 0) return

        // Match the line where scrollIntoView/scrollTo places section headings.
        // The old 24%-of-viewport line sat below the compact Security block, so
        // Usage could become active even while Security was aligned correctly.
        const sectionScrollMargin = Number.parseFloat(
          window.getComputedStyle(mountedSections[0]).scrollMarginTop,
        ) || 0
        const activationLine = (elementScrolls ? scrollRoot.getBoundingClientRect().top : 0)
          + sectionScrollMargin
          + 8
        let next = mountedSections[0].id as SettingsSectionId
        mountedSections.forEach((section) => {
          if (section.getBoundingClientRect().top <= activationLine) {
            next = section.id as SettingsSectionId
          }
        })
        const reachedBottom = elementScrolls
          ? scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 24
          : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24
        if (reachedBottom) {
          next = mountedSections[mountedSections.length - 1].id as SettingsSectionId
        }
        setActiveSettingsSection((current) => current === next ? current : next)
      })
    }

    scrollTarget.addEventListener('scroll', updateActiveSection, { passive: true })
    updateActiveSection()
    return () => {
      scrollTarget.removeEventListener('scroll', updateActiveSection)
      window.cancelAnimationFrame(frame)
    }
  }, [settingsRevealStep])

  useEffect(() => {
    const nav = settingsIndexNavRef.current
    if (!nav) return undefined

    const frame = window.requestAnimationFrame(() => {
      const activeButton = nav.querySelector<HTMLButtonElement>(
        `button[data-settings-section="${activeSettingsSection}"]`,
      )
      const maxScroll = Math.max(0, nav.scrollWidth - nav.clientWidth)
      if (!activeButton || maxScroll <= 1) return

      const navRect = nav.getBoundingClientRect()
      const buttonRect = activeButton.getBoundingClientRect()
      const visibleInset = 6
      const fullyVisible = buttonRect.left >= navRect.left + visibleInset
        && buttonRect.right <= navRect.right - visibleInset
      if (fullyVisible) return

      const centeredLeft = nav.scrollLeft
        + buttonRect.left
        - navRect.left
        - (nav.clientWidth - buttonRect.width) / 2
      const nextLeft = Math.max(0, Math.min(maxScroll, centeredLeft))
      if (Math.abs(nav.scrollLeft - nextLeft) < 1) return

      const reduceMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      nav.scrollTo({ left: nextLeft, behavior: reduceMotion ? 'auto' : 'smooth' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSettingsSection])

  useEffect(() => () => {
    settingsScrollSequenceRef.current += 1
    if (settingsScrollReleaseTimerRef.current !== null) {
      window.clearTimeout(settingsScrollReleaseTimerRef.current)
    }
  }, [])

  const updateReceiveEmails = (emails: ReceiveEmail[]) => {
    const normalized = normalizeReceiveEmails(emails)
    if (normalized.length === 0) return
    if (onUpdateSettings) {
      onUpdateSettings({ receiveEmails: normalized })
      return
    }
    onUpdateSetting?.('receiveEmails', normalized)
  }

  const addEmail = async () => {
    setNewEmailTouched(true)
    if (!canAddEmail || !onSendReceiveEmailVerification) return
    setAddEmailBusy(true)
    try {
      await onSendReceiveEmailVerification(newEmailAddress)
      setNewEmail('')
      setNewEmailTouched(false)
      setShowAddEmail(false)
    } catch {
      // The parent surfaces the SMTP/API error and the form stays open for correction or retry.
    } finally {
      setAddEmailBusy(false)
    }
  }

  const setAsPrimary = (index: number) => {
    const nextPrimary = receiveEmails[index]
    const previousPrimary = receiveEmails.find((email) => email.isPrimary)
    if (!nextPrimary?.verified || nextPrimary.address === previousPrimary?.address) return
    updateReceiveEmails(receiveEmails.map((email, itemIndex) => ({
      ...email,
      isPrimary: itemIndex === index,
    })))
  }

  const toggleNotify = (index: number) => {
    if (!receiveEmails[index]?.verified) return
    updateReceiveEmails(receiveEmails.map((email, itemIndex) => (
      itemIndex === index ? { ...email, notify: !email.notify } : email
    )))
  }

  const resendVerification = (email: ReceiveEmail) =>
    onSendReceiveEmailVerification?.(email.address)

  const removeEmail = (address: string) => {
    if (receiveEmails.length <= 1 || removingReceiveEmailAddress) return
    setConfirmRemoveEmailAddress(null)
    setRemovingReceiveEmailAddress(address)
    if (receiveEmailRemoveTimerRef.current !== null) {
      window.clearTimeout(receiveEmailRemoveTimerRef.current)
    }
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    receiveEmailRemoveTimerRef.current = window.setTimeout(() => {
      updateReceiveEmails(receiveEmails.filter((email) => email.address !== address))
      setRemovingReceiveEmailAddress(null)
      receiveEmailRemoveTimerRef.current = null
    }, reduceMotion ? 0 : RECEIVE_EMAIL_REMOVE_EXIT_MS)
  }

  const submitPasskey = (event: FormEvent) => {
    event.preventDefault()
    if (!passkeyAvailable || !onCreatePasskey) return
    onCreatePasskey(passkeyLabel.trim())
    setPasskeyLabel('')
  }

  const beginPasskeyRename = (passkey: PasskeyCredentialSummary) => {
    if (!onRenamePasskey) return
    if (passkeyRenameTimerRef.current) window.clearTimeout(passkeyRenameTimerRef.current)
    setPasskeyRenameClosingId(null)
    setPasskeyRenameSavingId(null)
    setPasskeyRenameDraft(passkey.label || tx('settings.passkeyUnnamed'))
    setRenamingPasskeyId(passkey.id)
  }

  const finishPasskeyRename = (id: string) => {
    setPasskeyRenameClosingId(id)
    if (passkeyRenameTimerRef.current) window.clearTimeout(passkeyRenameTimerRef.current)
    passkeyRenameTimerRef.current = window.setTimeout(() => {
      setRenamingPasskeyId(null)
      setPasskeyRenameClosingId(null)
      setPasskeyRenameSavingId(null)
      setPasskeyRenameDraft('')
      passkeyRenameTimerRef.current = null
    }, 220)
  }

  const submitPasskeyRename = async (event: FormEvent, passkey: PasskeyCredentialSummary) => {
    event.preventDefault()
    const nextLabel = passkeyRenameDraft.trim()
    if (!nextLabel || !onRenamePasskey || passkeyRenameSavingId) return
    if (nextLabel === passkey.label) {
      finishPasskeyRename(passkey.id)
      return
    }
    setPasskeyRenameSavingId(passkey.id)
    await onRenamePasskey(passkey.id, nextLabel)
    finishPasskeyRename(passkey.id)
  }

  useEffect(() => () => {
    if (passkeyRenameTimerRef.current) window.clearTimeout(passkeyRenameTimerRef.current)
  }, [])

  useEffect(() => () => {
    if (receiveEmailRemoveTimerRef.current !== null) {
      window.clearTimeout(receiveEmailRemoveTimerRef.current)
    }
  }, [])

  const buildOutgoingMailPatch = (): Partial<UserSettings> | null => {
    const address = sendFrom.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(address) || !smtpPortValid) return null
    return {
      sendFrom: address,
      smtpHost: smtpHost.trim(),
      smtpPort: smtpPortNumber,
      smtpUser: smtpUser.trim().toLowerCase(),
      // Omit entirely when blank so an untouched field never wipes the saved password.
      ...(smtpPass ? { smtpPass } : {}),
      smtpTls,
    }
  }

  const buildIncomingMailPatch = (): Partial<UserSettings> | null => {
    if (!incomingPortValid) return null
    return {
      incomingProtocol,
      incomingHost: incomingHost.trim(),
      incomingPort: incomingPortNumber,
      incomingUser: incomingUser.trim().toLowerCase(),
      ...(incomingPass ? { incomingPass } : {}),
      incomingTls,
    }
  }

  const saveOutgoingMail = () => {
    const patch = buildOutgoingMailPatch()
    if (!patch) return
    onUpdateSettings?.(patch, tx('settings.mailSettingsSaved'))
    setSmtpPass('')
  }

  const saveIncomingMail = () => {
    const patch = buildIncomingMailPatch()
    if (!patch) return
    onUpdateSettings?.(patch, tx('settings.mailSettingsSaved'))
    setIncomingPass('')
  }

  const clearOutgoingMailPass = () => {
    onUpdateSettings?.({ clearSmtpPass: true }, tx('settings.mailSettingsSaved'))
    setSmtpPass('')
  }

  const clearIncomingMailPass = () => {
    onUpdateSettings?.({ clearIncomingPass: true }, tx('settings.mailSettingsSaved'))
    setIncomingPass('')
  }

  const testOutgoingMail = async (delivery: string) => {
    const patch = buildOutgoingMailPatch()
    if (!patch) return
    await onTestEmail?.(patch, delivery, 'personal')
  }

  const testReceivingMailbox = async (delivery: string) => {
    await onTestEmail?.(undefined, delivery, 'system')
  }

  const testIncomingMail = async () => {
    if (!onTestIncomingMail || incomingMailTesting || effectiveMailSyncAction) return
    const patch = buildIncomingMailPatch()
    if (!patch) return
    setIncomingMailTesting(true)
    try {
      await onTestIncomingMail(patch)
    } catch {
      // The parent owns the localized failure toast; the button still restores cleanly.
    } finally {
      setIncomingMailTesting(false)
    }
  }

  const buildChangedIncomingMailPatch = (): Partial<UserSettings> | null => {
    const current = buildIncomingMailPatch()
    if (!current) return null
    const saved = session.user.settings
    const patch: Partial<UserSettings> = {}
    if (current.incomingProtocol !== (saved.incomingProtocol ?? 'imap')) patch.incomingProtocol = current.incomingProtocol
    if (current.incomingHost !== (saved.incomingHost ?? '')) patch.incomingHost = current.incomingHost
    if (current.incomingPort !== (saved.incomingPort ?? 995)) patch.incomingPort = current.incomingPort
    if (current.incomingUser !== (saved.incomingUser ?? saved.receiveAt ?? session.user.email).trim().toLowerCase()) {
      patch.incomingUser = current.incomingUser
    }
    if (current.incomingTls !== (saved.incomingTls ?? true)) patch.incomingTls = current.incomingTls
    if (incomingPass) patch.incomingPass = incomingPass
    return Object.keys(patch).length > 0 ? patch : null
  }

  const updateAutoFetchMail = (checked: boolean) => {
    if (!checked) {
      onUpdateSetting?.('autoFetchMail', false)
      return
    }
    const patch = buildIncomingMailPatch()
    if (!patch) return
    onUpdateSettings?.({ ...patch, autoFetchMail: true }, tx('settings.mailSettingsSaved'))
    setIncomingPass('')
  }

  const runMailSync = async (mode: 'new' | 'history') => {
    const callback = mode === 'history' ? onSyncMailHistory : onFetchMailNow
    if (!callback || effectiveMailSyncAction) return
    const patch = buildChangedIncomingMailPatch()
    setMailSyncAction(mode)
    try {
      await callback(patch ?? undefined)
    } finally {
      setMailSyncAction(null)
    }
  }

  const sendWebPushTest = async () => {
    if (!onTestWebPush || webPushTestState === 'sending') return
    setWebPushTestState('sending')
    try {
      const result = await onTestWebPush()
      setWebPushTestDelivery(result.delivered)
      setWebPushTestState('sent')
    } catch {
      setWebPushTestState('error')
    }
  }

  const openUpgradePage = (feature: string, requested: string, limit = String(maxBackupsLimit)) => {
    const params = new URLSearchParams({
      feature,
      limit,
      requested,
    })
    window.open(`/upgrade-pro?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  const installStatusLabel = installStatus === 'available'
    ? tx('settings.installAppStatusAvailable')
    : installStatus === 'installing'
      ? tx('settings.installAppStatusInstalling')
      : installStatus === 'dismissed'
        ? tx('settings.installAppStatusDismissed')
        : tx('settings.installAppStatusBrowser')
  const installDescription = installStatus === 'available'
    ? tx('settings.installAppAvailableDesc')
    : installStatus === 'installing'
      ? tx('settings.installAppInstallingDesc')
      : installStatus === 'dismissed'
        ? tx('settings.installAppDismissedDesc')
        : installStatus === 'error'
          ? tx('settings.installAppErrorDesc')
          : tx('settings.installAppBrowserDesc')

  const showDeviceGrid = Boolean(
    (installStatus && installStatus !== 'installed')
    || webPushStatus
    || onReplayTutorial,
  )
  const accountPlanLabel = tx(isAdmin ? 'settings.planAdmin' : isTeam ? 'settings.planTeam' : isPro ? 'settings.planPro' : 'settings.planFree')
  const mailReady = outgoingConfigured && incomingConfigured
  const settingsSections = [
    { id: 'settings-appearance-section', label: tx('settings.appearance'), icon: Palette },
    { id: 'settings-ai-section', label: tx('settings.ai.title'), icon: KeyRound },
    { id: 'settings-mail-section', label: tx('settings.emailConfiguration'), icon: Mail },
    { id: 'settings-security-section', label: tx('settings.security'), icon: Shield },
    { id: 'settings-usage-section', label: tx('settings.usageAndLimits'), icon: HardDrive },
    { id: 'settings-data-section', label: tx('settings.dataManagement'), icon: Database },
  ] as const

  const startSettingsSectionScroll = useCallback((id: SettingsSectionId) => {
    const target = document.getElementById(id)
    const scrollRoot = document.querySelector<HTMLElement>('.settings-screen')
    if (!target || !scrollRoot) return false

    const sequence = settingsScrollSequenceRef.current + 1
    settingsScrollSequenceRef.current = sequence
    pendingSettingsScrollRef.current = id
    if (settingsScrollReleaseTimerRef.current !== null) {
      window.clearTimeout(settingsScrollReleaseTimerRef.current)
      settingsScrollReleaseTimerRef.current = null
    }

    setActiveSettingsSection(id)
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const elementScrolls = scrollRoot.scrollHeight > scrollRoot.clientHeight + 1
    const scrollTarget: HTMLElement | Window = elementScrolls ? scrollRoot : window
    const getTargetTop = () => {
      const rootRect = scrollRoot.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const scrollMargin = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0
      const currentScrollTop = elementScrolls ? scrollRoot.scrollTop : window.scrollY
      const maxScroll = elementScrolls
        ? Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
        : Math.max(
          0,
          Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight,
        )
      return Math.max(
        0,
        Math.min(
          maxScroll,
          currentScrollTop + targetRect.top - (elementScrolls ? rootRect.top : 0) - scrollMargin,
        ),
      )
    }
    const currentScrollTop = elementScrolls ? scrollRoot.scrollTop : window.scrollY
    const targetTop = getTargetTop()

    let settled = false
    const alignTarget = () => {
      const settledTargetTop = getTargetTop()
      if (elementScrolls) {
        scrollRoot.scrollTop = settledTargetTop
      } else {
        window.scrollTo({ top: settledTargetTop, behavior: 'auto' })
      }
    }
    const finish = () => {
      if (settled || settingsScrollSequenceRef.current !== sequence) return
      settled = true
      scrollTarget.removeEventListener('scrollend', finish)
      if (settingsScrollReleaseTimerRef.current !== null) {
        window.clearTimeout(settingsScrollReleaseTimerRef.current)
        settingsScrollReleaseTimerRef.current = null
      }
      // Correct any final sub-pixel/sticky-header shortfall before allowing the
      // scroll spy to take control again. Re-read the target because staged
      // settings groups can change the document height during the animation.
      alignTarget()
      settingsScrollReleaseTimerRef.current = window.setTimeout(() => {
        if (settingsScrollSequenceRef.current !== sequence) return
        // One last layout-aware correction catches progressively mounted groups
        // without making the user wait for every lazy section before tapping.
        alignTarget()
        pendingSettingsScrollRef.current = null
        settingsScrollReleaseTimerRef.current = null
      }, reduceMotion ? 0 : 320)
    }

    const alreadyAligned = Math.abs(currentScrollTop - targetTop) < 2
    if (reduceMotion || alreadyAligned) {
      // Direct assignment stays instant even though the Settings surface has
      // `scroll-behavior: smooth` in CSS.
      if (elementScrolls) {
        scrollRoot.scrollTop = targetTop
      } else {
        window.scrollTo({ top: targetTop, behavior: 'auto' })
      }
      window.requestAnimationFrame(finish)
      return true
    }

    scrollTarget.addEventListener('scrollend', finish, { once: true })
    if (elementScrolls) {
      scrollRoot.scrollTo({ top: targetTop, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: targetTop, behavior: 'smooth' })
    }
    // `scrollend` is not universal and may not fire when a browser interrupts
    // smooth scrolling, so always keep a bounded fallback.
    settingsScrollReleaseTimerRef.current = window.setTimeout(finish, 720)
    return true
  }, [])

  const scrollToSettingsSection = useCallback((id: SettingsSectionId) => {
    setActiveSettingsSection(id)
    pendingSettingsScrollRef.current = id
    if (startSettingsSectionScroll(id)) return

    // Navigation is immediately interactive while lower settings groups mount
    // progressively. Reveal the requested target now; the effect below scrolls
    // once React has committed it.
    setSettingsRevealStep(3)
  }, [startSettingsSectionScroll])

  useEffect(() => {
    const pendingSection = pendingSettingsScrollRef.current
    if (!pendingSection || !document.getElementById(pendingSection)) return undefined
    const frame = window.requestAnimationFrame(() => {
      startSettingsSectionScroll(pendingSection)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [settingsRevealStep, startSettingsSectionScroll])

  return (
    <section className="simple-screen settings-screen">
      <header className="settings-hero">
        <div className="settings-hero-title-row">
          <button
            type="button"
            className="settings-hero-avatar-button"
            aria-label={tx('settings.avatarOpen')}
            title={tx('settings.avatarOpen')}
            onClick={() => setAvatarDialogOpen(true)}
          >
            <UserAvatar
              avatarUrl={session.user.settings.avatarDataUrl}
              name={session.user.name}
              email={session.user.email}
              className="settings-hero-mark"
            />
            <span className="settings-hero-avatar-edit" aria-hidden="true">
              <Camera size={11} />
            </span>
          </button>
          <div className="settings-hero-info">
            <span className="eyebrow">{tx('settings.eyebrow')}</span>
            <h2>{tx('settings.title')}</h2>
            <p className="muted">{tx('settings.subtitle')}</p>
          </div>
        </div>
        <div className="settings-hero-status" aria-label={tx('settings.title')}>
          <span className="settings-status-chip">
            <Shield size={13} aria-hidden="true" />
            {accountPlanLabel}
          </span>
          <span className={`settings-status-chip ${mailReady ? 'is-ready' : 'needs-attention'}`}>
            <Mail size={13} aria-hidden="true" />
            {mailReady ? tx('settings.mailConfigured') : tx('settings.mailNeedsSetup')}
          </span>
        </div>
        {onOpenNotifications ? (
          <button
            type="button"
            className="settings-mobile-notification-action"
            aria-label={tx('settings.notifications')}
            title={tx('settings.notifications')}
            onClick={onOpenNotifications}
          >
            <BellRing size={17} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="settings-layout">
        <aside className="settings-index">
          <nav ref={settingsIndexNavRef} className="settings-index-nav" aria-label={tx('settings.title')}>
            <span className="settings-index-eyebrow">{tx('settings.eyebrow')}</span>
            {settingsSections.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  data-settings-section={item.id}
                  className={activeSettingsSection === item.id ? 'active' : ''}
                  aria-current={activeSettingsSection === item.id ? 'location' : undefined}
                  onClick={() => scrollToSettingsSection(item.id)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="settings-index-account">
            <UserAvatar
              avatarUrl={session.user.settings.avatarDataUrl}
              name={session.user.name}
              email={session.user.email}
              className="settings-index-avatar"
            />
            <span>
              <strong>{session.user.name}</strong>
              <em>{session.user.email}</em>
            </span>
            <small>{accountPlanLabel}</small>
          </div>
        </aside>

        <div className="settings-lines settings-body">
        {/* ── Preferences: language, content languages, theme ── */}
        <section id="settings-appearance-section" className="settings-block settings-block-prefs" aria-labelledby="settings-appearance-heading">
          <div className="section-title settings-section-title">
            <h4 id="settings-appearance-heading">
              <Palette size={13} aria-hidden="true" />
              {tx('settings.appearance')}
            </h4>
          </div>

          {onToggleTheme ? (
            <div className="settings-mobile-utility-actions" aria-label={tx('settings.title')}>
              <div className="setting-row settings-mobile-theme-row">
                <span>{tx('settings.darkMode')}</span>
                <SwitchControl
                  checked={theme === 'dark'}
                  label={tx('settings.darkMode')}
                  onChange={onToggleTheme}
                />
              </div>
            </div>
          ) : null}

          <div className="settings-group-card">
            <div className="settings-prefs-layout">
              <div className="settings-prefs-col">
                <div className="setting-row">
                  <span>{tx('settings.language')}</span>
                  <div className="setting-control">
                    <Languages size={15} aria-hidden="true" />
                    <Select
                      value={lang}
                      options={languages}
                      onChange={onLanguage}
                      ariaLabel={tx('settings.language')}
                      size="small"
                      searchable
                    />
                  </div>
                </div>

                <div className="setting-row stacked content-language-row">
                  <div className="content-language-copy">
                    <strong className="settings-inline-title">{tx('settings.contentLanguagesTitle')}</strong>
                    <em className="settings-inline-hint">{tx('settings.contentLanguagesDesc')}</em>
                  </div>
                  <div className="content-language-pair">
                    {(() => {
                      const savePair = (nextPrimary: string, nextSecondary: string, which: 'primary' | 'secondary') => {
                        let primary = nextPrimary
                        let secondary = nextSecondary
                        // Choosing the same language as the other slot swaps the pair
                        // (e.g. first=en, second=zh → set first to zh → first=zh, second=en).
                        if (primary === secondary) {
                          if (which === 'primary') {
                            primary = nextPrimary
                            secondary = contentLangPair.primary
                          } else {
                            secondary = nextSecondary
                            primary = contentLangPair.secondary
                          }
                        }
                        // Hard fallback if both still collapse (should not happen with a real swap).
                        if (primary === secondary) {
                          secondary = languages.find((option) => option.value !== primary)?.value ?? (primary === 'en' ? 'zh' : 'en')
                        }
                        const nextPair = { primary, secondary }
                        // Optimistic UI so the dropdown reflects the choice immediately.
                        setContentLangPair(nextPair)
                        // Load the target packs first — otherwise remapBuiltInProfilePresets falls
                        // back to English when the content language is e.g. Japanese.
                        void Promise.all([
                          preloadLanguage(primary, CONTENT_LANGUAGE_NAMESPACES),
                          preloadLanguage(secondary, CONTENT_LANGUAGE_NAMESPACES),
                        ]).then(() => {
                          const nextPresets = remapBuiltInProfilePresets(session.user.settings.profilePresets, nextPair)
                          onUpdateSettings?.(
                            {
                              contentLanguagePrimary: primary,
                              contentLanguageSecondary: secondary,
                              profilePresets: nextPresets,
                            },
                            tx('settings.contentLanguagesSaved'),
                          )
                        })
                      }
                      return (
                        <>
                          <div className="content-language-field">
                            <span className="content-language-label">{tx('settings.contentLanguagePrimary')}</span>
                            <Select
                              value={contentLangPair.primary}
                              options={languages}
                              onChange={(value) => savePair(value, contentLangPair.secondary, 'primary')}
                              ariaLabel={tx('settings.contentLanguagePrimary')}
                              size="small"
                              searchable
                            />
                          </div>
                          <div className="content-language-field">
                            <span className="content-language-label">{tx('settings.contentLanguageSecondary')}</span>
                            <Select
                              value={contentLangPair.secondary}
                              options={languages}
                              onChange={(value) => savePair(contentLangPair.primary, value, 'secondary')}
                              ariaLabel={tx('settings.contentLanguageSecondary')}
                              size="small"
                              searchable
                            />
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>

                <div className="setting-row">
                  <span>{tx('settings.highContrast')}</span>
                  <SwitchControl
                    checked={session.user.settings.highContrast}
                    label={tx('settings.highContrast')}
                    onChange={onHighContrast}
                  />
                </div>
              </div>

              <div className="settings-prefs-col settings-prefs-visual">
                {onAccentColor ? (
                  <div className="setting-row stacked">
                    <span>{tx('settings.accentColor')}</span>
                    <div className="accent-picker-cards">
                      {Object.entries(THEME_PRESETS).map(([color, preset]) => (
                        <button
                          key={color}
                          type="button"
                          className={`accent-card ${selectedAccent === color ? 'active' : ''}`}
                          aria-pressed={selectedAccent === color}
                          onClick={() => {
                            setSelectedAccent(color)
                            onAccentColor(color)
                          }}
                        >
                          <span className="accent-card-swatch" style={{ background: preset.accent }} />
                          <span className="accent-card-label">{tx(`themeAccentNames.${color.slice(1)}`, preset.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {onUpdateSettings ? (
                  <div className="setting-row settings-profile-preset-reset">
                    <span>
                      <strong>{tx('settings.profilePresetsTitle')}</strong>
                      <em>{tx('settings.profilePresetsDesc')}</em>
                    </span>
                    <InlineConfirm
                      className="settings-inline-restore"
                      open={confirmRestoreProfilePresets}
                      confirmLabel={tx('settings.profilePresetsRestore')}
                      idleClassName="quiet-action settings-inline-restore-idle"
                      idleAriaLabel={tx('settings.profilePresetsRestore')}
                      onOpen={() => setConfirmRestoreProfilePresets(true)}
                      onCancel={() => setConfirmRestoreProfilePresets(false)}
                      onConfirm={() => {
                        onUpdateSettings?.(
                          { profilePresets: defaultProfilePresets(contentLanguagesFromSettings(session.user.settings)) },
                          tx('settings.profilePresetsRestored'),
                        )
                        setConfirmRestoreProfilePresets(false)
                      }}
                    >
                      <RefreshCw size={13} aria-hidden="true" />
                      {tx('settings.profilePresetsRestore')}
                    </InlineConfirm>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* ── Device experience: install, push, tutorial ── */}
        {showDeviceGrid ? (
          <div className="settings-device-grid">
            {installStatus && installStatus !== 'installed' ? (
              <div className={`settings-install-card is-${installStatus}`}>
                <div className="settings-install-icon" aria-hidden="true">
                  <MonitorDown size={20} />
                </div>
                <div className="settings-install-copy">
                  <span className="settings-install-eyebrow">{tx('settings.installAppEyebrow')}</span>
                  <strong>{tx('settings.installAppTitle')}</strong>
                  <p>{installDescription}</p>
                  <div className="settings-install-benefits" aria-label={tx('settings.installAppBenefits')}>
                    <span>{tx('settings.installAppBenefitWindow')}</span>
                    <span>{tx('settings.installAppBenefitOffline')}</span>
                    <span>{tx('settings.installAppBenefitQuick')}</span>
                  </div>
                  <div className={`settings-install-details${offlineScopeOpen ? ' open' : ''}`}>
                    <button
                      type="button"
                      className="settings-install-details-toggle"
                      aria-expanded={offlineScopeOpen}
                      aria-controls="settings-install-offline-scope"
                      onClick={() => setOfflineScopeOpen((open) => !open)}
                    >
                      <span>{tx('settings.installAppOfflineScopeLabel')}</span>
                      <ChevronDown size={12} aria-hidden="true" />
                    </button>
                    <CollapsiblePanel
                      open={offlineScopeOpen}
                      id="settings-install-offline-scope"
                      className="settings-install-scope-collapse"
                      innerClassName="settings-install-scope-inner"
                      openMs={380}
                      closeMs={320}
                      keepMounted
                    >
                      <p className="settings-install-scope">{tx('settings.installAppOfflineScope')}</p>
                    </CollapsiblePanel>
                  </div>
                </div>
                <div className="settings-install-side">
                  <span className={`settings-install-status is-${installStatus}`}>{installStatusLabel}</span>
                  {onInstallApp && (installStatus === 'available' || installStatus === 'installing') ? (
                    <button
                      type="button"
                      className="primary-action settings-install-action"
                      disabled={installStatus === 'installing'}
                      onClick={() => void onInstallApp()}
                    >
                      {installStatus === 'installing'
                        ? <LoaderCircle className="spin-icon" size={15} aria-hidden="true" />
                        : <Download size={15} aria-hidden="true" />}
                      {installStatus === 'installing'
                        ? tx('settings.installAppInstalling')
                        : tx('settings.installAppAction')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {webPushStatus ? (
              <section
                className={`settings-install-card settings-push-card is-${webPushStatusTone}${webPushBusy ? ' is-busy' : ''}`}
                aria-label={tx('settings.pushTitle')}
                aria-busy={webPushBusy || undefined}
              >
                <div className="settings-install-icon" aria-hidden="true">
                  {webPushEnabling || webPushDisabling
                    ? <LoaderCircle className="spin-icon" size={20} />
                    : webPushStatus === 'enabled'
                      ? <CheckCircle2 size={20} />
                      : <BellRing size={20} />}
                </div>
                <div className="settings-install-copy">
                  <span className="settings-install-eyebrow">{tx('settings.pushEyebrow')}</span>
                  <strong>{webPushTitle}</strong>
                  <p>{webPushDescription}</p>
                  <div className="settings-install-benefits" aria-label={tx('settings.pushChannels')}>
                    <span>{tx('settings.pushChannelEmail')}</span>
                    <span>{tx('settings.pushChannelMessages')}</span>
                    <span>{tx('settings.pushChannelReminders')}</span>
                  </div>
                </div>
                <div className="settings-install-side">
                  <span className={`settings-install-status is-${webPushStatusTone}`}>{webPushStatusLabel}</span>
                  {(webPushStatus === 'enabled' || webPushDisabling) && onTestWebPush ? (
                    <button
                      type="button"
                      className="secondary-action settings-install-action"
                      disabled={webPushBusy || webPushTestState === 'sending'}
                      onClick={() => void sendWebPushTest()}
                    >
                      {webPushTestState === 'sending'
                        ? <LoaderCircle className="spin-icon" size={15} aria-hidden="true" />
                        : <Send size={15} aria-hidden="true" />}
                      {webPushTestState === 'sending' ? tx('settings.pushTestSending') : tx('settings.pushTestAction')}
                    </button>
                  ) : null}
                  {(webPushStatus === 'enabled' || webPushDisabling) && onDisableWebPush ? (
                    <button
                      type="button"
                      className={`secondary-action settings-install-action${webPushDisabling ? ' is-loading' : ''}`}
                      disabled={webPushBusy}
                      aria-busy={webPushDisabling || undefined}
                      onClick={() => void runDisableWebPush()}
                    >
                      {webPushDisabling
                        ? <LoaderCircle className="spin-icon" size={15} aria-hidden="true" />
                        : null}
                      {webPushDisabling ? tx('settings.pushDisablingAction') : tx('settings.pushDisableAction')}
                    </button>
                  ) : null}
                  {webPushStatus !== 'enabled'
                    && webPushStatus !== 'denied'
                    && webPushStatus !== 'unsupported'
                    && webPushStatus !== 'disabling'
                    && !webPushDisabling
                    && onEnableWebPush ? (
                    <button
                      type="button"
                      className={`primary-action settings-install-action${webPushEnabling ? ' loading is-loading' : ''}`}
                      disabled={webPushBusy}
                      aria-busy={webPushEnabling || undefined}
                      onClick={() => void runEnableWebPush()}
                    >
                      {webPushEnabling
                        ? <LoaderCircle className="spin-icon" size={15} aria-hidden="true" />
                        : <BellRing size={15} aria-hidden="true" />}
                      {webPushEnabling ? tx('settings.pushEnablingAction') : tx('settings.pushEnableAction')}
                    </button>
                  ) : null}
                  {webPushTestFeedback ? (
                    <span className={`settings-push-test-feedback is-${webPushTestState}`} role="status" aria-live="polite">
                      {webPushTestFeedback}
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {onReplayTutorial ? (
              <div className="settings-tutorial-card">
                <div className="settings-tutorial-icon" aria-hidden="true">
                  <CheckCircle2 size={16} />
                </div>
                <div className="settings-tutorial-copy">
                  <span className="settings-tutorial-eyebrow">{tx('settings.replayTutorial', 'Tutorial')}</span>
                  <strong>{tx('settings.tutorialTitle', 'Explore the complete workflow')}</strong>
                  <p>{tx('settings.tutorialDesc', 'Practice applications, your personal AI profile, mailbox setup, and AI-assisted writing.')}</p>
                  <div className="settings-tutorial-tags" aria-label={tx('settings.tutorialCoverage', 'Tutorial coverage')}>
                    <span>{tx('settings.tutorialCoverageWorkspace', 'Applications')}</span>
                    <span>{tx('settings.tutorialCoverageProfile', 'Profile')}</span>
                    <span>{tx('settings.tutorialCoverageMail', 'Mailbox')}</span>
                    <span>{tx('settings.tutorialCoverageAi', 'AI')}</span>
                  </div>
                </div>
                <button type="button" className="secondary-action settings-tutorial-action" onClick={onReplayTutorial}>
                  <RefreshCw size={15} aria-hidden="true" />
                  {tx('settings.replayTutorialAction', 'Replay Tutorial')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {settingsRevealStep >= 1 ? <div id="settings-ai-section" className="settings-block settings-ai-block"><AiKeyManager
          keys={aiKeys}
          scope="personal"
          copyPrefix="settings"
          onCreate={onCreateAiKey}
          onUpdate={onUpdateAiKey}
          onDelete={onDeleteAiKey}
          onTest={onTestAiKey}
          onResetUsage={onResetAiKeyUsage}
          onNotify={onNotify}
        /></div> : null}

        {settingsRevealStep >= 1 ? <div id="settings-mail-section" className="settings-progressive-group settings-block settings-block-mail">
        <div className="section-title settings-section-title">
          <h4>
            <Mail size={13} aria-hidden="true" />
            {tx('settings.emailConfiguration')}
          </h4>
        </div>

        <div className="mail-config-grid">
          <MailConfigCard
            dataTour="mail-outgoing-summary"
            ariaLabel={tx('settings.outgoingConfiguration')}
            className="mail-config-card-outgoing"
            iconClassName="outgoing"
            icon={<Send size={15} />}
            eyebrow="SMTP"
            title={tx('settings.outgoingConfiguration')}
            summary={
              outgoingConfigured
                ? `${sendFrom.trim().toLowerCase()} · ${smtpHost.trim()}:${smtpPort || 587}`
                : tx('settings.mailNotConfigured')
            }
            chipClassName={outgoingConfigured ? 'ok' : 'warning'}
            chipLabel={outgoingConfigured ? tx('settings.mailConfigured') : tx('settings.mailNeedsSetup')}
          >
                <p className="mail-config-desc">{tx('settings.outgoingConfigurationDesc')}</p>
                <div className="mail-config-fields">
                  <label data-tour="mail-sender-field">
                    <span>{tx('settings.sendFrom')}</span>
                    <input
                      className={sendFromValid ? '' : 'invalid'}
                      value={sendFrom}
                      onChange={(event) => setSendFrom(event.target.value)}
                      aria-invalid={!sendFromValid}
                    />
                  </label>
                  <label>
                    <span>{tx('settings.smtpHost')}</span>
                    <input value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="smtp.example.com" />
                  </label>
                  <label>
                    <span>{tx('settings.smtpPort')}</span>
                    <input
                      className={smtpPortValid ? '' : 'invalid'}
                      type="number"
                      min={1}
                      max={65535}
                      value={smtpPort}
                      onChange={(event) => setSmtpPort(event.target.value)}
                      aria-invalid={!smtpPortValid}
                    />
                  </label>
                  <label>
                    <span>{tx('settings.smtpUser')}</span>
                    <input value={smtpUser} onChange={(event) => setSmtpUser(event.target.value)} placeholder={sendFrom} />
                  </label>
                  <label className="mail-field-full">
                    <span>{tx('settings.smtpPass')}</span>
                    <div className="setting-inline-edit">
                      <input
                        type="password"
                        value={smtpPass}
                        onChange={(event) => setSmtpPass(event.target.value)}
                        placeholder={session.user.settings.smtpPassSet ? tx('settings.passwordSavedPlaceholder') : ''}
                      />
                      {session.user.settings.smtpPassSet && !smtpPass ? (
                        <button type="button" className="icon-action" onClick={clearOutgoingMailPass} title={tx('settings.removePassword')} aria-label={tx('settings.removePassword')}>
                          <X size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </label>
                </div>
                {!sendFromValid ? <em className="settings-inline-error">{tx('settings.emailInvalid')}</em> : null}
                {!smtpPortValid ? <em className="settings-inline-error">{tx('settings.portInvalid')}</em> : null}
                <div className="mail-config-actions">
                  <div className="settings-switch-label">
                    <span>{tx('settings.smtpTls')}</span>
                    <SwitchControl checked={smtpTls} label={tx('settings.smtpTls')} onChange={setSmtpTls} />
                  </div>
                  <div className="mail-config-button-row">
                    <button type="button" className="quiet-action compact-action mail-save-btn" onClick={saveOutgoingMail} disabled={!sendFromValid || !smtpPortValid}>
                      <Send size={12} aria-hidden="true" /> {tx('settings.saveOutgoingMail')}
                    </button>
                    {onTestEmail ? (
                      <InlineTestEmailAction
                        defaultEmail={primaryReceiveEmail?.address ?? session.user.email}
                        disabled={!outgoingConfigured}
                        openLabel={tx('settings.sendTestEmail')}
                        inputLabel={tx('settings.testEmailRecipient')}
                        inputPlaceholder={tx('settings.testEmailRecipientPlaceholder')}
                        sendLabel={tx('settings.sendTestNow')}
                        cancelLabel={tx('settings.cancelTestEmail')}
                        sendingLabel={tx('settings.sendingTestEmail')}
                        invalidEmailLabel={tx('settings.emailInvalid')}
                        onSend={testOutgoingMail}
                      />
                    ) : null}
                  </div>
                </div>
          </MailConfigCard>

          <MailConfigCard
            ariaLabel={tx('settings.incomingConfiguration')}
            className="mail-config-card-incoming"
            iconClassName="incoming"
            icon={<Mail size={15} />}
            eyebrow={tx('settings.incomingProtocol')}
            title={tx('settings.incomingConfiguration')}
            summary={
              incomingConfigured
                ? `${incomingProtocol.toUpperCase()} · ${incomingHost.trim()}:${incomingPort || (incomingProtocol === 'imap' ? 993 : 995)}`
                : tx('settings.mailNotConfigured')
            }
            chipClassName={incomingConfigured ? 'ok' : 'warning'}
            chipLabel={incomingConfigured ? tx('settings.mailConfigured') : tx('settings.mailNeedsSetup')}
          >
                <p className="mail-config-desc">{tx('settings.incomingConfigurationDesc')}</p>
                <div className="mail-incoming-layout">
                  <div className="mail-incoming-connection">
                    <div className="mail-config-fields mail-incoming-fields">
                      <label className="mail-incoming-protocol">
                        <span>{tx('settings.incomingProtocol')}</span>
                        <Select
                          size="small"
                          value={incomingProtocol}
                          ariaLabel={tx('settings.incomingProtocol')}
                          options={[
                            { value: 'imap', label: tx('settings.protocolImap') },
                            { value: 'pop3', label: tx('settings.protocolPop3') },
                          ]}
                          onChange={(value) => {
                            setIncomingProtocol(value)
                            setIncomingPort(value === 'imap' ? '993' : '995')
                          }}
                        />
                      </label>
                      <label className="mail-incoming-host">
                        <span>{tx('settings.incomingHost')}</span>
                        <input value={incomingHost} onChange={(event) => setIncomingHost(event.target.value)} placeholder={incomingProtocol === 'imap' ? 'imap.example.com' : 'pop.example.com'} />
                      </label>
                      <label className="mail-incoming-port">
                        <span>{tx('settings.incomingPort')}</span>
                        <input
                          className={incomingPortValid ? '' : 'invalid'}
                          type="number"
                          min={1}
                          max={65535}
                          value={incomingPort}
                          onChange={(event) => setIncomingPort(event.target.value)}
                          aria-invalid={!incomingPortValid}
                        />
                      </label>
                      <label>
                        <span>{tx('settings.incomingUser')}</span>
                        <input value={incomingUser} onChange={(event) => setIncomingUser(event.target.value)} placeholder={session.user.email} />
                      </label>
                      <label>
                        <span>{tx('settings.incomingPass')}</span>
                        <div className="setting-inline-edit">
                          <input
                            type="password"
                            value={incomingPass}
                            onChange={(event) => setIncomingPass(event.target.value)}
                            placeholder={session.user.settings.incomingPassSet ? tx('settings.passwordSavedPlaceholder') : ''}
                          />
                          {session.user.settings.incomingPassSet && !incomingPass ? (
                            <button type="button" className="icon-action" onClick={clearIncomingMailPass} title={tx('settings.removePassword')} aria-label={tx('settings.removePassword')}>
                              <X size={13} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </label>
                    </div>
                    {!incomingPortValid ? <em className="settings-inline-error">{tx('settings.portInvalid')}</em> : null}
                  </div>

                  <div className="mail-sync-panel">
                    <div className="setting-row mail-autofetch-row">
                      <div>
                        <span>{tx('settings.autoFetchMail')}</span>
                        <p className="muted settings-help">{tx('settings.autoFetchMailDesc')}</p>
                      </div>
                      <SwitchControl
                        checked={autoFetchMailEnabled}
                        label={tx('settings.autoFetchMail')}
                        disabled={!imapSyncReady && !autoFetchMailEnabled}
                        title={!imapSyncReady ? mailSyncDisabledTitle : undefined}
                        onChange={updateAutoFetchMail}
                      />
                    </div>
                    <CollapsiblePanel
                      open={incomingProtocol !== 'imap'}
                      keepMounted
                      openMs={300}
                      closeMs={260}
                      className="mail-protocol-note-collapse"
                      innerClassName="mail-protocol-note-collapse-inner"
                    >
                      <div className="mail-protocol-note" role="note">
                        <AlertTriangle size={14} aria-hidden="true" />
                        <span>{tx('settings.imapSyncRequired')}</span>
                      </div>
                    </CollapsiblePanel>
                    <div className="mail-sync-scope-note" role="note">
                      <Shield size={15} aria-hidden="true" />
                      <div>
                        <strong>{tx('settings.mailSyncScopeTitle')}</strong>
                        <p>
                          {trackedAddressCount > 0
                            ? format(tx('settings.mailSyncScopeDesc'), { count: trackedAddressCount })
                            : tx('settings.mailSyncScopeEmpty')}
                        </p>
                      </div>
                    </div>
                    <div className="mail-sync-status-list" aria-live="polite">
                      {effectiveMailSyncAction ? (
                        <p className="muted settings-help mail-fetch-status">
                          <RefreshCw size={13} className="spin-icon" aria-hidden="true" />
                          <span>{tx('settings.mailSyncBackgroundActive')}</span>
                        </p>
                      ) : null}
                      <p className="muted settings-help mail-fetch-status">
                        <Clock3 size={13} aria-hidden="true" />
                        <span>{mailFetchStatusText}</span>
                      </p>
                      <p className="muted settings-help mail-history-status">
                        <History size={13} aria-hidden="true" />
                        <span>{mailHistoryStatusText}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mail-config-actions">
                  <div className="settings-switch-label">
                    <span>{tx('settings.incomingTls')}</span>
                    <SwitchControl checked={incomingTls} label={tx('settings.incomingTls')} onChange={setIncomingTls} />
                  </div>
                  <div className="mail-config-button-row">
                    <button type="button" className="quiet-action compact-action mail-save-btn" onClick={saveIncomingMail} disabled={!incomingPortValid}>
                      <Mail size={12} aria-hidden="true" /> {tx('settings.saveIncomingMail')}
                    </button>
                    {onTestIncomingMail ? (
                      <button
                        type="button"
                        className={`quiet-action compact-action test-action${incomingMailTesting ? ' is-testing' : ''}`}
                        onClick={() => void testIncomingMail()}
                        disabled={!incomingConfigured || incomingMailTesting || Boolean(effectiveMailSyncAction)}
                        title={!incomingConfigured ? tx('settings.mailNeedsSetup') : undefined}
                        aria-busy={incomingMailTesting}
                      >
                        <span className="mail-test-action-stage" aria-live="polite">
                          <InlinePresence
                            present={!incomingMailTesting}
                            className="mail-test-action-presence mail-test-action-idle"
                            innerClassName="mail-test-action-content"
                            durationMs={280}
                          >
                            <RefreshCw size={12} aria-hidden="true" />
                            <span>{tx('settings.testIncomingMail')}</span>
                          </InlinePresence>
                          <InlinePresence
                            present={incomingMailTesting}
                            className="mail-test-action-presence mail-test-action-pending"
                            innerClassName="mail-test-action-content"
                            durationMs={280}
                          >
                            <LoaderCircle size={12} className="spin-icon" aria-hidden="true" />
                            <span>{tx('settings.testingIncomingMail')}</span>
                          </InlinePresence>
                        </span>
                      </button>
                    ) : null}
                    {onFetchMailNow ? (
                      <button
                        type="button"
                        className="quiet-action compact-action mail-sync-action mail-sync-action-start"
                        onClick={() => void runMailSync('new')}
                        disabled={!canSyncTrackedMail || incomingMailTesting || Boolean(effectiveMailSyncAction)}
                        title={mailSyncDisabledTitle}
                        aria-busy={effectiveMailSyncAction === 'new'}
                      >
                        {effectiveMailSyncAction === 'new'
                          ? <RefreshCw size={12} className="spin-icon" aria-hidden="true" />
                          : <Download size={12} aria-hidden="true" />}
                        <span>{effectiveMailSyncAction === 'new' ? tx('settings.syncingNewMail') : tx('settings.fetchMailNow')}</span>
                      </button>
                    ) : null}
                    {onSyncMailHistory ? (
                      <button
                        type="button"
                        className="quiet-action compact-action mail-history-btn mail-sync-action"
                        onClick={() => void runMailSync('history')}
                        disabled={!canSyncTrackedMail || incomingMailTesting || Boolean(effectiveMailSyncAction)}
                        title={mailSyncDisabledTitle ?? tx('settings.syncMailHistoryHint')}
                        aria-busy={effectiveMailSyncAction === 'history'}
                      >
                        {effectiveMailSyncAction === 'history'
                          ? <RefreshCw size={12} className="spin-icon" aria-hidden="true" />
                          : <History size={12} aria-hidden="true" />}
                        <span>{effectiveMailSyncAction === 'history' ? tx('settings.syncingMailHistory') : tx('settings.syncMailHistory')}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
          </MailConfigCard>

          <MailConfigCard
            ariaLabel={tx('settings.receiveEmails')}
            className="mail-config-card-mailbox"
            iconClassName="mailbox"
            icon={<CheckCircle2 size={15} />}
            eyebrow={tx('settings.testDelivery')}
            title={tx('settings.receiveEmails')}
            summary={primaryReceiveEmail?.address ?? session.user.email}
            chipClassName={verifiedEmailCount > 0 ? 'ok' : 'warning'}
            chipLabel={format(tx('settings.verifiedMailboxCount'), { count: verifiedEmailCount, total: receiveEmails.length })}
          >
                <div className="settings-row-head mailbox-row-head">
                  <p className="mail-config-desc">{tx('settings.receiveEmailsDesc')}</p>
                  <button
                    type="button"
                    className="quiet-action compact-action"
                    onClick={() => setShowAddEmail((open) => !open)}
                    disabled={receiveEmails.length >= MAX_RECEIVE_EMAILS}
                    aria-expanded={showAddEmail}
                    aria-controls="receive-email-form"
                  >
                    <Plus size={13} aria-hidden="true" /> {tx('settings.addEmail')}
                  </button>
                </div>
                <div className="receive-email-list">
                  {receiveEmails.map((email, index) => {
                    const verified = email.verified ?? true
                    return (
                      <div
                        key={email.address}
                        className={`receive-email-row ${verified ? '' : 'pending'}${removingReceiveEmailAddress === email.address ? ' is-removing' : ''}`}
                      >
                        <div className="receive-email-main">
                          <strong>{email.address}</strong>
                          <div className="receive-email-meta">
                            <InlinePresence present={email.isPrimary} className="mailbox-primary-status" parentGap="6px">
                              <em className="mailbox-primary-badge">{tx('settings.primaryRecovery')}</em>
                            </InlinePresence>
                            {verified ? (
                              <em className="verified"><CheckCircle2 size={11} aria-hidden="true" /> {tx('settings.emailVerified')}</em>
                            ) : (
                              <em><Clock3 size={11} aria-hidden="true" /> {tx('settings.emailPendingVerification')}</em>
                            )}
                          </div>
                        </div>
                        <div className="receive-email-actions">
                          <div className="settings-switch-label">
                            <span>{tx('settings.notify')}</span>
                            <SwitchControl
                              checked={email.notify}
                              disabled={!verified}
                              label={tx('settings.notify')}
                              onChange={() => toggleNotify(index)}
                            />
                          </div>
                          {onTestEmail ? (
                            <AsyncActionButton
                              className="quiet-action compact-action test-action mail-test-btn"
                              disabled={!verified}
                              IdleIcon={Mail}
                              idleLabel={tx('settings.sendTestEmail')}
                              pendingLabel={tx('settings.sendingTestEmail')}
                              successLabel={tx('settings.testEmailSent')}
                              errorLabel={tx('settings.testEmailFailed')}
                              onAction={() => testReceivingMailbox(email.address)}
                            />
                          ) : null}
                          <InlinePresence present={!email.isPrimary} className="mailbox-primary-action-stage" parentGap="6px">
                            <button
                              type="button"
                              className="quiet-action compact-action mail-secondary-btn mailbox-primary-action"
                              onClick={() => setAsPrimary(index)}
                              disabled={!verified || email.isPrimary}
                            >
                              <span className="mail-action-label">{tx('settings.makePrimary')}</span>
                            </button>
                          </InlinePresence>
                          {!verified && onSendReceiveEmailVerification ? (
                            <VerificationResendAction
                              sentAt={email.verificationSentAt}
                              resendLabel={tx('settings.resendVerification')}
                              sendingLabel={tx('settings.sendingVerification')}
                              countdownLabel={(seconds) => format(tx('settings.resendVerificationIn'), { seconds })}
                              onResend={() => resendVerification(email)}
                            />
                          ) : null}
                          <InlineConfirm
                            className="receive-email-delete-confirm"
                            open={confirmRemoveEmailAddress === email.address}
                            confirmLabel={tx('confirm')}
                            cancelLabel={tx('cancel')}
                            confirmTone="danger"
                            disabled={receiveEmails.length <= 1 || removingReceiveEmailAddress !== null}
                            idleClassName="icon-action receive-email-remove danger"
                            idleAriaLabel={tx('settings.removeEmail')}
                            idleTitle={tx('settings.removeEmail')}
                            onOpen={() => setConfirmRemoveEmailAddress(email.address)}
                            onCancel={() => setConfirmRemoveEmailAddress(null)}
                            onConfirm={() => removeEmail(email.address)}
                          >
                            <X size={13} aria-hidden="true" />
                          </InlineConfirm>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <CollapsiblePanel
                  open={showAddEmail}
                  id="receive-email-form"
                  className="receive-email-form-collapse"
                >
                  <form
                    className="receive-email-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void addEmail()
                    }}
                  >
                    <input
                      type="email"
                      value={newEmail}
                      onBlur={() => setNewEmailTouched(true)}
                      onChange={(event) => setNewEmail(event.target.value)}
                      placeholder={tx('settings.addEmailPlaceholder')}
                      aria-invalid={newEmailTouched && !canAddEmail}
                    />
                    <button type="submit" className="quiet-action compact-action mail-save-btn" disabled={!canAddEmail || addEmailBusy || !onSendReceiveEmailVerification}>
                      {addEmailBusy ? <LoaderCircle size={12} className="spin-icon" aria-hidden="true" /> : <Send size={12} aria-hidden="true" />}
                      <span className="mail-action-label">{addEmailBusy ? tx('settings.sendingVerification') : tx('settings.sendVerification')}</span>
                    </button>
                    {newEmailTouched && !canAddEmail ? (
                      <em className="settings-inline-error">
                        {receiveEmails.length >= MAX_RECEIVE_EMAILS
                          ? format(tx('settings.emailLimit'), { count: MAX_RECEIVE_EMAILS })
                          : newEmailDuplicate
                            ? tx('settings.emailDuplicate')
                            : tx('settings.emailInvalid')}
                      </em>
                    ) : (
                      <em className="settings-inline-note">{tx('settings.verificationLinkQueued')}</em>
                    )}
                  </form>
                </CollapsiblePanel>
          </MailConfigCard>
        </div>
        </div> : null}

        {settingsRevealStep >= 2 ? <div id="settings-security-section" className="settings-progressive-group security-settings-group settings-block settings-block-security">
        <div className="section-title settings-section-title">
          <h4>
            <Shield size={13} aria-hidden="true" />
            {tx('settings.security')}
          </h4>
        </div>

        <div className="settings-security-grid">
        <section className={`mail-config-card mail-collapsible session-window-card ${sessionWindowOpen ? 'expanded' : ''}`} aria-label={tx('settings.loginSession')}>
          <button
            type="button"
            className="mail-config-summary session-window-summary"
            aria-expanded={sessionWindowOpen}
            aria-controls="session-settings-panel"
            onClick={() => setSessionWindowOpen((open) => !open)}
          >
            <span className="mail-config-icon session-window-badge" aria-hidden="true">
              <Clock3 size={15} />
            </span>
            <span className="mail-config-copy">
              <span className="eyebrow">{tx('settings.sessionMode')}</span>
              <strong>{tx('settings.slidingSession')}</strong>
              <small>{tx('settings.slidingSessionDesc')}</small>
            </span>
            <span className="mail-config-chips" aria-hidden="true">
              <span className="mail-summary-chip muted">{sessionDurationLabel}</span>
            </span>
            <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
          </button>
          <CollapsiblePanel
            open={sessionWindowOpen}
            keepMounted
            collapseMs={260}
            id="session-settings-panel"
            className="mail-config-detail session-window-detail"
            innerClassName="mail-config-detail-inner session-window-detail-inner"
          >
            <div className="session-window-controls">
              <span>{tx('settings.validFor')}</span>
              <Select
                size="small"
                value={sessionDuration}
                options={sessionDurationOptions.map((option) => ({
                  value: option.value,
                  label: tx(option.labelKey, option.fallback),
                }))}
                onChange={(value) => onUpdateSetting?.('sessionDurationMinutes', Number(value))}
                ariaLabel={tx('settings.validFor')}
              />
            </div>
          </CollapsiblePanel>
        </section>

        <section className={`mail-config-card mail-collapsible passkey-card ${passkeyOpen ? 'expanded' : ''}`} aria-label={tx('settings.passkeys')}>
          <button
            type="button"
            className="mail-config-summary passkey-summary"
            aria-expanded={passkeyOpen}
            aria-controls="passkey-settings-panel"
            onClick={() => setPasskeyOpen((open) => !open)}
          >
            <span className="mail-config-icon passkey-badge" aria-hidden="true">
              <Fingerprint size={15} />
            </span>
            <span className="mail-config-copy">
              <span className="eyebrow">{tx('settings.passkeyEyebrow')}</span>
              <strong>{tx('settings.passkeys')}</strong>
              <small>{passkeyAvailable ? tx('settings.passkeyDesc') : tx('settings.passkeyUnavailable')}</small>
            </span>
            <span className="mail-config-chips" aria-hidden="true">
              <span className={`passkey-count-chip ${passkeys.length > 0 ? 'ok' : 'muted'}`}>
                {format(tx('settings.passkeyCount'), { count: passkeys.length })}
              </span>
            </span>
            <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
          </button>

          <CollapsiblePanel
            open={passkeyOpen}
            keepMounted
            collapseMs={260}
            id="passkey-settings-panel"
            className="mail-config-detail passkey-detail"
            innerClassName="mail-config-detail-inner passkey-detail-inner"
          >
            <form className="passkey-add-bar" onSubmit={submitPasskey}>
              <KeyRound size={14} aria-hidden="true" />
              <input
                value={passkeyLabel}
                onChange={(event) => setPasskeyLabel(event.target.value)}
                placeholder={tx('settings.passkeyLabelPlaceholder')}
                maxLength={80}
                disabled={!passkeyAvailable || !onCreatePasskey}
              />
              <button
                type="submit"
                className="quiet-action passkey-add-submit"
                disabled={!passkeyAvailable || !onCreatePasskey}
              >
                <Fingerprint size={13} aria-hidden="true" />
                {tx('settings.addPasskey')}
              </button>
            </form>
            {!passkeyAvailable ? (
              <p className="settings-inline-note passkey-support-note">{tx('settings.passkeyUnavailable')}</p>
            ) : null}

            {passkeys.length > 0 ? (
              <ul className="passkey-list" aria-label={tx('settings.savedPasskeys')}>
                {passkeys.map((passkey) => {
                  const label = passkey.label || tx('settings.passkeyUnnamed')
                  const deviceLabel = passkey.deviceType === 'multiDevice'
                    ? tx('settings.passkeySynced')
                    : tx('settings.passkeyDeviceBound')
                  const isRemoving = Boolean(removingPasskeyIds?.has(passkey.id))
                  return (
                    <li key={passkey.id} className={`passkey-row${renamingPasskeyId === passkey.id ? ' is-renaming' : ''}${passkeyRenameClosingId === passkey.id ? ' is-rename-closing' : ''}${passkeyRenameSavingId === passkey.id ? ' is-rename-saving' : ''}${isRemoving ? ' is-removing' : ''}`} aria-busy={isRemoving || undefined}>
                      <span className="passkey-row-icon" aria-hidden="true">
                        <KeyRound size={14} />
                      </span>
                      <span className="passkey-row-copy">
                        {renamingPasskeyId === passkey.id ? (
                          <form className="passkey-rename-form" onSubmit={(event) => void submitPasskeyRename(event, passkey)}>
                            <input
                              autoFocus
                              value={passkeyRenameDraft}
                              onChange={(event) => setPasskeyRenameDraft(event.target.value)}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault()
                                  finishPasskeyRename(passkey.id)
                                }
                              }}
                              maxLength={80}
                              placeholder={tx('settings.passkeyRenamePlaceholder')}
                              aria-label={tx('settings.passkeyRenamePlaceholder')}
                              disabled={passkeyRenameSavingId === passkey.id}
                            />
                            <button
                              type="submit"
                              className="passkey-rename-action save"
                              aria-label={tx('settings.passkeyRenameSave')}
                              title={tx('settings.passkeyRenameSave')}
                              disabled={!passkeyRenameDraft.trim() || passkeyRenameSavingId === passkey.id}
                            >
                              {passkeyRenameSavingId === passkey.id
                                ? <LoaderCircle className="spin-icon" size={12} aria-hidden="true" />
                                : <Check size={12} aria-hidden="true" />}
                            </button>
                            <button
                              type="button"
                              className="passkey-rename-action cancel"
                              onClick={() => finishPasskeyRename(passkey.id)}
                              aria-label={tx('settings.passkeyRenameCancel')}
                              title={tx('settings.passkeyRenameCancel')}
                              disabled={passkeyRenameSavingId === passkey.id}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          </form>
                        ) : (
                          <strong
                            className="passkey-rename-label"
                            onDoubleClick={() => beginPasskeyRename(passkey)}
                            onKeyDown={(event) => {
                              if ((event.key === 'Enter' || event.key === 'F2') && onRenamePasskey) {
                                event.preventDefault()
                                beginPasskeyRename(passkey)
                              }
                            }}
                            tabIndex={onRenamePasskey ? 0 : undefined}
                            role={onRenamePasskey ? 'button' : undefined}
                            title={onRenamePasskey ? tx('settings.passkeyRenameHint') : undefined}
                          >{label}</strong>
                        )}
                        <em>
                          {format(tx('settings.passkeyCreated'), {
                            date: formatPasskeyTimestamp(passkey.createdAt, lang, tx),
                          })} · {format(tx('settings.passkeyLastUsed'), {
                            date: formatPasskeyTimestamp(passkey.lastUsedAt, lang, tx),
                          })}
                        </em>
                      </span>
                      <span className={`passkey-device-chip ${passkey.backedUp ? 'ok' : 'muted'}`}>
                        {deviceLabel}
                      </span>
                      <button
                        type="button"
                        className="icon-action passkey-delete-btn"
                        onClick={() => setConfirmDeletePasskey(passkey)}
                        aria-label={format(tx('settings.removePasskeyNamed'), { name: label })}
                        title={tx('settings.removePasskey')}
                        disabled={isRemoving}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="passkey-empty">
                <span className="empty-state-icon" aria-hidden="true"><Fingerprint size={16} /></span>
                <strong>{tx('settings.noPasskeys')}</strong>
                <span>{tx('settings.noPasskeysHint')}</span>
              </div>
            )}
          </CollapsiblePanel>
        </section>
        </div>

        <section id="settings-usage-section" className="settings-subsection">
        <div className="section-title settings-section-title">
          <h4>
            <HardDrive size={13} aria-hidden="true" />
            {tx('settings.usageAndLimits')}
          </h4>
        </div>

        <div className="settings-usage-layout">
        <section className="storage-usage-card" aria-label={tx('settings.storageUsage')}>
          <div className="storage-usage-head">
            <div>
              <span className="eyebrow">{tx('settings.storageUsage')}</span>
              <h4>
                {storageQuotaBytes
                  ? format(tx('settings.storageUsageValue'), {
                      used: formatBytes(storageUsedBytes),
                      limit: formatBytes(storageQuotaBytes),
                    })
                  : format(tx('settings.storageUsageUnlimited'), { used: formatBytes(storageUsedBytes) })}
              </h4>
              <p>{isPro ? tx('settings.storageUsageProHint') : tx('settings.storageUsageFreeHint')}</p>
            </div>
            <span className="storage-plan-chip">{tx(isAdmin ? 'settings.planAdmin' : isTeam ? 'settings.planTeam' : isPro ? 'settings.planPro' : 'settings.planFree')}</span>
          </div>
          {storageQuotaBytes ? (
            <div className="storage-usage-meter" aria-label={format(tx('settings.storageUsagePercent'), { percent: storagePercent })}>
              <span style={{ width: `${storagePercent}%` }} />
            </div>
          ) : (
            <div className="storage-usage-meter unlimited" aria-hidden="true">
              <span />
            </div>
          )}
          <div className="storage-usage-meta">
            <span>{format(tx('settings.applicationUsage'), {
              count: session.usage?.applicationCount ?? 0,
              limit: session.usage?.applicationQuota === Number.MAX_SAFE_INTEGER ? tx('settings.unlimited') : String(session.usage?.applicationQuota ?? 3),
            })}</span>
            <span>{format(tx('settings.shareUsage'), {
              active: activeShares.length,
              activeLimit: shareQuota >= Number.MAX_SAFE_INTEGER ? tx('settings.unlimited') : String(shareQuota),
              created: shareCreatedCount,
              createLimit: shareCreateQuota >= Number.MAX_SAFE_INTEGER ? tx('settings.unlimited') : String(shareCreateQuota),
            })}</span>
          </div>
        </section>

        <div className="settings-group-card settings-usage-options">
        {isPro ? (
          <div className="setting-row">
            <span>{tx('settings.trashRetention')}</span>
            <div className="setting-select-wrap">
              <Select
                size="small"
                value={trashRetentionValue}
                options={[
                  ...trashRetentionOptions.map((days) => ({
                    value: String(days),
                    label: format(tx('settings.trashRetentionDays'), { count: days }),
                  })),
                  ...(isAdmin ? [{ value: 'never', label: tx('settings.trashRetentionNever') }] : []),
                ]}
                onChange={(value) => onUpdateSetting?.('trashRetentionDays', value === 'never' ? null : Number(value))}
              />
            </div>
          </div>
        ) : null}

        <div className="setting-row">
          <span>{tx('settings.backupFrequency')}</span>
          <div className="setting-select-wrap">
            <Select
              size="small"
              value={backupFrequencyValue}
              options={backupFrequencyChoices.map((option) => {
                const locked = Boolean(option.proOnly && !isPro)
                return {
                  value: option.value,
                  label: tx(option.labelKey, option.fallback),
                  disabled: locked,
                  locked,
                  actionLabel: tx('settings.upgradeToPro'),
                  description: locked ? tx('settings.proOnly') : undefined,
                }
              })}
              onChange={(value) => {
                if (value === 'off') {
                  onUpdateSettings?.({ autoBackup: false })
                  return
                }
                onUpdateSettings?.({ autoBackup: true, backupFrequency: value })
              }}
              onLockedOptionClick={(option) => openUpgradePage('backup-frequency', option.value, tx('settings.backupOff'))}
              ariaLabel={tx('settings.backupFrequency')}
            />
          </div>
        </div>

        {showBackupLimit ? (
          <>
            <div className="setting-row">
              <span>{tx('settings.maxBackupsPerApp')}</span>
              <div className="setting-select-wrap">
                <Select
                  size="small"
                  value={maxBackups}
                  options={backupLimitTiers.map((value) => {
                    const lockedForPlan = !isPro
                    const lockedForAdmin = isPro && value > maxBackupsLimit
                    const locked = lockedForPlan || lockedForAdmin
                    return {
                      value: String(value),
                      label: String(value),
                      disabled: locked,
                      locked,
                      actionLabel: lockedForPlan ? tx('settings.upgradeToPro') : tx('settings.contactAdmin'),
                      description: lockedForPlan
                        ? tx('settings.proOnly')
                        : lockedForAdmin
                          ? tx('settings.contactAdminToUnlock')
                          : undefined,
                    }
                  })}
                  onChange={(value) => onUpdateSetting?.('maxBackupsPerApp', Number(value))}
                  onLockedOptionClick={(option) => {
                    if (!isPro) openUpgradePage('backup-retention', option.value)
                  }}
                />
              </div>
            </div>
            <p className="setting-row-hint">{format(tx('settings.backupLimitHint'), { limit: maxBackupsLimit })}</p>
          </>
        ) : null}

        <div className="setting-row settings-encryption-row">
          <span className="settings-label-with-info">
            <span>{tx('settings.encryption')}</span>
            <InfoTooltip
              content={encryptionAtRest ? tx('settings.encryptionOnDesc') : tx('settings.encryptionOffDesc')}
              label={encryptionAtRest ? tx('settings.encryptionOnDesc') : tx('settings.encryptionOffDesc')}
            />
          </span>
          <strong
            className={`settings-readonly-value settings-encryption-status${encryptionAtRest ? ' is-on' : ' is-off'}`}
          >
            <ShieldCheck size={13} aria-hidden="true" />
            {encryptionAtRest ? tx('settings.enabled') : tx('settings.disabled')}
            <span className="settings-encryption-algo-chip">{tx('settings.encryptionAlgo')}</span>
          </strong>
        </div>
        </div>
        </div>

        {onExport ? (
          <section className="settings-export-card" aria-labelledby="settings-export-heading">
            <div className="settings-export-head">
              <div className="settings-export-icon" aria-hidden="true">
                <Download size={18} />
              </div>
              <div className="settings-export-copy">
                <span className="settings-export-eyebrow">{tx('settings.exportEyebrow')}</span>
                <h4 id="settings-export-heading">{tx('settings.exportAll')}</h4>
                <p>{tx('settings.exportAllDesc')}</p>
              </div>
            </div>
            <div
              className="settings-export-formats"
              role="group"
              aria-label={tx('settings.exportFormats')}
            >
              {EXPORT_FORMATS.map(({ id, ext, Icon, labelKey, hintKey }) => (
                <button
                  key={id}
                  type="button"
                  className="settings-export-format"
                  onClick={() => onExport(id)}
                  aria-label={`${tx(labelKey)} (${ext})`}
                >
                  <span className="settings-export-format-top">
                    <span className="settings-export-format-icon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <Download size={13} className="settings-export-format-dl" aria-hidden="true" />
                  </span>
                  <span className="settings-export-format-ext">{ext}</span>
                  <strong>{tx(labelKey)}</strong>
                  <em>{tx(hintKey)}</em>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        </section>

        </div> : null}

        {settingsRevealStep >= 3 ? <div id="settings-data-section" className="settings-progressive-group settings-data-group settings-block settings-block-data">
        <section className="settings-share-panel" aria-label={tx('settings.sharedLinks')}>
          <header className="settings-share-panel-head">
            <div className="settings-share-panel-copy">
              <span className="settings-share-eyebrow">{tx('settings.sharePanelEyebrow', 'Link management')}</span>
              <h4>
                <Link size={14} aria-hidden="true" />
                {tx('settings.sharedLinks')}
              </h4>
              <p>{tx('settings.sharedLinksDesc')}</p>
            </div>
            <span className="settings-share-count-badge">
              {format(tx('settings.shareCountDetailed'), {
                active: activeShares.length,
                activeLimit: shareQuota >= Number.MAX_SAFE_INTEGER ? tx('settings.unlimited') : String(shareQuota),
                created: shareCreatedCount,
                createLimit: shareCreateQuota >= Number.MAX_SAFE_INTEGER ? tx('settings.unlimited') : String(shareCreateQuota),
              })}
            </span>
          </header>

          {activeShares.length === 0 ? (
            <div className="settings-share-empty">
              <span className="settings-share-empty-icon" aria-hidden="true">
                <Link size={18} />
              </span>
              <div>
                <strong>{tx('settings.noSharedLinks')}</strong>
                <span>{tx('settings.noSharedLinksHint')}</span>
              </div>
            </div>
          ) : (
            <div className="settings-share-body">
              <div className="settings-share-toolbar">
                <div className="settings-share-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    value={shareSearch}
                    onChange={(event) => setShareSearch(event.target.value)}
                    placeholder={tx('settings.shareSearchPlaceholder')}
                    aria-label={tx('settings.shareSearchPlaceholder')}
                  />
                  {shareSearch ? (
                    <button
                      type="button"
                      className="settings-share-search-clear"
                      onClick={() => setShareSearch('')}
                      aria-label={tx('settings.shareSearchClear', 'Clear search')}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <span className="settings-share-result-count">
                  {format(tx('settings.shareResultCount', '{shown} of {total}'), {
                    shown: visibleShares.length,
                    total: activeShares.length,
                  })}
                </span>
              </div>

              {visibleShares.length === 0 ? (
                <div className="settings-share-empty compact">
                  <span className="settings-share-empty-icon" aria-hidden="true">
                    <Search size={18} />
                  </span>
                  <div>
                    <strong>{tx('settings.noSharedLinkMatches')}</strong>
                    <span>{tx('settings.noSharedLinkMatchesHint')}</span>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="settings-share-table-wrap atlas-table-shell"
                    onContextMenu={openShareTableMenu}
                  >
                    <table className="settings-share-table atlas-table">
                      <TableColGroup columns={shareTableColumns} api={shareTableApi} />
                      <thead>
                        <tr>
                          {shareSortColumns.map((column) => (
                            <TableHeaderCell
                              key={column.column}
                              column={shareTableColumns.find((item) => item.id === column.column)!}
                              api={shareTableApi}
                              aria-sort={
                                shareSort.column === column.column
                                  ? (shareSort.direction === 'asc' ? 'ascending' : 'descending')
                                  : 'none'
                              }
                            >
                              <button
                                type="button"
                                className={`settings-share-sort-btn${shareSort.column === column.column ? ' is-active' : ''}`}
                                onClick={() => toggleShareSort(column.column)}
                              >
                                <span>{tx(column.labelKey, column.fallback)}</span>
                                {shareSortIndicator(column.column)}
                              </button>
                            </TableHeaderCell>
                          ))}
                          <TableHeaderCell column={shareTableColumns.find((item) => item.id === 'link')!} api={shareTableApi}>
                            <span className="settings-share-static-header">{tx('share.table.link')}</span>
                          </TableHeaderCell>
                          <TableHeaderCell column={shareTableColumns.find((item) => item.id === 'duration')!} api={shareTableApi}>
                            <span className="settings-share-static-header">{tx('share.table.duration')}</span>
                          </TableHeaderCell>
                          <TableHeaderCell column={shareTableColumns.find((item) => item.id === 'scope')!} api={shareTableApi}>
                            <span className="settings-share-static-header">{tx('share.table.scope')}</span>
                          </TableHeaderCell>
                          <TableHeaderCell
                            column={shareTableColumns.find((item) => item.id === 'actions')!}
                            api={shareTableApi}
                            className="settings-share-actions-heading"
                          >
                            <span className="settings-share-static-header">{tx('share.table.actions')}</span>
                          </TableHeaderCell>
                        </tr>
                      </thead>
                      <tbody key={`share-page-${sharePage}-${shareSort.column}-${shareSort.direction}-${normalizedShareSearch}`}>
                        {pagedShares.map(({ applicationId, applicationName, share }, index) => {
                          const url = `${window.location.origin}/share/${share.token}`
                          const path = `/share/${share.token}`
                          const permission = normalizeSharePermission(share.permission)
                          const scope = formatShareScope(share.sections, tx, format)
                          return (
                            <tr
                              key={share.id}
                              style={{ '--share-row-index': index } as CSSProperties}
                            >
                              <TableCell columnId="application" api={shareTableApi} dataLabel={tx('share.table.application')}>
                                <OverflowReveal
                                  as="strong"
                                  className="settings-share-app"
                                  text={applicationName}
                                  label={tx('share.table.application')}
                                  onCopyResult={notifyCopyResult}
                                />
                              </TableCell>
                              <TableCell columnId="created" api={shareTableApi} dataLabel={tx('share.table.created')}>
                                <span className="settings-share-date">{formatShareTimestamp(share.createdAt, lang)}</span>
                              </TableCell>
                              <TableCell columnId="expires" api={shareTableApi} dataLabel={tx('share.table.expires')}>
                                <span className={`settings-share-date${share.expiresAt ? '' : ' is-never'}`}>
                                  <Clock3 size={11} aria-hidden="true" />
                                  {formatShareExpiry(share.expiresAt, lang, tx)}
                                </span>
                              </TableCell>
                              <TableCell columnId="permission" api={shareTableApi} dataLabel={tx('share.table.permission')}>
                                <div className="settings-share-cell-control">
                                  <Select
                                    size="small"
                                    value={permission}
                                    options={sharePermissionOptions.map((option) => ({
                                      value: option.value,
                                      label: tx(option.labelKey, option.fallback),
                                    }))}
                                    onChange={(value) => onUpdateShare?.(applicationId, share.id, share.expiresAt, value)}
                                    ariaLabel={tx('share.table.permission')}
                                  />
                                </div>
                              </TableCell>
                              <TableCell columnId="link" api={shareTableApi} dataLabel={tx('share.table.link')}>
                                <OverflowReveal
                                  as="code"
                                  className="settings-share-token"
                                  text={path}
                                  copyValue={url}
                                  label={tx('share.linkLabel')}
                                  onCopyResult={notifyCopyResult}
                                />
                              </TableCell>
                              <TableCell columnId="duration" api={shareTableApi} dataLabel={tx('share.table.duration')}>
                                <div className="settings-share-cell-control">
                                  <Select
                                    size="small"
                                    value={shareExpiryChoice(share.expiresAt)}
                                    options={shareExpiryOptions.map((option) => ({
                                      value: option.value,
                                      label: tx(option.labelKey, option.fallback),
                                    }))}
                                    onChange={(value) => onUpdateShare?.(applicationId, share.id, expiresAtForShare(value))}
                                    ariaLabel={tx('share.table.duration')}
                                  />
                                </div>
                              </TableCell>
                              <TableCell columnId="scope" api={shareTableApi} dataLabel={tx('share.table.scope')}>
                                <OverflowReveal
                                  as="span"
                                  className="settings-share-scope-chip"
                                  text={scope.labels}
                                  label={tx('share.table.scope')}
                                  onCopyResult={notifyCopyResult}
                                >
                                  {scope.summary}
                                </OverflowReveal>
                              </TableCell>
                              <TableCell columnId="actions" api={shareTableApi} dataLabel={tx('share.table.actions')}>
                                <div className="settings-share-actions">
                                  <CopyButton value={url} label={tx('share.linkLabel')} className="settings-share-icon-button" />
                                  <button
                                    type="button"
                                    className="icon-action settings-share-icon-button settings-share-revoke"
                                    onClick={() => setConfirmRevokeShare({ appId: applicationId, shareId: share.id })}
                                    aria-label={tx('share.revoke')}
                                    title={tx('share.revoke')}
                                  >
                                    <Trash2 size={13} aria-hidden="true" />
                                  </button>
                                </div>
                              </TableCell>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {shareTableMenuNode}
                  </div>

                  <div className="settings-pagination settings-share-pagination">
                    <span className="settings-pagination-info">
                      {visibleShares.length > SHARE_PAGE_SIZE
                        ? format(tx('pagination.showing'), {
                            from: sharePage * SHARE_PAGE_SIZE + 1,
                            to: Math.min((sharePage + 1) * SHARE_PAGE_SIZE, visibleShares.length),
                            total: visibleShares.length,
                          })
                        : format(tx('pagination.allItems'), { total: visibleShares.length })}
                    </span>
                    {sharePageCount > 1 ? (
                      <div className="settings-pagination-controls">
                        <button type="button" onClick={() => setSharePage(0)} disabled={sharePage === 0}>
                          {tx('pagination.first')}
                        </button>
                        <button type="button" onClick={() => setSharePage((p) => Math.max(0, p - 1))} disabled={sharePage === 0}>
                          {tx('pagination.previous')}
                        </button>
                        <span className="settings-pagination-current">
                          {format(tx('pagination.page'), { page: sharePage + 1, pages: sharePageCount })}
                        </span>
                        <button type="button" onClick={() => setSharePage((p) => Math.min(sharePageCount - 1, p + 1))} disabled={sharePage >= sharePageCount - 1}>
                          {tx('pagination.next')}
                        </button>
                        <button type="button" onClick={() => setSharePage(sharePageCount - 1)} disabled={sharePage >= sharePageCount - 1}>
                          {tx('pagination.last')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <ConfirmDialog
          open={confirmRevokeShare !== null}
          title={tx('share.revoke')}
          message={tx('share.revokeConfirmMessage', 'Are you sure you want to revoke this share link? Anyone with the link will lose access immediately.')}
          confirmLabel={tx('share.revoke')}
          cancelLabel={tx('cancel')}
          variant="danger"
          onConfirm={() => {
            if (confirmRevokeShare) {
              onRevokeShare?.(confirmRevokeShare.appId, confirmRevokeShare.shareId)
              setConfirmRevokeShare(null)
            }
          }}
          onCancel={() => setConfirmRevokeShare(null)}
        />

        <ConfirmDialog
          open={confirmDeletePasskey !== null}
          title={tx('settings.removePasskey')}
          message={format(tx('settings.removePasskeyConfirm'), {
            name: confirmDeletePasskey?.label || tx('settings.passkeyUnnamed'),
          })}
          confirmLabel={tx('settings.removePasskey')}
          cancelLabel={tx('cancel')}
          variant="danger"
          onConfirm={() => {
            if (confirmDeletePasskey) {
              onDeletePasskey?.(confirmDeletePasskey.id)
              setConfirmDeletePasskey(null)
            }
          }}
          onCancel={() => setConfirmDeletePasskey(null)}
        />

        <div className="settings-footer-layout">
          <section className={`calendar-feed-card ${calendarToken ? 'is-enabled' : 'is-disabled'}`}>
            <div className="calendar-feed-main">
              <div className="calendar-feed-icon" aria-hidden="true">
                <CalendarDays size={18} />
              </div>
              <div className="calendar-feed-copy">
                <div className="calendar-feed-heading">
                  <h3 className="settings-section-title">{tx('calendar.title', 'Calendar Feed')}</h3>
                  <span className={`calendar-status-chip ${calendarToken ? 'ok' : 'muted'}`}>
                    {calendarToken ? tx('calendar.statusActive', 'Active') : tx('calendar.statusOff', 'Off')}
                  </span>
                </div>
                <p className="settings-hint">{tx('calendar.description', 'Subscribe to your deadlines in Google Calendar, Apple Calendar, Outlook, or any app that supports iCal subscriptions.')}</p>
              </div>
            </div>

            {calendarToken ? (
              <div className="calendar-feed-enabled">
                <div className="calendar-feed-link-row">
                  <label className="calendar-url-field">
                    <span>{tx('calendar.subscriptionUrl', 'Subscription URL')}</span>
                    <input
                      type="text"
                      readOnly
                      className="settings-input calendar-url-input"
                      value={calendarFeedUrl}
                      onClick={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <div className="calendar-feed-actions">
                    <CopyButton value={calendarFeedUrl} label={tx('calendar.subscriptionUrl', 'Subscription URL')} className="calendar-copy-button" />
                    <button type="button" className="quiet-action calendar-regenerate-action" onClick={() => requestCalendarToken(tx('calendar.regeneratedToast', 'Calendar subscription link regenerated.'))}>
                      <RefreshCw size={13} aria-hidden="true" />
                      {tx('calendar.regenerate', 'Regenerate')}
                    </button>
                  </div>
                </div>
                <div className="calendar-provider-grid" aria-label={tx('calendar.providerLinks', 'Calendar app links')}>
                  <a href={calendarGoogleUrl} target="_blank" rel="noopener noreferrer" className="calendar-provider-link is-google">
                    <span className="calendar-provider-logo" aria-hidden="true">
                      <GoogleCalendarLogo />
                    </span>
                    <span className="calendar-provider-label">{tx('calendar.addToGoogle')}</span>
                  </a>
                  <a href={calendarWebcalUrl} className="calendar-provider-link is-apple">
                    <span className="calendar-provider-logo" aria-hidden="true">
                      <AppleCalendarLogo />
                    </span>
                    <span className="calendar-provider-label">{tx('calendar.addToApple')}</span>
                  </a>
                  <a href={calendarOutlookUrl} target="_blank" rel="noopener noreferrer" className="calendar-provider-link is-outlook">
                    <span className="calendar-provider-logo" aria-hidden="true">
                      <OutlookCalendarLogo />
                    </span>
                    <span className="calendar-provider-label">{tx('calendar.addToOutlook')}</span>
                  </a>
                </div>
                <p className="calendar-feed-note">{tx('calendar.regenerateHint', 'Regenerating creates a new private URL and disables the old subscription link.')}</p>
              </div>
            ) : (
              <div className="calendar-feed-empty">
                <p>{tx('calendar.notEnabled', 'Calendar feed is off. Enable it to create a private iCal URL for your deadlines and reminders.')}</p>
                <button type="button" className="primary-action" onClick={() => requestCalendarToken(tx('calendar.enabledToast', 'Calendar feed enabled.'))}>
                  <CalendarDays size={14} aria-hidden="true" />
                  {tx('calendar.enable', 'Enable Calendar Feed')}
                </button>
              </div>
            )}
          </section>

          <div className="danger-zone">
            <h4><AlertTriangle size={14} aria-hidden="true" /> {tx('settings.dangerZone')}</h4>
            <p>{tx('settings.dangerZoneDesc')}</p>
            <button type="button" className="danger-action" onClick={onDeleteAccount}>
              <Trash2 size={14} aria-hidden="true" /> {tx('settings.deleteAccount')}
            </button>
          </div>
        </div>
        {onLogout ? (
          <section className="settings-mobile-signout" aria-label={tx('signOut')}>
            <button type="button" className="settings-mobile-signout-action" onClick={onLogout}>
              <span className="settings-mobile-signout-icon" aria-hidden="true">
                <LogOut size={16} />
              </span>
              <span>{tx('signOut')}</span>
              <ChevronRight className="settings-mobile-signout-chevron" size={15} aria-hidden="true" />
            </button>
          </section>
        ) : null}
        </div> : null}
        </div>
      </div>
      <AvatarCropDialog
        open={avatarDialogOpen}
        currentAvatar={session.user.settings.avatarDataUrl}
        name={session.user.name}
        email={session.user.email}
        onClose={() => setAvatarDialogOpen(false)}
        onSave={(avatarDataUrl) => onAvatarSave?.(avatarDataUrl)}
      />
    </section>
  )
}
