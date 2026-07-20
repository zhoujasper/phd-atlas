import { BrainCircuit, Pencil, Save, Sparkles, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { AiUserProfile, UserSettingsPatch } from '../../api/phdApi'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'

const blankProfile: AiUserProfile = {
  preferredName: '', pronouns: '', location: '', timezone: '', citizenship: '',
  currentRole: '', institution: '', degree: '', field: '', graduation: '',
  researchInterests: '', researchMethods: '', achievements: '', goals: '',
  writingLanguage: '', writingTone: '', signature: '', boundaries: '',
}

const backgroundFields: Array<keyof AiUserProfile> = ['preferredName', 'currentRole', 'institution', 'field']
const researchFields: Array<keyof AiUserProfile> = ['researchInterests', 'achievements', 'goals']
const writingFields: Array<keyof AiUserProfile> = ['writingLanguage', 'writingTone', 'boundaries']
const textareaFields = new Set<keyof AiUserProfile>(['researchInterests', 'achievements', 'goals'])
const wideFields = new Set<keyof AiUserProfile>(['researchInterests'])
const completionGroups: Array<Array<keyof AiUserProfile>> = [
  ['preferredName'],
  ['currentRole', 'institution', 'field'],
  ['researchInterests'],
  ['achievements'],
  ['goals'],
  ['writingLanguage', 'writingTone'],
]

const fieldMaxLengths: Partial<Record<keyof AiUserProfile, number>> = {
  preferredName: 80,
  currentRole: 120,
  institution: 160,
  field: 120,
  researchInterests: 360,
  achievements: 360,
  goals: 320,
  writingLanguage: 80,
  writingTone: 120,
  boundaries: 240,
}

export function AiProfilePanel({
  value,
  onUpdate,
}: {
  value?: AiUserProfile
  onUpdate: (patch: UserSettingsPatch, message?: string) => void
}) {
  const { tx, format } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AiUserProfile>({ ...blankProfile, ...value })
  const dialogId = useId()
  const preferredNameRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDraft({ ...blankProfile, ...value })
  }, [value])

  const completedGroups = completionGroups.filter((fields) => fields.every((field) => draft[field].trim())).length
  const completion = Math.round((completedGroups / completionGroups.length) * 100)
  const completionLabel = format(tx('profile.aiProfileCompletionCount'), { completed: completedGroups, total: completionGroups.length })
  const update = (field: keyof AiUserProfile, next: string) => setDraft((current) => ({ ...current, [field]: next }))
  const label = (field: keyof AiUserProfile) => tx(`profile.aiProfileFields.${field}`)
  const placeholder = (field: keyof AiUserProfile) => tx(`profile.aiProfilePlaceholders.${field}`)

  const fieldControl = (field: keyof AiUserProfile) => (
    <label
      key={field}
      className={`ai-profile-field ${wideFields.has(field) ? 'wide' : ''}`}
      data-tour={field === 'preferredName' ? 'ai-profile-first-field' : undefined}
    >
      <span>{label(field)}</span>
      {textareaFields.has(field) ? (
        <textarea value={draft[field]} onChange={(event) => update(field, event.target.value)} placeholder={placeholder(field)} rows={3} maxLength={fieldMaxLengths[field]} />
      ) : (
        <input ref={field === 'preferredName' ? preferredNameRef : undefined} value={draft[field]} onChange={(event) => update(field, event.target.value)} placeholder={placeholder(field)} maxLength={fieldMaxLengths[field]} />
      )}
    </label>
  )

  const closeDialog = () => {
    setDraft({ ...blankProfile, ...value })
    setOpen(false)
  }
  const { exiting, requestClose } = useAnimatedClose(open, closeDialog)
  const dialogRef = useModalA11y<HTMLElement>({
    open: open && !exiting,
    onClose: () => requestClose(),
    initialFocusRef: preferredNameRef,
  })

  const saveProfile = () => {
    onUpdate({ aiProfile: draft }, tx('profile.aiProfileSaved'))
    requestClose()
  }

  return (
    <section className={`ai-profile-panel ${open ? 'expanded' : ''}`} aria-label={tx('profile.aiProfileTitle')}>
      <button type="button" className="ai-profile-summary" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} onClick={() => setOpen(true)} data-tour="ai-profile-summary">
        <span className="ai-profile-icon" aria-hidden="true"><BrainCircuit size={17} /></span>
        <span className="ai-profile-copy">
          <span className="eyebrow">{tx('profile.aiProfileEyebrow')}</span>
          <strong>{tx('profile.aiProfileTitle')}</strong>
        </span>
        <span className="ai-profile-summary-meta">
          <span
            className="ai-profile-progress"
            style={{ '--profile-completion': `${completion}%` } as CSSProperties}
            aria-label={completionLabel}
          >
            <strong>{completion}%</strong>
          </span>
          <Pencil className="ai-profile-edit-icon" size={15} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <ModalPortal>
          <div className={`dialog-layer${exiting ? ' exiting' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}>
            <section ref={dialogRef} id={dialogId} className="new-dialog ai-profile-dialog" role="dialog" aria-modal="true" aria-label={tx('profile.aiProfileTitle')}>
              <div className="dialog-head">
                <div>
                  <span className="eyebrow">{tx('profile.aiProfileEyebrow')}</span>
                  <h2>{tx('profile.aiProfileTitle')}</h2>
                </div>
                <button type="button" className="icon-action" onClick={() => requestClose()} aria-label={tx('close')}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="ai-profile-disclosure">
                <Sparkles size={14} aria-hidden="true" />
                <span>{tx('profile.aiProfileDisclosure')}</span>
              </div>
              <form className="ai-profile-form" onSubmit={(event) => { event.preventDefault(); saveProfile() }}>
                <div className="ai-profile-section">
                  <div><span className="eyebrow">{tx('profile.aiProfileIdentityEyebrow')}</span><h3>{tx('profile.aiProfileIdentityTitle')}</h3></div>
                  <div className="ai-profile-grid">{backgroundFields.map(fieldControl)}</div>
                </div>
                <div className="ai-profile-section">
                  <div><span className="eyebrow">{tx('profile.aiProfileNarrativeEyebrow')}</span><h3>{tx('profile.aiProfileNarrativeTitle')}</h3></div>
                  <div className="ai-profile-grid">{researchFields.map(fieldControl)}</div>
                </div>
                <div className="ai-profile-section">
                  <div><span className="eyebrow">{tx('profile.aiProfileWritingEyebrow')}</span><h3>{tx('profile.aiProfileWritingTitle')}</h3></div>
                  <div className="ai-profile-grid">{writingFields.map(fieldControl)}</div>
                </div>
                <div className="ai-profile-actions">
                  <button type="button" className="secondary-action" onClick={() => requestClose()}>{tx('profile.aiProfileCancel')}</button>
                  <button type="submit" className="primary-action">
                    <Save size={13} aria-hidden="true" /> {tx('profile.aiProfileSave')}
                  </button>
                </div>
              </form>
            </section>
          </div>
        </ModalPortal>
      ) : null}
    </section>
  )
}
