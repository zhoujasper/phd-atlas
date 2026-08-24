import '../../styles/desktopUnlock.css'
import { AlertTriangle, GraduationCap, Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useI18n } from '../hooks/useI18n'
import { PendingLabel } from '../shared/PendingLabel'

type DesktopUnlockScreenProps = {
  busy?: boolean
  error?: string | null
  onUnlock: (password: string) => Promise<void> | void
}

export function DesktopUnlockScreen({
  busy = false,
  error = null,
  onUnlock,
}: DesktopUnlockScreenProps) {
  const { tx } = useI18n()
  const [password, setPassword] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !password) return
    void onUnlock(password)
  }

  return (
    <main className="desktop-unlock-screen">
      <section className="desktop-unlock-card" aria-labelledby="desktop-unlock-title">
        <div className="desktop-unlock-mark" aria-hidden="true">
          <GraduationCap size={22} />
        </div>
        <h1 id="desktop-unlock-title">{tx('settings.desktopUnlockOpenTitle')}</h1>
        <p>{tx('settings.desktopUnlockOpenDesc')}</p>
        <form className="desktop-unlock-form" onSubmit={handleSubmit}>
          <label>
            <span>{tx('settings.desktopUnlockPasswordLabel')}</span>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              minLength={4}
              maxLength={128}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="desktop-unlock-error" role="alert">{error}</p> : null}
          <button type="submit" className="primary-action" disabled={busy || !password}>
            <Lock size={14} aria-hidden="true" />
            {busy
              ? <PendingLabel label={tx('settings.desktopUnlockUnlocking')} />
              : tx('settings.desktopUnlockSubmit')}
          </button>
        </form>
        <p className="desktop-unlock-warning">
          <AlertTriangle size={13} aria-hidden="true" />
          {tx('settings.desktopUnlockWarning')}
        </p>
      </section>
    </main>
  )
}
