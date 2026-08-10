import { X, Plus, Users } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { today } from '../../appModel'
import { registerSafeReloadGuard } from '../../safeReload'
import { DatePicker } from './DatePicker'
import { Select } from './Select'
import { CountrySelect } from './CountrySelect'
import { LazyMarkdownTextarea as MarkdownTextarea } from './LazyMarkdownTextarea'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { flashInvalidField } from './invalidFieldFlash'
import {
  clearRecoverableNewApplicationDraft,
  loadRecoverableNewApplicationDraft,
  saveRecoverableNewApplicationDraft,
  type NewApplicationDraftScope,
  type RecoverableNewApplicationDraft,
} from './newApplicationDraftStorage'

export type NewApplicationTeamMode = 'none' | 'student-toggle' | 'team-self' | 'team-student-picker'

export type NewApplicationDraftIdentity = Pick<NewApplicationDraftScope, 'userId' | 'workspaceId'>

export type NewApplicationStudentOption = {
  id: string
  name: string
  email?: string
  avatarUrl?: string | null
  advisorName?: string | null
  count?: number
}

function errorField(error: unknown) {
  if (!error || typeof error !== 'object' || !('field' in error)) return null
  const field = (error as { field?: unknown }).field
  return typeof field === 'string' && field.trim() ? field : null
}

