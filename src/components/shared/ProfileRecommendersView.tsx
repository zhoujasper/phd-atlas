import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react'
import type { ProfileRecommender, ProfileRecommenderDirectoryPage } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import { normalizeErrorMessage } from '../../errorMessages'
import { localeForLanguage } from '../../i18n'
import { useProfileRecommenderAggregation } from '../../profileRecommenderAggregation'
import {
  newProfileRecommenderId,
  normalizeRecommenderText,
  profileRecommendersShareIdentity,
  type ProfileRecommenderDirectoryEntry,
  type ProfileRecommenderProject,
  type ProfileRecommenderUse,
} from '../../profileRecommenders'
import { registerSafeReloadGuard } from '../../safeReload'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { ConfirmDialog } from './ConfirmDialog'
import { InfoTooltip } from './InfoTooltip'
import { ModalPortal } from './ModalPortal'
import { PendingLabel } from './PendingLabel'

export type ProfileRecommendersViewProps = {
  profiles: readonly ProfileRecommender[]
  applications: readonly ApplicationRecord[]
  profileTotal?: number
  profileNextCursor?: string | null
  onLoadProfilePage?: (cursor: string) => Promise<ProfileRecommenderDirectoryPage>
  /** Pass the signed-in owner id when the application array is not already owner-scoped. */
  ownerId?: string
  onChange: (nextProfiles: ProfileRecommender[]) => void | Promise<void>
  onOpenApplication?: (use: ProfileRecommenderUse) => void
  disabled?: boolean
}

type EditorRequest = {
  mode: 'add' | 'edit'
  profile: ProfileRecommender
}

type EditableProfileField = 'name' | 'email' | 'phone' | 'title' | 'institution' | 'relationship' | 'notes'

const DESKTOP_INITIAL_RECOMMENDER_COUNT = 20
const DESKTOP_RECOMMENDER_BATCH_SIZE = 20
const MOBILE_INITIAL_RECOMMENDER_COUNT = 10
const MOBILE_RECOMMENDER_BATCH_SIZE = 10

function useCompactRecommenderViewport() {
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 820px)').matches
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 820px)')
    const sync = () => setCompact(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])

  return compact
}

const blankProfileRecommender = (): ProfileRecommender => {
  const timestamp = new Date().toISOString()
  return {
    id: newProfileRecommenderId(),
    name: '',
    email: '',
    phone: '',
    title: '',
    institution: '',
    relationship: '',
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function recommenderInitials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('').toLocaleUpperCase()
  return `${Array.from(parts[0])[0] ?? ''}${Array.from(parts.at(-1) ?? '')[0] ?? ''}`.toLocaleUpperCase()
}

function safeDate(value: string): Date | null {
  if (!value.trim()) return null
  const normalized = value.trim()
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalized)
  const date = dateOnlyMatch ? new Date(`${normalized}T12:00:00Z`) : new Date(normalized)
  if (
    dateOnlyMatch &&
    (date.getUTCFullYear() !== Number(dateOnlyMatch[1]) ||
      date.getUTCMonth() !== Number(dateOnlyMatch[2]) - 1 ||
      date.getUTCDate() !== Number(dateOnlyMatch[3]))
  )
    return null
  return Number.isFinite(date.getTime()) ? date : null
}

