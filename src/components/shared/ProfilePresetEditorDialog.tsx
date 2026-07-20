import { Save, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type ProfilePreset,
  type TeamProfilePreset,
  type TeamProfilePresetInput,
} from '../../api/phdApi'
import {
  contentLanguagesFromSettings,
  type ContentLanguagePair,
} from '../../contentLanguages'
import { languageLabel } from '../../i18n'
import { CUSTOM_PROFILE_KIND, isBuiltInProfilePresetKind } from '../../profileAssets'
import { profilePresetInsertLabels } from '../../profilePresets'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { InfoTooltip } from './InfoTooltip'
import { ProfileAppearancePicker } from './ProfileAppearancePicker'

export type ProfilePresetEditorValue = TeamProfilePresetInput

const emptyValue: ProfilePresetEditorValue = {
  kind: CUSTOM_PROFILE_KIND,
  nameZh: '',
  nameEn: '',
  descriptionZh: '',
  descriptionEn: '',
  contentZh: '',
  contentEn: '',
  icon: 'file-text',
  // Prefer a stored team-safe color: some deployments reject the UI-only "system" token.
  color: 'blue',
  // Team presets auto-distribute: org admin → teachers + students; teacher → assigned students.
  syncToTeachers: true,
  syncToStudents: true,
}

function displayNameFromPreset(preset: ProfilePreset | TeamProfilePreset | null): string {
  if (!preset) return ''
  return (preset.nameEn || preset.nameZh || '').trim()
}

