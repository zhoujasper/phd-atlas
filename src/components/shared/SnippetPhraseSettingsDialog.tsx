import { Save, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { UserSettingsPatch } from '../../api/phdApi'
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
  onClose,
  onSave,
}: {
  open: boolean
  settings: SnippetPhraseSettings
  /** Account content-language pair — labels the dual phrase columns. */
  contentLanguages?: ContentLanguagePair | null
  onClose: () => void
  onSave: (patch: UserSettingsPatch) => void
}) {
  const { tx, format } = useI18n()
  const pair = useMemo(
    () => contentLanguages ?? contentLanguagesFromSettings(null),
    [contentLanguages],
  )
  const contentPackVersion = useContentLanguagePacks(pair)
  // En fields = primary language, Zh fields = secondary language.
  const [leadPrimary, setLeadPrimary] = useState('')
  const [tailPrimary, setTailPrimary] = useState('')
  const [leadSecondary, setLeadSecondary] = useState('')
  const [tailSecondary, setTailSecondary] = useState('')
  const leadPrimaryRef = useRef<HTMLTextAreaElement | null>(null)
  void contentPackVersion

  useEffect(() => {
    if (!open) return
    setLeadPrimary(settings.leadEn)
    setTailPrimary(settings.tailEn)
    setLeadSecondary(settings.leadZh)
    setTailSecondary(settings.tailZh)
  }, [open, settings.leadZh, settings.tailZh, settings.leadEn, settings.tailEn])

  const { exiting, requestClose } = useAnimatedClose(open, onClose, 120)
  const dialogRef = useModalA11y({ open: open && !exiting, onClose: () => requestClose(), initialFocusRef: leadPrimaryRef })

  if (!open && !exiting) return null

  const primaryLabel = languageLabel(pair.primary)
  const secondaryLabel = languageLabel(pair.secondary)

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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    // Deliberately not trimmed: a lead/tail fragment's leading/trailing space is often
    // meaningful (e.g. "I have attached " needs that trailing space before the name).
    onSave({
      snippetPhraseLeadEn: leadPrimary,
      snippetPhraseTailEn: tailPrimary,
      snippetPhraseLeadZh: leadSecondary,
      snippetPhraseTailZh: tailSecondary,
    })
    requestClose()
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
      <label>
        <span>{tx('profile.phrasePrefixA')}</span>
        <MarkdownTextarea
          ref={leadRef}
          value={lead}
          onChange={(event) => setLead(event.target.value)}
          placeholder={phrasePlaceholder(language, 'lead')}
          rows={2}
        />
      </label>
      <label>
        <span>{tx('profile.phraseSuffixB')}</span>
        <MarkdownTextarea
          value={tail}
          onChange={(event) => setTail(event.target.value)}
          placeholder={phrasePlaceholder(language, 'tail')}
          rows={2}
        />
      </label>
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
      <div className={`dialog-layer profile-library-layer${exiting ? ' exiting' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}>
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
          <button type="button" className="icon-action" onClick={() => requestClose()} aria-label={tx('close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form className="snippet-editor-form" onSubmit={handleSubmit}>
          <div className="snippet-phrase-field">
            <div className="snippet-phrase-head">
              <div>
                <span className="snippet-section-label">{tx('profile.emailPhrase')}</span>
                <p className="snippet-section-hint">{tx('profile.globalPhraseHint')}</p>
                <p className="snippet-section-hint">
                  {format(tx('profile.contentLanguagePhraseHint', 'Columns follow your content languages: {primary} / {secondary}. Interface language is unchanged.'), {
                    primary: primaryLabel,
                    secondary: secondaryLabel,
                  })}
                </p>
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

          <div className="dialog-actions">
            <button type="button" className="secondary-action" onClick={() => requestClose()}>{tx('cancel')}</button>
            <button type="submit" className="primary-action">
              <Save size={14} aria-hidden="true" /> {tx('save')}
            </button>
          </div>
        </form>
      </section>
      </div>
    </ModalPortal>
  )
}
