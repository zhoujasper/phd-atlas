import {
  Building2,
  Check,
  CheckCircle2,
  CircleAlert,
  FileText,
  HardDrive,
  Info,
  LoaderCircle,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  TeamTransferPreflight,
  TeamTransferPreflightCheck,
  TeamWorkspaceOption,
} from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import { normalizeErrorMessage } from '../../errorMessages'
import { localeForLanguage } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'

type TransferDirection = 'join' | 'leave'

const checkIcons = {
  permission: ShieldCheck,
  applicationQuota: FileText,
  storage: HardDrive,
} as const

function formatBytes(value: number, language: string) {
  const unit = value >= 1024 * 1024 * 1024 ? 'GB' : 'MB'
  const divisor = unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024
  return `${new Intl.NumberFormat(localeForLanguage(language), {
    maximumFractionDigits: unit === 'GB' ? 1 : 0,
  }).format(value / divisor)} ${unit}`
}

function checkDetail(check: TeamTransferPreflightCheck, language: string, unlimited: string) {
  if (check.id === 'permission') return ''
  if (check.limit === null) return unlimited
  if (check.id === 'storage') {
    return `${formatBytes(check.used ?? 0, language)} + ${formatBytes(check.incoming ?? 0, language)} / ${formatBytes(check.limit, language)}`
  }
  return `${(check.used ?? 0) + 1} / ${check.limit}`
}

