import { Save, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { UserSettingsPatch } from '../../api/phdApi'
import { registerSafeReloadGuard } from '../../safeReload'
import {
  contentLanguagesFromSettings,
  isCjkContentLanguage,
  phrasePlaceholder,
  type ContentLanguagePair,
} from '../../contentLanguages'
import { languageLabel, t as translate, tpl } from '../../i18n'
import { useContentLanguagePacks, useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { LazyMarkdownTextarea as MarkdownTextarea } from './LazyMarkdownTextarea'
import { InfoTooltip } from './InfoTooltip'
import { PendingLabel } from './PendingLabel'
import {
  clearSnippetPhraseDraft,
  loadSnippetPhraseDraft,
  saveSnippetPhraseDraft,
  type RecoverableSnippetPhraseDraft,
} from './profileResidentDraftStorage'

export type SnippetPhraseSettings = {
  leadZh: string
  tailZh: string
  leadEn: string
  tailEn: string
}

export function SnippetPhraseSettingsDialog({
  open,
  settings,
  contentLanguages,
  draftUserId,
  onClose,
  onSave,
}: {
  open: boolean
  settings: SnippetPhraseSettings
  /** Account content-language pair — labels the dual phrase columns. */
  contentLanguages?: ContentLanguagePair | null
  draftUserId?: string
  onClose: () => void
  onSave: (patch: UserSettingsPatch) => void | Promise<void>
}) {
  const { tx, format } = useI18n()
  const pair = useMemo(
    () => contentLanguages ?? contentLanguagesFromSettings(null),
    [contentLanguages],
  )
  const contentPackVersion = useContentLanguagePacks(pair)
  const initialRecoveredDraftRef = useRef(draftUserId ? loadSnippetPhraseDraft(draftUserId) : null)
  // En fields = primary language, Zh fields = secondary language.
  const [leadPrimary, setLeadPrimary] = useState(initialRecoveredDraftRef.current?.leadPrimary ?? settings.leadEn)
  const [tailPrimary, setTailPrimary] = useState(initialRecoveredDraftRef.current?.tailPrimary ?? settings.tailEn)
  const [leadSecondary, setLeadSecondary] = useState(initialRecoveredDraftRef.current?.leadSecondary ?? settings.leadZh)
  const [tailSecondary, setTailSecondary] = useState(initialRecoveredDraftRef.current?.tailSecondary ?? settings.tailZh)
  const [saving, setSaving] = useState(false)
  const leadPrimaryRef = useRef<HTMLTextAreaElement | null>(null)
  const residentOpenRef = useRef(false)
  const residentBaselineRef = useRef<RecoverableSnippetPhraseDraft>({
    leadPrimary: settings.leadEn,
    tailPrimary: settings.tailEn,
    leadSecondary: settings.leadZh,
    tailSecondary: settings.tailZh,
  })
  const draftRef = useRef<RecoverableSnippetPhraseDraft>(residentBaselineRef.current)
  const draftUserIdRef = useRef(draftUserId ?? '')
  const dirtyForReloadRef = useRef(false)
  const draftSettledRef = useRef(false)
  const reloadGuardId = useId()
  void contentPackVersion

  useEffect(() => {
    if (!open) {
      residentOpenRef.current = false
      setSaving(false)
      return
    }
    if (residentOpenRef.current) return
    residentOpenRef.current = true
    draftSettledRef.current = false
    const canonical = {
      leadPrimary: settings.leadEn,
      tailPrimary: settings.tailEn,
      leadSecondary: settings.leadZh,
      tailSecondary: settings.tailZh,
    }
    residentBaselineRef.current = canonical
    const recovered = draftUserId ? loadSnippetPhraseDraft(draftUserId) : null
    setLeadPrimary(recovered?.leadPrimary ?? canonical.leadPrimary)
    setTailPrimary(recovered?.tailPrimary ?? canonical.tailPrimary)
    setLeadSecondary(recovered?.leadSecondary ?? canonical.leadSecondary)
    setTailSecondary(recovered?.tailSecondary ?? canonical.tailSecondary)
    setSaving(false)
  }, [draftUserId, open, settings.leadZh, settings.tailZh, settings.leadEn, settings.tailEn])

  const residentDraft = { leadPrimary, tailPrimary, leadSecondary, tailSecondary }
  const draftDirty = open && JSON.stringify(residentDraft) !== JSON.stringify(residentBaselineRef.current)
  draftRef.current = residentDraft
  draftUserIdRef.current = draftUserId ?? ''
  dirtyForReloadRef.current = draftDirty || saving

  const persistResidentDraft = () => {
    if (draftSettledRef.current || !dirtyForReloadRef.current) return true
    const userId = draftUserIdRef.current
    return Boolean(userId) && saveSnippetPhraseDraft(userId, draftRef.current)
  }

  const settleResidentDraft = () => {
    draftSettledRef.current = true
    const userId = draftUserIdRef.current
    return userId ? clearSnippetPhraseDraft(userId) : true
  }

  useEffect(() => {
    const userId = draftUserIdRef.current
    if (!open || !userId || draftSettledRef.current) return
    const timer = window.setTimeout(() => {
      if (draftSettledRef.current) return
      if (draftDirty) saveSnippetPhraseDraft(userId, draftRef.current)
      else clearSnippetPhraseDraft(userId)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [draftDirty, leadPrimary, open, tailPrimary, leadSecondary, tailSecondary])

  useEffect(() => registerSafeReloadGuard(`snippet-phrase-settings:${reloadGuardId}`, {
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

  const finishClose = () => {
    settleResidentDraft()
    onClose()
  }
  const { exiting, requestClose } = useAnimatedClose(open, finishClose, 120)
  const requestDiscardClose = () => {
    settleResidentDraft()
    requestClose()
  }
  const dialogRef = useModalA11y({
    open,
    onClose: () => {
      if (!saving) requestDiscardClose()
    },
    initialFocusRef: leadPrimaryRef,
  })

  if (!open && !exiting) return null

  const primaryLabel = languageLabel(pair.primary)
  const secondaryLabel = languageLabel(pair.secondary)
  const phraseHelp = `${tx('profile.globalPhraseHint')} ${format(
    tx('profile.contentLanguagePhraseHint', 'Columns follow your content languages: {primary} / {secondary}. Interface language is unchanged.'),
    { primary: primaryLabel, secondary: secondaryLabel },
  )}`

  const previewSingle = (slot: 'primary' | 'secondary') => {
    const language = slot === 'primary' ? pair.primary : pair.secondary
    const name = translate(language, 'profile.presetCv', 'CV')
    const lead = slot === 'primary' ? leadPrimary : leadSecondary
    const tail = slot === 'primary' ? tailPrimary : tailSecondary
    if (!lead.trim() && !tail.trim()) return tpl(translate(language, 'dossier.assetAttachedLine'), { name })
    return `${lead}${name}${tail}`
  }

  const previewMultiple = (slot: 'primary' | 'secondary') => {
    const language = slot === 'primary' ? pair.primary : pair.secondary
    const cv = translate(language, 'profile.presetCv', 'CV')
    const ps = translate(language, 'profile.presetPersonalStatement', 'Personal Statement')
    const names = isCjkContentLanguage(language)
      ? `${cv}和${ps}`
      : `${cv} and ${ps}`
    const lead = slot === 'primary' ? leadPrimary : leadSecondary
    const tail = slot === 'primary' ? tailPrimary : tailSecondary
    if (!lead.trim() && !tail.trim()) return tpl(translate(language, 'dossier.assetsAttachedLine'), { items: names })
    return `${lead}${names}${tail}`
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    // Deliberately not trimmed: a lead/tail fragment's leading/trailing space is often
    // meaningful (e.g. "I have attached " needs that trailing space before the name).
    setSaving(true)
    try {
      await Promise.resolve(onSave({
        snippetPhraseLeadEn: leadPrimary,
        snippetPhraseTailEn: tailPrimary,
        snippetPhraseLeadZh: leadSecondary,
        snippetPhraseTailZh: tailSecondary,
      }))
      settleResidentDraft()
      requestClose()
    } catch {
      // The parent owns the localized error toast. Keeping this dialog open
      // preserves the unsaved phrase draft for a retry.
    } finally {
      setSaving(false)
    }
  }

  const renderColumn = (
    slot: 'primary' | 'secondary',
    language: string,
    label: string,
    lead: string,
    setLead: (value: string) => void,
    tail: string,
    setTail: (value: string) => void,
    leadRef?: React.RefObject<HTMLTextAreaElement | null>,
  ) => (
    <div className="snippet-phrase-lang snippet-template-field">
      <div className="snippet-phrase-language-head">
        <span>{format(tx('profile.bilingualLanguage'), { language: label })}</span>
        <span className="snippet-token-formula">
          <mark>{'{{A}}'}</mark>
          <mark>{'{{name}}'}</mark>
          <mark>{'{{B}}'}</mark>
        </span>
      </div>
      <div className="snippet-phrase-field">
        <span>{tx('profile.phrasePrefixA')}</span>
        <MarkdownTextarea
          ref={leadRef}
          value={lead}
          onChange={(event) => setLead(event.target.value)}
          placeholder={phrasePlaceholder(language, 'lead')}
          aria-label={tx('profile.phrasePrefixA')}
          rows={2}
        />
      </div>
      <div className="snippet-phrase-field">
        <span>{tx('profile.phraseSuffixB')}</span>
        <MarkdownTextarea
          value={tail}
          onChange={(event) => setTail(event.target.value)}
          placeholder={phrasePlaceholder(language, 'tail')}
          aria-label={tx('profile.phraseSuffixB')}
          rows={2}
        />
      </div>
      <div className="snippet-template-preview">
        <span>{tx('profile.previewSingle')}</span>
        <p>{previewSingle(slot)}</p>
      </div>
      <div className="snippet-template-preview">
        <span>{tx('profile.previewMultiple')}</span>
        <p>{previewMultiple(slot)}</p>
      </div>
    </div>
  )

  return (
    <ModalPortal>
      <div className={`dialog-layer profile-library-layer${exiting ? ' exiting' : ''}`} onClick={(event) => { if (event.target === event.currentTarget && !saving) requestDiscardClose() }}>
      <section
        ref={dialogRef}
        className="new-dialog profile-library-dialog snippet-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tx('profile.snippetPhraseSettingsTitle')}
      >
        <div className="dialog-head">
          <div>
            <span className="eyebrow">{tx('profile.libraryEyebrow')}</span>
            <h2>{tx('profile.snippetPhraseSettingsTitle')}</h2>
          </div>
          <button type="button" className="icon-action" onClick={() => { if (!saving) requestDiscardClose() }} disabled={saving} aria-label={tx('close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form className="snippet-editor-form" onSubmit={handleSubmit}>
          {/* The form itself is an unpadded flex shell; the scroll region owns
              the dialog's inner gutter, exactly as in SnippetEditorDialog. */}
          <div className="snippet-editor-scroll">
            <div className="snippet-phrase-field">
              <div className="snippet-phrase-head">
                <div className="snippet-phrase-title">
                  <span className="snippet-section-label">{tx('profile.emailPhrase')}</span>
                  <InfoTooltip
                    className="snippet-phrase-info"
                    content={phraseHelp}
                    label={phraseHelp}
                  />
                </div>
              </div>
              <div className="snippet-phrase-grid">
                {renderColumn(
                  'primary',
                  pair.primary,
                  primaryLabel,
                  leadPrimary,
                  setLeadPrimary,
                  tailPrimary,
                  setTailPrimary,
                  leadPrimaryRef,
                )}
                {renderColumn(
                  'secondary',
                  pair.secondary,
                  secondaryLabel,
                  leadSecondary,
                  setLeadSecondary,
                  tailSecondary,
                  setTailSecondary,
                )}
              </div>
            </div>
          </div>

          <div className="dialog-actions">
            <button type="button" className="secondary-action" onClick={requestDiscardClose} disabled={saving}>{tx('cancel')}</button>
            <button type="submit" className="primary-action" disabled={saving} aria-busy={saving || undefined}>
              {saving ? <PendingLabel label={tx('working')} /> : <><Save size={14} aria-hidden="true" /> {tx('save')}</>}
            </button>
          </div>
        </form>
      </section>
      </div>
    </ModalPortal>
  )
}