function ProfileRecommenderEditorDialog({
  request,
  profiles,
  onSave,
  onClose,
}: {
  request: EditorRequest
  profiles: readonly ProfileRecommender[]
  onSave: (profile: ProfileRecommender, mode: EditorRequest['mode']) => void | Promise<void>
  onClose: () => void
}) {
  const { tx, lang } = useI18n()
  const [draft, setDraft] = useState<ProfileRecommender>(request.profile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const descriptionId = useId()
  const notesHintId = useId()
  const { exiting, requestClose } = useAnimatedClose(true, onClose, 150, request.profile.id)
  const dialogRef = useModalA11y<HTMLFormElement>({
    open: true,
    onClose: () => {
      if (!saving) requestClose(onClose)
    },
    initialFocusRef: nameRef,
  })

  useEffect(() => {
    setDraft(request.profile)
    setSaving(false)
    setError('')
  }, [request])

  const duplicate = useMemo(
    () => profiles.some((profile) => profile.id !== draft.id && profileRecommendersShareIdentity(profile, draft)),
    [draft, profiles],
  )

  const update = (field: EditableProfileField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setError('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || duplicate || !draft.name.trim()) return
    const timestamp = new Date().toISOString()
    const nextProfile: ProfileRecommender = {
      ...draft,
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone: draft.phone?.trim() ?? '',
      title: draft.title?.trim() ?? '',
      institution: draft.institution?.trim() ?? '',
      relationship: draft.relationship?.trim() ?? '',
      notes: draft.notes?.trim() ?? '',
      createdAt: draft.createdAt ?? timestamp,
      updatedAt: timestamp,
    }

    setSaving(true)
    setError('')
    try {
      await onSave(nextProfile, request.mode)
      requestClose(onClose)
    } catch (reason) {
      setError(normalizeErrorMessage(reason, lang, tx('apiErrors.REQUEST_FAILED')))
      setSaving(false)
    }
  }

  return (
    <ModalPortal>
      <div
        className={clsx('dialog-layer', 'profile-recommender-dialog-layer', exiting && 'exiting is-exiting')}
        onClick={(event) => {
          if (event.target === event.currentTarget && !saving) requestClose(onClose)
        }}
      >
        <form
          ref={dialogRef}
          className="new-dialog profile-recommender-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          aria-describedby={descriptionId}
          aria-busy={saving || undefined}
          onSubmit={submit}
        >
          <div className="dialog-head profile-recommender-dialog-head">
            <div>
              <span className="eyebrow">{tx('profile.recommenders.editorEyebrow')}</span>
              <h2 id={headingId}>
                {tx(
                  request.mode === 'add'
                    ? 'profile.recommenders.editorAddTitle'
                    : 'profile.recommenders.editorEditTitle',
                )}
              </h2>
              <p id={descriptionId}>{tx('profile.recommenders.editorDescription')}</p>
            </div>
            <button
              type="button"
              className="icon-action"
              aria-label={tx('profile.recommenders.closeEditor')}
              disabled={saving}
              onClick={() => requestClose(onClose)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="profile-recommender-form-scroll">
            <div className="profile-recommender-form-grid">
              <label className="profile-recommender-field">
                <span>{tx('profile.recommenders.nameLabel')}</span>
                <input
                  ref={nameRef}
                  value={draft.name}
                  required
                  maxLength={200}
                  autoComplete="name"
                  disabled={saving}
                  placeholder={tx('profile.recommenders.namePlaceholder')}
                  onChange={(event) => update('name', event.target.value)}
                />
              </label>
              <label className="profile-recommender-field">
                <span>{tx('profile.recommenders.emailLabel')}</span>
                <input
                  type="email"
                  value={draft.email}
                  maxLength={254}
                  autoComplete="email"
                  disabled={saving}
                  placeholder={tx('profile.recommenders.emailPlaceholder')}
                  onChange={(event) => update('email', event.target.value)}
                />
              </label>
              <label className="profile-recommender-field">
                <span>{tx('profile.recommenders.phoneLabel')}</span>
                <input
                  type="tel"
                  value={draft.phone ?? ''}
                  maxLength={80}
                  autoComplete="tel"
                  disabled={saving}
                  placeholder={tx('profile.recommenders.phonePlaceholder')}
                  onChange={(event) => update('phone', event.target.value)}
                />
              </label>
              <label className="profile-recommender-field">
                <span>{tx('profile.recommenders.titleLabel')}</span>
                <input
                  value={draft.title ?? ''}
                  maxLength={160}
                  autoComplete="organization-title"
                  disabled={saving}
                  placeholder={tx('profile.recommenders.titlePlaceholder')}
                  onChange={(event) => update('title', event.target.value)}
                />
              </label>
              <label className="profile-recommender-field profile-recommender-field-wide">
                <span>{tx('profile.recommenders.institutionLabel')}</span>
                <input
                  value={draft.institution ?? ''}
                  maxLength={240}
                  autoComplete="organization"
                  disabled={saving}
                  placeholder={tx('profile.recommenders.institutionPlaceholder')}
                  onChange={(event) => update('institution', event.target.value)}
                />
              </label>
              <label className="profile-recommender-field profile-recommender-field-wide">
                <span>{tx('profile.recommenders.relationshipLabel')}</span>
                <textarea
                  value={draft.relationship ?? ''}
                  rows={3}
                  maxLength={1000}
                  disabled={saving}
                  placeholder={tx('profile.recommenders.relationshipPlaceholder')}
                  onChange={(event) => update('relationship', event.target.value)}
                />
              </label>
              <label className="profile-recommender-field profile-recommender-field-wide profile-recommender-notes-field">
                <span>{tx('profile.recommenders.notesLabel')}</span>
                <textarea
                  value={draft.notes ?? ''}
                  rows={4}
                  maxLength={4000}
                  disabled={saving}
                  aria-describedby={notesHintId}
                  placeholder={tx('profile.recommenders.notesPlaceholder')}
                  onChange={(event) => update('notes', event.target.value)}
                />
                <small id={notesHintId}>{tx('profile.recommenders.notesHint')}</small>
              </label>
            </div>
          </div>

          <div className="profile-recommender-dialog-foot">
            <div className="profile-recommender-form-feedback" aria-live="polite">
              {duplicate ? <p role="alert">{tx('profile.recommenders.duplicate')}</p> : null}
              {error ? <p role="alert">{error}</p> : null}
            </div>
            <div className="profile-recommender-dialog-actions">
              <button
                type="button"
                className="quiet-action compact-action"
                disabled={saving}
                onClick={() => requestClose(onClose)}
              >
                {tx('cancel')}
              </button>
              <button
                type="submit"
                className="primary-action compact-action"
                disabled={saving || duplicate || !draft.name.trim()}
              >
                {saving ? <PendingLabel label={tx('profile.recommenders.saving')} /> : tx('profile.recommenders.save')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </ModalPortal>
  )
}

export function ProfileRecommendersView({
  profiles,
  applications,
  profileTotal,
  profileNextCursor,
  onLoadProfilePage,
  ownerId,
  onChange,
  onOpenApplication,
  disabled = false,
}: ProfileRecommendersViewProps) {
  const { tx, format, lang } = useI18n()
  const compactViewport = useCompactRecommenderViewport()
  const reloadGuardId = useId()
  const initialRowCount = compactViewport
    ? MOBILE_INITIAL_RECOMMENDER_COUNT
    : DESKTOP_INITIAL_RECOMMENDER_COUNT
  const rowBatchSize = compactViewport
    ? MOBILE_RECOMMENDER_BATCH_SIZE
    : DESKTOP_RECOMMENDER_BATCH_SIZE
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [hydratedDetailIds, setHydratedDetailIds] = useState<Set<string>>(() => new Set())
  const [visibleRowCount, setVisibleRowCount] = useState(initialRowCount)
  const [isAppendingRows, startAppendingRows] = useTransition()
  const [loadedProfiles, setLoadedProfiles] = useState<ProfileRecommender[]>(() => [...profiles])
  const [profilePageCursor, setProfilePageCursor] = useState<string | null>(profileNextCursor ?? null)
  const [profilePageLoading, setProfilePageLoading] = useState(false)
  const [editor, setEditor] = useState<EditorRequest | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProfileRecommender | null>(null)
  const [mutationError, setMutationError] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const loadMoreMarkerRef = useRef<HTMLDivElement>(null)
  const observerAppendFrameRef = useRef<number | null>(null)
  const searchId = useId()
  const headingId = useId()
  const aggregation = useProfileRecommenderAggregation(loadedProfiles, applications, ownerId)
  const normalizedQuery = normalizeRecommenderText(query)

  useEffect(() => {
    setLoadedProfiles([...profiles])
    setProfilePageCursor(profileNextCursor ?? null)
  }, [profileNextCursor, profiles])

  useEffect(() => registerSafeReloadGuard(`profile-recommender-editor:${reloadGuardId}`, {
    prepare: () => true,
    hasUnsavedChanges: () => editor !== null,
  }), [editor, reloadGuardId])

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(localeForLanguage(lang), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [lang],
  )

  const visibleEntries = useMemo(
    () =>
      aggregation.directory.filter(
        (entry) => !normalizedQuery || entry.searchText.includes(normalizedQuery),
      ),
    [aggregation.directory, normalizedQuery],
  )
  const renderedEntries = useMemo(
    () => visibleEntries.slice(0, visibleRowCount),
    [visibleEntries, visibleRowCount],
  )
  const directoryCount = profileTotal ?? aggregation.directory.length
  const hasAnyRows = directoryCount > 0
  const hasVisibleRows = visibleEntries.length > 0
  const hasMoreServerRows = Boolean(profilePageCursor && onLoadProfilePage)
  const hasMoreRows = visibleRowCount < visibleEntries.length || hasMoreServerRows
  const remainingRowCount = hasMoreServerRows
    ? rowBatchSize
    : Math.max(0, visibleEntries.length - visibleRowCount)

  useEffect(() => {
    setVisibleRowCount((current) => (
      Math.min(visibleEntries.length, Math.max(current, initialRowCount))
    ))
  }, [initialRowCount, visibleEntries.length])

  useEffect(() => {
    if (expandedId && !renderedEntries.some((entry) => entry.key === expandedId)) {
      setExpandedId(null)
    }
  }, [expandedId, renderedEntries])

  const loadMoreServerProfiles = useCallback(async () => {
    if (!profilePageCursor || !onLoadProfilePage || profilePageLoading) return
    setProfilePageLoading(true)
    try {
      const page = await onLoadProfilePage(profilePageCursor)
      setLoadedProfiles((current) => {
        const byId = new Map(current.map((profile) => [profile.id, profile]))
        for (const profile of page.items) byId.set(profile.id, profile)
        return [...byId.values()]
      })
      setProfilePageCursor(page.nextCursor)
      setVisibleRowCount((current) => Math.max(current + rowBatchSize, current + page.items.length))
    } finally {
      setProfilePageLoading(false)
    }
  }, [onLoadProfilePage, profilePageCursor, profilePageLoading, rowBatchSize])

  const loadMoreRows = useCallback(() => {
    if (!hasMoreRows || profilePageLoading) return
    if (hasMoreServerRows) {
      void loadMoreServerProfiles()
      return
    }
    if (observerAppendFrameRef.current !== null) {
      window.cancelAnimationFrame(observerAppendFrameRef.current)
      observerAppendFrameRef.current = null
    }
    startAppendingRows(() => {
      setVisibleRowCount((current) => Math.min(visibleEntries.length, current + rowBatchSize))
    })
  }, [
    hasMoreRows,
    hasMoreServerRows,
    loadMoreServerProfiles,
    profilePageLoading,
    rowBatchSize,
    visibleEntries.length,
  ])

  const scheduleObservedLoadMoreRows = useCallback(() => {
    if (!hasMoreRows || observerAppendFrameRef.current !== null) return
    observerAppendFrameRef.current = window.requestAnimationFrame(() => {
      observerAppendFrameRef.current = null
      loadMoreRows()
    })
  }, [hasMoreRows, loadMoreRows])

  useEffect(() => {
    const marker = loadMoreMarkerRef.current
    if (!marker || !hasMoreRows || typeof IntersectionObserver !== 'function') return
    const scrollRoot = compactViewport ? null : marker.closest('.simple-screen')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) scheduleObservedLoadMoreRows()
      },
      {
        root: scrollRoot,
        rootMargin: compactViewport ? '0px 0px 360px' : '0px 0px 520px',
        threshold: 0.01,
      },
    )
    observer.observe(marker)
    return () => {
      observer.disconnect()
      if (observerAppendFrameRef.current !== null) {
        window.cancelAnimationFrame(observerAppendFrameRef.current)
        observerAppendFrameRef.current = null
      }
    }
  }, [compactViewport, hasMoreRows, scheduleObservedLoadMoreRows])

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery)
    setExpandedId(null)
    setVisibleRowCount(initialRowCount)
  }

  const formatDeadline = (value: string) => {
    const date = safeDate(value)
    return date ? dateFormatter.format(date) : ''
  }

  const commit = async (nextProfiles: ProfileRecommender[]) => {
    setMutationError('')
    await onChange(nextProfiles)
  }

  const saveEditorProfile = async (profile: ProfileRecommender, mode: EditorRequest['mode']) => {
    const nextProfiles =
      mode === 'edit'
        ? loadedProfiles.map((item) => (item.id === profile.id ? profile : item))
        : [...loadedProfiles, profile]
    await commit(nextProfiles)
  }

  const deleteProfile = async (profile: ProfileRecommender) => {
    setMutationError('')
    try {
      await commit(loadedProfiles.filter((item) => item.id !== profile.id))
    } catch (reason) {
      setMutationError(normalizeErrorMessage(reason, lang, tx('apiErrors.REQUEST_FAILED')))
      throw reason
    }
  }

  const renderNextDeadline = (project: ProfileRecommenderProject | null) => {
    if (!project) return null
    const date = formatDeadline(project.deadline)
    if (!date) return null
    return (
      <span className="profile-recommender-next-deadline">
        <CalendarClock size={12} aria-hidden="true" />
        {format(tx('profile.recommenders.nextDeadline'), { date })}
      </span>
    )
  }

  const renderProjects = (entry: ProfileRecommenderDirectoryEntry) => (
    <div className="profile-recommender-uses">
      <span className="eyebrow">{tx('profile.recommenders.usageTitle')}</span>
      {entry.projects.length > 0 ? (
        <ul>
          {entry.projects.map((project) => {
            const deadline = formatDeadline(project.deadline)
            const applicationName =
              [project.schoolName, project.program].filter(Boolean).join(' · ') ||
              tx('profile.recommenders.applicationFallback')
            return (
              <li key={project.id}>
                <button
                  type="button"
                  className="profile-recommender-project-action"
                  aria-label={format(tx('profile.recommenders.openApplication'), { name: applicationName })}
                  disabled={!onOpenApplication}
                  onClick={() => onOpenApplication?.(project.primaryUse)}
                >
                  <span className="profile-recommender-use-identity">
                    <strong>
                      {project.schoolName || project.program || tx('profile.recommenders.applicationFallback')}
                    </strong>
                    {project.schoolName && project.program ? <span>{project.program}</span> : null}
                  </span>
                  <span className="profile-recommender-use-meta">
                    {project.materialName ? <span>{project.materialName}</span> : null}
                    <span className="profile-recommender-project-deadline">
                      <CalendarClock size={12} aria-hidden="true" />
                      {deadline ? (
                        <time dateTime={project.deadline}>
                          {format(tx('profile.recommenders.applicationDeadline'), { date: deadline })}
                        </time>
                      ) : (
                        tx('profile.recommenders.deadlineMissing')
                      )}
                    </span>
                  </span>
                  <ChevronRight className="profile-recommender-project-chevron" size={15} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="profile-recommender-no-uses">{tx('profile.recommenders.noUses')}</p>
      )}
    </div>
  )

  return (
    <section className="profile-recommenders-view" aria-labelledby={headingId}>
      <div className="profile-recommenders-hero">
        <div>
          <span className="eyebrow">{tx('profile.recommenders.eyebrow')}</span>
          <div className="profile-recommender-title-row">
            <h2 id={headingId}>{tx('profile.recommenders.title')}</h2>
            <InfoTooltip
              className="profile-recommender-info"
              content={tx('profile.recommenders.description')}
            />
          </div>
        </div>
        <button
          type="button"
          className="primary-action compact-action profile-recommender-add-action"
          disabled={disabled}
          onClick={() => setEditor({ mode: 'add', profile: blankProfileRecommender() })}
        >
          <Plus size={14} aria-hidden="true" />
          {tx('profile.recommenders.add')}
        </button>
      </div>

      <div className="profile-recommenders-toolbar">
        <label className="profile-recommender-search" htmlFor={searchId}>
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            id={searchId}
            type="search"
            value={query}
            aria-label={tx('profile.recommenders.searchLabel')}
            placeholder={tx('profile.recommenders.searchPlaceholder')}
            onChange={(event) => updateQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="profile-recommender-search-clear"
              aria-label={tx('profile.recommenders.clearSearch')}
              onClick={() => {
                updateQuery('')
                searchInputRef.current?.focus()
              }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <span className="profile-recommender-total" aria-live="polite">
          {format(tx('profile.recommenders.directoryCount'), {
            count: directoryCount,
          })}
        </span>
      </div>

      {mutationError ? (
        <p className="profile-recommender-mutation-error" role="alert">
          {mutationError}
        </p>
      ) : null}

      {hasVisibleRows ? (
        <div className="profile-recommenders-content">
          <ul className="profile-recommender-list profile-recommender-directory-list">
            {renderedEntries.map((entry) => {
              const displayName = entry.name || tx('profile.recommenders.unnamed')
              const primaryContact = entry.email || entry.phone || tx('profile.recommenders.contactMissing')
              const expanded = expandedId === entry.key
              const detailHydrated = hydratedDetailIds.has(entry.key)
              const detailId = `profile-recommender-detail-${encodeURIComponent(entry.key)}`
              return (
                <li
                  key={entry.key}
                  className={clsx(
                    'profile-recommender-row',
                    entry.source === 'profile' ? 'is-saved' : 'is-application',
                    expanded && 'is-expanded',
                  )}
                >
                  <button
                    type="button"
                    className="profile-recommender-row-summary"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    aria-label={format(tx('profile.recommenders.toggleDetails'), { name: displayName })}
                    onClick={() => {
                      if (!detailHydrated) {
                        setHydratedDetailIds((current) => {
                          if (current.has(entry.key)) return current
                          const next = new Set(current)
                          next.add(entry.key)
                          return next
                        })
                      }
                      setExpandedId(expanded ? null : entry.key)
                    }}
                  >
                    <span className="profile-recommender-avatar" aria-hidden="true">
                      {recommenderInitials(entry.name) || <UserRound size={16} />}
                    </span>
                    <span className="profile-recommender-identity">
                      <strong>{displayName}</strong>
                      <span>{primaryContact}</span>
                      {entry.title || entry.institution ? (
                        <span className="profile-recommender-affiliation">
                          {entry.title ? <span>{entry.title}</span> : null}
                          {entry.institution ? <span>{entry.institution}</span> : null}
                        </span>
                      ) : null}
                    </span>
                    <span className="profile-recommender-summary-meta">
                      <span className="profile-recommender-usage-count">
                        {format(tx('profile.recommenders.usageCount'), { count: entry.projectCount })}
                      </span>
                      {renderNextDeadline(entry.nextProject)}
                    </span>
                    <ChevronDown className="profile-recommender-chevron" size={15} aria-hidden="true" />
                  </button>
                  <div
                    id={detailId}
                    className={clsx('profile-recommender-row-detail', expanded && 'is-open')}
                    aria-hidden={!expanded}
                    inert={!expanded || undefined}
                  >
                    {detailHydrated ? (
                      <div className="profile-recommender-row-detail-inner">
                        {renderProjects(entry)}
                        {entry.profile ? (
                          <div className="profile-recommender-directory-actions">
                            <button
                              type="button"
                              className="quiet-action compact-action profile-recommender-edit-action"
                              aria-label={format(tx('profile.recommenders.edit'), { name: displayName })}
                              disabled={disabled}
                              onClick={() => setEditor({ mode: 'edit', profile: entry.profile as ProfileRecommender })}
                            >
                              <Pencil size={13} aria-hidden="true" />
                              {format(tx('profile.recommenders.edit'), { name: displayName })}
                            </button>
                            <button
                              type="button"
                              className="quiet-action compact-action profile-recommender-delete-action"
                              aria-label={format(tx('profile.recommenders.delete'), { name: displayName })}
                              disabled={disabled}
                              onClick={() => setDeleteTarget(entry.profile)}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                              {format(tx('profile.recommenders.delete'), { name: displayName })}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
          {hasMoreRows ? (
            <div
              ref={loadMoreMarkerRef}
              className={clsx(
                'profile-recommender-load-more',
                (isAppendingRows || profilePageLoading) && 'is-loading',
              )}
              aria-busy={isAppendingRows || profilePageLoading || undefined}
            >
              <button
                type="button"
                className="quiet-action compact-action"
                onClick={loadMoreRows}
                disabled={profilePageLoading}
              >
                <Plus size={13} aria-hidden="true" />
                {format(tx('profile.recommenders.showMore'), {
                  count: Math.min(rowBatchSize, remainingRowCount),
                })}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="profile-recommender-empty" role="status">
          <span className="profile-recommender-empty-icon" aria-hidden="true">
            <UserRound size={20} />
          </span>
          <strong>{tx(hasAnyRows ? 'profile.recommenders.noResultsTitle' : 'profile.recommenders.emptyTitle')}</strong>
          <p>
            {tx(hasAnyRows ? 'profile.recommenders.noResultsDescription' : 'profile.recommenders.emptyDescription')}
          </p>
          {hasAnyRows ? (
            <button type="button" className="quiet-action compact-action" onClick={() => updateQuery('')}>
              {tx('profile.recommenders.clearSearch')}
            </button>
          ) : (
            <button
              type="button"
              className="primary-action compact-action"
              disabled={disabled}
              onClick={() => setEditor({ mode: 'add', profile: blankProfileRecommender() })}
            >
              <Plus size={14} aria-hidden="true" /> {tx('profile.recommenders.add')}
            </button>
          )}
        </div>
      )}

      {editor ? (
        <ProfileRecommenderEditorDialog
          request={editor}
          profiles={loadedProfiles}
          onSave={saveEditorProfile}
          onClose={() => setEditor(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={tx('profile.recommenders.deleteTitle')}
        message={
          deleteTarget
            ? format(tx('profile.recommenders.deleteMessage'), {
                name: deleteTarget.name,
              })
            : ''
        }
        confirmLabel={tx('profile.recommenders.deleteConfirm')}
        variant="danger"
        onConfirm={() => {
          if (!deleteTarget) return
          return deleteProfile(deleteTarget).then(() => setDeleteTarget(null))
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  )
}
