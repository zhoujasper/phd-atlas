import '../../styles/ai.css'
import { BrainCircuit, Pencil, Save, Sparkles, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { AiUserProfile, UserSettingsPatch } from '../../api/phdApi'
import { registerSafeReloadGuard } from '../../safeReload'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { PendingLabel } from './PendingLabel'
import { clearAiProfileDraft, loadAiProfileDraft, saveAiProfileDraft } from './profileResidentDraftStorage'

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
  // Keep browser limits aligned with the server contract: long academic
  // narratives should never be silently truncated before they can be saved.
  preferredName: 120,
  currentRole: 160,
  institution: 200,
  field: 160,
  researchInterests: 4000,
  achievements: 4000,
  goals: 3000,
  writingLanguage: 40,
  writingTone: 120,
  boundaries: 2000,
}

export function AiProfilePanel({
  value,
  onUpdate,
  draftUserId,
}: {
  value?: AiUserProfile
  onUpdate: (
    patch: UserSettingsPatch,
    message?: string,
    options?: { throwOnError?: boolean },
  ) => void | Promise<void>
  draftUserId?: string
}) {
  const { tx, format } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AiUserProfile>({ ...blankProfile, ...value })
  const [saving, setSaving] = useState(false)
  const dialogId = useId()
  const preferredNameRef = useRef<HTMLInputElement | null>(null)
  const residentEditorOpenRef = useRef(false)
  const residentBaselineRef = useRef<AiUserProfile>({ ...blankProfile, ...value })
  const draftRef = useRef(draft)
  const draftUserIdRef = useRef(draftUserId ?? '')
  const dirtyForReloadRef = useRef(false)
  const draftSettledRef = useRef(false)
  const reloadGuardId = useId()

  useEffect(() => {
    const canonical = { ...blankProfile, ...value }
    if (open) {
      if (residentEditorOpenRef.current) return
      residentEditorOpenRef.current = true
      draftSettledRef.current = false
      residentBaselineRef.current = canonical
      setDraft(draftUserId ? loadAiProfileDraft(draftUserId) ?? canonical : canonical)
      setSaving(false)
      return
    }
    residentEditorOpenRef.current = false
    residentBaselineRef.current = canonical
    setDraft(canonical)
    setSaving(false)
  }, [draftUserId, open, value])

  const draftDirty = open && JSON.stringify(draft) !== JSON.stringify(residentBaselineRef.current)
  draftRef.current = draft
  draftUserIdRef.current = draftUserId ?? ''
  dirtyForReloadRef.current = draftDirty || saving

  const persistResidentDraft = () => {
    if (draftSettledRef.current || !dirtyForReloadRef.current) return true
    const userId = draftUserIdRef.current
    return Boolean(userId) && saveAiProfileDraft(userId, draftRef.current)
  }

  const settleResidentDraft = () => {
    draftSettledRef.current = true
    const userId = draftUserIdRef.current
    return userId ? clearAiProfileDraft(userId) : true
  }

  useEffect(() => {
    const userId = draftUserIdRef.current
    if (!open || !userId || draftSettledRef.current) return
    const timer = window.setTimeout(() => {
      if (draftSettledRef.current) return
      if (draftDirty) saveAiProfileDraft(userId, draft)
      else clearAiProfileDraft(userId)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [draft, draftDirty, open])

  useEffect(() => registerSafeReloadGuard(`ai-profile:${reloadGuardId}`, {
    prepare: persistResidentDraft,
    hasUnsavedChanges: () => dirtyForReloadRef.current,
  }), [reloadGuardId])

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
    settleResidentDraft()
    setDraft({ ...blankProfile, ...value })
    setOpen(false)
  }
  const { exiting, requestClose } = useAnimatedClose(open, closeDialog)
  const dialogRef = useModalA11y<HTMLElement>({
    open,
    onClose: () => {
      if (!saving) requestClose()
    },
    initialFocusRef: preferredNameRef,
  })

  const saveProfile = async () => {
    if (saving) return
    setSaving(true)
    try {
      await Promise.resolve(onUpdate(
        { aiProfile: draft },
        tx('profile.aiProfileSaved'),
        { throwOnError: true },
      ))
      settleResidentDraft()
      requestClose()
    } catch {
      // The parent owns the localized error toast. Keep the draft mounted for
      // a retry when the settings write is rejected.
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`ai-profile-panel ${open ? 'expanded' : ''}`} aria-label={tx('profile.aiProfileTitle')}>
      <button type="button" className="ai-profile-summary" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} onClick={() => setOpen(true)} data-tour="ai-profile-summary">
        <span className="ai-profile-icon" aria-hidden="true"><BrainCircuit size={15} /></span>
        <span className="ai-profile-copy">
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
          <Pencil className="ai-profile-edit-icon" size={14} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <ModalPortal>
          <div className={`dialog-layer${exiting ? ' exiting' : ''}`} onClick={(event) => { if (event.target === event.currentTarget && !saving) requestClose() }}>
            <section ref={dialogRef} id={dialogId} className="new-dialog ai-profile-dialog" role="dialog" aria-modal="true" aria-label={tx('profile.aiProfileTitle')} aria-busy={saving || undefined}>
              <div className="dialog-head">
                <div>
                  <span className="eyebrow">{tx('profile.aiProfileEyebrow')}</span>
                  <h2>{tx('profile.aiProfileTitle')}</h2>
                </div>
                <button type="button" className="icon-action" onClick={() => { if (!saving) requestClose() }} disabled={saving} aria-label={tx('close')}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="ai-profile-disclosure">
                <Sparkles size={14} aria-hidden="true" />
                <span>{tx('profile.aiProfileDisclosure')}</span>
              </div>
                <form className="ai-profile-form" onSubmit={(event) => { event.preventDefault(); void saveProfile() }}>
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
                  <button type="button" className="secondary-action" onClick={() => requestClose()} disabled={saving}>{tx('profile.aiProfileCancel')}</button>
                  <button type="submit" className="primary-action" disabled={saving} aria-busy={saving || undefined}>
                    {saving ? <PendingLabel label={tx('working')} /> : <><Save size={13} aria-hidden="true" /> {tx('profile.aiProfileSave')}</>}
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
