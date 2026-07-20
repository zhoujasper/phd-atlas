import { Bot, CheckCircle2, History, LoaderCircle, Paperclip, Play, RotateCcw, ShieldCheck, Square, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiDraftEvent, AiDraftGrants, AiDraftInput, AiKey } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'
import { Select } from './Select'
import { SwitchControl } from './SwitchControl'
import { CollapsiblePanel } from './CollapsiblePanel'
import { InlinePresence } from './InlinePresence'

type DraftAttachment = {
  id: string
  name: string
  mimeType?: string
  file?: File
  fileId?: string
  fileSize?: number
}

type DraftSnapshot = {
  id: string
  subject: string
  body: string
  instruction: string
  kind: 'initial' | 'generated' | 'revision'
}

const initialGrants: AiDraftGrants = {
  userProfile: false,
  dossier: true,
  checklist: false,
  scholarships: false,
  tasks: false,
  correspondence: false,
  attachments: false,
}

const EMPTY_AI_KEYS: AiKey[] = []
const grantKeys = ['userProfile', 'dossier', 'checklist', 'scholarships', 'tasks', 'correspondence'] as const
const MAX_ATTACHMENT_BYTES = 600 * 1024

function supportsAttachment(key: AiKey | undefined, _mimeType: string) {
  // All configured providers accept any draft attachment: images use native
  // multimodal parts; other files are inlined as text/base64 context server-side.
  return Boolean(key)
}

