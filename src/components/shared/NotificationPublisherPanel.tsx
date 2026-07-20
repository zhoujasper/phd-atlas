import {
  Bell,
  Check,
  Download,
  Mail,
  Megaphone,
  Search,
  Send,
  Settings,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import { useId, useMemo, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import type { NotificationGroup, NotificationPublishInput, NotificationPublishResult } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { MAX_CSV_IMPORT_FILE_SIZE, MAX_UPLOAD_FILES_PER_BATCH } from '../../fileUploads'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { FileDropzone } from './FileDropzone'

export type NotificationPublisherRecipient = {
  id: string
  label: string
  description?: string
  badge?: string
}

export type NotificationPublisherAudience = {
  id: string
  label: string
  description?: string
}

type NotificationPublisherMessage = { type: 'success' | 'error'; text: string }
type CsvPreviewGroup = { name: string; memberIds: string[] }
type CsvPreview = {
  groups: CsvPreviewGroup[]
  matchedMembers: number
  skippedRows: number
}

const CSV_GROUP_COLUMNS = ['group_name', 'group', 'name']
const CSV_MEMBER_COLUMNS = ['member_email', 'email', 'recipient_email', 'member_id', 'recipient_id', 'member_name', 'name']

function normalizeLookup(value?: string) {
  return value?.trim().toLocaleLowerCase() ?? ''
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      row.push(cell.trim())
      cell = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += char
  }

  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function csvValue(row: string[], headers: Map<string, number>, candidates: string[]) {
  for (const candidate of candidates) {
    const index = headers.get(candidate)
    if (typeof index === 'number') return row[index]?.trim() ?? ''
  }
  return ''
}

function buildRecipientLookup(recipients: NotificationPublisherRecipient[]) {
  const lookup = new Map<string, string>()
  for (const recipient of recipients) {
    for (const value of [recipient.id, recipient.label, recipient.description]) {
      const normalized = normalizeLookup(value)
      if (normalized) lookup.set(normalized, recipient.id)
    }
  }
  return lookup
}

function buildCsvPreview(text: string, recipients: NotificationPublisherRecipient[]) {
  const rows = parseCsvRows(text)
  if (rows.length < 2) return null

  const headerRow = rows[0].map((header) => normalizeLookup(header).replace(/\s+/g, '_'))
  const headers = new Map(headerRow.map((header, index) => [header, index]))
  const hasGroupColumn = CSV_GROUP_COLUMNS.some((column) => headers.has(column))
  const hasMemberColumn = CSV_MEMBER_COLUMNS.some((column) => headers.has(column))
  if (!hasGroupColumn || !hasMemberColumn) return null

  const recipientLookup = buildRecipientLookup(recipients)
  const grouped = new Map<string, Set<string>>()
  let skippedRows = 0

  for (const row of rows.slice(1)) {
    const groupName = csvValue(row, headers, CSV_GROUP_COLUMNS)
    const memberValue = csvValue(row, headers, CSV_MEMBER_COLUMNS)
    const memberId = recipientLookup.get(normalizeLookup(memberValue))
    if (!groupName || !memberId) {
      skippedRows += 1
      continue
    }
    const existing = grouped.get(groupName) ?? new Set<string>()
    existing.add(memberId)
    grouped.set(groupName, existing)
  }

  const groups = Array.from(grouped.entries())
    .map(([name, memberIds]) => ({ name, memberIds: Array.from(memberIds) }))
    .filter((group) => group.memberIds.length > 0)

  return {
    groups,
    matchedMembers: groups.reduce((total, group) => total + group.memberIds.length, 0),
    skippedRows,
  }
}

function csvEscape(value: string) {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function NotificationPublisherPanel({
  className = '',
  eyebrow,
  title: heading,
  description,
  recipientField,
  recipients = [],
  groups = [],
  audiences = [],
  onPublish,
  onCreateGroup,
  onDeleteGroup,
}: {
  className?: string
  eyebrow: string
  title: string
  description?: string
  recipientField: 'userIds' | 'memberIds'
  recipients: NotificationPublisherRecipient[]
  groups: NotificationGroup[]
  audiences: NotificationPublisherAudience[]
  onPublish: (input: NotificationPublishInput) => Promise<NotificationPublishResult>
  onCreateGroup: (name: string, memberIds: string[]) => Promise<void>
  onDeleteGroup: (groupId: string) => Promise<void>
}) {
  const { tx, format, lang } = useI18n()
  const publisherText = (key: string, zhFallback: string, enFallback: string) => (
    tx(`notificationPublisher.${key}`, lang === 'zh' ? zhFallback : enFallback)
  )
  const publisherFormat = (
    key: string,
    values: Record<string, string | number>,
    zhFallback: string,
    enFallback: string,
  ) => format(publisherText(key, zhFallback, enFallback), values)
  const recipientOptions = useMemo(() => recipients ?? [], [recipients])
  const groupOptions = useMemo(() => groups ?? [], [groups])
  const audienceOptions = useMemo(() => audiences ?? [], [audiences])
  const hasDescription = Boolean(description?.trim())
  const composeTitleId = useId()
  const composeDescId = useId()
  const groupTitleId = useId()
  const groupDescId = useId()
  const titleInputRef = useRef<HTMLInputElement>(null)
  const groupNameInputRef = useRef<HTMLInputElement>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [channels, setChannels] = useState<Array<'in_app' | 'email'>>(['in_app'])
  const [recipientIds, setRecipientIds] = useState<Set<string>>(() => new Set())
  const [groupIds, setGroupIds] = useState<Set<string>>(() => new Set())
  const [audienceIds, setAudienceIds] = useState<Set<string>>(() => new Set())
  const [groupName, setGroupName] = useState('')
  const [groupMemberIds, setGroupMemberIds] = useState<Set<string>>(() => new Set())
  const [recipientQuery, setRecipientQuery] = useState('')
  const [groupRecipientQuery, setGroupRecipientQuery] = useState('')
  const [message, setMessage] = useState<NotificationPublisherMessage | null>(null)
  const [groupMessage, setGroupMessage] = useState<NotificationPublisherMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [groupBusy, setGroupBusy] = useState(false)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null)
  const [csvFileName, setCsvFileName] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)

  const composeClose = useAnimatedClose(composeOpen, () => setComposeOpen(false))
  const groupClose = useAnimatedClose(groupDialogOpen, () => setGroupDialogOpen(false))

  const composeDialogRef = useModalA11y<HTMLDivElement>({
    open: composeOpen && !composeClose.exiting,
    onClose: () => {
      if (!sending) composeClose.requestClose()
    },
    initialFocusRef: titleInputRef,
  })
  const groupDialogRef = useModalA11y<HTMLDivElement>({
    open: groupDialogOpen && !groupClose.exiting,
    onClose: () => {
      if (!groupBusy && !csvBusy) groupClose.requestClose()
    },
    initialFocusRef: groupNameInputRef,
  })

  const filteredRecipients = useMemo(() => {
    const query = recipientQuery.trim().toLocaleLowerCase()
    if (!query) return recipientOptions
    return recipientOptions.filter((recipient) => (
      [recipient.label, recipient.description, recipient.badge]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    ))
  }, [recipientOptions, recipientQuery])

  const filteredGroupRecipients = useMemo(() => {
    const query = groupRecipientQuery.trim().toLocaleLowerCase()
    if (!query) return recipientOptions
    return recipientOptions.filter((recipient) => (
      [recipient.label, recipient.description, recipient.badge]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    ))
  }, [groupRecipientQuery, recipientOptions])

  const selectedTargetCount = recipientIds.size + groupIds.size + audienceIds.size
  const canSend = title.trim() && body.trim() && channels.length > 0 && selectedTargetCount > 0 && !sending
  const canCreateGroup = groupName.trim() && groupMemberIds.size > 0 && !groupBusy
  const canImportGroups = Boolean(csvPreview?.groups.length) && !csvBusy
  const renderInPortal = (node: ReactNode) => (
    <ModalPortal>{node}</ModalPortal>
  )

  const toggleSet = (setter: Dispatch<SetStateAction<Set<string>>>, id: string) => {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleChannel = (channel: 'in_app' | 'email') => {
    setChannels((current) => {
      if (current.includes(channel)) return current.filter((item) => item !== channel)
      return [...current, channel]
    })
  }

  const clearTargets = () => {
    setRecipientIds(new Set())
    setGroupIds(new Set())
    setAudienceIds(new Set())
  }

  const resetCompose = () => {
    setTitle('')
    setBody('')
    setChannels(['in_app'])
    clearTargets()
    setRecipientQuery('')
  }

  const openCompose = () => {
    setMessage(null)
    setComposeOpen(true)
  }

  const openGroupDialog = () => {
    setGroupMessage(null)
    setGroupDialogOpen(true)
  }

  const handlePublish = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !body.trim()) {
      setMessage({ type: 'error', text: tx('notificationPublisher.composeRequired') })
      return
    }
    if (channels.length === 0) {
      setMessage({ type: 'error', text: tx('notificationPublisher.chooseChannel') })
      return
    }
    if (selectedTargetCount === 0) {
      setMessage({ type: 'error', text: tx('notificationPublisher.chooseTarget') })
      return
    }
    const input: NotificationPublishInput = {
      title: title.trim(),
      body: body.trim(),
      channels,
      groupIds: Array.from(groupIds),
      audiences: Array.from(audienceIds),
    }
    if (recipientField === 'userIds') input.userIds = Array.from(recipientIds)
    else input.memberIds = Array.from(recipientIds)
    setSending(true)
    setMessage(null)
    try {
      const result = await onPublish(input)
      setMessage({
        type: 'success',
        text: format(tx('notificationPublisher.sent'), {
          recipients: result.recipients,
          created: result.created,
          emailed: result.emailed,
        }),
      })
      resetCompose()
      composeClose.requestClose()
    } catch (error) {
      setMessage({ type: 'error', text: normalizeErrorMessage(error, lang) })
    } finally {
      setSending(false)
    }
  }

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setGroupMessage({ type: 'error', text: tx('notificationPublisher.groupNameRequired') })
      return
    }
    if (groupMemberIds.size === 0) {
      setGroupMessage({ type: 'error', text: tx('notificationPublisher.groupMembersRequired') })
      return
    }
    setGroupBusy(true)
    setGroupMessage(null)
    try {
      await onCreateGroup(groupName.trim(), Array.from(groupMemberIds))
      setGroupName('')
      setGroupMemberIds(new Set())
      setGroupRecipientQuery('')
      setGroupMessage({ type: 'success', text: tx('notificationPublisher.groupCreated') })
    } catch (error) {
      setGroupMessage({ type: 'error', text: normalizeErrorMessage(error, lang) })
    } finally {
      setGroupBusy(false)
    }
  }

  const handleDeleteGroup = async (groupId: string) => {
    setDeletingGroupId(groupId)
    setGroupMessage(null)
    try {
      await onDeleteGroup(groupId)
      setGroupIds((current) => {
        const next = new Set(current)
        next.delete(groupId)
        return next
      })
      setGroupMessage({ type: 'success', text: tx('notificationPublisher.groupDeleted') })
    } catch (error) {
      setGroupMessage({ type: 'error', text: normalizeErrorMessage(error, lang) })
    } finally {
      setDeletingGroupId(null)
    }
  }

  const handleCsvChange = async (files: File[]) => {
    if (files.length === 0) return
    setCsvFileName(files.length === 1
      ? files[0].name
      : format(tx('notificationPublisher.csvFilesSelected'), { count: files.length }))
    setCsvPreview(null)
    setGroupMessage(null)
    try {
      const parsed = await Promise.all(files.map(async (file) => ({
        file,
        preview: buildCsvPreview(await file.text(), recipientOptions),
      })))
      const validPreviews = parsed
        .map((item) => item.preview)
        .filter((preview): preview is CsvPreview => Boolean(preview?.groups.length))
      const invalidFileCount = parsed.length - validPreviews.length
      if (validPreviews.length === 0) {
        setGroupMessage({ type: 'error', text: tx('notificationPublisher.csvNoGroups') })
        return
      }

      const groupsByName = new Map<string, CsvPreviewGroup>()
      let skippedRows = 0
      validPreviews.forEach((preview) => {
        skippedRows += preview.skippedRows
        preview.groups.forEach((group) => {
          const key = group.name.trim().toLocaleLowerCase()
          const existing = groupsByName.get(key)
          groupsByName.set(key, existing
            ? { ...existing, memberIds: Array.from(new Set([...existing.memberIds, ...group.memberIds])) }
            : { ...group, memberIds: [...group.memberIds] })
        })
      })
      const groups = Array.from(groupsByName.values())
      const preview: CsvPreview = {
        groups,
        matchedMembers: groups.reduce((total, group) => total + group.memberIds.length, 0),
        skippedRows,
      }
      setCsvPreview(preview)
      const warnings: string[] = []
      if (invalidFileCount > 0) {
        warnings.push(format(tx('notificationPublisher.csvInvalidFiles'), { count: invalidFileCount }))
      }
      if (skippedRows > 0) {
        warnings.push(format(tx('notificationPublisher.csvUnknown'), { count: skippedRows }))
      }
      setGroupMessage(warnings.length > 0 ? { type: 'error', text: warnings.join(' ') } : null)
    } catch (error) {
      setGroupMessage({ type: 'error', text: normalizeErrorMessage(error, lang) })
    }
  }

  const handleDownloadTemplate = () => {
    const sampleEmail = recipientOptions[0]?.description || 'student@example.com'
    const secondEmail = recipientOptions[1]?.description || 'teacher@example.com'
    const csv = [
      ['group_name', 'member_email'],
      [tx('notificationPublisher.templateGroupOne'), sampleEmail],
      [tx('notificationPublisher.templateGroupTwo'), secondEmail],
    ].map((row) => row.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = tx('notificationPublisher.csvTemplateFilename')
    link.click()
    URL.revokeObjectURL(href)
  }

  const handleImportCsvGroups = async () => {
    if (!csvPreview?.groups.length) return
    setCsvBusy(true)
    setGroupMessage(null)
    try {
      for (const group of csvPreview.groups) {
        await onCreateGroup(group.name, group.memberIds)
      }
      setGroupMessage({
        type: 'success',
        text: format(tx('notificationPublisher.importedGroups'), { count: csvPreview.groups.length }),
      })
      setCsvPreview(null)
      setCsvFileName('')
    } catch (error) {
      setGroupMessage({ type: 'error', text: normalizeErrorMessage(error, lang) })
    } finally {
      setCsvBusy(false)
    }
  }

  const renderTargetRows = () => (
    <div className="notification-publisher-target-stack">
      {audienceOptions.length > 0 ? (
        <div className="notification-publisher-target-section">
          <span className="notification-publisher-section-label">{tx('notificationPublisher.audiences')}</span>
          <div className="notification-publisher-action-list" aria-label={tx('notificationPublisher.audiences')}>
            {audienceOptions.map((audience) => (
              <button
                key={audience.id}
                type="button"
                className={audienceIds.has(audience.id) ? 'selected' : ''}
                onClick={() => toggleSet(setAudienceIds, audience.id)}
                title={audience.description}
              >
                <span className="notification-publisher-recipient-check" aria-hidden="true">
                  {audienceIds.has(audience.id) ? <Check size={11} /> : null}
                </span>
                <span>
                  <strong>{audience.label}</strong>
                  {audience.description ? <em>{audience.description}</em> : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="notification-publisher-target-section">
        <span className="notification-publisher-section-label">{tx('notificationPublisher.groups')}</span>
        <div className="notification-publisher-action-list" aria-label={tx('notificationPublisher.groups')}>
          {groupOptions.length === 0 ? (
            <div className="notification-publisher-empty-row">
              <Users size={15} aria-hidden="true" />
              <span>{tx('notificationPublisher.noGroups')}</span>
            </div>
          ) : groupOptions.map((group) => (
            <button
              key={group.id}
              type="button"
              className={groupIds.has(group.id) ? 'selected' : ''}
              onClick={() => toggleSet(setGroupIds, group.id)}
            >
              <span className="notification-publisher-recipient-check" aria-hidden="true">
                {groupIds.has(group.id) ? <Check size={11} /> : null}
              </span>
              <span>
                <strong>{group.name}</strong>
                <em>{format(tx('notificationPublisher.groupMemberCount'), { count: group.memberIds.length })}</em>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="notification-publisher-target-section">
        <span className="notification-publisher-section-label">{tx('notificationPublisher.people')}</span>
        <label className="notification-publisher-search">
          <Search size={13} aria-hidden="true" />
          <input
            value={recipientQuery}
            onChange={(event) => setRecipientQuery(event.target.value)}
            placeholder={tx('notificationPublisher.searchRecipients')}
          />
        </label>
        <div className="notification-publisher-recipient-list">
          {filteredRecipients.length === 0 ? (
            <div className="notification-publisher-empty-row">
              <Users size={15} aria-hidden="true" />
              <span>{tx('notificationPublisher.noRecipients')}</span>
            </div>
          ) : filteredRecipients.map((recipient) => (
            <label key={recipient.id} className="notification-publisher-recipient">
              <input
                type="checkbox"
                checked={recipientIds.has(recipient.id)}
                onChange={() => toggleSet(setRecipientIds, recipient.id)}
              />
              <span className="notification-publisher-recipient-check" aria-hidden="true">
                {recipientIds.has(recipient.id) ? <Check size={11} /> : null}
              </span>
              <span>
                <strong>{recipient.label}</strong>
                {recipient.description ? <em>{recipient.description}</em> : null}
              </span>
              {recipient.badge ? <small>{recipient.badge}</small> : null}
            </label>
          ))}
        </div>
      </div>
    </div>
  )

  const renderGroupDialog = () => (
    <div
      className={`dialog-layer notification-publisher-layer${groupClose.exiting ? ' exiting' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget && !groupBusy && !csvBusy) groupClose.requestClose()
      }}
    >
      <div
        ref={groupDialogRef}
        className="notification-dialog notification-group-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={groupTitleId}
        aria-describedby={groupDescId}
      >
        <div className="notification-dialog-head">
          <div>
            <span className="eyebrow">{tx('notificationPublisher.groupDialogEyebrow')}</span>
            <h3 id={groupTitleId}>{tx('notificationPublisher.groupDialogTitle')}</h3>
            <p id={groupDescId}>{tx('notificationPublisher.groupDialogDesc')}</p>
          </div>
          <button
            type="button"
            className="notification-dialog-close"
            onClick={() => groupClose.requestClose()}
            disabled={groupBusy || csvBusy}
            aria-label={tx('notificationPublisher.closeDialog')}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="notification-group-dialog-grid">
          <section className="notification-group-manager-section">
            <div className="notification-publisher-section-head">
              <div>
                <strong>{tx('notificationPublisher.savedGroupsTitle')}</strong>
                <span>{format(tx('notificationPublisher.groupCount'), { count: groupOptions.length })}</span>
              </div>
            </div>
            {groupOptions.length > 0 ? (
              <div className="notification-publisher-group-management-list" aria-label={tx('notificationPublisher.savedGroups')}>
                {groupOptions.map((group) => (
                  <div key={group.id} className="notification-publisher-group-management-row">
                    <span>
                      <strong>{group.name}</strong>
                      <em>{format(tx('notificationPublisher.groupMemberCount'), { count: group.memberIds.length })}</em>
                    </span>
                    <button
                      type="button"
                      className="notification-publisher-delete-group"
                      onClick={() => void handleDeleteGroup(group.id)}
                      disabled={deletingGroupId === group.id}
                      aria-label={format(tx('notificationPublisher.deleteGroup'), { name: group.name })}
                      title={format(tx('notificationPublisher.deleteGroup'), { name: group.name })}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="notification-publisher-empty-state">
                <Users size={18} aria-hidden="true" />
                <strong>{tx('notificationPublisher.noSavedGroupsTitle')}</strong>
                <p>{tx('notificationPublisher.noSavedGroupsDesc')}</p>
              </div>
            )}
          </section>

          <section className="notification-group-manager-section">
            <div className="notification-publisher-section-head">
              <div>
                <strong>{tx('notificationPublisher.manualGroupTitle')}</strong>
                <span>{tx('notificationPublisher.groupBuilderHint')}</span>
              </div>
            </div>
            <label className="team-field">
              <span>{tx('notificationPublisher.groupName')}</span>
              <input
                ref={groupNameInputRef}
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder={tx('notificationPublisher.groupNamePlaceholder')}
                maxLength={80}
              />
            </label>
            <label className="notification-publisher-search">
              <Search size={13} aria-hidden="true" />
              <input
                value={groupRecipientQuery}
                onChange={(event) => setGroupRecipientQuery(event.target.value)}
                placeholder={tx('notificationPublisher.searchRecipients')}
              />
            </label>
            <div className="notification-publisher-recipient-list compact">
              {filteredGroupRecipients.length === 0 ? (
                <div className="notification-publisher-empty-row">
                  <Users size={15} aria-hidden="true" />
                  <span>{tx('notificationPublisher.noRecipients')}</span>
                </div>
              ) : filteredGroupRecipients.map((recipient) => (
                <label key={recipient.id} className="notification-publisher-recipient">
                  <input
                    type="checkbox"
                    checked={groupMemberIds.has(recipient.id)}
                    onChange={() => toggleSet(setGroupMemberIds, recipient.id)}
                  />
                  <span className="notification-publisher-recipient-check" aria-hidden="true">
                    {groupMemberIds.has(recipient.id) ? <Check size={11} /> : null}
                  </span>
                  <span>
                    <strong>{recipient.label}</strong>
                    {recipient.description ? <em>{recipient.description}</em> : null}
                  </span>
                  {recipient.badge ? <small>{recipient.badge}</small> : null}
                </label>
              ))}
            </div>
            <button
              type="button"
              className="quiet-action notification-publisher-create-group"
              onClick={() => void handleCreateGroup()}
              disabled={!canCreateGroup}
            >
              <Users size={13} aria-hidden="true" />
              {groupBusy ? tx('working') : format(tx('notificationPublisher.createGroup'), { count: groupMemberIds.size })}
            </button>
          </section>

          <section className="notification-group-manager-section">
            <div className="notification-publisher-section-head">
              <div>
                <strong>{tx('notificationPublisher.csvImportTitle')}</strong>
                <span>{tx('notificationPublisher.csvHint')}</span>
              </div>
            </div>
            <div className="notification-publisher-csv-actions">
              <button type="button" className="quiet-action compact-action" onClick={handleDownloadTemplate}>
                <Download size={13} aria-hidden="true" />
                {tx('notificationPublisher.downloadTemplate')}
              </button>
            </div>
            <FileDropzone
              className="notification-publisher-csv-dropzone"
              compact
              title={tx('notificationPublisher.chooseCsv')}
              hint={tx('notificationPublisher.csvHint')}
              allowedTypes={['.csv', 'text/csv']}
              maxFileSize={MAX_CSV_IMPORT_FILE_SIZE}
              maxFiles={MAX_UPLOAD_FILES_PER_BATCH}
              onFiles={handleCsvChange}
            />
            <div className="notification-publisher-csv-preview">
              {csvPreview ? (
                <>
                  <span>
                    <UploadCloud size={15} aria-hidden="true" />
                    <strong>{csvFileName || tx('notificationPublisher.csvFile')}</strong>
                  </span>
                  <p>{format(tx('notificationPublisher.csvReady'), {
                    groups: csvPreview.groups.length,
                    members: csvPreview.matchedMembers,
                  })}</p>
                  <div className="notification-publisher-csv-group-list">
                    {csvPreview.groups.slice(0, 4).map((group) => (
                      <em key={group.name}>{format(tx('notificationPublisher.csvGroupPreview'), {
                        name: group.name,
                        count: group.memberIds.length,
                      })}</em>
                    ))}
                    {csvPreview.groups.length > 4 ? (
                      <em>{format(tx('notificationPublisher.csvMoreGroups'), { count: csvPreview.groups.length - 4 })}</em>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="primary-action compact-action"
                    onClick={() => void handleImportCsvGroups()}
                    disabled={!canImportGroups}
                  >
                    <UploadCloud size={13} aria-hidden="true" />
                    {csvBusy ? tx('working') : format(tx('notificationPublisher.importGroups'), { count: csvPreview.groups.length })}
                  </button>
                </>
              ) : (
                <p>{tx('notificationPublisher.csvEmptyPreview')}</p>
              )}
            </div>
          </section>
        </div>

        <div className="notification-dialog-footer">
          {groupMessage ? <p className={`notification-publisher-message ${groupMessage.type}`}>{groupMessage.text}</p> : <span />}
          <button type="button" className="quiet-action compact-action" onClick={() => groupClose.requestClose()} disabled={groupBusy || csvBusy}>
            {tx('done')}
          </button>
        </div>
      </div>
    </div>
  )

  const renderComposeDialog = () => (
    <div
      className={`dialog-layer notification-publisher-layer${composeClose.exiting ? ' exiting' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget && !sending) composeClose.requestClose()
      }}
    >
      <div
        ref={composeDialogRef}
        className="notification-dialog notification-compose-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={composeTitleId}
        aria-describedby={hasDescription ? composeDescId : undefined}
      >
        <div className="notification-dialog-head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h3 id={composeTitleId}>{heading}</h3>
            {hasDescription ? <p id={composeDescId}>{description}</p> : null}
          </div>
          <button
            type="button"
            className="notification-dialog-close"
            onClick={() => composeClose.requestClose()}
            disabled={sending}
            aria-label={tx('notificationPublisher.closeDialog')}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <form className="notification-compose-form" onSubmit={handlePublish}>
          <section className="notification-compose-message">
            <div className="notification-publisher-section-head">
              <div>
                <strong>{tx('notificationPublisher.messageDetails')}</strong>
                <span>{tx('notificationPublisher.messageDetailsHint')}</span>
              </div>
            </div>
            <label className="team-field">
              <span>{tx('notificationPublisher.titleLabel')}</span>
              <input
                ref={titleInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={tx('notificationPublisher.titlePlaceholder')}
                maxLength={160}
              />
            </label>
            <label className="team-field">
              <span>{tx('notificationPublisher.bodyLabel')}</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={tx('notificationPublisher.bodyPlaceholder')}
                rows={8}
                maxLength={2000}
              />
            </label>
            <div className="notification-publisher-section-head compact">
              <div>
                <strong>{tx('notificationPublisher.delivery')}</strong>
                <span>{tx('notificationPublisher.deliveryHint')}</span>
              </div>
            </div>
            <div className="notification-publisher-channels" role="group" aria-label={tx('notificationPublisher.channels')}>
              <button
                type="button"
                className={channels.includes('in_app') ? 'active' : ''}
                onClick={() => toggleChannel('in_app')}
              >
                <Bell size={13} aria-hidden="true" />
                {tx('notificationPublisher.inApp')}
              </button>
              <button
                type="button"
                className={channels.includes('email') ? 'active' : ''}
                onClick={() => toggleChannel('email')}
              >
                <Mail size={13} aria-hidden="true" />
                {tx('notificationPublisher.email')}
              </button>
            </div>
          </section>

          <section className="notification-compose-targets">
            <div className="notification-publisher-section-head">
              <div>
                <strong>{tx('notificationPublisher.recipientPanelTitle')}</strong>
                <span>{format(tx('notificationPublisher.targetCount'), { count: selectedTargetCount })}</span>
              </div>
              {selectedTargetCount > 0 ? (
                <button type="button" className="notification-publisher-clear" onClick={clearTargets}>
                  <X size={12} aria-hidden="true" />
                  {tx('notificationPublisher.clearTargets')}
                </button>
              ) : null}
            </div>
            {renderTargetRows()}
          </section>

          <div className="notification-dialog-footer">
            {message ? <p className={`notification-publisher-message ${message.type}`}>{message.text}</p> : <span />}
            <button type="submit" className="primary-action compact-action" disabled={!canSend}>
              <Send size={13} aria-hidden="true" />
              {sending ? tx('working') : tx('notificationPublisher.send')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <section className={`notification-publisher ${className}`.trim()}>
      <div className="notification-publisher-head">
        <div className="notification-publisher-title">
          <span className="notification-publisher-icon" aria-hidden="true">
            <Megaphone size={16} />
          </span>
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h3>{heading}</h3>
            {hasDescription ? <p>{description}</p> : null}
          </div>
        </div>
        <div className="notification-publisher-head-actions">
          <button type="button" className="quiet-action compact-action" onClick={openGroupDialog}>
            <Settings size={13} aria-hidden="true" />
            {publisherText('manageGroups', '管理分组', 'Manage groups')}
          </button>
          <button type="button" className="primary-action compact-action" onClick={openCompose}>
            <Mail size={13} aria-hidden="true" />
            {publisherText('openComposer', '新建消息', 'New message')}
          </button>
        </div>
      </div>

      <div className="notification-publisher-meta" aria-label={publisherText('launcherMetaLabel', '通知发送摘要', 'Notification publisher summary')}>
        <span>{publisherFormat('launcherRecipients', { count: recipientOptions.length }, '{count} 位收件人', '{count} recipients')}</span>
        <span>{publisherFormat('launcherGroups', { count: groupOptions.length }, '{count} 个分组', '{count} groups')}</span>
        <span>{publisherFormat('launcherAudiences', { count: audienceOptions.length }, '{count} 个群体', '{count} audiences')}</span>
      </div>

      {message && !composeOpen ? <p className={`notification-publisher-message ${message.type}`}>{message.text}</p> : null}
      {composeOpen ? renderInPortal(renderComposeDialog()) : null}
      {groupDialogOpen ? renderInPortal(renderGroupDialog()) : null}
    </section>
  )
}
