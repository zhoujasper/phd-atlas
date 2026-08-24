import { Cloud, Database, Download, HardDrive, Link2Off, Upload } from 'lucide-react'
import { useState } from 'react'
import type { DesktopRuntime } from '../../desktopRuntime'
import { useI18n } from '../hooks/useI18n'
import { PendingLabel } from '../shared/PendingLabel'

type DesktopStorageSettingsProps = {
  runtime: DesktopRuntime
  onConnect: (origin: string, email: string, password: string) => Promise<void> | void
  onDisconnect: () => Promise<void> | void
  onCompleteExport: () => Promise<void> | void
  onCompleteImport: (file: File) => Promise<void> | void
}

export function DesktopStorageSettings({
  runtime,
  onConnect,
  onDisconnect,
  onCompleteExport,
  onCompleteImport,
}: DesktopStorageSettingsProps) {
  const { tx } = useI18n()
  const [origin, setOrigin] = useState(runtime.remoteOrigin ?? '')
  const [email, setEmail] = useState(runtime.remoteEmail ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'export' | 'import' | null>(null)

  const linked = runtime.mode === 'remote'
  async function run(kind: typeof busy, work: () => Promise<void> | void) {
    setBusy(kind)
    try {
      await work()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-export-card settings-desktop-storage" aria-labelledby="settings-desktop-storage-heading">
      <div className="settings-export-head">
        <div className="settings-export-icon" aria-hidden="true">
          {linked ? <Cloud size={18} /> : <HardDrive size={18} />}
        </div>
        <div className="settings-export-copy">
          <span className="settings-export-eyebrow">{tx('settings.desktopStorageEyebrow')}</span>
          <h4 id="settings-desktop-storage-heading">{tx('settings.desktopStorageTitle')}</h4>
          <p>
            {linked
              ? tx('settings.desktopStorageLinkedDesc')
              : tx('settings.desktopStorageLocalDesc')}
          </p>
        </div>
      </div>

      <dl className="settings-desktop-mode">
        <div>
          <dt>{tx('settings.desktopModeLabel')}</dt>
          <dd>{linked ? tx('settings.desktopModeLinked') : tx('settings.desktopModeLocal')}</dd>
        </div>
        {linked && runtime.remoteOrigin ? (
          <div>
            <dt>{tx('settings.desktopOriginLabel')}</dt>
            <dd>{runtime.remoteOrigin}</dd>
          </div>
        ) : null}
        {runtime.unlimited ? (
          <div>
            <dt>{tx('settings.desktopQuotaLabel')}</dt>
            <dd>{tx('settings.desktopUnlimitedHint')}</dd>
          </div>
        ) : null}
      </dl>

      {linked ? (
        <div className="settings-desktop-actions">
          <button
            type="button"
            className="quiet-action"
            disabled={busy !== null}
            onClick={() => void run('disconnect', () => onDisconnect())}
          >
            <Link2Off size={14} aria-hidden="true" />
            {busy === 'disconnect'
              ? <PendingLabel label={tx('settings.desktopDisconnecting')} />
              : tx('settings.desktopDisconnectAction')}
          </button>
        </div>
      ) : (
        <form
          className="settings-desktop-connect"
          onSubmit={(event) => {
            event.preventDefault()
            void run('connect', () => onConnect(origin, email, password))
          }}
        >
          <label>
            <span>{tx('settings.desktopOriginLabel')}</span>
            <input
              type="url"
              required
              autoComplete="url"
              placeholder={tx('settings.desktopOriginPlaceholder')}
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            />
          </label>
          <label>
            <span>{tx('settings.desktopEmailLabel')}</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>{tx('settings.desktopPasswordLabel')}</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-action" disabled={busy !== null}>
            {busy === 'connect'
              ? <PendingLabel label={tx('settings.desktopConnecting')} />
              : tx('settings.desktopConnectAction')}
          </button>
        </form>
      )}

      <div className="settings-desktop-transfer">
        <button
          type="button"
          className="quiet-action"
          disabled={busy !== null}
          onClick={() => void run('export', () => onCompleteExport())}
        >
          <Download size={14} aria-hidden="true" />
          {busy === 'export'
            ? <PendingLabel label={tx('settings.desktopExporting')} />
            : tx('settings.desktopCompleteExportAction')}
        </button>
        <label className="quiet-action settings-desktop-import">
          <Upload size={14} aria-hidden="true" />
          <input
            type="file"
            accept="application/json,.json"
            hidden
            disabled={busy !== null || linked}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void run('import', () => onCompleteImport(file))
            }}
          />
          {busy === 'import'
            ? <PendingLabel label={tx('settings.desktopImporting')} />
            : tx('settings.desktopCompleteImportAction')}
        </label>
      </div>
      <p className="settings-desktop-transfer-hint">
        <Database size={12} aria-hidden="true" />
        {tx('settings.desktopCompleteExportDesc')}
      </p>
    </section>
  )
}