function readAttachment(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('ATTACHMENT_READ_FAILED'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

function parseDraft(value: string) {
  const normalized = value.replace(/^\s*/, '')
  const match = normalized.match(/^subject\s*:\s*([^\n\r]*)(?:\r?\n){1,2}([\s\S]*)$/i)
  if (match) return { subject: match[1].trim(), body: match[2].replace(/^\s+/, ''), hasCompleteHeader: true }
  const partialSubject = normalized.match(/^subject\s*:\s*([^\n\r]*)$/i)
  if (partialSubject) return { subject: partialSubject[1].trim(), body: '', hasCompleteHeader: false }
  return { subject: '', body: normalized, hasCompleteHeader: false }
}

function serializeDraft(draft: { subject: string; body: string }) {
  return draft.subject.trim() ? `Subject: ${draft.subject}\n\n${draft.body}` : draft.body
}

function hasDraftContent(draft: { subject: string; body: string }) {
  return Boolean(draft.subject.trim() || draft.body.trim())
}

function sameDraft(left: { subject: string; body: string }, right: { subject: string; body: string }) {
  return left.subject === right.subject && left.body === right.body
}

export function AiDraftPanel({
  open,
  applicationId,
  aiKeys,
  mode,
  replyToId,
  attachments,
  currentDraft,
  draftSessionKey,
  onClose,
  onDraft,
  onResolveAttachment,
  onDraftChange,
  onGeneratingChange,
  onDraftRestoreChange,
  onNotify,
}: {
  open: boolean
  applicationId: string
  aiKeys: AiKey[] | null | undefined
  mode: 'compose' | 'reply'
  replyToId?: string | null
  attachments: DraftAttachment[]
  currentDraft: { subject: string; body: string }
  draftSessionKey: number
  onClose: () => void
  onDraft: (input: AiDraftInput, onEvent: (event: AiDraftEvent) => void, signal?: AbortSignal) => Promise<void>
  onResolveAttachment?: (fileId: string) => Promise<Blob>
  onDraftChange: (draft: Partial<{ subject: string; body: string }>) => void
  onGeneratingChange?: (generating: boolean) => void
  onDraftRestoreChange?: (restoring: boolean) => void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
}) {
  const { tx, format, lang } = useI18n()
  const [keyId, setKeyId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [grants, setGrants] = useState<AiDraftGrants>(initialGrants)
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set())
  const [output, setOutput] = useState('')
  const [history, setHistory] = useState<DraftSnapshot[]>([])
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'context' | 'drafting' | 'done'>('idle')
  const controllerRef = useRef<AbortController | null>(null)
  const notify = (message: string, tone: 'success' | 'error' | 'info' | 'warning' = 'error') => onNotify?.(message, tone)
  const outputRef = useRef('')
  const historyRef = useRef<DraftSnapshot[]>([])
  const revisionSequenceRef = useRef(0)
  const restoreTimerRef = useRef<number | null>(null)
  const availableKeys = aiKeys ?? EMPTY_AI_KEYS
  const selectedKey = availableKeys.find((key) => key.id === keyId) ?? availableKeys[0]
  const keyOptions = useMemo(() => availableKeys.map((key) => ({
    value: key.id,
    label: `${key.label} · ${key.model}`,
  })), [availableKeys])
  const isGenerating = phase === 'connecting' || phase === 'context' || phase === 'drafting'
  const hasCompletedAiDraft = history.some((revision) => revision.kind !== 'initial')

  const createRevision = (draft: { subject: string; body: string }, kind: DraftSnapshot['kind'], instruction: string): DraftSnapshot => ({
    id: `ai-draft-${++revisionSequenceRef.current}`,
    subject: draft.subject,
    body: draft.body,
    instruction,
    kind,
  })

  useEffect(() => {
    if (!keyId && availableKeys[0]) setKeyId(availableKeys[0].id)
    if (keyId && !availableKeys.some((key) => key.id === keyId)) setKeyId(availableKeys[0]?.id ?? '')
  }, [availableKeys, keyId])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    controllerRef.current?.abort()
    if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current)
    restoreTimerRef.current = null
    onGeneratingChange?.(false)
    onDraftRestoreChange?.(false)
    setInstructions('')
    setOutput('')
    outputRef.current = ''
    setHistory([])
    historyRef.current = []
    setActiveRevisionId(null)
    setPhase('idle')
  }, [applicationId, draftSessionKey, mode, onDraftRestoreChange, onGeneratingChange, replyToId])

  useEffect(() => () => {
    controllerRef.current?.abort()
    if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current)
  }, [])

  const selectableAttachments = attachments.filter((attachment) => attachment.file || (attachment.fileId && onResolveAttachment))
  const attachmentAvailability = selectableAttachments.map((attachment) => {
    const mimeType = attachment.mimeType || attachment.file?.type || 'application/octet-stream'
    const tooLarge = (attachment.file?.size ?? attachment.fileSize ?? 0) > MAX_ATTACHMENT_BYTES
    const supported = supportsAttachment(selectedKey, mimeType)
    return { attachment, mimeType, supported, tooLarge, selectable: supported && !tooLarge }
  })

  const setGrant = (key: keyof AiDraftGrants, checked: boolean) => {
    setGrants((current) => ({ ...current, [key]: checked }))
    if (key === 'attachments' && !checked) setSelectedAttachments(new Set())
  }

  const toggleAttachment = (id: string) => {
    setSelectedAttachments((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const stop = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setPhase('idle')
    onGeneratingChange?.(false)
  }

  const restoreRevision = (revision: DraftSnapshot) => {
    if (isGenerating) return
    if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current)
    setOutput(serializeDraft(revision))
    outputRef.current = serializeDraft(revision)
    setActiveRevisionId(revision.id)
    onDraftChange({ subject: revision.subject, body: revision.body })
    onDraftRestoreChange?.(true)
    restoreTimerRef.current = window.setTimeout(() => {
      onDraftRestoreChange?.(false)
      restoreTimerRef.current = null
    }, 540)
  }

  const generate = async () => {
    if (!selectedKey) {
      notify(tx('dossier.aiNoKey'), 'warning')
      return
    }
    if (!instructions.trim()) {
      notify(tx('dossier.aiInstructionsRequired'), 'warning')
      return
    }
    const draftBeforeGeneration = { subject: currentDraft.subject, body: currentDraft.body }
    const instruction = instructions.trim()
    setOutput('')
    outputRef.current = ''
    setPhase('connecting')
    onGeneratingChange?.(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const selectedFiles = attachmentAvailability.filter(({ attachment, selectable }) => grants.attachments && selectable && selectedAttachments.has(attachment.id))
      const uploadedAttachments = await Promise.all(selectedFiles.map(async ({ attachment, mimeType }) => {
        const source = attachment.file ?? (attachment.fileId ? await onResolveAttachment?.(attachment.fileId) : undefined)
        if (!source) throw new Error(tx('dossier.aiAttachmentReadFailed'))
        if (source.size > MAX_ATTACHMENT_BYTES) throw new Error(format(tx('dossier.aiAttachmentTooLargeNamed'), { name: attachment.name }))
        return {
          name: attachment.name,
          mimeType: attachment.mimeType || source.type || mimeType,
          contentBase64: await readAttachment(source),
        }
      }))
      await onDraft({
        keyId: selectedKey.id,
        applicationId,
        mode,
        instructions: instruction,
        ...(mode === 'reply' && replyToId ? { replyToId } : {}),
        ...(hasDraftContent(draftBeforeGeneration) ? { currentDraft: draftBeforeGeneration } : {}),
        grants,
        attachments: uploadedAttachments,
      }, (event) => {
        if (event.type === 'status') {
          setPhase(event.phase === 'context' ? 'context' : 'drafting')
          return
        }
        if (event.type === 'token') {
          const next = outputRef.current + event.text
          outputRef.current = next
          setOutput(next)
          const streamed = parseDraft(next)
          if (streamed.hasCompleteHeader) onDraftChange({ subject: streamed.subject, body: streamed.body })
          else if (streamed.subject) onDraftChange({ subject: streamed.subject })
          else onDraftChange({ body: streamed.body })
          return
        }
        if (event.type === 'error') {
          notify(normalizeErrorMessage(event.message, lang, tx('dossier.aiGenerationFailed')), 'error')
          setPhase('idle')
          return
        }
        if (event.type === 'done') {
          const parsed = parseDraft(outputRef.current)
          const completedDraft = {
            subject: parsed.subject || draftBeforeGeneration.subject,
            body: parsed.hasCompleteHeader ? parsed.body : parsed.subject ? '' : parsed.body,
          }
          const revision = createRevision(
            completedDraft,
            hasCompletedAiDraft ? 'revision' : 'generated',
            instruction,
          )
          setHistory((current) => {
            const next = [...current]
            const latest = next.at(-1)
            if (hasDraftContent(draftBeforeGeneration) && (!latest || !sameDraft(latest, draftBeforeGeneration))) {
              next.push(createRevision(draftBeforeGeneration, next.length === 0 ? 'initial' : 'revision', ''))
            }
            next.push(revision)
            return next.slice(-10)
          })
          setActiveRevisionId(revision.id)
          setInstructions('')
          setOutput(serializeDraft(completedDraft))
          outputRef.current = serializeDraft(completedDraft)
          onDraftChange(completedDraft)
          setPhase('done')
        }
      }, controller.signal)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const fallback = tx('dossier.aiGenerationFailed')
        if (cause instanceof Error && cause.message === 'ATTACHMENT_READ_FAILED') {
          notify(tx('dossier.aiAttachmentReadFailed'), 'error')
        } else {
          notify(normalizeErrorMessage(cause, lang, fallback), 'error')
        }
      }
    } finally {
      if (!controller.signal.aborted) setPhase((current) => current === 'done' ? 'done' : 'idle')
      onGeneratingChange?.(false)
      controllerRef.current = null
    }
  }

  return (
    <aside className={`ai-draft-panel ${open ? 'open' : ''}`} aria-label={tx('dossier.aiTitle')} aria-hidden={!open}>
      <div className="ai-draft-head">
        <div>
          <span className="eyebrow">{tx('dossier.aiEyebrow')}</span>
          <h3><Sparkles size={15} aria-hidden="true" /> {mode === 'reply' ? tx('dossier.aiReplyTitle') : tx('dossier.aiTitle')}</h3>
        </div>
        <button type="button" className="composer-close-btn" onClick={onClose} aria-label={tx('dossier.aiClose')} title={tx('dossier.aiClose')} disabled={isGenerating}><X size={14} aria-hidden="true" /></button>
      </div>

      {availableKeys.length === 0 ? (
        <div className="ai-draft-empty">
          <span className="empty-state-icon" aria-hidden="true"><Bot size={19} /></span>
          <strong>{tx('dossier.aiNoKey')}</strong>
          <p>{tx('dossier.aiNoKeyHint')}</p>
        </div>
      ) : (
        <>
          <label className="ai-draft-field">
            <span>{tx('dossier.aiKey')}</span>
            <Select size="small" value={selectedKey?.id ?? ''} options={keyOptions} onChange={setKeyId} ariaLabel={tx('dossier.aiKey')} disabled={isGenerating} />
          </label>
          <label className="ai-draft-field ai-draft-request">
            <span>{hasCompletedAiDraft ? tx('dossier.aiContinueRequest') : tx('dossier.aiRequest')}</span>
            <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={hasCompletedAiDraft ? tx('dossier.aiContinuePlaceholder') : mode === 'reply' ? tx('dossier.aiReplyPlaceholder') : tx('dossier.aiRequestPlaceholder')} rows={hasCompletedAiDraft ? 3 : 4} disabled={isGenerating} />
          </label>

          <CollapsiblePanel open={history.length > 0} keepMounted className="ai-draft-history-collapse">
            <section className="ai-draft-history" aria-label={tx('dossier.aiHistoryTitle')}>
              <div className="ai-draft-history-head">
                <span><History size={13} aria-hidden="true" /> {tx('dossier.aiHistoryTitle')}</span>
                <em>{history.length}</em>
              </div>
              <div className="ai-draft-history-list">
                {history.map((revision, index) => (
                  <button
                    key={revision.id}
                    type="button"
                    className={`ai-draft-history-item ${activeRevisionId === revision.id ? 'active' : ''}`}
                    onClick={() => restoreRevision(revision)}
                    disabled={isGenerating}
                    aria-pressed={activeRevisionId === revision.id}
                    title={tx('dossier.aiRestoreVersion')}
                  >
                    <span className="ai-draft-history-copy">
                      <strong>{revision.kind === 'initial' ? tx('dossier.aiHistoryOriginal') : format(tx('dossier.aiHistoryVersion'), { count: index + 1 })}</strong>
                      <small>{revision.instruction || tx('dossier.aiHistoryOriginalHint')}</small>
                    </span>
                    {activeRevisionId === revision.id ? <em>{tx('dossier.aiHistoryCurrent')}</em> : <RotateCcw size={13} aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <p>{tx('dossier.aiHistoryHint')}</p>
            </section>
          </CollapsiblePanel>

          <div className="ai-draft-consent">
            <div className="ai-draft-consent-head"><span>{tx('dossier.aiContextTitle')}</span><small>{tx('dossier.aiContextHint')}</small></div>
            <div className="ai-draft-grant-list">
              {grantKeys.map((key) => (
                <div key={key} className="ai-draft-grant">
                  <span><strong>{tx(`dossier.aiGrants.${key}`)}</strong><small>{tx(`dossier.aiGrantHints.${key}`)}</small></span>
                  <SwitchControl checked={grants[key]} label={tx(`dossier.aiGrants.${key}`)} onChange={(checked) => setGrant(key, checked)} disabled={isGenerating} />
                </div>
              ))}
            </div>
          </div>

          <div className="ai-draft-attachments">
            <div className="ai-draft-grant">
              <span><strong>{tx('dossier.aiGrants.attachments')}</strong><small>{tx('dossier.aiGrantHints.attachments')}</small></span>
              <SwitchControl checked={grants.attachments} label={tx('dossier.aiGrants.attachments')} onChange={(checked) => setGrant('attachments', checked)} disabled={isGenerating || selectableAttachments.length === 0} />
            </div>
            <CollapsiblePanel open={grants.attachments && selectableAttachments.length > 0} keepMounted className="ai-draft-attachment-collapse">
              <div className="ai-draft-attachment-list">
                {attachmentAvailability.map(({ attachment, supported, tooLarge, selectable }) => (
                  <label key={attachment.id} className={`ai-draft-attachment ${selectable ? '' : 'disabled'}`}>
                    <input type="checkbox" checked={selectedAttachments.has(attachment.id)} onChange={() => toggleAttachment(attachment.id)} disabled={!selectable || isGenerating} />
                    <Paperclip size={12} aria-hidden="true" />
                    <span>{attachment.name}</span>
                    {!supported ? <em>{tx('dossier.aiAttachmentUnsupported')}</em> : tooLarge ? <em>{tx('dossier.aiAttachmentTooLarge')}</em> : null}
                  </label>
                ))}
              </div>
            </CollapsiblePanel>
            <CollapsiblePanel open={grants.attachments && Boolean(selectedKey)} keepMounted className="ai-draft-attachment-note-collapse">
              <p className="ai-draft-attachment-note">
                <Paperclip size={12} aria-hidden="true" /> {tx('dossier.aiAnyAttachmentHint')}
              </p>
            </CollapsiblePanel>
          </div>

          <CollapsiblePanel open={Boolean(isGenerating || output)} keepMounted className="ai-draft-progress-collapse">
            <div className={`ai-draft-progress ${isGenerating ? 'working' : 'complete'}`} aria-live="polite">
              <span className="ai-draft-progress-icon" aria-hidden="true">{isGenerating ? <LoaderCircle className="ai-spin" size={14} /> : <CheckCircle2 size={14} />}</span>
              <span>{isGenerating ? (phase === 'context' ? tx('dossier.aiReadingContext') : tx('dossier.aiDrafting')) : tx('dossier.aiDraftReady')}</span>
              {isGenerating ? <i aria-hidden="true"><i /><i /><i /></i> : null}
            </div>
          </CollapsiblePanel>
          <div className="ai-draft-actions">
            <InlinePresence present={isGenerating}>
              <button type="button" className="quiet-action" onClick={stop}><Square size={12} aria-hidden="true" /> {tx('dossier.aiStop')}</button>
            </InlinePresence>
            <InlinePresence present={!isGenerating}>
              <button type="button" className="primary-action" onClick={() => void generate()}><Play size={13} aria-hidden="true" /> {hasCompletedAiDraft ? tx('dossier.aiContinueEditing') : mode === 'reply' ? tx('dossier.aiWriteReply') : tx('dossier.aiGenerate')}</button>
            </InlinePresence>
          </div>
          <p className="ai-draft-safety"><ShieldCheck size={12} aria-hidden="true" /> {tx('dossier.aiDraftOnly')}</p>
        </>
      )}
    </aside>
  )
}
