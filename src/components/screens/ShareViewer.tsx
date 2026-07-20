import {
  Download,
  FileText,
  GraduationCap,
  Lock,
  MapPin,
  Save,
  Undo2,
  UploadCloud,
} from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  phdApi,
  type AuthSession,
  type CommunicationInput,
  type CommunicationPatchInput,
  type SharedApplicationPayload,
} from '../../api/phdApi'
import type { DetailTab } from '../../appModel'
import {
  normalizeSharePermission,
  normalizeShareSections,
  type ApplicationRecord,
  type SharePermission,
  type ShareSection,
} from '../../data/applications'
import { normalizeErrorMessage } from '../../errorMessages'
import {
  DEFAULT_UPLOAD_ALLOWED_TYPES,
  MAX_UPLOAD_FILE_SIZE,
  MAX_UPLOAD_FILES_PER_BATCH,
  formatFileSize,
} from '../../fileUploads'
import { allowedFileTypesLabel, normalizeAllowedFileTypes } from '../../fileTypes'
import { useI18n } from '../hooks/useI18n'
import { LaunchScreen } from '../shared/LaunchScreen'
import { FileDropzone } from '../shared/FileDropzone'
import { DossierView } from './DossierView'
import { Inspector } from './Inspector'

type SharedUploadAttachment = {
  fileId?: string
  fileName: string
  fileSize?: number
}

type SharedViewerTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

const SHARE_GUEST_SESSION: AuthSession = {
  token: 'share-guest',
  user: {
    id: 'share-guest',
    name: 'Shared guest',
    email: 'share@phd-atlas.local',
    role: 'user',
    createdAt: '2020-01-01T00:00:00.000Z',
    lastLoginAt: null,
    settings: {
      language: 'en',
      highContrast: false,
      themeAccent: 'Alpine blue',
      membershipPlan: 'free',
    },
  },
  settings: {
    allowRegistration: true,
    notificationMailbox: '',
    backupFrequency: 'weekly',
    encryptionAtRest: true,
  },
}

function localId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sharedUploadAttachments(item: {
  fileId?: string
  fileName?: string
  fileSize?: number
  versions?: Array<{ fileId?: string; file: string; size?: number }>
}) {
  const seen = new Set<string>()
  const attachments: SharedUploadAttachment[] = []
  ;(item.versions ?? []).forEach((version, index) => {
    const key = version.fileId ?? `${version.file}-${index}`
    if (seen.has(key)) return
    seen.add(key)
    attachments.push({
      fileId: version.fileId,
      fileName: version.file,
      fileSize: version.size,
    })
  })
  if (item.fileId && !seen.has(item.fileId)) {
    attachments.push({
      fileId: item.fileId,
      fileName: item.fileName ?? '',
      fileSize: item.fileSize,
    })
  }
  return attachments.reverse()
}

/** Map share sections → dossier DetailTabs (materials + tasks share the checklist tab). */
export function shareSectionsToDetailTabs(sections: readonly ShareSection[]): DetailTab[] {
  const tabs: DetailTab[] = []
  const set = new Set(sections)
  if (set.has('overview')) tabs.push('dossier')
  if (set.has('materials') || set.has('tasks')) tabs.push('materials')
  if (set.has('communications')) tabs.push('mail')
  if (set.has('funding')) tabs.push('funding')
  if (set.has('timeline')) tabs.push('timeline')
  return tabs
}

