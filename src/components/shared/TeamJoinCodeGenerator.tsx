import '../../styles/team-join-code.css'
import {
  Check,
  ChevronDown,
  Clock3,
  GraduationCap,
  KeyRound,
  Link2,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TeamJoinCode, TeamRole } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'
import { AnchoredPopover } from './AnchoredPopover'
import { CollapsiblePanel } from './CollapsiblePanel'
import { CopyButton } from './CopyButton'
import { PendingLabel } from './PendingLabel'

type JoinCodeTeacher = {
  id: string
  userId: string | null
  displayName?: string
  invitedEmail: string
}

const EMPTY_TEACHER_IDS: string[] = []

function teacherLabel(teacher: JoinCodeTeacher) {
  return teacher.displayName?.trim() || teacher.invitedEmail
}

function JoinCodeTeacherSelect({
  teachers,
  selectedTeacherIds,
  onToggle,
}: {
  teachers: JoinCodeTeacher[]
  selectedTeacherIds: readonly string[]
  onToggle: (teacherId: string) => void
}) {
  const { tx, format, lang } = useI18n()
  const [query, setQuery] = useState('')
  const selectedIdSet = useMemo(() => new Set(selectedTeacherIds), [selectedTeacherIds])
  const selectedTeachers = useMemo(
    () => teachers.filter((teacher) => selectedIdSet.has(teacher.id)),
    [selectedIdSet, teachers],
  )
  const visibleTeachers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(lang)
    if (!normalizedQuery) return teachers
    return teachers.filter((teacher) => (
      `${teacherLabel(teacher)} ${teacher.invitedEmail}`
        .toLocaleLowerCase(lang)
        .includes(normalizedQuery)
    ))
  }, [lang, query, teachers])
  const selectionLabel = selectedTeachers.length === 0
    ? tx('team.joinCodeTeacherRequired')
    : selectedTeachers.length === 1
      ? teacherLabel(selectedTeachers[0])
      : format(tx('team.collaborationTeachersCount'), { count: selectedTeachers.length })
  const selectedNames = selectedTeachers
    .slice(0, 2)
    .map(teacherLabel)
    .join(' · ')

  return (
    <AnchoredPopover
      triggerAriaLabel={`${tx('team.joinCodeTeacherAssignment')}: ${selectionLabel}`}
      popoverAriaLabel={tx('team.joinCodeTeacherAssignment')}
      triggerClassName="team-join-code-teacher-trigger"
      popoverClassName="team-join-code-teacher-menu-shell"
      width={340}
      estimatedHeight={360}
      align="start"
      onOpenChange={(open) => {
        if (!open) setQuery('')
      }}
      trigger={(
        <>
          <span className="team-join-code-teacher-trigger-icon" aria-hidden="true">
            <Users size={14} />
          </span>
          <span className="team-join-code-teacher-trigger-copy">
            <strong>{selectionLabel}</strong>
            <small>{selectedNames || tx('team.joinCodeTeacherAssignmentDescription')}</small>
          </span>
          <ChevronDown
            size={14}
            className="team-join-code-teacher-trigger-chevron"
            aria-hidden="true"
          />
        </>
      )}
    >
      {(close) => (
        <div className="team-join-code-teacher-menu">
          <div className="team-join-code-teacher-menu-head">
            <strong>{tx('team.joinCodeTeacherAssignment')}</strong>
            <span>{selectionLabel}</span>
          </div>
          <label className="team-join-code-teacher-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">{tx('search')}</span>
            <input
              data-popover-autofocus
              type="search"
              value={query}
              placeholder={tx('search')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div
            className="team-join-code-teacher-options"
            role="listbox"
            aria-label={tx('team.joinCodeTeacherAssignment')}
            aria-multiselectable="true"
          >
            {visibleTeachers.length > 0 ? visibleTeachers.map((teacher) => {
              const selected = selectedIdSet.has(teacher.id)
              const label = teacherLabel(teacher)
              return (
                <button
                  key={teacher.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? 'selected' : ''}
                  onClick={() => onToggle(teacher.id)}
                >
                  <span className="team-join-code-teacher-option-icon" aria-hidden="true">
                    <GraduationCap size={14} />
                  </span>
                  <span className="team-join-code-teacher-option-copy">
                    <strong>{label}</strong>
                    {teacher.invitedEmail !== label ? <small>{teacher.invitedEmail}</small> : null}
                  </span>
                  <span className="team-join-code-teacher-option-check" aria-hidden="true">
                    {selected ? <Check size={12} /> : null}
                  </span>
                </button>
              )
            }) : (
              <div className="team-join-code-teacher-empty">
                <Search size={16} aria-hidden="true" />
                <span>{tx('noResults')}</span>
              </div>
            )}
          </div>
          <div className="team-join-code-teacher-menu-foot">
            <span>{selectionLabel}</span>
            <button type="button" className="quiet-action" onClick={close}>
              {tx('done')}
            </button>
          </div>
        </div>
      )}
    </AnchoredPopover>
  )
}

