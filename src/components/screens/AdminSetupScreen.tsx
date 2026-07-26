import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Database,
  KeyRound,
  Languages,
  Lock,
  Mail,
  Moon,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react'
import { phdApi, type BootstrapSecrets, type DatabaseEngine, type InitialAdminSetupInput } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'
import { type ThemeContextValue } from '../hooks/useTheme'
import { languageOptions, type Language } from '../../i18n'
import { Select } from '../shared/Select'
import { SwitchControl } from '../shared/SwitchControl'

type SetupStep = 'account' | 'security' | 'storage' | 'mail' | 'review'
type SmtpVerificationState = 'idle' | 'sending' | 'sent' | 'checking' | 'verified'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  onSubmit: (input: InitialAdminSetupInput) => Promise<void>
}) {
  const { tx } = useI18n()
  const languages = languageOptions()
  const [step, setStep] = useState<SetupStep>('account')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
  const [secrets, setSecrets] = useState<BootstrapSecrets | null>(null)
  const [secretsLoading, setSecretsLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [showRegenConfirm, setShowRegenConfirm] = useState(false)
  const [smtpVerificationToken, setSmtpVerificationToken] = useState('')
  const [smtpVerificationCode, setSmtpVerificationCode] = useState('')
  const [smtpVerificationState, setSmtpVerificationState] = useState<SmtpVerificationState>('idle')
  const [smtpVerificationError, setSmtpVerificationError] = useState<string | null>(null)

  const fetchSecrets = useCallback(async () => {
    setSecretsLoading(true)
    try {
      const response = await fetch('/api/setup/secrets')
      if (!response.ok) return
      const data = await response.json()
      if (data.ok && data.data) setSecrets(data.data)
    } catch {
      // Non-critical
    } finally {
      setSecretsLoading(false)
    }
  }, [])

  const regenerateKeys = useCallback(async () => {
    setRegenerating(true)
    setShowRegenConfirm(false)
    try {
      const response = await fetch('/api/setup/secrets/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'REGENERATE' }),
      })
      if (!response.ok) return
      const data = await response.json()
      if (data.ok && data.data) setSecrets(data.data)
    } catch {
      // Non-critical
    } finally {
      setRegenerating(false)
    }
  }, [])

  // Fetch secrets when the security step becomes active
  useEffect(() => {
    if (step === 'security' && !secrets) fetchSecrets()
  }, [step, secrets, fetchSecrets])

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    let copied = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        copied = true
      }
    } catch {
      // 某些受限浏览器不提供异步剪贴板权限，继续使用兼容方案。
    }
    if (!copied) {
      const field = document.createElement('textarea')
      field.value = text
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.append(field)
      field.select()
      copied = document.execCommand('copy')
      field.remove()
    }
    if (copied) {
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey(null), 2000)
    }
  }, [])

  const accountValid = name.trim().length >= 2
    && EMAIL_PATTERN.test(email.trim())
    && password.length >= 12
    && password === confirmPassword
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
      const result = await phdApi.sendInitialSetupSmtpVerification(smtpVerificationInput)
      setSmtpVerificationToken(result.token)
      setSmtpVerificationCode('')
      setSmtpVerificationState('sent')
    } catch (reason) {
      setSmtpVerificationToken('')
      setSmtpVerificationState('idle')
      setSmtpVerificationError(normalizeErrorMessage(reason, language as Parameters<typeof normalizeErrorMessage>[1], tx('emailCodeSendFailed')))
    }
  }, [language, mailValid, smtpVerificationInput, smtpVerificationState, tx])

  const verifySmtpVerificationCode = useCallback(async () => {
    if (!smtpVerificationToken || !/^\d{6}$/.test(smtpVerificationCode.trim())) {
      setSmtpVerificationError(tx('emailCodeRequired'))
      return false
    }
    setSmtpVerificationState('checking')
    setSmtpVerificationError(null)
    try {
      await phdApi.verifyInitialSetupSmtpVerification({
        ...smtpVerificationInput,
        token: smtpVerificationToken,
        code: smtpVerificationCode.trim(),
      })
      setSmtpVerificationState('verified')
      return true
    } catch (reason) {
      setSmtpVerificationState('sent')
      setSmtpVerificationError(normalizeErrorMessage(reason, language as Parameters<typeof normalizeErrorMessage>[1], tx('emailCodeRequired')))
      return false
    }
  }, [language, smtpVerificationCode, smtpVerificationInput, smtpVerificationToken, tx])
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

  const goForward = async () => {
    if (step === 'account' && accountValid) setStep('security')
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
    await onSubmit({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
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
    })
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
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" autoFocus />
                </label>
                <label>
                  <span>{tx('admin.setup.loginEmail')}</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="admin@example.com" />
                </label>
                <label>
                  <span>{tx('admin.setup.password')}</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
                  <small>{tx('admin.setup.passwordHint')}</small>
                </label>
                <label>
                  <span>{tx('admin.setup.confirmPassword')}</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
                  />
                </label>
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
                    <span className="admin-setup-spinner" aria-hidden="true" />
                    <span>{tx('admin.setup.verifying')}</span>
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
                          <button
                            type="button"
                            className="admin-secret-copy-btn quiet-action"
                            onClick={() => copyToClipboard(secrets.jwtSecret || secrets.jwtSecretPreview, 'jwt')}
                            title={copiedKey === 'jwt' ? tx('admin.setup.securityCopied') : tx('admin.setup.securityCopyKey')}
                            aria-label={copiedKey === 'jwt' ? tx('admin.setup.securityCopied') : tx('admin.setup.securityCopyKey')}
                          >
                            {copiedKey === 'jwt' ? (
                              <Check size={14} aria-hidden="true" />
                            ) : (
                              <Copy size={14} aria-hidden="true" />
                            )}
                          </button>
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
                          <button
                            type="button"
                            className="admin-secret-copy-btn quiet-action"
                            onClick={() => copyToClipboard(secrets.encryptionKey || secrets.encryptionKeyPreview, 'enc')}
                            title={copiedKey === 'enc' ? tx('admin.setup.securityCopied') : tx('admin.setup.securityCopyKey')}
                            aria-label={copiedKey === 'enc' ? tx('admin.setup.securityCopied') : tx('admin.setup.securityCopyKey')}
                          >
                            {copiedKey === 'enc' ? (
                              <Check size={14} aria-hidden="true" />
                            ) : (
                              <Copy size={14} aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="admin-setup-secrets-actions">
                      {showRegenConfirm ? (
                        <div className="admin-secret-regen-confirm">
                          <p className="admin-warning-text">{tx('admin.setup.securityRegenerateWarning')}</p>
                          <div className="admin-secret-regen-buttons">
                            <button
                              type="button"
                              className="primary-action destructive"
                              onClick={regenerateKeys}
                              disabled={regenerating}
                            >
                              {regenerating ? (
                                <><span className="admin-setup-spinner" aria-hidden="true" /></>
                              ) : (
                                <><RefreshCw size={13} /> {tx('admin.setup.securityRegenerateConfirm')}</>
                              )}
                            </button>
                            <button
                              type="button"
                              className="quiet-action"
                              onClick={() => setShowRegenConfirm(false)}
                              disabled={regenerating}
                            >
                              {tx('admin.setup.back')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="quiet-action"
                          onClick={() => setShowRegenConfirm(true)}
                        >
                          <RefreshCw size={13} /> {tx('admin.setup.securityRegenerate')}
                        </button>
                      )}
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
                  <input value={smtpHost} onChange={(event) => { invalidateSmtpVerification(); setSmtpHost(event.target.value) }} placeholder="smtp.example.com" autoFocus />
                </label>
                <label>
                  <span>{tx('settings.smtpPort')}</span>
                  <input type="number" min="1" max="65535" value={smtpPort} onChange={(event) => { invalidateSmtpVerification(); setSmtpPort(event.target.value) }} inputMode="numeric" />
                </label>
                <label>
                  <span>{tx('settings.smtpUser')}</span>
                  <input type="email" value={smtpUser} onChange={(event) => { invalidateSmtpVerification(); setSmtpUser(event.target.value) }} placeholder="notifications@example.com" autoComplete="username" />
                </label>
                <label>
                  <span>{tx('settings.smtpPass')}</span>
                  <input type="password" value={smtpPass} onChange={(event) => { invalidateSmtpVerification(); setSmtpPass(event.target.value) }} autoComplete="new-password" />
                </label>
                <label className="admin-setup-field-wide">
                  <span>{tx('admin.setup.notificationMailbox')}</span>
                  <input type="email" value={notificationMailbox} onChange={(event) => { invalidateSmtpVerification(); setNotificationMailbox(event.target.value) }} placeholder="admin@example.com" />
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
                    <strong>{tx('emailCode')}</strong>
                    <small>{notificationMailbox || tx('admin.setup.notificationMailboxHint')}</small>
                  </div>
                  <div className="admin-setup-smtp-verification-actions">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={smtpVerificationCode}
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
                      <input value={databaseHost} onChange={(event) => setDatabaseHost(event.target.value)} placeholder="db.example.com" autoFocus />
                    </label>
                    <label>
                      <span>{tx('admin.database.port')}</span>
                      <input type="number" min="1" max="65535" value={databasePort} onChange={(event) => setDatabasePort(event.target.value)} inputMode="numeric" />
                    </label>
                    <label>
                      <span>{tx('admin.database.name')}</span>
                      <input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
                    </label>
                    <label>
                      <span>{tx('admin.database.username')}</span>
                      <input value={databaseUser} onChange={(event) => setDatabaseUser(event.target.value)} autoComplete="username" />
                    </label>
                    <label>
                      <span>{tx('admin.database.password')}</span>
                      <input type="password" value={databasePassword} onChange={(event) => setDatabasePassword(event.target.value)} autoComplete="new-password" />
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
              </div>
              <div className="admin-setup-verification-note">
                <Mail size={15} aria-hidden="true" />
                <span>{tx('admin.setup.smtpVerificationNote')}</span>
              </div>
            </>
          ) : null}

          {error ? <div className="admin-error admin-setup-error" role="alert">{error}</div> : null}

          <footer className="admin-setup-actions">
            {step !== 'account' ? (
              <button type="button" className="quiet-action" onClick={goBack} disabled={busy}>
                <ArrowLeft size={14} aria-hidden="true" /> {tx('admin.setup.back')}
              </button>
            ) : <span />}
            {step !== 'review' ? (
              <button
                type="button"
                className="primary-action"
                onClick={() => void goForward()}
                disabled={step === 'account'
                  ? !accountValid
                  : step === 'security'
                    ? false
                    : step === 'storage'
                      ? !databaseValid
                      : !mailValid || !smtpVerificationToken || !/^\d{6}$/.test(smtpVerificationCode) || smtpVerificationState === 'sending' || smtpVerificationState === 'checking'}
              >
                {tx('admin.setup.continue')} <ArrowRight size={14} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" className="primary-action" onClick={() => void submit()} disabled={busy}>
                {busy ? tx('admin.setup.verifying') : tx('admin.setup.finish')}
                {busy ? <span className="admin-setup-spinner" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
              </button>
            )}
          </footer>
        </div>
      </section>
    </main>
  )
}
