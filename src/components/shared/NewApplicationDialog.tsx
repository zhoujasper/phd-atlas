import { X, Plus, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { today } from '../../appModel'
import { DatePicker } from './DatePicker'
import { Select } from './Select'
import { LazyMarkdownTextarea as MarkdownTextarea } from './LazyMarkdownTextarea'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'

export type NewApplicationTeamMode = 'none' | 'student-toggle' | 'team-self' | 'team-student-picker'

export type NewApplicationStudentOption = {
  id: string
  name: string
  email?: string
  advisorName?: string | null
  count?: number
}

export function NewApplicationDialog({
  open,
  busy,
  onClose,
  onCreate,
  teamMode = 'none',
  studentOptions = [],
  defaultStudentId,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onCreate: (input: {
    professor: string
    professorChinese: string
    professorEmail: string
    professorHomepage: string
    university: string
    country: string
    website: string
    program: string
    deadline: string
    notes: string
    visibleToTeam: boolean
    ownerId?: string
  }) => void | boolean | Promise<void | boolean>
  teamMode?: NewApplicationTeamMode
  studentOptions?: NewApplicationStudentOption[]
  defaultStudentId?: string | null
}) {
  const { tx } = useI18n()
  const professorInputRef = useRef<HTMLInputElement>(null)
  const defaultOwnerId = teamMode === 'team-student-picker'
    ? (defaultStudentId && studentOptions.some((student) => student.id === defaultStudentId)
      ? defaultStudentId
      : studentOptions[0]?.id ?? '')
    : ''

  const blankForm = () => ({
    professor: '',
    professorChinese: '',
    professorEmail: '',
    professorHomepage: '',
    university: '',
    country: tx('dialog.countryDefault'),
    website: '',
    program: '',
    deadline: today,
    notes: '',
    visibleToTeam: false,
    ownerId: defaultOwnerId,
  })

  const [form, setForm] = useState(blankForm)
  const selectedStudent = teamMode === 'team-student-picker'
    ? studentOptions.find((student) => student.id === form.ownerId) ?? null
    : null
  const submitLabel = teamMode === 'team-student-picker'
    ? tx('dialog.teamCreateForStudent')
    : teamMode === 'team-self'
      ? tx('dialog.teamCreateAsStudent')
      : tx('dialog.create')

  const teamAssignmentPanel = teamMode === 'team-student-picker' ? (
    <div className="new-dialog-team-assignment wide">
      <div className="new-dialog-team-assignment-head">
        <Users size={15} aria-hidden="true" />
        <span>{tx('dialog.teamCreateForStudent')}</span>
      </div>
      {studentOptions.length > 0 ? (
        <>
          <Select
            searchable
            value={form.ownerId}
            options={studentOptions.map((student) => ({
              value: student.id,
              label: student.name,
              description: [
                student.email,
                student.advisorName ? `${tx('dialog.teamAdvisor')} ${student.advisorName}` : null,
                typeof student.count === 'number' ? tx('dialog.teamStudentApplicationCount').replace('{count}', String(student.count)) : null,
              ].filter(Boolean).join(' · '),
            }))}
            ariaLabel={tx('dialog.teamOwner')}
            onChange={(ownerId) => setForm({ ...form, ownerId })}
          />
          {selectedStudent ? (
            <div className="new-dialog-student-context">
              <span>
                <small>{tx('dialog.teamStudentLabel')}</small>
                <strong>{selectedStudent.name}</strong>
                {selectedStudent.email ? <em>{selectedStudent.email}</em> : null}
              </span>
              <span>
                <small>{tx('dialog.teamAdvisor')}</small>
                <strong>{selectedStudent.advisorName || tx('dialog.teamAdvisorMissing')}</strong>
                <em>{tx('dialog.teamVisibilityLocked')}</em>
              </span>
              <span>
                <small>{tx('dialog.teamExistingApplications')}</small>
                <strong>{tx('dialog.teamStudentApplicationCount').replace('{count}', String(selectedStudent.count ?? 0))}</strong>
                <em>{tx('dialog.teamCreateContextHint')}</em>
              </span>
            </div>
          ) : null}
          <small>{tx('dialog.teamCreateForStudentHint')}</small>
        </>
      ) : (
        <small>{tx('dialog.teamNoStudents')}</small>
      )}
    </div>
  ) : teamMode === 'team-self' ? (
    <div className="new-dialog-team-assignment wide">
      <div className="new-dialog-team-assignment-head">
        <Users size={15} aria-hidden="true" />
        <span>{tx('dialog.teamCreateAsStudent')}</span>
      </div>
      <small>{tx('dialog.teamCreateAsStudentHint')}</small>
    </div>
  ) : null

  const { exiting, requestClose } = useAnimatedClose(open, () => {
    setForm(blankForm())
    onClose()
  })
  const resetAndClose = () => requestClose()

  const dialogRef = useModalA11y({ open: open && !exiting, onClose: resetAndClose, initialFocusRef: professorInputRef })

  if (!open) return null

  return (
    <ModalPortal>
      <div className={`dialog-layer${exiting ? ' exiting' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) resetAndClose() }}>
      <section ref={dialogRef} className="new-dialog" role="dialog" aria-modal="true" aria-label={tx('dialog.title')}>
        <div className="dialog-head">
          <div>
            <span className="eyebrow">{tx('dialog.newRecord')}</span>
            <h2>{tx('dialog.title')}</h2>
          </div>
          <button type="button" className="icon-action" onClick={resetAndClose} aria-label={tx('dialog.close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const succeeded = await onCreate({
              ...form,
              visibleToTeam: teamMode === 'team-self' || teamMode === 'team-student-picker'
                ? true
                : form.visibleToTeam,
              ownerId: teamMode === 'team-student-picker' ? form.ownerId : undefined,
            })
            if (succeeded !== false) requestClose()
          }}
        >
          {teamAssignmentPanel}
          <label>
            <span>{tx('dialog.professor')} *</span>
            <input
              ref={professorInputRef}
              required
              value={form.professor}
              onChange={(e) => setForm({ ...form, professor: e.target.value })}
              placeholder={tx('dialog.professorPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dialog.email')} *</span>
            <input
              required
              type="email"
              value={form.professorEmail}
              onChange={(e) => setForm({ ...form, professorEmail: e.target.value })}
              placeholder={tx('dialog.emailPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dialog.homepage')}</span>
            <input
              value={form.professorHomepage}
              onChange={(e) => setForm({ ...form, professorHomepage: e.target.value })}
              placeholder={tx('dialog.urlPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dialog.university')} *</span>
            <input
              required
              value={form.university}
              onChange={(e) => setForm({ ...form, university: e.target.value })}
              placeholder={tx('dialog.universityPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dialog.country')}</span>
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              placeholder={tx('dialog.countryPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dialog.website')}</span>
            <input
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder={tx('dialog.urlPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dialog.program')} *</span>
            <input
              required
              value={form.program}
              onChange={(e) => setForm({ ...form, program: e.target.value })}
              placeholder={tx('dialog.programPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dialog.deadline')}</span>
            <DatePicker
              value={form.deadline}
              onChange={(v) => setForm({ ...form, deadline: v })}
              placeholder={tx('dialog.deadlinePlaceholder')}
            />
          </label>
          <label className="wide">
            <span>{tx('dialog.notes')}</span>
            <MarkdownTextarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder={tx('dialog.notesPlaceholder')}
            />
          </label>
          {teamMode === 'student-toggle' ? (
            <label className="new-dialog-checkbox-row">
              <input
                type="checkbox"
                checked={form.visibleToTeam}
                onChange={(e) => setForm({ ...form, visibleToTeam: e.target.checked })}
              />
              <span>{tx('dossier.visibleToTeam')}</span>
              <small>{tx('dossier.visibleToTeamHint')}</small>
            </label>
          ) : null}
          <button type="submit" className="primary-action" disabled={busy || (teamMode === 'team-student-picker' && !form.ownerId)}>
            {busy ? (
              tx('dialog.creating')
            ) : (
              <>
                <Plus size={16} aria-hidden="true" /> {submitLabel}
              </>
            )}
          </button>
        </form>
      </section>
      </div>
    </ModalPortal>
  )
}
