import { AlertTriangle, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DesktopRuntime } from '../../desktopRuntime'
import { useI18n } from '../hooks/useI18n'
import { PendingLabel } from '../shared/PendingLabel'
import { SwitchControl } from '../shared/SwitchControl'

type DesktopUnlockSettingsProps = {
  runtime: DesktopRuntime
  onSave: (input: {
    enabled: boolean
    password?: string
    confirmPassword?: string
    currentPassword?: string
  }) => Promise<void> | void
}

export function DesktopUnlockSettings({ runtime, onSave }: DesktopUnlockSettingsProps) {
  const { tx } = useI18n()
  const enabled = runtime.unlockRequired === true
  const [draftEnabled, setDraftEnabled] = useState(enabled)
  useEffect(() => {
    setDraftEnabled(enabled)
    setChanging(false)
  }, [enabled])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const showEnableForm = !enabled && draftEnabled
  const showDisableForm = enabled && !draftEnabled
  const showChangeForm = enabled && draftEnabled && changing
  const needsForm = showEnableForm || showDisableForm || showChangeForm

  async function submit(enabledNext: boolean, includeNewPassword: boolean) {
    if (includeNewPassword && password.length < 4) {
      setLocalError(tx('settings.desktopUnlockTooShort'))
      return
    }
    if (includeNewPassword && password !== confirmPassword) {
      setLocalError(tx('settings.desktopUnlockMismatch'))
      return
    }
    setLocalError(null)
    setBusy(true)
    try {
      await onSave({
        enabled: enabledNext,
        password: includeNewPassword ? password : undefined,
        confirmPassword: includeNewPassword ? confirmPassword : undefined,
        currentPassword: enabled ? currentPassword : undefined,
      })
      setPassword('')
      setConfirmPassword('')
      setCurrentPassword('')
      setChanging(false)
      setDraftEnabled(enabledNext)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-export-card settings-desktop-unlock" aria-labelledby="settings-desktop-unlock-heading">
      <div className="settings-export-head">
        <div className="settings-export-icon" aria-hidden="true">
          <Lock size={18} />
        </div>
        <div className="settings-export-copy">
          <span className="settings-export-eyebrow">{tx('settings.desktopUnlockEyebrow')}</span>
          <h4 id="settings-desktop-unlock-heading">{tx('settings.desktopUnlockTitle')}</h4>
          <p>{tx('settings.desktopUnlockDesc')}</p>
        </div>
      </div>

      <div className="setting-row settings-desktop-unlock-switch">
        <span>{tx('settings.desktopUnlockSwitch')}</span>
        <SwitchControl
          checked={draftEnabled}
          disabled={busy}
          label={tx('settings.desktopUnlockSwitch')}
          onChange={(checked) => {
            setLocalError(null)
            setDraftEnabled(checked)
            if (checked === enabled) {
              setChanging(false)
              setPassword('')
              setConfirmPassword('')
              setCurrentPassword('')
            }
          }}
        />
      </div>
      <p className="settings-desktop-unlock-hint">
        {enabled ? tx('settings.desktopUnlockEnabledHint') : tx('settings.desktopUnlockDisabledHint')}
      </p>

      {needsForm ? (
        <form
          className="settings-desktop-unlock-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit(draftEnabled, showEnableForm || showChangeForm)
          }}
        >
          {enabled ? (
            <label>
              <span>{tx('settings.desktopUnlockCurrentLabel')}</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                disabled={busy}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
          ) : null}
          {showEnableForm || showChangeForm ? (
            <>
              <label>
                <span>{showChangeForm ? tx('settings.desktopUnlockNewLabel') : tx('settings.desktopUnlockPasswordLabel')}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={128}
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                <span>{tx('settings.desktopUnlockConfirmLabel')}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={128}
                  value={confirmPassword}
                  disabled={busy}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            </>
          ) : null}
          {localError ? <p className="desktop-unlock-error" role="alert">{localError}</p> : null}
          <p className="desktop-unlock-warning">
            <AlertTriangle size={13} aria-hidden="true" />
            {tx('settings.desktopUnlockWarning')}
          </p>
          <div className="settings-desktop-actions">
            <button type="submit" className="primary-action" disabled={busy}>
              {busy
                ? <PendingLabel label={tx('settings.desktopUnlockSaving')} />
                : showDisableForm
                  ? tx('settings.desktopUnlockDisableAction')
                  : showChangeForm
                    ? tx('settings.desktopUnlockChangeAction')
                    : tx('settings.desktopUnlockEnableAction')}
            </button>
          </div>
        </form>
      ) : enabled ? (
        <div className="settings-desktop-actions">
          <button
            type="button"
            className="quiet-action"
            disabled={busy}
            onClick={() => {
              setChanging(true)
              setLocalError(null)
            }}
          >
            {tx('settings.desktopUnlockChangeAction')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