export function NewApplicationDialog({
  open,
  busy,
  onClose,
  onCreate,
  teamMode = 'none',
  studentOptions = [],
  defaultStudentId,
  draftIdentity,
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
  draftIdentity?: NewApplicationDraftIdentity
}) {
  const { tx } = useI18n()
  const professorInputRef = useRef<HTMLInputElement>(null)
  const defaultOwnerId = teamMode === 'team-student-picker'
    ? (defaultStudentId && studentOptions.some((student) => student.id === defaultStudentId)
      ? defaultStudentId
      : studentOptions[0]?.id ?? '')
    : ''

  const blankForm = (): RecoverableNewApplicationDraft => ({
    professor: '',
    professorChinese: '',
    professorEmail: '',
    professorHomepage: '',
    university: '',
    country: '',
    website: '',
    program: '',
    deadline: today,
    notes: '',
    visibleToTeam: false,
    ownerId: defaultOwnerId,
  })

  const draftScope: NewApplicationDraftScope | null = draftIdentity
    ? { ...draftIdentity, teamMode }
    : null
  const initialForm = () => {
    const blank = blankForm()
    if (!draftScope) return blank
    const recovered = loadRecoverableNewApplicationDraft(draftScope)
    if (!recovered) return blank
    return {
      ...blank,
      ...recovered,
      ownerId: teamMode === 'team-student-picker'
        ? (studentOptions.some((student) => student.id === recovered.ownerId) ? recovered.ownerId : blank.ownerId)
        : '',
    }
  }
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [invalidField, setInvalidField] = useState<string | null>(null)
  const reloadGuardId = useId()
  const formRef = useRef(form)
  const draftScopeRef = useRef(draftScope)
  const dirtyForReloadRef = useRef(false)
  const draftSettledRef = useRef(false)
  const isBusy = busy || submitting
  const baseline = blankForm()
  const isDirty = JSON.stringify(form) !== JSON.stringify(baseline)
  formRef.current = form
  draftScopeRef.current = draftScope
  dirtyForReloadRef.current = isDirty || submitting
  const selectedStudent = teamMode === 'team-student-picker'
    ? studentOptions.find((student) => student.id === form.ownerId) ?? null
    : null
  const submitLabel = teamMode === 'team-student-picker'
    ? tx('dialog.teamCreateForStudent')
    : teamMode === 'team-self'
      ? tx('dialog.teamCreateAsStudent')
      : tx('dialog.create')

  const updateForm = (patch: Partial<RecoverableNewApplicationDraft>) => {
    setInvalidField(null)
    setForm((current) => ({ ...current, ...patch }))
  }

  const fieldProps = (path: string, baseClass = '') => ({
    'data-field-path': path,
    className: [baseClass, invalidField === path ? 'field-has-error' : ''].filter(Boolean).join(' ') || undefined,
  })

  const fieldIsInvalid = (path: string) => invalidField === path

  const persistResidentDraft = () => {
    const scope = draftScopeRef.current
    if (!scope || draftSettledRef.current || !dirtyForReloadRef.current) return true
    return saveRecoverableNewApplicationDraft(scope, formRef.current)
  }

  const clearResidentDraft = () => {
    draftSettledRef.current = true
    const scope = draftScopeRef.current
    return scope ? clearRecoverableNewApplicationDraft(scope) : true
  }

  useEffect(() => {
    const scope = draftScopeRef.current
    if (!scope || draftSettledRef.current) return
    const timer = window.setTimeout(() => {
      if (draftSettledRef.current) return
      if (isDirty) saveRecoverableNewApplicationDraft(scope, form)
      else clearRecoverableNewApplicationDraft(scope)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [form, isDirty])

  useEffect(() => registerSafeReloadGuard(`new-application:${reloadGuardId}`, {
    prepare: persistResidentDraft,
    hasUnsavedChanges: () => dirtyForReloadRef.current,
  }), [reloadGuardId])

  useEffect(() => {
    if (invalidField) flashInvalidField(invalidField)
  }, [invalidField])

  useEffect(() => {
    const persist = () => {
      persistResidentDraft()
    }
    window.addEventListener('beforeunload', persist)
    window.addEventListener('pagehide', persist)
    return () => {
      window.removeEventListener('beforeunload', persist)
      window.removeEventListener('pagehide', persist)
      persist()
    }
  }, [])

  const teamAssignmentPanel = teamMode === 'team-student-picker' ? (
    <div className="new-dialog-team-assignment wide">
      <div className="new-dialog-team-assignment-head">
        <Users size={15} aria-hidden="true" />
        <span>{tx('dialog.teamCreateForStudent')} <span className="field-required-mark" aria-hidden="true">*</span></span>
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
             onChange={(ownerId) => updateForm({ ownerId })}
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
    setSubmitting(false)
    setInvalidField(null)
    onClose()
  })
  const resetAndClose = () => {
    if (isBusy) return
    clearResidentDraft()
    requestClose()
  }

  const dialogRef = useModalA11y({ open, onClose: resetAndClose, initialFocusRef: professorInputRef })

  if (!open) return null

  return (
    <ModalPortal>
      <div className={`dialog-layer${exiting ? ' exiting' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) resetAndClose() }}>
      <section ref={dialogRef} className="new-dialog" role="dialog" aria-modal="true" aria-label={tx('dialog.title')} aria-busy={isBusy || undefined}>
        <div className="dialog-head">
          <div>
            <span className="eyebrow">{tx('dialog.newRecord')}</span>
            <h2>{tx('dialog.title')}</h2>
          </div>
          <button type="button" className="icon-action" onClick={resetAndClose} disabled={isBusy} aria-label={tx('dialog.close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (isBusy) return
            setSubmitting(true)
            try {
              const succeeded = await onCreate({
                ...form,
                visibleToTeam: teamMode === 'team-self' || teamMode === 'team-student-picker'
                  ? true
                  : form.visibleToTeam,
                ownerId: teamMode === 'team-student-picker' ? form.ownerId : undefined,
              })
              if (succeeded !== false) {
                clearResidentDraft()
                requestClose()
              }
            } catch (error) {
              setInvalidField(errorField(error))
              // The parent normally reports the localized failure. Keeping the
              // dialog mounted here guarantees the draft remains retryable for
              // direct callers that reject instead of returning false.
            } finally {
              setSubmitting(false)
            }
          }}
        >
           {teamAssignmentPanel}
           <label {...fieldProps('professor')}>
             <span>{tx('dialog.professor')} <span className="field-required-mark">*</span></span>
             <input
               ref={professorInputRef}
               required
               value={form.professor}
               aria-invalid={fieldIsInvalid('professor') || undefined}
               onChange={(e) => updateForm({ professor: e.target.value })}
               placeholder={tx('dialog.professorPlaceholder')}
             />
           </label>
           <label {...fieldProps('professorEmail')}>
             <span>{tx('dialog.email')} <span className="field-required-mark">*</span></span>
             <input
               required
               type="email"
               value={form.professorEmail}
               aria-invalid={fieldIsInvalid('professorEmail') || undefined}
               onChange={(e) => updateForm({ professorEmail: e.target.value })}
               placeholder={tx('dialog.emailPlaceholder')}
             />
           </label>
           <label {...fieldProps('professorHomepage')}>
             <span>{tx('dialog.homepage')}</span>
             <input
               type="url"
               value={form.professorHomepage}
               aria-invalid={fieldIsInvalid('professorHomepage') || undefined}
               onChange={(e) => updateForm({ professorHomepage: e.target.value })}
               placeholder={tx('dialog.urlPlaceholder')}
             />
           </label>
           <label {...fieldProps('university')}>
             <span>{tx('dialog.university')} <span className="field-required-mark">*</span></span>
             <input
               required
               value={form.university}
               aria-invalid={fieldIsInvalid('university') || undefined}
               onChange={(e) => updateForm({ university: e.target.value })}
               placeholder={tx('dialog.universityPlaceholder')}
             />
           </label>
           <label {...fieldProps('country')}>
             <span>{tx('dialog.country')}</span>
             <CountrySelect
               value={form.country}
               onChange={(country) => updateForm({ country })}
               ariaLabel={tx('dialog.country')}
               placeholder={tx('dossier.countryPlaceholder')}
             />
           </label>
           <label {...fieldProps('website')}>
             <span>{tx('dialog.website')}</span>
             <input
               type="url"
               value={form.website}
               aria-invalid={fieldIsInvalid('website') || undefined}
               onChange={(e) => updateForm({ website: e.target.value })}
               placeholder={tx('dialog.urlPlaceholder')}
             />
           </label>
           <label {...fieldProps('program')}>
             <span>{tx('dialog.program')} <span className="field-required-mark">*</span></span>
             <input
               required
               value={form.program}
               aria-invalid={fieldIsInvalid('program') || undefined}
               onChange={(e) => updateForm({ program: e.target.value })}
               placeholder={tx('dialog.programPlaceholder')}
             />
           </label>
           <label {...fieldProps('deadline')}>
             <span>{tx('dialog.deadline')}</span>
             <DatePicker
               value={form.deadline}
               onChange={(v) => updateForm({ deadline: v })}
               placeholder={tx('dialog.deadlinePlaceholder')}
             />
           </label>
           <div {...fieldProps('notes', 'wide')}>
             <span>{tx('dialog.notes')}</span>
             <MarkdownTextarea
               value={form.notes}
               onChange={(e) => updateForm({ notes: e.target.value })}
               rows={3}
               aria-invalid={fieldIsInvalid('notes') || undefined}
               aria-label={tx('dialog.notes')}
               placeholder={tx('dialog.notesPlaceholder')}
             />
          </div>
          {teamMode === 'student-toggle' ? (
            <label className="new-dialog-checkbox-row">
              <input
                 type="checkbox"
                 checked={form.visibleToTeam}
                 onChange={(e) => updateForm({ visibleToTeam: e.target.checked })}
               />
              <span>{tx('dossier.visibleToTeam')}</span>
              <small>{tx('dossier.visibleToTeamHint')}</small>
            </label>
          ) : null}
          <button type="submit" className="primary-action" disabled={isBusy || (teamMode === 'team-student-picker' && !form.ownerId)}>
            {isBusy ? (
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
