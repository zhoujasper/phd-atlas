import { CheckCircle2, Users, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { phdApi, type AuthSession, type TeamInvitePreview } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'
import { LaunchScreen } from '../shared/LaunchScreen'
import { PendingLabel } from '../shared/PendingLabel'

const SESSION_KEY = 'phd-atlas-session'

function safeParseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function loadSession() {
  return safeParseJson<AuthSession>(localStorage.getItem(SESSION_KEY))
}

export function TeamInviteScreen({ token }: { token: string }) {
  const { tx, format, lang } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<TeamInvitePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null)
  const session = loadSession()

  useEffect(() => {
    let cancelled = false
    phdApi.getTeamInvite(token)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((err) => {
        if (!cancelled) setError(normalizeErrorMessage(err, lang, tx('team.inviteInvalid')))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lang, token, tx])

  async function handleAccept() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      await phdApi.acceptTeamInvite(session.token, token)
      setOutcome('accepted')
    } catch (err) {
      setError(normalizeErrorMessage(err, session.user.settings.language || lang))
    } finally {
      setBusy(false)
    }
  }

  async function handleDecline() {
    setBusy(true)
    setError(null)
    try {
      await phdApi.declineTeamInvite(token)
      setOutcome('declined')
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const roleLabelKeys = { owner: 'team.roleOwner', admin: 'team.roleAdmin', member: 'team.roleMember' } as const
  const roleLabel = preview ? tx(roleLabelKeys[preview.role]) : ''

  if (loading) {
    return <LaunchScreen variant="standalone" message={tx('working')} />
  }

  return (
    <main className="auth-canvas route-content-reveal">
      <section className="auth-sheet" aria-label={tx('team.inviteTitle')}>
        <div className="auth-mark">
          {outcome === 'accepted' ? <CheckCircle2 size={24} aria-hidden="true" /> : outcome === 'declined' ? <XCircle size={24} aria-hidden="true" /> : <Users size={24} aria-hidden="true" />}
        </div>

        {outcome === 'accepted' ? (
          <>
            <h1>{format(tx('team.inviteAccepted'), { team: preview?.teamName ?? '' })}</h1>
            <button type="button" className="primary-action" onClick={() => { window.location.href = '/' }}>
              {tx('team.inviteContinueToApp')}
            </button>
          </>
        ) : outcome === 'declined' ? (
          <h1>{tx('team.inviteDeclined')}</h1>
        ) : !preview ? (
          <>
            <h1>{tx('team.inviteInvalid')}</h1>
            {error ? <p className="admin-error" role="alert">{error}</p> : null}
          </>
        ) : (
          <>
            <h1>{format(tx('team.inviteWelcome'), { inviter: preview.inviterName, team: preview.teamName, role: roleLabel })}</h1>
            <p>{preview.invitedEmail}</p>

            {error ? <div className="admin-error" role="alert">{error}</div> : null}

            {!session ? (
              <>
                <p>{format(tx('team.inviteRequiresLogin'), { email: preview.invitedEmail })}</p>
                <div className="auth-actions">
                  <a className="primary-action" href="/">{tx('team.inviteGoToSignIn')}</a>
                  <a className="quiet-action" href="/">{tx('team.inviteGoToRegister')}</a>
                </div>
              </>
            ) : (
              <div className="auth-actions">
                <button type="button" className="primary-action" disabled={busy} aria-busy={busy || undefined} onClick={handleAccept}>
                  {busy ? <PendingLabel label={tx('working')} /> : tx('team.inviteAccept')}
                </button>
                <button type="button" className="quiet-action" disabled={busy} onClick={handleDecline}>
                  {tx('team.inviteDecline')}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
