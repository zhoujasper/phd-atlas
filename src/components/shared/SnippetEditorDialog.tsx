import { AlertCircle, CheckCircle2, Download, ExternalLink, FileText, Pencil, Save, Trash2, UploadCloud, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProfileAsset, ProfileAssetAttachment, ProfileAssetInput, ProfilePresetColor, ProfilePresetIcon } from '../../api/phdApi'
import {
  createRenamedFile,
  getUploadPresetSelection,
  resolveUploadAllowedTypes,
  uploadOtherTypeId,
  uploadTypePresets,
} from '../../checklistFiles'
import {
  contentLanguagesFromSettings,
  type ContentLanguagePair,
} from '../../contentLanguages'
import { DEFAULT_UPLOAD_ALLOWED_TYPES, MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_FILES_PER_BATCH, formatFileSize } from '../../fileUploads'
import { allowedFileTypesLabel, fileMatchesAllowedTypes } from '../../fileTypes'
import { languageLabel, t as translate, tpl } from '../../i18n'
import {
  CUSTOM_PROFILE_KIND,
  PROFILE_PRESET_DEFAULT_KEYS,
  PROFILE_PRESET_KINDS,
  isBuiltInProfilePresetKind,
  isGenericCustomProfileKind,
} from '../../profileAssets'
import { profilePresetPresentation } from '../../profilePresets'
import { normalizeEscapedMultiline } from '../../textNormalize'
import { useContentLanguagePacks, useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { CollapsiblePanel } from './CollapsiblePanel'
import { CopyButton } from './CopyButton'
import { FileDropzone } from './FileDropzone'
import { LazyMarkdownTextarea as MarkdownTextarea } from './LazyMarkdownTextarea'
import { ProfileAppearancePicker } from './ProfileAppearancePicker'
import { Select } from './Select'
import { shareExpiryOptions, type ShareExpiry } from './shareOptions'

type PendingFile = { id: string; file: File; name: string }

export function SnippetEditorDialog({
  open,
  asset,
  initialKind,
  initialName,
  initialContent,
  initialCustomLabelZh,
  initialCustomLabelEn,
  initialIcon,
  initialColor,
  initialFamilyId,
  initialFamilyName,
  initialVersionLabel,
  initialVersionNumber,
  initialIsPrimary,
  fromPreset = false,
  initialShowShare = false,
  globalPhrase,
  contentLanguages,
  onClose,
  onCreate,
  onUpdate,
  onUploadFiles,
  onRenameFile,
  onDeleteFile,
  onDownloadFile,
  onCreateShare,
  onRevokeShare,
}: {
  open: boolean
  /** null = create mode. A live reference in edit mode — attachments/shares re-render as it updates. */
  asset: ProfileAsset | null
  initialKind?: string
  initialName?: string
  initialContent?: string
  initialCustomLabelZh?: string
  initialCustomLabelEn?: string
  initialIcon?: ProfilePresetIcon
  initialColor?: ProfilePresetColor
  /** When set, create joins an existing version family (new version of CV/PS/…). */
  initialFamilyId?: string
  initialFamilyName?: string
  initialVersionLabel?: string
  initialVersionNumber?: number
  initialIsPrimary?: boolean
  /** When true (use-preset flow), hide kind chips — chips only appear for blank "Add snippet". */
  fromPreset?: boolean
  /** Open the share-upload panel when editing an existing snippet. */
  initialShowShare?: boolean
  /** Account-wide insert-phrase template (lead + name + tail, per language) — read-only here, used only to render the bottom preview. */
  globalPhrase: { leadZh: string; tailZh: string; leadEn: string; tailEn: string }
  /** Dual content languages from Settings — drives bilingual labels and previews. */
  contentLanguages?: ContentLanguagePair | null
  onClose: () => void
  onCreate: (input: ProfileAssetInput, files: File[]) => void | Promise<void>
  onUpdate: (id: string, input: Partial<ProfileAssetInput>) => void
  onUploadFiles: (assetId: string, files: File[]) => void | Promise<void>
  onRenameFile: (assetId: string, fileId: string, fileName: string) => void
  onDeleteFile: (assetId: string, fileId: string) => void
  onDownloadFile: (fileId: string, fileName: string) => void
  onCreateShare: (assetId: string, expiry: ShareExpiry, note: string) => void
  onRevokeShare: (assetId: string, shareId: string) => void
}) {
  const { tx, lang, format } = useI18n()
  const pair = useMemo(
    () => contentLanguages ?? contentLanguagesFromSettings(null),
    [contentLanguages],
  )
  // Load ja/ko/… profile+dossier packs so insert-phrase previews are not stuck on English.
  const contentPackVersion = useContentLanguagePacks(pair)
  const primaryLabel = languageLabel(pair.primary)
  const secondaryLabel = languageLabel(pair.secondary)
  const isEditing = Boolean(asset)
  const assetId = asset?.id
  const assetName = asset?.name
  const assetKind = asset?.kind
  const assetDescription = asset?.description
  const assetNotes = asset?.notes
  const assetCustomLabelZh = asset?.customLabelZh
  const assetCustomLabelEn = asset?.customLabelEn
  const assetIcon = asset?.icon
  const assetColor = asset?.color
  const assetUploadReserved = asset?.uploadReserved
  const assetAllowedFileTypes = asset?.allowedFileTypes

  /** Free library display name next to the icon — whatever the user wants. */
  const [name, setName] = useState('')
  /** Insert-phrase middle segment for first/second content languages ({{name}}). */
  const [phraseMiddlePrimary, setPhraseMiddlePrimary] = useState('')
  const [phraseMiddleSecondary, setPhraseMiddleSecondary] = useState('')
  const [kind, setKind] = useState(CUSTOM_PROFILE_KIND)
  const [content, setContent] = useState('')
  const nameRef = useRef<HTMLInputElement | null>(null)
  /** Preset template text shown only as a gray empty-state hint — never saved unless the user types. */
  const [contentHint, setContentHint] = useState('')
  const [notes, setNotes] = useState('')
  const [icon, setIcon] = useState<ProfilePresetIcon>('file-text')
  const [color, setColor] = useState<ProfilePresetColor>('system')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  /** Attachment fileId or pending id currently in rename mode. */
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  /** Same pattern as checklist materials: reserve a later upload slot without attaching files now. */
  const [uploadReservationEnabled, setUploadReservationEnabled] = useState(false)
  const [uploadAllowedPresetIds, setUploadAllowedPresetIds] = useState<string[]>([])
  const [uploadCustomTypes, setUploadCustomTypes] = useState('')
  const [uploadTypeError, setUploadTypeError] = useState('')
  const [showShareForm, setShowShareForm] = useState(false)
  const [shareExpiry, setShareExpiry] = useState<ShareExpiry>('7d')
  const [shareNote, setShareNote] = useState('')
  const [versionLabel, setVersionLabel] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [isPrimary, setIsPrimary] = useState(true)
  const [familyIdDraft, setFamilyIdDraft] = useState<string | undefined>(undefined)
  const [versionNumberDraft, setVersionNumberDraft] = useState<number | undefined>(undefined)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  // Kind chips only for blank create — not when using a preset, not when editing.
  const showKindPicker = !isEditing && !fromPreset

  // Re-seed the local draft whenever the dialog opens or switches to a different asset — but not
  // on every reactive update to the *same* asset (e.g. after an attachment upload), which would
  // otherwise blow away in-progress name/content edits.
  useEffect(() => {
    if (!open) return
    const nextKind = assetKind ?? initialKind ?? CUSTOM_PROFILE_KIND
    const nextIsBuiltIn = isBuiltInProfilePresetKind(nextKind)
    // A kind that's neither a built-in preset nor the generic Custom/Other sentinel is a
    // pre-migration row whose freeform kind string doubled as its display label — seed both
    // language fields from it so re-saving doesn't silently discard the user's existing label.
    const legacyLabel = !nextIsBuiltIn && !isGenericCustomProfileKind(nextKind) ? nextKind : ''
    const presetKey = !assetId && nextIsBuiltIn ? PROFILE_PRESET_DEFAULT_KEYS[nextKind] : undefined
    const presentation = profilePresetPresentation(nextKind)
    setKind(nextIsBuiltIn ? nextKind : CUSTOM_PROFILE_KIND)

    // Free display name (library card) — independent of insert-phrase middles.
    const kindLabelUi = nextIsBuiltIn
      ? translate(lang, PROFILE_PRESET_KINDS.find((item) => item.kind === nextKind)?.labelKey ?? '', nextKind)
      : ''
    setName((assetName || initialName || legacyLabel || kindLabelUi || '').trim())

    // Dual insert-phrase middles: En slot = primary content language, Zh = secondary.
    const kindLabelPrimary = nextIsBuiltIn
      ? translate(pair.primary, PROFILE_PRESET_KINDS.find((item) => item.kind === nextKind)?.labelKey ?? '', nextKind)
      : ''
    const kindLabelSecondary = nextIsBuiltIn
      ? translate(pair.secondary, PROFILE_PRESET_KINDS.find((item) => item.kind === nextKind)?.labelKey ?? '', nextKind)
      : ''
    setPhraseMiddlePrimary((assetCustomLabelEn || initialCustomLabelEn || kindLabelPrimary || '').trim())
    setPhraseMiddleSecondary((assetCustomLabelZh || initialCustomLabelZh || kindLabelSecondary || legacyLabel || '').trim())

    // Editing keeps the saved snippet body. Using a preset keeps the field empty and shows
    // the template only as a gray hint that disappears the moment the user types.
    if (assetId) {
      setContent(normalizeEscapedMultiline(assetDescription ?? ''))
      setContentHint('')
    } else if (fromPreset) {
      const hint = normalizeEscapedMultiline(
        initialContent
          ?? (presetKey ? translate(lang, `profile.presetDefaults.${presetKey}.content`, '') : ''),
      )
      setContent('')
      setContentHint(hint)
    } else {
      setContent('')
      setContentHint(
        presetKey
          ? normalizeEscapedMultiline(translate(lang, `profile.presetDefaults.${presetKey}.content`, ''))
          : '',
      )
    }

    setNotes(normalizeEscapedMultiline(assetNotes ?? ''))
    setIcon(assetIcon ?? initialIcon ?? presentation.icon)
    setColor(assetColor ?? initialColor ?? presentation.color)
    setVersionLabel(
      (asset?.versionLabel || initialVersionLabel || (assetId ? 'v1' : initialVersionNumber ? `v${initialVersionNumber}` : 'v1')).trim(),
    )
    setFamilyName((asset?.familyName || initialFamilyName || '').trim())
    setIsPrimary(asset ? Boolean(asset.isPrimary ?? true) : initialIsPrimary !== false)
    setFamilyIdDraft(asset?.familyId || initialFamilyId)
    setVersionNumberDraft(asset?.versionNumber || initialVersionNumber)
    setPendingFiles([])
    setRenamingFileId(null)
    setUploadReservationEnabled(Boolean(assetUploadReserved))
    {
      const selection = getUploadPresetSelection(assetAllowedFileTypes)
      setUploadAllowedPresetIds(selection.customTypes.length
        ? [...selection.presetIds, uploadOtherTypeId]
        : selection.presetIds)
      setUploadCustomTypes(selection.customTypes.join(', '))
    }
    setUploadTypeError('')
    setShowShareForm(Boolean(assetId && initialShowShare))
    setShareNote('')
    setShareExpiry('7d')
  }, [
    open,
    assetId,
    assetName,
    assetKind,
    assetDescription,
    assetCustomLabelZh,
    assetCustomLabelEn,
    assetIcon,
    assetColor,
    assetNotes,
    assetUploadReserved,
    assetAllowedFileTypes,
    initialKind,
    initialName,
    initialContent,
    initialCustomLabelZh,
    initialCustomLabelEn,
    initialIcon,
    initialColor,
    initialFamilyId,
    initialFamilyName,
    initialVersionLabel,
    initialVersionNumber,
    initialIsPrimary,
    initialShowShare,
    fromPreset,
    lang,
    asset?.versionLabel,
    asset?.familyName,
    asset?.isPrimary,
    asset?.familyId,
    asset?.versionNumber,
  ])

  const applyPreset = (nextKind: string) => {
    const preset = PROFILE_PRESET_KINDS.find((item) => item.kind === nextKind)
    const presetKey = isBuiltInProfilePresetKind(nextKind) ? PROFILE_PRESET_DEFAULT_KEYS[nextKind] : undefined
    const presentation = profilePresetPresentation(nextKind)
    setKind(nextKind)
    setIcon(presentation.icon)
    setColor(presentation.color)
    // Seed free name + bilingual insert middles from kind labels when still empty.
    if (preset) {
      if (!name.trim()) setName(tx(preset.labelKey))
      if (!phraseMiddlePrimary.trim()) setPhraseMiddlePrimary(translate(pair.primary, preset.labelKey, nextKind))
      if (!phraseMiddleSecondary.trim()) setPhraseMiddleSecondary(translate(pair.secondary, preset.labelKey, nextKind))
    }
    // Template copy is a hint only — leave the user's draft empty until they type.
    if (presetKey) {
      setContentHint(normalizeEscapedMultiline(translate(lang, `profile.presetDefaults.${presetKey}.content`, '')))
      if (!content.trim()) setContent('')
    } else {
      setContentHint('')
    }
  }

  const applyCustomKind = () => {
    setKind(CUSTOM_PROFILE_KIND)
    setIcon('file-text')
    setColor('system')
    setContentHint('')
  }

  const showContentHint = Boolean(contentHint.trim()) && !content.trim()

  const { exiting, requestClose } = useAnimatedClose(open, onClose, 120)
  const dialogRef = useModalA11y({ open: open && !exiting, onClose: () => requestClose(), initialFocusRef: nameRef })

  const uploadAllowedTypes = useMemo(
    () => resolveUploadAllowedTypes(uploadAllowedPresetIds, uploadCustomTypes),
    [uploadAllowedPresetIds, uploadCustomTypes],
  )
  const effectiveUploadAllowedTypes = useMemo(
    () => (uploadAllowedTypes.length > 0 ? uploadAllowedTypes : [...DEFAULT_UPLOAD_ALLOWED_TYPES]),
    [uploadAllowedTypes],
  )
  const uploadCustomTypesOpen = uploadAllowedPresetIds.includes(uploadOtherTypeId)

  useEffect(() => {
    if (!renamingFileId) return
    const frame = window.requestAnimationFrame(() => renameInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [renamingFileId])

  // contentPackVersion is read so previews recompute after async pack loads.
  void contentPackVersion

  if (!open && !exiting) return null

  const attachments = asset?.attachments ?? []
  const shares = asset?.shares ?? []
  const isCustomKind = kind === CUSTOM_PROFILE_KIND
  const resolvedName = name.trim()
  const resolvedPhrasePrimary = phraseMiddlePrimary.trim()
  const resolvedPhraseSecondary = phraseMiddleSecondary.trim()

  const toggleUploadPreset = (id: string) => {
    setUploadTypeError('')
    setUploadAllowedPresetIds((current) => {
      if (id === uploadOtherTypeId) {
        const isOpen = current.includes(uploadOtherTypeId)
        if (isOpen) setUploadCustomTypes('')
        return isOpen ? current.filter((item) => item !== id) : [...current, id]
      }
      return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    })
  }

  const phrasePreview = (slot: 'primary' | 'secondary') => {
    const language = slot === 'primary' ? pair.primary : pair.secondary
    // En storage = primary, Zh storage = secondary
    const lead = slot === 'primary' ? globalPhrase.leadEn : globalPhrase.leadZh
    const tail = slot === 'primary' ? globalPhrase.tailEn : globalPhrase.tailZh
    const middle = (slot === 'primary' ? resolvedPhrasePrimary : resolvedPhraseSecondary)
      || resolvedName
      || '…'
    if (!lead.trim() && !tail.trim()) {
      return tpl(translate(language, 'dossier.assetAttachedLine'), { name: middle })
    }
    return `${lead}${middle}${tail}`
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!resolvedName) return
    const hasFiles = Boolean(asset ? (asset.attachments?.length ?? 0) : pendingFiles.length)
    // Free library name + dual insert-phrase middles (primary → En slot, secondary → Zh slot).
    const input: ProfileAssetInput = {
      name: resolvedName,
      kind,
      description: content.trim(),
      notes: notes.trim(),
      customLabelEn: resolvedPhrasePrimary || resolvedName,
      customLabelZh: resolvedPhraseSecondary || resolvedName,
      icon,
      color,
      familyId: familyIdDraft,
      familyName: familyName.trim() || undefined,
      versionLabel: versionLabel.trim() || undefined,
      versionNumber: versionNumberDraft,
      isPrimary,
      // Reservation is only meaningful while there are no real files yet.
      uploadReserved: hasFiles ? false : uploadReservationEnabled,
      allowedFileTypes: uploadAllowedTypes,
    }
    if (asset) {
      onUpdate(asset.id, input)
    } else {
      const files = pendingFiles.map((pending) => createRenamedFile(pending.file, pending.name))
      void Promise.resolve(onCreate(input, files))
    }
    requestClose()
  }

  const handlePickFiles = async (files: File[]) => {
    if (files.length === 0) return
    const rejected = files.filter((file) => !fileMatchesAllowedTypes(file, effectiveUploadAllowedTypes))
    if (rejected.length > 0) {
      setUploadTypeError(format(tx('dossier.uploadTypeRejected'), {
        count: rejected.length,
        types: allowedFileTypesLabel(uploadAllowedTypes, tx('dossier.fileTypeAny')),
      }))
      return
    }
    setUploadTypeError('')
    if (asset) {
      setUploadingFiles(true)
      try {
        await Promise.resolve(onUploadFiles(asset.id, files))
        setUploadReservationEnabled(false)
      } finally {
        setUploadingFiles(false)
      }
      return
    }
    setPendingFiles((current) => [
      ...current,
      ...files.map((file) => ({
        id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
      })),
    ])
    setUploadReservationEnabled(false)
  }

  const startRenameAttachment = (attachment: ProfileAssetAttachment) => {
    setRenamingFileId(attachment.fileId)
    setRenameValue(attachment.fileName)
  }

  const startRenamePending = (pending: PendingFile) => {
    setRenamingFileId(pending.id)
    setRenameValue(pending.name)
  }

  const cancelRename = () => {
    setRenamingFileId(null)
    setRenameValue('')
  }

  const commitRename = () => {
    if (!renamingFileId) return
    const nextName = renameValue.trim()
    const attachment = (asset?.attachments ?? []).find((item) => item.fileId === renamingFileId)
    if (attachment && asset) {
      if (nextName && nextName !== attachment.fileName) {
        onRenameFile(asset.id, attachment.fileId, nextName)
      }
      cancelRename()
      return
    }
    if (nextName) {
      setPendingFiles((current) => current.map((item) => (
        item.id === renamingFileId ? { ...item, name: nextName } : item
      )))
    }
    cancelRename()
  }

  const dialogTitle = isEditing
    ? tx('profile.editSnippet')
    : fromPreset
      ? tx('profile.usePreset')
      : tx('profile.addSnippet')

  return (
    <ModalPortal>
      <div className={`dialog-layer profile-library-layer${exiting ? ' exiting' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}>
      <section
        ref={dialogRef}
        className="new-dialog profile-library-dialog snippet-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
      >
        <div className="dialog-head">
          <div>
            <span className="eyebrow">{tx('profile.eyebrow')}</span>
            <h2>{dialogTitle}</h2>
          </div>
          <button type="button" className="icon-action" onClick={() => requestClose()} aria-label={tx('close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form className="snippet-editor-form" onSubmit={handleSubmit}>
          <div className="snippet-identity-row">
            <ProfileAppearancePicker
              icon={icon}
              color={color}
              onIconChange={setIcon}
              onColorChange={setColor}
              triggerClassName="snippet-identity-icon-trigger"
              iconSize={18}
            />
            <label className="snippet-identity-name">
              <span className="sr-only">{tx('profile.snippetName')}</span>
              <input
                ref={nameRef}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={tx('profile.snippetNamePlaceholder')}
                aria-label={tx('profile.snippetName')}
                maxLength={200}
              />
            </label>
          </div>

          {showKindPicker ? (
            <div className="snippet-preset-row" role="group" aria-label={tx('profile.presetsTitle')}>
              <span className="snippet-preset-row-label">{tx('profile.presetsTitle')}</span>
              <div className="snippet-preset-chips">
                {PROFILE_PRESET_KINDS.map((preset) => (
                  <button
                    key={preset.kind}
                    type="button"
                    className={`snippet-preset-chip ${kind === preset.kind ? 'active' : ''}`}
                    onClick={() => {
                      applyPreset(preset.kind)
                    }}
                  >
                    {tx(preset.labelKey)}
                  </button>
                ))}
                <button
                  type="button"
                  className={`snippet-preset-chip ${isCustomKind ? 'active' : ''}`}
                  onClick={applyCustomKind}
                >
                  {tx('profile.presetCustom')}
                </button>
              </div>
            </div>
          ) : null}

          <div className={`snippet-content-field${showContentHint ? ' has-preset-hint' : ''}`}>
            <span className="snippet-section-label">{tx('profile.snippetContent')}</span>
            <div className={`snippet-content-shell${showContentHint ? ' showing-hint' : ''}`}>
              {showContentHint ? (
                <div className="snippet-content-hint" aria-hidden="true">
                  <pre className="snippet-content-hint-body">{contentHint}</pre>
                </div>
              ) : null}
              <MarkdownTextarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={showContentHint ? '' : tx('profile.snippetContentPlaceholder')}
                rows={8}
                aria-label={tx('profile.snippetContent')}
                className={showContentHint ? 'snippet-content-editor-over-hint' : ''}
              />
            </div>
          </div>

          <label className="snippet-notes-field">
            <span className="snippet-section-label">{tx('profile.notes')}</span>
            <MarkdownTextarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={tx('profile.notesPlaceholder')}
              rows={2}
            />
          </label>

          {/* Insert phrase belongs with the reusable text, before any file attachments. */}
          <div className="snippet-phrase-field">
            <div className="snippet-phrase-head">
              <div>
                <span className="snippet-section-label">{tx('profile.insertPhraseName')}</span>
                <p className="snippet-section-hint">
                  {format(tx('profile.insertPhraseNameHint'), {
                    primary: primaryLabel,
                    secondary: secondaryLabel,
                  })}
                </p>
              </div>
            </div>
            <div className="snippet-phrase-grid snippet-insert-middle-grid">
              <label className="snippet-insert-middle">
                <span>{format(tx('profile.bilingualLabel'), { language: primaryLabel })}</span>
                <input
                  value={phraseMiddlePrimary}
                  onChange={(event) => setPhraseMiddlePrimary(event.target.value)}
                  placeholder={format(tx('profile.insertPhraseNamePlaceholderLang'), { language: primaryLabel })}
                  aria-label={format(tx('profile.bilingualLabel'), { language: primaryLabel })}
                  maxLength={120}
                />
              </label>
              <label className="snippet-insert-middle">
                <span>{format(tx('profile.bilingualLabel'), { language: secondaryLabel })}</span>
                <input
                  value={phraseMiddleSecondary}
                  onChange={(event) => setPhraseMiddleSecondary(event.target.value)}
                  placeholder={format(tx('profile.insertPhraseNamePlaceholderLang'), { language: secondaryLabel })}
                  aria-label={format(tx('profile.bilingualLabel'), { language: secondaryLabel })}
                  maxLength={120}
                />
              </label>
            </div>
          </div>

          <div className="snippet-phrase-preview">
            <span className="snippet-section-label">{tx('profile.snippetPhrasePreviewTitle')}</span>
            <div className="snippet-phrase-preview-grid">
              <div className="snippet-template-preview">
                <span>{primaryLabel}</span>
                <p>{phrasePreview('primary')}</p>
              </div>
              <div className="snippet-template-preview">
                <span>{secondaryLabel}</span>
                <p>{phrasePreview('secondary')}</p>
              </div>
            </div>
          </div>

          <div className="snippet-attachments-section">
            <div className="snippet-section-head">
              <span className="snippet-section-label">{tx('profile.attachments')}</span>
            </div>

            <FileDropzone
              key={effectiveUploadAllowedTypes.join('|')}
              className="snippet-file-dropzone"
              compact
              title={uploadingFiles ? tx('working') : tx('profile.uploadFiles')}
              allowedTypes={effectiveUploadAllowedTypes}
              maxFileSize={MAX_UPLOAD_FILE_SIZE}
              maxFiles={MAX_UPLOAD_FILES_PER_BATCH}
              existingFileCount={asset ? 0 : pendingFiles.length}
              disabled={uploadingFiles}
              onFiles={handlePickFiles}
            />

            <label className={`checklist-reservation-toggle snippet-reservation-toggle${uploadReservationEnabled ? ' active' : ''}`}>
              <input
                type="checkbox"
                checked={uploadReservationEnabled}
                onChange={(event) => setUploadReservationEnabled(event.target.checked)}
              />
              <span className="checklist-reservation-check" aria-hidden="true">
                <span className={`snippet-reservation-icon${uploadReservationEnabled ? ' is-on' : ''}`}>
                  {uploadReservationEnabled ? <CheckCircle2 size={14} /> : <UploadCloud size={13} />}
                </span>
              </span>
              <span>
                <strong>
                  {tx('profile.reserveUpload')}
                  <em className="snippet-reservation-status" data-on={uploadReservationEnabled ? 'true' : 'false'}>
                    {uploadReservationEnabled ? tx('profile.uploadReservationOn') : tx('profile.uploadReservationOff')}
                  </em>
                </strong>
                <small>{tx('profile.reserveUploadHint')}</small>
              </span>
            </label>

            <CollapsiblePanel
              open={uploadReservationEnabled}
              className="snippet-upload-types-collapse"
              openMs={280}
              closeMs={220}
              keepMounted
            >
              <div className="checklist-upload-section snippet-upload-types">
                <div className="checklist-upload-section-head">
                  <span>{tx('dossier.allowedFileTypes')}</span>
                  <button
                    type="button"
                    className={`checklist-offset-chip ${uploadAllowedPresetIds.length === 0 && !uploadCustomTypes.trim() ? 'active' : ''}`}
                    onClick={() => {
                      setUploadAllowedPresetIds([])
                      setUploadCustomTypes('')
                      setUploadTypeError('')
                    }}
                  >
                    {tx('dossier.fileTypeAny')}
                  </button>
                </div>
                <div className="checklist-menu-chips">
                  {uploadTypePresets.map((preset) => {
                    const title = preset.custom
                      ? tx('dossier.customFileTypesHint')
                      : format(tx('dossier.fileTypePresetHint'), { types: preset.accept.join(', ') })
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`checklist-offset-chip ${uploadAllowedPresetIds.includes(preset.id) ? 'active' : ''}`}
                        onClick={() => toggleUploadPreset(preset.id)}
                        title={title}
                      >
                        {tx(preset.labelKey)}
                      </button>
                    )
                  })}
                </div>
                <CollapsiblePanel
                  open={uploadCustomTypesOpen}
                  className="checklist-upload-custom-collapse"
                  innerClassName="checklist-upload-custom-inner"
                  keepMounted
                >
                  <label className="checklist-menu-field">
                    <span>{tx('dossier.customFileTypes')}</span>
                    <input
                      value={uploadCustomTypes}
                      onChange={(event) => {
                        setUploadCustomTypes(event.target.value)
                        setUploadTypeError('')
                      }}
                      placeholder={tx('dossier.customFileTypesPlaceholder')}
                      aria-label={tx('dossier.customFileTypes')}
                    />
                    <small>{tx('dossier.customFileTypesHint')}</small>
                  </label>
                </CollapsiblePanel>
                {uploadTypeError ? (
                  <small className="checklist-upload-conflict">
                    <AlertCircle size={11} aria-hidden="true" /> {uploadTypeError}
                  </small>
                ) : null}
                {attachments.length === 0 && pendingFiles.length === 0 ? (
                  <div className="snippet-reserved-banner">
                    <UploadCloud size={13} aria-hidden="true" />
                    <span>{tx('profile.uploadReservedHint')}</span>
                  </div>
                ) : null}
              </div>
            </CollapsiblePanel>

            {asset ? (
              <div className="snippet-share-upload-row">
                <button
                  type="button"
                  className={`quiet-action${showShareForm ? ' active' : ''}`}
                  onClick={() => setShowShareForm((current) => !current)}
                  aria-expanded={showShareForm}
                >
                  <ExternalLink size={13} aria-hidden="true" /> {tx('profile.shareUpload')}
                </button>
              </div>
            ) : null}

            <CollapsiblePanel open={Boolean(asset) && showShareForm} className="snippet-share-form-collapse" openMs={280} closeMs={220}>
              <div className="snippet-share-form">
                <Select
                  size="small"
                  value={shareExpiry}
                  options={shareExpiryOptions.map((option) => ({ value: option.value, label: tx(option.labelKey, option.fallback) }))}
                  onChange={setShareExpiry}
                />
                <input
                  value={shareNote}
                  onChange={(event) => setShareNote(event.target.value)}
                  placeholder={tx('profile.linkNotePlaceholder')}
                />
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    if (!asset) return
                    onCreateShare(asset.id, shareExpiry, shareNote.trim())
                    setShareNote('')
                    setShowShareForm(false)
                  }}
                >
                  <ExternalLink size={13} aria-hidden="true" /> {tx('profile.createLink')}
                </button>
              </div>
            </CollapsiblePanel>

            {attachments.length === 0 && pendingFiles.length === 0 && shares.length === 0 ? (
              <p
                className={`snippet-mini-empty${uploadReservationEnabled ? ' is-reserved-placeholder' : ''}`}
                aria-hidden={uploadReservationEnabled || undefined}
              >
                {tx('profile.noAttachments')}
              </p>
            ) : null}

            {attachments.length > 0 || pendingFiles.length > 0 ? (
              <div className="snippet-attachment-list">
                {attachments.map((attachment) => {
                  const renaming = renamingFileId === attachment.fileId
                  return (
                    <div key={attachment.fileId} className={`snippet-attachment-row${renaming ? ' is-renaming' : ''}`}>
                      <FileText size={14} className="snippet-attachment-icon" aria-hidden="true" />
                      <div className="snippet-attachment-name-wrap">
                        <button
                          type="button"
                          className="snippet-attachment-name"
                          onDoubleClick={() => startRenameAttachment(attachment)}
                          onClick={(event) => {
                            // Single click selects; double-click renames (also available via pencil).
                            if (event.detail >= 2) startRenameAttachment(attachment)
                          }}
                          title={tx('profile.renameFileHint', 'Double-click to rename')}
                        >
                          <span>{attachment.fileName}</span>
                          {attachment.fileSize ? <em> · {formatFileSize(attachment.fileSize)}</em> : null}
                        </button>
                        <input
                          ref={renaming ? renameInputRef : undefined}
                          className="snippet-attachment-rename-input"
                          value={renaming ? renameValue : attachment.fileName}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={() => { if (renaming) commitRename() }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); commitRename() }
                            if (event.key === 'Escape') { event.preventDefault(); cancelRename() }
                          }}
                          aria-label={tx('profile.renameFile')}
                          tabIndex={renaming ? 0 : -1}
                        />
                      </div>
                      <div className="snippet-attachment-actions">
                        <button
                          type="button"
                          className={`icon-action${renaming ? ' active' : ''}`}
                          title={tx('profile.renameFile')}
                          onClick={() => (renaming ? commitRename() : startRenameAttachment(attachment))}
                        >
                          <Pencil size={12} aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-action" title={tx('profile.download')} onClick={() => onDownloadFile(attachment.fileId, attachment.fileName)}>
                          <Download size={12} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-action"
                          title={tx('profile.deleteFile')}
                          onClick={() => asset && onDeleteFile(asset.id, attachment.fileId)}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )
                })}
                {pendingFiles.map((pending) => {
                  const renaming = renamingFileId === pending.id
                  return (
                    <div key={pending.id} className={`snippet-attachment-row pending${renaming ? ' is-renaming' : ''}`}>
                      <FileText size={14} className="snippet-attachment-icon" aria-hidden="true" />
                      <div className="snippet-attachment-name-wrap">
                        <button
                          type="button"
                          className="snippet-attachment-name"
                          onClick={() => startRenamePending(pending)}
                          title={tx('profile.renameFile')}
                        >
                          <span>{pending.name}</span>
                          <em> · {formatFileSize(pending.file.size)} · {tx('profile.uploadPending')}</em>
                        </button>
                        <input
                          ref={renaming ? renameInputRef : undefined}
                          className="snippet-attachment-rename-input"
                          value={renaming ? renameValue : pending.name}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={() => { if (renaming) commitRename() }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); commitRename() }
                            if (event.key === 'Escape') { event.preventDefault(); cancelRename() }
                          }}
                          aria-label={tx('profile.renameFile')}
                          tabIndex={renaming ? 0 : -1}
                        />
                      </div>
                      <div className="snippet-attachment-actions">
                        <button
                          type="button"
                          className={`icon-action${renaming ? ' active' : ''}`}
                          title={tx('profile.renameFile')}
                          onClick={() => (renaming ? commitRename() : startRenamePending(pending))}
                        >
                          <Pencil size={12} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-action"
                          title={tx('dossier.remove')}
                          onClick={() => setPendingFiles((current) => current.filter((item) => item.id !== pending.id))}
                        >
                          <X size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {shares.length > 0 ? (
              <div className="snippet-share-list">
                <span className="snippet-section-label">{tx('profile.shareUpload')}</span>
                {shares.map((share) => {
                  const url = `${window.location.origin}${share.url}`
                  return (
                    <div key={share.id} className="snippet-share-row">
                      <code className="snippet-share-link">{share.url}</code>
                      <div className="snippet-attachment-actions">
                        <CopyButton value={url} label={tx('profile.shareUpload')} />
                        <button type="button" className="icon-action" title={tx('share.revoke')} onClick={() => asset && onRevokeShare(asset.id, share.id)}>
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>

          <div className="dialog-actions">
            <button type="button" className="secondary-action" onClick={() => requestClose()}>{tx('cancel')}</button>
            <button type="submit" className="primary-action" disabled={!resolvedName}>
              <Save size={14} aria-hidden="true" /> {tx('profile.saveSnippet')}
            </button>
          </div>
        </form>
      </section>
      </div>
    </ModalPortal>
  )
}
