import { CalendarClock, ChevronDown, Plus, Save, Trash2, UsersRound } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { MaterialRecommender } from '../../data/applications'
import { localeForLanguage } from '../../i18n'
import { materialRecommenderEmail, materialRecommenderPhone } from '../../profileRecommenders'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { DatePicker } from './DatePicker'
import { LazyMarkdownTextarea as MarkdownTextarea } from './LazyMarkdownTextarea'
import { RecommenderCombobox, type RecommenderComboboxProps } from './RecommenderCombobox'

export type ApplicationRecommenderSchedule = {
  notes?: string
  deadline?: string
  deadlineTime?: string
  reminderDate?: string
  reminderTime?: string
}

export type ApplicationRecommenderPatch = Partial<MaterialRecommender> & ApplicationRecommenderSchedule
export type ApplicationRecommenderUpdateIntent = 'settled' | 'immediate'

export type ApplicationRecommendersPanelProps = {
  id?: string
  recommenders: readonly MaterialRecommender[]
  options: RecommenderComboboxProps['options']
  disabled?: boolean
  /** Returns the new id when a fresh row should open and receive focus. */
  onAdd: () => string | void
  onUpdate: (
    id: string,
    patch: ApplicationRecommenderPatch,
    intent: ApplicationRecommenderUpdateIntent,
  ) => void
  /** Commits the current row. Returning false keeps the editor open. */
  onSave: (id: string) => boolean | void | Promise<boolean | void>
  onRemove: (id: string) => void
  /** Gives the owner a chance to discard a blank draft or confirm a dirty one before collapsing it. */
  onRequestClose?: (id: string, proceed: () => void) => void
}

export type ApplicationRecommenderMilestone = {
  kind: 'deadline' | 'reminder'
  date: string
  time: string
}

type ApplicationRecommenderRecord = MaterialRecommender & ApplicationRecommenderSchedule

function parseDateOnly(value: string | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null
}

function normalizedTime(value: string | undefined): string {
  return /^([01]\d|2[0-3]):[0-5]\d$/u.test(value?.trim() ?? '') ? value!.trim() : ''
}

function applicationRecommenderMilestone(
  recommender: MaterialRecommender,
): ApplicationRecommenderMilestone | null {
  const record = recommender as ApplicationRecommenderRecord
  const candidates: ApplicationRecommenderMilestone[] = []
  if (parseDateOnly(record.deadline)) {
    candidates.push({ kind: 'deadline', date: record.deadline!.trim(), time: normalizedTime(record.deadlineTime) })
  }
  if (parseDateOnly(record.reminderDate)) {
    candidates.push({
      kind: 'reminder',
      date: record.reminderDate!.trim(),
      time: normalizedTime(record.reminderTime),
    })
  }
  return candidates.sort((left, right) => {
    const leftKey = `${left.date}T${left.time || (left.kind === 'deadline' ? '23:59' : '00:00')}`
    const rightKey = `${right.date}T${right.time || (right.kind === 'deadline' ? '23:59' : '00:00')}`
    return leftKey.localeCompare(rightKey)
  })[0] ?? null
}

function applicationRecommenderReminderAfterDeadline(recommender: MaterialRecommender): boolean {
  const record = recommender as ApplicationRecommenderRecord
  if (!parseDateOnly(record.deadline) || !parseDateOnly(record.reminderDate)) return false
  const deadline = `${record.deadline!.trim()}T${normalizedTime(record.deadlineTime) || '23:59'}`
  const reminder = `${record.reminderDate!.trim()}T${normalizedTime(record.reminderTime) || '00:00'}`
  return reminder > deadline
}

function dateTimeForMilestone(milestone: ApplicationRecommenderMilestone): Date {
  const time = milestone.time || '12:00'
  return new Date(`${milestone.date}T${time}:00`)
}

