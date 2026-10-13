import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileCheck,
  GitBranch,
  Laptop,
  LoaderCircle,
  PauseCircle,
  Pencil,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import {
  getLatestSessionToken,
  phdApi,
  type CodexAuthorizationStatus,
  type CodexAuthorizationSummary,
  type CodexDeviceAuthorizationPreview,
} from '../../api/phdApi'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { copyToClipboard } from '../shared/clipboard'
import { ModalPortal } from '../shared/ModalPortal'
import { PendingLabel } from '../shared/PendingLabel'

const CODEX_SKILL_DOWNLOAD_PATH = '/downloads/phd-atlas-codex-skill.zip'
const CODEX_SKILL_CHECKSUM_PATH = '/downloads/phd-atlas-codex-skill.zip.sha256'
const CODEX_PLUGIN_DOWNLOAD_PATH = '/downloads/phd-atlas-codex-plugin.zip'
const CODEX_PLUGIN_CHECKSUM_PATH = '/downloads/phd-atlas-codex-plugin.zip.sha256'
const CLAUDE_MCPB_DOWNLOAD_PATH = '/downloads/phd-atlas-claude.mcpb'
const CLAUDE_MCPB_CHECKSUM_PATH = '/downloads/phd-atlas-claude.mcpb.sha256'
const CODEX_SKILL_GITHUB_URL = 'https://github.com/zhoujasper/phd-atlas/tree/main/integrations/codex/plugins/phd-atlas/skills/phd-atlas'
const CODEX_SKILL_INSTALL_PROMPT = `Use skill-installer to install the PhD Atlas skill from ${CODEX_SKILL_GITHUB_URL}. Then use $phd-atlas to connect my account.`
const GITHUB_LABEL = 'GitHub'
const CODEX_IDLE_TIMEOUT_MS = 180 * 24 * 60 * 60 * 1000

const HIGH_RISK_SCOPES = new Set([
  'applications:write',
  'profile:write',
  'files:write',
  'communications:send',
  'discover:write',
  'notifications:write',
  'settings:write',
  'ai:use',
  'ai:manage',
  'backups:manage',
  'shares:manage',
  'mail:manage',
  'interview:write',
  'interview:use',
])

const SCOPE_GROUPS = [
  {
    id: 'applications',
    labelKey: 'settings.codex.scopeGroupApplications',
    prefixes: ['applications:', 'discover:', 'analytics:'],
  },
  {
    id: 'profile',
    labelKey: 'settings.codex.scopeGroupProfile',
    prefixes: ['profile:', 'files:', 'exports:', 'backups:'],
  },
  {
    id: 'communications',
    labelKey: 'settings.codex.scopeGroupCommunications',
    prefixes: ['communications:', 'notifications:', 'shares:', 'mail:'],
  },
  {
    id: 'account',
    labelKey: 'settings.codex.scopeGroupAccount',
    prefixes: ['settings:', 'ai:'],
  },
  {
    id: 'interview',
    labelKey: 'settings.codex.scopeGroupInterview',
    prefixes: ['interview:'],
  },
] as const