export function sharedPayloadToApplication(data: SharedApplicationPayload): ApplicationRecord {
  return {
    id: 'shared-application',
    ownerId: 'share-owner',
    professor: {
      english: data.professor.english,
      chinese: data.professor.chinese ?? '',
      email: data.professor.email,
      phone: data.professor.phone ?? '',
      social: data.professor.social ?? '',
      homepage: data.professor.homepage,
      research: data.professor.research,
      lab: data.professor.lab ?? '',
    },
    school: {
      name: data.school.name,
      country: data.school.country,
      website: data.school.website,
    },
    program: data.program,
    deadline: data.deadline,
    status: data.status,
    progress: typeof data.progress === 'number' ? data.progress : 0,
    priority: typeof data.priority === 'number' ? data.priority : 0,
    tags: data.tags ?? [],
    nextReminder: data.nextReminder ?? '',
    result: data.result ?? '',
    dossierCards: data.dossierCards,
    materials: (data.materials ?? []).map((material) => ({
      id: material.id,
      name: material.name,
      type: material.type ?? 'Document',
      status: material.status,
      group: material.group,
      details: material.details,
      reminderEnabled: material.reminderEnabled,
      reminderDate: material.reminderDate,
      requiredCount: material.requiredCount,
      recommenders: material.recommenders,
      version: material.version ?? 'v0',
      updatedAt: material.updatedAt ?? '',
      fileId: material.fileId,
      fileName: material.fileName,
      fileSize: material.fileSize,
      allowedFileTypes: material.allowedFileTypes,
      versions: material.versions,
    })),
    communications: data.communications ?? [],
    scholarships: data.scholarships ?? [],
    fees: data.fees ?? [],
    tasks: (data.tasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      due: task.due,
      done: task.done,
      details: task.details,
      attachmentRequired: task.attachmentRequired,
      allowedFileTypes: task.allowedFileTypes,
      fileId: task.fileId,
      fileName: task.fileName,
      fileSize: task.fileSize,
      versions: task.versions,
    })),
    timeline: data.timeline ?? [],
    versions: data.versions ?? [],
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  }
}

function cloneApplication(app: ApplicationRecord): ApplicationRecord {
  return structuredClone(app)
}

