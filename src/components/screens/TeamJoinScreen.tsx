import '../../styles/team-join-code.css'
import { CheckCircle2, Clock3, KeyRound, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { phdApi, type AuthSession, type TeamJoinCodePreview } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'
import { LaunchScreen } from '../shared/LaunchScreen'
import { PendingLabel } from '../shared/PendingLabel'

const SESSION_KEY = 'phd-atlas-session'

function loadSession(): AuthSession | null {
  try {
    const value = localStorage.getItem(SESSION_KEY)
    return value ? JSON.parse(value) as AuthSession : null
  } catch {
    return null
  }
}

export function TeamJoinScreen({ code }: { code: string }) {
  const { tx, format, lang } = useI18n()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<TeamJoinCodePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const session = loadSession()

  useEffect(() => {
    let cancelled = false
    phdApi.getTeamJoinCode(code)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((reason) => {
        if (!cancelled) setError(normalizeErrorMessage(reason, lang, tx('team.joinCodeInvalid')))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code, lang, tx])

  const handleJoin = async () => {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      await phdApi.redeemTeamJoinCode(session.token, code)
      setJoined(true)
    } catch (reason) {
      setError(normalizeErrorMessage(reason, session.user.settings.language || lang, tx('team.joinCodeInvalid')))
    } finally {
      setBusy(false)
    }
  }

  const roleLabel = preview
    ? tx(`team.role${preview.role === 'owner' ? 'Owner' : preview.role === 'admin' ? 'Admin' : 'Member'}`)
    : ''

  if (loading) return <LaunchScreen variant="standalone" message={tx('working')} />

  return (
    <main className="auth-canvas route-content-reveal">
      <section className="auth-sheet" aria-label={tx('team.joinCodeRedeemTitle')}>
        <div className="auth-mark">
          {joined ? <CheckCircle2 size={24} aria-hidden="true" /> : <KeyRound size={24} aria-hidden="true" />}
        </div>

        {joined ? (
          <>
            <h1>{format(tx('team.joinCodeJoined'), { team: preview?.teamName ?? '' })}</h1>
            <button type="button" className="primary-action" onClick={() => { window.location.href = '/team' }}>
              {tx('team.inviteContinueToApp')}
            </button>
          </>
        ) : !preview ? (
          <>
            <h1>{tx('team.joinCodeInvalid')}</h1>
            {error ? <p className="admin-error" role="alert">{error}</p> : null}
          </>
        ) : (
          <>
            <h1>{format(tx('team.joinCodeRedeemWelcome'), { team: preview.teamName, role: roleLabel })}</h1>
            <div className="team-join-preview-meta">
              <span><Users size={14} aria-hidden="true" />{roleLabel}</span>
              <span><Clock3 size={14} aria-hidden="true" />{preview.reusable ? tx('team.joinCodeReusable') : tx('team.joinCodeOneTime')}</span>
            </div>
            {preview.managerNames.length > 0 ? (
              <p>{format(tx('team.joinCodeManagedBy'), { names: preview.managerNames.join(' · ') })}</p>
            ) : null}
            {error ? <div className="admin-error" role="alert">{error}</div> : null}
            {!session ? (
              <>
                <p>{tx('team.joinCodeRequiresLogin')}</p>
                <div className="auth-actions">
                  <a className="primary-action" href="/">{tx('team.inviteGoToSignIn')}</a>
                  <a className="quiet-action" href="/">{tx('team.inviteGoToRegister')}</a>
                </div>
              </>
            ) : (
              <button type="button" className="primary-action" disabled={busy} aria-busy={busy || undefined} onClick={handleJoin}>
                {busy ? <PendingLabel label={tx('working')} /> : tx('team.joinCodeSubmit')}
              </button>
            )}
          </>
        )}
      </section>
    </main>
  )
}