export function ApplicationRecommendersPanel({
  id,
  recommenders,
  options,
  disabled = false,
  onAdd,
  onUpdate,
  onSave,
  onRemove,
  onRequestClose,
}: ApplicationRecommendersPanelProps) {
  const { tx, format, lang } = useI18n()
  const panelRef = useRef<HTMLElement>(null)
  const focusTimerRef = useRef<number | null>(null)
  const removalTimersRef = useRef<Record<string, number>>({})
  const pendingFocusIdRef = useRef<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // Only rows deliberately created in this panel receive an entering phase.
  // Replaying an entrance animation for the complete list on every Dossier
  // render made the add action feel like a flash rather than an inline insert.
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(() => new Set())
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set())
  const reactId = useId().replace(/:/gu, '')
  const headingId = `${reactId}-application-recommenders-heading`
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(localeForLanguage(lang), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    [lang],
  )
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(localeForLanguage(lang), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    [lang],
  )

  // Legacy records can carry two rows with the same id — an aggregation that ran
  // before the directory deduplicated, or an import. Keying rows on the raw id
  // then made React reconcile two list items as one, so clicking one row opened
  // a different one. Every row therefore gets an identity that is unique within
  // the rendered list, and the expansion, entrance and removal state all track
  // that instead of the id.
  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>()
    return recommenders.map((recommender) => {
      const occurrence = seen.get(recommender.id) ?? 0
      seen.set(recommender.id, occurrence + 1)
      return occurrence === 0 ? recommender.id : `${recommender.id}#${occurrence}`
    })
  }, [recommenders])

  // A second row holding an address another row already uses is the same person
  // twice. The server refuses to persist it; naming it here means the person
  // sees why before they press save.
  const duplicateEmailKeys = useMemo(() => {
    const owners = new Map<string, string[]>()
    recommenders.forEach((recommender, index) => {
      const email = materialRecommenderEmail(recommender).toLocaleLowerCase('en-US')
      if (!email) return
      owners.set(email, [...(owners.get(email) ?? []), rowKeys[index]])
    })
    const duplicated = new Set<string>()
    for (const keys of owners.values()) {
      if (keys.length > 1) keys.forEach((key) => duplicated.add(key))
    }
    return duplicated
  }, [recommenders, rowKeys])

  useEffect(() => {
    if (expandedKey && !rowKeys.includes(expandedKey)) {
      setExpandedKey(null)
    }
  }, [expandedKey, rowKeys])

  useEffect(() => {
    if (enteringIds.size === 0) return undefined
    const mountedIds = new Set(recommenders.map((recommender) => recommender.id))
    const visibleEnteringIds = Array.from(enteringIds).filter((recommenderId) => mountedIds.has(recommenderId))
    if (visibleEnteringIds.length === 0) return undefined

    const releaseEntrance = () => {
      setEnteringIds((current) => {
        if (current.size === 0) return current
        const next = new Set(current)
        visibleEnteringIds.forEach((recommenderId) => next.delete(recommenderId))
        return next
      })
    }

    // Keep the collapsed row on screen for one painted frame, then release it
    // on the compositor. A double frame avoids a height jump while preserving
    // a fast, interruptible inline insertion.
    if (typeof window.requestAnimationFrame !== 'function') {
      const timer = window.setTimeout(releaseEntrance, 0)
      return () => window.clearTimeout(timer)
    }
    let secondFrame: number | null = null
    // A throttled background tab may defer animation frames. The short timer
    // keeps the new row from remaining collapsed if that happens; the state
    // update is idempotent when the two frames already released it.
    const fallbackTimer = window.setTimeout(releaseEntrance, getMotionDelay(96))
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(releaseEntrance)
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
      window.clearTimeout(fallbackTimer)
    }
  }, [enteringIds, recommenders])

  useEffect(() => {
    const recommenderId = pendingFocusIdRef.current
    if (!recommenderId || !recommenders.some((recommender) => recommender.id === recommenderId)) return

    pendingFocusIdRef.current = null
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
    // Let the inline expansion settle before focus opens the suggestion menu.
    // This avoids a portal appearing over the first frames of a new row while
    // the timer remains reliable in a backgrounded tab.
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null
      const panel = panelRef.current
      const row = Array.from(panel?.querySelectorAll<HTMLElement>('[data-recommender-id]') ?? [])
        .find((candidate) => candidate.dataset.recommenderId === recommenderId)
      const activeElement = document.activeElement
      // The expansion delay must never override a faster pointer/keyboard
      // choice. Keep the intentional Add-button → name handoff, but yield if
      // the user already reached this row or moved focus outside the panel.
      if (row?.contains(activeElement)) return
      if (
        activeElement instanceof HTMLElement
        && activeElement !== document.body
        && !panel?.contains(activeElement)
      ) return
      row?.querySelector<HTMLInputElement>('.recommender-combobox-name-input')?.focus({ preventScroll: true })
    }, getMotionDelay(220))
  }, [recommenders])

  useEffect(
    () => () => {
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
      Object.values(removalTimersRef.current).forEach((timer) => window.clearTimeout(timer))
      removalTimersRef.current = {}
    },
    [],
  )

  const addAndOpen = () => {
    const recommenderId = onAdd()
    if (!recommenderId) return
    pendingFocusIdRef.current = recommenderId
    // A freshly minted id is unique, so its row key is the id itself.
    setExpandedKey(recommenderId)
    if (getMotionDelay(220) > 0) {
      setEnteringIds((current) => new Set(current).add(recommenderId))
    }
  }

  const handleAdd = () => {
    if (disabled || savingIds.size > 0) return
    if (expandedKey && onRequestClose) {
      onRequestClose(recommenderIdForKey(expandedKey), addAndOpen)
      return
    }
    addAndOpen()
  }

  const requestExpandedChange = (nextKey: string | null) => {
    if (savingIds.size > 0) return
    if (expandedKey && expandedKey !== nextKey && onRequestClose) {
      onRequestClose(recommenderIdForKey(expandedKey), () => setExpandedKey(nextKey))
      return
    }
    setExpandedKey(nextKey)
  }

  const handleRemove = (recommenderId: string, rowKey: string) => {
    if (disabled || removingIds.has(recommenderId)) return
    setExpandedKey((current) => current === rowKey ? null : current)
    setRemovingIds((current) => new Set(current).add(recommenderId))
    const completeRemoval = () => {
      delete removalTimersRef.current[recommenderId]
      onRemove(recommenderId)
    }
    const delay = getMotionDelay(220)
    if (delay === 0) {
      completeRemoval()
      return
    }
    removalTimersRef.current[recommenderId] = window.setTimeout(completeRemoval, delay)
  }

  const handleSave = async (recommenderId: string, rowKey: string) => {
    if (disabled || removingIds.has(recommenderId) || savingIds.has(recommenderId)) return
    setSavingIds((current) => new Set(current).add(recommenderId))
    let saved = false
    try {
      saved = (await onSave(recommenderId)) !== false
    } catch {
      saved = false
    } finally {
      setSavingIds((current) => {
        if (!current.has(recommenderId)) return current
        const next = new Set(current)
        next.delete(recommenderId)
        return next
      })
    }
    if (saved) setExpandedKey((current) => current === rowKey ? null : current)
  }

  /** The parent's callbacks stay id-based; only the rendered identity is suffixed. */
  function recommenderIdForKey(rowKey: string) {
    const separator = rowKey.lastIndexOf('#')
    return separator === -1 ? rowKey : rowKey.slice(0, separator)
  }

  const milestoneLabel = (recommender: MaterialRecommender) => {
    const milestone = applicationRecommenderMilestone(recommender)
    if (!milestone) return null
    const date = milestone.time
      ? dateTimeFormatter.format(dateTimeForMilestone(milestone))
      : dateFormatter.format(dateTimeForMilestone(milestone))
    return {
      dateTime: milestone.time ? `${milestone.date}T${milestone.time}` : milestone.date,
      text: format(
        tx(milestone.kind === 'reminder'
          ? 'dossier.recommenderOverviewRemind'
          : 'dossier.recommenderOverviewDue'),
        { date },
      ),
    }
  }

  return (
    <section ref={panelRef} id={id} className="application-recommenders-panel" aria-labelledby={headingId} tabIndex={id ? -1 : undefined}>
      <div className="application-recommenders-head">
        <div className="application-recommenders-title">
          <span className="application-recommenders-mark" aria-hidden="true">
            <UsersRound size={14} />
          </span>
          <h4 id={headingId}>{tx('dossier.recommenderOverviewTitle')}</h4>
          <span className="application-recommenders-count">
            {format(tx('dossier.recommenderOverviewCount'), { count: recommenders.length })}
          </span>
        </div>
        <button
          type="button"
          className="quiet-action compact-action application-recommenders-add"
          disabled={disabled || savingIds.size > 0}
          onClick={handleAdd}
        >
          <Plus size={13} aria-hidden="true" />
          {tx('dossier.recommenderOverviewAdd')}
        </button>
      </div>

      {recommenders.length === 0 ? (
        <div className="application-recommenders-empty" role="status">
          <span className="application-recommenders-empty-icon" aria-hidden="true">
            <UsersRound size={17} />
          </span>
          <span>
            <strong>{tx('dossier.recommenderOverviewEmptyTitle')}</strong>
            <small>{tx('dossier.recommenderOverviewEmptyDescription')}</small>
          </span>
        </div>
      ) : (
        <ul className="application-recommenders-list">
          {recommenders.map((recommender, index) => {
            const record = recommender as ApplicationRecommenderRecord
            const rowKey = rowKeys[index]
            const expanded = expandedKey === rowKey
            const entering = enteringIds.has(recommender.id)
            const removing = removingIds.has(recommender.id)
            const saving = savingIds.has(recommender.id)
            const detailId = `${reactId}-application-recommender-${encodeURIComponent(rowKey)}`
            const validationId = `${detailId}-validation`
            const duplicateEmail = duplicateEmailKeys.has(rowKey)
            const reminderAfterDeadline = applicationRecommenderReminderAfterDeadline(recommender)
            const milestone = milestoneLabel(recommender)
            const displayName = recommender.name.trim() || tx('dossier.recommenderOverviewUnnamed')
            const displayContact = [materialRecommenderEmail(recommender), materialRecommenderPhone(recommender)]
              .filter(Boolean)
              .join(' · ') || tx('dossier.recommenderOverviewEmailMissing')
            return (
              <li
                key={rowKey}
                data-recommender-id={recommender.id}
                className={clsx(
                  'application-recommender-row',
                  expanded && 'is-expanded',
                  entering && 'is-entering',
                  removing && 'is-removing',
                  (reminderAfterDeadline || duplicateEmail) && 'has-invalid-reminder',
                )}
              >
                <div className="application-recommender-row-content">
                  <button
                  type="button"
                  className="application-recommender-summary"
                  aria-expanded={expanded && !removing}
                  aria-controls={detailId}
                  disabled={removing || savingIds.size > 0}
                  onClick={() => requestExpandedChange(expanded ? null : rowKey)}
                >
                  <span className="application-recommender-avatar" aria-hidden="true">{index + 1}</span>
                  <span className="application-recommender-identity">
                    <strong>{displayName}</strong>
                    <span>{displayContact}</span>
                  </span>
                  <span className="application-recommender-summary-meta">
                    {milestone ? (
                      <time className="application-recommender-milestone" dateTime={milestone.dateTime}>
                        <CalendarClock size={12} aria-hidden="true" />
                        {milestone.text}
                      </time>
                    ) : null}
                  </span>
                  <ChevronDown className="application-recommender-chevron" size={15} aria-hidden="true" />
                  <span className="sr-only">
                    {format(tx('dossier.recommenderOverviewToggle'), { name: displayName })}
                  </span>
                  </button>

                  <div
                  id={detailId}
                  className={clsx('application-recommender-detail', expanded && 'is-open')}
                  aria-hidden={!expanded || removing}
                  inert={!expanded || removing || undefined}
                >
                  <div className="application-recommender-detail-inner">
                    <fieldset className="application-recommender-fields" disabled={disabled || removing || saving}>
                      <div
                        className={clsx(
                          'application-recommender-identity-fields',
                          duplicateEmail && 'has-duplicate-email',
                        )}
                        aria-describedby={duplicateEmail ? validationId : undefined}
                      >
                        <RecommenderCombobox
                          value={recommender}
                          options={options}
                          onChange={(next, reason) => {
                            onUpdate(recommender.id, {
                              name: next.name,
                              contact: next.contact,
                              email: next.email,
                              phone: next.phone,
                              profileId: next.profileId,
                            }, reason === 'selection' ? 'immediate' : 'settled')
                          }}
                          namePlaceholder={tx('dossier.recommenderName')}
                          emailPlaceholder={tx('dossier.recommenderEmail', 'Email address')}
                          phonePlaceholder={tx('dossier.recommenderPhone', 'Phone number')}
                          nameLabel={tx('dossier.recommenderName')}
                          emailLabel={tx('dossier.recommenderEmail', 'Email address')}
                          phoneLabel={tx('dossier.recommenderPhone', 'Phone number')}
                          nameRequired
                          listLabel={tx('dossier.recommenderOverviewSuggestions')}
                          emptyHint={tx('dossier.recommenderOverviewNoSuggestions')}
                        />
                      </div>

                      <div className="application-recommender-field application-recommender-notes">
                        <span>{tx('dossier.recommenderOverviewNotes')}</span>
                        <MarkdownTextarea
                          value={record.notes ?? ''}
                          rows={3}
                          disabled={disabled}
                          aria-label={tx('dossier.recommenderOverviewNotes')}
                          placeholder={tx('dossier.recommenderOverviewNotesPlaceholder')}
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                            onUpdate(recommender.id, { notes: event.target.value }, 'settled')
                          }}
                        />
                      </div>

                      <div className="application-recommender-schedule" role="group" aria-label={tx('dossier.recommenderOverviewDescription')}>
                        <div className="application-recommender-field application-recommender-deadline-field">
                          <span>{tx('dossier.recommenderOverviewDeadline')}</span>
                          <DatePicker
                            value={record.deadline ?? ''}
                            timeValue={record.deadlineTime ?? ''}
                            allowClear
                            placeholder={tx('dossier.recommenderOverviewDeadline')}
                            onChange={(value) => onUpdate(recommender.id, { deadline: value }, 'immediate')}
                            onTimeChange={(value) => onUpdate(recommender.id, { deadlineTime: value }, 'immediate')}
                          />
                        </div>
                        <div
                          className={clsx('application-recommender-field application-recommender-reminder-date-field', reminderAfterDeadline && 'is-invalid')}
                          aria-describedby={reminderAfterDeadline ? validationId : undefined}
                        >
                          <span>{tx('dossier.recommenderOverviewReminderDate')}</span>
                          <DatePicker
                            value={record.reminderDate ?? ''}
                            timeValue={record.reminderTime ?? ''}
                            allowClear
                            placeholder={tx('dossier.recommenderOverviewReminderDate')}
                            onChange={(value) => onUpdate(recommender.id, { reminderDate: value }, 'immediate')}
                            onTimeChange={(value) => onUpdate(recommender.id, { reminderTime: value }, 'immediate')}
                            timeAriaLabel={tx('dossier.recommenderOverviewReminderTime')}
                          />
                        </div>
                      </div>

                      {reminderAfterDeadline || duplicateEmail ? (
                        <p id={validationId} className="application-recommender-validation" role="alert">
                          {tx(reminderAfterDeadline
                            ? 'dossier.recommenderOverviewReminderAfterDeadline'
                            : 'dossier.recommenderOverviewDuplicateEmail')}
                        </p>
                      ) : null}

                      <div className="application-recommender-actions">
                        <button
                          type="button"
                          className="quiet-action compact-action application-recommender-remove"
                          disabled={disabled || removing}
                          onClick={() => handleRemove(recommender.id, rowKey)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                          {tx('dossier.recommenderOverviewRemove')}
                        </button>
                        <button
                          type="button"
                          className="quiet-action save-action compact-action application-recommender-save"
                          disabled={disabled || removing || saving || !recommender.name.trim() || reminderAfterDeadline || duplicateEmail}
                          aria-busy={saving || undefined}
                          onClick={() => void handleSave(recommender.id, rowKey)}
                        >
                          <Save size={13} aria-hidden="true" />
                          {tx(saving ? 'dossier.saving' : 'dossier.save')}
                        </button>
                      </div>
                    </fieldset>
                  </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
