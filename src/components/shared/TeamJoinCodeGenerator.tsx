import '../../styles/team-join-code.css'
import {
  Check,
  Clock3,
  GraduationCap,
  KeyRound,
  Link2,
  LoaderCircle,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { TeamJoinCode, TeamRole } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'
import { CopyButton } from './CopyButton'

type JoinCodeTeacher = {
  id: string
  userId: string | null
  displayName?: string
  invitedEmail: string
}

const EMPTY_TEACHER_IDS: string[] = []

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

  const selectRole = (nextRole: TeamRole) => {
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
              className="team-join-code-role-options"
              role="radiogroup"
              aria-label={tx('team.joinCodeRole')}
            >
              {roleOptions.map((option) => {
                const selected = option.value === role
                return (
                  <button
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
                    <b aria-hidden="true">{selected ? <Check size={12} /> : null}</b>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {role === 'member' ? (
          <div className="team-join-code-field">
            <span>{tx('team.joinCodeTeacherAssignment')}</span>
            <p>{tx('team.joinCodeTeacherAssignmentDescription')}</p>
            {teachers.length > 0 ? (
              <div className="team-join-code-teachers">
                {teachers.map((teacher) => {
                  const selected = teacherIds.includes(teacher.id)
                  return (
                    <button
                      key={teacher.id}
                      type="button"
                      className={selected ? 'selected' : ''}
                      onClick={() => toggleTeacher(teacher.id)}
                      aria-pressed={selected}
                    >
                      <span>{teacher.displayName || teacher.invitedEmail}</span>
                      {selected ? <Check size={13} aria-hidden="true" /> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="team-join-code-empty">
                <Users size={15} aria-hidden="true" />
                <span>{tx('team.joinCodeNoTeachers')}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {error ? <p className="team-join-code-error" role="alert">{error}</p> : null}

      <button
        type="button"
        className="primary-action team-join-code-submit"
        onClick={handleGenerate}
        disabled={busy || (role === 'member' && teachers.length === 0)}
      >
        {busy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
        {busy ? tx('team.joinCodeGenerating') : tx('team.joinCodeGenerate')}
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
