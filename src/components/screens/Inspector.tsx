import {
  ArchiveRestore, BookOpen, Calendar, ClipboardList,
  DatabaseBackup, Download, ExternalLink, Globe2, GraduationCap,
  Eye, EyeOff, Lock, Mail, MapPin, Pencil, Trash2, User,
} from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { BackupRecord } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import { StatusPill } from '../shared/StatusPill'
import { ProgressRing } from '../shared/ProgressRing'
import { CopyButton } from '../shared/CopyButton'
import { DatePicker } from '../shared/DatePicker'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { InlinePresence } from '../shared/InlinePresence'
import { AsyncActionButton } from '../shared/AsyncActionButton'
import { formatDate, daysUntil, deadlineUrgency } from '../../appModel'
import { localeForLanguage, localizeStaticText } from '../../i18n'
import { safeExternalHttpUrl } from '../../safeLinks'
import { useI18n } from '../hooks/useI18n'

const INSPECTOR_DEADLINE_BATCH_SIZE = 12

type InspectorDeadline = {
  id: string
  label: string
  date: string
  editable?: boolean
  editField?: string
}

function isDateString(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function formatBackupTimestamp(value: string, locale: string) {
  const createdAt = new Date(value)
  return {
    date: createdAt.toLocaleDateString(locale),
    time: createdAt.toLocaleTimeString(locale),
  }
}

type InspectorProps = {
  application: ApplicationRecord | null
  backups: BackupRecord[]
  busy?: boolean
  isPro: boolean
  onCopy: (value: string, label: string, options?: { skipClipboard?: boolean }) => void
  onEditField: (field: string, value: string) => void
  onExport: (format: 'json' | 'csv' | 'excel' | 'pdf') => Promise<void> | void
  onBackup: () => Promise<void> | void
  onUpgrade: () => void
  onRestore: (fileName: string) => void
  onDeleteBackup: (fileName: string) => void
  /** Backup names retained briefly while their confirmed delete animation runs. */
  removingBackupFileNames?: ReadonlySet<string>
  style?: CSSProperties
  collapsed?: boolean
  resizeHandle?: ReactNode
  showPastDeadlines?: boolean
  onShowPastDeadlinesChange?: (show: boolean) => void
  aiActive?: boolean
  // See ApplicationPane: a refreshed session must refresh action closures too.
  actionVersion?: string
  /** Hide field edits, export, and backup when true (shared / guest views). */
  readOnly?: boolean
  /** Optional version history shown as a compact inspector card. */
  versions?: ApplicationRecord['versions']
}

export function Inspector({
  application,
  backups,
  busy,
  isPro,
  onCopy,
  onEditField,
  onExport,
  onBackup,
  onUpgrade,
  onRestore,
  onDeleteBackup,
  removingBackupFileNames,
  style,
  collapsed = false,
  resizeHandle,
  showPastDeadlines = false,
  onShowPastDeadlinesChange,
  aiActive = false,
  readOnly = false,
  versions,
}: InspectorProps) {
  const { tx, format, lang } = useI18n()
  const locale = localeForLanguage(lang)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [visibleDeadlineCount, setVisibleDeadlineCount] = useState(INSPECTOR_DEADLINE_BATCH_SIZE)
  const [pastDeadlinesOpen, setPastDeadlinesOpen] = useState(Boolean(showPastDeadlines))

  useEffect(() => {
    setVisibleDeadlineCount(INSPECTOR_DEADLINE_BATCH_SIZE)
    setEditingField(null)
    setEditValue('')
  }, [application?.id])

  // Smooth expand/collapse for “show expired” — must stay above any early return.
  // Keep the shell mounted while collapsed so the toggle always owns a real,
  // accessible region instead of pointing aria-controls at a missing element.
  useEffect(() => {
    if (!application || !showPastDeadlines) {
      setPastDeadlinesOpen(false)
      return undefined
    }
    setPastDeadlinesOpen(false)
    let frame2 = 0
    const frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => setPastDeadlinesOpen(true))
    })
    return () => {
      window.cancelAnimationFrame(frame1)
      window.cancelAnimationFrame(frame2)
    }
  }, [application, showPastDeadlines])

  const startEdit = (field: string, value: string) => {
    setEditingField(field)
    setEditValue(value)
  }

  const commitEdit = () => {
    if (!editingField) return
    onEditField(editingField, editValue)
    setEditingField(null)
    setEditValue('')
  }

  const renderEditableValue = (
    field: string,
    value: string,
    label: string,
    link = false,
  ) => {
    if (editingField === field) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={commitEdit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              setEditingField(null)
              setEditValue('')
            }
          }}
        />
      )
    }

    const displayValue = link ? value.replace(/^https?:\/\//, '') : value
    const copyLabel = format(tx('copy'), { label })
    const openLabel = format(tx('inspector.openLink'), { label })

    if (link) {
      const safeHref = safeExternalHttpUrl(value)
      if (!safeHref) return <span className="inspector-link-text">{displayValue}</span>
      return (
        <a
          className="inspector-link-text inspector-link-url"
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          title={openLabel}
          aria-label={openLabel}
        >
          {displayValue}
        </a>
      )
    }

    return (
      <button
        type="button"
        className="inspector-link-text"
        onClick={() => onCopy(value, label)}
        title={copyLabel}
        aria-label={copyLabel}
      >
        {displayValue}
      </button>
    )
  }

  const renderLinkActions = (field: string, value: string, label: string) => (
    <div className="inspector-link-actions">
      <CopyButton value={value} label={label} />
      {!readOnly ? (
        <button
          type="button"
          className="inspector-edit-btn"
          onClick={() => startEdit(field, value)}
          title={tx('inspector.repair')}
          aria-label={tx('inspector.repair')}
        >
          <Pencil size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )

  const relativeDate = (date: string) => {
    const due = daysUntil(date)
    if (due === 0) return tx('inspector.today')
    if (due > 0) return format(tx('inspector.daysLeft'), { count: due })
    return format(tx('inspector.daysPast'), { count: Math.abs(due) })
  }

  const deadlineTone = (date: string) => deadlineUrgency(daysUntil(date))

  if (!application) {
    return (
      <aside
        className={`inspector-pane${aiActive ? ' ai-inspector-active' : ''}`}
        aria-label={tx('inspector.title')}
        aria-hidden={collapsed || undefined}
        inert={collapsed ? true : undefined}
        style={style}
      >
        <div className="inspector-default-content" aria-hidden={aiActive || undefined} inert={aiActive ? true : undefined}>
          <div className="inspector-empty">
            <ClipboardList size={28} aria-hidden="true" style={{ opacity: 0.3 }} />
            <span className="eyebrow">{tx('inspector.title')}</span>
            <p className="muted">{tx('inspector.emptyHint')}</p>
          </div>
        </div>
        {resizeHandle}
        <div id="ai-inspector-host" className="ai-inspector-slot" aria-hidden={!aiActive || undefined} inert={!aiActive ? true : undefined} />
      </aside>
    )
  }

  const localize = (value: string) => localizeStaticText(value, lang)
  const applicationBackups = backups.filter((backup) => backup.applicationId === application.id)
  const canEditDeadlines = !readOnly
  const extraDeadlines: InspectorDeadline[] = [
    ...application.materials
      .filter((material) => material.reminderEnabled && isDateString(material.reminderDate))
      .map((material) => ({
        id: `material-${material.id}`,
        label: format(tx('inspector.materialReminder'), { name: localize(material.name) }),
        date: material.reminderDate ?? '',
        editable: canEditDeadlines,
        editField: `material:${material.id}:reminderDate`,
      })),
    ...application.tasks
      .filter((task) => !task.done && isDateString(task.due))
      .map((task) => ({
        id: `task-${task.id}`,
        label: format(tx('inspector.taskDue'), { name: localize(task.title) }),
        date: task.due,
        editable: canEditDeadlines,
        editField: `task:${task.id}:due`,
      })),
    ...application.scholarships
      .filter((scholarship) => isDateString(scholarship.endDate))
      .map((scholarship) => ({
        id: `scholarship-${scholarship.id}`,
        label: format(tx('inspector.scholarshipDeadline'), { name: localize(scholarship.name) }),
        date: scholarship.endDate,
        editable: canEditDeadlines,
        editField: `scholarship:${scholarship.id}:endDate`,
      })),
    ...application.scholarships.flatMap((scholarship) => [
      ...(scholarship.materials ?? [])
        .filter((material) => isDateString(material.due))
        .map((material) => ({
          id: `scholarship-material-${scholarship.id}-${material.id}`,
          label: format(tx('inspector.scholarshipMaterialDue'), { name: localize(material.name) }),
          date: material.due ?? '',
          editable: canEditDeadlines,
          editField: `scholarshipMaterial:${scholarship.id}:${material.id}:due`,
        })),
      ...(scholarship.tasks ?? [])
        .filter((task) => !task.done && isDateString(task.due))
        .map((task) => ({
          id: `scholarship-task-${scholarship.id}-${task.id}`,
          label: format(tx('inspector.scholarshipTaskDue'), { name: localize(task.title) }),
          date: task.due,
          editable: canEditDeadlines,
          editField: `scholarshipTask:${scholarship.id}:${task.id}:due`,
        })),
      ...(scholarship.timeline ?? [])
        .filter((event) => isDateString(event.date))
        .map((event) => ({
          id: `scholarship-event-${scholarship.id}-${event.id}`,
          label: format(tx('inspector.scholarshipEventDate'), { name: localize(event.title) }),
          date: event.date,
          editable: canEditDeadlines,
          editField: `scholarshipTimeline:${scholarship.id}:${event.id}:date`,
        })),
    ]),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const deadlineEntries: InspectorDeadline[] = [
    {
      id: 'application-deadline',
      label: tx('inspector.applicationDeadline'),
      date: application.deadline,
      editable: canEditDeadlines,
      editField: 'deadline',
    },
    ...extraDeadlines,
  ]
  // Only render when the parent opts in (e.g. shared pages with the versions section).
  const versionEntries = versions ?? []
  const activeDeadlineEntries = deadlineEntries.filter((entry) => deadlineTone(entry.date) !== 'past')
  // Most recently expired first — these sit at the top of the inspector list when revealed.
  const pastDeadlineEntries = deadlineEntries
    .filter((entry) => deadlineTone(entry.date) === 'past')
    .sort((a, b) => b.date.localeCompare(a.date))
  const pastDeadlineCount = pastDeadlineEntries.length
  const visibleDeadlineEntries = activeDeadlineEntries.slice(0, visibleDeadlineCount)
  const hasMoreDeadlines = visibleDeadlineEntries.length < activeDeadlineEntries.length

  const renderDeadlineEntry = (entry: InspectorDeadline, indexInGroup = 0) => {
    const tone = deadlineTone(entry.date)
    const isPast = tone === 'past'
    const displayDate = formatDate(entry.date, lang)
    const copyLabel = format(tx('copy'), { label: entry.label })
    const editField = entry.editField ?? (entry.editable ? 'deadline' : '')
    const isEditingDeadline = Boolean(editField) && editingField === editField
    return (
      <div
        key={entry.id}
        className={`inspector-deadline-row ${tone}${isEditingDeadline ? ' editing' : ''}`}
        style={isPast ? { ['--past-stagger' as string]: `${Math.min(indexInGroup, 8) * 28}ms` } : undefined}
      >
        <span className="inspector-deadline-marker" aria-hidden="true" />
        <button
          type="button"
          className="inspector-deadline-copy"
          onClick={() => onCopy(displayDate, entry.label)}
          title={copyLabel}
          aria-label={copyLabel}
        >
          <span className="inspector-deadline-label">{entry.label}</span>
          <span className="inspector-deadline-date-row">
            <Calendar size={13} aria-hidden="true" />
            <strong>{displayDate}</strong>
          </span>
          <em>{relativeDate(entry.date)}</em>
        </button>
        <div className="inspector-deadline-actions">
          <CopyButton value={displayDate} label={entry.label} className="inspector-deadline-action" />
          {entry.editable && (
            <button
              type="button"
              className="inspector-edit-btn inspector-deadline-edit"
              onClick={() => {
                if (isEditingDeadline) {
                  setEditingField(null)
                  setEditValue('')
                  return
                }
                startEdit(editField, entry.date)
              }}
              title={tx('inspector.edit')}
              aria-label={tx('inspector.edit')}
              aria-expanded={isEditingDeadline}
            >
              <Pencil size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        <CollapsiblePanel open={isEditingDeadline} className="inspector-deadline-editor">
          <DatePicker
            value={entry.date}
            onChange={(value) => {
              if (isDateString(value) && editField && value !== entry.date) {
                onEditField(editField, value)
              }
              setEditingField(null)
              setEditValue('')
            }}
            placeholder={tx('dossier.selectDeadline')}
          />
        </CollapsiblePanel>
      </div>
    )
  }

  return (
    <aside
      className={`inspector-pane${aiActive ? ' ai-inspector-active' : ''}`}
      aria-label={tx('inspector.title')}
      aria-hidden={collapsed || undefined}
      inert={collapsed ? true : undefined}
      style={style}
    >
      {resizeHandle}
      <div className="inspector-default-content" aria-hidden={aiActive || undefined} inert={aiActive ? true : undefined}>
      <div className="inspector-head">
        <span className="eyebrow">{tx('inspector.title')}</span>
        <StatusPill status={application.status} />
      </div>

      {/* Overview card — deadlines + read-only computed progress */}
      <div className="inspector-card inspector-overview-card">
        {/* Deadlines — application deadline first, then additional dates by urgency */}
        <div className="inspector-overview-deadlines">
          <div className="inspector-deadline-heading">
            <h4>{tx('inspector.deadline')}</h4>
            {pastDeadlineEntries.length > 0 ? (
              <button
                type="button"
                className={`inspector-past-deadlines-toggle${showPastDeadlines ? ' active' : ''}`}
                onClick={() => onShowPastDeadlinesChange?.(!showPastDeadlines)}
                aria-expanded={showPastDeadlines}
                aria-controls="inspector-past-deadlines"
                title={showPastDeadlines ? tx('inspector.hidePastDeadlines') : tx('inspector.showPastDeadlines')}
              >
                <InlinePresence present={showPastDeadlines} parentGap="4px">
                  <span className="inspector-past-toggle-label"><EyeOff size={13} aria-hidden="true" />{tx('inspector.hidePastDeadlines')}</span>
                </InlinePresence>
                <InlinePresence present={!showPastDeadlines} parentGap="4px">
                  <span className="inspector-past-toggle-label"><Eye size={13} aria-hidden="true" />{tx('inspector.showPastDeadlines')}</span>
                </InlinePresence>
                <em aria-hidden="true">{pastDeadlineEntries.length}</em>
              </button>
            ) : null}
          </div>
          <div className="inspector-deadline-list">
            {/* Expired deadlines expand at the top with a height/opacity shell animation. */}
            {pastDeadlineCount > 0 ? (
              <div
                id="inspector-past-deadlines"
                className={`inspector-past-deadlines-shell${pastDeadlinesOpen ? ' is-open' : ''}`}
                aria-label={tx('inspector.pastDeadlines')}
                aria-hidden={!showPastDeadlines || undefined}
                inert={!showPastDeadlines ? true : undefined}
              >
                <div className="inspector-past-deadlines-clip">
                  <div className="inspector-past-deadlines-inner">
                    <div className="inspector-past-deadlines-label">
                      <span>{tx('inspector.pastDeadlines')}</span>
                      <em>{pastDeadlineCount}</em>
                    </div>
                    {pastDeadlineEntries.map((entry, index) => renderDeadlineEntry(entry, index))}
                  </div>
                </div>
              </div>
            ) : null}
            {visibleDeadlineEntries.map((entry) => renderDeadlineEntry(entry))}
            <CollapsiblePanel open={hasMoreDeadlines} keepMounted className="inspector-deadline-more-collapse">
              <button
                type="button"
                className="inspector-deadline-more"
                onClick={() => setVisibleDeadlineCount((current) => Math.min(
                  activeDeadlineEntries.length,
                  current + INSPECTOR_DEADLINE_BATCH_SIZE,
                ))}
              >
                {tx('inspector.showMore')}
              </button>
            </CollapsiblePanel>
          </div>
        </div>

        {/* Progress */}
        <div className="inspector-progress-section">
          <ProgressRing
            progress={application.progress}
            label={tx('inspector.ready')}
            size={84}
            strokeWidth={6}
          />
        </div>
      </div>

      {/* Quick Links card */}
      <div className="inspector-card">
        <h4>{tx('inspector.quickLinks')}</h4>
        <div className="inspector-section">
          <div className="inspector-link-row">
            <User size={14} className="inspector-link-icon" aria-hidden="true" />
            {renderEditableValue('professor.english', application.professor.english, tx('inspector.copyProfessor'))}
            {renderLinkActions('professor.english', application.professor.english, tx('inspector.copyProfessor'))}
          </div>

          <div className="inspector-link-row">
            <Mail size={14} className="inspector-link-icon" aria-hidden="true" />
            {renderEditableValue('professor.email', application.professor.email, tx('inspector.copyEmail'))}
            {renderLinkActions('professor.email', application.professor.email, tx('inspector.copyEmail'))}
          </div>

          {application.professor.homepage && (
            <div className="inspector-link-row">
              <ExternalLink size={14} className="inspector-link-icon" aria-hidden="true" />
              {renderEditableValue('professor.homepage', application.professor.homepage, tx('inspector.professorHomepage'), true)}
              {renderLinkActions('professor.homepage', application.professor.homepage, tx('inspector.professorHomepage'))}
            </div>
          )}

          {application.school.website && (
            <div className="inspector-link-row">
              <Globe2 size={14} className="inspector-link-icon" aria-hidden="true" />
              {renderEditableValue('school.website', application.school.website, tx('inspector.schoolPortal'), true)}
              {renderLinkActions('school.website', application.school.website, tx('inspector.schoolPortal'))}
            </div>
          )}

          <div className="inspector-link-row">
            <GraduationCap size={14} className="inspector-link-icon" aria-hidden="true" />
            {renderEditableValue('school.name', application.school.name, tx('inspector.copySchool'))}
            {renderLinkActions('school.name', application.school.name, tx('inspector.copySchool'))}
          </div>

          <div className="inspector-link-row">
            <MapPin size={14} className="inspector-link-icon" aria-hidden="true" />
            {renderEditableValue('school.country', application.school.country, tx('inspector.copyCountry'))}
            {renderLinkActions('school.country', application.school.country, tx('inspector.copyCountry'))}
          </div>

          <div className="inspector-link-row">
            <BookOpen size={14} className="inspector-link-icon" aria-hidden="true" />
            {renderEditableValue('program', application.program, tx('inspector.copyProgram'))}
            {renderLinkActions('program', application.program, tx('inspector.copyProgram'))}
          </div>
        </div>
      </div>

      {versionEntries.length > 0 ? (
        <div className="inspector-card">
          <h4>{tx('inspector.versions', tx('share.sections.versions'))}</h4>
          <div className="inspector-version-list" role="list" aria-label={tx('inspector.versions', tx('share.sections.versions'))}>
            {versionEntries.slice(0, 12).map((version) => (
              <div key={version.id} className="inspector-version-row" role="listitem">
                <strong>{version.file}</strong>
                <span>{version.author}</span>
                <em>{formatBackupTimestamp(version.createdAt, locale).date}</em>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Export / Backup — owner workspace only */}
      {!readOnly ? (
        <>
          <div className="inspector-card">
            <h4>{tx('inspector.export')}</h4>
            <div className="export-grid">
              {(['json', 'csv', 'excel', 'pdf'] as const).map((fmt) => (
                <AsyncActionButton
                  key={fmt}
                  disabled={busy}
                  IdleIcon={Download}
                  idleLabel={fmt.toUpperCase()}
                  pendingLabel={format(tx('inspector.exporting'), { format: fmt.toUpperCase() })}
                  successLabel={format(tx('inspector.exportReady'), { format: fmt.toUpperCase() })}
                  errorLabel={tx('inspector.exportFailed')}
                  onAction={() => onExport(fmt)}
                />
              ))}
            </div>
          </div>

          <div className="inspector-card">
            <h4>{tx('inspector.backup')}</h4>
            <div className="inspector-section">
              {!isPro ? (
                <button type="button" className="full-line pro-locked-line" onClick={onUpgrade} aria-disabled="true">
                  <Lock size={14} aria-hidden="true" />
                  {tx('inspector.proBackup')}
                </button>
              ) : (
                <AsyncActionButton
                  className="full-line"
                  onAction={onBackup}
                  disabled={busy}
                  IdleIcon={DatabaseBackup}
                  iconSize={15}
                  idleLabel={tx('inspector.createBackup')}
                  pendingLabel={tx('inspector.creatingBackup')}
                  successLabel={tx('inspector.backupCreated')}
                  errorLabel={tx('inspector.backupFailed')}
                />
              )}
              {applicationBackups.length > 0 ? (
                <div className="backup-list-stack" role="list" aria-label={tx('inspector.backup')}>
                  {applicationBackups.map((backup) => {
                    const timestamp = formatBackupTimestamp(backup.createdAt, locale)
                    const isRemoving = Boolean(removingBackupFileNames?.has(backup.fileName))
                    return (
                      <div
                        key={backup.fileName}
                        className={`backup-item${isRemoving ? ' is-removing' : ''}`}
                        role="listitem"
                        aria-busy={isRemoving || undefined}
                      >
                        <time className="backup-item-time" dateTime={backup.createdAt}>
                          <span>{timestamp.date}</span>
                          <span>{timestamp.time}</span>
                        </time>
                        <div className="backup-item-actions">
                          <button
                            type="button"
                            onClick={() => onRestore(backup.fileName)}
                            disabled={isRemoving}
                            title={tx('inspector.restore')}
                            aria-label={tx('inspector.restore')}
                          >
                            <ArchiveRestore size={12} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="danger"
                            title={tx('inspector.deleteBackup')}
                            aria-label={tx('inspector.deleteBackup')}
                            onClick={() => onDeleteBackup(backup.fileName)}
                            disabled={isRemoving}
                          >
                            <Trash2 size={12} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: '12px', padding: '8px 0' }}>{tx('inspector.noAppBackups', tx('inspector.noBackups'))}</p>
              )}
            </div>
          </div>
        </>
      ) : null}
      </div>
      <div id="ai-inspector-host" className="ai-inspector-slot" aria-hidden={!aiActive || undefined} inert={!aiActive ? true : undefined} />
    </aside>
  )
}
