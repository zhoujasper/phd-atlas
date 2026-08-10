import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  KeyRound,
  Languages,
  Lock,
  Mail,
  Moon,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react'
import { ApiError, phdApi, type BootstrapSecrets, type DatabaseEngine, type InitialAdminSetupInput } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { registerSafeReloadGuard } from '../../safeReload'
import { useI18n } from '../hooks/useI18n'
import { type ThemeContextValue } from '../hooks/useTheme'
import { languageOptions, type Language } from '../../i18n'
import { Select } from '../shared/Select'
import { SwitchControl } from '../shared/SwitchControl'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { PendingLabel } from '../shared/PendingLabel'

type SetupStep = 'account' | 'security' | 'storage' | 'mail' | 'review'
type SmtpVerificationState = 'idle' | 'sending' | 'sent' | 'checking' | 'verified'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BOOTSTRAP_CLAIM_ERROR_CODES = new Set(['BOOTSTRAP_CLAIM_INVALID', 'BOOTSTRAP_CLAIM_REQUIRED'])

function bootstrapClaimWasRejected(reason: unknown) {
  return reason instanceof ApiError && BOOTSTRAP_CLAIM_ERROR_CODES.has(reason.code)
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

export function AdminSetupScreen({
  busy,
  error,
  language,
  themeProvider,
  changeLanguage,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  language: string
  themeProvider: ThemeContextValue
  changeLanguage: (lang: Language) => void
  onSubmit: (input: InitialAdminSetupInput, bootstrapClaimToken: string) => Promise<void>
}) {
  const { tx } = useI18n()
  const languages = languageOptions()
  const [step, setStep] = useState<SetupStep>('account')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [adminEntryHidden, setAdminEntryHidden] = useState(false)
  const [adminEntryCode, setAdminEntryCode] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpTls, setSmtpTls] = useState(true)
  const [notificationMailbox, setNotificationMailbox] = useState('')
  const [databaseType, setDatabaseType] = useState<DatabaseEngine>('sqlite')
  const [sqlitePath, setSqlitePath] = useState('')
  const [databaseHost, setDatabaseHost] = useState('')
  const [databasePort, setDatabasePort] = useState('')
  const [databaseName, setDatabaseName] = useState('')
  const [databaseUser, setDatabaseUser] = useState('')
  const [databasePassword, setDatabasePassword] = useState('')
  const [databaseSsl, setDatabaseSsl] = useState(false)
  const [mysql57Compatibility, setMysql57Compatibility] = useState(false)
  const [databaseSchema, setDatabaseSchema] = useState('')
  const [bootstrapOperatorToken, setBootstrapOperatorToken] = useState('')
  const [bootstrapClaimToken, setBootstrapClaimToken] = useState('')
  const [bootstrapClaimExpiresAt, setBootstrapClaimExpiresAt] = useState(0)
  const [bootstrapClaiming, setBootstrapClaiming] = useState(false)
  const [bootstrapClaimError, setBootstrapClaimError] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<BootstrapSecrets | null>(null)
  const [secretsLoading, setSecretsLoading] = useState(false)
  const [smtpVerificationToken, setSmtpVerificationToken] = useState('')
  const [smtpVerificationCode, setSmtpVerificationCode] = useState('')
  const [smtpVerificationState, setSmtpVerificationState] = useState<SmtpVerificationState>('idle')
  const [smtpVerificationError, setSmtpVerificationError] = useState<string | null>(null)
  const setupReloadGuardId = useId()
  const setupDirtyForReloadRef = useRef(false)
  setupDirtyForReloadRef.current = Boolean(
    busy
    || step !== 'account'
    || name
    || email
    || password
    || confirmPassword
    || adminEntryHidden
    || adminEntryCode
    || smtpHost
    || smtpPort !== '587'
    || smtpUser
    || smtpPass
    || !smtpTls
    || notificationMailbox
    || databaseType !== 'sqlite'
    || sqlitePath
    || databaseHost
    || databasePort
    || databaseName
    || databaseUser
    || databasePassword
    || databaseSsl
    || mysql57Compatibility
    || databaseSchema
    || bootstrapOperatorToken
    || bootstrapClaimToken
    || bootstrapClaimExpiresAt
    || bootstrapClaiming
    || secrets
    || secretsLoading
    || smtpVerificationToken
    || smtpVerificationCode
    || smtpVerificationState !== 'idle'
  )

  useEffect(() => registerSafeReloadGuard(`initial-admin-setup:${setupReloadGuardId}`, {
    // No prepare callback by design: this form contains passwords, operator
    // tokens, database credentials, and verification material that must never
    // enter browser storage. Automatic reloads stop while any state is resident.
    hasUnsavedChanges: () => setupDirtyForReloadRef.current,
  }), [setupReloadGuardId])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!setupDirtyForReloadRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const reopenBootstrapClaim = useCallback((message?: string) => {
    setBootstrapClaimToken('')
    setBootstrapClaimExpiresAt(0)
    setBootstrapOperatorToken('')
    setSecrets(null)
    setStep('account')
    setBootstrapClaimError(message ?? tx(
      'admin.setup.bootstrapClaimInvalid',
      'The bootstrap access token is invalid or no longer active.',
    ))
  }, [tx])

  const fetchSecrets = useCallback(async (signal?: AbortSignal) => {
    if (!bootstrapClaimToken) return
    setSecretsLoading(true)
    try {
      const data = await phdApi.initialSetupSecrets(bootstrapClaimToken, { signal })
      if (!signal?.aborted) setSecrets(data)
    } catch (reason) {
      if (!signal?.aborted) {
        const message = normalizeErrorMessage(
          reason,
          language as Parameters<typeof normalizeErrorMessage>[1],
          tx('admin.setup.bootstrapClaimInvalid', 'The bootstrap access token is invalid or no longer active.'),
        )
        if (bootstrapClaimWasRejected(reason)) reopenBootstrapClaim(message)
        else setBootstrapClaimError(message)
      }
    } finally {
      if (!signal?.aborted) setSecretsLoading(false)
    }
  }, [bootstrapClaimToken, language, reopenBootstrapClaim, tx])

  // Fetch secrets when the security step becomes active
  useEffect(() => {
    if (step !== 'security' || secrets || !bootstrapClaimToken) return undefined
    const controller = new AbortController()
    void fetchSecrets(controller.signal)
    return () => controller.abort()
  }, [step, secrets, bootstrapClaimToken, fetchSecrets])

  useEffect(() => {
    if (!bootstrapClaimToken || !bootstrapClaimExpiresAt) return undefined
    const remaining = bootstrapClaimExpiresAt - Date.now()
    if (remaining <= 0) {
      reopenBootstrapClaim()
      return undefined
    }
    const timer = window.setTimeout(() => reopenBootstrapClaim(), remaining)
    return () => window.clearTimeout(timer)
  }, [bootstrapClaimExpiresAt, bootstrapClaimToken, reopenBootstrapClaim])

  const adminEntryValid = !adminEntryHidden || /^[A-Za-z0-9_-]{3,64}$/.test(adminEntryCode)
  const accountValid = name.trim().length >= 2
    && EMAIL_PATTERN.test(email.trim())
    && password.length >= 15
    && password === confirmPassword
    && adminEntryValid
    && (Boolean(bootstrapClaimToken) || (() => {
      const bytes = utf8ByteLength(bootstrapOperatorToken.trim())
      return bytes >= 32 && bytes <= 512
    })())
  const smtpPortNumber = Number(smtpPort)
  const mailValid = smtpHost.trim().length > 0
    && Number.isInteger(smtpPortNumber)
    && smtpPortNumber >= 1
    && smtpPortNumber <= 65535
    && EMAIL_PATTERN.test(smtpUser.trim())
    && smtpPass.length > 0
    && EMAIL_PATTERN.test(notificationMailbox.trim())
  const smtpVerificationInput = useMemo(() => ({
    notificationMailbox: notificationMailbox.trim().toLowerCase(),
    smtpHost: smtpHost.trim(),
    smtpPort: smtpPortNumber,
    smtpUser: smtpUser.trim().toLowerCase(),
    smtpPass,
    smtpTls,
    language,
  }), [language, notificationMailbox, smtpHost, smtpPass, smtpPortNumber, smtpTls, smtpUser])

  const invalidateSmtpVerification = useCallback(() => {
    setSmtpVerificationToken('')
    setSmtpVerificationCode('')
    setSmtpVerificationError(null)
    setSmtpVerificationState('idle')
  }, [])

  const sendSmtpVerificationCode = useCallback(async () => {
    if (!mailValid || smtpVerificationState === 'sending') return
    setSmtpVerificationState('sending')
    setSmtpVerificationError(null)
    try {
      const result = await phdApi.sendInitialSetupSmtpVerification(
        smtpVerificationInput,
        bootstrapClaimToken,
      )
      setSmtpVerificationToken(result.token)
      setSmtpVerificationCode('')
      setSmtpVerificationState('sent')
    } catch (reason) {
      setSmtpVerificationToken('')
      setSmtpVerificationState('idle')
      setSmtpVerificationError(normalizeErrorMessage(reason, language as Parameters<typeof normalizeErrorMessage>[1], tx('emailCodeSendFailed')))
      if (bootstrapClaimWasRejected(reason)) reopenBootstrapClaim()
    }
  }, [bootstrapClaimToken, language, mailValid, reopenBootstrapClaim, smtpVerificationInput, smtpVerificationState, tx])

  const verifySmtpVerificationCode = useCallback(async () => {
    if (!smtpVerificationToken || !/^\d{6}$/.test(smtpVerificationCode.trim())) {
      setSmtpVerificationError(tx('emailCodeRequired'))
      return false
    }
    setSmtpVerificationState('checking')
    setSmtpVerificationError(null)
    try {
      const verified = await phdApi.verifyInitialSetupSmtpVerification({
        ...smtpVerificationInput,
        token: smtpVerificationToken,
        code: smtpVerificationCode.trim(),
      }, bootstrapClaimToken)
      setSmtpVerificationToken(verified.token)
      setSmtpVerificationState('verified')
      return true
    } catch (reason) {
      setSmtpVerificationState('sent')
      setSmtpVerificationError(normalizeErrorMessage(reason, language as Parameters<typeof normalizeErrorMessage>[1], tx('emailCodeRequired')))
      if (bootstrapClaimWasRejected(reason)) reopenBootstrapClaim()
      return false
    }
  }, [bootstrapClaimToken, language, reopenBootstrapClaim, smtpVerificationCode, smtpVerificationInput, smtpVerificationToken, tx])
  const databasePortNumber = Number(databasePort)
  const externalDatabase = databaseType !== 'sqlite'
  const databaseValid = !externalDatabase || (
    databaseHost.trim().length > 0
    && Number.isInteger(databasePortNumber)
    && databasePortNumber >= 1
    && databasePortNumber <= 65535
    && databaseName.trim().length > 0
    && databaseUser.trim().length > 0
    && databasePassword.length > 0
  )
  const stepIndex = step === 'account' ? 0 : step === 'security' ? 1 : step === 'storage' ? 2 : step === 'mail' ? 3 : 4
  const steps = useMemo(() => [
    { id: 'account' as const, label: tx('admin.setup.accountStep'), icon: UserRound },
    { id: 'security' as const, label: tx('admin.setup.securityStep'), icon: Lock },
    { id: 'storage' as const, label: tx('admin.setup.storageStep'), icon: Database },
    { id: 'mail' as const, label: tx('admin.setup.mailStep'), icon: Mail },
    { id: 'review' as const, label: tx('admin.setup.reviewStep'), icon: Check },
  ], [tx])

  const claimBootstrapAccess = useCallback(async () => {
    if (bootstrapClaimToken) return bootstrapClaimToken
    const operatorToken = bootstrapOperatorToken.trim()
    const tokenBytes = utf8ByteLength(operatorToken)
    if (tokenBytes < 32 || tokenBytes > 512 || bootstrapClaiming) return ''
    setBootstrapClaiming(true)
    setBootstrapClaimError(null)
    try {
      const claim = await phdApi.claimInitialSetup(operatorToken)
      setBootstrapClaimToken(claim.token)
      setBootstrapClaimExpiresAt(new Date(claim.expiresAt).getTime())
      setBootstrapOperatorToken('')
      return claim.token
    } catch (reason) {
      setBootstrapClaimError(normalizeErrorMessage(
        reason,
        language as Parameters<typeof normalizeErrorMessage>[1],
        tx('admin.setup.bootstrapClaimInvalid', 'The bootstrap access token is invalid or no longer active.'),
      ))
      return ''
    } finally {
      setBootstrapClaiming(false)
    }
  }, [bootstrapClaimToken, bootstrapClaiming, bootstrapOperatorToken, language, tx])

  const goForward = async () => {
    if (step === 'account' && accountValid) {
      if (await claimBootstrapAccess()) setStep('security')
    }
    else if (step === 'security') setStep('storage')
    else if (step === 'storage' && databaseValid) setStep('mail')
    else if (step === 'mail' && mailValid && await verifySmtpVerificationCode()) setStep('review')
  }
  const goBack = () => {
    if (step === 'review') setStep('mail')
    else if (step === 'mail') setStep('storage')
    else if (step === 'storage') setStep('security')
    else if (step === 'security') setStep('account')
  }

  const submit = async () => {
    if (!accountValid || !databaseValid || !mailValid || smtpVerificationState !== 'verified' || busy) return
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        adminEntryHidden,
        ...(adminEntryHidden ? { adminEntryCode } : {}),
        notificationMailbox: notificationMailbox.trim().toLowerCase(),
        smtpHost: smtpHost.trim(),
        smtpPort: smtpPortNumber,
        smtpUser: smtpUser.trim().toLowerCase(),
        smtpPass,
        smtpTls,
        smtpVerificationToken,
        language,
        database: databaseType === 'sqlite'
          ? { type: 'sqlite', sqlitePath: sqlitePath.trim() || undefined }
          : {
              type: databaseType,
              host: databaseHost.trim(),
              port: databasePortNumber,
              database: databaseName.trim(),
              username: databaseUser.trim(),
              password: databasePassword,
              ssl: databaseSsl,
              mysql57Compatibility: databaseType === 'mysql' && mysql57Compatibility,
              schema: databaseSchema.trim() || undefined,
            },
      }, bootstrapClaimToken)
    } catch (reason) {
      if (bootstrapClaimWasRejected(reason)) reopenBootstrapClaim()
    }
  }

  return (
    <main className="admin-setup-canvas route-content-reveal">
      <div className="auth-preferences" aria-label={tx('preferences')}>
        <div className="auth-language-control" title={tx('settings.language')}>
          <Languages size={14} aria-hidden="true" />
          <Select
            value={language}
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
      <section className="admin-setup-shell" aria-labelledby="admin-setup-title">
        <header className="admin-setup-hero">
          <span className="admin-setup-mark" aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <div>
            <span className="eyebrow">{tx('admin.setup.eyebrow')}</span>
            <h1 id="admin-setup-title">{tx('admin.setup.title')}</h1>
            <p>{tx('admin.setup.subtitle')}</p>
          </div>
        </header>

        <ol className="admin-setup-progress" aria-label={tx('admin.setup.progressLabel')}>
          {steps.map(({ id, label, icon: Icon }, index) => (
            <li
              key={id}
              className={index < stepIndex ? 'complete' : index === stepIndex ? 'active' : ''}
              aria-current={index === stepIndex ? 'step' : undefined}
            >
              <span>{index < stepIndex ? <Check size={13} /> : <Icon size={13} />}</span>
              <em>{label}</em>
            </li>
          ))}
        </ol>

        <div className="admin-setup-stage" key={step}>
          {step === 'account' ? (
            <>
              <div className="admin-setup-section-head">
                <span><UserRound size={17} aria-hidden="true" /></span>
                <div>
                  <h2>{tx('admin.setup.accountTitle')}</h2>
                  <p>{tx('admin.setup.accountDesc')}</p>
                </div>
              </div>
              <div className="admin-setup-fields">
                <label>
                  <span>{tx('admin.setup.adminName')}</span>
                  <input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" autoFocus />
                </label>
                <label>
                  <span>{tx('admin.setup.loginEmail')}</span>
                  <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="admin@example.com" />
                </label>
                <label>
                  <span>{tx('admin.setup.password')}</span>
                  <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
                  <small>{tx('admin.setup.passwordHint')}</small>
                </label>
                <label>
                  <span>{tx('admin.setup.confirmPassword')}</span>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
                  />
                </label>
                <label className="admin-setup-field-wide">
                  <span>{tx('admin.setup.bootstrapClaimLabel', 'Bootstrap access token')}</span>
                  <input
                    name="bootstrapOperatorToken"
                    required={!bootstrapClaimToken}
                    type="password"
                    value={bootstrapClaimToken ? 'bootstrap-claim-active' : bootstrapOperatorToken}
                    onChange={(event) => {
                      setBootstrapOperatorToken(event.target.value)
                      setBootstrapClaimError(null)
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={Boolean(bootstrapClaimToken)}
                    aria-invalid={Boolean(bootstrapOperatorToken) && (() => {
                      const bytes = utf8ByteLength(bootstrapOperatorToken.trim())
                      return bytes < 32 || bytes > 512
                    })()}
                  />
                  <small>{bootstrapClaimToken
                    ? tx('admin.setup.bootstrapClaimAccepted', 'Bootstrap access confirmed for this browser session.')
                    : tx('admin.setup.bootstrapClaimHint', 'Enter the operator-provided PHD_ATLAS_BOOTSTRAP_TOKEN (at least 32 characters).')}</small>
                </label>
                <div className={`admin-setup-entry-control admin-setup-field-wide ${adminEntryHidden ? 'enabled' : ''}`}>
                  <div className="admin-setup-entry-summary">
                    <span className="admin-setup-entry-icon" aria-hidden="true"><KeyRound size={16} /></span>
                    <div>
                      <strong>{tx('admin.adminEntry.title')}</strong>
                      <small>{tx('admin.adminEntry.description')}</small>
                    </div>
                    <SwitchControl
                      checked={adminEntryHidden}
                      label={tx('admin.adminEntry.hideToggle')}
                      onChange={(checked) => {
                        setAdminEntryHidden(checked)
                        if (!checked) setAdminEntryCode('')
                      }}
                    />
                  </div>
                  <CollapsiblePanel
                    open={adminEntryHidden}
                    keepMounted
                    collapseMs={280}
                    className="admin-setup-entry-collapse"
                    innerClassName="admin-setup-entry-collapse-inner"
                  >
                    <div className="admin-setup-entry-details">
                      <label>
                        <span>{tx('admin.adminEntry.codeLabel')}</span>
                        <input
                          required={adminEntryHidden}
                          value={adminEntryCode}
                          onChange={(event) => setAdminEntryCode(event.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64))}
                          placeholder={tx('admin.adminEntry.codePlaceholder')}
                          autoComplete="off"
                          spellCheck={false}
                          aria-invalid={adminEntryCode.length > 0 && !adminEntryValid}
                        />
                      </label>
                      <div className="admin-setup-entry-path" aria-live="polite">
                        <span>{tx('admin.adminEntry.activationUrl')}</span>
                        <code>{`/admin/${adminEntryCode || 'aaa'}`}</code>
                      </div>
                      <p><ShieldCheck size={13} aria-hidden="true" /> {tx('admin.adminEntry.rememberBody')}</p>
                    </div>
                  </CollapsiblePanel>
                </div>
              </div>
            </>
          ) : null}

          {step === 'security' ? (
            <>
              <div className="admin-setup-section-head">
                <span><Lock size={17} aria-hidden="true" /></span>
                <div>
                  <h2>{tx('admin.setup.securityTitle')}</h2>
                  <p>{tx('admin.setup.securityDesc')}</p>
                </div>
              </div>
              <div className="admin-setup-fields">
                {secretsLoading ? (
                  <div className="admin-setup-secrets-loading">
                    <PendingLabel label={tx('admin.setup.verifying')} />
                  </div>
                ) : secrets ? (
                  <>
                    <div className="admin-setup-secrets-grid">
                      <div className="admin-secret-card">
                        <div className="admin-secret-card-header">
                          <span className="admin-secret-card-icon"><KeyRound size={18} /></span>
                          <div>
                            <strong>{tx('admin.setup.securityJwtLabel')}</strong>
                            {secrets.autoGenerated ? (
                              <em className="admin-secret-badge">{tx('admin.setup.securityAutoGenerated')}</em>
                            ) : null}
                          </div>
                        </div>
                        <div className="admin-secret-card-value">
                          <code>{secrets.jwtSecretPreview}</code>
                        </div>
                      </div>
                      <div className="admin-secret-card">
                        <div className="admin-secret-card-header">
                          <span className="admin-secret-card-icon"><ShieldCheck size={18} /></span>
                          <div>
                            <strong>{tx('admin.setup.securityEncKeyLabel')}</strong>
                            {secrets.autoGenerated ? (
                              <em className="admin-secret-badge">{tx('admin.setup.securityAutoGenerated')}</em>
                            ) : null}
                          </div>
                        </div>
                        <div className="admin-secret-card-value">
                          <code>{secrets.encryptionKeyPreview}</code>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null}

          {step === 'mail' ? (
            <>
              <div className="admin-setup-section-head">
                <span><Mail size={17} aria-hidden="true" /></span>
                <div>
                  <h2>{tx('admin.setup.mailTitle')}</h2>
                  <p>{tx('admin.setup.mailDesc')}</p>
                </div>
              </div>
              <div className="admin-setup-fields admin-setup-mail-grid">
                <label className="admin-setup-field-wide">
                  <span>{tx('settings.smtpHost')}</span>
                  <input required value={smtpHost} onChange={(event) => { invalidateSmtpVerification(); setSmtpHost(event.target.value) }} placeholder="smtp.example.com" autoFocus />
                </label>
                <label>
                  <span>{tx('settings.smtpPort')}</span>
                  <input required type="number" min="1" max="65535" value={smtpPort} onChange={(event) => { invalidateSmtpVerification(); setSmtpPort(event.target.value) }} inputMode="numeric" />
                </label>
                <label>
                  <span>{tx('settings.smtpUser')}</span>
                  <input required type="email" value={smtpUser} onChange={(event) => { invalidateSmtpVerification(); setSmtpUser(event.target.value) }} placeholder="notifications@example.com" autoComplete="username" />
                </label>
                <label>
                  <span>{tx('settings.smtpPass')}</span>
                  <input required type="password" value={smtpPass} onChange={(event) => { invalidateSmtpVerification(); setSmtpPass(event.target.value) }} autoComplete="new-password" />
                </label>
                <label className="admin-setup-field-wide">
                  <span>{tx('admin.setup.notificationMailbox')}</span>
                  <input required type="email" value={notificationMailbox} onChange={(event) => { invalidateSmtpVerification(); setNotificationMailbox(event.target.value) }} placeholder="admin@example.com" />
                  <small>{tx('admin.setup.notificationMailboxHint')}</small>
                </label>
                <div className="admin-setup-switch-row admin-setup-field-wide">
                  <div>
                    <strong>{tx('settings.smtpTls')}</strong>
                    <small>{tx('admin.setup.tlsHint')}</small>
                  </div>
                  <SwitchControl checked={smtpTls} label={tx('settings.smtpTls')} onChange={(checked) => { invalidateSmtpVerification(); setSmtpTls(checked) }} />
                </div>
                <div className={`admin-setup-smtp-verification admin-setup-field-wide is-${smtpVerificationState}`}>
                  <div className="admin-setup-smtp-verification-copy">
                    <strong>{tx('emailCode')} <span className="field-required-mark">*</span></strong>
                    <small>{notificationMailbox || tx('admin.setup.notificationMailboxHint')}</small>
                  </div>
                  <div className="admin-setup-smtp-verification-actions">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={smtpVerificationCode}
                      aria-required="true"
                      onChange={(event) => {
                        setSmtpVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                        setSmtpVerificationError(null)
                        if (smtpVerificationState === 'verified') setSmtpVerificationState('sent')
                      }}
                      placeholder={tx('emailCodePlaceholder')}
                      aria-label={tx('emailCode')}
                      disabled={!smtpVerificationToken || smtpVerificationState === 'sending' || smtpVerificationState === 'checking'}
                    />
                    <button
                      type="button"
                      className="quiet-action compact-action"
                      onClick={() => void sendSmtpVerificationCode()}
                      disabled={!mailValid || smtpVerificationState === 'sending' || smtpVerificationState === 'checking'}
                    >
                      {smtpVerificationState === 'sending' ? <span className="admin-setup-spinner" aria-hidden="true" /> : <Mail size={13} aria-hidden="true" />}
                      {smtpVerificationToken ? tx('resendCode') : tx('sendCode')}
                    </button>
                  </div>
                  {smtpVerificationState === 'sent' || smtpVerificationState === 'verified' ? (
                    <p className="admin-setup-smtp-verification-status"><Check size={13} aria-hidden="true" /> {tx('emailCodeSent')}</p>
                  ) : null}
                  {smtpVerificationError ? <p className="admin-setup-smtp-verification-error" role="alert">{smtpVerificationError}</p> : null}
                </div>
              </div>
            </>
          ) : null}

          {step === 'storage' ? (
            <>
              <div className="admin-setup-section-head">
                <span><Database size={17} aria-hidden="true" /></span>
                <div>
                  <h2>{tx('admin.setup.storageTitle')}</h2>
                  <p>{tx('admin.setup.storageDesc')}</p>
                </div>
              </div>
              <div className="admin-setup-fields admin-setup-mail-grid">
                <label className="admin-setup-field-wide">
                  <span>{tx('admin.database.engine')}</span>
                  <Select
                    value={databaseType}
                    ariaLabel={tx('admin.database.engine')}
                    options={[
                      { value: 'sqlite', label: tx('admin.database.sqlite') },
                      { value: 'mysql', label: tx('admin.database.mysql') },
                      { value: 'postgresql', label: tx('admin.database.postgresql') },
                      { value: 'mssql', label: tx('admin.database.mssql') },
                    ]}
                    onChange={(value) => {
                      const next = value as DatabaseEngine
                      setDatabaseType(next)
                      if (next === 'mysql') setDatabasePort('3306')
                      if (next === 'postgresql') setDatabasePort('5432')
                      if (next === 'mssql') setDatabasePort('1433')
                    }}
                  />
                  <small>{tx('admin.setup.storageHint')}</small>
                </label>
                {databaseType === 'sqlite' ? (
                  <label className="admin-setup-field-wide">
                    <span>{tx('admin.database.sqlitePath')}</span>
                    <input value={sqlitePath} onChange={(event) => setSqlitePath(event.target.value)} placeholder={tx('admin.database.sqlitePathPlaceholder')} />
                    <small>{tx('admin.database.sqlitePathHint')}</small>
                  </label>
                ) : (
                  <>
                    <label className="admin-setup-field-wide">
                      <span>{tx('admin.database.host')}</span>
                      <input required value={databaseHost} onChange={(event) => setDatabaseHost(event.target.value)} placeholder="db.example.com" autoFocus />
                    </label>
                    <label>
                      <span>{tx('admin.database.port')}</span>
                      <input required type="number" min="1" max="65535" value={databasePort} onChange={(event) => setDatabasePort(event.target.value)} inputMode="numeric" />
                    </label>
                    <label>
                      <span>{tx('admin.database.name')}</span>
                      <input required value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
                    </label>
                    <label>
                      <span>{tx('admin.database.username')}</span>
                      <input required value={databaseUser} onChange={(event) => setDatabaseUser(event.target.value)} autoComplete="username" />
                    </label>
                    <label>
                      <span>{tx('admin.database.password')}</span>
                      <input required type="password" value={databasePassword} onChange={(event) => setDatabasePassword(event.target.value)} autoComplete="new-password" />
                    </label>
                    <label className="admin-setup-field-wide">
                      <span>{tx('admin.database.schema')}</span>
                      <input value={databaseSchema} onChange={(event) => setDatabaseSchema(event.target.value)} placeholder={databaseType === 'postgresql' ? 'public' : 'dbo'} />
                    </label>
                    {databaseType === 'mysql' ? (
                      <div className="admin-setup-switch-row admin-setup-field-wide">
                        <div>
                          <strong>{tx('admin.database.mysql57Compatibility')}</strong>
                          <small>{tx('admin.database.mysql57CompatibilityHint')}</small>
                        </div>
                        <SwitchControl checked={mysql57Compatibility} label={tx('admin.database.mysql57Compatibility')} onChange={setMysql57Compatibility} />
                      </div>
                    ) : null}
                    <div className="admin-setup-switch-row admin-setup-field-wide">
                      <div>
                        <strong>{tx('admin.database.ssl')}</strong>
                        <small>{tx('admin.database.sslHint')}</small>
                      </div>
                      <SwitchControl checked={databaseSsl} label={tx('admin.database.ssl')} onChange={setDatabaseSsl} />
                    </div>
                  </>
                )}
              </div>
            </>
          ) : null}

          {step === 'review' ? (
            <>
              <div className="admin-setup-section-head">
                <span><Sparkles size={17} aria-hidden="true" /></span>
                <div>
                  <h2>{tx('admin.setup.reviewTitle')}</h2>
                  <p>{tx('admin.setup.reviewDesc')}</p>
                </div>
              </div>
              <div className="admin-setup-review">
                <div>
                  <span><UserRound size={15} /></span>
                  <p><small>{tx('admin.setup.administrator')}</small><strong>{name}</strong><em>{email}</em></p>
                  <Check size={15} className="admin-setup-check" />
                </div>
                <div>
                  <span><Database size={15} /></span>
                  <p><small>{tx('admin.database.engine')}</small><strong>{tx(`admin.database.${databaseType}`)}</strong><em>{databaseType === 'sqlite' ? (sqlitePath || tx('admin.database.sqliteDefaultPath')) : `${databaseHost}:${databasePort} / ${databaseName}`}{databaseType === 'mysql' && mysql57Compatibility ? ` · ${tx('admin.database.mysql57Compatibility')}` : ''}</em></p>
                  <Check size={15} className="admin-setup-check" />
                </div>
                <div>
                  <span><Server size={15} /></span>
                  <p><small>{tx('admin.setup.outgoingServer')}</small><strong>{smtpHost}:{smtpPort}</strong><em>{smtpUser}</em></p>
                  <Check size={15} className="admin-setup-check" />
                </div>
                <div>
                  <span><KeyRound size={15} /></span>
                  <p><small>{tx('admin.setup.security')}</small><strong>{tx('admin.setup.securityValue')}</strong><em>{tx('admin.setup.oneTimeNote')}</em></p>
                  <Check size={15} className="admin-setup-check" />
                </div>
                <div>
                  <span><ShieldCheck size={15} /></span>
                  <p>
                    <small>{tx('admin.adminEntry.title')}</small>
                    <strong>{adminEntryHidden ? tx('admin.adminEntry.hidden') : tx('admin.adminEntry.visible')}</strong>
                    <em>{adminEntryHidden ? `/admin/${adminEntryCode}` : '/admin'}</em>
                  </p>
                  <Check size={15} className="admin-setup-check" />
                </div>
              </div>
              <div className="admin-setup-verification-note">
                <Mail size={15} aria-hidden="true" />
                <span>{tx('admin.setup.smtpVerificationNote')}</span>
              </div>
            </>
          ) : null}

          {bootstrapClaimError || error ? (
            <div className="admin-error admin-setup-error" role="alert">
              {bootstrapClaimError || error}
            </div>
          ) : null}

          <footer className="admin-setup-actions">
            {step !== 'account' ? (
              <button type="button" className="quiet-action" onClick={goBack} disabled={busy || bootstrapClaiming}>
                <ArrowLeft size={14} aria-hidden="true" /> {tx('admin.setup.back')}
              </button>
            ) : <span />}
            {step !== 'review' ? (
              <button
                type="button"
                className="primary-action"
                onClick={() => void goForward()}
                disabled={bootstrapClaiming || (step === 'account'
                  ? !accountValid
                  : step === 'security'
                    ? false
                    : step === 'storage'
                      ? !databaseValid
                      : !mailValid || !smtpVerificationToken || !/^\d{6}$/.test(smtpVerificationCode) || smtpVerificationState === 'sending' || smtpVerificationState === 'checking')}
              >
                {bootstrapClaiming ? (
                  <PendingLabel label={tx('admin.setup.verifying')} />
                ) : (
                  <>{tx('admin.setup.continue')} <ArrowRight size={14} aria-hidden="true" /></>
                )}
              </button>
            ) : (
              <button type="button" className="primary-action" onClick={() => void submit()} disabled={busy} aria-busy={busy || undefined}>
                {busy ? (
                  <PendingLabel label={tx('admin.setup.verifying')} />
                ) : (
                  <>{tx('admin.setup.finish')}<Check size={14} aria-hidden="true" /></>
                )}
              </button>
            )}
          </footer>
        </div>
      </section>
    </main>
  )
}