function missingIds(baseline: Array<{ id: string }>, next: Array<{ id: string }>) {
  const nextIds = new Set(next.map((item) => item.id))
  return baseline.map((item) => item.id).filter((id) => !nextIds.has(id))
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof UploadCloud
  title: string
  body: string
}) {
  return (
    <div className="share-empty-state">
      <span><Icon size={18} aria-hidden="true" /></span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}

export function ShareViewer({ token }: { token: string }) {
  const { tx, format, lang } = useI18n()
  const [data, setData] = useState<SharedApplicationPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [baseline, setBaseline] = useState<ApplicationRecord | null>(null)
  const [draft, setDraft] = useState<ApplicationRecord | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<DetailTab>('dossier')
  const [uploadingMaterialId, setUploadingMaterialId] = useState<string | null>(null)

  const applyPayload = useCallback((payload: SharedApplicationPayload) => {
    const record = sharedPayloadToApplication(payload)
    setData(payload)
    setBaseline(cloneApplication(record))
    setDraft(cloneApplication(record))
    setIsDirty(false)
    const tabs = shareSectionsToDetailTabs(normalizeShareSections(payload.sections))
    setTab((current) => (tabs.includes(current) ? current : tabs[0] ?? 'dossier'))
  }, [])

  useEffect(() => {
    let ignore = false
    setLoading(true)
    phdApi
      .getSharedApplication(token)
      .then((payload) => {
        if (!ignore) applyPayload(payload)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(normalizeErrorMessage(err, lang, tx('shareViewer.loadFailed')))
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [token, tx, lang, applyPayload])

  const permission: SharePermission = data ? normalizeSharePermission(data.permission) : 'view'
  const sections = data ? normalizeShareSections(data.sections) : []
  const canEdit = permission === 'edit'
  const canUpload = permission === 'upload' || permission === 'edit'
  const hasSection = useCallback(
    (section: ShareSection) => sections.includes(section),
    [sections],
  )
  const allowedTabs = useMemo(() => shareSectionsToDetailTabs(sections), [sections])
  const showVersions = hasSection('versions')

  const updateDraft = useCallback((next: ApplicationRecord) => {
    setDraft(next)
    setIsDirty(true)
  }, [])

  const patchDraft = useCallback((updater: (current: ApplicationRecord) => ApplicationRecord) => {
    setDraft((current) => {
      if (!current) return current
      setIsDirty(true)
      return updater(current)
    })
  }, [])

  const downloadSharedFile = async (fileId: string, name: string) => {
    const blob = await phdApi.downloadSharedFile(token, fileId)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  const uploadMaterialFiles = async (materialId: string, files: File[]) => {
    if (files.length === 0) return
    const targetKey = `material:${materialId}`
    setUploadingMaterialId(targetKey)
    setActionError(null)
    try {
      const payload = await phdApi.uploadSharedMaterialFiles(token, materialId, files)
      applyPayload(payload)
    } catch (err) {
      setActionError(normalizeErrorMessage(err, lang, tx('shareViewer.uploadFailed')))
    } finally {
      setUploadingMaterialId(null)
    }
  }

  const uploadTaskFiles = async (taskId: string, files: File[]) => {
    if (files.length === 0) return
    const targetKey = `task:${taskId}`
    setUploadingMaterialId(targetKey)
    setActionError(null)
    try {
      const payload = await phdApi.uploadSharedTaskFiles(token, taskId, files)
      applyPayload(payload)
    } catch (err) {
      setActionError(normalizeErrorMessage(err, lang, tx('shareViewer.uploadFailed')))
    } finally {
      setUploadingMaterialId(null)
    }
  }

  const saveSharedDraft = async () => {
    if (!draft || !baseline || !canEdit) return
    setSaving(true)
    setActionError(null)
    try {
      let payload: SharedApplicationPayload | null = data
      const runSection = async (section: ShareSection, patch: Record<string, unknown>) => {
        payload = await phdApi.updateSharedSection(token, section, patch)
      }

      if (hasSection('overview')) {
        await runSection('overview', {
          school: draft.school,
          professor: draft.professor,
          program: draft.program,
          deadline: draft.deadline,
          status: draft.status,
          progress: draft.progress,
          priority: draft.priority,
          tags: draft.tags,
          nextReminder: draft.nextReminder,
          result: draft.result,
          dossierCards: draft.dossierCards ?? [],
        })
      }
      if (hasSection('materials')) {
        await runSection('materials', { materials: draft.materials })
      }
      if (hasSection('tasks')) {
        await runSection('tasks', {
          tasks: draft.tasks,
          deletedIds: missingIds(baseline.tasks, draft.tasks),
        })
      }
      if (hasSection('communications')) {
        await runSection('communications', {
          communications: draft.communications,
          deletedIds: missingIds(baseline.communications, draft.communications),
        })
      }
      if (hasSection('funding')) {
        await runSection('funding', {
          scholarships: draft.scholarships,
          fees: draft.fees ?? [],
          deletedScholarshipIds: missingIds(baseline.scholarships, draft.scholarships),
          deletedFeeIds: missingIds(baseline.fees ?? [], draft.fees ?? []),
        })
      }
      if (hasSection('timeline')) {
        await runSection('timeline', {
          timeline: draft.timeline,
          deletedIds: missingIds(baseline.timeline, draft.timeline),
        })
      }

      if (payload) applyPayload(payload)
    } catch (err) {
      setActionError(normalizeErrorMessage(err, lang, tx('shareViewer.editFailed')))
    } finally {
      setSaving(false)
    }
  }

  const discardDraft = () => {
    if (!baseline) return
    setDraft(cloneApplication(baseline))
    setIsDirty(false)
    setActionError(null)
  }

  const handleInspectorEditField = (field: string, value: string) => {
    if (!canEdit || !draft) return
    if (field === 'deadline') {
      updateDraft({ ...draft, deadline: value })
      return
    }
    if (field === 'professor.english') {
      updateDraft({ ...draft, professor: { ...draft.professor, english: value } })
      return
    }
    if (field === 'professor.email') {
      updateDraft({ ...draft, professor: { ...draft.professor, email: value } })
      return
    }
    if (field === 'professor.homepage') {
      updateDraft({ ...draft, professor: { ...draft.professor, homepage: value } })
      return
    }
    if (field === 'school.website') {
      updateDraft({ ...draft, school: { ...draft.school, website: value } })
      return
    }
    if (field === 'school.name') {
      updateDraft({ ...draft, school: { ...draft.school, name: value } })
      return
    }
    if (field === 'school.country') {
      updateDraft({ ...draft, school: { ...draft.school, country: value } })
      return
    }
    if (field === 'program') {
      updateDraft({ ...draft, program: value })
      return
    }
    if (field.startsWith('material:') && field.endsWith(':reminderDate')) {
      const materialId = field.split(':')[1]
      updateDraft({
        ...draft,
        materials: draft.materials.map((material) => (
          material.id === materialId ? { ...material, reminderDate: value, reminderEnabled: true } : material
        )),
      })
      return
    }
    if (field.startsWith('task:') && field.endsWith(':due')) {
      const taskId = field.split(':')[1]
      updateDraft({
        ...draft,
        tasks: draft.tasks.map((task) => (task.id === taskId ? { ...task, due: value } : task)),
      })
      return
    }
    if (field.startsWith('scholarship:') && field.endsWith(':endDate')) {
      const scholarshipId = field.split(':')[1]
      updateDraft({
        ...draft,
        scholarships: draft.scholarships.map((item) => (
          item.id === scholarshipId ? { ...item, endDate: value } : item
        )),
      })
    }
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard may be unavailable on some shared browsers; silent no-op.
    }
  }

  if (loading) {
    return <LaunchScreen variant="standalone" message={tx('shareViewer.loading')} />
  }

  if (error) {
    return (
      <main className="auth-canvas route-content-reveal">
        <section className="auth-sheet" aria-label={tx('shareViewer.accessDenied')}>
          <div className="auth-mark">
            <Lock size={24} aria-hidden="true" />
          </div>
          <h1>{tx('shareViewer.accessDenied')}</h1>
          <p>{error}</p>
        </section>
      </main>
    )
  }

  if (!data || !draft || !baseline) return null

  const modeLabel = permission === 'edit'
    ? tx('shareViewer.modeEdit')
    : permission === 'upload'
      ? tx('shareViewer.modeUpload')
      : tx('shareViewer.modeView')

  /* ─── Upload-only hub (pure upload links) ─── */
  if (permission === 'upload' && !canEdit) {
    const materials = data.materials ?? []
    const tasks = data.tasks ?? []
    const uploadTargets: Array<{
      key: string
      kind: 'material' | 'task'
      id: string
      name: string
      details: string
      statusLabel: string
      required: boolean
      attachments: SharedUploadAttachment[]
      allowedTypes: string[]
      typesLabel: string
    }> = []

    if (hasSection('materials')) {
      materials.forEach((material) => {
        const allowedFileTypes = normalizeAllowedFileTypes(material.allowedFileTypes)
        const effectiveAllowed = allowedFileTypes.length > 0 ? allowedFileTypes : [...DEFAULT_UPLOAD_ALLOWED_TYPES]
        uploadTargets.push({
          key: `material:${material.id}`,
          kind: 'material',
          id: material.id,
          name: material.name,
          details: material.details ?? '',
          statusLabel: material.status,
          required: !/submitted|complete|done|ready|已提交|完成|就绪/i.test(material.status),
          attachments: sharedUploadAttachments(material),
          allowedTypes: effectiveAllowed,
          typesLabel: allowedFileTypes.length
            ? format(tx('shareViewer.uploadItemTypes'), { types: allowedFileTypesLabel(allowedFileTypes, tx('dossier.fileTypeAny')) })
            : tx('shareViewer.uploadItemAnyType'),
        })
      })
    }
    if (hasSection('tasks')) {
      tasks.forEach((task) => {
        uploadTargets.push({
          key: `task:${task.id}`,
          kind: 'task',
          id: task.id,
          name: task.title,
          details: task.details ?? '',
          statusLabel: task.done ? tx('shareViewer.taskDone') : tx('shareViewer.taskOpen'),
          required: !task.done,
          attachments: sharedUploadAttachments(task),
          allowedTypes: [...DEFAULT_UPLOAD_ALLOWED_TYPES],
          typesLabel: tx('shareViewer.uploadItemAnyType'),
        })
      })
    }
    const uploadDoneCount = uploadTargets.filter((item) => item.attachments.length > 0).length

    return (
      <main className="share-viewer share-project-viewer share-upload-mode route-content-reveal">
        <header className="share-project-hero">
          <div className="share-project-brand">
            <GraduationCap size={20} aria-hidden="true" />
            <span>{tx('shareViewer.brand')}</span>
            <span className="share-permission-chip is-upload">{modeLabel}</span>
          </div>
          <div className="share-project-title-row">
            <div>
              <span className="eyebrow">{tx('shareViewer.uploadHubEyebrow')}</span>
              <h1>{data.school.name}</h1>
              <p>{data.program} · {data.professor.english}</p>
            </div>
            <div className="share-project-location">
              <MapPin size={14} aria-hidden="true" />
              <span>{data.school.country}</span>
            </div>
          </div>
          <div className="share-upload-progress-bar" aria-label={format(tx('shareViewer.uploadHubProgress'), { done: uploadDoneCount, total: uploadTargets.length })}>
            <div className="share-upload-progress-meta">
              <strong>{tx('shareViewer.uploadHubTitle')}</strong>
              <span>{format(tx('shareViewer.uploadHubProgress'), { done: uploadDoneCount, total: uploadTargets.length })}</span>
            </div>
            <div className="share-upload-progress-track">
              <span style={{ width: `${uploadTargets.length ? Math.round((uploadDoneCount / uploadTargets.length) * 100) : 0}%` }} />
            </div>
            <p>{tx('shareViewer.uploadHubSubtitle')}</p>
          </div>
          {actionError ? <p className="settings-inline-error">{actionError}</p> : null}
        </header>

        <section className="share-upload-hub">
          {uploadTargets.length === 0 ? (
            <EmptyState icon={UploadCloud} title={tx('shareViewer.uploadHubEmpty')} body={tx('shareViewer.uploadHubEmptyHint')} />
          ) : (
            <div className="share-upload-list">
              {uploadTargets.map((item) => {
                const isUploading = uploadingMaterialId === item.key
                const hasFiles = item.attachments.length > 0
                return (
                  <article key={item.key} className={`share-upload-item${hasFiles ? ' has-files' : ''}`}>
                    <div className="share-upload-item-head">
                      <div>
                        <div className="share-upload-item-title-row">
                          <strong>{item.name}</strong>
                          <span className={`share-upload-chip ${item.required ? 'is-required' : 'is-optional'}`}>
                            {item.required ? tx('shareViewer.uploadItemRequired') : tx('shareViewer.uploadItemOptional')}
                          </span>
                          <span className={`share-upload-chip ${hasFiles ? 'is-ready' : 'is-waiting'}`}>
                            {hasFiles ? tx('shareViewer.uploadItemHasFiles') : tx('shareViewer.uploadItemNeedsFile')}
                          </span>
                        </div>
                        <div className="share-upload-item-meta">
                          <span>{item.statusLabel}</span>
                          <span>{item.kind === 'material' ? tx('share.sections.materials') : tx('share.sections.tasks')}</span>
                        </div>
                      </div>
                    </div>

                    {item.details ? (
                      <div className="share-upload-item-details">
                        <span className="eyebrow">{tx('shareViewer.uploadItemDetails')}</span>
                        <p>{item.details}</p>
                      </div>
                    ) : null}

                    <div className="share-upload-item-limits" aria-label={tx('shareViewer.uploadItemLimits')}>
                      <span>{item.typesLabel}</span>
                      <span>{format(tx('shareViewer.uploadItemMaxSize'), { size: formatFileSize(MAX_UPLOAD_FILE_SIZE) })}</span>
                      <span>{format(tx('shareViewer.uploadItemMaxBatch'), { count: MAX_UPLOAD_FILES_PER_BATCH })}</span>
                    </div>

                    {hasFiles ? (
                      <div className="share-uploaded-files" aria-label={tx('dossier.attachments')}>
                        {item.attachments.map((attachment, index) => (
                          <button
                            key={attachment.fileId ?? `${attachment.fileName}-${index}`}
                            type="button"
                            disabled={!attachment.fileId}
                            onClick={() => attachment.fileId && void downloadSharedFile(attachment.fileId, attachment.fileName || item.name)}
                          >
                            <FileText size={13} aria-hidden="true" />
                            <span>
                              <strong>{attachment.fileName || item.name}</strong>
                              {attachment.fileSize ? <small>{formatFileSize(attachment.fileSize)}</small> : null}
                            </span>
                            <Download size={12} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <FileDropzone
                      compact
                      title={isUploading ? tx('working') : tx('dossier.uploadDropTitle')}
                      hint={tx('dossier.uploadDropHint')}
                      allowedTypes={item.allowedTypes}
                      maxFileSize={MAX_UPLOAD_FILE_SIZE}
                      maxFiles={MAX_UPLOAD_FILES_PER_BATCH}
                      disabled={isUploading}
                      onFiles={(files) => {
                        if (item.kind === 'material') void uploadMaterialFiles(item.id, files)
                        else void uploadTaskFiles(item.id, files)
                      }}
                    />
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>
    )
  }

  /* ─── View / Edit: dossier + inspector workspace shell ─── */
  const readOnly = !canEdit
  const activeTab = allowedTabs.includes(tab) ? tab : allowedTabs[0] ?? 'dossier'
  const guestSession: AuthSession = {
    ...SHARE_GUEST_SESSION,
    user: {
      ...SHARE_GUEST_SESSION.user,
      settings: {
        ...SHARE_GUEST_SESSION.user.settings,
        language: lang,
      },
    },
  }

  return (
    <main className={`share-workspace share-mode-${permission} route-content-reveal`}>
      <header className="share-workspace-topbar">
        <div className="share-workspace-brand">
          <GraduationCap size={18} aria-hidden="true" />
          <div>
            <span className="eyebrow">{tx('shareViewer.brand')}</span>
            <strong>{data.school.name}</strong>
          </div>
          <span className={`share-permission-chip is-${permission}`}>{modeLabel}</span>
        </div>
        <p className="share-workspace-hint">
          {canEdit ? tx('shareViewer.editPermissionHint') : tx('shareViewer.viewPermissionHint')}
        </p>
        {canEdit && isDirty ? (
          <div className="share-workspace-save-actions">
            <button type="button" className="warning-action" onClick={discardDraft} disabled={saving}>
              <Undo2 size={13} aria-hidden="true" />
              {tx('dossier.discardChanges')}
            </button>
            <button type="button" className="primary-action" onClick={() => void saveSharedDraft()} disabled={saving}>
              <Save size={13} aria-hidden="true" />
              {saving ? tx('dossier.saving') : tx('dossier.save')}
            </button>
          </div>
        ) : null}
      </header>

      {actionError ? <p className="settings-inline-error share-workspace-error">{actionError}</p> : null}

      {allowedTabs.length === 0 && !showVersions ? (
        <div className="share-workspace-empty">
          <EmptyState
            icon={FileText}
            title={tx('shareViewer.accessDenied')}
            body={tx('shareViewer.subtitle')}
          />
        </div>
      ) : (
        <div className="share-workspace-body">
          {allowedTabs.length > 0 ? (
            <div className="share-workspace-dossier">
              <DossierView
                application={baseline}
                draft={draft}
                tab={activeTab}
                saving={saving}
                isDirty={isDirty}
                profileAssets={[]}
                session={guestSession}
                allowedTabs={allowedTabs}
                readOnly={readOnly}
                readOnlyBanner={tx('shareViewer.viewPermissionHint')}
                onTab={(next, direction = 'forward') => {
                  if (next === activeTab) return
                  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
                  const transitionDocument = document as SharedViewerTransitionDocument
                  if (!transitionDocument.startViewTransition || reduceMotion) {
                    startTransition(() => setTab(next))
                    return
                  }
                  const root = document.documentElement
                  const token = `shared-dossier-${Date.now()}`
                  root.dataset.atlasTransitionScope = 'dossier-tab'
                  root.dataset.atlasTransitionDirection = direction
                  root.dataset.atlasTransitionToken = token
                  const transition = transitionDocument.startViewTransition.call(transitionDocument, () => {
                    flushSync(() => setTab(next))
                  })
                  void transition.finished.finally(() => {
                    if (root.dataset.atlasTransitionToken !== token) return
                    delete root.dataset.atlasTransitionScope
                    delete root.dataset.atlasTransitionDirection
                    delete root.dataset.atlasTransitionToken
                  })
                }}
                onDraft={canEdit ? updateDraft : () => undefined}
                onSave={() => void saveSharedDraft()}
                onDiscardDraft={discardDraft}
                onDelete={() => undefined}
                onShare={() => undefined}
                onCopy={(value) => void copyText(value)}
                onUpload={() => undefined}
                onUploadMaterialFiles={canUpload ? (materialId, files) => void uploadMaterialFiles(materialId, files) : undefined}
                onUploadTaskFiles={canUpload ? (taskId, files) => void uploadTaskFiles(taskId, files) : undefined}
                onDownload={(fileId, name) => {
                  if (fileId) void downloadSharedFile(fileId, name || 'download')
                }}
                onAddTask={(title, due, options) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    tasks: [{
                      id: localId('task'),
                      title,
                      due,
                      done: false,
                      details: options?.details,
                      reminderEnabled: options?.reminderEnabled,
                      reminderOffsets: options?.reminderOffsets,
                      reminderTime: options?.reminderTime,
                      reminderRepeat: options?.reminderRepeat,
                      attachmentRequired: options?.attachmentRequired,
                      uploadReserved: options?.uploadReserved,
                      allowedFileTypes: options?.allowedFileTypes,
                    }, ...current.tasks],
                  }))
                }}
                onUpdateTask={(taskId, patch) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
                  }))
                }}
                onToggleTask={(taskId, done) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, done } : task)),
                  }))
                }}
                onRemoveTask={(taskId) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    tasks: current.tasks.filter((task) => task.id !== taskId),
                  }))
                }}
                onRemoveTasks={(taskIds) => {
                  if (!canEdit) return
                  const remove = new Set(taskIds)
                  patchDraft((current) => ({
                    ...current,
                    tasks: current.tasks.filter((task) => !remove.has(task.id)),
                  }))
                }}
                onAddCommunication={(input: CommunicationInput) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    communications: [{
                      id: localId('comm'),
                      subject: input.subject,
                      channel: input.channel,
                      date: input.date,
                      summary: input.summary,
                      direction: input.direction,
                      messageType: input.messageType,
                      from: input.from,
                      to: input.to,
                      time: input.time,
                      attachments: input.attachments,
                    }, ...current.communications],
                  }))
                }}
                onUpdateCommunication={(id: string, input: CommunicationPatchInput) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    communications: current.communications.map((item) => (
                      item.id === id ? { ...item, ...input } : item
                    )),
                  }))
                }}
                onRemoveCommunication={(id) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    communications: current.communications.filter((item) => item.id !== id),
                  }))
                }}
                onRemoveCommunications={(ids) => {
                  if (!canEdit) return
                  const remove = new Set(ids)
                  patchDraft((current) => ({
                    ...current,
                    communications: current.communications.filter((item) => !remove.has(item.id)),
                  }))
                }}
                onAddScholarship={(input) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    scholarships: [...current.scholarships, { id: localId('scholarship'), ...input }],
                  }))
                }}
                onUpdateScholarship={(id, input) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    scholarships: current.scholarships.map((item) => (
                      item.id === id ? { ...item, ...input } : item
                    )),
                  }))
                }}
                onRemoveScholarship={(id) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    scholarships: current.scholarships.filter((item) => item.id !== id),
                  }))
                }}
                onRemoveScholarships={(ids) => {
                  if (!canEdit) return
                  const remove = new Set(ids)
                  patchDraft((current) => ({
                    ...current,
                    scholarships: current.scholarships.filter((item) => !remove.has(item.id)),
                  }))
                }}
                onAddFee={(input) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    fees: [
                      ...(current.fees ?? []),
                      {
                        id: localId('fee'),
                        amount: input.amount,
                        currency: input.currency,
                        paidDate: input.paidDate ?? null,
                        waived: input.waived,
                        notes: input.notes,
                        createdAt: new Date().toISOString(),
                      },
                    ],
                  }))
                }}
                onUpdateFee={(feeId, patch) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    fees: (current.fees ?? []).map((fee) => (fee.id === feeId ? { ...fee, ...patch } : fee)),
                  }))
                }}
                onDeleteFee={(feeId) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    fees: (current.fees ?? []).filter((fee) => fee.id !== feeId),
                  }))
                }}
                onAddTimelineEvent={(title, date, note) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    timeline: [{ id: localId('timeline'), title, date, note }, ...current.timeline],
                  }))
                }}
                onUpdateTimelineEvent={(id, title, date, note) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    timeline: current.timeline.map((event) => (
                      event.id === id ? { ...event, title, date, note } : event
                    )),
                  }))
                }}
                onRemoveTimelineEvent={(id) => {
                  if (!canEdit) return
                  patchDraft((current) => ({
                    ...current,
                    timeline: current.timeline.filter((event) => event.id !== id),
                  }))
                }}
                onRemoveTimelineEvents={(ids) => {
                  if (!canEdit) return
                  const remove = new Set(ids)
                  patchDraft((current) => ({
                    ...current,
                    timeline: current.timeline.filter((event) => !remove.has(event.id)),
                  }))
                }}
              />
            </div>
          ) : null}

          <Inspector
            application={draft}
            backups={[]}
            isPro={false}
            readOnly={readOnly}
            versions={showVersions ? draft.versions : []}
            onCopy={(value) => void copyText(value)}
            onEditField={handleInspectorEditField}
            onExport={() => undefined}
            onBackup={() => undefined}
            onUpgrade={() => undefined}
            onRestore={() => undefined}
            onDeleteBackup={() => undefined}
          />
        </div>
      )}
    </main>
  )
}
