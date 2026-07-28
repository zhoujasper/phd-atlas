import {
  ArchiveRestore,
  CalendarDays,
  Check,
  ClipboardList,
  Compass,
  DatabaseBackup,
  FileText,
  GraduationCap,
  LayoutList,
  Mail,
  MapPin,
  Plus,
  Search,
  Settings,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { applications as seedApplications, type ApplicationRecord } from '../../data/applications'
import { useI18n, useI18nValue } from '../hooks/useI18n'

export type MarketingWorkspaceTab = 'dossier' | 'materials' | 'timeline'
export type MarketingProFeature = 'capacity' | 'backup' | 'recovery' | 'storage'

const previewApplicationIds = [
  'stanford-hci-lee',
  'mit-robotics-kim',
  'eth-data-wang',
  'cambridge-nlp-chen',
]

const previewApplications = previewApplicationIds
  .map((id) => seedApplications.find((application) => application.id === id))
  .filter((application): application is ApplicationRecord => Boolean(application))

const filterOptions = ['all', 'Preparing', 'Submitted'] as const
type PreviewFilter = (typeof filterOptions)[number]

const storageUsageLabel = '64.8 MB / 100 MB'
const storageBreakdown = [
  { type: 'PDF', size: '31.2 MB' },
  { type: 'DOCX', size: '18.4 MB' },
] as const
const attachmentStorageSize = '15.2 MB'

function compactSchoolName(name: string) {
  return name
    .replace('University of ', '')
    .replace(' University', '')
}

function statusTone(status: string) {
  return status.toLowerCase().replace(/\s+/g, '-')
}

function schoolMark(name: string) {
  if (name === 'MIT') return 'MIT'
  if (name.includes('ETH')) return 'ETH'
  return name
    .split(/\s+/)
    .filter((part) => !['of', 'the'].includes(part.toLowerCase()))
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function MarketingWorkspaceDemo({
  activeTab,
  onTabChange,
  mode = 'workspace',
  feature = 'capacity',
  className = '',
}: {
  activeTab?: MarketingWorkspaceTab
  onTabChange?: (tab: MarketingWorkspaceTab) => void
  mode?: 'workspace' | 'pro'
  feature?: MarketingProFeature
  className?: string
}) {
  const parentI18n = useI18n()
  const { tx, lang } = useI18nValue(parentI18n.lang, ['core', 'shared', 'workspace', 'dossier', 'upgrade'])
  const [selectedId, setSelectedId] = useState(previewApplications[0]?.id ?? '')
  const [internalTab, setInternalTab] = useState<MarketingWorkspaceTab>('dossier')
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [query, setQuery] = useState('')
  const [backups, setBackups] = useState(() => [
    { id: 'backup-1', date: '27 Jul', time: '10:24', automatic: true },
    { id: 'backup-2', date: '27 Jul', time: '10:19', automatic: true },
    { id: 'backup-3', date: '27 Jul', time: '09:42', automatic: false },
  ])
  const [newBackupId, setNewBackupId] = useState<string | null>(null)
  const [restoredBackupId, setRestoredBackupId] = useState<string | null>(null)
  const [checkedRows, setCheckedRows] = useState<Record<string, boolean>>({})
  const [trashItems, setTrashItems] = useState(() => [
    { id: 'trash-1', school: 'University of Toronto', program: 'Computer Science PhD' },
    { id: 'trash-2', school: 'UCL', program: 'Robotics PhD' },
  ])
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const resolvedTab = activeTab ?? internalTab
  const selected = previewApplications.find((application) => application.id === selectedId)
    ?? previewApplications[0]

  const visibleApplications = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return previewApplications.filter((application) => {
      if (filter !== 'all' && application.status !== filter) return false
      if (!normalizedQuery) return true
      return [
        application.school.name,
        application.program,
        application.professor.english,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    })
  }, [filter, query])

  if (!selected) return null

  const setTab = (tab: MarketingWorkspaceTab) => {
    setInternalTab(tab)
    onTabChange?.(tab)
  }

  const chooseFilter = (nextFilter: PreviewFilter) => {
    setFilter(nextFilter)
    const next = previewApplications.find((application) => (
      nextFilter === 'all' || application.status === nextFilter
    ))
    if (next) setSelectedId(next.id)
  }

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery)
    const normalizedQuery = nextQuery.trim().toLowerCase()
    if (!normalizedQuery) return
    const next = previewApplications.find((application) => (
      (filter === 'all' || application.status === filter)
      && [
        application.school.name,
        application.program,
        application.professor.english,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    ))
    if (next) setSelectedId(next.id)
  }

  const toggleCheckedRow = (id: string, initial: boolean) => {
    setCheckedRows((current) => ({ ...current, [id]: !(current[id] ?? initial) }))
  }

  const createBackup = () => {
    const id = `backup-${Date.now()}`
    setBackups((current) => [
      { id, date: '27 Jul', time: 'Now', automatic: false },
      ...current,
    ])
    setNewBackupId(id)
    setRestoredBackupId(null)
  }

  const restoreTrashItem = (item: { id: string; school: string }) => {
    setTrashItems((current) => current.filter((entry) => entry.id !== item.id))
    setRecoveryMessage(`${compactSchoolName(item.school)} · ${tx('inspector.restore', 'Restored')}`)
  }

  const locale = lang === 'zh' ? 'zh-CN' : lang
  const deadline = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${selected.deadline}T00:00:00`))

  const tabs: Array<{ key: MarketingWorkspaceTab; label: string }> = [
    { key: 'dossier', label: tx('dossier.tabs.dossier', 'Dossier') },
    { key: 'materials', label: tx('dossier.tabs.materials', 'Checklist') },
    { key: 'timeline', label: tx('dossier.tabs.timeline', 'Timeline') },
  ]

  return (
    <section
      className={`marketing-workspace-demo is-${mode} feature-${feature}${className ? ` ${className}` : ''}`}
      data-tab={resolvedTab}
      data-feature={feature}
      aria-label={tx('appDesc')}
    >
      <header className="mwd-window-bar">
        <span className="mwd-window-dots" aria-hidden="true"><i /><i /><i /></span>
        <strong><GraduationCap size={12} aria-hidden="true" /> {tx('appTitle')}</strong>
        <span className="mwd-global-search" aria-hidden="true">
          <Search size={10} />
          <i />
        </span>
        <span className="mwd-window-actions" aria-hidden="true"><i /><i /><i /></span>
      </header>

      <div className="mwd-shell">
        <nav className="mwd-rail" aria-label={tx('primaryNavigation')}>
          <span className="mwd-rail-brand" aria-hidden="true"><GraduationCap size={14} /></span>
          {[
            { label: tx('nav.dashboard'), Icon: ClipboardList },
            { label: tx('nav.applications'), Icon: LayoutList, active: true },
            { label: tx('nav.discover'), Icon: Compass },
            { label: tx('nav.profile'), Icon: UserRound },
            { label: tx('nav.settings'), Icon: Settings },
          ].map(({ label, Icon, active }) => (
            <span className={active ? 'is-active' : ''} title={label} key={label}>
              <Icon size={13} aria-hidden="true" />
              <small>{label}</small>
            </span>
          ))}
        </nav>

        <aside className="mwd-applications" aria-label={tx('nav.applications')}>
          <div className="mwd-applications-head">
            <strong>{tx('nav.applications')}</strong>
            <button type="button" aria-label={tx('shortcuts.newApplication', 'New application')}>
              <Plus size={12} aria-hidden="true" />
            </button>
          </div>
          <label className="mwd-search">
            <Search size={11} aria-hidden="true" />
            <span className="sr-only">{tx('search')}</span>
            <input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={tx('workspace.searchApplications', 'Search applications')}
            />
          </label>
          <div className="mwd-filters" aria-label={tx('workspace.statusFilter', 'Status filter')}>
            {filterOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={filter === option ? 'is-active' : ''}
                aria-pressed={filter === option}
                onClick={() => chooseFilter(option)}
              >
                {option === 'all' ? tx('workspace.ownerFilterAll', 'All') : tx(`status.${option}`, option)}
              </button>
            ))}
          </div>
          <div className="mwd-application-list">
            <span
              className="mwd-selection-slider"
              style={{ '--mwd-selection-index': Math.max(0, visibleApplications.findIndex((item) => item.id === selected.id)) } as CSSProperties}
              hidden={visibleApplications.length === 0}
              aria-hidden="true"
            />
            {visibleApplications.length > 0 ? visibleApplications.map((application) => (
              <button
                type="button"
                className={selected.id === application.id ? 'is-selected' : ''}
                key={application.id}
                onClick={() => setSelectedId(application.id)}
              >
                <span className={`mwd-school-mark tone-${statusTone(application.status)}`}>
                  {schoolMark(application.school.name)}
                </span>
                <span className="mwd-application-copy">
                  <strong>{compactSchoolName(application.school.name)}</strong>
                  <small>{application.program}</small>
                  <i><b style={{ width: `${application.progress}%` }} /></i>
                </span>
                <span className="mwd-application-meta">
                  <em className={`tone-${statusTone(application.status)}`}>
                    {tx(`status.${application.status}`, application.status)}
                  </em>
                  <b>{application.progress}%</b>
                </span>
              </button>
            )) : (
              <span className="mwd-no-results">{tx('workspace.noMatch', 'No matching applications')}</span>
            )}
          </div>
          {mode === 'pro' ? (
            <div className={`mwd-capacity-meter${feature === 'capacity' ? ' is-active' : ''}`}>
              <span><b>3</b><small>{tx('upgrade.freePlan', 'Free')}</small></span>
              <i><b /></i>
              <span><b>300</b><small>{tx('upgrade.proPlan', 'Pro')}</small></span>
            </div>
          ) : null}
        </aside>

        <section className="mwd-dossier" aria-label={tx('dossier.tabs.dossier', 'Dossier')}>
          <header className="mwd-dossier-head" key={selected.id}>
            <span className={`mwd-school-mark large tone-${statusTone(selected.status)}`}>
              {schoolMark(selected.school.name)}
            </span>
            <span>
              <strong>{selected.school.name}</strong>
              <small>{selected.program}</small>
              <em>{selected.professor.english}</em>
            </span>
            <button type="button" aria-label={tx('explorer.applicationMenuHint', 'Application actions')}>•••</button>
          </header>
          <div className="mwd-tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={resolvedTab === tab.key}
                className={resolvedTab === tab.key ? 'is-active' : ''}
                onClick={() => setTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
            <span aria-hidden="true" />
          </div>
          <div className="mwd-summary">
            <span><small>{tx('dossier.deadline', 'Deadline')}</small><strong>{deadline}</strong></span>
            <span><small>{tx('dossier.status', 'Status')}</small><strong>{tx(`status.${selected.status}`, selected.status)}</strong></span>
            <span><small>{tx('dossier.priority', 'Priority')}</small><strong>{selected.priority}</strong></span>
            <span><small>{tx('dossier.progress', 'Progress')}</small><strong>{selected.progress}%</strong></span>
          </div>

          <div className="mwd-tab-stage">
            <div className="mwd-tab-content" key={`${selected.id}-${resolvedTab}`}>
              {resolvedTab === 'dossier' ? (
                <div className="mwd-dossier-fields">
                  <section>
                    <header><GraduationCap size={13} /><strong>{tx('dossier.school', 'School')}</strong></header>
                    <span><small>{tx('dossier.schoolName', 'School name')}</small><b>{selected.school.name}</b></span>
                    <span><small>{tx('dossier.program', 'Program')}</small><b>{selected.program}</b></span>
                  </section>
                  <section>
                    <header><UserRound size={13} /><strong>{tx('dossier.professor', 'Professor')}</strong></header>
                    <span><small>{tx('dossier.professor', 'Professor')}</small><b>{selected.professor.english}</b></span>
                    <span><small>{tx('dossier.labGroup', 'Lab')}</small><b>{selected.professor.lab}</b></span>
                  </section>
                  <section className="is-wide">
                    <header><FileText size={13} /><strong>{tx('dossier.researchDirection', 'Research direction')}</strong></header>
                    <p>{selected.professor.research}</p>
                  </section>
                </div>
              ) : resolvedTab === 'materials' ? (
                <div className="mwd-checklist">
                  <header>
                    <span className="mwd-mini-ring" style={{ '--mwd-progress': `${selected.progress * 3.6}deg` } as CSSProperties}>
                      <b>{selected.progress}</b>
                    </span>
                    <span>
                      <strong>{tx('dossier.checklistTitle', 'Application checklist')}</strong>
                      <small>{tx('dossier.checklistEyebrow', 'Materials checklist')}</small>
                    </span>
                  </header>
                  <div>
                    {selected.materials.map((material) => {
                      const rowId = `${selected.id}:${material.id}`
                      const isDone = checkedRows[rowId] ?? (material.status === 'Submitted')
                      return (
                      <button type="button" key={material.id} aria-pressed={isDone} onClick={() => toggleCheckedRow(rowId, material.status === 'Submitted')}>
                        <span className={`mwd-check ${isDone ? 'is-done' : ''}`}>
                          {isDone ? <Check size={10} /> : null}
                        </span>
                        <span><strong>{material.name}</strong><small>{material.type} · {material.version}</small></span>
                        <em>{isDone ? tx('status.Submitted', 'Submitted') : tx('status.Draft', 'Draft')}</em>
                      </button>
                    )})}
                    {selected.tasks.slice(0, 2).map((task) => {
                      const rowId = `${selected.id}:${task.id}`
                      const isDone = checkedRows[rowId] ?? task.done
                      return (
                      <button type="button" key={task.id} aria-pressed={isDone} onClick={() => toggleCheckedRow(rowId, task.done)}>
                        <span className={`mwd-check ${isDone ? 'is-done' : ''}`}>
                          {isDone ? <Check size={10} /> : null}
                        </span>
                        <span><strong>{task.title}</strong><small>{task.due}</small></span>
                        <em>{isDone ? tx('explorer.statusComplete', 'Completed') : tx('status.Draft', 'Open')}</em>
                      </button>
                    )})}
                  </div>
                </div>
              ) : (
                <div className="mwd-timeline">
                  {[
                    ...selected.timeline.map((item) => ({ id: item.id, date: item.date, title: item.title, kind: 'event' })),
                    ...selected.communications.slice(0, 2).map((item) => ({ id: item.id, date: item.date, title: item.subject, kind: 'mail' })),
                    { id: 'deadline', date: selected.deadline, title: tx('inspector.applicationDeadline', 'Application deadline'), kind: 'deadline' },
                  ].sort((a, b) => a.date.localeCompare(b.date)).map((item) => (
                    <article className={`is-${item.kind}`} key={item.id}>
                      <time>{new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(new Date(`${item.date}T00:00:00`))}</time>
                      <span aria-hidden="true">{item.kind === 'mail' ? <Mail size={10} /> : <CalendarDays size={10} />}</span>
                      <strong>{item.title}</strong>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="mwd-inspector" aria-label={tx('inspector.title', 'Inspector')}>
          <header><strong>{tx('inspector.title', 'Inspector')}</strong><em>{tx(`status.${selected.status}`, selected.status)}</em></header>
          <section className="mwd-inspector-overview">
            <span><small>{tx('inspector.deadline', 'Deadline')}</small><strong>{deadline}</strong></span>
            <span className="mwd-progress-ring" style={{ '--mwd-progress': `${selected.progress * 3.6}deg` } as CSSProperties}>
              <b>{selected.progress}%</b>
              <small>{tx('inspector.ready', 'ready')}</small>
            </span>
          </section>

          {mode === 'workspace' || feature === 'capacity' ? (
            <>
              <section className="mwd-inspector-links">
                <h4>{tx('inspector.quickLinks', 'Quick links')}</h4>
                <span><UserRound size={11} /><b>{selected.professor.english}</b></span>
                <span><Mail size={11} /><b>{selected.professor.email}</b></span>
                <span><MapPin size={11} /><b>{selected.school.country}</b></span>
              </section>
              <section className="mwd-inspector-versions">
                <h4>{tx('inspector.versions', 'Version history')}</h4>
                {selected.versions.slice(0, 2).map((version) => (
                  <span key={version.id}><b>{version.file}</b><small>{version.author}</small></span>
                ))}
              </section>
              {mode === 'workspace' ? (
                <button type="button" className="mwd-pro-locked">
                  <DatabaseBackup size={12} />
                  <span>{tx('inspector.proBackup', 'Pro backup')}</span>
                </button>
              ) : null}
            </>
          ) : null}

          {mode === 'pro' && feature === 'backup' ? (
            <section className="mwd-pro-feature mwd-backup-feature">
              <div className="mwd-feature-head">
                <span><h4>{tx('inspector.backup', 'Backup')}</h4><small>{tx('upgrade.backupEvery1m', 'Every minute')}</small></span>
                <button type="button" onClick={createBackup}><DatabaseBackup size={11} />{tx('inspector.createBackup', 'Create backup')}</button>
              </div>
              <div className="mwd-backup-list">
                {backups.length > 0 ? backups.map((backup) => (
                  <div
                    className={`${backup.id === newBackupId ? 'is-new' : ''}${backup.id === restoredBackupId ? ' is-restored' : ''}`}
                    key={backup.id}
                  >
                    <time><b>{backup.date}</b><small>{backup.time}</small></time>
                    <em>{backup.automatic ? tx('upgrade.backupEvery1m', 'Auto') : tx('upgrade.manualBackupLabel', 'Manual')}</em>
                    <button type="button" onClick={() => setRestoredBackupId(backup.id)} aria-label={tx('inspector.restore', 'Restore')}>
                      <ArchiveRestore size={11} />
                    </button>
                    <button type="button" onClick={() => setBackups((current) => current.filter((item) => item.id !== backup.id))} aria-label={tx('inspector.deleteBackup', 'Delete backup')}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                )) : (
                  <p className="mwd-recovery-empty">{tx('inspector.noBackups', 'No backups yet.')}</p>
                )}
              </div>
            </section>
          ) : null}

          {mode === 'pro' && feature === 'recovery' ? (
            <section className="mwd-pro-feature mwd-recovery-feature">
              <div className="mwd-feature-head">
                <span><h4>{tx('upgrade.benefitSafetyTitle', 'Recycle bin')}</h4><small>{trashItems.length}</small></span>
              </div>
              {recoveryMessage ? <p className="mwd-recovery-message"><Check size={11} />{recoveryMessage}</p> : null}
              <div>
                {trashItems.length > 0 ? trashItems.map((item) => (
                  <article key={item.id}>
                    <span><strong>{compactSchoolName(item.school)}</strong><small>{item.program}</small></span>
                    <button type="button" onClick={() => restoreTrashItem(item)}><ArchiveRestore size={11} />{tx('inspector.restore', 'Restore')}</button>
                  </article>
                )) : (
                  <p className="mwd-recovery-empty"><Check size={12} />{tx('trash.emptyState', 'No deleted applications.')}</p>
                )}
              </div>
            </section>
          ) : null}

          {mode === 'pro' && feature === 'storage' ? (
            <section className="mwd-pro-feature mwd-storage-feature">
              <div className="mwd-feature-head">
                <span><h4>{tx('upgrade.benefitMemberTitle', 'File storage')}</h4><small>{storageUsageLabel}</small></span>
              </div>
              <i><b /></i>
              <dl>
                {storageBreakdown.map((item) => (
                  <div key={item.type}><dt>{item.type}</dt><dd>{item.size}</dd></div>
                ))}
                <div><dt>{tx('dossier.attachment', 'Attachments')}</dt><dd>{attachmentStorageSize}</dd></div>
              </dl>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  )
}
