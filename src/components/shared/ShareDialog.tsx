import {
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  FileText,
  History,
  LayoutDashboard,
  Link2,
  ListChecks,
  Mail,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  TableCell,
  TableColGroup,
  TableHeaderCell,
  useTableColumnMenu,
} from './TableColumnChrome'
import type { TableColumnDef } from './useTableColumns'
import {
  normalizeSharePermission,
  normalizeShareSections,
  shareSections,
  type ApplicationRecord,
  type SharePermission,
  type ShareSection,
} from '../../data/applications'
import { localeForLanguage } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ConfirmDialog } from './ConfirmDialog'
import { ModalPortal } from './ModalPortal'
import { CopyButton } from './CopyButton'
import { OverflowReveal } from './OverflowReveal'
import { Select } from './Select'
import { shareExpiryOptions, type ShareExpiry } from './shareOptions'

const sharePermissionOptions: Array<{ value: SharePermission; labelKey: string; fallback: string }> = [
  { value: 'view', labelKey: 'share.permission.view', fallback: 'View' },
  { value: 'upload', labelKey: 'share.permission.upload', fallback: 'Upload files' },
  { value: 'edit', labelKey: 'share.permission.edit', fallback: 'Edit' },
]
const shareSectionOptions = [
  { value: 'overview', icon: LayoutDashboard, labelKey: 'share.sections.overview', descriptionKey: 'share.sectionDescriptions.overview', fallback: 'Project overview', descriptionFallback: 'School, program, professor, dates, progress, tags, and dossier cards.' },
  { value: 'materials', icon: FileText, labelKey: 'share.sections.materials', descriptionKey: 'share.sectionDescriptions.materials', fallback: 'Checklist', descriptionFallback: 'Materials, statuses, file requests, recommenders, and material versions.' },
  { value: 'tasks', icon: ListChecks, labelKey: 'share.sections.tasks', descriptionKey: 'share.sectionDescriptions.tasks', fallback: 'Tasks', descriptionFallback: 'Task checklist, due dates, details, and requested attachments.' },
  { value: 'communications', icon: Mail, labelKey: 'share.sections.communications', descriptionKey: 'share.sectionDescriptions.communications', fallback: 'Correspondence', descriptionFallback: 'Professor emails, messages, notes, dates, and summaries.' },
  { value: 'funding', icon: CircleDollarSign, labelKey: 'share.sections.funding', descriptionKey: 'share.sectionDescriptions.funding', fallback: 'Funding', descriptionFallback: 'Scholarships, fee tracker, funding tasks, materials, and milestones.' },
  { value: 'timeline', icon: CalendarDays, labelKey: 'share.sections.timeline', descriptionKey: 'share.sectionDescriptions.timeline', fallback: 'Timeline', descriptionFallback: 'Application timeline with manual and shared-page milestones.' },
  { value: 'versions', icon: History, labelKey: 'share.sections.versions', descriptionKey: 'share.sectionDescriptions.versions', fallback: 'Version history', descriptionFallback: 'Uploaded file history and downloadable versions included in this project.' },
] satisfies Array<{ value: ShareSection; icon: typeof LayoutDashboard; labelKey: string; descriptionKey: string; fallback: string; descriptionFallback: string }>
const DEFAULT_SHARE_QUOTA = 5
const SHARE_DIALOG_PAGE_SIZE = 6

