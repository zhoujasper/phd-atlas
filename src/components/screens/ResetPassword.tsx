import { CheckCircle2, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { phdApi } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'

export function ResetPassword({ token }: { token: string }) {
  const { tx, lang } = useI18n()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError(tx('resetPassword.mismatch'))
      return
    }
    setBusy(true)
    try {
      await phdApi.resetPasswordWithToken(token, password)
      setDone(true)
    } catch (err) {
      setError(normalizeErrorMessage(err, lang, tx('resetPassword.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-canvas route-content-reveal">
      <section className="auth-sheet" aria-label={tx('resetPassword.title')}>
        <div className="auth-mark">
          {done ? <CheckCircle2 size={24} aria-hidden="true" /> : <KeyRound size={24} aria-hidden="true" />}
        </div>
        <h1>{done ? tx('resetPassword.doneTitle') : tx('resetPassword.title')}</h1>
        <p>{done ? tx('resetPassword.doneHint') : tx('resetPassword.hint')}</p>

        {error ? (
          <div className="admin-error" role="alert">
            {error}
          </div>
        ) : null}

        {done ? (
          <button type="button" className="primary-action" onClick={() => { window.location.href = '/' }}>
            {tx('resetPassword.backToSignIn')}
          </button>
        ) : (
          <form onSubmit={handleSubmit}>
            <label>
              <span>{tx('resetPassword.newPassword')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
                autoFocus
              />
            </label>
            <label>
              <span>{tx('resetPassword.confirmPassword')}</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <button className="primary-action" type="submit" disabled={busy}>
              {busy ? tx('working') : tx('resetPassword.submit')}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
