import {
  ChevronRight,
  Compass,
  ExternalLink,
  GitMerge,
  GraduationCap,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type {
  TeamMemberRelationships,
  TeamMemberUsage,
  TeamPermissionDefaults,
  TeamStudentPermissions,
  TeamTeacherPermissions,
} from '../../api/phdApi'
import {
  teamPermissionDefaults,
  teamStudentPermissions,
  teamTeacherPermissions,
} from '../../teamPermissions'
import { useI18n } from '../hooks/useI18n'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { InfoTooltip } from '../shared/InfoTooltip'

type StudentBooleanPermissionKey =
  | 'editApplications'
  | 'createApplications'
  | 'useDiscover'
  | 'createShareLinks'
  | 'requestTeamTransfers'

type StudentLimitPermissionKey =
  | 'activeApplicationLimit'
  | 'lifetimeApplicationLimit'
  | 'activeShareLimit'
  | 'lifetimeShareLimit'

type TeacherPermissionKey = keyof TeamTeacherPermissions

type PermissionRow<TKey extends string> = {
  key: TKey
  titleKey: string
  descriptionKey: string
  icon: LucideIcon
}

const STUDENT_PERMISSION_ROWS: ReadonlyArray<PermissionRow<StudentBooleanPermissionKey>> = [
  {
    key: 'editApplications',
    titleKey: 'team.permissionStudentEditTitle',
    descriptionKey: 'team.permissionStudentEditDesc',
    icon: Pencil,
  },
  {
    key: 'createApplications',
    titleKey: 'team.permissionStudentCreateTitle',
    descriptionKey: 'team.permissionStudentCreateDesc',
    icon: Plus,
  },
  {
    key: 'useDiscover',
    titleKey: 'team.permissionStudentDiscoverTitle',
    descriptionKey: 'team.permissionStudentDiscoverDesc',
    icon: Compass,
  },
  {
    key: 'createShareLinks',
    titleKey: 'team.permissionStudentShareTitle',
    descriptionKey: 'team.permissionStudentShareDesc',
    icon: ExternalLink,
  },
  {
    key: 'requestTeamTransfers',
    titleKey: 'team.permissionStudentTransferTitle',
    descriptionKey: 'team.permissionStudentTransferDesc',
    icon: GitMerge,
  },
]

const TEACHER_PERMISSION_ROWS: ReadonlyArray<PermissionRow<TeacherPermissionKey>> = [
  {
    key: 'inviteStudents',
    titleKey: 'team.permissionTeacherInviteTitle',
    descriptionKey: 'team.permissionTeacherInviteDesc',
    icon: UserPlus,
  },
  {
    key: 'manageStudentPermissions',
    titleKey: 'team.permissionTeacherStudentPermissionsTitle',
    descriptionKey: 'team.permissionTeacherStudentPermissionsDesc',
    icon: ShieldCheck,
  },
  {
    key: 'useDiscover',
    titleKey: 'team.permissionTeacherDiscoverTitle',
    descriptionKey: 'team.permissionTeacherDiscoverDesc',
    icon: Compass,
  },
  {
    key: 'createStudentApplications',
    titleKey: 'team.permissionTeacherCreateTitle',
    descriptionKey: 'team.permissionTeacherCreateDesc',
    icon: Plus,
  },
  {
    key: 'editStudentApplications',
    titleKey: 'team.permissionTeacherEditTitle',
    descriptionKey: 'team.permissionTeacherEditDesc',
    icon: Pencil,
  },
  {
    key: 'manageStudentShares',
    titleKey: 'team.permissionTeacherShareTitle',
    descriptionKey: 'team.permissionTeacherShareDesc',
    icon: ExternalLink,
  },
]

const STUDENT_LIMIT_ROWS: ReadonlyArray<PermissionRow<StudentLimitPermissionKey>> = [
  {
    key: 'activeApplicationLimit',
    titleKey: 'team.permissionStudentActiveApplicationLimitTitle',
    descriptionKey: 'team.permissionStudentActiveApplicationLimitDesc',
    icon: Plus,
  },
  {
    key: 'lifetimeApplicationLimit',
    titleKey: 'team.permissionStudentLifetimeApplicationLimitTitle',
    descriptionKey: 'team.permissionStudentLifetimeApplicationLimitDesc',
    icon: GraduationCap,
  },
  {
    key: 'activeShareLimit',
    titleKey: 'team.permissionStudentActiveShareLimitTitle',
    descriptionKey: 'team.permissionStudentActiveShareLimitDesc',
    icon: ExternalLink,
  },
  {
    key: 'lifetimeShareLimit',
    titleKey: 'team.permissionStudentLifetimeShareLimitTitle',
    descriptionKey: 'team.permissionStudentLifetimeShareLimitDesc',
    icon: GitMerge,
  },
]

function useQueuedPermissionDraft<T extends object>(
  source: T,
  onSave: (patch: Partial<T> | null) => Promise<void>,
) {
  const [draft, setDraft] = useState(source)
  const [saving, setSaving] = useState(false)
  const queueRef = useRef<Array<Partial<T> | null>>([])
  const flushingRef = useRef(false)
  const mountedRef = useRef(true)
  const sourceRef = useRef(source)
  const onSaveRef = useRef(onSave)
  const sourceSignature = JSON.stringify(source)

  sourceRef.current = source
  onSaveRef.current = onSave

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  useEffect(() => {
    if (!flushingRef.current && queueRef.current.length === 0) {
      setDraft(sourceRef.current)
    }
  }, [sourceSignature])

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    if (mountedRef.current) setSaving(true)
    while (queueRef.current.length > 0) {
      const operation = queueRef.current.shift()!
      try {
        await onSaveRef.current(operation)
      } catch {
        queueRef.current.length = 0
        if (mountedRef.current) setDraft(sourceRef.current)
        break
      }
    }
    flushingRef.current = false
    if (mountedRef.current) setSaving(false)
  }, [])

  const enqueue = useCallback((operation: Partial<T> | null) => {
    const previousIndex = queueRef.current.length - 1
    const previous = queueRef.current[previousIndex]
    if (operation !== null && previous !== null && previous !== undefined) {
      queueRef.current[previousIndex] = { ...previous, ...operation }
    } else {
      queueRef.current.push(operation)
    }
    void flush()
  }, [flush])

  const update = useCallback(<TKey extends keyof T>(key: TKey, value: T[TKey]) => {
    const patch: Partial<T> = {}
    patch[key] = value
    setDraft((current) => ({ ...current, ...patch }))
    enqueue(patch)
  }, [enqueue])

  const reset = useCallback((nextDraft: T) => {
    setDraft(nextDraft)
    enqueue(null)
  }, [enqueue])

  return { draft, saving, update, reset }
}

