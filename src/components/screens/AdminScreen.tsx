import '../../styles/admin.css'
import {
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Check,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  FileText,
  HardDrive,
  Hash,
  Layers,
  ListFilter,
  LockKeyhole,
  LogIn,
  KeyRound,
  Mail,
  MemoryStick,
  MoreHorizontal,
  Monitor,
  Network,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Server,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
  UploadCloud,
  UserRound,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { AsyncActionButton } from '../shared/AsyncActionButton'
import { phdApi, type AdminSettings, type AdminTeamRecord, type AdminUser, type BackupRecord, type DatabaseConfiguration, type DatabaseConnectionInput, type DatabaseEngine, type EncryptionAlgorithm, type NotificationGroup, type ReleaseUpdateCheck, type SystemEvent, type SystemInfo, type TeamMember, type TeamRole, type TeamSummary } from '../../api/phdApi'
import type { BackupFrequency } from '../../data/applications'
import { normalizeErrorMessage } from '../../errorMessages'
import { PUBLIC_EDITION } from '../../edition'
import { MAX_SYSTEM_UPDATE_FILE_SIZE, filesRejectedForReason, formatFileSize, validateUploadFiles } from '../../fileUploads'
import { registerLanguage, type LangDict } from '../../i18n'
import englishAdmin from '../../i18n/en/admin.json'
import englishSettings from '../../i18n/en/settings.json'
import englishTeam from '../../i18n/en/team.json'
import chineseAdmin from '../../i18n/zh/admin.json'
import chineseSettings from '../../i18n/zh/settings.json'
import chineseTeam from '../../i18n/zh/team.json'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { AnchoredPopover } from '../shared/AnchoredPopover'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { InlineTestEmailAction } from '../shared/InlineTestEmailAction'
import { ModalPortal } from '../shared/ModalPortal'
import { NotificationPublisherPanel, type NotificationPublisherAudience, type NotificationPublisherRecipient } from '../shared/NotificationPublisherPanel'
import { Select } from '../shared/Select'
import { SwitchControl } from '../shared/SwitchControl'
import { Skeleton } from '../shared/Skeleton'
import { TeamJoinCodeGenerator } from '../shared/TeamJoinCodeGenerator'
import { copyToClipboard as writeToClipboard } from '../shared/clipboard'
import { isTeacherAssignedToStudent, teamMemberTeacherIds } from '../../teamRelationships'
import {
  TableCell,
  TableColGroup,
  TableHeaderCell,
} from '../shared/TableColumnChrome'
import { useTableColumnMenu } from '../shared/useTableColumnMenu'
import type { TableColumnDef } from '../shared/useTableColumns'
import {
  accountTypeForUser,
  backupFrequencyOptions,
  backupLimitOptions,
  compareAdminUsers,
  compareLogEvents,
  databaseDraftFromConfiguration,
  databaseEngineOptions,
  defaultDatabasePort,
  formatAdminDateTime,
  formatBytes,
  formatLogTime,
  formatQuotaLimit,
  formatUptime,
  isUnlimitedQuota,
  localizeEventMessage,
  localizeScope,
  normalizeBackupFrequency,
  normalizeBackupLimitOption,
  normalizeLogSearchValue,
  patchForAccountType,
  quotaProgressClass,
  type AccountType,
  type LogSortField,
  type SortDirection,
  type UserSortField,
  type UserUpdatePatch,
} from './adminScreenModel'

registerLanguage('en', englishAdmin as LangDict, 'admin')
registerLanguage('zh', chineseAdmin as LangDict, 'admin')
registerLanguage('en', englishSettings as LangDict, 'settings')
registerLanguage('zh', chineseSettings as LangDict, 'settings')
registerLanguage('en', englishTeam as LangDict, 'team')
registerLanguage('zh', chineseTeam as LangDict, 'team')

const USER_PAGE_SIZE = 8
const LOG_PAGE_SIZE = 10
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const accountTypes = ['free', 'pro', 'admin'] as const

/**
 * Controlled per-row quota editor. A plain `defaultValue` input here would silently
 * keep showing whatever the admin last typed even if the save fails or the row's
 * quota changes from elsewhere — this keeps the field in sync with the true value
 * (mount a fresh instance per user via `key={user.id}` at the call site).
 */
function QuotaEditor({
  quota,
  label,
  editLabel,
  suffix,
  max = 102400,
  variant = 'regular',
  showValue = true,
  onCommit,
}: {
  quota: number
  label: string
  editLabel: string
  suffix?: string
  max?: number
  variant?: 'regular' | 'compact'
  showValue?: boolean
  onCommit: (next: number) => void
}) {
  const [value, setValue] = useState(String(quota))
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipNextBlurRef = useRef(false)

  useEffect(() => {
    if (!editing) {
      setValue(String(quota))
      return
    }
    setValue(String(quota))
    skipNextBlurRef.current = false
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing, quota])

  const commit = (rawValue = value) => {
    const next = Number(rawValue)
    if (Number.isInteger(next) && next > 0 && next <= max) {
      if (next !== quota) onCommit(next)
      setValue(String(next))
    } else {
      setValue(String(quota))
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <label className={`admin-quota-edit admin-quota-edit-${variant} is-editing`}>
        <span className="sr-only">{label}</span>
        <span className="admin-quota-edit-field">
          <input
            ref={inputRef}
            type="number"
            min={1}
            max={max}
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={(event) => {
              if (skipNextBlurRef.current) {
                skipNextBlurRef.current = false
                return
              }
              commit(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commit(event.currentTarget.value)
              }
              if (event.key === 'Escape') {
                skipNextBlurRef.current = true
                setValue(String(quota))
                setEditing(false)
              }
            }}
          />
        </span>
      </label>
    )
  }

  const displayValue = suffix ? `${quota} ${suffix}` : String(quota)

  return (
    <span className={`admin-quota-edit admin-quota-edit-${variant}`}>
      {showValue ? <span className="admin-quota-edit-value">{displayValue}</span> : null}
      <button
        type="button"
        className="admin-quota-edit-btn"
        onClick={() => setEditing(true)}
        title={editLabel}
        aria-label={editLabel}
      >
        <Pencil size={variant === 'compact' ? 11 : 12} aria-hidden="true" />
      </button>
    </span>
  )
}

type LogActorFilter = 'all' | 'admin' | 'system'

const adminSessionDurationOptions = [
  { value: '15', labelKey: 'settings.sessionDuration15m', fallback: '15 minutes' },
  { value: '30', labelKey: 'admin.sessionDuration30m', fallback: '30 minutes' },
  { value: '60', labelKey: 'settings.sessionDuration1h', fallback: '1 hour' },
  { value: '120', labelKey: 'admin.sessionDuration2h', fallback: '2 hours' },
  { value: '240', labelKey: 'settings.sessionDuration4h', fallback: '4 hours' },
  { value: '720', labelKey: 'settings.sessionDuration12h', fallback: '12 hours' },
]

const encryptionAlgorithmOptions: Array<{ value: EncryptionAlgorithm; labelKey: string }> = [
  { value: 'aes-256-gcm', labelKey: 'admin.encryptionAlgoAes' },
  { value: 'chacha20-poly1305', labelKey: 'admin.encryptionAlgoChaCha' },
]

function EncryptionSettingsPanel({
  settings,
  databaseType,
  busy,
  onApply,
  onLocalError,
  tx,
}: {
  settings: AdminSettings
  databaseType: DatabaseEngine | null
  busy: boolean
  onApply: (patch: Partial<AdminSettings>) => Promise<void>
  onLocalError?: (message: string) => void
  tx: (path: string, fallback?: string) => string
}) {
  const [enabled, setEnabled] = useState(Boolean(settings.encryptionAtRest))
  const [algorithm, setAlgorithm] = useState<EncryptionAlgorithm>(settings.encryptionAlgorithm === 'chacha20-poly1305' ? 'chacha20-poly1305' : 'aes-256-gcm')
  const [passwordEnabled, setPasswordEnabled] = useState(Boolean(settings.encryptionPasswordEnabled))
  const [sqliteEncryption, setSqliteEncryption] = useState(Boolean(settings.sqliteEncryption))
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')

  useEffect(() => {
    setEnabled(Boolean(settings.encryptionAtRest))
    setAlgorithm(settings.encryptionAlgorithm === 'chacha20-poly1305' ? 'chacha20-poly1305' : 'aes-256-gcm')
    setPasswordEnabled(Boolean(settings.encryptionPasswordEnabled))
    setSqliteEncryption(Boolean(settings.sqliteEncryption))
  }, [
    settings.encryptionAtRest,
    settings.encryptionAlgorithm,
    settings.encryptionPasswordEnabled,
    settings.sqliteEncryption,
  ])

  const passwordAlreadySet = Boolean(settings.encryptionPasswordSet)
  const sqliteAvailable = databaseType === 'sqlite'
  const needsCurrentPassword = Boolean(settings.encryptionPasswordEnabled) && (
    algorithm !== (settings.encryptionAlgorithm ?? 'aes-256-gcm')
    || passwordEnabled !== Boolean(settings.encryptionPasswordEnabled)
    || (passwordEnabled && password.length > 0)
    || enabled !== Boolean(settings.encryptionAtRest)
    || sqliteEncryption !== Boolean(settings.sqliteEncryption)
  )

  const apply = async () => {
    if (enabled && passwordEnabled) {
      if (!passwordAlreadySet && password.length < 8) {
        onLocalError?.(tx('admin.passwordTooShort'))
        return
      }
      if (password.length > 0 && password !== passwordConfirm) {
        onLocalError?.(tx('admin.passwordMismatch'))
        return
      }
    }
    if (needsCurrentPassword && !currentPassword) {
      onLocalError?.(tx('admin.encryptionCurrentPasswordHint'))
      return
    }
    const patch: Partial<AdminSettings> = {
      encryptionAtRest: enabled,
      encryptionAlgorithm: algorithm,
      encryptionPasswordEnabled: enabled ? passwordEnabled : false,
      sqliteEncryption: enabled && sqliteAvailable ? sqliteEncryption : false,
    }
    if (enabled && passwordEnabled && password.length >= 8) {
      patch.encryptionPassword = password
    }
    if (needsCurrentPassword) {
      patch.encryptionCurrentPassword = currentPassword
    }
    await onApply(patch)
    setPassword('')
    setPasswordConfirm('')
    setCurrentPassword('')
  }

  return (
    <div className="admin-encryption-panel">
      <label className="admin-toggle-row admin-setting-line">
        <span>{tx('admin.encryptionEnabledLabel')}</span>
        <SwitchControl
          checked={enabled}
          label={tx('admin.encryptionEnabledLabel')}
          variant="accent"
          onChange={setEnabled}
        />
      </label>

      {enabled ? (
        <div className="admin-encryption-options">
          <div className="admin-session-control">
            <span className="admin-session-control-label">{tx('admin.encryptionMethod')}</span>
            <Select
              size="small"
              value={algorithm}
              options={encryptionAlgorithmOptions.map((option) => ({
                value: option.value,
                label: tx(option.labelKey),
              }))}
              onChange={(value) => {
                const nextAlgorithm = encryptionAlgorithmOptions.find((option) => option.value === value)?.value
                if (nextAlgorithm) setAlgorithm(nextAlgorithm)
              }}
              ariaLabel={tx('admin.encryptionMethod')}
            />
          </div>
          <p className="admin-encryption-hint">{tx('admin.encryptionMethodDesc')}</p>

          <div className="admin-encryption-password-option">
            <div className="admin-encryption-password-option-copy">
              <label className="admin-toggle-row admin-setting-line">
                <span>{tx('admin.encryptionPasswordToggle')}</span>
                <SwitchControl
                  checked={passwordEnabled}
                  label={tx('admin.encryptionPasswordToggle')}
                  variant="accent"
                  aria-controls="admin-encryption-password-fields"
                  aria-expanded={passwordEnabled}
                  onChange={setPasswordEnabled}
                />
              </label>
              <p className="admin-encryption-hint">{tx('admin.encryptionPasswordToggleDesc')}</p>
            </div>

            <CollapsiblePanel
              open={passwordEnabled}
              id="admin-encryption-password-fields"
              className="admin-encryption-password-panel"
              innerClassName="admin-password-form admin-encryption-password-fields"
              openMs={380}
              closeMs={320}
            >
              <span className="admin-encryption-password-status">
                {passwordAlreadySet ? tx('admin.encryptionPasswordSet') : tx('admin.encryptionPasswordNotSet')}
              </span>
              <label>
                <span>{tx('admin.encryptionPassword')}</span>
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={passwordAlreadySet ? '••••••••' : undefined}
                />
              </label>
              <label>
                <span>{tx('admin.encryptionPasswordConfirm')}</span>
                <input
                  type="password"
                  value={passwordConfirm}
                  autoComplete="new-password"
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                />
              </label>
            </CollapsiblePanel>
          </div>

          <label className="admin-toggle-row admin-setting-line">
            <span>{tx('admin.sqliteEncryption')}</span>
            <SwitchControl
              checked={sqliteAvailable && sqliteEncryption}
              disabled={!sqliteAvailable}
              label={tx('admin.sqliteEncryption')}
              variant="accent"
              onChange={setSqliteEncryption}
            />
          </label>
          <p className="admin-encryption-hint">
            {sqliteAvailable ? tx('admin.sqliteEncryptionDesc') : tx('admin.externalDatabaseEncryptionDesc')}
          </p>
          {sqliteAvailable ? <p className="admin-encryption-hint muted">{tx('admin.sqliteEncryptionHint')}</p> : null}
        </div>
      ) : null}

      <div className="admin-encryption-apply-section">
        <CollapsiblePanel
          open={needsCurrentPassword}
          className="admin-encryption-current-password-panel"
          innerClassName="admin-encryption-current-password-inner"
          openMs={380}
          closeMs={320}
        >
          <label className="admin-encryption-current-password">
            <span>{tx('admin.encryptionCurrentPassword')}</span>
            <input
              type="password"
              value={currentPassword}
              autoComplete="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <small>{tx('admin.encryptionCurrentPasswordHint')}</small>
          </label>
        </CollapsiblePanel>

        <div className="admin-card-actions">
          <button type="button" className="quiet-action save-action" disabled={busy} onClick={() => void apply()}>
            {busy ? (
              <><RefreshCw size={13} aria-hidden="true" className="spin-icon" /> {tx('admin.encryptionApplying')}</>
            ) : (
              <><ShieldCheck size={13} aria-hidden="true" /> {tx('admin.encryptionApply')}</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function AdminScreen({
  activeTab,
  currentUserId,
  settings,
  users,
  logs,
  systemInfo,
  token,
  onRegistration,
  onSettings,
  onTestSystemMail,
  onUserUpdate,
  onUserDelete,
  onExportLogs,
  onClearLogs,
  onChangePassword,
  onSystemUpdate,
  onRefreshSystemInfo,
  onNotify,
}: {
  activeTab: 'systemConfig' | 'userManagement' | 'logManagement' | 'systemInfo'
  currentUserId: string
  settings: AdminSettings
  users: AdminUser[]
  logs: SystemEvent[]
  systemInfo: SystemInfo | null
  token: string
  onRegistration: (allowed: boolean) => void
  onSettings: (patch: Partial<AdminSettings>) => void | Promise<void>
  onTestSystemMail?: (patch: Partial<AdminSettings>, delivery: string) => Promise<void> | void
  onUserUpdate: (userId: string, patch: UserUpdatePatch) => Promise<void> | void
  onUserDelete: (userId: string) => void
  onExportLogs: (format: 'csv' | 'json') => Promise<void> | void
  onClearLogs: () => Promise<void> | void
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<boolean>
  onSystemUpdate: (file: File) => Promise<boolean>
  onRefreshSystemInfo: () => void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
}) {
  const { tx, format, lang } = useI18n()
  const [userPage, setUserPage] = useState(0)
  const [userSearch, setUserSearch] = useState('')
  const [accountView, setAccountView] = useState<'personal' | 'teams'>('personal')
  const [userSort, setUserSort] = useState<{ field: UserSortField; direction: SortDirection }>({
    field: 'storageUsedBytes',
    direction: 'desc',
  })
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<string | null>(null)
  const [updatingUserIds, setUpdatingUserIds] = useState<Set<string>>(() => new Set())
  const [pendingAccountTypes, setPendingAccountTypes] = useState<Record<string, AccountType>>({})
  const [viewingTeam, setViewingTeam] = useState<{ teamId: string; ownerEmail: string } | null>(null)
  const [adminTeams, setAdminTeams] = useState<AdminTeamRecord[]>([])
  const [adminTeamsLoading, setAdminTeamsLoading] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [logPage, setLogPage] = useState(0)

  const userTableColumns = useMemo<TableColumnDef[]>(() => [
    { id: 'account', label: tx('admin.userColumnAccount'), defaultWidth: 220, minWidth: 140 },
    { id: 'role', label: tx('admin.userColumnRole'), defaultWidth: 120, minWidth: 96 },
    { id: 'status', label: tx('admin.userColumnStatus'), defaultWidth: 100, minWidth: 80 },
    { id: 'records', label: tx('admin.userColumnRecords'), defaultWidth: 180, minWidth: 120 },
    { id: 'storage', label: tx('admin.userColumnStorage'), defaultWidth: 140, minWidth: 100 },
    { id: 'quota', label: tx('admin.userColumnQuota'), defaultWidth: 120, minWidth: 88 },
    { id: 'lastLogin', label: tx('admin.userColumnLastLogin'), defaultWidth: 140, minWidth: 100 },
    { id: 'actions', label: tx('admin.userColumnActions'), defaultWidth: 140, minWidth: 96, hideable: false },
  ], [tx])
  const {
    api: userTableApi,
    openMenu: openUserTableMenu,
    menuNode: userTableMenuNode,
  } = useTableColumnMenu('admin-users', userTableColumns)
  const userCol = useMemo(
    () => Object.fromEntries(userTableColumns.map((column) => [column.id, column])) as Record<string, TableColumnDef>,
    [userTableColumns],
  )

  const logTableColumns = useMemo<TableColumnDef[]>(() => [
    { id: 'time', label: tx('admin.logColumns.time'), defaultWidth: 160, minWidth: 110 },
    { id: 'scope', label: tx('admin.logColumns.scope'), defaultWidth: 120, minWidth: 88 },
    { id: 'message', label: tx('admin.logColumns.message'), defaultWidth: 320, minWidth: 160 },
    { id: 'actor', label: tx('admin.logColumns.actorId'), defaultWidth: 140, minWidth: 96 },
  ], [tx])
  const {
    api: logTableApi,
    openMenu: openLogTableMenu,
    menuNode: logTableMenuNode,
  } = useTableColumnMenu('admin-logs', logTableColumns)
  const logCol = useMemo(
    () => Object.fromEntries(logTableColumns.map((column) => [column.id, column])) as Record<string, TableColumnDef>,
    [logTableColumns],
  )
  const [logSearch, setLogSearch] = useState('')
  const [logScopeFilter, setLogScopeFilter] = useState('all')
  const [logActorFilter, setLogActorFilter] = useState<LogActorFilter>('all')
  const [logSort, setLogSort] = useState<{ field: LogSortField; direction: SortDirection }>({
    field: 'time',
    direction: 'desc',
  })
  const [clearLogDialogOpen, setClearLogDialogOpen] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)

  // System config state
  const [notificationMailbox, setNotificationMailbox] = useState(settings.notificationMailbox)
  const [smtpHost, setSmtpHost] = useState(settings.smtpHost || '')
  const [smtpPort, setSmtpPort] = useState(String(settings.smtpPort ?? 587))
  const [smtpUser, setSmtpUser] = useState(settings.smtpUser || '')
  // The server never returns the real secret (see settings.smtpPassSet) — this only ever holds a NEW value being typed.
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpTls, setSmtpTls] = useState(settings.smtpTls ?? true)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [encryptionOpen, setEncryptionOpen] = useState(false)
  const [encryptionBusy, setEncryptionBusy] = useState(false)
  const [sessionConfigOpen, setSessionConfigOpen] = useState(false)
  const [systemMailOpen, setSystemMailOpen] = useState(false)
  const [mailTesting, setMailTesting] = useState(false)
  const [mailSaving, setMailSaving] = useState(false)
  const [databaseConfigOpen, setDatabaseConfigOpen] = useState(false)
  const [databaseConfiguration, setDatabaseConfiguration] = useState<DatabaseConfiguration | null>(null)
  const [databaseDraft, setDatabaseDraft] = useState<DatabaseConnectionInput>({ type: 'sqlite', sqlitePath: '' })
  const [databaseConfigurationLoaded, setDatabaseConfigurationLoaded] = useState(false)
  const [databasePassword, setDatabasePassword] = useState('')
  const [databaseLoading, setDatabaseLoading] = useState(false)
  const [databaseTesting, setDatabaseTesting] = useState(false)
  const [databaseSaving, setDatabaseSaving] = useState(false)
  const [backupConfigOpen, setBackupConfigOpen] = useState(false)
  const [backupFrequency, setBackupFrequency] = useState(normalizeBackupFrequency(settings.backupFrequency))
  const [maxBackupsLimit, setMaxBackupsLimit] = useState(normalizeBackupLimitOption(settings.maxBackupsPerAppLimit))
  const [adminSessionDuration, setAdminSessionDuration] = useState(String(settings.adminSessionDurationMinutes ?? 120))
  const [workspaceBackups, setWorkspaceBackups] = useState<BackupRecord[]>([])
  const [workspaceBackupsLoaded, setWorkspaceBackupsLoaded] = useState(false)
  const [workspaceBackupsLoading, setWorkspaceBackupsLoading] = useState(false)
  const [workspaceBackupBusy, setWorkspaceBackupBusy] = useState<string | null>(null)
  const [pendingBackupDelete, setPendingBackupDelete] = useState<BackupRecord | null>(null)

  // Password change state
  const [passwordConfigOpen, setPasswordConfigOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordFieldError, setPasswordFieldError] = useState<'current' | 'new' | 'confirm' | null>(null)
  const [passwordBusy, setPasswordBusy] = useState(false)

  // System update state
  const [uploading, setUploading] = useState(false)
  const [updateFile, setUpdateFile] = useState<File | null>(null)
  const [updateDragActive, setUpdateDragActive] = useState(false)
  const [releaseUpdate, setReleaseUpdate] = useState<ReleaseUpdateCheck | null>(null)
  const [checkingReleaseUpdate, setCheckingReleaseUpdate] = useState(false)
  const [installingReleaseUpdate, setInstallingReleaseUpdate] = useState(false)
  const [manualUpdateOpen, setManualUpdateOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Live uptime counter
  const [liveUptime, setLiveUptime] = useState(systemInfo?.uptime ?? 0)
  const uptimeStartRef = useRef(Date.now() - ((systemInfo?.uptime ?? 0) * 1000))
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [notificationGroups, setNotificationGroups] = useState<NotificationGroup[]>([])
  const [notificationGroupsLoaded, setNotificationGroupsLoaded] = useState(false)

  const commitUserUpdate = async (userId: string, patch: UserUpdatePatch) => {
    setUpdatingUserIds((current) => new Set(current).add(userId))
    try {
      await onUserUpdate(userId, patch)
    } catch {
      // AdminApp owns the visible error message; this row only owns its pending UI.
    } finally {
      setUpdatingUserIds((current) => {
        const next = new Set(current)
        next.delete(userId)
        return next
      })
    }
  }

  const handleAccountTypeChange = (userId: string, accountType: AccountType) => {
    setPendingAccountTypes((current) => ({ ...current, [userId]: accountType }))
    void commitUserUpdate(userId, patchForAccountType(accountType)).finally(() => {
      setPendingAccountTypes((current) => {
        const next = { ...current }
        delete next[userId]
        return next
      })
    })
  }

  useEffect(() => {
    setNotificationMailbox(settings.notificationMailbox)
    setSmtpHost(settings.smtpHost || '')
    setSmtpPort(String(settings.smtpPort ?? 587))
    setSmtpUser(settings.smtpUser || '')
    setSmtpPass('')
    setSmtpTls(settings.smtpTls ?? true)
    setBackupFrequency(normalizeBackupFrequency(settings.backupFrequency))
    setMaxBackupsLimit(normalizeBackupLimitOption(settings.maxBackupsPerAppLimit))
    setAdminSessionDuration(String(settings.adminSessionDurationMinutes ?? 120))
  }, [settings])

  const loadWorkspaceBackups = useCallback(async (showSpinner = true) => {
    if (showSpinner) setWorkspaceBackupsLoading(true)
    try {
      const items = await phdApi.listAdminBackups(token)
      setWorkspaceBackups(items)
      setWorkspaceBackupsLoaded(true)
    } catch (error) {
      onNotify?.(normalizeErrorMessage(error, lang), 'error')
    } finally {
      if (showSpinner) setWorkspaceBackupsLoading(false)
    }
  }, [lang, onNotify, token])

  const loadDatabaseConfiguration = useCallback(async () => {
    setDatabaseLoading(true)
    try {
      const configuration = await phdApi.adminDatabaseConfiguration(token)
      setDatabaseConfiguration(configuration)
      setDatabaseDraft(databaseDraftFromConfiguration(configuration))
      setDatabasePassword('')
    } catch (error) {
      onNotify?.(normalizeErrorMessage(error, lang), 'error')
    } finally {
      setDatabaseLoading(false)
      setDatabaseConfigurationLoaded(true)
    }
  }, [lang, onNotify, token])

  useEffect(() => {
    if (activeTab !== 'systemConfig' || !backupConfigOpen || workspaceBackupsLoaded || workspaceBackupsLoading) return
    void loadWorkspaceBackups()
  }, [activeTab, backupConfigOpen, loadWorkspaceBackups, workspaceBackupsLoaded, workspaceBackupsLoading])

  useEffect(() => {
    if (activeTab !== 'systemConfig' || (!databaseConfigOpen && !encryptionOpen) || databaseConfigurationLoaded || databaseLoading) return
    void loadDatabaseConfiguration()
  }, [activeTab, databaseConfigOpen, databaseConfigurationLoaded, databaseLoading, encryptionOpen, loadDatabaseConfiguration])

  const loadNotificationGroups = useCallback(async () => {
    const groups = await phdApi.adminNotificationGroups(token)
    setNotificationGroups(groups)
    setNotificationGroupsLoaded(true)
  }, [token])

  useEffect(() => {
    if (activeTab !== 'userManagement' || notificationGroupsLoaded) return
    void loadNotificationGroups().catch(() => setNotificationGroupsLoaded(true))
  }, [activeTab, loadNotificationGroups, notificationGroupsLoaded])

  const loadAdminTeams = useCallback(async () => {
    if (PUBLIC_EDITION) return
    setAdminTeamsLoading(true)
    try {
      setAdminTeams(await phdApi.adminTeams(token))
    } catch (error) {
      onNotify?.(normalizeErrorMessage(error, lang), 'error')
    } finally {
      setAdminTeamsLoading(false)
    }
  }, [lang, onNotify, token])

  useEffect(() => {
    if (activeTab !== 'userManagement' || accountView !== 'teams' || PUBLIC_EDITION) return
    void loadAdminTeams()
  }, [accountView, activeTab, loadAdminTeams])

  async function handleCreateTeam(event: FormEvent) {
    event.preventDefault()
    const name = newTeamName.trim()
    if (!name) return
    setCreatingTeam(true)
    try {
      const record = await phdApi.createAdminTeam(token, name)
      setAdminTeams((current) => [record, ...current.filter((item) => item.team.id !== record.team.id)])
      setNewTeamName('')
      onNotify?.(tx('admin.teamCreated'), 'success')
      setViewingTeam({ teamId: record.team.id, ownerEmail: '' })
    } catch (error) {
      onNotify?.(normalizeErrorMessage(error, lang), 'error')
    } finally {
      setCreatingTeam(false)
    }
  }

  useEffect(() => {
    setPendingAccountTypes((current) => {
      let changed = false
      const next = { ...current }
      const userIds = new Set(users.map((user) => user.id))
      for (const [userId, accountType] of Object.entries(current)) {
        const user = users.find((candidate) => candidate.id === userId)
        if (!userIds.has(userId) || (user && accountTypeForUser(user) === accountType)) {
          delete next[userId]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [users])

  // Live uptime: tick every second
  useEffect(() => {
    if (!systemInfo) return
    uptimeStartRef.current = Date.now() - systemInfo.uptime * 1000
    setLiveUptime(systemInfo.uptime)
    const timer = setInterval(() => {
      setLiveUptime(Math.floor((Date.now() - uptimeStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [systemInfo])

  useEffect(() => {
    setLogPage(0)
  }, [logActorFilter, logScopeFilter, logSearch, logSort.direction, logSort.field])

  useEffect(() => {
    setUserPage(0)
    setPendingDeleteUserId(null)
  }, [accountView, userSearch, userSort.direction, userSort.field])

  const totalUsed = useMemo(() => users.reduce((sum, user) => sum + Number(user.storageUsedBytes ?? 0), 0), [users])
  const adminListUsers = useMemo(() => users, [users])
  const userDerivedTeamAccounts = useMemo<AdminTeamRecord[]>(() => users
    .filter((owner) => Boolean(owner.teamId))
    .map((owner) => {
      const teamId = owner.teamId as string
      const members = users.filter((candidate) => candidate.teamMemberOf?.teamId === teamId)
      return {
        team: {
          id: teamId,
          name: owner.teamName || teamId,
          ownerId: owner.id,
          seatLimit: owner.seatLimit ?? 105,
          createdAt: owner.createdAt,
          updatedAt: owner.createdAt,
        },
        owner,
        memberCount: Math.max(owner.activeMemberCount ?? 0, members.length + 1),
        teacherCount: members.filter((member) => member.teamMemberOf?.role === 'admin').length,
        studentCount: members.filter((member) => member.teamMemberOf?.role === 'member').length,
      }
    }), [users])
  const teamAccounts = useMemo(
    () => PUBLIC_EDITION ? [] : (adminTeams.length > 0 ? adminTeams : userDerivedTeamAccounts),
    [adminTeams, userDerivedTeamAccounts],
  )
  const filteredTeamAccounts = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    if (!query) return teamAccounts
    return teamAccounts.filter((record) => [
      record.team.name,
      record.team.id,
      record.owner?.name,
      record.owner?.email,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query))
  }, [teamAccounts, userSearch])
  const filteredSortedUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    return adminListUsers
      .filter((user) => {
        if (!query) return true
        const status = tx(user.disabledAt ? 'admin.statusDisabled' : 'admin.statusActive')
        const accountType = accountTypeForUser(user)
        const searchable = [
          user.email,
          user.name,
          tx(`admin.accountType.${accountType}`),
          tx(`role.${user.role}`),
          accountType,
          user.role,
          status,
          format(tx('admin.records'), { count: user.applicationCount }),
          String(user.applicationQuota ?? user.settings.applicationQuota ?? ''),
          String(user.applicationCreateQuota ?? user.settings.applicationCreateQuota ?? ''),
          formatBytes(user.storageUsedBytes ?? 0),
          String(user.storageQuotaMb ?? ''),
          String(user.shareQuota ?? user.settings.shareQuota ?? ''),
          String(user.shareCreateQuota ?? user.settings.shareCreateQuota ?? ''),
          String(user.activeShareCount ?? ''),
          String(user.shareCreatedCount ?? user.settings.shareCreatedCount ?? ''),
          user.teamMemberOf?.teamName ?? '',
          user.teamMemberOf?.ownerEmail ?? '',
          String(user.activeMemberCount ?? ''),
          String(user.seatLimit ?? ''),
        ].join(' ').toLowerCase()
        return searchable.includes(query)
      })
      .sort((a, b) => compareAdminUsers(a, b, userSort.field, userSort.direction))
  }, [adminListUsers, format, tx, userSearch, userSort.direction, userSort.field])
  const userPageCount = Math.max(1, Math.ceil(filteredSortedUsers.length / USER_PAGE_SIZE))
  const visibleUsers = filteredSortedUsers.slice(userPage * USER_PAGE_SIZE, (userPage + 1) * USER_PAGE_SIZE)
  const userRangeStart = filteredSortedUsers.length === 0 ? 0 : userPage * USER_PAGE_SIZE + 1
  const userRangeEnd = Math.min(filteredSortedUsers.length, (userPage + 1) * USER_PAGE_SIZE)
  const notificationRecipients = useMemo<NotificationPublisherRecipient[]>(() => (
    adminListUsers
      .filter((user) => !user.disabledAt)
      .map((user) => {
        const accountType = accountTypeForUser(user)
        return {
          id: user.id,
          label: user.name || user.email,
          description: user.email,
          badge: tx(`admin.accountType.${accountType}`),
        }
      })
  ), [adminListUsers, tx])
  const notificationAudiences = useMemo<NotificationPublisherAudience[]>(() => [
    { id: 'all', label: tx('admin.notificationAudienceAll'), description: tx('admin.notificationAudienceAllDesc') },
    { id: 'admins', label: tx('admin.notificationAudienceAdmins'), description: tx('admin.notificationAudienceAdminsDesc') },
    { id: 'users', label: tx('admin.notificationAudienceUsers'), description: tx('admin.notificationAudienceUsersDesc') },
    { id: 'free', label: tx('admin.notificationAudienceFree'), description: tx('admin.notificationAudienceFreeDesc') },
    { id: 'pro', label: tx('admin.notificationAudiencePro'), description: tx('admin.notificationAudienceProDesc') },
    { id: 'team', label: tx('admin.notificationAudienceTeam'), description: tx('admin.notificationAudienceTeamDesc') },
  ], [tx])
  const createNotificationGroup = useCallback(async (name: string, memberIds: string[]) => {
    const group = await phdApi.createAdminNotificationGroup(token, name, memberIds)
    setNotificationGroups((current) => [group, ...current.filter((item) => item.id !== group.id)])
  }, [token])
  const deleteNotificationGroup = useCallback(async (groupId: string) => {
    await phdApi.deleteAdminNotificationGroup(token, groupId)
    setNotificationGroups((current) => current.filter((group) => group.id !== groupId))
  }, [token])
  const logScopeOptions = useMemo(() => {
    const scopes = Array.from(new Set(logs.map((event) => event.scope).filter(Boolean)))
      .sort((a, b) => localizeScope(a, tx).localeCompare(localizeScope(b, tx)))
    return [
      { value: 'all', label: tx('admin.logAllScopes') },
      ...scopes.map((scope) => ({ value: scope, label: localizeScope(scope, tx) })),
    ]
  }, [logs, tx])
  const logActorOptions = useMemo(() => [
    { value: 'all' as const, label: tx('admin.logAllActors') },
    { value: 'admin' as const, label: tx('admin.logAdminActor') },
    { value: 'system' as const, label: tx('admin.logSystemActor') },
  ], [tx])
  const filteredSortedLogs = useMemo(() => {
    const query = logSearch.trim().toLowerCase()
    return logs
      .filter((event) => {
        if (logScopeFilter !== 'all' && event.scope !== logScopeFilter) return false
        if (logActorFilter === 'admin' && !event.actorId) return false
        if (logActorFilter === 'system' && event.actorId) return false
        if (!query) return true
        const searchable = [
          event.id,
          event.time,
          formatLogTime(event.time, lang),
          event.scope,
          localizeScope(event.scope, tx),
          event.actorId ?? tx('admin.logSystemActor'),
          event.message,
          localizeEventMessage(event.message, tx),
          normalizeLogSearchValue(event.metadata),
        ].join(' ').toLowerCase()
        return searchable.includes(query)
      })
      .sort((a, b) => compareLogEvents(a, b, logSort.field, logSort.direction))
  }, [lang, logActorFilter, logScopeFilter, logSearch, logSort.direction, logSort.field, logs, tx])
  const logPageCount = Math.max(1, Math.ceil(filteredSortedLogs.length / LOG_PAGE_SIZE))
  const visibleLogs = filteredSortedLogs.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE)
  const logRangeStart = filteredSortedLogs.length === 0 ? 0 : logPage * LOG_PAGE_SIZE + 1
  const logRangeEnd = Math.min(filteredSortedLogs.length, (logPage + 1) * LOG_PAGE_SIZE)
  const isLogFiltered = logSearch.trim().length > 0 || logScopeFilter !== 'all' || logActorFilter !== 'all'

  useEffect(() => {
    setLogPage((page) => Math.min(page, logPageCount - 1))
  }, [logPageCount])

  useEffect(() => {
    setUserPage((page) => Math.min(page, userPageCount - 1))
  }, [userPageCount])

  const updateUserSort = (field: UserSortField) => {
    setUserSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const renderUserSortHeader = (field: UserSortField, label: string) => {
    const isActive = userSort.field === field
    const Icon = !isActive ? ArrowUpDown : userSort.direction === 'asc' ? ChevronUp : ChevronDown
    return (
      <button
        type="button"
        className={`admin-user-sort-btn${isActive ? ' active' : ''}`}
        onClick={() => updateUserSort(field)}
        aria-label={format(tx('admin.userSortBy'), { field: label })}
      >
        <span>{label}</span>
        <Icon size={12} aria-hidden="true" />
      </button>
    )
  }

  const updateLogSort = (field: LogSortField) => {
    setLogSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const resetLogFilters = () => {
    setLogSearch('')
    setLogScopeFilter('all')
    setLogActorFilter('all')
  }

  const handleClearLogs = async () => {
    setClearingLogs(true)
    try {
      await onClearLogs()
      setClearLogDialogOpen(false)
      resetLogFilters()
      setLogPage(0)
    } finally {
      setClearingLogs(false)
    }
  }

  const renderLogSortHeader = (field: LogSortField, label: string) => {
    const isActive = logSort.field === field
    const Icon = !isActive ? ArrowUpDown : logSort.direction === 'asc' ? ChevronUp : ChevronDown
    return (
      <button
        type="button"
        className={`admin-log-sort-btn${isActive ? ' active' : ''}`}
        onClick={() => updateLogSort(field)}
        aria-label={format(tx('admin.logSortBy'), { field: label })}
      >
        <span>{label}</span>
        <Icon size={12} aria-hidden="true" />
      </button>
    )
  }

  const smtpPortNumber = Number(smtpPort)
  const smtpPortValid = Number.isInteger(smtpPortNumber) && smtpPortNumber >= 1 && smtpPortNumber <= 65535
  const notificationMailboxValid = EMAIL_PATTERN.test(notificationMailbox.trim())
  const systemMailConfigured = notificationMailboxValid && smtpHost.trim().length > 0 && smtpPortValid
  const currentBackupFrequencyOption =
    backupFrequencyOptions.find((option) => option.value === backupFrequency) ?? backupFrequencyOptions[1]
  const currentBackupFrequencyLabel = tx(
    currentBackupFrequencyOption.labelKey,
    currentBackupFrequencyOption.fallback,
  )
  const currentSessionDurationOption =
    adminSessionDurationOptions.find((option) => option.value === adminSessionDuration) ?? adminSessionDurationOptions[3]
  const currentSessionDurationLabel = tx(
    currentSessionDurationOption.labelKey,
    currentSessionDurationOption.fallback,
  )

  const notify = (message: string, tone: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    onNotify?.(message, tone)
  }

  const buildSystemMailPatch = (): Partial<AdminSettings> | null => {
    const port = Number(smtpPort)
    if (!notificationMailboxValid || !Number.isInteger(port) || port < 1 || port > 65535) return null
    if (!smtpHost.trim()) return null
    return {
      notificationMailbox: notificationMailbox.trim().toLowerCase(),
      smtpHost: smtpHost.trim(),
      smtpPort: port,
      smtpUser: smtpUser.trim().toLowerCase(),
      // Omit entirely when blank so an untouched field never wipes the saved password.
      ...(smtpPass ? { smtpPass } : {}),
      smtpTls,
    }
  }

  const saveSystemMail = async () => {
    const patch = buildSystemMailPatch()
    if (!patch) {
      if (!notificationMailboxValid) notify(tx('settings.emailInvalid'), 'error')
      else if (!smtpPortValid) notify(tx('settings.portInvalid'), 'error')
      else if (!smtpHost.trim()) notify(tx('admin.smtpHostRequired', 'SMTP host is required.'), 'error')
      return
    }
    setMailSaving(true)
    try {
      await onSettings(patch)
      setSmtpPass('')
      notify(tx('admin.configSaved'), 'success')
    } catch {
      // Parent already toasts the error.
    } finally {
      setMailSaving(false)
    }
  }

  const clearSystemMailPass = async () => {
    try {
      await onSettings({ clearSmtpPass: true })
      setSmtpPass('')
      notify(tx('admin.configSaved'), 'success')
    } catch {
      // Parent already toasts the error.
    }
  }

  const testSystemMail = async (delivery: string) => {
    if (!onTestSystemMail) return
    const patch = buildSystemMailPatch()
    if (!patch) {
      if (!notificationMailboxValid) notify(tx('settings.emailInvalid'), 'error')
      else if (!smtpPortValid) notify(tx('settings.portInvalid'), 'error')
      else if (!smtpHost.trim()) notify(tx('admin.smtpHostRequired', 'SMTP host is required.'), 'error')
      else notify(tx('settings.mailNeedsSetup'), 'warning')
      return
    }
    setMailTesting(true)
    try {
      await onTestSystemMail(patch, delivery)
      notify(tx('admin.testEmailQueued'), 'success')
    } finally {
      setMailTesting(false)
    }
  }

  const buildDatabaseInput = (): DatabaseConnectionInput | null => {
    if (databaseDraft.type === 'sqlite') {
      return { type: 'sqlite', sqlitePath: databaseDraft.sqlitePath?.trim() || undefined }
    }
    const port = Number(databaseDraft.port)
    const hasSavedPassword = databaseConfiguration?.type === databaseDraft.type
      && Boolean(databaseConfiguration.passwordSet)
    if (
      !databaseDraft.host?.trim()
      || !Number.isInteger(port)
      || port < 1
      || port > 65535
      || !databaseDraft.database?.trim()
      || !databaseDraft.username?.trim()
      || (!databasePassword && !hasSavedPassword)
    ) return null
    return {
      type: databaseDraft.type,
      host: databaseDraft.host.trim(),
      port,
      database: databaseDraft.database.trim(),
      username: databaseDraft.username.trim(),
      ...(databasePassword ? { password: databasePassword } : {}),
      ssl: Boolean(databaseDraft.ssl),
      mysql57Compatibility: databaseDraft.type === 'mysql' && Boolean(databaseDraft.mysql57Compatibility),
      schema: databaseDraft.schema?.trim() || undefined,
    }
  }

  const testDatabase = async () => {
    const input = buildDatabaseInput()
    if (!input) {
      notify(tx('admin.database.connectionRequired'), 'error')
      return
    }
    setDatabaseTesting(true)
    try {
      await phdApi.testAdminDatabaseConfiguration(token, input)
      notify(tx('admin.database.testPassed'), 'success')
    } catch (error) {
      notify(normalizeErrorMessage(error, lang), 'error')
    } finally {
      setDatabaseTesting(false)
    }
  }

  const saveDatabase = async () => {
    const input = buildDatabaseInput()
    if (!input) {
      notify(tx('admin.database.connectionRequired'), 'error')
      return
    }
    setDatabaseSaving(true)
    try {
      const configuration = await phdApi.updateAdminDatabaseConfiguration(token, input)
      setDatabaseConfiguration(configuration)
      setDatabaseDraft(databaseDraftFromConfiguration(configuration))
      setDatabasePassword('')
      setDatabaseConfigurationLoaded(true)
      setWorkspaceBackups([])
      setWorkspaceBackupsLoaded(false)
      onRefreshSystemInfo()
      notify(tx('admin.database.saved'), 'success')
    } catch (error) {
      notify(normalizeErrorMessage(error, lang), 'error')
    } finally {
      setDatabaseSaving(false)
    }
  }

  const persistBackupSettings = async (patch: {
    backupFrequency?: BackupFrequency
    maxBackupsPerAppLimit?: number
  }) => {
    try {
      await onSettings(patch)
      notify(tx('admin.configSaved'), 'success')
    } catch {
      // Parent already toasts the error.
    }
  }

  const createWorkspaceBackup = async () => {
    setWorkspaceBackupBusy('create')
    try {
      await phdApi.createAdminBackup(token)
      await loadWorkspaceBackups(false)
      onRefreshSystemInfo()
      notify(tx('admin.workspaceBackupCreated'), 'success')
    } catch (error) {
      notify(normalizeErrorMessage(error, lang), 'error')
    } finally {
      setWorkspaceBackupBusy(null)
    }
  }

  const downloadWorkspaceBackup = async (backup: BackupRecord) => {
    setWorkspaceBackupBusy(backup.fileName)
    try {
      const blob = await phdApi.downloadAdminBackup(token, backup.fileName)
      downloadBlob(blob, backup.fileName)
      notify(tx('admin.workspaceBackupDownloaded'), 'success')
    } catch (error) {
      notify(normalizeErrorMessage(error, lang), 'error')
    } finally {
      setWorkspaceBackupBusy(null)
    }
  }

  const deleteWorkspaceBackup = async (backup: BackupRecord) => {
    setWorkspaceBackupBusy(backup.fileName)
    try {
      await phdApi.deleteAdminBackup(token, backup.fileName)
      setWorkspaceBackups((items) => items.filter((item) => item.fileName !== backup.fileName))
      setPendingBackupDelete(null)
      onRefreshSystemInfo()
      notify(tx('admin.workspaceBackupDeleted'), 'success')
    } catch (error) {
      notify(normalizeErrorMessage(error, lang), 'error')
    } finally {
      setWorkspaceBackupBusy(null)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      setPasswordFieldError('new')
      notify(tx('admin.passwordTooShort'), 'error')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordFieldError('confirm')
      notify(tx('admin.passwordMismatch'), 'error')
      return
    }
    setPasswordFieldError(null)
    setPasswordBusy(true)
    try {
      const ok = await onChangePassword(currentPassword, newPassword)
      if (ok) {
        setPasswordFieldError(null)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmNewPassword('')
        notify(tx('admin.passwordChanged'), 'success')
      }
    } catch (err) {
      setPasswordFieldError('current')
      notify(normalizeErrorMessage(err, lang), 'error')
    } finally {
      setPasswordBusy(false)
    }
  }

  const handleCheckReleaseUpdate = async () => {
    setCheckingReleaseUpdate(true)
    try {
      const result = await phdApi.checkSystemUpdate(token)
      setReleaseUpdate(result)
      if (!result.updateAvailable) notify(tx('admin.updateUpToDate'), 'success')
    } catch (err) {
      notify(normalizeErrorMessage(err, lang), 'error')
    } finally {
      setCheckingReleaseUpdate(false)
    }
  }

  const handleInstallReleaseUpdate = async () => {
    const release = releaseUpdate?.release
    if (!release || !releaseUpdate.updateAvailable) return
    setInstallingReleaseUpdate(true)
    try {
      const result = await phdApi.installReleaseUpdate(token, release.tagName)
      notify(
        result.restartScheduled
          ? tx('admin.updateRestarting')
          : tx('admin.updateStoredNoRestart'),
        result.restartScheduled ? 'success' : 'warning',
      )
      if (!result.restartScheduled) setInstallingReleaseUpdate(false)
    } catch (err) {
      setInstallingReleaseUpdate(false)
      notify(normalizeErrorMessage(err, lang), 'error')
    }
  }

  const handleUpdateFileSelection = (files: FileList | readonly File[] | null) => {
    const result = validateUploadFiles(files, {
      allowedTypes: ['.tar.gz', '.tgz'],
      maxFileSize: MAX_SYSTEM_UPDATE_FILE_SIZE,
      maxFiles: 1,
      multiple: false,
    })
    if (result.rejected.length > 0) {
      const messages: string[] = []
      const sizeFiles = filesRejectedForReason(result.rejected, 'size')
      const typeFiles = filesRejectedForReason(result.rejected, 'type')
      if (sizeFiles.length > 0) {
        messages.push(format(tx('fileUpload.filesTooLarge'), {
          names: sizeFiles.map((file) => file.name).join(', '),
          size: formatFileSize(MAX_SYSTEM_UPDATE_FILE_SIZE),
        }))
      }
      if (typeFiles.length > 0) {
        messages.push(format(tx('fileUpload.filesWrongType'), {
          names: typeFiles.map((file) => file.name).join(', '),
          types: '.tar.gz, .tgz',
        }))
      }
      if (filesRejectedForReason(result.rejected, 'single').length > 0) {
        messages.push(tx('fileUpload.singleFileOnly'))
      }
      notify(messages.join(' '), 'error')
    }
    setUpdateFile(result.accepted[0] ?? null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleUploadPackage = async () => {
    const file = updateFile
    if (!file) {
      notify(tx('admin.noPackageSelected'), 'error')
      return
    }
    setUploading(true)
    try {
      const ok = await onSystemUpdate(file)
      if (ok) {
        notify(tx('admin.updateUploaded'), 'success')
        if (fileInputRef.current) fileInputRef.current.value = ''
        setUpdateFile(null)
      }
    } catch (err) {
      notify(normalizeErrorMessage(err, lang), 'error')
    } finally {
      setUploading(false)
    }
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedPath(label)
      setTimeout(() => setCopiedPath(null), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedPath(label)
      setTimeout(() => setCopiedPath(null), 2000)
    }
  }

  const memoryPercent = systemInfo ? Math.round((systemInfo.memory.used / systemInfo.memory.total) * 100) : 0
  const healthStatus = memoryPercent > 90 ? 'danger' : memoryPercent > 70 ? 'warning' : 'ok'
  const memoryFillClass = memoryPercent < 50 ? 'admin-progress-fill-low' : memoryPercent < 75 ? 'admin-progress-fill-mid' : 'admin-progress-fill-high'
  const healthDotClass = healthStatus === 'danger' ? 'admin-health-danger' : healthStatus === 'warning' ? 'admin-health-warning' : ''
  const healthStatusText = healthStatus === 'danger' ? tx('admin.heroStatusError') : healthStatus === 'warning' ? tx('admin.heroStatusWarning') : tx('admin.heroStatusOk')
  const storageTotal = systemInfo?.storage.total ?? 0
  const storageItems = systemInfo ? [
    {
      key: 'database',
      label: tx('admin.databaseStorage'),
      Icon: Database,
      tone: 'accent',
      bytes: systemInfo.storage.database,
      fileCount: null,
    },
    {
      key: 'uploads',
      label: tx('admin.uploadsStorage'),
      Icon: Upload,
      tone: 'warning',
      bytes: systemInfo.storage.uploads,
      fileCount: systemInfo.storage.uploadFiles,
    },
    {
      key: 'backups',
      label: tx('admin.backupsStorage'),
      Icon: Package,
      tone: 'success',
      bytes: systemInfo.storage.backups,
      fileCount: systemInfo.storage.backupFiles,
    },
  ] : []

  return (
    <section className="simple-screen admin-screen">

      {/* ================================================================
          Tab: System Configuration
          ================================================================ */}
      {activeTab === 'systemConfig' && (
        <div className="admin-panel-grid" role="tabpanel" aria-label={tx('admin.tabs.systemConfig')}>
          {/* Registration Control */}
          <section className={`admin-card mail-collapsible admin-config-card ${registrationOpen ? 'expanded' : ''}`}>
            <button
              type="button"
              className="mail-config-summary"
              aria-expanded={registrationOpen}
              onClick={() => setRegistrationOpen((open) => !open)}
            >
              <span className="mail-config-icon registration" aria-hidden="true">
                <LockKeyhole size={15} />
              </span>
              <span className="mail-config-copy">
                <span className="eyebrow">{tx('admin.registration')}</span>
                <strong>{tx('admin.accessControl')}</strong>
                <small>{tx('admin.privacyNote')}</small>
              </span>
              <span className="mail-config-chips" aria-hidden="true">
                <span className={`mail-summary-chip ${settings.allowRegistration ? 'ok' : 'muted'}`}>
                  {settings.allowRegistration ? tx('settings.enabled') : tx('settings.disabled')}
                </span>
              </span>
              <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
            </button>
            <CollapsiblePanel open={registrationOpen} className="mail-config-detail" innerClassName="mail-config-detail-inner">
              <label className="admin-toggle-row admin-setting-line">
                <span>{tx('admin.allowRegistration')}</span>
                <SwitchControl
                  checked={settings.allowRegistration}
                  label={tx('admin.allowRegistration')}
                  variant="success"
                  onChange={(v) => onRegistration(v)}
                />
              </label>
            </CollapsiblePanel>
          </section>

          {/* Encryption at Rest */}
          <section className={`admin-card mail-collapsible admin-config-card ${encryptionOpen ? 'expanded' : ''}`}>
            <button
              type="button"
              className="mail-config-summary"
              aria-expanded={encryptionOpen}
              onClick={() => setEncryptionOpen((open) => !open)}
            >
              <span className="mail-config-icon security" aria-hidden="true">
                <ShieldCheck size={15} />
              </span>
              <span className="mail-config-copy">
                <span className="eyebrow">{tx('settings.security')}</span>
                <strong>{tx('admin.encryptionAtRest')}</strong>
                <small>{tx('admin.encryptionAtRestDesc')}</small>
              </span>
              <span className="mail-config-chips" aria-hidden="true">
                <span className={`mail-summary-chip ${settings.encryptionAtRest ? 'ok' : 'warning'}`}>
                  {settings.encryptionAtRest ? tx('settings.enabled') : tx('settings.disabled')}
                </span>
                {settings.encryptionAtRest ? (
                  <span className="mail-summary-chip muted">
                    {settings.encryptionAlgorithm === 'chacha20-poly1305'
                      ? tx('admin.encryptionAlgoChaCha')
                      : tx('admin.encryptionAlgoAes')}
                  </span>
                ) : null}
              </span>
              <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
            </button>
            <CollapsiblePanel open={encryptionOpen} className="mail-config-detail" innerClassName="mail-config-detail-inner">
              <EncryptionSettingsPanel
                settings={settings}
                databaseType={databaseConfiguration?.type ?? null}
                busy={encryptionBusy}
                onApply={async (patch) => {
                  setEncryptionBusy(true)
                  try {
                    await onSettings(patch)
                    notify(tx('admin.encryptionApplied'), 'success')
                  } catch (error) {
                    notify(
                      normalizeErrorMessage(error, lang, tx('admin.encryptionApplyFailed')),
                      'error',
                    )
                    throw error
                  } finally {
                    setEncryptionBusy(false)
                  }
                }}
                onLocalError={(message) => notify(message, 'error')}
                tx={tx}
              />
            </CollapsiblePanel>
          </section>

          {/* Admin Session Window */}
          <section className={`admin-card mail-collapsible admin-config-card ${sessionConfigOpen ? 'expanded' : ''}`}>
            <button
              type="button"
              className="mail-config-summary"
              aria-expanded={sessionConfigOpen}
              onClick={() => setSessionConfigOpen((open) => !open)}
            >
              <span className="mail-config-icon session" aria-hidden="true">
                <Clock size={15} />
              </span>
              <span className="mail-config-copy">
                <span className="eyebrow">{tx('settings.sessionMode')}</span>
                <strong>{tx('admin.loginSession')}</strong>
                <small>{tx('admin.loginSessionDesc')}</small>
              </span>
              <span className="mail-config-chips" aria-hidden="true">
                <span className="mail-summary-chip">{currentSessionDurationLabel}</span>
              </span>
              <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
            </button>
            <CollapsiblePanel open={sessionConfigOpen} className="mail-config-detail" innerClassName="mail-config-detail-inner">
              <div className="admin-session-control">
                <span className="admin-session-control-label">{tx('settings.validFor')}</span>
                <Select
                  size="small"
                  value={adminSessionDuration}
                  options={adminSessionDurationOptions.map((option) => ({
                    value: option.value,
                    label: tx(option.labelKey, option.fallback),
                  }))}
                  onChange={(value) => {
                    setAdminSessionDuration(value)
                    void (async () => {
                      try {
                        await onSettings({ adminSessionDurationMinutes: Number(value) })
                        notify(tx('admin.configSaved'), 'success')
                      } catch {
                        // Parent already toasts the error.
                      }
                    })()
                  }}
                  ariaLabel={tx('settings.validFor')}
                />
              </div>
            </CollapsiblePanel>
          </section>

          {/* Change Admin Password */}
          <section className={`admin-card mail-collapsible admin-config-card ${passwordConfigOpen ? 'expanded' : ''}`}>
            <button
              type="button"
              className="mail-config-summary"
              aria-expanded={passwordConfigOpen}
              onClick={() => {
                setPasswordConfigOpen((open) => {
                  const next = !open
                  if (!next) setPasswordFieldError(null)
                  return next
                })
              }}
            >
              <span className="mail-config-icon security" aria-hidden="true">
                <LockKeyhole size={15} />
              </span>
              <span className="mail-config-copy">
                <span className="eyebrow">{tx('settings.security')}</span>
                <strong>{tx('admin.changePassword')}</strong>
                <small>{tx('admin.changePasswordDesc')}</small>
              </span>
              <span className="mail-config-chips" aria-hidden="true">
                <span className="mail-summary-chip muted">{tx('admin.passwordMinimum')}</span>
              </span>
              <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
            </button>
            <CollapsiblePanel open={passwordConfigOpen} className="mail-config-detail" innerClassName="mail-config-detail-inner" collapseMs={260} keepMounted>
              <div className="admin-password-form">
                <label className={passwordFieldError === 'current' ? 'has-error' : undefined}>
                  <span>
                    {tx('admin.currentPassword')}
                  </span>
                  <input
                    type="password"
                    value={currentPassword}
                    aria-invalid={passwordFieldError === 'current' || undefined}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value)
                      if (passwordFieldError === 'current') setPasswordFieldError(null)
                    }}
                  />
                </label>
                <label className={passwordFieldError === 'new' ? 'has-error' : undefined}>
                  <span>
                    {tx('admin.newPassword')}
                  </span>
                  <input
                    type="password"
                    value={newPassword}
                    aria-invalid={passwordFieldError === 'new' || undefined}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      if (passwordFieldError === 'new') setPasswordFieldError(null)
                    }}
                  />
                </label>
                <label className={passwordFieldError === 'confirm' ? 'has-error' : undefined}>
                  <span>
                    {tx('admin.confirmNewPassword')}
                  </span>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    aria-invalid={passwordFieldError === 'confirm' || undefined}
                    onChange={(e) => {
                      setConfirmNewPassword(e.target.value)
                      if (passwordFieldError === 'confirm') setPasswordFieldError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleChangePassword()
                    }}
                  />
                </label>
              </div>
              <div className="admin-card-actions">
                <button type="button" className="quiet-action" disabled={passwordBusy} onClick={() => void handleChangePassword()}>
                  {passwordBusy ? (
                    <><RefreshCw size={13} aria-hidden="true" className="spin-icon" /> {tx('working')}</>
                  ) : (
                    <><LockKeyhole size={13} aria-hidden="true" /> {tx('admin.changePasswordButton')}</>
                  )}
                </button>
              </div>
            </CollapsiblePanel>
          </section>

          {/* SMTP Configuration */}
          <section className={`admin-card admin-card-wide mail-collapsible ${systemMailOpen ? 'expanded' : ''}`}>
            <button
              type="button"
              className="mail-config-summary admin-mail-summary"
              aria-expanded={systemMailOpen}
              onClick={() => setSystemMailOpen((open) => !open)}
            >
              <span className="mail-config-icon outgoing" aria-hidden="true">
                <Mail size={15} />
              </span>
              <span className="mail-config-copy">
                <span className="eyebrow">{tx('admin.notificationConfiguration')}</span>
                <strong>{tx('admin.systemMail')}</strong>
                <small>{smtpHost.trim() ? `${smtpHost.trim()}:${smtpPort || 587}` : tx('settings.mailNotConfigured')}</small>
              </span>
              <span className="mail-config-chips" aria-hidden="true">
                <span className={`mail-summary-chip ${systemMailConfigured ? 'ok' : 'warning'}`}>
                  {systemMailConfigured ? tx('settings.mailConfigured') : tx('settings.mailNeedsSetup')}
                </span>
                <span className="mail-summary-chip">{notificationMailboxValid ? notificationMailbox.trim().toLowerCase() : tx('settings.emailInvalid')}</span>
                <span className="mail-summary-chip muted">{smtpTls ? 'TLS' : tx('settings.tlsOff')}</span>
              </span>
              <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
            </button>
            <CollapsiblePanel open={systemMailOpen} className="mail-config-detail" innerClassName="mail-config-detail-inner">
                <p className="mail-config-desc">{tx('admin.systemMailDesc')}</p>
                <div className="admin-mail-grid">
                  <label>
                    <span>{tx('settings.notificationMailbox')}</span>
                    <input
                      className={notificationMailboxValid ? '' : 'invalid'}
                      value={notificationMailbox}
                      onChange={(event) => setNotificationMailbox(event.target.value)}
                      aria-invalid={!notificationMailboxValid}
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    <span>{tx('settings.smtpHost')}</span>
                    <input value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="smtp.example.com" autoComplete="off" />
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
                      inputMode="numeric"
                    />
                  </label>
                  <label>
                    <span>{tx('settings.smtpUser')}</span>
                    <input value={smtpUser} onChange={(event) => setSmtpUser(event.target.value)} autoComplete="username" />
                  </label>
                  <label>
                    <span>{tx('settings.smtpPass')}</span>
                    <div className="setting-inline-edit">
                      <input
                        type="password"
                        value={smtpPass}
                        onChange={(event) => setSmtpPass(event.target.value)}
                        placeholder={settings.smtpPassSet ? tx('settings.passwordSavedPlaceholder') : ''}
                        autoComplete="new-password"
                      />
                      {settings.smtpPassSet && !smtpPass ? (
                        <button type="button" className="icon-action" onClick={clearSystemMailPass} title={tx('settings.removePassword')} aria-label={tx('settings.removePassword')}>
                          <XCircle size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </label>
                </div>
                {!notificationMailboxValid ? <em className="settings-inline-error">{tx('settings.emailInvalid')}</em> : null}
                {!smtpPortValid ? <em className="settings-inline-error">{tx('settings.portInvalid')}</em> : null}
                <div className="admin-card-actions mail-admin-actions">
                  <label className="admin-inline-check">
                    <SwitchControl
                      checked={smtpTls}
                      label={tx('settings.smtpTls')}
                      variant="accent"
                      onChange={(v) => setSmtpTls(v)}
                    />
                    <span>{tx('settings.smtpTls')}</span>
                  </label>
                  <div className="mail-config-button-row admin-mail-button-row">
                    <button
                      type="button"
                      className="quiet-action compact-action mail-save-btn save-action"
                      onClick={() => void saveSystemMail()}
                      disabled={mailSaving || mailTesting}
                    >
                      {mailSaving ? (
                        <><RefreshCw size={12} aria-hidden="true" className="spin-icon" /> {tx('working')}</>
                      ) : (
                        <><Send size={12} aria-hidden="true" /> {tx('admin.saveSystemMail')}</>
                      )}
                    </button>
                    {onTestSystemMail ? (
                      <InlineTestEmailAction
                        defaultEmail={notificationMailbox.trim().toLowerCase()}
                        disabled={!systemMailConfigured || mailSaving}
                        openLabel={tx('settings.sendTestEmail')}
                        inputLabel={tx('settings.testEmailRecipient')}
                        inputPlaceholder={tx('settings.testEmailRecipientPlaceholder')}
                        sendLabel={tx('settings.sendTestNow')}
                        cancelLabel={tx('settings.cancelTestEmail')}
                        sendingLabel={tx('settings.sendingTestEmail')}
                        invalidEmailLabel={tx('settings.emailInvalid')}
                        onSend={testSystemMail}
                      />
                    ) : null}
                  </div>
                </div>
            </CollapsiblePanel>
          </section>

          {/* Database Configuration */}
          <section className={`admin-card admin-card-wide mail-collapsible ${databaseConfigOpen ? 'expanded' : ''}`}>
            <button
              type="button"
              className="mail-config-summary admin-mail-summary"
              aria-expanded={databaseConfigOpen}
              onClick={() => {
                setDatabaseConfigOpen((open) => {
                  const next = !open
                  if (next) {
                    setDatabaseConfigurationLoaded(false)
                    void loadDatabaseConfiguration()
                  }
                  return next
                })
              }}
            >
              <span className="mail-config-icon backup" aria-hidden="true">
                <Database size={15} />
              </span>
              <span className="mail-config-copy">
                <span className="eyebrow">{tx('admin.database.config')}</span>
                <strong>{tx('admin.database.active')}</strong>
                <small>{databaseConfiguration?.type === 'sqlite'
                  ? databaseConfiguration.sqlitePath
                  : databaseConfiguration ? `${databaseConfiguration.host}:${databaseConfiguration.port} / ${databaseConfiguration.database}` : tx('working')}</small>
              </span>
              <span className="mail-config-chips" aria-hidden="true">
                <span className="mail-summary-chip">{tx(`admin.database.${databaseConfiguration?.type ?? 'sqlite'}`)}</span>
                {databaseConfiguration?.type === 'mysql' && databaseConfiguration.mysql57Compatibility ? <span className="mail-summary-chip">5.7.44</span> : null}
                {databaseConfiguration && databaseConfiguration.type !== 'sqlite' ? <span className="mail-summary-chip ok">{databaseConfiguration.ssl ? 'TLS' : tx('settings.tlsOff')}</span> : null}
              </span>
              <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
            </button>
            <CollapsiblePanel open={databaseConfigOpen} className="mail-config-detail" innerClassName="mail-config-detail-inner">
              <p className="mail-config-desc">{tx('admin.database.configDesc')}</p>
              {databaseLoading ? (
                <div className="admin-mail-grid" aria-busy="true">
                  <Skeleton height={36} radius={8} />
                  <Skeleton height={36} radius={8} />
                </div>
              ) : (
                <>
                  <div className="admin-mail-grid admin-database-grid">
                    <label className="admin-database-wide">
                      <span>{tx('admin.database.engine')}</span>
                      <Select
                        size="small"
                        value={databaseDraft.type}
                        ariaLabel={tx('admin.database.engine')}
                        options={databaseEngineOptions.map((engine) => ({ value: engine, label: tx(`admin.database.${engine}`) }))}
                        onChange={(value) => {
                          const type = value as DatabaseEngine
                          setDatabaseDraft((current) => ({
                            type,
                            sqlitePath: type === 'sqlite' ? current.sqlitePath ?? '' : undefined,
                            host: type === 'sqlite' ? undefined : current.host ?? '',
                            port: type === 'sqlite' ? undefined : defaultDatabasePort(type),
                            database: type === 'sqlite' ? undefined : current.database ?? '',
                            username: type === 'sqlite' ? undefined : current.username ?? '',
                            ssl: type === 'sqlite' ? undefined : current.ssl ?? false,
                            mysql57Compatibility: type === 'mysql' ? (current.type === 'mysql' ? Boolean(current.mysql57Compatibility) : false) : undefined,
                            schema: type === 'sqlite' ? undefined : current.schema ?? '',
                          }))
                          setDatabasePassword('')
                        }}
                      />
                    </label>
                    {databaseDraft.type === 'sqlite' ? (
                      <label className="admin-database-wide">
                        <span>{tx('admin.database.sqlitePath')}</span>
                        <input
                          value={databaseDraft.sqlitePath ?? ''}
                          onChange={(event) => setDatabaseDraft((current) => ({ ...current, sqlitePath: event.target.value }))}
                          placeholder={tx('admin.database.sqlitePathPlaceholder')}
                        />
                        <small>{tx('admin.database.sqlitePathHint')}</small>
                      </label>
                    ) : (
                      <>
                        <label className="admin-database-wide">
                          <span>{tx('admin.database.host')}</span>
                          <input value={databaseDraft.host ?? ''} onChange={(event) => setDatabaseDraft((current) => ({ ...current, host: event.target.value }))} placeholder="db.example.com" />
                        </label>
                        <label>
                          <span>{tx('admin.database.port')}</span>
                          <input type="number" min={1} max={65535} value={databaseDraft.port ?? ''} onChange={(event) => setDatabaseDraft((current) => ({ ...current, port: Number(event.target.value) }))} inputMode="numeric" />
                        </label>
                        <label>
                          <span>{tx('admin.database.name')}</span>
                          <input value={databaseDraft.database ?? ''} onChange={(event) => setDatabaseDraft((current) => ({ ...current, database: event.target.value }))} />
                        </label>
                        <label>
                          <span>{tx('admin.database.username')}</span>
                          <input value={databaseDraft.username ?? ''} onChange={(event) => setDatabaseDraft((current) => ({ ...current, username: event.target.value }))} autoComplete="username" />
                        </label>
                        <label>
                          <span>{tx('admin.database.password')}</span>
                          <input type="password" value={databasePassword} onChange={(event) => setDatabasePassword(event.target.value)} placeholder={databaseConfiguration?.passwordSet ? tx('admin.database.passwordSaved') : ''} autoComplete="new-password" />
                        </label>
                        <label className="admin-database-wide">
                          <span>{tx('admin.database.schema')}</span>
                          <input value={databaseDraft.schema ?? ''} onChange={(event) => setDatabaseDraft((current) => ({ ...current, schema: event.target.value }))} placeholder={databaseDraft.type === 'postgresql' ? 'public' : 'dbo'} />
                        </label>
                        {databaseDraft.type === 'mysql' ? (
                          <label className="admin-inline-check admin-database-wide">
                            <SwitchControl checked={Boolean(databaseDraft.mysql57Compatibility)} label={tx('admin.database.mysql57Compatibility')} variant="accent" onChange={(mysql57Compatibility) => setDatabaseDraft((current) => ({ ...current, mysql57Compatibility }))} />
                            <span>{tx('admin.database.mysql57Compatibility')}</span>
                            <small>{tx('admin.database.mysql57CompatibilityHint')}</small>
                          </label>
                        ) : null}
                      </>
                    )}
                  </div>
                  {databaseDraft.type !== 'sqlite' ? (
                    <label className="admin-inline-check">
                      <SwitchControl checked={Boolean(databaseDraft.ssl)} label={tx('admin.database.ssl')} variant="accent" onChange={(ssl) => setDatabaseDraft((current) => ({ ...current, ssl }))} />
                      <span>{tx('admin.database.ssl')}</span>
                      <small>{tx('admin.database.sslHint')}</small>
                    </label>
                  ) : null}
                  <p className="settings-inline-note">{databaseDraft.type === 'sqlite' ? tx('admin.database.sqlitePathHint') : tx('admin.database.externalHint')}</p>
                  <div className="admin-card-actions mail-admin-actions">
                    <button type="button" className="quiet-action compact-action" onClick={() => void testDatabase()} disabled={databaseTesting || databaseSaving}>
                      {databaseTesting ? <><RefreshCw size={12} aria-hidden="true" className="spin-icon" /> {tx('admin.database.testing')}</> : <><Server size={12} aria-hidden="true" /> {tx('admin.database.test')}</>}
                    </button>
                    <button type="button" className="quiet-action compact-action save-action" onClick={() => void saveDatabase()} disabled={databaseTesting || databaseSaving}>
                      {databaseSaving ? <><RefreshCw size={12} aria-hidden="true" className="spin-icon" /> {tx('admin.database.saving')}</> : <><Save size={12} aria-hidden="true" /> {tx('admin.database.save')}</>}
                    </button>
                  </div>
                </>
              )}
            </CollapsiblePanel>
          </section>

          {/* Backup Configuration */}
          <section className={`admin-card admin-card-wide mail-collapsible admin-backup-card ${backupConfigOpen ? 'expanded' : ''}`}>
            <button
              type="button"
              className="mail-config-summary"
              onClick={() => setBackupConfigOpen((open) => !open)}
              aria-expanded={backupConfigOpen}
            >
              <span className="mail-config-icon backup" aria-hidden="true">
                <Save size={15} />
              </span>
              <span className="mail-config-copy">
                <span className="eyebrow">{tx('admin.backupConfig')}</span>
                <strong>{tx('admin.backupFrequencyLabel')}</strong>
                <small>{tx('admin.backupFrequencyDesc')}</small>
              </span>
              <span className="mail-config-chips" aria-hidden="true">
                <span className="mail-summary-chip">{currentBackupFrequencyLabel}</span>
                <span className="mail-summary-chip muted">{format(tx('settings.backupLimitValue'), { limit: maxBackupsLimit })}</span>
                <span className="mail-summary-chip muted">
                  {workspaceBackupsLoaded ? format(tx('admin.workspaceBackupCount'), { count: workspaceBackups.length }) : tx('admin.workspaceBackups')}
                </span>
              </span>
              <ChevronDown className="mail-config-chevron" size={15} aria-hidden="true" />
            </button>
            <CollapsiblePanel open={backupConfigOpen} className="mail-config-detail" innerClassName="mail-config-detail-inner admin-backup-detail">
              <div className="admin-backup-config-grid">
                <div className="admin-field">
                  <span>{tx('settings.backupFrequency')}</span>
                  <Select
                    size="small"
                    value={backupFrequency}
                    ariaLabel={tx('settings.backupFrequency')}
                    options={backupFrequencyOptions.map((option) => ({
                      value: option.value,
                      label: tx(option.labelKey, option.fallback),
                    }))}
                    onChange={(value) => {
                      const next = value as BackupFrequency
                      setBackupFrequency(next)
                      void persistBackupSettings({ backupFrequency: next })
                    }}
                  />
                </div>
                <div className="admin-field">
                  <span>{tx('settings.maxBackupsPerAppLimit')}</span>
                  <Select
                    size="small"
                    value={maxBackupsLimit}
                    ariaLabel={tx('settings.maxBackupsPerAppLimit')}
                    options={backupLimitOptions.map((value) => ({ value, label: format(tx('settings.backupLimitValue'), { limit: value }) }))}
                    onChange={(value) => {
                      setMaxBackupsLimit(value)
                      void persistBackupSettings({ maxBackupsPerAppLimit: Number(value) })
                    }}
                  />
                </div>
              </div>
              <p className="settings-inline-note">{tx('settings.maxBackupsPerAppLimitDesc')}</p>

              <div className="admin-workspace-backups">
                <div className="admin-workspace-backups-head">
                  <div>
                    <span className="eyebrow">{tx('admin.workspaceBackups')}</span>
                    <h4>{format(tx('admin.workspaceBackupCount'), { count: workspaceBackups.length })}</h4>
                    <p>{tx('admin.workspaceBackupsDesc')}</p>
                  </div>
                  <div className="admin-workspace-backups-actions">
                    <button
                      type="button"
                      className="icon-action"
                      onClick={() => void loadWorkspaceBackups()}
                      disabled={workspaceBackupsLoading || workspaceBackupBusy !== null}
                      title={tx('admin.refreshBackups')}
                      aria-label={tx('admin.refreshBackups')}
                    >
                      <RefreshCw size={14} aria-hidden="true" className={workspaceBackupsLoading ? 'spin-icon' : undefined} />
                    </button>
                    <button
                      type="button"
                      className="quiet-action save-action"
                      onClick={() => void createWorkspaceBackup()}
                      disabled={workspaceBackupBusy !== null}
                    >
                      {workspaceBackupBusy === 'create' ? (
                        <><RefreshCw size={13} aria-hidden="true" className="spin-icon" /> {tx('admin.creatingWorkspaceBackup')}</>
                      ) : (
                        <><Save size={13} aria-hidden="true" /> {tx('admin.createWorkspaceBackup')}</>
                      )}
                    </button>
                  </div>
                </div>
                {workspaceBackupsLoading ? (
                  <div className="admin-workspace-backup-loading" aria-label={tx('admin.loadingBackups')} aria-busy="true">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="admin-workspace-backup-loading-row">
                        <Skeleton width={34} height={34} radius={8} />
                        <div>
                          <Skeleton width={index === 1 ? '58%' : '72%'} height={12} />
                          <Skeleton width={index === 2 ? '42%' : '52%'} height={10} />
                        </div>
                        <Skeleton width={72} height={28} radius={6} />
                      </div>
                    ))}
                  </div>
                ) : workspaceBackups.length > 0 ? (
                  <div className="admin-workspace-backup-list">
                    {workspaceBackups.map((backup, index) => (
                      <div className="admin-workspace-backup-item" key={backup.fileName}>
                        <span className="admin-workspace-backup-icon" aria-hidden="true">
                          <Database size={15} />
                        </span>
                        <span className="admin-workspace-backup-copy">
                          <strong>{backup.fileName}</strong>
                          <small>
                            {formatAdminDateTime(backup.createdAt, lang, tx('admin.neverLoggedIn'))}
                            {' · '}
                            {formatBytes(backup.size)}
                            {index === 0 ? ` · ${tx('admin.latestBackup')}` : ''}
                          </small>
                        </span>
                        <span className="admin-workspace-backup-actions-row">
                          <button
                            type="button"
                            className="icon-action"
                            onClick={() => void downloadWorkspaceBackup(backup)}
                            disabled={workspaceBackupBusy !== null}
                            title={tx('admin.downloadBackup')}
                            aria-label={tx('admin.downloadBackup')}
                          >
                            <Download size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="icon-action danger"
                            onClick={() => setPendingBackupDelete(backup)}
                            disabled={workspaceBackupBusy !== null}
                            title={tx('admin.deleteBackup')}
                            aria-label={tx('admin.deleteBackup')}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="admin-workspace-backup-empty">
                    <HardDrive size={18} aria-hidden="true" />
                    <strong>{tx('admin.noWorkspaceBackups')}</strong>
                    <p>{tx('admin.noWorkspaceBackupsDesc')}</p>
                  </div>
                )}
              </div>
            </CollapsiblePanel>
          </section>

        </div>
      )}

      <ConfirmDialog
        open={!!pendingBackupDelete}
        title={tx('admin.deleteBackupTitle')}
        message={format(tx('admin.deleteBackupMessage'), { fileName: pendingBackupDelete?.fileName ?? '' })}
        confirmLabel={workspaceBackupBusy === pendingBackupDelete?.fileName ? tx('admin.deletingBackup') : tx('admin.deleteBackup')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={() => {
          if (pendingBackupDelete) void deleteWorkspaceBackup(pendingBackupDelete)
        }}
        onCancel={() => {
          if (workspaceBackupBusy !== pendingBackupDelete?.fileName) setPendingBackupDelete(null)
        }}
      />

      {/* ================================================================
          Tab: User Management
          ================================================================ */}
      {activeTab === 'userManagement' && (
        <div className="admin-panel-grid" role="tabpanel" aria-label={tx('admin.tabs.userManagement')}>
          <NotificationPublisherPanel
            className="admin-card admin-card-wide"
            eyebrow={tx('admin.notificationPublisherEyebrow')}
            title={tx('admin.notificationPublisherTitle')}
            description={tx('admin.notificationPublisherDesc')}
            recipientField="userIds"
            recipients={notificationRecipients}
            groups={notificationGroups}
            audiences={notificationAudiences}
            onPublish={(input) => phdApi.publishAdminNotification(token, input)}
            onCreateGroup={createNotificationGroup}
            onDeleteGroup={deleteNotificationGroup}
          />
          <div className={`admin-account-view-switch is-${accountView}`} role="tablist" aria-label={tx('admin.accountViewsLabel')}>
            <button
              type="button"
              role="tab"
              aria-selected={accountView === 'personal'}
              className={accountView === 'personal' ? 'active' : ''}
              onClick={() => setAccountView('personal')}
            >
              <UserRound size={13} aria-hidden="true" />
              {tx('admin.personalAccounts')}
              <span>{adminListUsers.length}</span>
            </button>
            {!PUBLIC_EDITION ? (
              <button
                type="button"
                role="tab"
                aria-selected={accountView === 'teams'}
                className={accountView === 'teams' ? 'active' : ''}
                onClick={() => setAccountView('teams')}
              >
                <Users size={13} aria-hidden="true" />
                {tx('admin.teamAccounts')}
                <span>{teamAccounts.length}</span>
              </button>
            ) : null}
          </div>
          {accountView === 'personal' ? (
          <section className="admin-card admin-card-wide admin-account-view-panel is-personal">
            <div className="admin-card-head">
              <div>
                <span className="eyebrow">{tx('admin.users')}</span>
                <h3>{format(tx('admin.userCount'), { count: adminListUsers.length })}</h3>
                <p>{format(tx('admin.storageTotal'), { total: formatBytes(totalUsed) })}</p>
              </div>
              <UserRound size={17} aria-hidden="true" />
            </div>

            <div className="admin-user-toolbar">
              <label className="admin-user-search">
                <Search size={14} aria-hidden="true" />
                <span className="sr-only">{tx('admin.searchUsers')}</span>
                <input
                  type="search"
                  value={userSearch}
                  placeholder={tx('admin.searchUsersPlaceholder')}
                  onChange={(event) => setUserSearch(event.target.value)}
                />
              </label>
              <div className="admin-user-result-meta">
                {format(tx('admin.userResultRange'), {
                  start: userRangeStart,
                  end: userRangeEnd,
                  total: filteredSortedUsers.length,
                })}
              </div>
            </div>

            {filteredSortedUsers.length === 0 ? (
              <div className="admin-user-empty">
                <div className="empty-state-icon"><UserRound size={22} aria-hidden="true" /></div>
                <h3>{tx('admin.noUsersFound')}</h3>
                <p>{tx(userSearch.trim() ? 'admin.noUsersMatch' : 'admin.noUsers')}</p>
              </div>
            ) : (
              <div className="admin-user-table-wrap atlas-table-shell" onContextMenu={openUserTableMenu}>
                <table className="admin-user-table atlas-table">
                  <TableColGroup columns={userTableColumns} api={userTableApi} />
                  <thead>
                    <tr>
                      <TableHeaderCell column={userCol.account} api={userTableApi}>{renderUserSortHeader('email', tx('admin.userColumnAccount'))}</TableHeaderCell>
                      <TableHeaderCell column={userCol.role} api={userTableApi}>{renderUserSortHeader('role', tx('admin.userColumnRole'))}</TableHeaderCell>
                      <TableHeaderCell column={userCol.status} api={userTableApi}>{renderUserSortHeader('status', tx('admin.userColumnStatus'))}</TableHeaderCell>
                      <TableHeaderCell column={userCol.records} api={userTableApi}>{renderUserSortHeader('applicationCount', tx('admin.userColumnRecords'))}</TableHeaderCell>
                      <TableHeaderCell column={userCol.storage} api={userTableApi}>{renderUserSortHeader('storageUsedBytes', tx('admin.userColumnStorage'))}</TableHeaderCell>
                      <TableHeaderCell column={userCol.quota} api={userTableApi}>{renderUserSortHeader('storageQuotaMb', tx('admin.userColumnQuota'))}</TableHeaderCell>
                      <TableHeaderCell column={userCol.lastLogin} api={userTableApi}>{renderUserSortHeader('lastLoginAt', tx('admin.userColumnLastLogin'))}</TableHeaderCell>
                      <TableHeaderCell column={userCol.actions} api={userTableApi}><span>{tx('admin.userColumnActions')}</span></TableHeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((user) => {
                      const persistedAccountType = accountTypeForUser(user)
                      const accountType = pendingAccountTypes[user.id] ?? persistedAccountType
                      const userUpdating = updatingUserIds.has(user.id)
                      const quota = Number(user.storageQuotaMb || user.settings.storageQuotaMb || (accountType === 'free' ? 5 : 100))
                      const storageUnlimited = user.storageQuotaBytes === null || accountType === 'admin'
                      const applicationQuota = Math.max(1, Number(user.applicationQuota ?? user.settings.applicationQuota ?? 100) || 100)
                      const applicationCreateQuota = Math.max(1, Number(user.applicationCreateQuota ?? user.settings.applicationCreateQuota ?? applicationQuota) || applicationQuota)
                      const applicationCreatedCount = Number(user.applicationCreatedCount ?? user.settings.applicationCreatedCount ?? user.applicationCount ?? 0)
                      const applicationQuotaUnlimited = isUnlimitedQuota(applicationQuota) || accountType === 'admin'
                      const applicationCreateQuotaUnlimited = isUnlimitedQuota(applicationCreateQuota) || accountType !== 'free'
                      const shareQuota = Math.max(1, Number(user.shareQuota ?? user.settings.shareQuota ?? 100) || 100)
                      const shareCreateQuota = Math.max(1, Number(user.shareCreateQuota ?? user.settings.shareCreateQuota ?? shareQuota) || shareQuota)
                      const activeShareCount = Number(user.activeShareCount ?? 0)
                      const shareCreatedCount = Number(user.shareCreatedCount ?? user.settings.shareCreatedCount ?? activeShareCount)
                      const shareQuotaUnlimited = isUnlimitedQuota(shareQuota) || accountType === 'admin'
                      const shareCreateQuotaUnlimited = isUnlimitedQuota(shareCreateQuota) || accountType === 'admin'
                      const usedBytes = Number(user.storageUsedBytes ?? 0)
                      const percent = storageUnlimited ? 0 : Math.min(100, Math.round((usedBytes / (quota * 1024 * 1024)) * 100))
                      const applicationPercent = applicationQuotaUnlimited ? 0 : Math.min(100, Math.round((Number(user.applicationCount ?? 0) / applicationQuota) * 100))
                      const applicationCreatePercent = applicationCreateQuotaUnlimited ? 0 : Math.min(100, Math.round((applicationCreatedCount / applicationCreateQuota) * 100))
                      const sharePercent = shareQuotaUnlimited ? 0 : Math.min(100, Math.round((activeShareCount / shareQuota) * 100))
                      const shareCreatePercent = shareCreateQuotaUnlimited ? 0 : Math.min(100, Math.round((shareCreatedCount / shareCreateQuota) * 100))
                      const isCurrentUser = user.id === currentUserId
                      const isDisabled = Boolean(user.disabledAt)
                      const confirmingDelete = pendingDeleteUserId === user.id
                      return (
                        <tr key={user.id} className={isDisabled ? 'admin-user-disabled-row' : undefined}>
                          <TableCell columnId="account" api={userTableApi}>
                            <div className="admin-user-main admin-user-main-table">
                              <UserRound size={15} aria-hidden="true" />
                              <div>
                                <strong>{user.email}</strong>
                                <span>{user.name}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell columnId="role" api={userTableApi}>
                            {isCurrentUser ? (
                              <span className="admin-role-static">{tx(`admin.accountType.${accountType}`)}</span>
                            ) : (
                              <div className="admin-account-type-stack">
                                <Select
                                  size="small"
                                  value={accountType}
                                  options={accountTypes.map((type) => ({ value: type, label: tx(`admin.accountType.${type}`) }))}
                                  ariaLabel={format(tx('admin.accountTypeForUser'), { email: user.email })}
                                  disabled={userUpdating}
                                  onChange={(type) => handleAccountTypeChange(user.id, type as AccountType)}
                                />
                              </div>
                            )}
                          </TableCell>
                          <TableCell columnId="status" api={userTableApi}>
                            <span className={`admin-user-status ${isDisabled ? 'admin-user-status-disabled' : 'admin-user-status-active'}`}>
                              {tx(isDisabled ? 'admin.statusDisabled' : 'admin.statusActive')}
                            </span>
                          </TableCell>
                          <TableCell columnId="records" api={userTableApi}>
                            <div className="admin-record-quota-stack">
                              <div className="admin-record-quota-line">
                                <div className="admin-record-quota-head">
                                  <span>{format(tx('admin.recordUsage'), { count: user.applicationCount, limit: formatQuotaLimit(applicationQuota) })}</span>
                                  {applicationQuotaUnlimited ? (
                                    <span className="admin-quota-infinite">∞</span>
                                  ) : (
                                    <QuotaEditor
                                      key={`${user.id}-applications`}
                                      quota={applicationQuota}
                                      label={tx('admin.applicationQuota')}
                                      editLabel={tx('admin.editApplicationQuota')}
                                      max={10000}
                                      variant="compact"
                                      showValue={false}
                                      onCommit={(next) => void commitUserUpdate(user.id, { applicationQuota: next })}
                                    />
                                  )}
                                </div>
                                <div
                                  className="admin-mini-progress"
                                  role="progressbar"
                                  aria-label={tx('admin.recordUsageLabel')}
                                  aria-valuemin={0}
                                  aria-valuemax={applicationQuota}
                                  aria-valuenow={Math.min(Number(user.applicationCount ?? 0), applicationQuota)}
                                  aria-valuetext={format(tx('admin.recordUsage'), { count: user.applicationCount, limit: formatQuotaLimit(applicationQuota) })}
                                >
                                  <i className={quotaProgressClass(applicationPercent)} style={{ width: `${applicationPercent}%` }} />
                                </div>
                              </div>
                              <div className="admin-record-quota-line">
                                <div className="admin-record-quota-head">
                                  <span>{format(tx('admin.recordCreateUsage'), { count: applicationCreatedCount, limit: formatQuotaLimit(applicationCreateQuota) })}</span>
                                  {applicationCreateQuotaUnlimited ? (
                                    <span className="admin-quota-infinite">∞</span>
                                  ) : (
                                    <QuotaEditor
                                      key={`${user.id}-application-creates`}
                                      quota={applicationCreateQuota}
                                      label={tx('admin.applicationCreateQuota')}
                                      editLabel={tx('admin.editApplicationCreateQuota')}
                                      max={10000}
                                      variant="compact"
                                      showValue={false}
                                      onCommit={(next) => void commitUserUpdate(user.id, { applicationCreateQuota: next })}
                                    />
                                  )}
                                </div>
                                <div
                                  className="admin-mini-progress"
                                  role="progressbar"
                                  aria-label={tx('admin.recordCreateUsageLabel')}
                                  aria-valuemin={0}
                                  aria-valuemax={applicationCreateQuota}
                                  aria-valuenow={Math.min(applicationCreatedCount, applicationCreateQuota)}
                                  aria-valuetext={format(tx('admin.recordCreateUsage'), { count: applicationCreatedCount, limit: formatQuotaLimit(applicationCreateQuota) })}
                                >
                                  <i className={quotaProgressClass(applicationCreatePercent)} style={{ width: `${applicationCreatePercent}%` }} />
                                </div>
                              </div>
                              <div className="admin-record-quota-line">
                                <div className="admin-record-quota-head">
                                  <span>{format(tx('admin.shareUsage'), { count: activeShareCount, limit: formatQuotaLimit(shareQuota) })}</span>
                                  {shareQuotaUnlimited ? (
                                    <span className="admin-quota-infinite">∞</span>
                                  ) : (
                                    <QuotaEditor
                                      key={`${user.id}-shares`}
                                      quota={shareQuota}
                                      label={tx('admin.shareQuota')}
                                      editLabel={tx('admin.editShareQuota')}
                                      max={10000}
                                      variant="compact"
                                      showValue={false}
                                      onCommit={(next) => void commitUserUpdate(user.id, { shareQuota: next })}
                                    />
                                  )}
                                </div>
                                <div
                                  className="admin-mini-progress"
                                  role="progressbar"
                                  aria-label={tx('admin.shareUsageLabel')}
                                  aria-valuemin={0}
                                  aria-valuemax={shareQuota}
                                  aria-valuenow={Math.min(activeShareCount, shareQuota)}
                                  aria-valuetext={format(tx('admin.shareUsage'), { count: activeShareCount, limit: formatQuotaLimit(shareQuota) })}
                                >
                                  <i className={quotaProgressClass(sharePercent)} style={{ width: `${sharePercent}%` }} />
                                </div>
                              </div>
                              <div className="admin-record-quota-line">
                                <div className="admin-record-quota-head">
                                  <span>{format(tx('admin.shareCreateUsage'), { count: shareCreatedCount, limit: formatQuotaLimit(shareCreateQuota) })}</span>
                                  {shareCreateQuotaUnlimited ? (
                                    <span className="admin-quota-infinite">∞</span>
                                  ) : (
                                    <QuotaEditor
                                      key={`${user.id}-share-creates`}
                                      quota={shareCreateQuota}
                                      label={tx('admin.shareCreateQuota')}
                                      editLabel={tx('admin.editShareCreateQuota')}
                                      max={10000}
                                      variant="compact"
                                      showValue={false}
                                      onCommit={(next) => void commitUserUpdate(user.id, { shareCreateQuota: next })}
                                    />
                                  )}
                                </div>
                                <div
                                  className="admin-mini-progress"
                                  role="progressbar"
                                  aria-label={tx('admin.shareCreateUsageLabel')}
                                  aria-valuemin={0}
                                  aria-valuemax={shareCreateQuota}
                                  aria-valuenow={Math.min(shareCreatedCount, shareCreateQuota)}
                                  aria-valuetext={format(tx('admin.shareCreateUsage'), { count: shareCreatedCount, limit: formatQuotaLimit(shareCreateQuota) })}
                                >
                                  <i className={quotaProgressClass(shareCreatePercent)} style={{ width: `${shareCreatePercent}%` }} />
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell columnId="storage" api={userTableApi}>
                            <div className="admin-usage-lines">
                              <div className="admin-storage-line" aria-label={tx('admin.storageUsage')}>
                                <span>{formatBytes(usedBytes)} / {storageUnlimited ? '∞' : `${quota} MB`}</span>
                                <div><i style={{ width: `${percent}%` }} /></div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell columnId="quota" api={userTableApi}>
                            <div className="admin-user-quota-stack">
                              <div className="admin-record-quota-line admin-record-quota-line-inline">
                                <div className="admin-record-quota-head">
                                  <span>{storageUnlimited ? tx('team.storageUnlimited') : `${quota} MB`}</span>
                                  {storageUnlimited ? (
                                    <span className="admin-quota-infinite">∞</span>
                                  ) : (
                                    <QuotaEditor
                                      key={user.id}
                                      quota={quota}
                                      label={tx('admin.quotaMb')}
                                      editLabel={tx('admin.editStorageQuota')}
                                      suffix="MB"
                                      variant="compact"
                                      showValue={false}
                                      onCommit={(next) => void commitUserUpdate(user.id, { storageQuotaMb: next })}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell columnId="lastLogin" api={userTableApi}>
                            <span className="admin-table-date">
                              {formatAdminDateTime(user.lastLoginAt, lang, tx('admin.neverLoggedIn'))}
                            </span>
                          </TableCell>
                          <TableCell columnId="actions" api={userTableApi}>
                            {confirmingDelete ? (
                              <div className="admin-user-confirm-actions">
                                <button type="button" className="danger-action" onClick={() => onUserDelete(user.id)}>
                                  <Trash2 size={12} aria-hidden="true" /> {tx('admin.confirmDeleteUser')}
                                </button>
                                <button type="button" className="quiet-action" onClick={() => setPendingDeleteUserId(null)}>
                                  {tx('cancel')}
                                </button>
                              </div>
                            ) : (
                              <div className="admin-user-actions">
                                <button
                                  type="button"
                                  className="quiet-action"
                                  onClick={() => void commitUserUpdate(user.id, { disabled: !isDisabled })}
                                  disabled={isCurrentUser}
                                  title={isCurrentUser ? tx('admin.currentUserProtected') : undefined}
                                >
                                  <XCircle size={12} aria-hidden="true" /> {tx(isDisabled ? 'admin.enableAccount' : 'admin.disableAccount')}
                                </button>
                                <button
                                  type="button"
                                  className="quiet-action admin-user-delete-trigger"
                                  onClick={() => setPendingDeleteUserId(user.id)}
                                  disabled={isCurrentUser}
                                  title={isCurrentUser ? tx('admin.currentUserProtected') : tx('admin.deleteUser')}
                                >
                                  <Trash2 size={12} aria-hidden="true" /> {tx('admin.deleteUser')}
                                </button>
                              </div>
                            )}
                          </TableCell>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {userTableMenuNode}
              </div>
            )}

            {userPageCount > 1 ? (
              <div className="settings-pagination">
                <span className="settings-pagination-info">
                  {format(tx('pagination.page'), { page: userPage + 1, pages: userPageCount })}
                </span>
                <div className="settings-pagination-controls">
                  <button type="button" onClick={() => setUserPage((page) => Math.max(0, page - 1))} disabled={userPage === 0}>{tx('pagination.previous')}</button>
                  <button type="button" onClick={() => setUserPage((page) => Math.min(userPageCount - 1, page + 1))} disabled={userPage >= userPageCount - 1}>{tx('pagination.next')}</button>
                </div>
              </div>
            ) : null}
          </section>
          ) : (
            <section className="admin-card admin-card-wide admin-team-accounts-card admin-account-view-panel is-teams">
              <div className="admin-card-head">
                <div>
                  <span className="eyebrow">{tx('admin.teamAccounts')}</span>
                  <h3>{format(tx('admin.teamAccountCount'), { count: teamAccounts.length })}</h3>
                  <p>{tx('admin.teamAccountsDescription')}</p>
                </div>
                <form className="admin-team-create-form" onSubmit={handleCreateTeam}>
                  <label>
                    <span className="sr-only">{tx('admin.createTeamName')}</span>
                    <input
                      value={newTeamName}
                      onChange={(event) => setNewTeamName(event.target.value)}
                      placeholder={tx('admin.createTeamNamePlaceholder')}
                      maxLength={120}
                    />
                  </label>
                  <button type="submit" className="primary-action" disabled={creatingTeam || !newTeamName.trim()}>
                    {creatingTeam ? <RefreshCw size={13} className="spin-icon" aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
                    {creatingTeam ? tx('admin.creatingTeam') : tx('admin.createTeam')}
                  </button>
                </form>
              </div>
              <div className="admin-user-toolbar">
                <label className="admin-user-search">
                  <Search size={14} aria-hidden="true" />
                  <span className="sr-only">{tx('admin.searchTeams')}</span>
                  <input
                    type="search"
                    value={userSearch}
                    placeholder={tx('admin.searchTeamsPlaceholder')}
                    onChange={(event) => setUserSearch(event.target.value)}
                  />
                </label>
                <div className="admin-user-result-meta">
                  {format(tx('admin.teamAccountResults'), { count: filteredTeamAccounts.length })}
                </div>
              </div>
              {adminTeamsLoading && teamAccounts.length === 0 ? (
                <div className="admin-team-account-list" aria-busy="true" aria-label={tx('working')}>
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} width="100%" height={76} radius={8} />
                  ))}
                </div>
              ) : filteredTeamAccounts.length === 0 ? (
                <div className="admin-user-empty">
                  <div className="empty-state-icon"><Users size={22} aria-hidden="true" /></div>
                  <h3>{tx('admin.noTeamAccounts')}</h3>
                  <p>{tx(userSearch.trim() ? 'admin.noTeamsMatch' : 'admin.noTeamAccountsDescription')}</p>
                </div>
              ) : (
                <div className="admin-team-account-list">
                  {filteredTeamAccounts.map((record) => (
                    <article key={record.team.id} className="admin-team-account-row">
                      <span className="admin-team-account-mark" aria-hidden="true"><Users size={16} /></span>
                      <div className="admin-team-account-copy">
                        <span>
                          <strong>{record.team.name}</strong>
                          <em>{record.team.provisioning ? tx('admin.teamAwaitingOwner') : tx('teamLabel')}</em>
                        </span>
                        <small>
                          {record.owner
                            ? format(tx('admin.teamOwnerLabel'), { name: record.owner.name, email: record.owner.email })
                            : tx('admin.teamAwaitingOwnerDescription')}
                        </small>
                      </div>
                      <div className="admin-team-account-capacity" aria-label={tx('admin.teamCapacityLabel')}>
                        <span><strong>1 GB</strong><em>{tx('team.capacityStorage')}</em></span>
                        <span><strong>{record.teacherCount}/5</strong><em>{tx('team.capacityTeachers')}</em></span>
                        <span><strong>{record.studentCount}/100</strong><em>{tx('team.capacityStudents')}</em></span>
                        <span><strong>10,000</strong><em>{tx('team.capacityActiveLinks')}</em></span>
                        <span><strong>∞</strong><em>{tx('team.capacityCreatedLinks')}</em></span>
                      </div>
                      <button
                        type="button"
                        className="quiet-action"
                        onClick={() => setViewingTeam({ teamId: record.team.id, ownerEmail: record.owner?.email ?? '' })}
                      >
                        {tx('team.manageTeam')} <ArrowRight size={12} aria-hidden="true" />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ================================================================
          Tab: Log Management
          ================================================================ */}
      {activeTab === 'logManagement' && (
        <div className="admin-panel-grid" role="tabpanel" aria-label={tx('admin.tabs.logManagement')}>
          <section className="admin-card admin-card-wide">
            <div className="admin-card-head">
              <div>
                <span className="eyebrow">{tx('admin.systemLog')}</span>
                <h3>{format(tx('admin.logCount'), { count: logs.length })}</h3>
                <p>{tx('admin.logDesc')}</p>
              </div>
              <Clock size={17} aria-hidden="true" />
            </div>
            <div className="admin-log-summary">
              <div className="admin-log-summary-item">
                <span>{tx('admin.logVisible')}</span>
                <strong>{filteredSortedLogs.length}</strong>
              </div>
              <div className="admin-log-summary-item">
                <span>{tx('admin.logSort')}</span>
                <strong>{tx(`admin.logColumns.${logSort.field}`)} · {tx(`admin.logDirections.${logSort.direction}`)}</strong>
              </div>
              <div className="admin-log-summary-item">
                <span>{tx('admin.logPageSize')}</span>
                <strong>{LOG_PAGE_SIZE}</strong>
              </div>
            </div>
            <div className="admin-log-toolbar" aria-label={tx('admin.logTools')}>
              <label className="admin-log-search">
                <Search size={14} aria-hidden="true" />
                <span className="sr-only">{tx('admin.logSearchLabel')}</span>
                <input
                  value={logSearch}
                  onChange={(event) => setLogSearch(event.target.value)}
                  placeholder={tx('admin.logSearchPlaceholder')}
                />
              </label>
              <div className="admin-log-filter-grid">
                <label className="admin-log-filter">
                  <span><ListFilter size={12} aria-hidden="true" /> {tx('admin.logScopeFilter')}</span>
                  <Select
                    size="small"
                    value={logScopeFilter}
                    options={logScopeOptions}
                    onChange={setLogScopeFilter}
                  />
                </label>
                <label className="admin-log-filter">
                  <span><ShieldCheck size={12} aria-hidden="true" /> {tx('admin.logActorFilter')}</span>
                  <Select
                    size="small"
                    value={logActorFilter}
                    options={logActorOptions}
                    onChange={setLogActorFilter}
                  />
                </label>
              </div>
              <div className="admin-log-actions">
                {isLogFiltered ? (
                  <button type="button" className="quiet-action" onClick={resetLogFilters}>
                    <XCircle size={12} aria-hidden="true" /> {tx('admin.logResetFilters')}
                  </button>
                ) : null}
                <AsyncActionButton
                  className="quiet-action"
                  IdleIcon={Download}
                  idleLabel={tx('admin.exportCsv')}
                  pendingLabel={tx('admin.exportingCsv')}
                  successLabel={tx('admin.exportCsvReady')}
                  errorLabel={tx('admin.exportFailed')}
                  onAction={() => onExportLogs('csv')}
                />
                <AsyncActionButton
                  className="quiet-action"
                  IdleIcon={Download}
                  idleLabel={tx('admin.exportJson')}
                  pendingLabel={tx('admin.exportingJson')}
                  successLabel={tx('admin.exportJsonReady')}
                  errorLabel={tx('admin.exportFailed')}
                  onAction={() => onExportLogs('json')}
                />
                <button
                  type="button"
                  className="quiet-action admin-log-clear-btn"
                  onClick={() => setClearLogDialogOpen(true)}
                  disabled={logs.length === 0 || clearingLogs}
                >
                  <Trash2 size={12} aria-hidden="true" /> {clearingLogs ? tx('admin.clearingLogs') : tx('admin.clearLogs')}
                </button>
              </div>
            </div>

            {visibleLogs.length === 0 ? (
              <div className="admin-log-empty">
                <Clock size={20} aria-hidden="true" />
                <strong>{isLogFiltered ? tx('admin.noMatchingLogs') : tx('admin.noLogEntries')}</strong>
                <p>{isLogFiltered ? tx('admin.noMatchingLogsDesc') : tx('admin.noLogEntriesDesc')}</p>
                {isLogFiltered ? (
                  <button type="button" className="quiet-action" onClick={resetLogFilters}>
                    {tx('admin.logResetFilters')}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="admin-log-table-wrap atlas-table-shell" onContextMenu={openLogTableMenu}>
                <table className="admin-log-table atlas-table">
                  <TableColGroup columns={logTableColumns} api={logTableApi} />
                  <thead>
                    <tr>
                      <TableHeaderCell
                        column={logCol.time}
                        api={logTableApi}
                        aria-sort={logSort.field === 'time' ? logSort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
                      >
                        {renderLogSortHeader('time', tx('admin.logColumns.time'))}
                      </TableHeaderCell>
                      <TableHeaderCell
                        column={logCol.scope}
                        api={logTableApi}
                        aria-sort={logSort.field === 'scope' ? logSort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
                      >
                        {renderLogSortHeader('scope', tx('admin.logColumns.scope'))}
                      </TableHeaderCell>
                      <TableHeaderCell
                        column={logCol.message}
                        api={logTableApi}
                        aria-sort={logSort.field === 'message' ? logSort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
                      >
                        {renderLogSortHeader('message', tx('admin.logColumns.message'))}
                      </TableHeaderCell>
                      <TableHeaderCell
                        column={logCol.actor}
                        api={logTableApi}
                        aria-sort={logSort.field === 'actorId' ? logSort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
                      >
                        {renderLogSortHeader('actorId', tx('admin.logColumns.actorId'))}
                      </TableHeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLogs.map((event) => (
                      <tr key={event.id}>
                        <TableCell columnId="time" api={logTableApi}>
                          <time dateTime={event.time}>{formatLogTime(event.time, lang)}</time>
                        </TableCell>
                        <TableCell columnId="scope" api={logTableApi}>
                          <span className="admin-scope-chip">{localizeScope(event.scope, tx)}</span>
                        </TableCell>
                        <TableCell columnId="message" api={logTableApi}>
                          <strong>{localizeEventMessage(event.message, tx)}</strong>
                          <span>{event.id}</span>
                        </TableCell>
                        <TableCell columnId="actor" api={logTableApi}>
                          <span>{event.actorId ?? tx('admin.logSystemActor')}</span>
                        </TableCell>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {logTableMenuNode}
              </div>
            )}
            <div className="settings-pagination admin-log-pagination">
              <span className="settings-pagination-info">
                {format(tx('pagination.showing'), { from: logRangeStart, to: logRangeEnd, total: filteredSortedLogs.length })}
              </span>
              <div className="settings-pagination-controls">
                <button type="button" onClick={() => setLogPage(0)} disabled={logPage === 0}>{tx('pagination.first')}</button>
                <button type="button" onClick={() => setLogPage((page) => Math.max(0, page - 1))} disabled={logPage === 0}>{tx('pagination.previous')}</button>
                <span className="settings-pagination-current">{format(tx('pagination.page'), { page: logPage + 1, pages: logPageCount })}</span>
                <button type="button" onClick={() => setLogPage((page) => Math.min(logPageCount - 1, page + 1))} disabled={logPage >= logPageCount - 1}>{tx('pagination.next')}</button>
                <button type="button" onClick={() => setLogPage(logPageCount - 1)} disabled={logPage >= logPageCount - 1}>{tx('pagination.last')}</button>
              </div>
            </div>
            <ConfirmDialog
              open={clearLogDialogOpen}
              title={tx('admin.clearLogsTitle')}
              message={tx('admin.clearLogsMessage')}
              confirmLabel={clearingLogs ? tx('admin.clearingLogs') : tx('admin.clearLogsConfirm')}
              cancelLabel={tx('cancel')}
              variant="danger"
              onConfirm={() => {
                void handleClearLogs()
              }}
              onCancel={() => {
                if (!clearingLogs) setClearLogDialogOpen(false)
              }}
            />
          </section>
        </div>
      )}

      {/* ================================================================
          Tab: System Info
          ================================================================ */}
      {activeTab === 'systemInfo' && (
        <div className="admin-panel-grid" role="tabpanel" aria-label={tx('admin.tabs.systemInfo')}>
          {/* ============================================================
              Card 1: System Health Hero
              ============================================================ */}
          <section className="admin-card admin-card-wide">
            <div className="admin-health-hero">
              <div className={`admin-health-dot ${healthDotClass}`} aria-hidden="true" />
              <div className="admin-health-hero-content">
                <span className="eyebrow">{tx('admin.heroEyebrow')}</span>
                <h3>{healthStatusText}</h3>
                <p className="health-status-text">PhD Atlas v{systemInfo?.version ?? '…'} · {systemInfo?.platform ?? '…'} {systemInfo?.arch ?? '…'}</p>
              </div>
              <button type="button" className="icon-action" onClick={onRefreshSystemInfo} title={tx('admin.refreshInfo')}>
                <RefreshCw size={15} aria-hidden="true" />
              </button>
            </div>
            {systemInfo ? (
              <div className="admin-health-meta">
                <span>{tx('admin.uptime')} <strong>{formatUptime(liveUptime, tx)}</strong></span>
                <span className="admin-health-sep">·</span>
                <span>{tx('admin.hostname')} <strong>{systemInfo.hostname}</strong></span>
                <span className="admin-health-sep">·</span>
                <span>{tx('admin.processId')} <strong>{systemInfo.pid}</strong></span>
                <span className="admin-health-sep">·</span>
                <span>{tx('admin.nodeEnv')} <strong>{systemInfo.nodeEnv}</strong></span>
              </div>
            ) : (
              <p className="muted">{tx('admin.systemInfoDesc')}</p>
            )}
          </section>

          {/* ============================================================
              Card 2: CPU & Environment (left column)
              ============================================================ */}
          <section className="admin-card">
            <div className="admin-card-head">
              <div>
                <span className="eyebrow">{tx('admin.cpuEyebrow')}</span>
                <h3>{tx('admin.cpuTitle')}</h3>
              </div>
              <Cpu size={17} aria-hidden="true" />
            </div>
            {systemInfo ? (
              <div className="admin-stats-row">
                <div className="admin-stat-pill" title={systemInfo.cpu.model}>
                  <Cpu size={14} />
                  <span>{tx('admin.cpuModel')}</span>
                  <strong>{systemInfo.cpu.model.length > 32 ? systemInfo.cpu.model.slice(0, 32) + '…' : systemInfo.cpu.model}</strong>
                </div>
                <div className="admin-stat-pill">
                  <Layers size={14} />
                  <span>{tx('admin.cpuCores')}</span>
                  <strong>{systemInfo.cpu.cores}</strong>
                </div>
                <div className="admin-stat-pill">
                  <Monitor size={14} />
                  <span>{tx('admin.platform')}</span>
                  <strong>{systemInfo.platform} ({systemInfo.arch})</strong>
                </div>
                <div className="admin-stat-pill">
                  <Monitor size={14} />
                  <span>{tx('admin.hostname')}</span>
                  <strong>{systemInfo.hostname}</strong>
                </div>
                <div className="admin-stat-pill">
                  <Hash size={14} />
                  <span>{tx('admin.processId')}</span>
                  <strong>{systemInfo.pid}</strong>
                </div>
                <div className="admin-stat-pill">
                  <Tag size={14} />
                  <span>{tx('admin.nodeEnv')}</span>
                  <strong>{systemInfo.nodeEnv}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">…</p>
            )}
          </section>

          {/* ============================================================
              Card 3: Memory Usage (right column)
              ============================================================ */}
          <section className="admin-card">
            <div className="admin-card-head">
              <div>
                <span className="eyebrow">{tx('admin.memoryEyebrow')}</span>
                <h3>{format(tx('admin.memoryUsagePercent'), { percent: memoryPercent })}</h3>
                <p>{systemInfo ? formatBytes(systemInfo.memory.used) + ' / ' + formatBytes(systemInfo.memory.total) : ''}</p>
              </div>
              <MemoryStick size={17} aria-hidden="true" />
            </div>
            {systemInfo ? (
              <>
                <div className="admin-info-list">
                  <div className="admin-info-item">
                    <span>{tx('admin.memoryTotal')}</span>
                    <strong>{formatBytes(systemInfo.memory.total)}</strong>
                  </div>
                  <div className="admin-info-item">
                    <span>{tx('admin.memoryUsed')}</span>
                    <strong>{formatBytes(systemInfo.memory.used)}</strong>
                  </div>
                  <div className="admin-info-item">
                    <span>{tx('admin.memoryFree')}</span>
                    <strong>{formatBytes(systemInfo.memory.free)}</strong>
                  </div>
                </div>
                <div className="admin-progress-stack">
                  <div className="admin-progress-bar">
                    <div
                      className={`admin-progress-fill ${memoryFillClass}`}
                      style={{ width: `${memoryPercent}%` }}
                    />
                  </div>
                  <div className="admin-progress-label">
                    <span>{memoryPercent < 50 ? tx('admin.heroStatusOk') : memoryPercent < 75 ? tx('admin.heroStatusWarning') : tx('admin.heroStatusError')}</span>
                    <strong>{memoryPercent}%</strong>
                  </div>
                </div>
              </>
            ) : (
              <p className="muted">…</p>
            )}
          </section>

          {/* ============================================================
              Card 4: Storage Breakdown (full-width)
              ============================================================ */}
          <section className="admin-card admin-card-wide admin-storage-card">
            <div className="admin-card-head">
              <div>
                <span className="eyebrow">{tx('admin.storageEyebrow')}</span>
                <h3>{tx('admin.storageBreakdown')}</h3>
              </div>
              <HardDrive size={17} aria-hidden="true" />
            </div>
            {systemInfo ? (
              <div className="admin-storage-composition">
                <div className="admin-storage-total-row">
                  <span>{tx('admin.totalStorage')}</span>
                  <strong>{formatBytes(storageTotal)}</strong>
                </div>
                <div className="admin-storage-composition-bar" aria-label={`${tx('admin.totalStorage')} ${formatBytes(storageTotal)}`}>
                  {storageTotal > 0 ? storageItems
                    .filter((item) => item.bytes > 0)
                    .map((item) => (
                      <span
                        key={item.key}
                        className={`admin-storage-segment ${item.tone}`}
                        style={{ flexGrow: item.bytes }}
                        title={`${item.label}: ${formatBytes(item.bytes)}`}
                      />
                    )) : <span className="admin-storage-segment empty" />}
                </div>
                <div className="admin-storage-legend">
                  {storageItems.map((item) => {
                    const percent = storageTotal > 0 ? Math.round((item.bytes / storageTotal) * 100) : 0
                    return (
                      <div className="admin-storage-legend-item" key={item.key}>
                        <div className="admin-storage-label">
                          <span className={`admin-storage-dot ${item.tone}`} aria-hidden="true" />
                          <item.Icon size={14} aria-hidden="true" />
                          <span>{item.label}</span>
                        </div>
                        <div className="admin-storage-value-group">
                          <strong>{formatBytes(item.bytes)}</strong>
                          <span>{format(tx('admin.storagePercentOfTotal'), { percent })}</span>
                          {item.fileCount !== null && item.fileCount > 0 && (
                            <span>{format(tx('admin.storageFiles'), { count: item.fileCount })}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="muted">…</p>
            )}
          </section>

          {/* ============================================================
              Card 5: Data Summary (full-width)
              ============================================================ */}
          <section className="admin-card admin-card-wide">
            <div className="admin-card-head">
              <div>
                <span className="eyebrow">{tx('admin.countsEyebrow')}</span>
                <h3>{tx('admin.dataCounts')}</h3>
              </div>
              <Database size={17} aria-hidden="true" />
            </div>
            {systemInfo ? (
              <div className="admin-count-grid">
                <div className="admin-count-card">
                  <UserRound className="admin-count-icon accent" size={20} />
                  <span className="admin-count-number">{systemInfo.counts.users}</span>
                  <span className="admin-count-label">{tx('admin.countUsers')}</span>
                </div>
                <div className="admin-count-card">
                  <FileText className="admin-count-icon warning" size={20} />
                  <span className="admin-count-number">{systemInfo.counts.applications}</span>
                  <span className="admin-count-label">{tx('admin.countApplications')}</span>
                </div>
                <div className="admin-count-card">
                  <ShieldCheck className="admin-count-icon success" size={20} />
                  <span className="admin-count-number">{systemInfo.counts.systemEvents}</span>
                  <span className="admin-count-label">{tx('admin.countEvents')}</span>
                </div>
                <div className="admin-count-card">
                  <Package className="admin-count-icon info" size={20} />
                  <span className="admin-count-number">{systemInfo.counts.profileAssets}</span>
                  <span className="admin-count-label">{tx('admin.countAssets')}</span>
                </div>
              </div>
            ) : (
              <p className="muted">…</p>
            )}
          </section>

          {/* ============================================================
              Card 6: System Paths (full-width)
              ============================================================ */}
          <section className="admin-card admin-card-wide">
            <div className="admin-card-head">
              <div>
                <span className="eyebrow">{tx('admin.pathsEyebrow')}</span>
                <h3>{tx('admin.systemPaths')}</h3>
              </div>
              <Server size={17} aria-hidden="true" />
            </div>
            {systemInfo ? (
              <div className="admin-paths-grid">
                <div className="admin-path-row">
                  <div className="admin-path-label-row">
                    <span className="admin-path-label">{tx('admin.databasePathLabel')}</span>
                    <button
                      type="button"
                      className={`admin-copy-btn${copiedPath === 'db' ? ' admin-copied' : ''}`}
                      onClick={() => copyToClipboard(systemInfo.databasePath, 'db')}
                    >
                      {copiedPath === 'db' ? <Check size={12} /> : <Copy size={12} />}
                      {copiedPath === 'db' ? tx('admin.pathCopied') : tx('admin.copyPath')}
                    </button>
                  </div>
                  <code className="admin-path-value">{systemInfo.databasePath}</code>
                </div>
                <div className="admin-path-row">
                  <div className="admin-path-label-row">
                    <span className="admin-path-label">{tx('admin.uploadPathLabel')}</span>
                    <button
                      type="button"
                      className={`admin-copy-btn${copiedPath === 'upload' ? ' admin-copied' : ''}`}
                      onClick={() => copyToClipboard(systemInfo.uploadRoot, 'upload')}
                    >
                      {copiedPath === 'upload' ? <Check size={12} /> : <Copy size={12} />}
                      {copiedPath === 'upload' ? tx('admin.pathCopied') : tx('admin.copyPath')}
                    </button>
                  </div>
                  <code className="admin-path-value">{systemInfo.uploadRoot}</code>
                </div>
                <div className="admin-path-row">
                  <div className="admin-path-label-row">
                    <span className="admin-path-label">{tx('admin.backupPathLabel')}</span>
                    <button
                      type="button"
                      className={`admin-copy-btn${copiedPath === 'backup' ? ' admin-copied' : ''}`}
                      onClick={() => copyToClipboard(systemInfo.backupRoot, 'backup')}
                    >
                      {copiedPath === 'backup' ? <Check size={12} /> : <Copy size={12} />}
                      {copiedPath === 'backup' ? tx('admin.pathCopied') : tx('admin.copyPath')}
                    </button>
                  </div>
                  <code className="admin-path-value">{systemInfo.backupRoot}</code>
                </div>
              </div>
            ) : (
              <p className="muted">…</p>
            )}
          </section>

          {/* ============================================================
              Card 7: System Update (full-width)
              ============================================================ */}
          <section className="admin-card admin-card-wide">
            <div className="admin-card-head">
              <div>
                <span className="eyebrow">{tx('admin.updateEyebrow')}</span>
                <h3>{tx('admin.systemUpdate')}</h3>
                <p>{tx(PUBLIC_EDITION ? 'admin.systemUpdateDesc' : 'admin.manualUpdateDesc')}</p>
              </div>
              <Package size={17} aria-hidden="true" />
            </div>
            <div className="admin-update-panel">
              {PUBLIC_EDITION ? (
                <div className="admin-release-update">
                  <div className="admin-release-update-summary">
                    <span className="admin-release-update-icon">
                      {releaseUpdate?.updateAvailable ? <Download size={18} aria-hidden="true" /> : <Package size={18} aria-hidden="true" />}
                    </span>
                    <span className="admin-release-update-copy">
                      <em>{tx('admin.currentVersion')}</em>
                      <strong>PhD Atlas v{releaseUpdate?.currentVersion ?? systemInfo?.version ?? '…'}</strong>
                      <small role="status">
                        {releaseUpdate?.updateAvailable && releaseUpdate.release
                          ? format(tx('admin.updateAvailable'), { version: releaseUpdate.release.version })
                          : releaseUpdate
                            ? tx('admin.updateUpToDate')
                            : tx('admin.autoUpdateDesc')}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="quiet-action"
                      onClick={() => void handleCheckReleaseUpdate()}
                      disabled={checkingReleaseUpdate || installingReleaseUpdate}
                    >
                      <RefreshCw size={13} aria-hidden="true" className={checkingReleaseUpdate ? 'spin-icon' : undefined} />
                      {checkingReleaseUpdate ? tx('admin.checkingForUpdates') : tx('admin.checkForUpdates')}
                    </button>
                  </div>
                  {releaseUpdate?.updateAvailable && releaseUpdate.release ? (
                    <div className="admin-release-update-detail">
                      <span>
                        <em>{tx('admin.latestRelease')}</em>
                        <strong>v{releaseUpdate.release.version}</strong>
                        <small>
                          {formatAdminDateTime(releaseUpdate.release.publishedAt, lang, '—')}
                          {' · '}
                          {formatFileSize(releaseUpdate.release.package.size)}
                        </small>
                      </span>
                      <div className="admin-release-update-actions">
                        <a
                          className="quiet-action"
                          href={releaseUpdate.release.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {tx('admin.viewRelease')} <ArrowRight size={13} aria-hidden="true" />
                        </a>
                        <button
                          type="button"
                          className="primary-action"
                          onClick={() => void handleInstallReleaseUpdate()}
                          disabled={installingReleaseUpdate}
                        >
                          {installingReleaseUpdate ? (
                            <><RefreshCw size={13} aria-hidden="true" className="spin-icon" /> {tx('admin.installingUpdate')}</>
                          ) : (
                            <><Download size={13} aria-hidden="true" /> {format(tx('admin.installRelease'), { version: releaseUpdate.release.version })}</>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                className="admin-update-manual-toggle"
                aria-expanded={manualUpdateOpen}
                aria-controls="admin-manual-update-panel"
                onClick={() => setManualUpdateOpen((open) => !open)}
              >
                <span>
                  <UploadCloud size={16} aria-hidden="true" />
                  <span>
                    <strong>{tx('admin.manualUpdate')}</strong>
                    <small>{tx('admin.manualUpdateDesc')}</small>
                  </span>
                </span>
                <ChevronDown size={15} aria-hidden="true" className={manualUpdateOpen ? 'open' : undefined} />
              </button>
              <div
                id="admin-manual-update-panel"
                className={`admin-update-manual-detail ${manualUpdateOpen ? 'open' : ''}`}
              >
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".tar.gz,.tgz"
                    className="hidden-input"
                    onChange={(event) => handleUpdateFileSelection(event.currentTarget.files)}
                  />
                  <button
                    type="button"
                    className={`admin-update-dropzone ${updateDragActive ? 'dragging' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setUpdateDragActive(true)
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      event.preventDefault()
                      setUpdateDragActive(false)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      setUpdateDragActive(false)
                      handleUpdateFileSelection(event.dataTransfer.files)
                    }}
                  >
                    <span className="admin-update-dropzone-icon"><UploadCloud size={20} aria-hidden="true" /></span>
                    <span>
                      <strong>{updateFile ? tx('admin.packageSelected') : tx('admin.dropPackageTitle')}</strong>
                      <em>{updateFile ? `${updateFile.name} · ${formatFileSize(updateFile.size)}` : tx('admin.dropPackageHint')}</em>
                    </span>
                  </button>
                  <p className="settings-inline-note">{tx('admin.buildUpdatePackageHint')}</p>
                  <div className="admin-update-actions">
                    {updateFile ? (
                      <button
                        type="button"
                        className="quiet-action"
                        onClick={() => setUpdateFile(null)}
                        disabled={uploading}
                      >
                        <X size={13} aria-hidden="true" /> {tx('admin.deletePackage')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="quiet-action"
                      onClick={() => void handleUploadPackage()}
                      disabled={uploading || !updateFile}
                    >
                      {uploading ? (
                        <><RefreshCw size={13} aria-hidden="true" className="spin-icon" /> {tx('admin.uploading')}</>
                      ) : (
                        <><Upload size={13} aria-hidden="true" /> {tx('admin.uploadPackage')}</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {viewingTeam ? (
        <AdminTeamPanel
          token={token}
          teamId={viewingTeam.teamId}
          ownerEmail={viewingTeam.ownerEmail}
          users={users}
          onNotify={onNotify}
          onClose={() => {
            setViewingTeam(null)
            void loadAdminTeams()
          }}
        />
      ) : null}
    </section>
  )
}

const ADMIN_TEAM_ROLE_LABEL_KEYS: Record<TeamRole, string> = {
  owner: 'team.roleOwner',
  admin: 'team.roleAdmin',
  member: 'team.roleMember',
}

/**
 * Site-admin override view -- lets the system administrator drill into any team's membership
 * (the backend's `getCallerTeamRole` grants `isAdminUser` callers owner-equivalent access to
 * every team, not just ones they personally belong to).
 */
function AdminTeamPanel({
  token,
  teamId,
  ownerEmail,
  users,
  onNotify,
  onClose,
}: {
  token: string
  teamId: string
  ownerEmail: string
  users: AdminUser[]
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  onClose: () => void
}) {
  const { tx, format, lang } = useI18n()
  const panelClose = useAnimatedClose(true, onClose)
  const [summary, setSummary] = useState<TeamSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const [memberRoleFilter, setMemberRoleFilter] = useState<'all' | TeamRole>('all')
  const [memberStatusFilter, setMemberStatusFilter] = useState<'all' | 'active' | 'pending'>('all')
  const [memberView, setMemberView] = useState<'list' | 'map'>('list')
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [pendingRemoveMemberId, setPendingRemoveMemberId] = useState<string | null>(null)
  const memberSearchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useModalA11y<HTMLDivElement>({
    open: !panelClose.exiting && !pendingRemoveMemberId,
    onClose: () => panelClose.requestClose(),
    initialFocusRef: memberSearchRef,
  })
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])
  const activeTeachers = useMemo(() => (
    (summary?.members ?? []).filter((member) => (
      member.status === 'active' &&
      member.role === 'admin' &&
      member.userId
    ))
  ), [summary?.members])
  const students = useMemo(() => (
    (summary?.members ?? []).filter((member) => member.role === 'member')
  ), [summary?.members])
  const filteredMembers = useMemo(() => {
    const query = memberQuery.trim().toLocaleLowerCase()
    return (summary?.members ?? []).filter((member) => {
      if (memberRoleFilter !== 'all' && member.role !== memberRoleFilter) return false
      if (memberStatusFilter !== 'all' && member.status !== memberStatusFilter) return false
      if (!query) return true
      const assignedTeachers = member.role === 'member'
        ? activeTeachers
          .filter((teacher) => Boolean(teacher.userId && isTeacherAssignedToStudent(member, teacher.userId)))
          .map((teacher) => teacher.displayName ?? teacher.invitedEmail)
        : []
      return [
        member.displayName,
        member.invitedEmail,
        tx(ADMIN_TEAM_ROLE_LABEL_KEYS[member.role]),
        tx(member.status === 'active' ? 'team.statusActive' : 'team.statusPending'),
        ...assignedTeachers,
      ].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
    })
  }, [activeTeachers, memberQuery, memberRoleFilter, memberStatusFilter, summary?.members, tx])
  const selectedMember = useMemo(() => {
    if (!selectedMemberId) return null
    return (summary?.members ?? []).find((member) => member.id === selectedMemberId) ?? null
  }, [selectedMemberId, summary?.members])
  const pendingRemoveMember = useMemo(
    () => (summary?.members ?? []).find((member) => member.id === pendingRemoveMemberId) ?? null,
    [pendingRemoveMemberId, summary?.members],
  )
  const selectedLinkedUser = selectedMember?.userId ? usersById.get(selectedMember.userId) ?? null : null
  const selectedStats = selectedMember ? summary?.memberStats?.[selectedMember.id] : null
  const ownerCount = summary?.roleCounts?.owner ?? (summary?.members ?? []).filter((member) => member.role === 'owner').length
  const teacherCount = summary?.roleCounts?.admin ?? activeTeachers.filter((member) => member.role === 'admin').length
  const studentCount = summary?.roleCounts?.member ?? students.length
  const teamUsage = summary?.usage
  const teamCapacity = summary?.capacity
  const linkedPersonalAccounts = (summary?.members ?? []).filter((member) => Boolean(member.userId)).length
  const teamStorageLimit = formatBytes(teamCapacity?.storageQuotaBytes ?? 1024 * 1024 * 1024)
  const remainingActiveLinks = teamCapacity ? Math.max(0, teamCapacity.activeShareLimit - teamCapacity.activeShareCount) : 0
  const remainingCreatedLinks = '∞'
  const activeFilterCount = Number(memberRoleFilter !== 'all') + Number(memberStatusFilter !== 'all')
  const memberShortcutHints = [
    { keys: 'Ctrl/⌘ K', label: tx('shortcuts.focusSearch') },
    { keys: '↑ ↓', label: tx('team.adminTeamShortcutNavigate') },
    { keys: 'Enter', label: tx('shortcuts.openSelected') },
    {
      keys: 'Space',
      label: selectedMember
        ? format(tx('team.toggleMemberDetails'), { name: selectedMember.displayName ?? selectedMember.invitedEmail })
        : tx('team.adminTeamControls'),
    },
    { keys: 'Shift F10', label: tx('table.actions') },
  ]

  async function reload() {
    setLoading(true)
    try {
      const result = await phdApi.listTeamMembers(token, teamId)
      setSummary(result)
      setError(null)
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  useEffect(() => {
    if (filteredMembers.length === 0) {
      setSelectedMemberId(null)
      setExpandedMemberId(null)
      return
    }
    setSelectedMemberId((current) => (
      current && filteredMembers.some((member) => member.id === current)
        ? current
        : filteredMembers.find((member) => member.role === 'owner')?.id ?? filteredMembers[0]?.id ?? null
    ))
    setExpandedMemberId((current) => (
      current && filteredMembers.some((member) => member.id === current) ? current : null
    ))
  }, [filteredMembers])

  async function handleRoleChange(memberId: string, role: Exclude<TeamRole, 'owner'>) {
    setBusyId(memberId)
    try {
      await phdApi.updateTeamMemberRole(token, teamId, memberId, role)
      await reload()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setBusyId(null)
    }
  }

  async function handleTeacherAssignmentToggle(memberId: string, teacherMemberId: string) {
    const member = summary?.members.find((candidate) => candidate.id === memberId)
    const teacher = activeTeachers.find((candidate) => candidate.id === teacherMemberId)
    if (!member || !teacher?.userId) return
    const currentTeacherUserIds = teamMemberTeacherIds(member)
    const nextTeacherUserIds = currentTeacherUserIds.includes(teacher.userId)
      ? currentTeacherUserIds.filter((id) => id !== teacher.userId)
      : [...currentTeacherUserIds, teacher.userId]
    if (nextTeacherUserIds.length === 0) {
      setError(tx('team.inviteTeacherRequired'))
      return
    }
    const teacherMemberIds = activeTeachers
      .filter((candidate) => candidate.userId && nextTeacherUserIds.includes(candidate.userId))
      .map((candidate) => candidate.id)
    setBusyId(memberId)
    try {
      await phdApi.updateTeamMemberAccess(token, teamId, memberId, { teacherIds: teacherMemberIds })
      await reload()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setBusyId(null)
    }
  }

  async function handleEnterLinkedUser(user: AdminUser) {
    setBusyId(`enter:${user.id}`)
    try {
      const nextSession = await phdApi.impersonateUser(token, user.id, 'admin')
      localStorage.setItem('phd-atlas-session', JSON.stringify(nextSession))
      window.location.href = '/'
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
      setBusyId(null)
    }
  }

  async function handleRemove(memberId: string) {
    setBusyId(memberId)
    try {
      await phdApi.removeTeamMember(token, teamId, memberId)
      setPendingRemoveMemberId(null)
      setContextMenu(null)
      await reload()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setBusyId(null)
    }
  }

  function assignedTeachersFor(member: TeamMember) {
    if (member.role !== 'member') return []
    return activeTeachers.filter((teacher) => (
      Boolean(teacher.userId && isTeacherAssignedToStudent(member, teacher.userId))
    ))
  }

  function supervisedStudentsFor(member: TeamMember) {
    if (member.role !== 'admin' || !member.userId) return []
    return students.filter((student) => isTeacherAssignedToStudent(student, member.userId!))
  }

  function relationshipLabelFor(member: TeamMember) {
    if (member.role === 'owner') return tx('team.ownerBadge')
    if (member.role === 'admin') {
      return format(tx('team.relationshipTeacherMeta'), { count: supervisedStudentsFor(member).length })
    }
    const teacherNames = assignedTeachersFor(member).map((teacher) => teacher.displayName ?? teacher.invitedEmail)
    return teacherNames.length > 0 ? teacherNames.join(', ') : tx('team.relationshipNoAdvisor')
  }

  function selectMember(memberId: string, options?: { expand?: boolean; inspector?: boolean }) {
    setSelectedMemberId(memberId)
    if (options?.expand) {
      setExpandedMemberId((current) => current === memberId ? null : memberId)
    }
    if (options?.inspector) setMobileInspectorOpen(true)
  }

  function clearMemberFilters() {
    setMemberQuery('')
    setMemberRoleFilter('all')
    setMemberStatusFilter('all')
  }

  async function copyMemberEmail(member: TeamMember) {
    const copied = await writeToClipboard(member.invitedEmail)
    onNotify?.(tx(copied ? 'copiedBang' : 'copyFailed'), copied ? 'success' : 'error')
  }

  function showMemberContextMenu(member: TeamMember, x: number, y: number) {
    const linkedUser = member.userId ? usersById.get(member.userId) ?? null : null
    setSelectedMemberId(member.id)
    setContextMenu({
      x,
      y,
      title: member.displayName ?? member.invitedEmail,
      subtitle: `${tx(ADMIN_TEAM_ROLE_LABEL_KEYS[member.role])} · ${tx(member.status === 'active' ? 'team.statusActive' : 'team.statusPending')}`,
      items: [
        {
          id: 'details',
          label: tx('team.adminTeamAccountDetail'),
          icon: <UserRound size={14} aria-hidden="true" />,
          shortcut: 'Enter',
          accessKey: 'Enter',
          onSelect: () => selectMember(member.id, { inspector: true }),
        },
        {
          id: 'enter-view',
          label: tx(member.role === 'member' ? 'team.enterStudentView' : 'team.enterMemberView'),
          icon: <LogIn size={14} aria-hidden="true" />,
          disabled: !linkedUser || member.status !== 'active',
          onSelect: () => linkedUser && void handleEnterLinkedUser(linkedUser),
        },
        {
          id: 'copy-email',
          label: format(tx('copy'), { label: tx('team.copyMemberEmailLabel') }),
          icon: <Mail size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          onSelect: () => void copyMemberEmail(member),
        },
        {
          id: 'role',
          label: tx('team.columnRole'),
          icon: <ShieldCheck size={14} aria-hidden="true" />,
          disabled: member.role === 'owner',
          submenu: member.role === 'owner' ? undefined : {
            title: tx('team.columnRole'),
            subtitle: member.displayName ?? member.invitedEmail,
            backLabel: tx('back'),
            items: (['admin', 'member'] as const).map((role) => ({
              id: `role:${role}`,
              label: tx(ADMIN_TEAM_ROLE_LABEL_KEYS[role]),
              radio: true,
              selected: member.role === role,
              onSelect: () => void handleRoleChange(member.id, role),
            })),
          },
        },
        {
          id: 'remove',
          label: tx('team.removeMemberTitle'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          disabled: member.role === 'owner',
          tone: 'danger',
          onSelect: () => setPendingRemoveMemberId(member.id),
        },
      ],
    })
  }

  function openMemberContextMenu(event: ReactMouseEvent<HTMLElement>, member: TeamMember) {
    event.preventDefault()
    event.stopPropagation()
    showMemberContextMenu(member, event.clientX, event.clientY)
  }

  function openMemberContextMenuFromButton(event: ReactMouseEvent<HTMLButtonElement>, member: TeamMember) {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    showMemberContextMenu(member, rect.right - 8, rect.bottom + 4)
  }

  function handleMemberRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, member: TeamMember) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      showMemberContextMenu(member, rect.left + 24, rect.top + 28)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectMember(member.id, { inspector: true })
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      selectMember(member.id, { expand: true })
    }
  }

  useEffect(() => {
    function handlePanelShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const isEditable = Boolean(target?.matches('input, textarea, select, [contenteditable="true"]'))
      const focusSearch = (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k'
      if (focusSearch || (event.key === '/' && !isEditable)) {
        event.preventDefault()
        memberSearchRef.current?.focus()
        memberSearchRef.current?.select()
        return
      }
      if (isEditable || target?.closest('button, a, [role="combobox"], [role="menu"]')) return
      if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) || filteredMembers.length === 0) return
      const currentIndex = filteredMembers.findIndex((member) => member.id === selectedMemberId)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = currentIndex < 0
          ? 0
          : (currentIndex + direction + filteredMembers.length) % filteredMembers.length
        setSelectedMemberId(filteredMembers[nextIndex]?.id ?? null)
        return
      }
      if (!selectedMemberId) return
      event.preventDefault()
      if (event.key === 'Enter') setMobileInspectorOpen(true)
      if (event.key === ' ') {
        setExpandedMemberId((current) => current === selectedMemberId ? null : selectedMemberId)
      }
    }

    window.addEventListener('keydown', handlePanelShortcut)
    return () => window.removeEventListener('keydown', handlePanelShortcut)
  }, [filteredMembers, selectedMemberId])

  return (
    <ModalPortal>
      <div
        className={`dialog-layer${panelClose.exiting ? ' exiting' : ''}`}
        onClick={(event) => { if (event.target === event.currentTarget) panelClose.requestClose() }}
      >
      <div
        ref={dialogRef}
        className="admin-card admin-team-panel"
        role="dialog"
        aria-modal="true"
        aria-label={tx('team.adminOverrideBanner')}
      >
        <header className="admin-team-panel-header">
          <div className="admin-team-panel-identity">
            <span className="admin-team-panel-mark" aria-hidden="true">
              <Users size={17} />
            </span>
            <div>
              <h3>{summary?.team.name ?? ownerEmail}</h3>
              <p>{tx('team.adminOverrideBanner')} · {ownerEmail}</p>
            </div>
          </div>

          <div className="admin-team-commandbar">
            <label className="admin-team-search">
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">{tx('search')}</span>
              <input
                ref={memberSearchRef}
                type="search"
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder={tx('team.memberSearchPlaceholder')}
              />
              <kbd aria-hidden="true">/</kbd>
            </label>

            <AnchoredPopover
              triggerAriaLabel={tx('team.memberFilterLabel')}
              popoverAriaLabel={tx('team.memberFilterLabel')}
              triggerClassName="admin-team-filter-trigger"
              popoverClassName="admin-team-filter-popover"
              width={286}
              estimatedHeight={246}
              align="end"
              trigger={(
                <>
                  <ListFilter size={14} aria-hidden="true" />
                  <span>{tx('team.memberFilterLabel')}</span>
                  {activeFilterCount > 0 ? <b>{activeFilterCount}</b> : null}
                </>
              )}
            >
              {(close) => (
                <div className="admin-team-filter-fields">
                  <label>
                    <span>{tx('team.memberRoleFilterLabel')}</span>
                    <Select
                      size="small"
                      value={memberRoleFilter}
                      options={[
                        { value: 'all', label: tx('team.memberRoleAll') },
                        ...(['owner', 'admin', 'member'] as const).map((role) => ({
                          value: role,
                          label: tx(ADMIN_TEAM_ROLE_LABEL_KEYS[role]),
                        })),
                      ]}
                      onChange={(value) => setMemberRoleFilter(value as 'all' | TeamRole)}
                    />
                  </label>
                  <label>
                    <span>{tx('team.memberStatusFilterLabel')}</span>
                    <Select
                      size="small"
                      value={memberStatusFilter}
                      options={[
                        { value: 'all', label: tx('team.memberStatusAll') },
                        { value: 'active', label: tx('team.statusActive') },
                        { value: 'pending', label: tx('team.statusPending') },
                      ]}
                      onChange={(value) => setMemberStatusFilter(value as 'all' | 'active' | 'pending')}
                    />
                  </label>
                  <div className="admin-team-filter-actions">
                    <button
                      type="button"
                      className="quiet-action"
                      disabled={activeFilterCount === 0 && !memberQuery}
                      onClick={() => {
                        clearMemberFilters()
                        close()
                      }}
                    >
                      {tx('team.studentProfileClearFilters')}
                    </button>
                  </div>
                </div>
              )}
            </AnchoredPopover>

            {summary ? (
              <AnchoredPopover
                triggerAriaLabel={tx('team.joinCodeTitle')}
                popoverAriaLabel={tx('team.joinCodeTitle')}
                triggerClassName="primary-action admin-team-invite-trigger"
                popoverClassName="team-invite-popover-shell"
                width={410}
                estimatedHeight={560}
                align="end"
                trigger={<><KeyRound size={13} aria-hidden="true" /><span>{tx('team.joinCodeButton')}</span></>}
              >
                {() => (
                  <TeamJoinCodeGenerator
                    roles={summary.team.provisioning ? ['owner', 'admin', 'member'] : ['admin', 'member']}
                    teachers={activeTeachers}
                    defaultRole={summary.team.provisioning ? 'owner' : 'member'}
                    onGenerate={(input) => phdApi.createTeamJoinCode(token, teamId, input)}
                  />
                )}
              </AnchoredPopover>
            ) : null}
            <button type="button" className="icon-action" onClick={() => panelClose.requestClose()} aria-label={tx('close')}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}

        {loading ? (
          <div className="admin-team-panel-loading" aria-label={tx('working')} aria-busy="true">
            <Skeleton width="100%" height={82} radius={8} />
            <div className="admin-team-loading-columns">
              <Skeleton width="100%" height={420} radius={8} />
              <Skeleton width="100%" height={420} radius={8} />
            </div>
          </div>
        ) : summary ? (
          <div className="admin-team-panel-body">
            <section className={`admin-team-overview${overviewOpen ? ' open' : ''}`}>
              <div className="admin-team-overview-line">
                <button
                  type="button"
                  className="admin-team-overview-toggle"
                  aria-expanded={overviewOpen}
                  aria-controls="admin-team-policy-details"
                  onClick={() => setOverviewOpen((current) => !current)}
                >
                  {overviewOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                  <span>
                    <strong>{tx('team.adminTeamSummary')}</strong>
                    <em>{tx('team.adminTeamPolicyDesc')}</em>
                  </span>
                </button>
                <div className="admin-team-overview-metrics" aria-label={tx('team.adminTeamSummary')}>
                  <span>
                    <em>{tx('team.adminTeamMetricPeople')}</em>
                    <strong>{format(tx('team.adminTeamPeopleCount'), { owners: ownerCount, teachers: teacherCount, students: studentCount })}</strong>
                  </span>
                  <span>
                    <em>{tx('team.adminTeamMetricSeats')}</em>
                    <strong>{teamCapacity ? `${teamCapacity.teacherSeatsUsed}/${teamCapacity.teacherSeatLimit} · ${teamCapacity.studentSeatsUsed}/${teamCapacity.studentSeatLimit}` : '-'}</strong>
                  </span>
                  <span>
                    <em>{tx('team.adminTeamMetricApplications')}</em>
                    <strong>{teamUsage?.applicationCount ?? 0}</strong>
                  </span>
                  <span>
                    <em>{tx('team.adminTeamMetricStorage')}</em>
                    <strong>{formatBytes(teamCapacity?.storageUsedBytes ?? 0)} / {teamStorageLimit}</strong>
                  </span>
                  <span>
                    <em>{tx('team.adminTeamMetricLinks')}</em>
                    <strong>{teamCapacity?.activeShareCount ?? 0}</strong>
                  </span>
                </div>
              </div>

              <CollapsiblePanel
                id="admin-team-policy-details"
                open={overviewOpen}
                className="admin-team-policy-disclosure"
                innerClassName="admin-team-policy-details"
                keepMounted
                collapseMs={300}
              >
                <div className="admin-team-policy-row">
                  <Users size={15} aria-hidden="true" />
                  <span>
                    <strong>{tx('team.adminTeamFixedSeatsTitle')}</strong>
                    <em>{teamCapacity ? format(tx('team.adminTeamFixedSeatsDesc'), {
                      teachers: teamCapacity.teacherSeatsUsed,
                      teacherLimit: teamCapacity.teacherSeatLimit,
                      students: teamCapacity.studentSeatsUsed,
                      studentLimit: teamCapacity.studentSeatLimit,
                    }) : '-'}</em>
                  </span>
                </div>
                <div className="admin-team-policy-row">
                  <LockKeyhole size={15} aria-hidden="true" />
                  <span>
                    <strong>{format(tx('team.adminTeamLinkedAccountsTitle'), { count: linkedPersonalAccounts })}</strong>
                    <em>{tx('team.adminTeamLinkedAccountsDesc')}</em>
                  </span>
                </div>
                <div className="admin-team-policy-row">
                  <HardDrive size={15} aria-hidden="true" />
                  <span>
                    <strong>{format(tx('team.adminTeamStoragePolicyTitle'), { used: formatBytes(teamCapacity?.storageUsedBytes ?? 0), limit: teamStorageLimit })}</strong>
                    <em>{tx('team.adminTeamStoragePolicyDesc')}</em>
                  </span>
                </div>
                <div className="admin-team-policy-row">
                  <Copy size={15} aria-hidden="true" />
                  <span>
                    <strong>{format(tx('team.adminTeamLinkPolicyTitle'), { active: remainingActiveLinks, created: remainingCreatedLinks })}</strong>
                    <em>{tx('team.adminTeamLinkPolicyDesc')}</em>
                  </span>
                </div>
              </CollapsiblePanel>
            </section>

            <div className="admin-team-drilldown">
              <section className="admin-team-directory" aria-label={tx('team.membersEyebrow')}>
                <div className="admin-team-directory-head">
                  <div>
                    <strong>{format(tx('team.membersTitle'), { count: summary.members.length })}</strong>
                    <span>{format(tx('team.memberFilteredCount'), { visible: filteredMembers.length, total: summary.members.length })}</span>
                  </div>
                  <div
                    className={`admin-team-view-switch is-${memberView}`}
                    role="group"
                    aria-label={tx('team.relationshipViewLabel')}
                  >
                    <i aria-hidden="true" />
                    <button
                      type="button"
                      className={memberView === 'list' ? 'selected' : ''}
                      aria-pressed={memberView === 'list'}
                      onClick={() => setMemberView('list')}
                    >
                      <Users size={13} aria-hidden="true" />
                      {tx('team.relationshipViewTable')}
                    </button>
                    <button
                      type="button"
                      className={memberView === 'map' ? 'selected' : ''}
                      aria-pressed={memberView === 'map'}
                      onClick={() => setMemberView('map')}
                    >
                      <Network size={13} aria-hidden="true" />
                      {tx('team.relationshipViewMap')}
                    </button>
                  </div>
                </div>

                {memberView === 'map' ? (
                  <div className="admin-team-relationship-view">
                    <div className="admin-team-section-head">
                      <span>{tx('team.relationshipMapTitle')}</span>
                      <em>{format(tx('team.relationshipMapStats'), { teachers: activeTeachers.length, students: students.length })}</em>
                    </div>
                    {activeTeachers.length > 0 ? (
                      <div className="admin-team-graph">
                        {activeTeachers.map((teacher) => {
                          const teacherStudents = supervisedStudentsFor(teacher)
                          return (
                            <section className="admin-team-graph-lane" key={teacher.id}>
                              <button
                                type="button"
                                className={`admin-team-graph-node teacher ${selectedMember?.id === teacher.id ? 'selected' : ''}`}
                                onClick={() => selectMember(teacher.id, { inspector: true })}
                                onContextMenu={(event) => openMemberContextMenu(event, teacher)}
                              >
                                <span className="team-member-avatar">{(teacher.displayName ?? teacher.invitedEmail).charAt(0).toUpperCase()}</span>
                                <span>
                                  <strong>{teacher.displayName ?? teacher.invitedEmail}</strong>
                                  <em>{format(tx('team.relationshipTeacherMeta'), { count: teacherStudents.length })}</em>
                                </span>
                              </button>
                              <div className="admin-team-graph-spine" aria-hidden="true" />
                              <div className="admin-team-graph-children">
                                {teacherStudents.length === 0 ? (
                                  <div className="admin-team-graph-empty">{tx('team.relationshipNoAssignedStudents')}</div>
                                ) : teacherStudents.map((student) => (
                                  <button
                                    type="button"
                                    className={`admin-team-graph-node student ${selectedMember?.id === student.id ? 'selected' : ''}`}
                                    key={student.id}
                                    onClick={() => selectMember(student.id, { inspector: true })}
                                    onContextMenu={(event) => openMemberContextMenu(event, student)}
                                  >
                                    <span className="team-member-avatar">{(student.displayName ?? student.invitedEmail).charAt(0).toUpperCase()}</span>
                                    <span>
                                      <strong>{student.displayName ?? student.invitedEmail}</strong>
                                      <em>{student.invitedEmail}</em>
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="admin-team-empty">
                        <span><Network size={17} aria-hidden="true" /></span>
                        <strong>{tx('team.relationshipNoStudents')}</strong>
                        <p>{tx('team.joinCodeNoTeachers')}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="admin-team-member-list">
                    <div className="admin-team-member-columns" aria-hidden="true">
                      <span>{tx('team.columnMember')}</span>
                      <span>{tx('team.columnRole')} · {tx('team.columnStatus')}</span>
                      <span>{tx('team.relationshipAdvisorLabel')}</span>
                      <span>{tx('team.adminTeamUsage')}</span>
                      <span />
                    </div>

                    {filteredMembers.length === 0 ? (
                      <div className="admin-team-empty">
                        <span><UserRound size={17} aria-hidden="true" /></span>
                        <strong>{tx('team.memberNoMatchesTitle')}</strong>
                        <p>{tx('team.memberNoMatchesDesc')}</p>
                        <button type="button" className="quiet-action" onClick={clearMemberFilters}>
                          {tx('team.studentProfileClearFilters')}
                        </button>
                      </div>
                    ) : filteredMembers.map((member) => {
                      const linkedUser = member.userId ? usersById.get(member.userId) ?? null : null
                      const memberStats = summary.memberStats?.[member.id]
                      const memberBusy = busyId === member.id
                      const expanded = expandedMemberId === member.id
                      return (
                        <article
                          key={member.id}
                          className={`admin-team-member-row${selectedMember?.id === member.id ? ' selected' : ''}${expanded ? ' expanded' : ''}`}
                          aria-current={selectedMember?.id === member.id ? 'true' : undefined}
                          tabIndex={0}
                          onFocus={() => setSelectedMemberId(member.id)}
                          onKeyDown={(event) => handleMemberRowKeyDown(event, member)}
                          onContextMenu={(event) => openMemberContextMenu(event, member)}
                        >
                          <div className="admin-team-member-summary">
                            <button
                              type="button"
                              className="admin-team-member-primary"
                              aria-expanded={expanded}
                              aria-controls={`admin-team-member-detail-${member.id}`}
                              onClick={() => selectMember(member.id, { expand: true })}
                            >
                              <span className="team-member-avatar">{(member.displayName ?? member.invitedEmail).charAt(0).toUpperCase()}</span>
                              <span>
                                <strong>{member.displayName ?? member.invitedEmail}</strong>
                                <em>{member.invitedEmail}</em>
                              </span>
                            </button>

                            <div className="admin-team-member-role">
                              <strong>{tx(ADMIN_TEAM_ROLE_LABEL_KEYS[member.role])}</strong>
                              <span className={`admin-user-status ${member.status === 'active' ? 'admin-user-status-active' : 'admin-user-status-disabled'}`}>
                                {tx(member.status === 'active' ? 'team.statusActive' : 'team.statusPending')}
                              </span>
                            </div>

                            <div className="admin-team-member-relationship">
                              <span>{relationshipLabelFor(member)}</span>
                            </div>

                            <div className="admin-team-member-usage">
                              <strong>{formatBytes(memberStats?.storageUsedBytes ?? 0)}</strong>
                              <em>{format(tx('team.memberActiveLinks'), { count: memberStats?.activeShareCount ?? 0 })}</em>
                            </div>

                            <div className="admin-team-row-actions">
                              <button
                                type="button"
                                className="admin-team-row-menu"
                                aria-label={tx('table.actions')}
                                onClick={(event) => openMemberContextMenuFromButton(event, member)}
                              >
                                <MoreHorizontal size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="admin-team-row-disclosure"
                                aria-label={tx('team.adminTeamControls')}
                                aria-expanded={expanded}
                                aria-controls={`admin-team-member-detail-${member.id}`}
                                onClick={() => selectMember(member.id, { expand: true })}
                              >
                                {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                              </button>
                            </div>
                          </div>

                          <CollapsiblePanel
                            id={`admin-team-member-detail-${member.id}`}
                            open={expanded}
                            className="admin-team-member-disclosure"
                            innerClassName="admin-team-member-disclosure-inner"
                            collapseMs={340}
                          >
                            <div className="admin-team-member-fields">
                              <div className="admin-team-member-field">
                                <span>{tx('team.columnRole')}</span>
                                {member.role === 'owner' ? (
                                  <strong>{tx(ADMIN_TEAM_ROLE_LABEL_KEYS.owner)}</strong>
                                ) : (
                                  <Select
                                    size="small"
                                    value={member.role}
                                    disabled={memberBusy}
                                    options={(['admin', 'member'] as const).map((role) => ({
                                      value: role,
                                      label: tx(ADMIN_TEAM_ROLE_LABEL_KEYS[role]),
                                    }))}
                                    onChange={(role) => void handleRoleChange(member.id, role)}
                                  />
                                )}
                              </div>

                              {member.role === 'member' ? (
                                <div className="admin-team-member-field teachers">
                                  <span>{tx('team.relationshipAdvisorLabel')}</span>
                                  <div className="admin-team-teacher-multi">
                                    {activeTeachers.map((teacher) => {
                                      const teacherSelected = Boolean(teacher.userId && isTeacherAssignedToStudent(member, teacher.userId))
                                      return (
                                        <button
                                          key={teacher.id}
                                          type="button"
                                          className={teacherSelected ? 'selected' : ''}
                                          aria-pressed={teacherSelected}
                                          disabled={memberBusy}
                                          onClick={() => void handleTeacherAssignmentToggle(member.id, teacher.id)}
                                        >
                                          {teacher.displayName ?? teacher.invitedEmail}
                                          {teacherSelected ? <Check size={11} aria-hidden="true" /> : null}
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="admin-team-member-detail-footer">
                              <span>
                                <strong>{memberStats?.applicationCount ?? 0}</strong>
                                {tx('team.adminTeamApplicationsMetric')}
                              </span>
                              <span>
                                <strong>{memberStats?.activeShareCount ?? 0}</strong>
                                {tx('team.adminTeamSharesMetric')}
                              </span>
                              <div>
                                {linkedUser && member.status === 'active' ? (
                                  <button
                                    type="button"
                                    className="quiet-action"
                                    disabled={busyId === `enter:${linkedUser.id}`}
                                    onClick={() => void handleEnterLinkedUser(linkedUser)}
                                  >
                                    <LogIn size={12} aria-hidden="true" />
                                    {tx(member.role === 'member' ? 'team.enterStudentView' : 'team.enterMemberView')}
                                  </button>
                                ) : null}
                                {member.role !== 'owner' ? (
                                  <button
                                    type="button"
                                    className="danger-action"
                                    disabled={memberBusy}
                                    onClick={() => setPendingRemoveMemberId(member.id)}
                                  >
                                    <Trash2 size={12} aria-hidden="true" />
                                    {tx('team.removeMemberTitle')}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {!linkedUser ? <p className="admin-team-detail-note">{tx('team.adminTeamPendingAccountHint')}</p> : null}
                          </CollapsiblePanel>
                        </article>
                      )
                    })}
                  </div>
                )}

                <footer className="admin-team-shortcuts" aria-label={tx('shortcuts.title')}>
                  {memberShortcutHints.map((shortcut) => (
                    <span key={shortcut.keys}><kbd>{shortcut.keys}</kbd>{shortcut.label}</span>
                  ))}
                </footer>
              </section>

              <aside
                className={`admin-team-detail-panel${mobileInspectorOpen ? ' mobile-open' : ''}`}
                aria-label={tx('team.adminTeamAccountDetail')}
              >
                {selectedMember ? (
                  <>
                    <button
                      type="button"
                      className="admin-team-detail-sheet-handle"
                      aria-expanded={mobileInspectorOpen}
                      onClick={() => setMobileInspectorOpen((current) => !current)}
                    >
                      <span aria-hidden="true" />
                      <em className="sr-only">{tx('team.adminTeamAccountDetail')}</em>
                    </button>
                    <div className="admin-team-detail-head">
                      <span className="team-member-avatar">{(selectedMember.displayName ?? selectedMember.invitedEmail).charAt(0).toUpperCase()}</span>
                      <div>
                        <strong>{selectedMember.displayName ?? selectedMember.invitedEmail}</strong>
                        <em>{selectedMember.invitedEmail}</em>
                      </div>
                      <button
                        type="button"
                        className="admin-team-detail-mobile-close"
                        onClick={() => setMobileInspectorOpen(false)}
                        aria-label={tx('close')}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>

                    <div className="admin-team-detail-chips">
                      <span>{tx(ADMIN_TEAM_ROLE_LABEL_KEYS[selectedMember.role])}</span>
                      <span>{tx(selectedMember.status === 'active' ? 'team.statusActive' : 'team.statusPending')}</span>
                      <span>{selectedLinkedUser ? tx('team.adminTeamLinkedAccount') : tx('team.adminTeamNoLinkedAccount')}</span>
                    </div>

                    <div className="admin-team-detail-section">
                      <div className="admin-team-section-head compact">
                        <span>{tx('team.adminTeamPermissions')}</span>
                        <em>{tx('team.adminTeamPermissionsDesc')}</em>
                      </div>
                      <div className="admin-team-permission-list">
                        {(selectedMember.role === 'owner'
                          ? ['team.permissionOwnerVisibility', 'team.permissionOwnerAction', 'team.permissionOwnerAudit']
                          : selectedMember.role === 'admin'
                            ? ['team.permissionAdminVisibility', 'team.permissionAdminAction', 'team.permissionAdminAudit']
                            : ['team.permissionMemberVisibility', 'team.permissionMemberAction', 'team.permissionMemberAudit']
                        ).map((key) => (
                          <span key={key}>
                            <Check size={12} aria-hidden="true" />
                            {tx(key)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="admin-team-detail-section">
                      <div className="admin-team-section-head compact">
                        <span>{tx('team.adminTeamControls')}</span>
                        <em>{tx('team.adminTeamControlsDesc')}</em>
                      </div>
                      <div className="admin-team-detail-facts">
                        <span>
                          <em>{tx('team.columnRole')}</em>
                          <strong>{tx(ADMIN_TEAM_ROLE_LABEL_KEYS[selectedMember.role])}</strong>
                        </span>
                        <span>
                          <em>{tx('team.columnStatus')}</em>
                          <strong>{tx(selectedMember.status === 'active' ? 'team.statusActive' : 'team.statusPending')}</strong>
                        </span>
                        <span>
                          <em>{tx('team.relationshipAdvisorLabel')}</em>
                          <strong>{relationshipLabelFor(selectedMember)}</strong>
                        </span>
                      </div>
                      {!selectedLinkedUser ? <p className="admin-team-detail-note">{tx('team.adminTeamPendingAccountHint')}</p> : null}
                    </div>

                    <div className="admin-team-detail-section">
                      <div className="admin-team-section-head compact">
                        <span>{tx('team.adminTeamUsage')}</span>
                        <em>{tx('team.adminTeamUsageDesc')}</em>
                      </div>
                      <div className="admin-team-usage-list">
                        <span><em>{tx('team.adminTeamApplicationsMetric')}</em><strong>{selectedStats?.applicationCount ?? 0}</strong></span>
                        <span><em>{tx('team.adminTeamRiskMetric')}</em><strong>{(selectedStats?.riskCount ?? 0) + (selectedStats?.watchCount ?? 0)}</strong></span>
                        <span><em>{tx('team.adminTeamDueMetric')}</em><strong>{selectedStats?.dueSoonCount ?? 0}</strong></span>
                        <span><em>{tx('team.adminTeamFeedbackMetric')}</em><strong>{selectedStats?.reviewCommentCount ?? 0}</strong></span>
                        <span><em>{tx('team.adminTeamSharesMetric')}</em><strong>{selectedStats?.activeShareCount ?? 0}</strong></span>
                        <span><em>{tx('team.memberStorageUsed')}</em><strong>{formatBytes(selectedStats?.storageUsedBytes ?? 0)}</strong></span>
                      </div>
                    </div>

                    <div className="admin-team-detail-actions">
                      {selectedLinkedUser && selectedMember.status === 'active' ? (
                        <button
                          type="button"
                          className="quiet-action"
                          disabled={busyId === `enter:${selectedLinkedUser.id}`}
                          onClick={() => void handleEnterLinkedUser(selectedLinkedUser)}
                        >
                          <LogIn size={12} aria-hidden="true" />
                          {tx(selectedMember.role === 'member' ? 'team.enterStudentView' : 'team.enterMemberView')}
                        </button>
                      ) : null}
                      {selectedMember.role !== 'owner' ? (
                        <button
                          type="button"
                          className="danger-action"
                          disabled={busyId === selectedMember.id}
                          onClick={() => setPendingRemoveMemberId(selectedMember.id)}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                          {tx('team.removeMemberTitle')}
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="admin-team-detail-note">{tx('team.adminTeamSelectMember')}</p>
                )}
              </aside>
            </div>
          </div>
        ) : (
          <p>{tx('team.noTeamDescription')}</p>
        )}
        <ExplorerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
        <ConfirmDialog
          open={Boolean(pendingRemoveMember)}
          title={tx('team.removeMemberTitle')}
          message={pendingRemoveMember ? format(tx('team.removeMemberConfirm'), {
            name: pendingRemoveMember.displayName ?? pendingRemoveMember.invitedEmail,
            team: summary?.team.name ?? ownerEmail,
          }) : ''}
          confirmLabel={tx('team.removeMemberTitle')}
          variant="danger"
          onConfirm={() => {
            if (pendingRemoveMember) void handleRemove(pendingRemoveMember.id)
          }}
          onCancel={() => setPendingRemoveMemberId(null)}
        />
      </div>
    </div>
    </ModalPortal>
  )
}