function formatShareDate(value: string | null, lang: string) {
  if (!value) return null
  return new Date(value).toLocaleString(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatShareTimestamp(value: string, lang: string) {
  return new Date(value).toLocaleString(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function shareUrl(token: string) {
  return `${window.location.origin}/share/${token}`
}

function sharePath(token: string) {
  return `/share/${token}`
}

export function ShareDialog({
  open,
  application,
  expiry,
  permission,
  sections,
  onExpiry,
  onPermission,
  onSections,
  onClose,
  onCreate,
  onRevoke,
  onUpdateShare,
  onNotify,
  activeShareCount,
  shareQuota,
}: {
  open: boolean
  application: ApplicationRecord | null
  expiry: ShareExpiry
  permission: SharePermission
  sections: ShareSection[]
  onExpiry: (expiry: ShareExpiry) => void
  onPermission: (permission: SharePermission) => void
  onSections: (sections: ShareSection[]) => void
  onClose: () => void
  onCreate: () => void
  onRevoke: (shareId: string) => void
  onUpdateShare?: (shareId: string, expiresAt: string | null, permission?: SharePermission, sections?: ShareSection[]) => void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  activeShareCount?: number
  shareQuota?: number
}) {
  const { tx, format, lang } = useI18n()
  const notifyCopyResult = (ok: boolean, detail: { label: string }) => {
    if (ok) {
      onNotify?.(format(tx('toast.copied'), { label: detail.label }), 'success')
      return
    }
    onNotify?.(tx('copyFailed'), 'error')
  }
  const { exiting, requestClose } = useAnimatedClose(open, onClose)
  const [sharePage, setSharePage] = useState(0)
  const [confirmRevokeShareId, setConfirmRevokeShareId] = useState<string | null>(null)
  const shareTableColumns = useMemo<TableColumnDef[]>(() => [
    { id: 'link', label: tx('share.table.link', 'Link'), defaultWidth: 180, minWidth: 120 },
    { id: 'created', label: tx('share.table.created', 'Created'), defaultWidth: 128, minWidth: 96 },
    { id: 'expires', label: tx('share.table.expires', 'Expires'), defaultWidth: 132, minWidth: 96 },
    { id: 'permission', label: tx('share.table.permission', 'Permission'), defaultWidth: 128, minWidth: 100 },
    { id: 'scope', label: tx('share.table.scope', 'Scope'), defaultWidth: 140, minWidth: 96 },
    { id: 'actions', label: tx('share.table.actions', 'Actions'), defaultWidth: 88, minWidth: 72, hideable: false },
  ], [tx])
  const {
    api: shareTableApi,
    openMenu: openShareTableMenu,
    menuNode: shareTableMenuNode,
  } = useTableColumnMenu('share-dialog-links', shareTableColumns)
  const shareCol = useMemo(
    () => Object.fromEntries(shareTableColumns.map((column) => [column.id, column])) as Record<string, TableColumnDef>,
    [shareTableColumns],
  )
  const shares = useMemo(
    () => (application?.shares ?? []).filter((share) => !share.expiresAt || new Date(share.expiresAt) >= new Date()),
    [application],
  )
  const resolvedShareQuota = Math.max(1, Number(shareQuota ?? DEFAULT_SHARE_QUOTA))
  const totalActiveShares = activeShareCount ?? shares.length
  const atShareLimit = totalActiveShares >= resolvedShareQuota
  const sharePageCount = Math.max(1, Math.ceil(shares.length / SHARE_DIALOG_PAGE_SIZE))
  const pagedShares = shares.slice(sharePage * SHARE_DIALOG_PAGE_SIZE, (sharePage + 1) * SHARE_DIALOG_PAGE_SIZE)
  const normalizedSections = normalizeShareSections(sections)
  const completePackageSelected = normalizedSections.length === shareSections.length

  useEffect(() => {
    setSharePage(0)
  }, [open, application?.id])

  useEffect(() => {
    if (sharePage > sharePageCount - 1) {
      setSharePage(sharePageCount - 1)
    }
  }, [sharePage, sharePageCount])

  const dialogRef = useModalA11y({ open: open && !exiting && Boolean(application), onClose: () => requestClose() })

  if (!open || !application) return null

  const sectionLabel = (section: ShareSection) =>
    tx(`share.sections.${section}`, shareSectionOptions.find((option) => option.value === section)?.fallback ?? section)

  const scopeLabel = (selectedSections: ShareSection[]) =>
    selectedSections.length === shareSections.length
      ? tx('share.scope.all')
      : format(tx('share.scope.count'), { count: selectedSections.length })

  const setCompletePackage = () => onSections([...shareSections])
  const setCustomPackage = () => {
    if (!completePackageSelected) return
    onSections(['overview', 'materials', 'tasks', 'timeline'])
  }
  const toggleSection = (section: ShareSection) => {
    const selected = new Set(normalizedSections)
    if (selected.has(section)) {
      selected.delete(section)
    } else {
      selected.add(section)
    }
    const next = shareSections.filter((item) => selected.has(item))
    onSections(next.length > 0 ? next : ['overview'])
  }

  return (
    <ModalPortal>
      <div className={`dialog-layer${exiting ? ' exiting' : ''}`} onClick={(event) => {
      if (event.target === event.currentTarget) requestClose()
    }}>
      <section
        ref={dialogRef}
        className="new-dialog share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={format(tx('share.title'), { name: application.school.name })}
      >
        {/* Header */}
        <div className="share-dialog-head">
          <div>
            <span className="eyebrow">{tx('share.eyebrow')}</span>
            <h2>{format(tx('share.title'), { name: application.school.name })}</h2>
          </div>
          <button type="button" className="icon-action" onClick={() => requestClose()} aria-label={tx('close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Active links */}
        <div className="share-section">
          <div className="share-section-label">
            <Link2 size={13} aria-hidden="true" />
            <span>{tx('share.activeLinks')}</span>
            {shares.length > 0 && <span className="share-count-badge">{shares.length}</span>}
            <span className="share-quota-note">{format(tx('settings.shareCount'), { count: totalActiveShares, limit: resolvedShareQuota })}</span>
          </div>

          {shares.length === 0 ? (
            <p className="share-empty">{tx('share.noLinks')}</p>
          ) : (
            <>
              <div className="share-link-table-wrap atlas-table-shell" onContextMenu={openShareTableMenu}>
                <table className="share-link-table atlas-table">
                  <TableColGroup columns={shareTableColumns} api={shareTableApi} />
                  <thead>
                    <tr>
                      <TableHeaderCell column={shareCol.link} api={shareTableApi}>{tx('share.table.link')}</TableHeaderCell>
                      <TableHeaderCell column={shareCol.created} api={shareTableApi}>{tx('share.table.created')}</TableHeaderCell>
                      <TableHeaderCell column={shareCol.expires} api={shareTableApi}>{tx('share.table.expires')}</TableHeaderCell>
                      <TableHeaderCell column={shareCol.permission} api={shareTableApi}>{tx('share.table.permission')}</TableHeaderCell>
                      <TableHeaderCell column={shareCol.scope} api={shareTableApi}>{tx('share.table.scope')}</TableHeaderCell>
                      <TableHeaderCell column={shareCol.actions} api={shareTableApi}>{tx('share.table.actions')}</TableHeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedShares.map((share) => {
                      const url = shareUrl(share.token)
                      const path = sharePath(share.token)
                      const expiresAt = formatShareDate(share.expiresAt, lang)
                      const permission = normalizeSharePermission(share.permission)
                      const linkSections = normalizeShareSections(share.sections)
                      return (
                        <tr key={share.id}>
                          <TableCell columnId="link" api={shareTableApi} dataLabel={tx('share.table.link')}>
                            <OverflowReveal
                              as="code"
                              className="share-link-path"
                              text={path}
                              copyValue={url}
                              label={tx('share.linkLabel')}
                              onCopyResult={notifyCopyResult}
                            />
                          </TableCell>
                          <TableCell columnId="created" api={shareTableApi} dataLabel={tx('share.table.created')}>
                            {formatShareTimestamp(share.createdAt, lang)}
                          </TableCell>
                          <TableCell columnId="expires" api={shareTableApi} dataLabel={tx('share.table.expires')}>
                            <span className="share-link-expiry">
                              <Clock size={11} aria-hidden="true" />
                              {expiresAt ?? tx('share.neverExpires')}
                            </span>
                          </TableCell>
                          <TableCell columnId="permission" api={shareTableApi} dataLabel={tx('share.table.permission')}>
                            <div className="share-link-permission-select">
                              <Select
                                size="small"
                                value={permission}
                                options={sharePermissionOptions.map((option) => ({
                                  value: option.value,
                                  label: tx(option.labelKey, option.fallback),
                                }))}
                                onChange={(value) => onUpdateShare?.(share.id, share.expiresAt, value, linkSections)}
                              />
                            </div>
                          </TableCell>
                          <TableCell columnId="scope" api={shareTableApi} dataLabel={tx('share.table.scope')}>
                            <span className="share-scope-chip">{scopeLabel(linkSections)}</span>
                            <span className="share-scope-list">
                              {linkSections.map((section) => sectionLabel(section)).join(', ')}
                            </span>
                          </TableCell>
                          <TableCell columnId="actions" api={shareTableApi} dataLabel={tx('share.table.actions')}>
                            <div className="share-link-actions">
                              <CopyButton value={url} label={tx('share.linkLabel')} />
                              <button
                                type="button"
                                className="icon-action share-link-revoke"
                                onClick={() => setConfirmRevokeShareId(share.id)}
                                aria-label={tx('share.revoke')}
                                title={tx('share.revoke')}
                              >
                                <Trash2 size={13} aria-hidden="true" />
                              </button>
                            </div>
                          </TableCell>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {shareTableMenuNode}
              </div>
              {sharePageCount > 1 && (
                <div className="settings-pagination share-dialog-pagination">
                  <span className="settings-pagination-info">
                    {format(tx('pagination.showing'), {
                      from: sharePage * SHARE_DIALOG_PAGE_SIZE + 1,
                      to: Math.min((sharePage + 1) * SHARE_DIALOG_PAGE_SIZE, shares.length),
                      total: shares.length,
                    })}
                  </span>
                  <div className="settings-pagination-controls">
                    <button type="button" onClick={() => setSharePage((page) => Math.max(0, page - 1))} disabled={sharePage === 0}>
                      {tx('pagination.previous')}
                    </button>
                    <span className="settings-pagination-current">{format(tx('pagination.page'), { page: sharePage + 1, pages: sharePageCount })}</span>
                    <button type="button" onClick={() => setSharePage((page) => Math.min(sharePageCount - 1, page + 1))} disabled={sharePage >= sharePageCount - 1}>
                      {tx('pagination.next')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Create new */}
        <div className="share-section share-section-create">
          <div className="share-section-label">
            <Plus size={13} aria-hidden="true" />
            <span>{tx('share.createNew')}</span>
          </div>

          <div
            className={`share-package-toggle ${completePackageSelected ? 'is-complete' : 'is-custom'}`}
            role="tablist"
            aria-label={tx('share.packageMode')}
          >
            <span className="share-package-slider" aria-hidden="true" />
            <button
              type="button"
              className={completePackageSelected ? 'active' : ''}
              role="tab"
              aria-selected={completePackageSelected}
              onClick={setCompletePackage}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>{tx('share.completePackage')}</span>
              <small>{tx('share.completePackageDesc')}</small>
            </button>
            <button
              type="button"
              className={!completePackageSelected ? 'active' : ''}
              role="tab"
              aria-selected={!completePackageSelected}
              onClick={setCustomPackage}
            >
              <ListChecks size={14} aria-hidden="true" />
              <span>{tx('share.customPackage')}</span>
              <small>{tx('share.customPackageDesc')}</small>
            </button>
          </div>

          <div className="share-package-detail-stack">
            <div className={`share-complete-summary-shell ${completePackageSelected ? 'open' : ''}`}>
              <div className="share-complete-summary">
                <span>{tx('share.completeIncludes')}</span>
                <div>
                  {shareSections.map((section) => (
                    <span key={section} className="share-section-mini-chip">{sectionLabel(section)}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className={`share-section-picker-shell ${!completePackageSelected ? 'open' : ''}`}>
              <div className="share-section-picker" aria-label={tx('share.sectionsTitle')}>
                {shareSectionOptions.map((option) => {
                  const SectionIcon = option.icon
                  const checked = normalizedSections.includes(option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`share-section-option ${checked ? 'selected' : ''}`}
                      onClick={() => toggleSection(option.value)}
                      aria-pressed={checked}
                    >
                      <span className="share-section-option-mark" aria-hidden="true">
                        {checked ? <Check size={12} /> : null}
                      </span>
                      <span className="share-section-option-icon">
                        <SectionIcon size={15} aria-hidden="true" />
                      </span>
                      <span className="share-section-option-copy">
                        <strong>{tx(option.labelKey, option.fallback)}</strong>
                        <small>{tx(option.descriptionKey, option.descriptionFallback)}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="share-create-row">
            <div className="share-expiry-select">
              <Select
                size="small"
                value={expiry}
                options={shareExpiryOptions.map((option) => ({
                  value: option.value,
                  label: tx(option.labelKey, option.fallback),
                }))}
                onChange={onExpiry}
              />
            </div>
            <div className="share-expiry-select">
              <Select
                size="small"
                value={permission}
                options={sharePermissionOptions.map((option) => ({
                  value: option.value,
                  label: tx(option.labelKey, option.fallback),
                }))}
                onChange={onPermission}
              />
            </div>
            <button
              type="button"
              className="primary-action"
              onClick={onCreate}
              disabled={atShareLimit}
            >
              <Plus size={14} aria-hidden="true" /> {tx('share.create')}
            </button>
          </div>

          <p className="share-hint">
            {atShareLimit
              ? format(tx('share.limitReached'), { limit: resolvedShareQuota })
              : tx('share.previewHint')}
          </p>
        </div>
      </section>
      <ConfirmDialog
        open={confirmRevokeShareId !== null}
        title={tx('share.revoke')}
        message={tx('share.revokeConfirmMessage', 'Are you sure you want to revoke this share link? Anyone with the link will lose access immediately.')}
        confirmLabel={tx('share.revoke')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={() => {
          if (confirmRevokeShareId !== null) {
            onRevoke(confirmRevokeShareId)
            setConfirmRevokeShareId(null)
          }
        }}
        onCancel={() => setConfirmRevokeShareId(null)}
      />
      </div>
    </ModalPortal>
  )
}
