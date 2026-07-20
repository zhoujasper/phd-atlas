import { CalendarClock, Check, Copy, Eye, EyeOff, Fingerprint, FolderCheck, GraduationCap, Languages, ListChecks, Mail, Moon, RefreshCw, ShieldCheck, Sun, Users } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { normalizeErrorMessage } from '../../errorMessages'
import { PUBLIC_EDITION } from '../../edition'
import type { Language } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { useTheme } from '../hooks/useTheme'
import { Select } from '../shared/Select'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_CODE_COOLDOWN_SECONDS = 45

type AuthMode = 'login' | 'register' | 'forgot'
type AuthModeDirection = 'forward' | 'back'

/** Navigation depth so login ↔ create account / reset feels directional. */
function authModeRank(mode: AuthMode) {
  if (mode === 'login') return 0
  if (mode === 'forgot') return 1
  return 2
}

export function AuthScreen({
  busy,
  onLogin,
  onPasskeyLogin,
  passkeyAvailable,
  onRegister,
  onForgotPassword,
  onCaptcha,
  onSendEmailCode,
  languages,
  onLanguageChange,
}: {
  busy: boolean
  onLogin: (email: string, password: string) => void
  onPasskeyLogin?: (email: string) => void
  passkeyAvailable?: boolean
  onRegister: (name: string, email: string, password: string, captchaToken: string, captchaAnswer: string, emailCodeToken: string, emailCode: string, language: string) => void
  onForgotPassword?: (email: string) => Promise<string | undefined | null>
  onCaptcha: () => Promise<{ question: string; token: string }>
  onSendEmailCode: (email: string, language: string) => Promise<{ token: string; expiresInSeconds: number }>
  languages: Array<{ value: Language; label: string }>
  onLanguageChange: (language: Language) => void
}) {
  const { tx, format, lang } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const [mode, setMode] = useState<AuthMode>('login')
  const [modeDirection, setModeDirection] = useState<AuthModeDirection>('forward')
  const [modeAnimKey, setModeAnimKey] = useState(0)
  const modeStageRef = useRef<HTMLDivElement | null>(null)
  const modePanelRef = useRef<HTMLDivElement | null>(null)
  const modeHeightRef = useRef<number | null>(null)
  const modeRef = useRef<AuthMode>(mode)
  modeRef.current = mode
  const [name, setName] = useState(PUBLIC_EDITION ? '' : 'Jasper')
  const [email, setEmail] = useState(PUBLIC_EDITION ? '' : 'jasper@example.com')
  const [password, setPassword] = useState(PUBLIC_EDITION ? '' : 'demo123456')
  const [showPassword, setShowPassword] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryLink, setRecoveryLink] = useState('')
  const [captchaQuestion, setCaptchaQuestion] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaError, setCaptchaError] = useState('')
  const [emailCodeToken, setEmailCodeToken] = useState('')
  const [emailCodeValue, setEmailCodeValue] = useState('')
  const [emailCodeSending, setEmailCodeSending] = useState(false)
  const [emailCodeError, setEmailCodeError] = useState('')
  const [emailCodeCooldown, setEmailCodeCooldown] = useState(0)

  const switchMode = useCallback((next: AuthMode) => {
    const current = modeRef.current
    if (current === next) return
    // login → forgot / register: forward slide; return paths: reverse slide.
    setModeDirection(authModeRank(next) >= authModeRank(current) ? 'forward' : 'back')
    setModeAnimKey((key) => key + 1)
    // Drop recovery copy whenever the form surface changes so it never flashes mid-slide.
    setRecoveryMessage('')
    setRecoveryLink('')
    setMode(next)
  }, [])

  const refreshCaptcha = useCallback(async () => {
    setCaptchaError('')
    try {
      const challenge = await onCaptcha()
      setCaptchaQuestion(challenge.question)
      setCaptchaToken(challenge.token)
      setCaptchaAnswer('')
    } catch {
      setCaptchaQuestion('')
      setCaptchaToken('')
      setCaptchaError(tx('captchaLoadFailed'))
    }
  }, [onCaptcha, tx])

  useEffect(() => {
    if (mode !== 'register') return
    void refreshCaptcha()
  }, [mode, refreshCaptcha])

  // Leaving register mode invalidates any in-flight email verification attempt.
  useEffect(() => {
    if (mode === 'register') return
    setEmailCodeToken('')
    setEmailCodeValue('')
    setEmailCodeError('')
    setEmailCodeSending(false)
    setEmailCodeCooldown(0)
  }, [mode])

  useEffect(() => {
    if (emailCodeCooldown <= 0) return
    const timer = setInterval(() => {
      setEmailCodeCooldown((value) => Math.max(0, value - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [emailCodeCooldown])

  // Morph the form column height on every auth mode change (login ↔ register ↔
  // forgot-password) so demo accounts / password / recovery blocks don't hard-cut.
  useLayoutEffect(() => {
    const stage = modeStageRef.current
    const panel = modePanelRef.current
    if (!stage || !panel) return

    const prefersReduced = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nextHeight = panel.getBoundingClientRect().height
    const prevHeight = modeHeightRef.current

    if (prefersReduced || prevHeight == null || Math.abs(prevHeight - nextHeight) < 0.5) {
      stage.style.height = 'auto'
      modeHeightRef.current = nextHeight
      return
    }

    stage.style.height = `${prevHeight}px`
    // Force layout so the browser registers the starting height before the transition.
    void stage.offsetHeight
    stage.style.height = `${nextHeight}px`
    modeHeightRef.current = nextHeight

    const settle = (event?: TransitionEvent) => {
      if (event && event.target !== stage) return
      if (event && event.propertyName && event.propertyName !== 'height') return
      if (modeStageRef.current === stage) stage.style.height = 'auto'
    }
    stage.addEventListener('transitionend', settle as EventListener)
    const fallback = window.setTimeout(() => settle(), 400)
    return () => {
      stage.removeEventListener('transitionend', settle as EventListener)
      window.clearTimeout(fallback)
    }
  }, [mode, modeAnimKey, captchaQuestion, recoveryMessage, recoveryLink, emailCodeToken, emailCodeError, captchaError, passkeyAvailable])

  const sendEmailCode = useCallback(async () => {
    const trimmedEmail = email.trim()
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailCodeError(tx('emailCodeInvalidEmail'))
      return
    }
    if (emailCodeSending || emailCodeCooldown > 0) return
    setEmailCodeError('')
    setEmailCodeSending(true)
    try {
      const result = await onSendEmailCode(trimmedEmail, lang)
      setEmailCodeToken(result.token)
      setEmailCodeValue('')
      setEmailCodeCooldown(EMAIL_CODE_COOLDOWN_SECONDS)
    } catch (error) {
      setEmailCodeToken('')
      setEmailCodeError(normalizeErrorMessage(error, lang, tx('emailCodeSendFailed')))
    } finally {
      setEmailCodeSending(false)
    }
  }, [email, emailCodeSending, emailCodeCooldown, onSendEmailCode, lang, tx])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setRecoveryMessage('')
    setRecoveryLink('')
    if (mode === 'login') {
      onLogin(email, password)
      return
    }
    if (mode === 'register') {
      if (!captchaToken || !captchaAnswer.trim()) {
        setCaptchaError(tx('captchaRequired'))
        return
      }
      if (!emailCodeToken || !emailCodeValue.trim()) {
        setEmailCodeError(tx('emailCodeRequired'))
        return
      }
      onRegister(name, email, password, captchaToken, captchaAnswer, emailCodeToken, emailCodeValue.trim(), lang)
      return
    }

    const resetUrl = await onForgotPassword?.(email)
    if (resetUrl === null) return
    setRecoveryMessage(tx('forgotPasswordSent'))
    if (resetUrl) {
      setRecoveryLink(`${window.location.origin}${resetUrl}`)
    }
  }

  const modeHeading = mode === 'login' ? tx('signIn') : mode === 'register' ? tx('createAccount') : tx('resetPassword.title')
  const demoAccounts = PUBLIC_EDITION
    ? []
    : [
        { key: 'owner', email: 'jasper@example.com', label: tx('demoOwner'), desc: tx('demoOwnerDesc'), Icon: ShieldCheck },
        { key: 'teacher', email: 'teacher@phd-atlas.local', label: tx('demoTeacher'), desc: tx('demoTeacherDesc'), Icon: Users },
        { key: 'student', email: 'student.lina@phd-atlas.local', label: tx('demoStudent'), desc: tx('demoStudentDesc'), Icon: GraduationCap },
      ]

  function pickDemoAccount(account: typeof demoAccounts[number]) {
    switchMode('login')
    setEmail(account.email)
    setPassword('demo123456')
  }

  return (
    <main className="auth-canvas">
      <div className="auth-shell">
        <aside className="auth-hero">
          <div className="auth-hero-content">
            <div className="auth-hero-mark">
              <GraduationCap size={26} aria-hidden="true" />
            </div>
            <h1>{tx('appTitle')}</h1>
            <p>{tx('appDesc')}</p>
            <ul className="auth-hero-points">
              <li>
                <ListChecks size={14} aria-hidden="true" />
                <span>{tx('authHighlightTrack')}</span>
              </li>
              <li>
                <CalendarClock size={14} aria-hidden="true" />
                <span>{tx('authHighlightDeadline')}</span>
              </li>
              <li>
                <FolderCheck size={14} aria-hidden="true" />
                <span>{tx('authHighlightOrganize')}</span>
              </li>
            </ul>
          </div>
        </aside>
        <section className="auth-sheet" aria-label={modeHeading}>
          <div className="auth-preferences" aria-label={tx('preferences')}>
            <div className="auth-language-control" title={tx('settings.language')}>
              <Languages size={14} aria-hidden="true" />
              <Select
                value={lang}
                options={languages}
                onChange={onLanguageChange}
                ariaLabel={tx('settings.language')}
                size="small"
                searchable={languages.length > 6}
              />
            </div>
            <button type="button" className="icon-action" onClick={toggleTheme} title={theme === 'dark' ? tx('settings.light') : tx('settings.dark')} aria-label={theme === 'dark' ? tx('settings.light') : tx('settings.dark')}>
              {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            </button>
          </div>
          <div className="auth-sheet-intro">
            <div className="auth-mark">
              <GraduationCap size={22} aria-hidden="true" />
            </div>
            <h1>{tx('appTitle')}</h1>
            <p>{tx('appDesc')}</p>
          </div>
          <div className="auth-mode-stage" ref={modeStageRef}>
            <div
              className={`auth-mode-panel auth-mode-${modeDirection} auth-mode-is-${mode}`}
              key={`${mode}-${modeAnimKey}`}
              ref={modePanelRef}
              data-auth-mode={mode}
            >
            <h2 className="auth-sheet-heading">{modeHeading}</h2>
            {mode === 'login' && demoAccounts.length > 0 ? (
              <div className="auth-demo-accounts" aria-label={tx('demoAccountsTitle')}>
                <div className="auth-demo-head">
                  <strong>{tx('demoAccountsTitle')}</strong>
                  <span>{tx('demoAccountsDesc')}</span>
                </div>
                <div className="auth-demo-grid">
                  {demoAccounts.map(({ key, email: demoEmail, label, desc, Icon }) => (
                    <button key={key} type="button" onClick={() => pickDemoAccount({ key, email: demoEmail, label, desc, Icon })}>
                      <Icon size={14} aria-hidden="true" />
                      <span>
                        <strong>{label}</strong>
                        <em>{desc}</em>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <form
              onSubmit={handleSubmit}
            >
              {mode === 'register' ? (
                <label>
                  <span>{tx('name')}</span>
                  <input
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={tx('namePlaceholder')}
                    autoFocus
                  />
                </label>
              ) : null}
              {mode === 'forgot' ? (
                <p className="muted forgot-password-hint">
                  {tx('forgotPasswordHint')}
                </p>
              ) : null}
              <label>
                <span>{tx('email')}</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    if (emailCodeToken || emailCodeError) {
                      setEmailCodeToken('')
                      setEmailCodeValue('')
                      setEmailCodeCooldown(0)
                      setEmailCodeError('')
                    }
                  }}
                  placeholder="you@example.com"
                  autoFocus={mode === 'login'}
                />
              </label>
              {mode === 'register' ? (
                <label>
                  <span>{tx('emailCode')}</span>
                  <div className="email-code-row">
                    <input
                      required
                      inputMode="numeric"
                      maxLength={6}
                      value={emailCodeValue}
                      onChange={(event) => {
                        setEmailCodeValue(event.target.value)
                        setEmailCodeError('')
                      }}
                      placeholder={tx('emailCodePlaceholder')}
                    />
                    <button
                      type="button"
                      className="quiet-action email-code-send-btn"
                      onClick={() => void sendEmailCode()}
                      disabled={emailCodeSending || emailCodeCooldown > 0}
                    >
                      {emailCodeSending ? (
                        tx('working')
                      ) : emailCodeCooldown > 0 ? (
                        format(tx('resendCodeIn'), { seconds: emailCodeCooldown })
                      ) : (
                        <>
                          <Mail size={13} aria-hidden="true" />
                          {emailCodeToken ? tx('resendCode') : tx('sendCode')}
                        </>
                      )}
                    </button>
                  </div>
                  {emailCodeError ? (
                    <em className="settings-inline-error">{emailCodeError}</em>
                  ) : emailCodeToken ? (
                    <span className="settings-inline-note">
                      <Check size={12} aria-hidden="true" /> {tx('emailCodeSent')}
                    </span>
                  ) : null}
                </label>
              ) : null}
              {mode === 'register' ? (
                <label>
                  <span>{tx('captcha')}</span>
                  <div className="captcha-row">
                    <strong>{captchaQuestion || tx('working')}</strong>
                    <input
                      required
                      inputMode="numeric"
                      value={captchaAnswer}
                      onChange={(event) => {
                        setCaptchaAnswer(event.target.value)
                        setCaptchaError('')
                      }}
                      placeholder={tx('captchaPlaceholder')}
                    />
                    <button type="button" className="icon-action" onClick={() => void refreshCaptcha()} aria-label={tx('refreshCaptcha')} title={tx('refreshCaptcha')}>
                      <RefreshCw size={14} aria-hidden="true" />
                    </button>
                  </div>
                  {captchaError ? <em className="settings-inline-error">{captchaError}</em> : null}
                </label>
              ) : null}
              {mode !== 'forgot' ? (
                <label>
                  <span>{tx('password')}</span>
                  <div className="password-field">
                    <input
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={tx('passwordPlaceholder')}
                      minLength={6}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? tx('hidePassword') : tx('showPassword')}
                      tabIndex={0}
                    >
                      {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                  </div>
                </label>
              ) : null}
              <button className="primary-action" type="submit" disabled={busy}>
                {busy
                  ? tx('working')
                  : mode === 'login'
                    ? tx('signIn')
                    : mode === 'register'
                      ? tx('createAccount')
                      : tx('sendResetLink')}
              </button>
              {mode === 'login' && onPasskeyLogin ? (
                <div className="auth-passkey-panel">
                  <button
                    type="button"
                    className="quiet-action auth-passkey-button"
                    onClick={() => onPasskeyLogin(email)}
                    disabled={busy || !passkeyAvailable}
                    title={!passkeyAvailable ? tx('passkeyUnavailable') : undefined}
                  >
                    <Fingerprint size={14} aria-hidden="true" />
                    {tx('continueWithPasskey')}
                  </button>
                  <p>{passkeyAvailable ? tx('passkeyLoginHint') : tx('passkeyUnavailable')}</p>
                </div>
              ) : null}
            </form>
            {recoveryMessage ? (
              <div className="recovery-result" role="status">
                <span>{recoveryMessage}</span>
                {recoveryLink ? (
                  <button
                    type="button"
                    className="quiet-action"
                    onClick={() => void navigator.clipboard.writeText(recoveryLink)}
                  >
                    <Copy size={13} aria-hidden="true" /> {tx('copyResetLink')}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="auth-mode-footer">
              {mode === 'login' ? (
                <button
                  className="text-action"
                  type="button"
                  onClick={() => switchMode('forgot')}
                >
                  {tx('forgotPassword')}
                </button>
              ) : null}
              <button
                className="text-action"
                type="button"
                onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              >
                {mode === 'login' ? tx('createNewAccount') : tx('backToSignIn')}
              </button>
            </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