const PermissionSwitch = memo(function PermissionSwitch({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      className={`team-permission-switch${checked ? ' enabled' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span aria-hidden="true" />
    </button>
  )
})

function SaveState({ saving }: { saving: boolean }) {
  const { tx } = useI18n()
  return (
    <span className={`team-permission-save-state${saving ? ' is-saving' : ''}`} aria-live="polite">
      {saving ? <LoaderCircle className="spin" size={11} aria-hidden="true" /> : null}
      {saving ? tx('working') : tx('team.permissionSaved')}
    </span>
  )
}

const PermissionLimitInput = memo(function PermissionLimitInput({
  value,
  label,
  disabled,
  onChange,
}: {
  value: number | null
  label: string
  disabled?: boolean
  onChange: (value: number | null) => void
}) {
  const displayValue = value === null ? '∞' : String(value)

  const commit = useCallback((input: HTMLInputElement) => {
    const raw = input.value.trim()
    if (raw === '') {
      input.value = displayValue
      return false
    }

    let next: number | null
    if (raw === '-1' || raw === '∞') {
      next = null
    } else {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed)) {
        input.value = displayValue
        return false
      }
      next = Math.max(1, Math.min(10_000, parsed))
    }

    input.value = next === null ? '∞' : String(next)
    const changed = next !== value
    if (changed) onChange(next)
    return changed
  }, [displayValue, onChange, value])

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="-?[0-9]*"
      defaultValue={displayValue}
      aria-label={label}
      disabled={disabled}
      autoComplete="off"
      spellCheck={false}
      onFocus={(event) => {
        if (value === null) event.currentTarget.value = '-1'
        event.currentTarget.select()
      }}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          if (!commit(event.currentTarget)) event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.currentTarget.value = displayValue
          event.currentTarget.blur()
        }
      }}
    />
  )
})

function StudentLimitsDisclosure({
  permissions,
  used,
  disabled,
  onChange,
}: {
  permissions: TeamStudentPermissions
  used?: Partial<Record<StudentLimitPermissionKey, number>>
  disabled?: boolean
  onChange: (key: StudentLimitPermissionKey, value: number | null) => void
}) {
  const { tx, format } = useI18n()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const configuredCount = STUDENT_LIMIT_ROWS.filter(({ key }) => permissions[key] !== null).length
  const status = configuredCount === 0
    ? tx('team.capacityUnlimited')
    : format(tx('team.permissionLimitsConfigured'), { count: configuredCount })

  return (
    <div className={`team-permission-limit-section${open ? ' is-open' : ''}`}>
      <div className="team-permission-item team-permission-limit-item">
        <ShieldCheck className="team-permission-item-icon" size={13} aria-hidden="true" />
        <span className="team-permission-item-copy">
          <strong>{tx('team.permissionLimitsTitle')}</strong>
          <InfoTooltip
            content={tx('team.permissionLimitsHelp')}
            label={tx('team.permissionLimitsHelpLabel')}
          />
        </span>
        <button
          type="button"
          className="team-permission-limit-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${tx('team.permissionLimitsTitle')}: ${status}`}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <em>{status}</em>
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </div>
      <CollapsiblePanel
        id={panelId}
        open={open}
        keepMounted
        className="team-permission-limit-collapse"
        innerClassName="team-permission-limit-collapse-inner"
        openMs={340}
        closeMs={260}
      >
        <div className="team-permission-limit-guide">
          <span>{tx('team.permissionLimitsOptional')}</span>
          <strong>{tx('team.permissionMaximumAllowed')}</strong>
        </div>
        <div className="team-permission-limit-fields">
          {STUDENT_LIMIT_ROWS.map((limit) => {
            const value = permissions[limit.key]
            const currentUsed = used?.[limit.key]
            return (
              <div key={limit.key} className="team-permission-limit-field-row">
                <span className="team-permission-limit-field-copy">
                  <span>
                    <strong>{tx(limit.titleKey)}</strong>
                    <InfoTooltip content={tx(limit.descriptionKey)} />
                  </span>
                  {currentUsed !== undefined
                    ? <small>{format(tx('team.permissionLimitUsage'), { count: currentUsed })}</small>
                    : null}
                </span>
                <span className="team-permission-limit-control">
                  <PermissionLimitInput
                    key={`${limit.key}:${value ?? 'unlimited'}`}
                    value={value}
                    label={tx(limit.titleKey)}
                    disabled={disabled}
                    onChange={(next) => onChange(limit.key, next)}
                  />
                </span>
              </div>
            )
          })}
        </div>
      </CollapsiblePanel>
    </div>
  )
}

function RolePermissionSheet({
  role,
  title,
  permissions,
  saving,
  disabled = false,
  initialOpen = false,
  overrideCount,
  used,
  onBooleanChange,
  onLimitChange,
  onReset,
}: {
  role: 'student' | 'teacher'
  title: string
  permissions: TeamStudentPermissions | TeamTeacherPermissions
  saving: boolean
  disabled?: boolean
  initialOpen?: boolean
  overrideCount?: number
  used?: Partial<Record<StudentLimitPermissionKey, number>>
  onBooleanChange: (key: StudentBooleanPermissionKey | TeacherPermissionKey, value: boolean) => void
  onLimitChange?: (key: StudentLimitPermissionKey, value: number | null) => void
  onReset?: () => void
}) {
  const { tx, format } = useI18n()
  const [open, setOpen] = useState(initialOpen)
  const panelId = useId()
  const rows = role === 'student' ? STUDENT_PERMISSION_ROWS : TEACHER_PERMISSION_ROWS
  const enabledCount = rows.filter(({ key }) => Boolean(
    (permissions as unknown as Record<string, boolean | number | null>)[key],
  )).length
  const RoleIcon = role === 'student' ? GraduationCap : Users
  const status = overrideCount === undefined
    ? format(tx('team.permissionEnabledCount'), { enabled: enabledCount, total: rows.length })
    : overrideCount === 0
      ? tx('team.permissionFollowingDefault')
      : format(tx('team.permissionOverridesCount'), { count: overrideCount })

  return (
    <section className={`team-permission-role-sheet role-${role}${open ? ' is-open' : ''}`}>
      <header className="team-permission-role-head">
        <button
          type="button"
          className="team-permission-role-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="team-permission-role-icon">
            <RoleIcon size={14} aria-hidden="true" />
          </span>
          <span className="team-permission-role-copy">
            <strong>{title}</strong>
            <small>{status}</small>
          </span>
          <ChevronRight
            className="team-permission-role-chevron"
            size={14}
            aria-hidden="true"
          />
        </button>
        <span className="team-permission-role-actions">
          {overrideCount !== undefined && overrideCount > 0 && onReset ? (
            <button
              type="button"
              className="team-permission-reset"
              disabled={disabled}
              onClick={onReset}
            >
              <RotateCcw size={11} aria-hidden="true" />
              <span>{tx('team.permissionResetDefault')}</span>
            </button>
          ) : null}
          <SaveState saving={saving} />
        </span>
      </header>

      <CollapsiblePanel
        id={panelId}
        open={open}
        keepMounted
        className="team-permission-role-collapse"
        innerClassName="team-permission-role-collapse-inner"
        openMs={360}
        closeMs={280}
      >
        <div className="team-permission-list">
          {rows.map((permission) => {
            const checked = Boolean(
              (permissions as unknown as Record<string, boolean | number | null>)[permission.key],
            )
            const Icon = permission.icon
            return (
              <div key={permission.key} className="team-permission-item">
                <Icon className="team-permission-item-icon" size={13} aria-hidden="true" />
                <span className="team-permission-item-copy">
                  <strong>{tx(permission.titleKey)}</strong>
                  <InfoTooltip content={tx(permission.descriptionKey)} />
                </span>
                <PermissionSwitch
                  checked={checked}
                  label={tx(permission.titleKey)}
                  disabled={disabled}
                  onChange={() => onBooleanChange(permission.key, !checked)}
                />
              </div>
            )
          })}
          {role === 'student' && onLimitChange ? (
            <StudentLimitsDisclosure
              permissions={permissions as TeamStudentPermissions}
              used={used}
              disabled={disabled}
              onChange={onLimitChange}
            />
          ) : null}
        </div>
      </CollapsiblePanel>
    </section>
  )
}

export const TeamDefaultPermissionsEditor = memo(function TeamDefaultPermissionsEditor({
  defaults,
  onSave,
}: {
  defaults?: TeamPermissionDefaults | null
  onSave: (patch: {
    student?: Partial<TeamStudentPermissions>
    teacher?: Partial<TeamTeacherPermissions>
  }) => Promise<void>
}) {
  const { tx } = useI18n()
  const normalized = teamPermissionDefaults(defaults)
  const saveStudent = useCallback(async (patch: Partial<TeamStudentPermissions> | null) => {
    if (patch) await onSave({ student: patch })
  }, [onSave])
  const saveTeacher = useCallback(async (patch: Partial<TeamTeacherPermissions> | null) => {
    if (patch) await onSave({ teacher: patch })
  }, [onSave])
  const student = useQueuedPermissionDraft(normalized.student, saveStudent)
  const teacher = useQueuedPermissionDraft(normalized.teacher, saveTeacher)

  return (
    <div className="team-permission-default-editor">
      <div className="team-permission-default-note">
        <ShieldCheck size={13} aria-hidden="true" />
        <span>{tx('team.permissionDefaultsIntro')}</span>
      </div>
      <div className="team-permission-sheet-grid">
        <RolePermissionSheet
          role="student"
          title={tx('team.permissionStudentDefaultTitle')}
          permissions={student.draft}
          saving={student.saving}
          onBooleanChange={(key, value) => student.update(key as StudentBooleanPermissionKey, value)}
          onLimitChange={(key, value) => student.update(key, value)}
        />
        <RolePermissionSheet
          role="teacher"
          title={tx('team.permissionTeacherDefaultTitle')}
          permissions={teacher.draft}
          saving={teacher.saving}
          onBooleanChange={(key, value) => teacher.update(key as TeacherPermissionKey, value)}
        />
      </div>
    </div>
  )
})

type TeamMemberPermissionEditorProps = {
  role: 'member' | 'admin'
  relationships?: TeamMemberRelationships | null
  defaults?: TeamPermissionDefaults | null
  usage?: TeamMemberUsage | null
  activeApplications?: number
  activeShares?: number
  onSave: (
    patch: {
      studentPermissions?: Partial<TeamStudentPermissions> | null
      teacherPermissions?: Partial<TeamTeacherPermissions> | null
    },
  ) => Promise<void>
}

function StudentMemberPermissionEditor({
  relationships,
  defaults,
  usage,
  activeApplications,
  activeShares,
  onSave,
}: Omit<TeamMemberPermissionEditorProps, 'role'>) {
  const { tx } = useI18n()
  const effective = teamStudentPermissions(relationships, defaults)
  const overrideCount = Object.keys(relationships?.studentPermissions ?? {}).length
  const save = useCallback(async (patch: Partial<TeamStudentPermissions> | null) => {
    await onSave({ studentPermissions: patch })
  }, [onSave])
  const editor = useQueuedPermissionDraft(effective, save)
  const roleDefaults = teamPermissionDefaults(defaults).student
  const used = {
    activeApplicationLimit: activeApplications ?? 0,
    lifetimeApplicationLimit: usage?.applicationsCreated ?? 0,
    activeShareLimit: activeShares ?? 0,
    lifetimeShareLimit: usage?.sharesCreated ?? 0,
  }

  return (
    <RolePermissionSheet
      role="student"
      title={tx('team.permissionStudentTitle')}
      permissions={editor.draft}
      saving={editor.saving}
      overrideCount={overrideCount}
      used={used}
      onBooleanChange={(key, value) => editor.update(key as StudentBooleanPermissionKey, value)}
      onLimitChange={(key, value) => editor.update(key, value)}
      onReset={() => editor.reset(roleDefaults)}
    />
  )
}

function TeacherMemberPermissionEditor({
  relationships,
  defaults,
  onSave,
}: Omit<TeamMemberPermissionEditorProps, 'role'>) {
  const { tx } = useI18n()
  const effective = teamTeacherPermissions(relationships, defaults)
  const overrideCount = Object.keys(relationships?.teacherPermissions ?? {}).length
  const save = useCallback(async (patch: Partial<TeamTeacherPermissions> | null) => {
    await onSave({ teacherPermissions: patch })
  }, [onSave])
  const editor = useQueuedPermissionDraft(effective, save)
  const roleDefaults = teamPermissionDefaults(defaults).teacher

  return (
    <RolePermissionSheet
      role="teacher"
      title={tx('team.permissionTeacherTitle')}
      permissions={editor.draft}
      saving={editor.saving}
      overrideCount={overrideCount}
      onBooleanChange={(key, value) => editor.update(key as TeacherPermissionKey, value)}
      onReset={() => editor.reset(roleDefaults)}
    />
  )
}

export const TeamMemberPermissionEditor = memo(function TeamMemberPermissionEditor(
  props: TeamMemberPermissionEditorProps,
) {
  const { role, ...editorProps } = props
  return (
    <div className="team-permission-editor">
      {role === 'member'
        ? <StudentMemberPermissionEditor {...editorProps} />
        : <TeacherMemberPermissionEditor {...editorProps} />}
    </div>
  )
})