type Notify = (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
type CodexAuthorizationManagerProps = {
  sessionToken: string
  userId: string
  onNotify?: Notify
}
type LoadedAuthorizations = {
  userId: string
  items: CodexAuthorizationSummary[]
}
type DeviceRequestState = {
  userId: string
  userCode: string
  preview: CodexDeviceAuthorizationPreview | null
  error: string | null
  loading: boolean
  decision: 'approve' | 'deny' | null
}
type InstallClient = 'codex' | 'claude'
type DisplayAuthorizationStatus = CodexAuthorizationStatus | 'unknown'

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function belongsToCurrentSessionLineage(requestToken: string, currentToken: string) {
  return requestToken === currentToken
    || getLatestSessionToken(requestToken) === getLatestSessionToken(currentToken)
}

function formatTimestamp(value: string | null, language: string, emptyLabel: string) {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

function deviceCodeFromLocation() {
  if (typeof window === 'undefined') return ''
  const query = new URLSearchParams(window.location.search)
  return (query.get('mcpCode') || query.get('codexCode'))?.trim() ?? ''
}

function normalizeDeviceCode(value: string) {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replaceAll('O', '0')
    .replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(normalized)
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : null
}

function deviceTerminalStatusKey(preview: CodexDeviceAuthorizationPreview) {
  switch (preview.status) {
    case 'approved': return 'settings.codex.deviceApproved'
    case 'denied': return 'settings.codex.deviceDenied'
    case 'expired': return 'settings.codex.statusExpired'
    case 'invalidated': return 'settings.codex.statusInvalidated'
    case 'consumed': return 'settings.codex.deviceConsumed'
    default: return 'settings.codex.deviceUnavailable'
  }
}

function displayAuthorizationStatus(
  authorization: CodexAuthorizationSummary,
  now: number,
): DisplayAuthorizationStatus {
  if (authorization.revokedAt || authorization.status === 'revoked') return 'revoked'
  if (authorization.disabledAt || authorization.status === 'disabled') return 'disabled'
  if (authorization.status === 'invalidated') return 'invalidated'
  if (authorization.status === 'idle_expired') return 'idle_expired'
  if (authorization.status === 'expired') return 'expired'
  if (authorization.status !== 'active') return 'unknown'
  const expiresAt = authorization.expiresAt
    ? new Date(authorization.expiresAt).getTime()
    : Number.POSITIVE_INFINITY
  if (Number.isFinite(expiresAt) && expiresAt <= now) return 'expired'
  const idleAnchor = new Date(authorization.lastUsedAt ?? authorization.createdAt).getTime()
  if (Number.isFinite(idleAnchor) && idleAnchor + CODEX_IDLE_TIMEOUT_MS <= now) return 'idle_expired'
  return 'active'
}

function statusLabelKey(status: DisplayAuthorizationStatus) {
  switch (status) {
    case 'active': return 'settings.codex.statusActive'
    case 'disabled': return 'settings.codex.statusDisabled'
    case 'expired': return 'settings.codex.statusExpired'
    case 'revoked': return 'settings.codex.statusRevoked'
    case 'invalidated': return 'settings.codex.statusInvalidated'
    case 'idle_expired': return 'settings.codex.statusIdleExpired'
    default: return 'settings.codex.statusUnknown'
  }
}

function scopesByGroup(scopes: readonly string[]) {
  const remaining = new Set(scopes)
  const groups: Array<{
    id: string
    labelKey: string
    prefixes: readonly string[]
    items: string[]
  }> = SCOPE_GROUPS.map((group) => {
    const items = scopes.filter((scope) => group.prefixes.some((prefix) => scope.startsWith(prefix)))
    items.forEach((scope) => remaining.delete(scope))
    return { ...group, items }
  }).filter((group) => group.items.length > 0)
  if (remaining.size > 0) {
    groups.push({
      id: 'other',
      labelKey: 'settings.codex.scopeGroupOther',
      prefixes: [],
      items: Array.from(remaining),
    })
  }
  return groups
}

function ScopeSummary({ scopes }: { scopes: readonly string[] }) {
  const { tx, format } = useI18n()
  const groups = useMemo(() => scopesByGroup(scopes), [scopes])
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) => setOpenGroups((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <div className="codex-scope-groups">
      {groups.map((group) => {
        const open = openGroups.has(group.id)
        const riskCount = group.items.filter((scope) => HIGH_RISK_SCOPES.has(scope) || group.id === 'other').length
        const panelId = `codex-scope-${group.id}`
        return (
          <section key={group.id} className={`codex-scope-group${open ? ' is-open' : ''}`}>
            <button
              type="button"
              className="codex-scope-toggle"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(group.id)}
            >
              <span className="codex-scope-name">{tx(group.labelKey)}</span>
              <span className="codex-scope-count">{group.items.length}</span>
              {riskCount > 0 ? (
                <span className="codex-scope-risk">
                  <AlertTriangle size={11} aria-hidden="true" />
                  {format(tx('settings.codex.highRiskCount'), { count: riskCount })}
                </span>
              ) : null}
              <ChevronDown className="codex-disclosure-chevron" size={14} aria-hidden="true" />
            </button>
            <CollapsiblePanel id={panelId} open={open} keepMounted className="codex-scope-panel">
              <ul>
                {group.items.map((scope) => {
                  const highRisk = HIGH_RISK_SCOPES.has(scope) || group.id === 'other'
                  return (
                    <li key={scope} className={highRisk ? 'is-high-risk' : ''}>
                      <code>{scope}</code>
                      {highRisk ? (
                        <span><AlertTriangle size={10} aria-hidden="true" />{tx('settings.codex.highRisk')}</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </CollapsiblePanel>
          </section>
        )
      })}
    </div>
  )
}

function DeviceAuthorizationDialog({
  request,
  onClose,
  onRetry,
  onDecision,
}: {
  request: DeviceRequestState
  onClose: () => void
  onRetry: () => void
  onDecision: (decision: 'approve' | 'deny') => void
}) {
  const { tx, format, lang } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const busy = request.decision !== null
  const requestedScopes = request.preview?.requestedScopes ?? []
  const dialogRef = useModalA11y<HTMLDivElement>({
    open: true,
    onClose: () => {
      if (!busy) onClose()
    },
    initialFocusRef: closeRef,
  })

  return (
    <ModalPortal>
      <div className="dialog-layer codex-device-layer" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}>
        <div
          ref={dialogRef}
          className="codex-device-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={request.loading || busy || undefined}
        >
          <header>
            <span className="codex-dialog-icon" aria-hidden="true"><Bot size={19} /></span>
            <div>
              <h3 id={titleId}>{tx('settings.codex.deviceTitle')}</h3>
              <p id={descriptionId}>{tx('settings.codex.deviceDescription')}</p>
            </div>
            <button ref={closeRef} type="button" className="codex-icon-button" disabled={busy} onClick={onClose} aria-label={tx('close')}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="codex-device-body">
          <div className="codex-device-code">
            <span>{tx('settings.codex.deviceCode')}</span>
            <code>{request.userCode}</code>
          </div>

          {request.loading ? (
            <div className="codex-dialog-loading" role="status">
              <LoaderCircle className="spin-icon" size={17} aria-hidden="true" />
              {tx('settings.codex.deviceLoading')}
            </div>
          ) : request.error ? (
            <div className="codex-dialog-error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{request.error}</span>
              {normalizeDeviceCode(request.userCode) ? (
                <button type="button" className="quiet-action compact-action" onClick={onRetry}>
                  <RefreshCw size={12} aria-hidden="true" />
                  {tx('settings.codex.retry')}
                </button>
              ) : null}
            </div>
          ) : request.preview ? (
            <>
              <div className="codex-device-client">
                <span className="codex-device-avatar" aria-hidden="true"><Laptop size={15} /></span>
                <div className="codex-device-client-copy">
                  <strong>{request.preview.clientName}</strong>
                  <span>{request.preview.deviceName || tx('settings.codex.unknownDevice')}</span>
                </div>
                <ul className="codex-device-facts">
                  <li><ShieldCheck size={12} aria-hidden="true" />{request.preview.requestedExpiresInDays
                    ? format(tx('settings.codex.deviceLifetimeDays'), { count: request.preview.requestedExpiresInDays })
                    : tx('settings.codex.deviceActiveUntilRevoked')}</li>
                  {request.preview.expiresAt ? (
                    <li><Clock size={12} aria-hidden="true" />{format(tx('settings.codex.deviceRequestExpiresAt'), {
                      date: formatTimestamp(request.preview.expiresAt, lang, tx('settings.codex.unknownDate')),
                    })}</li>
                  ) : null}
                </ul>
              </div>
              {request.preview.status === 'pending' ? (
                <div className="codex-device-permissions">
                  <div className="codex-device-permissions-head">
                    <strong>{tx('settings.codex.requestedPermissions')}</strong>
                    <span className="codex-count-badge">{requestedScopes.length}</span>
                  </div>
                  <p>{tx('settings.codex.devicePermissionWarning')}</p>
                  <ScopeSummary scopes={requestedScopes} />
                </div>
              ) : null}
              {request.preview.status === 'pending'
                && request.preview.scopeVersion === 2
                && requestedScopes.length > 0 ? (
                  <div className="codex-device-actions">
                    <button type="button" className="quiet-action" disabled={busy} onClick={() => onDecision('deny')}>
                      {request.decision === 'deny'
                        ? <PendingLabel label={tx('settings.codex.denying')} />
                        : tx('settings.codex.deny')}
                    </button>
                    <button type="button" className="primary-action" disabled={busy} onClick={() => onDecision('approve')}>
                      {request.decision === 'approve'
                        ? <PendingLabel label={tx('settings.codex.approving')} />
                        : <><ShieldCheck size={14} aria-hidden="true" />{tx('settings.codex.approve')}</>}
                    </button>
                  </div>
                ) : (
                  <div className={`codex-device-terminal${request.preview.status === 'approved' ? ' is-approved' : ''}`} role="status">
                    {request.preview.status === 'approved'
                      ? <Check size={15} aria-hidden="true" />
                      : <AlertTriangle size={15} aria-hidden="true" />}
                    <span>{request.preview.status === 'approved'
                      ? format(tx('settings.codex.returnToClient'), { client: request.preview.clientName })
                      : tx(deviceTerminalStatusKey(request.preview))}</span>
                    <button type="button" className="quiet-action compact-action" onClick={onClose}>{tx('close')}</button>
                  </div>
                )}
            </>
          ) : null}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

export function CodexAuthorizationManager(props: CodexAuthorizationManagerProps) {
  const sessionOwnerRef = useRef({ userId: props.userId, token: props.sessionToken })
  const sessionOwner = sessionOwnerRef.current
  if (
    sessionOwner.userId !== props.userId
    || !belongsToCurrentSessionLineage(sessionOwner.token, props.sessionToken)
  ) {
    sessionOwnerRef.current = { userId: props.userId, token: props.sessionToken }
  }
  const owner = sessionOwnerRef.current
  return <CodexAuthorizationManagerSession key={`${owner.userId}:${owner.token}`} {...props} />
}

function CodexAuthorizationManagerSession({
  sessionToken,
  userId,
  onNotify,
}: CodexAuthorizationManagerProps) {
  const { tx, format, lang } = useI18n()
  const [loaded, setLoaded] = useState<LoadedAuthorizations | null>(null)
  const [loadError, setLoadError] = useState<{ userId: string; message: string } | null>(null)
  const [installClient, setInstallClient] = useState<InstallClient>('codex')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [promptCopyState, setPromptCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const promptCopyTimerRef = useRef<number | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CodexAuthorizationSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [pausingId, setPausingId] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [deviceRequest, setDeviceRequest] = useState<DeviceRequestState | null>(null)
  const [locationDeviceCode, setLocationDeviceCode] = useState(deviceCodeFromLocation)
  const [statusNow, setStatusNow] = useState(Date.now)
  const currentUserIdRef = useRef(userId)
  const currentTokenRef = useRef(sessionToken)
  const devicePreviewControllerRef = useRef<AbortController | null>(null)
  const authorizationRevisionRef = useRef(0)
  currentUserIdRef.current = userId
  currentTokenRef.current = sessionToken

  const authorizations = loaded?.userId === userId ? loaded.items : null
  const visibleDeviceRequest = deviceRequest?.userId === userId ? deviceRequest : null
  const installerPrompt = useMemo(() => {
    if (typeof window === 'undefined' || !window.location.origin) return CODEX_SKILL_INSTALL_PROMPT
    return `${CODEX_SKILL_INSTALL_PROMPT.slice(0, -1)} at ${window.location.origin}.`
  }, [])

  const stillOwnsRequest = useCallback((requestUserId: string, requestToken: string) => (
    currentUserIdRef.current === requestUserId
    && belongsToCurrentSessionLineage(requestToken, currentTokenRef.current)
  ), [])

  const loadAuthorizations = useCallback(async (signal?: AbortSignal) => {
    const requestUserId = userId
    const requestToken = sessionToken
    const requestRevision = authorizationRevisionRef.current
    setLoadError(null)
    try {
      const items = await phdApi.listCodexAuthorizations(requestToken, { signal })
      if (
        !stillOwnsRequest(requestUserId, requestToken)
        || authorizationRevisionRef.current !== requestRevision
      ) return
      setLoaded({ userId: requestUserId, items })
    } catch (error) {
      if (isAbortError(error)) return
      if (
        !stillOwnsRequest(requestUserId, requestToken)
        || authorizationRevisionRef.current !== requestRevision
      ) return
      setLoaded({ userId: requestUserId, items: [] })
      setLoadError({
        userId: requestUserId,
        message: errorMessage(error, tx('settings.codex.loadFailed')),
      })
    }
  }, [sessionToken, stillOwnsRequest, tx, userId])

  useEffect(() => {
    setLoaded(null)
    const controller = new AbortController()
    void loadAuthorizations(controller.signal)
    return () => controller.abort()
  }, [loadAuthorizations])

  useEffect(() => () => {
    if (promptCopyTimerRef.current !== null) window.clearTimeout(promptCopyTimerRef.current)
  }, [])

  useEffect(() => {
    const updateClock = () => setStatusNow(Date.now())
    const interval = window.setInterval(updateClock, 60_000)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [])

  const removeDeviceCodeFromUrl = useCallback(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (!url.searchParams.has('mcpCode') && !url.searchParams.has('codexCode')) return
    url.searchParams.delete('mcpCode')
    url.searchParams.delete('codexCode')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const loadDevicePreview = useCallback(async (userCode: string) => {
    const requestUserId = userId
    const requestToken = sessionToken
    devicePreviewControllerRef.current?.abort()
    const controller = new AbortController()
    devicePreviewControllerRef.current = controller
    setDeviceRequest({
      userId: requestUserId,
      userCode,
      preview: null,
      error: null,
      loading: true,
      decision: null,
    })
    try {
      const preview = await phdApi.previewCodexDeviceAuthorization(requestToken, userCode, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || devicePreviewControllerRef.current !== controller) return
      if (!stillOwnsRequest(requestUserId, requestToken)) return
      setDeviceRequest({
        userId: requestUserId,
        userCode,
        preview,
        error: null,
        loading: false,
        decision: null,
      })
    } catch (error) {
      if (isAbortError(error)) return
      if (controller.signal.aborted || devicePreviewControllerRef.current !== controller) return
      if (!stillOwnsRequest(requestUserId, requestToken)) return
      setDeviceRequest({
        userId: requestUserId,
        userCode,
        preview: null,
        error: errorMessage(error, tx('settings.codex.deviceLoadFailed')),
        loading: false,
        decision: null,
      })
    } finally {
      if (devicePreviewControllerRef.current === controller) {
        devicePreviewControllerRef.current = null
      }
    }
  }, [sessionToken, stillOwnsRequest, tx, userId])

  useEffect(() => {
    const syncLocationCode = () => setLocationDeviceCode(deviceCodeFromLocation())
    window.addEventListener('popstate', syncLocationCode)
    return () => window.removeEventListener('popstate', syncLocationCode)
  }, [])

  useEffect(() => {
    if (!locationDeviceCode) return undefined
    const userCode = normalizeDeviceCode(locationDeviceCode)
    if (!userCode) {
      setDeviceRequest({
        userId,
        userCode: locationDeviceCode.slice(0, 16),
        preview: null,
        error: tx('settings.codex.deviceInvalidCode'),
        loading: false,
        decision: null,
      })
      return undefined
    }
    void loadDevicePreview(userCode)
    return () => {
      devicePreviewControllerRef.current?.abort()
      devicePreviewControllerRef.current = null
    }
  }, [loadDevicePreview, locationDeviceCode, tx, userId])

  const closeDeviceRequest = useCallback(() => {
    devicePreviewControllerRef.current?.abort()
    devicePreviewControllerRef.current = null
    setDeviceRequest(null)
    setLocationDeviceCode('')
    removeDeviceCodeFromUrl()
  }, [removeDeviceCodeFromUrl])

  const decideDeviceRequest = useCallback(async (decision: 'approve' | 'deny') => {
    const request = deviceRequest
    if (
      !request
      || request.userId !== userId
      || request.loading
      || request.decision
      || request.preview?.status !== 'pending'
      || request.preview.scopeVersion !== 2
      || request.preview.requestedScopes.length === 0
    ) return
    const requestToken = sessionToken
    setDeviceRequest({ ...request, error: null, decision })
    try {
      const result = decision === 'approve'
        ? await phdApi.approveCodexDeviceAuthorization(requestToken, request.userCode)
        : await phdApi.denyCodexDeviceAuthorization(requestToken, request.userCode)
      if (!stillOwnsRequest(request.userId, requestToken)) return
      removeDeviceCodeFromUrl()
      setDeviceRequest({
        ...request,
        preview: result.deviceAuthorization,
        error: null,
        loading: false,
        decision: null,
      })
      onNotify?.(
        tx(decision === 'approve' ? 'settings.codex.deviceApproved' : 'settings.codex.deviceDenied'),
        'success',
      )
      if (decision === 'approve') void loadAuthorizations()
    } catch (error) {
      if (!stillOwnsRequest(request.userId, requestToken)) return
      const message = errorMessage(error, tx('settings.codex.deviceDecisionFailed'))
      setDeviceRequest({ ...request, error: message, loading: false, decision: null })
      onNotify?.(message, 'error')
    }
  }, [deviceRequest, loadAuthorizations, onNotify, removeDeviceCodeFromUrl, sessionToken, stillOwnsRequest, tx, userId])

  const replaceAuthorization = (requestUserId: string, updated: CodexAuthorizationSummary) => {
    authorizationRevisionRef.current += 1
    setLoaded((current) => current?.userId === requestUserId
      ? { ...current, items: current.items.map((item) => item.id === updated.id ? updated : item) }
      : current)
  }

  const beginRename = (authorization: CodexAuthorizationSummary) => {
    setRenamingId(authorization.id)
    setRenameDraft(authorization.name)
    setRenameError(null)
    setOperationError(null)
  }

  const submitRename = async (event: FormEvent, authorization: CodexAuthorizationSummary) => {
    event.preventDefault()
    const name = renameDraft.trim()
    if (!name || renameBusy) return
    const requestUserId = userId
    const requestToken = sessionToken
    setRenameBusy(true)
    setRenameError(null)
    try {
      const updated = await phdApi.updateCodexAuthorization(requestToken, authorization.id, name)
      if (!stillOwnsRequest(requestUserId, requestToken)) return
      replaceAuthorization(requestUserId, updated)
      setRenamingId(null)
      onNotify?.(tx('settings.codex.renamed'), 'success')
    } catch (error) {
      if (!stillOwnsRequest(requestUserId, requestToken)) return
      const message = errorMessage(error, tx('settings.codex.renameFailed'))
      setRenameError(message)
      onNotify?.(message, 'error')
    } finally {
      if (stillOwnsRequest(requestUserId, requestToken)) setRenameBusy(false)
    }
  }

  const togglePaused = async (authorization: CodexAuthorizationSummary, paused: boolean) => {
    const requestUserId = userId
    const requestToken = sessionToken
    setOperationError(null)
    setPausingId(authorization.id)
    try {
      const updated = await phdApi.setCodexAuthorizationDisabled(requestToken, authorization.id, paused)
      if (!stillOwnsRequest(requestUserId, requestToken)) return
      replaceAuthorization(requestUserId, updated)
      onNotify?.(tx(paused ? 'settings.codex.paused' : 'settings.codex.resumed'), 'success')
    } catch (error) {
      if (!stillOwnsRequest(requestUserId, requestToken)) return
      const message = errorMessage(error, tx(paused ? 'settings.codex.pauseFailed' : 'settings.codex.resumeFailed'))
      setOperationError(message)
      onNotify?.(message, 'error')
    } finally {
      if (stillOwnsRequest(requestUserId, requestToken)) setPausingId(null)
    }
  }

  const deleteAuthorization = async () => {
    const target = deleteTarget
    if (!target || deleteBusy) return
    const requestUserId = userId
    const requestToken = sessionToken
    setDeleteBusy(true)
    setOperationError(null)
    try {
      await phdApi.deleteCodexAuthorization(requestToken, target.id)
      if (!stillOwnsRequest(requestUserId, requestToken)) return
      authorizationRevisionRef.current += 1
      setLoaded((current) => current?.userId === requestUserId
        ? { ...current, items: current.items.filter((item) => item.id !== target.id) }
        : current)
      setDeleteTarget(null)
      if (renamingId === target.id) setRenamingId(null)
      onNotify?.(tx('settings.codex.deleted'), 'success')
    } catch (error) {
      if (!stillOwnsRequest(requestUserId, requestToken)) return
      const message = errorMessage(error, tx('settings.codex.deleteFailed'))
      setOperationError(message)
      onNotify?.(message, 'error')
      throw error
    } finally {
      if (stillOwnsRequest(requestUserId, requestToken)) setDeleteBusy(false)
    }
  }

  const clientLabel = installClient === 'codex'
    ? tx('settings.codex.clientCodex')
    : tx('settings.codex.clientClaude')

  const copyInstallerPrompt = async () => {
    const ok = await copyToClipboard(installerPrompt)
    setPromptCopyState(ok ? 'copied' : 'failed')
    if (!ok) onNotify?.(tx('copyFailed'), 'error')
    if (promptCopyTimerRef.current !== null) window.clearTimeout(promptCopyTimerRef.current)
    promptCopyTimerRef.current = window.setTimeout(() => {
      promptCopyTimerRef.current = null
      setPromptCopyState('idle')
    }, 1800)
  }

  const verifiedDownloads = [
    { href: CODEX_SKILL_DOWNLOAD_PATH, label: tx('settings.codex.skillBundle'), kind: tx('settings.codex.zipLabel'), icon: FileArchive },
    { href: CODEX_SKILL_CHECKSUM_PATH, label: tx('settings.codex.skillBundle'), kind: tx('settings.codex.checksumLabel'), icon: FileCheck },
    { href: CODEX_PLUGIN_CHECKSUM_PATH, label: tx('settings.codex.clientCodex'), kind: tx('settings.codex.checksumLabel'), icon: FileCheck },
    { href: CLAUDE_MCPB_CHECKSUM_PATH, label: tx('settings.codex.clientClaude'), kind: tx('settings.codex.checksumLabel'), icon: FileCheck },
  ]

  return (
    <div className="codex-authorization-manager">
      <section className={`codex-setup${setupOpen ? ' is-open' : ''}`} aria-labelledby="codex-setup-title">
        <button
          type="button"
          className="codex-setup-summary"
          aria-expanded={setupOpen}
          aria-controls="codex-setup-body"
          onClick={() => setSetupOpen((open) => !open)}
        >
          <span className="codex-setup-mark" aria-hidden="true"><Laptop size={16} /></span>
          <span className="codex-setup-copy">
            <strong id="codex-setup-title">{tx('settings.codex.setupTitle')}</strong>
            <span>{tx('settings.codex.setupDescription')}</span>
          </span>
          <span className="codex-setup-clients" aria-hidden="true">
            <span>{tx('settings.codex.clientCodex')}</span>
            <span>{tx('settings.codex.clientClaude')}</span>
          </span>
          <ChevronDown className="codex-disclosure-chevron" size={15} aria-hidden="true" />
        </button>

        <CollapsiblePanel id="codex-setup-body" open={setupOpen} className="codex-setup-body">
          <div className="codex-setup-inner">
            <div
              className="codex-client-switch"
              role="tablist"
              aria-label={tx('settings.codex.chooseClient')}
              style={{ '--codex-client-index': installClient === 'codex' ? 0 : 1 } as CSSProperties}
            >
              <span className="codex-client-indicator" aria-hidden="true" />
              <button
                type="button"
                role="tab"
                aria-selected={installClient === 'codex'}
                className={installClient === 'codex' ? 'selected' : ''}
                onClick={() => setInstallClient('codex')}
              >
                {tx('settings.codex.clientCodex')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={installClient === 'claude'}
                className={installClient === 'claude' ? 'selected' : ''}
                onClick={() => setInstallClient('claude')}
              >
                {tx('settings.codex.clientClaude')}
              </button>
            </div>

            <ol className="codex-setup-steps" key={installClient}>
              <li className="codex-setup-step">
                <span className="codex-step-number" aria-hidden="true">1</span>
                <div className="codex-step-body">
                  <strong>{tx('settings.codex.installStepTitle')}</strong>
                  <p>{tx(installClient === 'codex'
                    ? 'settings.codex.codexInstallDescription'
                    : 'settings.codex.claudeInstallDescription')}</p>
                  <div className="codex-step-actions">
                    <a
                      className="codex-download-action"
                      href={installClient === 'codex' ? CODEX_PLUGIN_DOWNLOAD_PATH : CLAUDE_MCPB_DOWNLOAD_PATH}
                      download
                    >
                      <Download size={13} aria-hidden="true" />
                      {tx(installClient === 'codex'
                        ? 'settings.codex.downloadCodexPlugin'
                        : 'settings.codex.downloadClaudeBundle')}
                    </a>
                    {installClient === 'codex' ? (
                      <button
                        type="button"
                        className={`codex-copy-action${promptCopyState !== 'idle' ? ` is-${promptCopyState}` : ''}`}
                        onClick={() => void copyInstallerPrompt()}
                        aria-label={promptCopyState === 'copied' ? tx('copiedBang') : tx('settings.codex.copyInstallPrompt')}
                      >
                        <span className="codex-copy-icon" aria-hidden="true">
                          <Copy className={promptCopyState === 'idle' ? 'is-active' : ''} size={13} />
                          <Check className={promptCopyState === 'copied' ? 'is-active' : ''} size={13} />
                          <AlertTriangle className={promptCopyState === 'failed' ? 'is-active' : ''} size={13} />
                        </span>
                        {promptCopyState === 'copied' ? tx('copiedBang') : tx('settings.codex.copyInstallPrompt')}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
              <li className="codex-setup-step">
                <span className="codex-step-number" aria-hidden="true">2</span>
                <div className="codex-step-body">
                  <strong>{tx('settings.codex.connectStepTitle')}</strong>
                  <p>{format(tx('settings.codex.connectDescription'), { client: clientLabel })}</p>
                </div>
              </li>
            </ol>

            <div className={`codex-advanced${advancedOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="codex-advanced-toggle"
                aria-expanded={advancedOpen}
                aria-controls="codex-advanced-install"
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                <ShieldCheck size={13} aria-hidden="true" />
                <span>{tx('settings.codex.advancedInstall')}</span>
                <ChevronDown className="codex-disclosure-chevron" size={13} aria-hidden="true" />
              </button>
              <CollapsiblePanel id="codex-advanced-install" open={advancedOpen} className="codex-advanced-install">
                <ul className="codex-verified-downloads">
                  {verifiedDownloads.map((item) => {
                    const Icon = item.icon
                    return (
                      <li key={item.href}>
                        <a href={item.href} download>
                          <Icon size={14} aria-hidden="true" />
                          <span className="codex-file-name">{item.label}</span>
                          <span className="codex-file-kind">{item.kind}</span>
                          <Download className="codex-file-action" size={13} aria-hidden="true" />
                        </a>
                      </li>
                    )
                  })}
                  <li>
                    <a href={CODEX_SKILL_GITHUB_URL} target="_blank" rel="noreferrer">
                      <GitBranch size={14} aria-hidden="true" />
                      <span className="codex-file-name">{tx('settings.codex.openGithub')}</span>
                      <span className="codex-file-kind">{GITHUB_LABEL}</span>
                      <ExternalLink className="codex-file-action" size={13} aria-hidden="true" />
                    </a>
                  </li>
                </ul>
              </CollapsiblePanel>
            </div>
          </div>
        </CollapsiblePanel>
      </section>

      <section className="codex-connected" aria-labelledby="codex-connected-title">
        <div className="codex-connected-heading">
          <div>
            <h3 id="codex-connected-title">{tx('settings.codex.connectedDevices')}</h3>
            {authorizations ? <span className="codex-count-badge">{authorizations.length}</span> : null}
          </div>
          <button type="button" className="codex-icon-button" onClick={() => {
            setLoaded(null)
            void loadAuthorizations()
          }} aria-label={tx('settings.codex.retry')} title={tx('settings.codex.retry')}>
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </div>

        {operationError ? <p className="codex-inline-error codex-operation-error" role="alert">{operationError}</p> : null}

        {authorizations === null ? (
          <div className="codex-list-state" role="status">
            <LoaderCircle className="spin-icon" size={16} aria-hidden="true" />
            <span>{tx('settings.codex.loading')}</span>
          </div>
        ) : loadError?.userId === userId ? (
          <div className="codex-list-state is-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{loadError.message}</span>
            <button type="button" className="quiet-action compact-action" onClick={() => {
              setLoaded(null)
              void loadAuthorizations()
            }}>
              <RefreshCw size={12} aria-hidden="true" />
              {tx('settings.codex.retry')}
            </button>
          </div>
        ) : authorizations.length === 0 ? (
          <div className="codex-list-state is-empty">
            <span className="codex-empty-icon" aria-hidden="true"><Bot size={18} /></span>
            <strong>{tx('settings.codex.emptyTitle')}</strong>
            <span>{tx('settings.codex.emptyHint')}</span>
            {!setupOpen ? (
              <button type="button" className="quiet-action compact-action" onClick={() => setSetupOpen(true)}>
                {tx('settings.codex.installGuide')}
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="codex-authorization-list" aria-label={tx('settings.codex.savedAuthorizations')}>
            {authorizations.map((authorization) => {
              const status = displayAuthorizationStatus(authorization, statusNow)
              const active = status === 'active'
              const paused = status === 'disabled'
              const manageable = active || paused
              const pauseBusy = pausingId === authorization.id
              const isClaude = /claude/i.test(authorization.clientName)
              return (
                <li key={authorization.id} className={`codex-device-row${paused ? ' is-paused' : !active ? ' is-inactive' : ''}`}>
                  <span className={`codex-device-avatar${isClaude ? ' is-claude' : ''}`} aria-hidden="true">
                    {isClaude ? <Bot size={15} /> : <Laptop size={15} />}
                    <span className={`codex-status-dot is-${status}`} />
                  </span>
                  <div className="codex-device-main">
                    {renamingId === authorization.id ? (
                      <form className="codex-rename-form" onSubmit={(event) => void submitRename(event, authorization)}>
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          maxLength={80}
                          required
                          disabled={renameBusy}
                          aria-label={tx('settings.codex.name')}
                        />
                        <button type="submit" className="codex-icon-button" disabled={renameBusy || !renameDraft.trim()} aria-label={tx('settings.codex.renameSave')}>
                          {renameBusy ? <LoaderCircle className="spin-icon" size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
                        </button>
                        <button type="button" className="codex-icon-button" disabled={renameBusy} onClick={() => {
                          setRenamingId(null)
                          setRenameError(null)
                        }} aria-label={tx('settings.codex.renameCancel')}>
                          <X size={12} aria-hidden="true" />
                        </button>
                      </form>
                    ) : (
                      <div className="codex-authorization-title">
                        <strong>{authorization.name}</strong>
                        {!active ? (
                          <span className={`codex-status-pill is-${status}`}>{tx(statusLabelKey(status))}</span>
                        ) : null}
                        <button type="button" className="codex-icon-button codex-rename-trigger" disabled={renameBusy} onClick={() => beginRename(authorization)} aria-label={format(tx('settings.codex.renameNamed'), { name: authorization.name })}>
                          <Pencil size={11} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                    {renameError && renamingId === authorization.id ? <span className="codex-row-error" role="alert">{renameError}</span> : null}
                    <div className="codex-device-meta">
                      <span>{authorization.clientName || tx('settings.codex.unknownDevice')}</span>
                      {authorization.deviceName ? <span>{authorization.deviceName}</span> : null}
                    </div>
                  </div>
                  <div className="codex-device-last-used">
                    <span>{tx('settings.codex.columnLastUsed')}</span>
                    <time dateTime={authorization.lastUsedAt || undefined}>
                      {formatTimestamp(authorization.lastUsedAt, lang, tx('settings.codex.neverUsed'))}
                    </time>
                  </div>
                  <div className="codex-authorization-actions" role="group" aria-label={tx('settings.codex.manageActions')}>
                    {manageable ? (
                      <button
                        type="button"
                        className="codex-icon-button"
                        disabled={pauseBusy}
                        onClick={() => void togglePaused(authorization, !paused)}
                        aria-label={tx(pauseBusy
                          ? (paused ? 'settings.codex.resuming' : 'settings.codex.pausing')
                          : (paused ? 'settings.codex.resume' : 'settings.codex.pause'))}
                        title={tx(paused ? 'settings.codex.resume' : 'settings.codex.pause')}
                      >
                        {pauseBusy
                          ? <LoaderCircle className="spin-icon" size={14} aria-hidden="true" />
                          : paused
                            ? <PlayCircle size={14} aria-hidden="true" />
                            : <PauseCircle size={14} aria-hidden="true" />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="codex-icon-button is-danger"
                      onClick={() => {
                        setOperationError(null)
                        setDeleteTarget(authorization)
                      }}
                      aria-label={tx('settings.codex.deleteAuthorization')}
                      title={tx('settings.codex.deleteAuthorization')}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={tx('settings.codex.deleteAuthorization')}
        message={deleteTarget ? format(tx('settings.codex.deleteConfirm'), { name: deleteTarget.name }) : ''}
        confirmLabel={tx('settings.codex.deleteAuthorization')}
        cancelLabel={tx('cancel')}
        variant="danger"
        confirmDisabled={deleteBusy}
        onConfirm={deleteAuthorization}
        onCancel={() => {
          if (!deleteBusy) setDeleteTarget(null)
        }}
      />

      {visibleDeviceRequest ? (
        <DeviceAuthorizationDialog
          request={visibleDeviceRequest}
          onClose={closeDeviceRequest}
          onRetry={() => {
            const normalized = normalizeDeviceCode(visibleDeviceRequest.userCode)
            if (normalized) void loadDevicePreview(normalized)
          }}
          onDecision={(decision) => void decideDeviceRequest(decision)}
        />
      ) : null}
    </div>
  )
}