export function ApplicationTransferDialog({
  open,
  application,
  direction,
  approvalRequired = true,
  organizations,
  onPreflight,
  onSubmit,
  onClose,
}: {
  open: boolean
  application: ApplicationRecord
  direction: TransferDirection
  approvalRequired?: boolean
  organizations: TeamWorkspaceOption[]
  onPreflight: (teamId: string) => Promise<TeamTransferPreflight>
  onSubmit: (teamId: string) => Promise<boolean | void> | boolean | void
  onClose: () => void
}) {
  const { tx, lang } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const initialOrganizationId = direction === 'leave'
    ? application.teamId ?? organizations[0]?.teamId ?? ''
    : organizations.length === 1
      ? organizations[0]?.teamId ?? ''
      : ''
  const [selectedTeamId, setSelectedTeamId] = useState(initialOrganizationId)
  const [preflightByTeam, setPreflightByTeam] = useState<Record<string, TeamTransferPreflight>>({})
  const [loadingTeamIds, setLoadingTeamIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const onPreflightRef = useRef(onPreflight)
  const submittingRef = useRef(submitting)
  onPreflightRef.current = onPreflight
  submittingRef.current = submitting
  const { exiting, requestClose } = useAnimatedClose(open, onClose, 150, application.id)
  const selectedPreflight = selectedTeamId ? preflightByTeam[selectedTeamId] : null
  const selectedLoading = Boolean(selectedTeamId && loadingTeamIds.has(selectedTeamId))
  const canSubmit = Boolean(selectedTeamId && selectedPreflight?.eligible && !selectedLoading && !submitting)
  const dialogRef = useModalA11y<HTMLDivElement>({
    open: open && !exiting,
    onClose: () => {
      if (!submitting) requestClose()
    },
    onConfirm: () => {
      if (canSubmit) void submit()
    },
    initialFocusRef: organizations.length === 1 ? confirmRef : undefined,
  })

  const visibleOrganizations = useMemo(() => {
    if (direction === 'join') return organizations
    const current = organizations.find((organization) => organization.teamId === application.teamId)
    return current ? [current] : organizations.slice(0, 1)
  }, [application.teamId, direction, organizations])

  useEffect(() => {
    if (!open || submittingRef.current) return
    const nextSelected = direction === 'leave'
      ? application.teamId ?? visibleOrganizations[0]?.teamId ?? ''
      : visibleOrganizations.length === 1
        ? visibleOrganizations[0]?.teamId ?? ''
        : ''
    setSelectedTeamId(nextSelected)
    setPreflightByTeam({})
    setError(null)
    setSubmitting(false)

    let cancelled = false
    const ids = visibleOrganizations.map((organization) => organization.teamId)
    setLoadingTeamIds(new Set(ids))
    for (const teamId of ids) {
      void onPreflightRef.current(teamId)
        .then((preflight) => {
          if (cancelled) return
          setPreflightByTeam((current) => ({ ...current, [teamId]: preflight }))
        })
        .catch((cause) => {
          if (!cancelled) setError(normalizeErrorMessage(cause, lang))
        })
        .finally(() => {
          if (cancelled) return
          setLoadingTeamIds((current) => {
            const next = new Set(current)
            next.delete(teamId)
            return next
          })
        })
    }
    return () => {
      cancelled = true
    }
  }, [application.id, application.teamId, direction, lang, open, visibleOrganizations])

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await onSubmit(selectedTeamId)
      if (result !== false) requestClose()
    } catch (cause) {
      setError(normalizeErrorMessage(cause, lang))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const multipleOrganizations = direction === 'join' && visibleOrganizations.length > 1
  const actionLabel = direction === 'join'
    ? tx('dossier.teamVisibilityShare')
    : tx(approvalRequired ? 'dossier.teamVisibilityMakePrivate' : 'dossier.teamVisibilityMoveToPersonal')

  return (
    <ModalPortal>
      <div
        className={`application-transfer-layer${exiting ? ' exiting' : ''}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !submitting) requestClose()
        }}
      >
        <div
          ref={dialogRef}
          className="application-transfer-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <header className="application-transfer-head">
            <div>
              <h2 id={titleId}>
                {actionLabel}
              </h2>
              <p id={descriptionId}>
                {tx(direction === 'join'
                  ? 'dossier.teamTransferChooseOrganizationDesc'
                  : approvalRequired
                    ? 'dossier.teamTransferLeaveDesc'
                    : 'dossier.teamTransferDirectLeaveDesc')}
              </p>
            </div>
            <button
              type="button"
              className="application-transfer-close"
              disabled={submitting}
              onClick={() => requestClose()}
              aria-label={tx('close')}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </header>

          <div className="application-transfer-app">
            <span aria-hidden="true"><FileText size={16} /></span>
            <strong>{application.school.name}</strong>
            <em>·</em>
            <span>{application.program}</span>
          </div>

          {multipleOrganizations ? (
            <section className="application-transfer-organizations" aria-labelledby={`${titleId}-organizations`}>
              <h3 id={`${titleId}-organizations`}>{tx('dossier.teamTransferChooseOrganization')}</h3>
              <div className="application-transfer-organization-list">
                {visibleOrganizations.map((organization) => {
                  const preflight = preflightByTeam[organization.teamId]
                  const loading = loadingTeamIds.has(organization.teamId)
                  const selected = selectedTeamId === organization.teamId
                  return (
                    <button
                      key={organization.teamId}
                      type="button"
                      className={selected ? 'selected' : ''}
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedTeamId(organization.teamId)
                        setError(null)
                      }}
                    >
                      <span className="application-transfer-radio" aria-hidden="true">
                        {selected ? <Check size={11} /> : null}
                      </span>
                      <span className="application-transfer-organization-icon" aria-hidden="true">
                        <Building2 size={15} />
                      </span>
                      <span className="application-transfer-organization-copy">
                        <strong>{organization.name}</strong>
                        <em>{organization.applicationCount} {tx('nav.applications')}</em>
                      </span>
                      <span className={`application-transfer-availability${preflight?.eligible ? ' eligible' : preflight ? ' blocked' : ''}`}>
                        {loading
                          ? <LoaderCircle size={13} className="spin" aria-label={tx('dossier.teamTransferChecking')} />
                          : preflight?.eligible
                            ? tx('dossier.teamTransferAvailable')
                            : preflight
                              ? tx('dossier.teamTransferUnavailable')
                              : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section className="application-transfer-preflight" aria-labelledby={`${titleId}-preflight`}>
            <h3 id={`${titleId}-preflight`}>{tx('dossier.teamTransferPreflightTitle')}</h3>
            {!selectedTeamId ? (
              <div className="application-transfer-placeholder">
                <Building2 size={16} aria-hidden="true" />
                <span>{tx('dossier.teamTransferChooseOrganizationFirst')}</span>
              </div>
            ) : selectedLoading || !selectedPreflight ? (
              <div className="application-transfer-placeholder checking" role="status">
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
                <span>{tx('dossier.teamTransferChecking')}</span>
              </div>
            ) : (
              <div className="application-transfer-check-list">
                {selectedPreflight.checks.map((check, index) => {
                  const Icon = checkIcons[check.id]
                  return (
                    <div
                      key={check.id}
                      className={`application-transfer-check${check.ok ? ' passed' : ' failed'}`}
                      style={{ '--transfer-check-index': index } as CSSProperties}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span>
                        <strong>{tx(`dossier.teamTransferCheck${check.id[0].toUpperCase()}${check.id.slice(1)}`)}</strong>
                        <em>{checkDetail(check, lang, tx('dossier.teamTransferUnlimited'))}</em>
                      </span>
                      {check.ok
                        ? <CheckCircle2 size={16} aria-label={tx('dossier.teamTransferCheckPassed')} />
                        : <CircleAlert size={16} aria-label={tx('dossier.teamTransferCheckFailed')} />}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <div className="application-transfer-note">
            <Info size={14} aria-hidden="true" />
            <span>{tx(approvalRequired ? 'dossier.teamTransferApprovalNote' : 'dossier.teamTransferDirectNote')}</span>
          </div>

          {error ? <p className="application-transfer-error" role="alert">{error}</p> : null}

          <footer className="application-transfer-actions">
            <button type="button" className="quiet-action" disabled={submitting} onClick={() => requestClose()}>
              {tx('cancel')}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="primary-action"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {submitting
                ? tx('working')
                : actionLabel}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}
