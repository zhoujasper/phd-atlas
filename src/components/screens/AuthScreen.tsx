import {
  ArrowDown,
  ArrowRight,
  Check,
  ClipboardList,
  Compass,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  GraduationCap,
  Languages,
  LayoutList,
  Mail,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  Users,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { normalizeErrorMessage } from '../../errorMessages'
import { PUBLIC_DISTRIBUTION } from '../../edition'
import type { Language } from '../../i18n'
import { createRecoverableModuleLoader } from '../../lazyModuleRecovery'
import { useDeadlineCountdown } from '../hooks/useDeadlineCountdown'
import { useI18n, useI18nValue } from '../hooks/useI18n'
import { useMarketingReveal, usePointerTilt } from '../hooks/useMarketingMotion'
import { useTheme } from '../hooks/useTheme'
import { PendingLabel } from '../shared/PendingLabel'
import { ProjectFooter } from '../shared/ProjectFooter'
import { Select } from '../shared/Select'
import { MarketingProductScreenshot } from './MarketingProductScreenshot'
import { TurnstileChallenge } from '../shared/TurnstileChallenge'

const MarketingFeatureTour = lazy(createRecoverableModuleLoader(() => import('./MarketingFeatureTour').then((module) => ({
  default: module.MarketingFeatureTour,
}))))

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_CODE_COOLDOWN_SECONDS = 45

type AuthMode = 'login' | 'register' | 'forgot'
type AuthModeDirection = 'forward' | 'back'
type HumanChallenge =
  | { provider?: 'math'; question: string; token: string }
  | { provider: 'turnstile'; siteKey: string; action: string }

/** Navigation depth so login ↔ create account / reset feels directional. */
function authModeRank(mode: AuthMode) {
  if (mode === 'login') return 0
  if (mode === 'forgot') return 1
  return 2
}

function marketingHeroTitleLines(title: string) {
  const lines = title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.length > 0 ? lines : [title]
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
  onCaptcha: () => Promise<HumanChallenge>
  onSendEmailCode: (
    email: string,
    language: string,
    challenge: { provider: 'math' | 'turnstile'; token: string; answer?: string },
  ) => Promise<{ token: string; expiresInSeconds: number }>
  languages: Array<{ value: Language; label: string }>
  onLanguageChange: (language: Language) => void
}) {
  const parentI18n = useI18n()
  const { tx, format, lang } = useI18nValue(
    parentI18n.lang,
    ['core', 'shared', 'dashboard', 'workspace', 'dossier', 'discover', 'profile', 'settings', 'team'],
  )
  const { theme, toggleTheme } = useTheme()
  const heroTitleLines = marketingHeroTitleLines(tx('authMarketingHeroTitle'))
  const pageRef = useRef<HTMLElement | null>(null)
  const productStageRef = useRef<HTMLDivElement | null>(null)
  const [mode, setMode] = useState<AuthMode>('login')
  const [modeDirection, setModeDirection] = useState<AuthModeDirection>('forward')
  const [modeAnimKey, setModeAnimKey] = useState(0)
  const modeStageRef = useRef<HTMLDivElement | null>(null)
  const modePanelRef = useRef<HTMLDivElement | null>(null)
  const modeHeightRef = useRef<number | null>(null)
  const modeRef = useRef<AuthMode>(mode)
  modeRef.current = mode
  const [name, setName] = useState(PUBLIC_DISTRIBUTION ? '' : 'Jasper')
  const [email, setEmail] = useState(PUBLIC_DISTRIBUTION ? '' : 'jasper@example.com')
  const [password, setPassword] = useState(PUBLIC_DISTRIBUTION ? '' : 'demo123456')
  const [showPassword, setShowPassword] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryLink, setRecoveryLink] = useState('')
  const [captchaQuestion, setCaptchaQuestion] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaProvider, setCaptchaProvider] = useState<'math' | 'turnstile'>('math')
  const [captchaSiteKey, setCaptchaSiteKey] = useState('')
  const [captchaAction, setCaptchaAction] = useState('signup')
  const [captchaError, setCaptchaError] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [emailCodeToken, setEmailCodeToken] = useState('')
  const [emailCodeValue, setEmailCodeValue] = useState('')
  const [emailCodeSending, setEmailCodeSending] = useState(false)
  const [emailCodeError, setEmailCodeError] = useState('')
  const [emailCodeCooldownUntil, setEmailCodeCooldownUntil] = useState<number | null>(null)
  const emailCodeCooldown = useDeadlineCountdown(emailCodeCooldownUntil)

  useMarketingReveal(pageRef)
  usePointerTilt(productStageRef)

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
    setCaptchaLoading(true)
    try {
      const challenge = await onCaptcha()
      const provider = challenge.provider === 'turnstile' ? 'turnstile' : 'math'
      setCaptchaProvider(provider)
      setCaptchaQuestion('question' in challenge ? challenge.question : '')
      setCaptchaToken('token' in challenge ? challenge.token : '')
      setCaptchaSiteKey(challenge.provider === 'turnstile' ? challenge.siteKey : '')
      setCaptchaAction(challenge.provider === 'turnstile' ? challenge.action : 'signup')
      setCaptchaAnswer('')
    } catch {
      setCaptchaQuestion('')
      setCaptchaToken('')
      setCaptchaSiteKey('')
      setCaptchaError(tx('captchaLoadFailed'))
    } finally {
      setCaptchaLoading(false)
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
    setEmailCodeCooldownUntil(null)
  }, [mode])

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
    if (!captchaToken || (captchaProvider === 'math' && !captchaAnswer.trim())) {
      setCaptchaError(tx('captchaRequired'))
      return
    }
    if (emailCodeSending || emailCodeCooldown > 0) return
    setEmailCodeError('')
    setEmailCodeSending(true)
    try {
      const result = await onSendEmailCode(trimmedEmail, lang, {
        provider: captchaProvider,
        token: captchaToken,
        answer: captchaProvider === 'math' ? captchaAnswer.trim() : undefined,
      })
      setEmailCodeToken(result.token)
      setEmailCodeValue('')
      setEmailCodeCooldownUntil(Date.now() + EMAIL_CODE_COOLDOWN_SECONDS * 1_000)
      void refreshCaptcha()
    } catch (error) {
      setEmailCodeToken('')
      setEmailCodeError(normalizeErrorMessage(error, lang, tx('emailCodeSendFailed')))
    } finally {
      setEmailCodeSending(false)
    }
  }, [captchaAnswer, captchaProvider, captchaToken, email, emailCodeSending, emailCodeCooldown, onSendEmailCode, lang, refreshCaptcha, tx])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setRecoveryMessage('')
    setRecoveryLink('')
    if (mode === 'login') {
      onLogin(email, password)
      return
    }
    if (mode === 'register') {
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
  const demoAccounts = PUBLIC_DISTRIBUTION
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

  function openAccess(nextMode: Extract<AuthMode, 'login' | 'register'>) {
    switchMode(nextMode)
    const target = document.getElementById('auth-access')
    if (!target) return
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }

  const accessFeatures: Array<{
    key: string
    title: string
    Icon: typeof LayoutList
  }> = [
    {
      key: 'dashboard',
      title: tx('nav.dashboard'),
      Icon: ClipboardList,
    },
    {
      key: 'applications',
      title: tx('nav.applications'),
      Icon: LayoutList,
    },
    {
      key: 'discover',
      title: tx('discover.title'),
      Icon: Compass,
    },
    {
      key: 'profile',
      title: tx('profile.title'),
      Icon: UserRound,
    },
    {
      key: 'team',
      title: tx('nav.team'),
      Icon: Users,
    },
    {
      key: 'settings',
      title: tx('authMarketingContinuityTitle'),
      Icon: Settings,
    },
  ]

  return (
    <main className="auth-canvas auth-marketing-page" ref={pageRef}>
      <header className="auth-marketing-nav" data-marketing-reveal data-marketing-visible="true">
        <a className="auth-marketing-brand" href="#auth-top" aria-label={tx('appTitle')}>
          <span aria-hidden="true"><GraduationCap size={17} /></span>
          <strong>{tx('appTitle')}</strong>
        </a>
        <div className="auth-marketing-nav-actions">
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
          <a
            className="auth-nav-sign-in"
            href="#auth-access"
            onClick={(event) => {
              event.preventDefault()
              openAccess('login')
            }}
          >
            {tx('signIn')}
          </a>
        </div>
      </header>

      <section className="auth-marketing-hero" id="auth-top" aria-labelledby="auth-marketing-title">
        <div className="auth-marketing-hero-copy" data-marketing-reveal data-marketing-visible="true">
          <h1 id="auth-marketing-title" aria-label={heroTitleLines.join(' ')}>
            {heroTitleLines.map((line, index) => (
              <span
                key={`${index}-${line}`}
                className={`auth-marketing-title-line${index === heroTitleLines.length - 1 ? ' is-accent' : ''}`}
                aria-hidden="true"
              >
                {line}
              </span>
            ))}
          </h1>
          <p>{tx('authMarketingHeroBody')}</p>
          <div className="auth-marketing-hero-actions">
            <a
              className="auth-marketing-primary"
              href="#auth-access"
              onClick={(event) => {
                event.preventDefault()
                openAccess('login')
              }}
            >
              {tx('signIn')}
              <ArrowRight size={15} aria-hidden="true" />
            </a>
            <a
              className="auth-marketing-secondary"
              href="#auth-access"
              onClick={(event) => {
                event.preventDefault()
                openAccess('register')
              }}
            >
              {tx('createAccount')}
            </a>
          </div>
        </div>

        <div
          className="auth-product-stage"
          ref={productStageRef}
          aria-label={tx('appDesc')}
          data-marketing-reveal
          data-marketing-visible="true"
        >
          <div className="auth-product-stage-light" aria-hidden="true" />
          <MarketingProductScreenshot
            language={lang}
            theme={theme}
            alt={tx('authMarketingScreenshotAlt')}
            caption={tx('authMarketingScreenshotCaption')}
            className="auth-real-workspace"
            priority
          />
        </div>

        <a className="auth-marketing-scroll-cue" href="#auth-story">
          <span>{tx('authMarketingStoryTitle')}</span>
          <ArrowDown size={14} aria-hidden="true" />
        </a>
      </section>

      <Suspense fallback={<div className="auth-tour-loading" aria-hidden="true" />}>
        <MarketingFeatureTour />
      </Suspense>

      <section className="auth-access-section" id="auth-access" aria-labelledby="auth-access-title">
        <div className="auth-access-copy" data-marketing-reveal>
          <h2 id="auth-access-title">{tx('authMarketingAccessTitle')}</h2>
          <p>{tx('authMarketingAccessBody')}</p>
          <ul>
            {accessFeatures.map(({ key, title, Icon }) => (
              <li key={key}><Icon size={14} aria-hidden="true" /><span>{title}</span></li>
            ))}
          </ul>
        </div>

        <section className="auth-sheet" aria-label={modeHeading} data-marketing-reveal>
          <div className="auth-sheet-intro">
            <div className="auth-mark">
              <GraduationCap size={20} aria-hidden="true" />
            </div>
            <div>
              <h2>{tx('appTitle')}</h2>
              <p>{tx('appDesc')}</p>
            </div>
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
                      setEmailCodeCooldownUntil(null)
                      setEmailCodeError('')
                    }
                  }}
                  placeholder="you@example.com"
                />
              </label>
              {mode === 'register' ? (
                <label>
                  <span>{tx('captcha')}</span>
                  {captchaProvider === 'turnstile' && captchaSiteKey ? (
                    <TurnstileChallenge
                      siteKey={captchaSiteKey}
                      action={captchaAction}
                      theme={theme}
                      onToken={(token) => {
                        setCaptchaToken(token)
                        if (token) setCaptchaError('')
                      }}
                      onError={() => setCaptchaError(tx('captchaLoadFailed'))}
                    />
                  ) : (
                    <div className="captcha-row">
                      <strong aria-live="polite" aria-busy={captchaLoading || undefined}>
                        {captchaQuestion || <PendingLabel label={tx('working')} iconSize={11} />}
                      </strong>
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
                      <button
                        type="button"
                        className="icon-action captcha-refresh-action"
                        onClick={() => void refreshCaptcha()}
                        disabled={captchaLoading}
                        aria-busy={captchaLoading || undefined}
                        aria-label={tx('refreshCaptcha')}
                        title={tx('refreshCaptcha')}
                      >
                        <RefreshCw size={13} className={captchaLoading ? 'spin-icon' : undefined} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {captchaError ? <em className="settings-inline-error">{captchaError}</em> : null}
                </label>
              ) : null}
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
                      disabled={
                        emailCodeSending
                        || emailCodeCooldown > 0
                        || !captchaToken
                        || (captchaProvider === 'math' && !captchaAnswer.trim())
                      }
                      aria-busy={emailCodeSending || undefined}
                    >
                      {emailCodeSending ? (
                        <PendingLabel label={tx('working')} iconSize={12} />
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
                      minLength={mode === 'register' ? 15 : 8}
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
              <button className="primary-action" type="submit" disabled={busy} aria-busy={busy || undefined}>
                {busy
                  ? <PendingLabel label={tx('working')} iconSize={13} />
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
      </section>
      <div className="auth-marketing-footer">
        <ProjectFooter />
      </div>
    </main>
  )
}