export function TeamJoinCodeGenerator({
  roles,
  teachers,
  defaultRole,
  defaultTeacherIds = EMPTY_TEACHER_IDS,
  onGenerate,
}: {
  roles: TeamRole[]
  teachers: JoinCodeTeacher[]
  defaultRole?: TeamRole
  defaultTeacherIds?: string[]
  onGenerate: (input: { role: TeamRole; teacherIds: string[] }) => Promise<TeamJoinCode>
}) {
  const { tx, lang } = useI18n()
  const initialRole = defaultRole && roles.includes(defaultRole) ? defaultRole : (roles[0] ?? 'member')
  const [role, setRole] = useState<TeamRole>(initialRole)
  const [teacherIds, setTeacherIds] = useState<string[]>(defaultTeacherIds)
  const [generated, setGenerated] = useState<TeamJoinCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const roleOptionsRef = useRef<HTMLDivElement | null>(null)
  const roleIndicatorRef = useRef<HTMLSpanElement | null>(null)
  const roleOptionRefs = useRef(new Map<TeamRole, HTMLButtonElement>())

  useEffect(() => {
    if (!roles.includes(role)) setRole(roles[0] ?? 'member')
  }, [role, roles])

  useEffect(() => {
    const availableIds = new Set(teachers.map((teacher) => teacher.id))
    setTeacherIds((current) => {
      const available = current.filter((id) => availableIds.has(id))
      if (available.length > 0 || role !== 'member') return available
      const defaults = defaultTeacherIds.filter((id) => availableIds.has(id))
      return defaults.length > 0 ? defaults : (teachers[0] ? [teachers[0].id] : [])
    })
  }, [defaultTeacherIds, role, teachers])

  const roleOptions = useMemo(() => roles.map((value) => ({
    value,
    label: tx(`team.role${value === 'owner' ? 'Owner' : value === 'admin' ? 'Admin' : 'Member'}`),
    description: value === 'owner'
      ? tx('team.joinCodeOwnerRoleDesc')
      : value === 'admin'
        ? tx('team.joinCodeTeacherRoleDesc')
        : tx('team.joinCodeStudentRoleDesc'),
  })), [roles, tx])

  const roleIcon = (value: TeamRole) => {
    if (value === 'owner') return <ShieldCheck size={15} aria-hidden="true" />
    if (value === 'admin') return <GraduationCap size={15} aria-hidden="true" />
    return <UserRound size={15} aria-hidden="true" />
  }

  const positionRoleIndicator = useCallback((value: TeamRole) => {
    const indicator = roleIndicatorRef.current
    const button = roleOptionRefs.current.get(value)
    if (!indicator || !button) {
      indicator?.classList.remove('is-ready')
      return
    }

    indicator.style.setProperty('--team-join-role-y', `${button.offsetTop}px`)
    indicator.style.setProperty('--team-join-role-height', `${button.offsetHeight}px`)
    indicator.classList.add('is-ready')
  }, [])

  useLayoutEffect(() => {
    if (roleOptions.length <= 1) return undefined

    positionRoleIndicator(role)
    const options = roleOptionsRef.current
    if (!options || typeof ResizeObserver !== 'function') return undefined

    const observer = new ResizeObserver(() => positionRoleIndicator(role))
    observer.observe(options)
    roleOptionRefs.current.forEach((button) => observer.observe(button))
    return () => observer.disconnect()
  }, [positionRoleIndicator, role, roleOptions])

  const selectRole = (nextRole: TeamRole) => {
    positionRoleIndicator(nextRole)
    setRole(nextRole)
    setGenerated(null)
    setError('')
  }

  const toggleTeacher = (teacherId: string) => {
    setGenerated(null)
    setError('')
    setTeacherIds((current) => current.includes(teacherId)
      ? current.filter((id) => id !== teacherId)
      : [...current, teacherId])
  }

  const handleGenerate = async () => {
    if (role === 'member' && teacherIds.length === 0) {
      setError(tx('team.joinCodeTeacherRequired'))
      return
    }
    setBusy(true)
    setError('')
    try {
      setGenerated(await onGenerate({
        role,
        teacherIds: role === 'member' ? teacherIds : [],
      }))
    } catch (reason) {
      setError(normalizeErrorMessage(reason, lang))
    } finally {
      setBusy(false)
    }
  }

  const generatedUrl = generated
    ? `${typeof window === 'undefined' ? '' : window.location.origin}${generated.url}`
    : ''

  return (
    <div className="team-join-code-generator">
      <div className="team-join-code-generator-heading">
        <span className="team-join-code-generator-icon" aria-hidden="true">
          <KeyRound size={16} />
        </span>
        <div>
          <strong>{tx('team.joinCodeTitle')}</strong>
          <p>{tx('team.joinCodeDescription')}</p>
        </div>
      </div>

      <div className="team-join-code-fields">
        <div className="team-join-code-field">
          <span>{tx('team.joinCodeRole')}</span>
          {roleOptions.length === 1 ? (
            <div className="team-join-code-role-single">
              <i aria-hidden="true">{roleIcon(roleOptions[0].value)}</i>
              <span>
                <strong>{roleOptions[0].label}</strong>
                <small>{roleOptions[0].description}</small>
              </span>
            </div>
          ) : (
            <div
              ref={roleOptionsRef}
              className="team-join-code-role-options"
              role="radiogroup"
              aria-label={tx('team.joinCodeRole')}
            >
              <span
                ref={roleIndicatorRef}
                className="team-join-code-role-indicator"
                aria-hidden="true"
              />
              {roleOptions.map((option) => {
                const selected = option.value === role
                return (
                  <button
                    ref={(node) => {
                      if (node) roleOptionRefs.current.set(option.value, node)
                      else roleOptionRefs.current.delete(option.value)
                    }}
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? 'selected' : ''}
                    onClick={() => selectRole(option.value)}
                  >
                    <i aria-hidden="true">{roleIcon(option.value)}</i>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <b aria-hidden="true"><Check size={12} /></b>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <CollapsiblePanel
          open={role === 'member'}
          keepMounted
          openMs={280}
          closeMs={220}
          className="team-join-code-assignment-collapse"
        >
          <div className="team-join-code-field">
            <span>{tx('team.joinCodeTeacherAssignment')}</span>
            <p>{tx('team.joinCodeTeacherAssignmentDescription')}</p>
            {teachers.length > 0 ? (
              <JoinCodeTeacherSelect
                teachers={teachers}
                selectedTeacherIds={teacherIds}
                onToggle={toggleTeacher}
              />
            ) : (
              <div className="team-join-code-empty">
                <Users size={15} aria-hidden="true" />
                <span>{tx('team.joinCodeNoTeachers')}</span>
              </div>
            )}
          </div>
        </CollapsiblePanel>
      </div>

      {error ? <p className="team-join-code-error" role="alert">{error}</p> : null}

      <button
        type="button"
        className="primary-action team-join-code-submit"
        onClick={handleGenerate}
        disabled={busy || (role === 'member' && teachers.length === 0)}
        aria-busy={busy || undefined}
      >
        {busy ? (
          <PendingLabel label={tx('team.joinCodeGenerating')} iconSize={15} />
        ) : (
          <><KeyRound size={15} aria-hidden="true" /> {tx('team.joinCodeGenerate')}</>
        )}
      </button>

      {generated ? (
        <div className="team-join-code-result" aria-live="polite">
          <div className="team-join-code-result-meta">
            <span>
              <Clock3 size={13} aria-hidden="true" />
              {generated.reusable ? tx('team.joinCodeReusable') : tx('team.joinCodeOneTime')}
            </span>
            <span>{new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(generated.expiresAt))}</span>
          </div>
          <div className="team-join-code-value">
            <div>
              <span>{tx('team.joinCodeValue')}</span>
              <strong>{generated.code}</strong>
            </div>
            <CopyButton value={generated.code} label={tx('team.joinCodeValue')} />
          </div>
          <div className="team-join-code-value team-join-code-link">
            <div>
              <span><Link2 size={12} aria-hidden="true" />{tx('team.joinCodeLink')}</span>
              <strong>{generatedUrl}</strong>
            </div>
            <CopyButton value={generatedUrl} label={tx('team.joinCodeLink')} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
