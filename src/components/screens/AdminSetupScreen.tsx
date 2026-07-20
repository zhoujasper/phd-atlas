import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  KeyRound,
  Mail,
  Server,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import type { InitialAdminSetupInput } from '../../api/phdApi'
import { useI18n } from '../hooks/useI18n'
import { SwitchControl } from '../shared/SwitchControl'

type SetupStep = 'account' | 'mail' | 'review'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AdminSetupScreen({
  busy,
  error,
  language,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  language: string
  onSubmit: (input: InitialAdminSetupInput) => Promise<void>
}) {
  const { tx } = useI18n()
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
  const stepIndex = step === 'account' ? 0 : step === 'mail' ? 1 : 2
  const steps = useMemo(() => [
    { id: 'account' as const, label: tx('admin.setup.accountStep'), icon: UserRound },
    { id: 'mail' as const, label: tx('admin.setup.mailStep'), icon: Mail },
    { id: 'review' as const, label: tx('admin.setup.reviewStep'), icon: Check },
  ], [tx])

  const goForward = () => {
    if (step === 'account' && accountValid) setStep('mail')
    else if (step === 'mail' && mailValid) setStep('review')
  }
  const goBack = () => {
    if (step === 'review') setStep('mail')
    else if (step === 'mail') setStep('account')
  }

  const submit = async () => {
    if (!accountValid || !mailValid || busy) return
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
      language,
    })
  }

  return (
    <main className="admin-setup-canvas route-content-reveal">
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
                  <input value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="smtp.example.com" autoFocus />
                </label>
                <label>
                  <span>{tx('settings.smtpPort')}</span>
                  <input type="number" min="1" max="65535" value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} inputMode="numeric" />
                </label>
                <label>
                  <span>{tx('settings.smtpUser')}</span>
                  <input type="email" value={smtpUser} onChange={(event) => setSmtpUser(event.target.value)} placeholder="notifications@example.com" autoComplete="username" />
                </label>
                <label>
                  <span>{tx('settings.smtpPass')}</span>
                  <input type="password" value={smtpPass} onChange={(event) => setSmtpPass(event.target.value)} autoComplete="new-password" />
                </label>
                <label className="admin-setup-field-wide">
                  <span>{tx('admin.setup.notificationMailbox')}</span>
                  <input type="email" value={notificationMailbox} onChange={(event) => setNotificationMailbox(event.target.value)} placeholder="admin@example.com" />
                  <small>{tx('admin.setup.notificationMailboxHint')}</small>
                </label>
                <div className="admin-setup-switch-row admin-setup-field-wide">
                  <div>
                    <strong>{tx('settings.smtpTls')}</strong>
                    <small>{tx('admin.setup.tlsHint')}</small>
                  </div>
                  <SwitchControl checked={smtpTls} label={tx('settings.smtpTls')} onChange={setSmtpTls} />
                </div>
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
                onClick={goForward}
                disabled={step === 'account' ? !accountValid : !mailValid}
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