export function ProfilePresetEditorDialog({
  open,
  preset,
  scope = 'personal',
  role = null,
  contentLanguages,
  onClose,
  onSave,
}: {
  open: boolean
  preset: ProfilePreset | TeamProfilePreset | null
  scope?: 'personal' | 'team'
  role?: 'owner' | 'admin' | null
  contentLanguages?: ContentLanguagePair | null
  onClose: () => void
  onSave: (value: ProfilePresetEditorValue) => void | Promise<void>
}) {
  const { tx, format } = useI18n()
  const pair = useMemo(
    () => contentLanguages ?? contentLanguagesFromSettings(null),
    [contentLanguages],
  )
  const primaryLabel = languageLabel(pair.primary)
  const secondaryLabel = languageLabel(pair.secondary)
  const [draft, setDraft] = useState<ProfilePresetEditorValue>(emptyValue)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const teamPreset = preset as TeamProfilePreset | null
    // Built-in system presets: dual-slot insert copy always follows current first/second
    // content languages (every supported language has a pack), not stale stored en/zh text.
    const liveInsert = preset && (preset.builtIn || isBuiltInProfilePresetKind(preset.kind))
      ? profilePresetInsertLabels(preset, pair)
      : null
    setDraft({
      kind: preset?.kind ?? CUSTOM_PROFILE_KIND,
      nameZh: liveInsert?.secondary ?? preset?.nameZh ?? '',
      nameEn: liveInsert?.primary ?? preset?.nameEn ?? '',
      descriptionZh: liveInsert?.descriptionSecondary ?? preset?.descriptionZh ?? '',
      descriptionEn: liveInsert?.descriptionPrimary ?? preset?.descriptionEn ?? '',
      contentZh: liveInsert?.contentSecondary ?? preset?.contentZh ?? '',
      contentEn: liveInsert?.contentPrimary ?? preset?.contentEn ?? '',
      icon: preset?.icon ?? 'file-text',
      color: preset?.color ?? 'blue',
      syncToTeachers: teamPreset?.syncToTeachers ?? false,
      syncToStudents: teamPreset?.syncToStudents ?? false,
    })
    setName(liveInsert?.primary || liveInsert?.secondary || displayNameFromPreset(preset))
    setSaving(false)
  }, [open, pair, preset])

  const { exiting, requestClose } = useAnimatedClose(open, onClose, 120)
  const dialogRef = useModalA11y<HTMLElement>({
    open: open && !exiting,
    onClose: () => requestClose(),
    initialFocusRef: nameRef,
  })

  const isBuiltInTemplate = Boolean(preset?.builtIn)

  if ((!open && !exiting) || isBuiltInTemplate) return null

  const update = <K extends keyof ProfilePresetEditorValue>(key: K, value: ProfilePresetEditorValue[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const trimmedName = name.trim()
  const valid = Boolean(
    trimmedName
    && draft.descriptionEn.trim()
    && draft.descriptionZh.trim(),
  )

  return (
    <ModalPortal>
      <div className={`dialog-layer profile-library-layer${exiting ? ' exiting' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}>
        <section ref={dialogRef} className="new-dialog profile-library-dialog profile-preset-editor-dialog" role="dialog" aria-modal="true" aria-label={tx(preset ? 'profile.editPreset' : 'profile.createPreset')}>
          <div className="dialog-head">
            <div>
              <span className="eyebrow">{tx('profile.presetsEyebrow')}</span>
              <h2>{tx(preset ? 'profile.editPreset' : 'profile.createPreset')}</h2>
            </div>
            <button type="button" className="icon-action" onClick={() => requestClose()} aria-label={tx('close')}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <form className="profile-preset-editor-form" onSubmit={async (event) => {
            event.preventDefault()
            if (!valid || saving) return
            setSaving(true)
            try {
              const safeColor = scope === 'team' && draft.color === 'system' ? 'blue' : draft.color
              await onSave({
                ...draft,
                color: safeColor,
                // Auto distribution — no per-preset sync toggles in the UI.
                syncToTeachers: scope === 'team' ? role === 'owner' : draft.syncToTeachers,
                syncToStudents: scope === 'team' ? true : draft.syncToStudents,
                // Single user-defined name — mirror into both stored slots so library
                // display and insert-label fallbacks stay consistent in any language.
                nameZh: trimmedName,
                nameEn: trimmedName,
                descriptionZh: draft.descriptionZh.trim(),
                descriptionEn: draft.descriptionEn.trim(),
                contentZh: draft.contentZh.trim(),
                contentEn: draft.contentEn.trim(),
              })
              requestClose()
            } catch {
              // The parent owns user-facing error reporting. Keep the editor open
              // so the draft is not lost and the user can retry.
            } finally {
              setSaving(false)
            }
          }}>
            <div className="profile-preset-identity">
              <ProfileAppearancePicker
                icon={draft.icon}
                color={draft.color}
                onIconChange={(icon) => update('icon', icon)}
                onColorChange={(color) => update('color', color)}
              />

              <label className="profile-preset-name-field">
                <span className="sr-only">{tx('profile.presetName')}</span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={tx('profile.presetNamePlaceholder')}
                  aria-label={tx('profile.presetName')}
                  maxLength={120}
                />
              </label>
            </div>

            <section className="profile-preset-editor-section" aria-labelledby="profile-preset-copy-title">
              <div className="profile-preset-editor-section-head">
                <div>
                  <span className="eyebrow">{tx('profile.presetDetailsEyebrow')}</span>
                  <div className="profile-preset-editor-title-row">
                    <h3 id="profile-preset-copy-title">{tx('profile.presetDetailsTitle')}</h3>
                    <InfoTooltip
                      content={tx('profile.presetDetailsHint')}
                      label={tx('profile.presetDetailsHint')}
                    />
                  </div>
                </div>
              </div>

              <div className="profile-preset-language-grid">
                <fieldset className="profile-preset-language-column">
                  <legend>{format(tx('profile.bilingualLanguage'), { language: primaryLabel })}</legend>
                  <label>
                    <span>{format(tx('profile.bilingualGuide'), { language: primaryLabel })}</span>
                    <textarea
                      className="profile-preset-guide-input"
                      required
                      value={draft.descriptionEn}
                      onChange={(event) => update('descriptionEn', event.target.value)}
                      placeholder={format(tx('profile.bilingualGuidePlaceholder'), { language: primaryLabel })}
                      rows={3}
                      maxLength={300}
                    />
                  </label>
                  <label>
                    <span>{format(tx('profile.bilingualContent'), { language: primaryLabel })}</span>
                    <textarea
                      className="profile-preset-content-input"
                      value={draft.contentEn}
                      onChange={(event) => update('contentEn', event.target.value)}
                      placeholder={format(tx('profile.bilingualContent'), { language: primaryLabel })}
                      rows={5}
                    />
                  </label>
                </fieldset>

                <fieldset className="profile-preset-language-column">
                  <legend>{format(tx('profile.bilingualLanguage'), { language: secondaryLabel })}</legend>
                  <label>
                    <span>{format(tx('profile.bilingualGuide'), { language: secondaryLabel })}</span>
                    <textarea
                      className="profile-preset-guide-input"
                      required
                      value={draft.descriptionZh}
                      onChange={(event) => update('descriptionZh', event.target.value)}
                      placeholder={format(tx('profile.bilingualGuidePlaceholder'), { language: secondaryLabel })}
                      rows={3}
                      maxLength={300}
                    />
                  </label>
                  <label>
                    <span>{format(tx('profile.bilingualContent'), { language: secondaryLabel })}</span>
                    <textarea
                      className="profile-preset-content-input"
                      value={draft.contentZh}
                      onChange={(event) => update('contentZh', event.target.value)}
                      placeholder={format(tx('profile.bilingualContent'), { language: secondaryLabel })}
                      rows={5}
                    />
                  </label>
                </fieldset>
              </div>
            </section>

            <div className="profile-preset-editor-actions">
              <button type="button" className="secondary-action" onClick={() => requestClose()}>{tx('cancel')}</button>
              <button type="submit" className="primary-action" disabled={!valid || saving}>
                <Save size={13} aria-hidden="true" /> {saving ? tx('working') : tx('profile.savePreset')}
              </button>
            </div>
          </form>
        </section>
      </div>
    </ModalPortal>
  )
}
