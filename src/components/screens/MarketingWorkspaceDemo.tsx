import {
  ArchiveRestore,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Award,
  Bell,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Compass,
  DatabaseBackup,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  GraduationCap,
  GripVertical,
  LayoutList,
  Mail,
  MapPin,
  MessageCircle,
  Paperclip,
  PenLine,
  Plus,
  Search,
  Send,
  Settings,
  StickyNote,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { daysUntil, deadlineUrgency } from '../../appModel'
import { applications as seedApplications, type ApplicationRecord } from '../../data/applications'
import { countryDisplayName } from '../../data/countries'
import { localeForLanguage, localizeStaticText } from '../../i18n'
import { statusCssSlug, statusLabel } from '../../statusLabels'
import { useI18n, useI18nValue } from '../hooks/useI18n'
import { AnimatedCheckmark } from '../shared/AnimatedCheckmark'
import { ProgressRing } from '../shared/ProgressRing'
import { SchoolLogoMark } from '../shared/SchoolLogo'
import { StatusPill } from '../shared/StatusPill'
import cambridgeLogoUrl from '../../../server/school-logo-catalog/assets/university-of-cambridge-e92e8268f8.png'
import ethLogoUrl from '../../../server/school-logo-catalog/assets/eth-zurich-bdcc94a0fb.png'
import mitLogoUrl from '../../../server/school-logo-catalog/assets/massachusetts-institute-of-technology-18dd08a7f9.png'
import stanfordLogoUrl from '../../../server/school-logo-catalog/assets/stanford-university-27faf32e46.png'

export type MarketingWorkspaceTab = 'dossier' | 'materials' | 'mail' | 'funding' | 'timeline'
export type MarketingProFeature = 'capacity' | 'backup' | 'recovery' | 'storage'
type PreviewCommunication = ApplicationRecord['communications'][number]
type PreviewScholarshipStatus = NonNullable<ApplicationRecord['scholarships'][number]['status']>
type PreviewCorrespondenceMode = 'draft-email' | 'record-email' | 'record-message' | 'note'
type PreviewSortField = 'deadline' | 'name' | 'status' | 'priority' | 'progress'
type PreviewSortDirection = 'asc' | 'desc'

const previewApplicationIds = [
  'stanford-hci-lee',
  'mit-robotics-kim',
  'eth-data-wang',
  'cambridge-nlp-chen',
]

const previewSchoolLogos: Record<string, string> = {
  'stanford-hci-lee': stanfordLogoUrl,
  'mit-robotics-kim': mitLogoUrl,
  'eth-data-wang': ethLogoUrl,
  'cambridge-nlp-chen': cambridgeLogoUrl,
}

const previewApplications = previewApplicationIds
  .map((id) => seedApplications.find((application) => application.id === id))
  .filter((application): application is ApplicationRecord => Boolean(application))
  .map((application) => ({
    ...application,
    school: {
      ...application.school,
      logo: application.school.logo ?? {
        dataUrl: previewSchoolLogos[application.id],
        source: 'website' as const,
        sourceUrl: application.school.website,
        websiteUrl: application.school.website,
        candidateKind: 'marketing-preview',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    },
  }))

const filterOptions = ['all', 'Draft', 'Preparing', 'Submitted', 'Interview'] as const
type PreviewFilter = (typeof filterOptions)[number]
const sortOptions = [
  { field: 'deadline', labelKey: 'workspace.sortDeadline' },
  { field: 'name', labelKey: 'workspace.sortName' },
  { field: 'status', labelKey: 'workspace.sortStatus' },
  { field: 'priority', labelKey: 'workspace.sortPriority' },
  { field: 'progress', labelKey: 'workspace.sortProgress' },
] as const satisfies ReadonlyArray<{ field: PreviewSortField; labelKey: string }>

const storageUsage = { used: 64.8, total: 100 } as const
const storageBreakdown = [
  { type: 'PDF', size: 31.2 },
  { type: 'DOCX', size: 18.4 },
] as const
const attachmentStorageSize = 15.2
const previewBackupDate = '2026-07-27'
const previewFees: Record<string, { amount: number; currency: string }> = {
  'stanford-hci-lee': { amount: 125, currency: 'USD' },
  'mit-robotics-kim': { amount: 90, currency: 'USD' },
  'eth-data-wang': { amount: 150, currency: 'CHF' },
  'cambridge-nlp-chen': { amount: 80, currency: 'GBP' },
}
const fundingStages = ['Draft', 'Preparing', 'Submitted', 'Awarded'] as const satisfies readonly PreviewScholarshipStatus[]
const correspondenceModes = [
  { value: 'draft-email', labelKey: 'dossier.correspondenceModes.draftEmail', Icon: PenLine },
  { value: 'record-email', labelKey: 'dossier.correspondenceModes.recordEmail', Icon: Mail },
  { value: 'record-message', labelKey: 'dossier.correspondenceModes.recordMessage', Icon: MessageCircle },
  { value: 'note', labelKey: 'dossier.correspondenceModes.note', Icon: StickyNote },
] as const satisfies ReadonlyArray<{
  value: PreviewCorrespondenceMode
  labelKey: string
  Icon: typeof PenLine
}>

function compactSchoolName(name: string) {
  return name
    .replace('University of ', '')
    .replace(' University', '')
}

function statusTone(status: string) {
  return status.toLowerCase().replace(/\s+/g, '-')
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
  const { tx, format, lang } = useI18nValue(parentI18n.lang, ['core', 'shared', 'workspace', 'dossier', 'settings', 'upgrade'])
  const locale = localeForLanguage(lang)
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    [locale],
  )
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  )
  const fullDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    [locale],
  )
  const shortDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }),
    [locale],
  )
  const [selectedId, setSelectedId] = useState(
    previewApplications.find((application) => application.id === 'eth-data-wang')?.id
      ?? previewApplications[0]?.id
      ?? '',
  )
  const [internalTab, setInternalTab] = useState<MarketingWorkspaceTab>('materials')
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [query, setQuery] = useState('')
  const [sortField, setSortField] = useState<PreviewSortField>('deadline')
  const [sortDirection, setSortDirection] = useState<PreviewSortDirection>('asc')
  const [backups, setBackups] = useState(() => [
    { id: 'backup-1', date: previewBackupDate, time: '10:24', automatic: true },
    { id: 'backup-2', date: previewBackupDate, time: '10:19', automatic: true },
    { id: 'backup-3', date: previewBackupDate, time: '09:42', automatic: false },
  ])
  const [newBackupId, setNewBackupId] = useState<string | null>(null)
  const [restoredBackupId, setRestoredBackupId] = useState<string | null>(null)
  const [checkedRows, setCheckedRows] = useState<Record<string, boolean>>({})
  const [expandedChecklistRows, setExpandedChecklistRows] = useState<Record<string, boolean>>({})
  const [checklistQuery, setChecklistQuery] = useState('')
  const [sentMessages, setSentMessages] = useState<Record<string, PreviewCommunication[]>>({})
  const [messageDraft, setMessageDraft] = useState('')
  const [correspondenceMode, setCorrespondenceMode] = useState<PreviewCorrespondenceMode>('record-message')
  const [expandedScholarships, setExpandedScholarships] = useState<Record<string, string | null>>({})
  const [scholarshipStatuses, setScholarshipStatuses] = useState<Record<string, PreviewScholarshipStatus>>({})
  const [paidFees, setPaidFees] = useState<Record<string, boolean>>({
    'eth-data-wang': true,
  })
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
    const filtered = previewApplications.filter((application) => {
      if (filter !== 'all' && application.status !== filter) return false
      if (!normalizedQuery) return true
      return [
        application.school.name,
        application.program,
        localizeStaticText(application.program, lang),
        application.professor.english,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    })
    const direction = sortDirection === 'asc' ? 1 : -1
    return filtered.sort((left, right) => {
      switch (sortField) {
        case 'name':
          return left.school.name.localeCompare(right.school.name, locale, {
            numeric: true,
            sensitivity: 'base',
          }) * direction
        case 'status':
          return left.status.localeCompare(right.status, locale, { sensitivity: 'base' }) * direction
        case 'priority':
          return (left.priority - right.priority) * direction
        case 'progress':
          return (left.progress - right.progress) * direction
        case 'deadline':
        default:
          return left.deadline.localeCompare(right.deadline) * direction
      }
    })
  }, [filter, lang, locale, query, sortDirection, sortField])

  if (!selected) return null

  const localize = (value: string) => localizeStaticText(value, lang)
  const formatDate = (value: string, formatter = fullDateFormatter) => (
    formatter.format(new Date(`${value}T12:00:00`))
  )
  const formatPercent = (value: number) => percentFormatter.format(value / 100)
  const formatStorage = (value: number) => format(
    tx('upgrade.storageValue'),
    { size: numberFormatter.format(value) },
  )
  const selectedMessages = [
    ...selected.communications,
    ...(sentMessages[selected.id] ?? []),
  ]
  const normalizedChecklistQuery = checklistQuery.trim().toLocaleLowerCase(locale)
  const visibleMaterials = selected.materials.filter((material) => (
    !normalizedChecklistQuery
    || [material.name, material.type, material.status, material.version]
      .some((value) => localize(value).toLocaleLowerCase(locale).includes(normalizedChecklistQuery))
  ))
  const visibleTasks = selected.tasks.filter((task) => (
    !normalizedChecklistQuery
    || localize(task.title).toLocaleLowerCase(locale).includes(normalizedChecklistQuery)
  ))
  const checklistTotal = selected.materials.length + selected.tasks.length
  const checklistCompleted = [
    ...selected.materials.map((material) => (
      checkedRows[`${selected.id}:material:${material.id}`] ?? material.status === 'Submitted'
    )),
    ...selected.tasks.map((task) => (
      checkedRows[`${selected.id}:task:${task.id}`] ?? task.done
    )),
  ].filter(Boolean).length
  const expandedScholarshipId = Object.prototype.hasOwnProperty.call(expandedScholarships, selected.id)
    ? expandedScholarships[selected.id]
    : selected.scholarships[0]?.id ?? null

  const formatPreviewDate = (value: string, detail: 'short' | 'term' = 'short') => (
    new Intl.DateTimeFormat(locale, detail === 'term'
      ? { month: 'short', year: 'numeric' }
      : { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`))
  )
  const formatRelativeDeadline = (value: string, compact = false) => {
    const due = daysUntil(value)
    if (!Number.isFinite(due)) return '—'
    if (due === 0) return tx(compact ? 'workspace.today' : 'inspector.today', 'Today')
    if (due > 0) {
      return format(
        tx(compact ? 'workspace.dayShort' : 'inspector.daysLeft', compact ? '{count}d' : '{count} days left'),
        { count: due },
      )
    }
    return format(
      tx(compact ? 'workspace.daysPast' : 'inspector.daysPast', compact ? '{count}d past' : '{count} days past'),
      { count: Math.abs(due) },
    )
  }
  const previewFee = previewFees[selected.id] ?? { amount: 0, currency: 'USD' }
  const formatFee = (amount: number) => new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: previewFee.currency,
    maximumFractionDigits: 0,
  }).format(amount)
  const feePaid = Boolean(paidFees[selected.id])
  const inspectorDeadlines = [
    {
      id: 'application',
      label: tx('inspector.applicationDeadline', 'Application deadline'),
      date: selected.deadline,
    },
    {
      id: 'reminder',
      label: tx('inspector.nextReminder', 'Next reminder'),
      date: selected.nextReminder,
    },
    ...selected.tasks
      .filter((task) => !task.done)
      .slice(0, 1)
      .map((task) => ({
        id: task.id,
        label: format(tx('inspector.taskDue', '{name} due'), { name: localize(task.title) }),
        date: task.due,
      })),
  ]

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

  const chooseSort = (nextField: PreviewSortField) => {
    if (nextField === sortField) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortField(nextField)
    setSortDirection(nextField === 'priority' || nextField === 'progress' ? 'desc' : 'asc')
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
        localizeStaticText(application.program, lang),
        application.professor.english,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    ))
    if (next) setSelectedId(next.id)
  }

  const toggleCheckedRow = (id: string, initial: boolean) => {
    setCheckedRows((current) => ({ ...current, [id]: !(current[id] ?? initial) }))
  }

  const toggleChecklistRow = (id: string) => {
    setExpandedChecklistRows((current) => ({ ...current, [id]: !current[id] }))
  }

  const sendPreviewMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const summary = messageDraft.trim()
    if (!summary) return
    const now = new Date()
    const messageType = correspondenceMode === 'draft-email'
      ? 'draft-email'
      : correspondenceMode === 'record-email'
        ? 'outgoing-email'
        : correspondenceMode === 'note'
          ? 'note'
          : 'outgoing-message'
    const message: PreviewCommunication = {
      id: `marketing-message-${now.getTime()}`,
      subject: tx(
        correspondenceModes.find((mode) => mode.value === correspondenceMode)?.labelKey
          ?? 'dossier.correspondenceModes.recordMessage',
        'Message',
      ),
      channel: correspondenceMode.includes('email') ? 'Email' : correspondenceMode === 'note' ? 'Note' : 'Message',
      date: now.toISOString().slice(0, 10),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now),
      summary,
      direction: correspondenceMode === 'note' ? 'note' : 'outgoing',
      messageType,
      from: tx('dossier.messageSenderMe', 'Me'),
      to: selected.professor.english,
      deliveryStatus: 'log-only',
    }
    setSentMessages((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] ?? []), message],
    }))
    setMessageDraft('')
  }

  const createBackup = () => {
    const id = `backup-${Date.now()}`
    setBackups((current) => [
      { id, date: previewBackupDate, time: '', automatic: false },
      ...current,
    ])
    setNewBackupId(id)
    setRestoredBackupId(null)
  }

  const restoreTrashItem = (item: { id: string; school: string }) => {
    setTrashItems((current) => current.filter((entry) => entry.id !== item.id))
    setRecoveryMessage(`${compactSchoolName(item.school)} · ${tx('toast.applicationRestored')}`)
  }

  const deadline = formatDate(selected.deadline)

  const tabs: Array<{ key: MarketingWorkspaceTab; label: string }> = [
    { key: 'dossier', label: tx('dossier.tabs.dossier', 'Dossier') },
    { key: 'materials', label: tx('dossier.tabs.materials', 'Checklist') },
    { key: 'mail', label: tx('dossier.tabs.mail', 'Correspondence') },
    { key: 'funding', label: tx('dossier.tabs.funding', 'Tuition / Scholarships') },
    { key: 'timeline', label: tx('dossier.tabs.timeline', 'Timeline') },
  ]

  return (
    <section
      className={`marketing-workspace-demo is-${mode} feature-${feature}${className ? ` ${className}` : ''}`}
      data-tab={resolvedTab}
      data-feature={feature}
      aria-label={tx('appDesc')}
    >
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
            <span>
              <em>{tx('workspace.eyebrow', 'Workspace')}</em>
              <strong>{tx('workspace.title', 'Applications')}</strong>
            </span>
          </div>
          <label className="mwd-search">
            <Search size={11} aria-hidden="true" />
            <span className="sr-only">{tx('search')}</span>
            <input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={tx('workspace.searchApplications', 'Search applications')}
            />
            <span className="mwd-search-shortcut" aria-hidden="true">⌘F</span>
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
          <div className="mwd-sort-list" aria-label={tx('workspace.sortBy', 'Sort by')}>
            {sortOptions.map(({ field, labelKey }) => {
              const active = sortField === field
              const DirectionIcon = active
                ? sortDirection === 'asc' ? ArrowUp : ArrowDown
                : ArrowDownUp
              return (
                <button
                  type="button"
                  className={active ? 'is-active' : ''}
                  aria-pressed={active}
                  key={field}
                  onClick={() => chooseSort(field)}
                >
                  <span>{tx(labelKey)}</span>
                  <DirectionIcon size={8} aria-hidden="true" />
                </button>
              )
            })}
          </div>
          <div className="mwd-list-count">
            <span>{format(tx('workspace.records', '{count} records'), { count: visibleApplications.length })}</span>
            <button type="button" aria-label={tx('shortcuts.newApplication', 'New application')}>
              <Plus size={9} aria-hidden="true" />
              <span>{tx('workspace.new', 'New')}</span>
            </button>
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
                <span className={`mwd-line-status tone-${statusTone(application.status)}`} aria-hidden="true" />
                <SchoolLogoMark
                  schoolName={application.school.name}
                  logo={application.school.logo}
                  variant="list"
                />
                <span className="mwd-application-copy">
                  <strong>{application.school.name}</strong>
                  <small>{localize(application.program)} · {application.professor.english}</small>
                </span>
                <span className="mwd-application-meta">
                  <StatusPill status={application.status} />
                  <b className={`is-${deadlineUrgency(daysUntil(application.deadline))}`}>
                    {formatRelativeDeadline(application.deadline, true)}
                  </b>
                </span>
              </button>
            )) : (
              <span className="mwd-no-results">{tx('workspace.noMatch', 'No matching applications')}</span>
            )}
          </div>
          {mode === 'pro' ? (
            <div className={`mwd-capacity-meter${feature === 'capacity' ? ' is-active' : ''}`}>
              <span><b>{numberFormatter.format(3)}</b><small>{tx('upgrade.freePlan', 'Free')}</small></span>
              <i><b /></i>
              <span><b>{numberFormatter.format(300)}</b><small>{tx('upgrade.proPlan', 'Pro')}</small></span>
            </div>
          ) : null}
        </aside>

        <section className="mwd-dossier" aria-label={tx('dossier.tabs.dossier', 'Dossier')}>
          <header className="mwd-dossier-head" key={selected.id}>
            <SchoolLogoMark
              schoolName={selected.school.name}
              logo={selected.school.logo}
              variant="header"
            />
            <span>
              <small>{localize(selected.program)}</small>
              <strong>{selected.school.name}</strong>
              <em>{selected.professor.english}</em>
            </span>
            <span className="mwd-dossier-actions">
              <button type="button" aria-label={tx('dossier.share', 'Share')}>
                <ExternalLink size={10} aria-hidden="true" />
              </button>
              <button type="button" aria-label={tx('explorer.applicationMenuHint', 'Application actions')}>•••</button>
            </span>
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

          <div className="mwd-tab-stage">
            <div className="mwd-tab-content" key={`${selected.id}-${resolvedTab}`}>
              {resolvedTab === 'dossier' ? (
                <div className="mwd-dossier-overview">
                  <div className="mwd-summary">
                    <span>
                      <small>{tx('dossier.deadline', 'Deadline')}</small>
                      <strong>{deadline}</strong>
                      <em>{formatRelativeDeadline(selected.deadline)}</em>
                    </span>
                    <span>
                      <small>{tx('dossier.status', 'Status')}</small>
                      <StatusPill status={selected.status} />
                    </span>
                    <span className="mwd-summary-priority">
                      <small>{tx('dossier.priority', 'Priority')}</small>
                      <i aria-hidden="true"><b style={{ width: `${selected.priority}%` }} /></i>
                      <strong>{numberFormatter.format(selected.priority)}</strong>
                    </span>
                    <span><small>{tx('dossier.progress', 'Progress')}</small><strong>{formatPercent(selected.progress)}</strong></span>
                  </div>
                  <div className="mwd-dossier-fields">
                    <section>
                      <header><GraduationCap size={13} /><strong>{tx('dossier.school', 'School')}</strong></header>
                      <span><small>{tx('dossier.schoolName', 'School name')}</small><b>{selected.school.name}</b></span>
                      <span><small>{tx('dossier.program', 'Program')}</small><b>{localize(selected.program)}</b></span>
                      <span><small>{tx('dossier.country', 'Country')}</small><b>{countryDisplayName(selected.school.country, lang)}</b></span>
                      <span><small>{tx('dossier.schoolWebsite', 'School website')}</small><b>{selected.school.website}</b></span>
                    </section>
                    <section>
                      <header><UserRound size={13} /><strong>{tx('dossier.professor', 'Professor')}</strong></header>
                      <span><small>{tx('dossier.professor', 'Professor')}</small><b>{selected.professor.english}</b></span>
                      <span><small>{tx('dossier.email', 'Email')}</small><b>{selected.professor.email}</b></span>
                      <span><small>{tx('dossier.phone', 'Phone')}</small><b>{selected.professor.phone}</b></span>
                      <span><small>{tx('dossier.homepage', 'Homepage')}</small><b>{selected.professor.homepage}</b></span>
                    </section>
                    <section>
                      <header><FileText size={13} /><strong>{tx('dossier.research', 'Research & Lab')}</strong></header>
                      <span className="is-textarea">
                        <small>{tx('dossier.researchDirection', 'Research direction')}</small>
                        <b>{localize(selected.professor.research)}</b>
                      </span>
                      <span className="is-textarea">
                        <small>{tx('dossier.labGroup', 'Lab')}</small>
                        <b>{localize(selected.professor.lab)}</b>
                      </span>
                    </section>
                    <section>
                      <header><Settings size={13} /><strong>{tx('dossier.config', 'Configuration')}</strong></header>
                      <span><small>{tx('dossier.deadline', 'Deadline')}</small><b>{deadline}</b></span>
                      <span><small>{tx('dossier.status', 'Status')}</small><b>{tx(`status.${selected.status}`, selected.status)}</b></span>
                      <span><small>{tx('dossier.priority', 'Priority')}</small><b>{numberFormatter.format(selected.priority)} / 100</b></span>
                      <div className="mwd-tag-list" aria-label={tx('dossier.tags', 'Tags')}>
                        {selected.tags.map((tag) => <em key={tag}>{localize(tag)}</em>)}
                      </div>
                    </section>
                    <section className="is-wide mwd-dossier-notes">
                      <header><MessageCircle size={13} /><strong>{tx('dossier.notes', 'Notes')}</strong></header>
                      <p>{localize(selected.result)}</p>
                      <footer>
                        <span><Bell size={10} />{tx('dossier.reminderDate', 'Reminder date')}</span>
                        <b>{formatDate(selected.nextReminder, shortDateFormatter)}</b>
                      </footer>
                    </section>
                  </div>
                </div>
              ) : resolvedTab === 'materials' ? (
                <div className="mwd-checklist">
                  <header className="mwd-feature-hero">
                    <span>
                      <em>{tx('dossier.checklistEyebrow', 'Materials checklist')}</em>
                      <strong>{tx('dossier.checklistTitle', 'Checklist')}</strong>
                      <small>{format(tx('dossier.checklistReminderHint', 'Reminders are queued for {email}.'), { email: selected.professor.email })}</small>
                    </span>
                    <div className="mwd-feature-hero-actions">
                      <span
                        className="mwd-mini-ring"
                        style={{
                          '--mwd-progress': `${checklistTotal ? (checklistCompleted / checklistTotal) * 360 : 0}deg`,
                        } as CSSProperties}
                      >
                        <b>{checklistCompleted}/{checklistTotal}</b>
                      </span>
                      <button type="button" aria-label={tx('dossier.addChecklistItem', 'Add item')}>
                        <Plus size={11} aria-hidden="true" />
                        <span>{tx('dossier.addChecklistItem', 'Add item')}</span>
                      </button>
                    </div>
                  </header>
                  <div className="mwd-checklist-tools">
                    <label>
                      <Search size={11} aria-hidden="true" />
                      <span className="sr-only">{tx('dossier.searchChecklistPlaceholder', 'Search materials, tasks, files…')}</span>
                      <input
                        value={checklistQuery}
                        onChange={(event) => setChecklistQuery(event.target.value)}
                        placeholder={tx('dossier.searchChecklistPlaceholder', 'Search materials, tasks, files…')}
                      />
                    </label>
                    <span><FileText size={10} />{tx('dossier.materialTools', 'Materials')}<b>{visibleMaterials.length}/{selected.materials.length}</b></span>
                    <span><ClipboardList size={10} />{tx('dossier.taskTools', 'Tasks')}<b>{visibleTasks.length}/{selected.tasks.length}</b></span>
                  </div>
                  <section className="mwd-checklist-group">
                    <header>
                      <strong>{tx('dossier.checklistGroups.core', 'Core materials')}</strong>
                      <span>{format(tx('dossier.itemCount', '{count} items'), { count: visibleMaterials.length })}</span>
                    </header>
                    <div className="mwd-checklist-list">
                    {visibleMaterials.map((material) => {
                      const rowId = `${selected.id}:material:${material.id}`
                      const isDone = checkedRows[rowId] ?? (material.status === 'Submitted')
                      const expanded = Boolean(expandedChecklistRows[rowId])
                      return (
                        <article className={`${isDone ? 'is-complete' : ''}${expanded ? ' is-expanded' : ''}`} key={material.id}>
                          <span className="mwd-checklist-drag" aria-hidden="true"><GripVertical size={11} /></span>
                          <button
                            type="button"
                            className="mwd-check-toggle"
                            aria-pressed={isDone}
                            aria-label={isDone ? tx('dossier.markIncomplete', 'Mark incomplete') : tx('dossier.markComplete', 'Mark complete')}
                            onClick={() => toggleCheckedRow(rowId, material.status === 'Submitted')}
                          >
                            <AnimatedCheckmark checked={isDone} variant="square" size={16} className="mwd-check" />
                          </button>
                          <button
                            type="button"
                            className="mwd-checklist-row-body"
                            aria-expanded={expanded}
                            onClick={() => toggleChecklistRow(rowId)}
                          >
                            <strong>{localize(material.name)}</strong>
                            <span>
                              <small>{localize(material.type)}</small>
                              <small>{material.version}</small>
                              <small><Paperclip size={8} />{tx('dossier.file', 'File')}</small>
                            </span>
                          </button>
                          <em className={`status-${statusCssSlug(isDone ? 'Submitted' : material.status)}`}>
                            {statusLabel(isDone ? 'Submitted' : material.status, tx)}
                          </em>
                          <button
                            type="button"
                            className="mwd-checklist-expand"
                            aria-expanded={expanded}
                            aria-label={expanded ? tx('dossier.collapse', 'Collapse') : tx('dossier.expand', 'Expand')}
                            onClick={() => toggleChecklistRow(rowId)}
                          >
                            <ChevronDown size={11} />
                          </button>
                          <div className="mwd-checklist-row-detail" aria-hidden={!expanded} inert={!expanded || undefined}>
                            <dl>
                              <div><dt>{tx('dossier.materialType', 'Material type')}</dt><dd>{localize(material.type)}</dd></div>
                              <div><dt>{tx('inspector.versions', 'Version')}</dt><dd>{material.version}</dd></div>
                              <div><dt>{tx('dossier.reminderDate', 'Reminder date')}</dt><dd>{formatDate(selected.nextReminder, shortDateFormatter)}</dd></div>
                            </dl>
                          </div>
                        </article>
                      )
                    })}
                    {visibleMaterials.length === 0 ? (
                      <p className="mwd-empty-row">{tx('dossier.noMatchingMaterials', 'No checklist items match these filters.')}</p>
                    ) : null}
                    </div>
                  </section>
                  <section className="mwd-checklist-group is-task-group">
                    <header>
                      <strong>{tx('dossier.taskChecklistTitle', 'Task checklist')}</strong>
                      <span>{format(tx('dossier.itemCount', '{count} items'), { count: visibleTasks.length })}</span>
                    </header>
                    <div className="mwd-checklist-list">
                    {visibleTasks.map((task) => {
                      const rowId = `${selected.id}:task:${task.id}`
                      const isDone = checkedRows[rowId] ?? task.done
                      const expanded = Boolean(expandedChecklistRows[rowId])
                      return (
                        <article className={`${isDone ? 'is-complete' : ''}${expanded ? ' is-expanded' : ''}`} key={task.id}>
                          <span className="mwd-checklist-drag" aria-hidden="true"><GripVertical size={11} /></span>
                          <button
                            type="button"
                            className="mwd-check-toggle"
                            aria-pressed={isDone}
                            aria-label={isDone ? tx('dossier.markIncomplete', 'Mark incomplete') : tx('dossier.markComplete', 'Mark complete')}
                            onClick={() => toggleCheckedRow(rowId, task.done)}
                          >
                            <AnimatedCheckmark checked={isDone} variant="square" size={16} className="mwd-check" />
                          </button>
                          <button
                            type="button"
                            className="mwd-checklist-row-body"
                            aria-expanded={expanded}
                            onClick={() => toggleChecklistRow(rowId)}
                          >
                            <strong>{localize(task.title)}</strong>
                            <span>
                              <small>{tx('dossier.tasks', 'Tasks')}</small>
                              <small>{formatDate(task.due, shortDateFormatter)}</small>
                              <small><Bell size={8} />{tx('dossier.reminder', 'Reminder')}</small>
                            </span>
                          </button>
                          <em className={isDone ? 'status-submitted' : 'status-draft'}>
                            {isDone ? tx('explorer.statusComplete', 'Completed') : tx('explorer.statusOpen', 'Open')}
                          </em>
                          <button
                            type="button"
                            className="mwd-checklist-expand"
                            aria-expanded={expanded}
                            aria-label={expanded ? tx('dossier.collapse', 'Collapse') : tx('dossier.expand', 'Expand')}
                            onClick={() => toggleChecklistRow(rowId)}
                          >
                            <ChevronDown size={11} />
                          </button>
                          <div className="mwd-checklist-row-detail" aria-hidden={!expanded} inert={!expanded || undefined}>
                            <dl>
                              <div><dt>{tx('dossier.dueDate', 'Due date')}</dt><dd>{formatDate(task.due)}</dd></div>
                              <div><dt>{tx('dossier.reminder', 'Reminder')}</dt><dd>{tx('dossier.reminder1d', '1 day before')}</dd></div>
                              <div><dt>{tx('dossier.status', 'Status')}</dt><dd>{isDone ? tx('explorer.statusComplete', 'Completed') : tx('explorer.statusOpen', 'Open')}</dd></div>
                            </dl>
                          </div>
                        </article>
                      )
                    })}
                    {visibleTasks.length === 0 ? (
                      <p className="mwd-empty-row">{tx('dossier.noMatchingTasks', 'No tasks match these filters.')}</p>
                    ) : null}
                    </div>
                  </section>
                </div>
              ) : resolvedTab === 'mail' ? (
                <div className="mwd-correspondence">
                  <header className="mwd-feature-hero">
                    <span>
                      <em>{tx('dossier.correspondenceEyebrow', 'Communication log')}</em>
                      <strong>{tx('dossier.tabs.mail', 'Correspondence')}</strong>
                      <small>{format(tx('dossier.correspondenceCountHint', '{count} records'), { count: selectedMessages.length })}</small>
                    </span>
                  </header>
                  <div className="mwd-correspondence-mailboxes">
                    <span><small>{tx('dossier.outboundMailbox', 'Sending mailbox')}</small><strong>{tx('dossier.messageSenderMe', 'Me')}</strong></span>
                    <i aria-hidden="true">→</i>
                    <span><small>{tx('dossier.inboundMailbox', 'Receiving mailbox')}</small><strong>{selected.professor.email}</strong></span>
                  </div>
                  <div className="mwd-correspondence-mode-bar" role="tablist" aria-label={tx('dossier.messageType', 'Message type')}>
                    {correspondenceModes.map(({ value, labelKey, Icon }) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={correspondenceMode === value}
                        className={correspondenceMode === value ? 'is-active' : ''}
                        key={value}
                        onClick={() => setCorrespondenceMode(value)}
                      >
                        <Icon size={10} aria-hidden="true" />
                        <span>{tx(labelKey)}</span>
                      </button>
                    ))}
                  </div>
                  <form className="mwd-message-composer" onSubmit={sendPreviewMessage}>
                    <span>
                      {correspondenceMode === 'draft-email' || correspondenceMode === 'record-email'
                        ? <Mail size={11} aria-hidden="true" />
                        : correspondenceMode === 'note'
                          ? <StickyNote size={11} aria-hidden="true" />
                          : <MessageCircle size={11} aria-hidden="true" />}
                      <small>{tx(correspondenceModes.find((mode) => mode.value === correspondenceMode)?.labelKey ?? '')}</small>
                    </span>
                    <input
                      value={messageDraft}
                      onChange={(event) => setMessageDraft(event.target.value)}
                      aria-label={tx('dossier.messageBodyPlaceholder', 'Write or paste the message content…')}
                      placeholder={tx(
                        correspondenceMode === 'note'
                          ? 'dossier.noteContentPlaceholder'
                          : correspondenceMode.includes('email')
                            ? 'dossier.recordEmailSummaryPlaceholder'
                            : 'dossier.messageSummaryPlaceholder',
                        'Write or paste the message content…',
                      )}
                    />
                    <button
                      type="submit"
                      disabled={!messageDraft.trim()}
                      aria-label={tx('dossier.sendComposer', 'Send')}
                    >
                      <Send size={11} aria-hidden="true" />
                      <span>{tx('dossier.sendComposer', 'Send')}</span>
                    </button>
                  </form>
                  <div className="mwd-correspondence-timeline" aria-live="polite">
                    {selectedMessages.map((message, index) => {
                      const direction = message.direction ?? (index % 2 === 0 ? 'incoming' : 'outgoing')
                      const outgoing = direction !== 'incoming'
                      const isNote = direction === 'note' || message.channel === 'Note'
                      const sender = outgoing
                        ? tx('dossier.messageSenderMe', 'Me')
                        : selected.professor.english
                      const typeLabel = isNote
                        ? tx('dossier.correspondenceTypes.note', 'Chat note')
                        : message.channel === 'Email'
                          ? tx(
                            outgoing ? 'dossier.correspondenceTypes.outgoingEmail' : 'dossier.correspondenceTypes.incomingEmail',
                            message.channel,
                          )
                          : tx(
                            outgoing ? 'dossier.correspondenceTypes.outgoingMessage' : 'dossier.correspondenceTypes.incomingMessage',
                            message.channel,
                          )
                      return (
                        <article className={`${outgoing ? 'is-outgoing' : 'is-incoming'}${isNote ? ' is-note' : ''}`} key={message.id}>
                          <span className="mwd-correspondence-rail" aria-hidden="true">
                            <i>{isNote ? <StickyNote size={9} /> : message.channel === 'Email' ? <Mail size={9} /> : <MessageCircle size={9} />}</i>
                            {index < selectedMessages.length - 1 ? <b /> : null}
                          </span>
                          <div className="mwd-correspondence-card">
                            <header>
                              <span><strong>{sender}</strong><em>{typeLabel}</em></span>
                              <time>{formatPreviewDate(message.date)}{message.time ? ` · ${message.time}` : ''}</time>
                            </header>
                            {!isNote ? (
                              <small>{message.from || sender} → {message.to || (outgoing ? selected.professor.email : tx('dossier.messageSenderMe', 'Me'))}</small>
                            ) : null}
                            <strong>{localize(message.subject)}</strong>
                            <p>{localize(message.summary)}</p>
                            {message.attachments?.length ? (
                              <span className="mwd-correspondence-attachment"><Paperclip size={8} />{message.attachments[0].fileName}</span>
                            ) : null}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              ) : resolvedTab === 'funding' ? (
                <div className="mwd-funding">
                  <header className="mwd-feature-hero">
                    <span>
                      <em>{tx('dossier.fundingEyebrow', 'Tuition / scholarship tracker')}</em>
                      <strong>{tx('dossier.tabs.funding', 'Tuition / Scholarships')}</strong>
                      <small>
                        {format(
                          tx('dossier.scholarshipCountHint', '{count} scholarships tracked with tuition and fee context.'),
                          { count: selected.scholarships.length },
                        )}
                      </small>
                    </span>
                    <b>{selected.scholarships.length}</b>
                  </header>
                  <section className="mwd-fee-panel">
                    <header>
                      <span>
                        <em>{tx('fees.sectionEyebrow', 'Track tuition, application, and testing costs')}</em>
                        <strong>{tx('fees.sectionTitle', 'Tuition / Application Fees')}</strong>
                      </span>
                      <button type="button" aria-label={tx('fees.addFee', 'Add fee')}>
                        <Plus size={9} aria-hidden="true" />
                      </button>
                    </header>
                    <div className="mwd-fee-summary">
                      <dl>
                        <div><dt>{tx('fees.totalFees', 'Total fees')}</dt><dd>{formatFee(previewFee.amount)}</dd></div>
                        <div><dt>{tx('fees.paid', 'Paid')}</dt><dd>{formatFee(feePaid ? previewFee.amount : 0)}</dd></div>
                        <div><dt>{tx('fees.remaining', 'Remaining')}</dt><dd>{formatFee(feePaid ? 0 : previewFee.amount)}</dd></div>
                      </dl>
                      <button
                        type="button"
                        className={feePaid ? 'is-paid' : ''}
                        aria-pressed={feePaid}
                        onClick={() => setPaidFees((current) => ({
                          ...current,
                          [selected.id]: !feePaid,
                        }))}
                      >
                        <Check size={9} aria-hidden="true" />
                        <span>{feePaid ? tx('fees.paid', 'Paid') : tx('fees.markPaid', 'Mark paid')}</span>
                      </button>
                    </div>
                  </section>
                  <div className="mwd-funding-list">
                    {selected.scholarships.length > 0 ? selected.scholarships.map((scholarship) => {
                      const statusKey = `${selected.id}:${scholarship.id}`
                      const status = scholarshipStatuses[statusKey]
                        ?? scholarship.status
                        ?? (selected.status === 'Submitted' ? 'Submitted' : 'Preparing')
                      const currentStage = Math.max(0, fundingStages.indexOf(status === 'Rejected' ? 'Draft' : status))
                      const isExpanded = expandedScholarshipId === scholarship.id
                      return (
                        <article className={isExpanded ? 'is-expanded' : ''} key={scholarship.id}>
                          <button
                            type="button"
                            className="mwd-funding-summary"
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedScholarships((current) => ({
                              ...current,
                              [selected.id]: isExpanded ? null : scholarship.id,
                            }))}
                          >
                            <span className="mwd-funding-award" aria-hidden="true"><Award size={12} /></span>
                            <span>
                              <strong>{localize(scholarship.name)}</strong>
                              <small>{localize(scholarship.issuer || scholarship.school || selected.school.name)}</small>
                            </span>
                            <em className={`status-${statusTone(status)}`}>
                              {tx(`dossier.scholarshipStatus.${status}`, status)}
                            </em>
                            <ChevronDown size={12} aria-hidden="true" />
                          </button>
                          <dl className="mwd-funding-card-meta">
                            <div><dt>{tx('dossier.scholarshipAmount', 'Amount')}</dt><dd>{localize(scholarship.amount || tx('dossier.scholarshipAmountTbd', 'Amount TBD'))}</dd></div>
                            <div><dt>{tx('dossier.scholarshipEnd', 'End date')}</dt><dd>{formatPreviewDate(scholarship.endDate, 'term')}</dd></div>
                            <div><dt>{tx('dossier.scholarshipMaterials', 'Materials')}</dt><dd>{numberFormatter.format(scholarship.materials?.length ?? 0)}</dd></div>
                            <div><dt>{tx('dossier.scholarshipTasks', 'Tasks')}</dt><dd>{numberFormatter.format(scholarship.tasks?.length ?? 0)}</dd></div>
                          </dl>
                          <div
                            className={`mwd-funding-detail${isExpanded ? ' is-open' : ''}`}
                            aria-hidden={!isExpanded}
                            inert={!isExpanded || undefined}
                          >
                            <div className="mwd-funding-detail-inner">
                              <p>{localize(scholarship.notes || tx('dossier.scholarshipNoNotes', 'No notes yet.'))}</p>
                              <span className="mwd-funding-term">
                                <small>{tx('dossier.scholarshipStart', 'Start date')}</small>
                                <b>{formatPreviewDate(scholarship.startDate, 'term')}</b>
                                <i aria-hidden="true">→</i>
                                <small>{tx('dossier.scholarshipEnd', 'End date')}</small>
                                <b>{formatPreviewDate(scholarship.endDate, 'term')}</b>
                              </span>
                              <div
                                className="mwd-funding-progress"
                                role="group"
                                aria-label={tx('dossier.fundingEyebrow', 'Tuition / scholarship tracker')}
                              >
                                <span className="mwd-funding-progress-line" aria-hidden="true">
                                  <i style={{ '--mwd-funding-step': currentStage } as CSSProperties} />
                                </span>
                                {fundingStages.map((stage, stageIndex) => (
                                  <button
                                    type="button"
                                    className={stageIndex <= currentStage ? 'is-reached' : ''}
                                    aria-pressed={stage === status}
                                    key={stage}
                                    onClick={() => setScholarshipStatuses((current) => ({
                                      ...current,
                                      [statusKey]: stage,
                                    }))}
                                  >
                                    <i aria-hidden="true">{stageIndex < currentStage ? <Check size={8} /> : null}</i>
                                    <span>{tx(`dossier.scholarshipStatus.${stage}`, stage)}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </article>
                      )
                    }) : (
                      <p className="mwd-funding-empty">{tx('dossier.noScholarshipsHint', 'No scholarships yet.')}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mwd-timeline-page">
                  <header className="mwd-feature-hero">
                    <span>
                      <em>{tx('dossier.timeline', 'Timeline')}</em>
                      <strong>{tx('dossier.tabs.timeline', 'Timeline')}</strong>
                      <small>{format(tx('dossier.eventCount', '{count} events'), { count: selected.timeline.length + selectedMessages.length + 1 })}</small>
                    </span>
                    <b>{selected.tasks.filter((task) => !task.done).length}</b>
                  </header>
                  <section className="mwd-timeline-tasks">
                    <header>
                      <strong>{format(tx('dossier.tasksHeading', 'Tasks ({count} open)'), { count: selected.tasks.filter((task) => !task.done).length })}</strong>
                      <span>{tx('dossier.taskChecklistTitle', 'Task checklist')}</span>
                    </header>
                    {selected.tasks.slice(0, 3).map((task) => {
                      const rowId = `${selected.id}:task:${task.id}`
                      const isDone = checkedRows[rowId] ?? task.done
                      return (
                        <article className={isDone ? 'is-complete' : ''} key={task.id}>
                          <button
                            type="button"
                            aria-pressed={isDone}
                            aria-label={isDone ? tx('dossier.markIncomplete', 'Mark incomplete') : tx('dossier.markComplete', 'Mark complete')}
                            onClick={() => toggleCheckedRow(rowId, task.done)}
                          >
                            <AnimatedCheckmark checked={isDone} variant="square" size={15} />
                          </button>
                          <span><strong>{localize(task.title)}</strong><small>{formatDate(task.due, shortDateFormatter)}</small></span>
                          <em>{isDone ? tx('explorer.statusComplete', 'Completed') : tx('explorer.statusOpen', 'Open')}</em>
                        </article>
                      )
                    })}
                  </section>
                  <div className="mwd-timeline">
                    {[
                      ...selected.timeline.map((item) => ({
                        id: item.id,
                        date: item.date,
                        title: item.title,
                        note: item.note,
                        source: tx('dossier.timelineSourceManual', 'Manual'),
                        kind: 'event',
                      })),
                      ...selectedMessages.slice(0, 2).map((item) => ({
                        id: item.id,
                        date: item.date,
                        title: item.subject,
                        note: item.summary,
                        source: tx('dossier.timelineSourceMail', 'Mail'),
                        kind: 'mail',
                      })),
                      {
                        id: 'deadline',
                        date: selected.deadline,
                        title: tx('inspector.applicationDeadline', 'Application deadline'),
                        note: format(tx('dossier.timelineDeadlineNote', '{school} application deadline'), { school: selected.school.name }),
                        source: tx('dossier.timelineSourceDossier', 'Dossier'),
                        kind: 'deadline',
                      },
                    ].sort((a, b) => b.date.localeCompare(a.date)).map((item) => (
                      <article className={`is-${item.kind}`} key={item.id}>
                        <time>{formatDate(item.date, shortDateFormatter)}</time>
                        <span aria-hidden="true">{item.kind === 'mail' ? <Mail size={9} /> : <CalendarDays size={9} />}</span>
                        <div>
                          <header><strong>{localize(item.title)}</strong><em>{item.source}</em></header>
                          <p>{localize(item.note)}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="mwd-inspector" aria-label={tx('inspector.title', 'Inspector')}>
          <header>
            <strong>{tx('inspector.title', 'Inspector')}</strong>
            <StatusPill status={selected.status} />
          </header>
          <section className="mwd-inspector-overview">
            <div className="mwd-inspector-deadlines">
              <header>
                <h4>{tx('inspector.deadline', 'Deadlines')}</h4>
                <span>{inspectorDeadlines.length}</span>
              </header>
              <div>
                {inspectorDeadlines.map((entry) => {
                  const tone = deadlineUrgency(daysUntil(entry.date))
                  return (
                    <button type="button" className={`is-${tone}`} key={entry.id}>
                      <i aria-hidden="true" />
                      <span>
                        <small>{entry.label}</small>
                        <strong><Calendar size={9} aria-hidden="true" />{formatDate(entry.date, shortDateFormatter)}</strong>
                        <em>{formatRelativeDeadline(entry.date)}</em>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="mwd-inspector-progress">
              <ProgressRing
                progress={selected.progress}
                label={tx('inspector.ready', 'ready')}
                size={68}
                strokeWidth={5}
              />
              <span>{tx('inspector.progress', 'Progress')}</span>
            </div>
          </section>

          {mode === 'workspace' || feature === 'capacity' ? (
            <>
              <section className="mwd-inspector-links">
                <h4>{tx('inspector.quickLinks', 'Quick links')}</h4>
                <button type="button">
                  <UserRound size={10} aria-hidden="true" />
                  <span><small>{tx('inspector.copyProfessor', 'Professor')}</small><b>{selected.professor.english}</b></span>
                </button>
                <button type="button">
                  <Mail size={10} aria-hidden="true" />
                  <span><small>{tx('inspector.copyEmail', 'Email')}</small><b>{selected.professor.email}</b></span>
                </button>
                <button type="button">
                  <Globe2 size={10} aria-hidden="true" />
                  <span><small>{tx('inspector.schoolPortal', 'School portal')}</small><b>{selected.school.website.replace(/^https?:\/\//, '')}</b></span>
                  <ExternalLink size={8} aria-hidden="true" />
                </button>
                <button type="button">
                  <GraduationCap size={10} aria-hidden="true" />
                  <span><small>{tx('inspector.copySchool', 'School')}</small><b>{selected.school.name}</b></span>
                </button>
                <button type="button">
                  <MapPin size={10} aria-hidden="true" />
                  <span><small>{tx('inspector.copyCountry', 'Country')}</small><b>{countryDisplayName(selected.school.country, lang)}</b></span>
                </button>
              </section>
              <section className="mwd-inspector-versions">
                <h4>{tx('inspector.versions', 'Version history')}</h4>
                {selected.versions.slice(0, 2).map((version) => (
                  <button type="button" key={version.id}>
                    <FileText size={10} aria-hidden="true" />
                    <span>
                      <b>{version.file}</b>
                      <small>
                        {version.author === 'You'
                          ? tx('dossier.messageSenderMe', 'Me')
                          : localize(version.author)}
                        {' · '}
                        {version.createdAt}
                      </small>
                    </span>
                  </button>
                ))}
              </section>
              <section className="mwd-inspector-management">
                <h4>{tx('inspector.export', 'Export')}</h4>
                <div>
                  <button type="button"><Download size={9} aria-hidden="true" />{tx('explorer.exportApplicationJson', 'Export JSON')}</button>
                  <button type="button"><Download size={9} aria-hidden="true" />{tx('settings.exportFormatPdf', 'Printable report')}</button>
                </div>
                {mode === 'workspace' ? (
                  <button type="button" className="mwd-pro-locked">
                    <DatabaseBackup size={11} />
                    <span>{tx('inspector.proBackup', 'Pro backup')}</span>
                  </button>
                ) : null}
              </section>
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
                    <time>
                      <b>{formatDate(backup.date, shortDateFormatter)}</b>
                      <small>{backup.time || tx('timePicker.now')}</small>
                    </time>
                    <em>{backup.automatic ? tx('upgrade.backupEvery1m', 'Every minute') : tx('upgrade.manualBackupBadge')}</em>
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
                <span><h4>{tx('upgrade.benefitSafetyTitle', 'Recycle bin')}</h4><small>{numberFormatter.format(trashItems.length)}</small></span>
              </div>
              {recoveryMessage ? <p className="mwd-recovery-message"><Check size={11} />{recoveryMessage}</p> : null}
              <div>
                {trashItems.length > 0 ? trashItems.map((item) => (
                  <article key={item.id}>
                    <span><strong>{compactSchoolName(item.school)}</strong><small>{localize(item.program)}</small></span>
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
                <span>
                  <h4>{tx('upgrade.benefitMemberTitle', 'File storage')}</h4>
                  <small>{formatStorage(storageUsage.used)} / {formatStorage(storageUsage.total)}</small>
                </span>
              </div>
              <i><b /></i>
              <dl>
                {storageBreakdown.map((item) => (
                  <div key={item.type}><dt>{item.type}</dt><dd>{formatStorage(item.size)}</dd></div>
                ))}
                <div><dt>{tx('dossier.attachment', 'Attachments')}</dt><dd>{formatStorage(attachmentStorageSize)}</dd></div>
              </dl>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  )
}
