import '../../styles/ai.css'
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  History,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Square,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  AiDraftAttachmentSelection,
  AiDraftEvent,
  AiDraftGrants,
  AiDraftInput,
  AiKey,
  ProfileAsset,
} from '../../api/phdApi'
import { ApiError } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { profileKindLabel } from '../../profileAssets'
import { useI18n } from '../hooks/useI18n'
import { Select } from './Select'
import { SwitchControl } from './SwitchControl'
import { CollapsiblePanel } from './CollapsiblePanel'
import { InlinePresence } from './InlinePresence'
import { InfoTooltip } from './InfoTooltip'

type ProfileRowMotionStyle = CSSProperties & { '--ai-profile-index': number }

type DraftSnapshot = {
  id: string
  subject: string
  body: string
  instruction: string
  kind: 'initial' | 'generated' | 'revision'
}

type DraftValue = {
  subject: string
  body: string
}

type GenerationSession = {
  controller: AbortController
  draft: DraftValue
  pendingDrafts: string[]
  settled: boolean
}

/** Streamed stage of one draft request, mirrored into the composer's own status line. */
export type AiDraftPhase = 'idle' | 'connecting' | 'context' | 'attaching' | 'drafting' | 'done'

// The three sources every fresh draft starts with. More sensitive application
// sources remain opt-in, even when enabled for an earlier draft.
const initialGrants: AiDraftGrants = {
  userProfile: true,
  dossier: true,
  checklist: false,
  scholarships: false,
  tasks: false,
  correspondence: true,
}

const EMPTY_AI_KEYS: AiKey[] = []
const EMPTY_PROFILE_ASSETS: ProfileAsset[] = []
const grantKeys = ['userProfile', 'dossier', 'checklist', 'scholarships', 'tasks', 'correspondence'] as const

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

function draftSignature(draft: DraftValue) {
  return JSON.stringify([draft.subject, draft.body])
}

export function AiDraftPanel({
  open,
  applicationId,
  aiKeys,
  profileAssets: profileAssetsProp,
  mode,
  replyToId,
  currentDraft,
  draftSessionKey,
  onClose,
  onDraft,
  onDraftChange,
  onAttachmentPlanChange,
  onGeneratingChange,
  onPhaseChange,
  onDraftRestoreChange,
  onNotify,
}: {
  open: boolean
  applicationId: string
  aiKeys: AiKey[] | null | undefined
  /** Offered for narrowing the profile grant; empty keeps it an all-or-nothing switch. */
  profileAssets?: ProfileAsset[]
  mode: 'compose' | 'reply'
  replyToId?: string | null
  currentDraft: { subject: string; body: string }
  draftSessionKey: number
  onClose: () => void
  onDraft: (input: AiDraftInput, onEvent: (event: AiDraftEvent) => void, signal?: AbortSignal) => Promise<void>
  onDraftChange: (draft: Partial<{ subject: string; body: string }>) => void
  onAttachmentPlanChange?: (attachments: AiDraftAttachmentSelection[]) => void
  onGeneratingChange?: (generating: boolean) => void
  /** Streams the current stage so the composer can narrate it inline. */
  onPhaseChange?: (phase: AiDraftPhase) => void
  onDraftRestoreChange?: (restoring: boolean) => void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
}) {
  const { tx, format, lang } = useI18n()
  const [keyId, setKeyId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [grants, setGrants] = useState<AiDraftGrants>(initialGrants)
  const [output, setOutput] = useState('')
  const [history, setHistory] = useState<DraftSnapshot[]>([])
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<AiDraftPhase>('idle')
  const [profilePickerOpen, setProfilePickerOpen] = useState(false)
  const [profileQuery, setProfileQuery] = useState('')
  // Empty means "the whole profile" — the same thing the switch alone has
  // always granted — so a fresh session never silently narrows what it sends.
  const [selectedProfileAssetIds, setSelectedProfileAssetIds] = useState<Set<string>>(() => new Set())
  const profilePickerId = useId()
  const panelRef = useRef<HTMLElement | null>(null)
  const activeGenerationRef = useRef<GenerationSession | null>(null)
  const outputRef = useRef('')
  const revisionSequenceRef = useRef(0)
  const restoreTimerRef = useRef<number | null>(null)
  const wasOpenRef = useRef(false)
  const receivedAttachmentPlanRef = useRef(false)
  const onDraftChangeRef = useRef(onDraftChange)
  const onAttachmentPlanChangeRef = useRef(onAttachmentPlanChange)
  const onGeneratingChangeRef = useRef(onGeneratingChange)
  const onDraftRestoreChangeRef = useRef(onDraftRestoreChange)
  const onPhaseChangeRef = useRef(onPhaseChange)
  onDraftChangeRef.current = onDraftChange
  onAttachmentPlanChangeRef.current = onAttachmentPlanChange
  onGeneratingChangeRef.current = onGeneratingChange
  onPhaseChangeRef.current = onPhaseChange
  onDraftRestoreChangeRef.current = onDraftRestoreChange
  const notify = (message: string, tone: 'success' | 'error' | 'info' | 'warning' = 'error') => onNotify?.(message, tone)
  const availableKeys = useMemo(
    () => (aiKeys ?? EMPTY_AI_KEYS).filter((key) => key.enabled !== false),
    [aiKeys],
  )
  const currentDraftSubject = currentDraft.subject
  const currentDraftBody = currentDraft.body
  const selectedKey = availableKeys.find((key) => key.id === keyId) ?? availableKeys[0]
  const keyOptions = useMemo(() => availableKeys.map((key) => ({
    value: key.id,
    label: `${key.label} · ${key.model}`,
  })), [availableKeys])
  const isGenerating = phase === 'connecting' || phase === 'context' || phase === 'attaching' || phase === 'drafting'
  const hasCompletedAiDraft = history.some((revision) => revision.kind !== 'initial')
  const profileAssets = profileAssetsProp ?? EMPTY_PROFILE_ASSETS
  const visibleProfileAssets = useMemo(() => {
    const needle = profileQuery.trim().toLowerCase()
    if (!needle) return profileAssets
    return profileAssets.filter((asset) => (
      `${asset.name} ${asset.kind} ${asset.customLabelEn ?? ''} ${asset.customLabelZh ?? ''} ${asset.description ?? ''}`
        .toLowerCase()
        .includes(needle)
    ))
  }, [profileAssets, profileQuery])
  const visibleProfileAssetIds = useMemo(
    () => visibleProfileAssets.map((asset) => asset.id),
    [visibleProfileAssets],
  )
  const profileScopeSummary = selectedProfileAssetIds.size === 0
    ? format(tx('dossier.aiProfileAllMaterials'), { count: profileAssets.length })
    : format(tx('dossier.aiProfileSelectedMaterials'), { count: selectedProfileAssetIds.size })

  const toggleProfileAsset = (assetId: string) => {
    setSelectedProfileAssetIds((current) => {
      const next = new Set(current)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  const createRevision = (draft: { subject: string; body: string }, kind: DraftSnapshot['kind'], instruction: string): DraftSnapshot => ({
    id: `ai-draft-${++revisionSequenceRef.current}`,
    subject: draft.subject,
    body: draft.body,
    instruction,
    kind,
  })

  const releaseGeneration = useCallback((session: GenerationSession, nextPhase: 'idle' | 'done', abort = false) => {
    if (activeGenerationRef.current !== session || session.settled) return false
    session.settled = true
    activeGenerationRef.current = null
    if (abort && !session.controller.signal.aborted) session.controller.abort()
    setPhase(nextPhase)
    onGeneratingChangeRef.current?.(false)
    return true
  }, [])

  useEffect(() => {
    if (!keyId && availableKeys[0]) setKeyId(availableKeys[0].id)
    if (keyId && !availableKeys.some((key) => key.id === keyId)) setKeyId(availableKeys[0]?.id ?? '')
  }, [availableKeys, keyId])

  // The composer narrates the same stage next to the fields being written, so
  // the reader never has to look at the side panel to know what is happening.
  useEffect(() => {
    onPhaseChangeRef.current?.(phase)
  }, [phase])

  useEffect(() => {
    const activeGeneration = activeGenerationRef.current
    if (activeGeneration) releaseGeneration(activeGeneration, 'idle', true)
    else onGeneratingChangeRef.current?.(false)
    if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current)
    restoreTimerRef.current = null
    onDraftRestoreChangeRef.current?.(false)
    setInstructions('')
    setGrants(initialGrants)
    setOutput('')
    outputRef.current = ''
    setHistory([])
    setActiveRevisionId(null)
    setPhase('idle')
    setProfilePickerOpen(false)
    setProfileQuery('')
    setSelectedProfileAssetIds(new Set())
    receivedAttachmentPlanRef.current = false
  }, [applicationId, draftSessionKey, mode, releaseGeneration, replyToId])

  // A material deleted elsewhere must not keep narrowing the grant to an id
  // that no longer resolves — that would quietly send nothing at all.
  useEffect(() => {
    setSelectedProfileAssetIds((current) => {
      if (current.size === 0) return current
      const live = new Set(profileAssets.map((asset) => asset.id))
      const next = new Set([...current].filter((id) => live.has(id)))
      return next.size === current.size ? current : next
    })
  }, [profileAssets])

  // Opening the inspector starts a fresh consent session. Closing it leaves
  // the editable email and any already chosen outgoing attachments untouched.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setGrants(initialGrants)
      setProfilePickerOpen(false)
      setProfileQuery('')
      setSelectedProfileAssetIds(new Set())
      // The panel is portaled into a scrolling inspector slot that keeps its
      // offset between openings. Reopening onto a retained offset showed the
      // consent switches with the title, key picker and instructions scrolled
      // off the top. Always open at the top of the panel.
      panelRef.current?.parentElement?.scrollTo?.({ top: 0 })
    }
    wasOpenRef.current = open
  }, [open])

  useEffect(() => () => {
    const activeGeneration = activeGenerationRef.current
    if (activeGeneration) {
      activeGeneration.settled = true
      activeGenerationRef.current = null
      activeGeneration.controller.abort()
      onGeneratingChangeRef.current?.(false)
    }
    if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current)
  }, [])

  useEffect(() => {
    const activeGeneration = activeGenerationRef.current
    if (!activeGeneration || activeGeneration.settled) return
    const signature = draftSignature({ subject: currentDraftSubject, body: currentDraftBody })
    const ownedIndex = activeGeneration.pendingDrafts.lastIndexOf(signature)
    if (ownedIndex >= 0) {
      activeGeneration.pendingDrafts.splice(0, ownedIndex + 1)
      return
    }

    // A draft change that was not emitted by this stream is owned by the user
    // (or another resident editor). Revoke the stream before it can paint over it.
    releaseGeneration(activeGeneration, 'idle', true)
  }, [currentDraftBody, currentDraftSubject, releaseGeneration])

  const setGrant = (key: keyof AiDraftGrants, checked: boolean) => {
    setGrants((current) => ({ ...current, [key]: checked }))
  }

  const stop = () => {
    const activeGeneration = activeGenerationRef.current
    if (activeGeneration) releaseGeneration(activeGeneration, 'idle', true)
  }

  const restoreRevision = (revision: DraftSnapshot) => {
    if (isGenerating) return
    if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current)
    setOutput(serializeDraft(revision))
    outputRef.current = serializeDraft(revision)
    setActiveRevisionId(revision.id)
    onDraftChangeRef.current({ subject: revision.subject, body: revision.body })
    onDraftRestoreChangeRef.current?.(true)
    restoreTimerRef.current = window.setTimeout(() => {
      onDraftRestoreChangeRef.current?.(false)
      restoreTimerRef.current = null
    }, 540)
  }

  const generate = async () => {
    if (activeGenerationRef.current) return
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
    receivedAttachmentPlanRef.current = false
    const controller = new AbortController()
    const session: GenerationSession = {
      controller,
      draft: draftBeforeGeneration,
      pendingDrafts: [draftSignature(draftBeforeGeneration)],
      settled: false,
    }
    activeGenerationRef.current = session
    onGeneratingChangeRef.current?.(true)
    const acceptsEvent = () => activeGenerationRef.current === session && !session.settled && !controller.signal.aborted
    const publishDraft = (change: Partial<DraftValue>) => {
      if (!acceptsEvent()) return
      const nextDraft = { ...session.draft, ...change }
      session.draft = nextDraft
      const signature = draftSignature(nextDraft)
      if (session.pendingDrafts.at(-1) !== signature) session.pendingDrafts.push(signature)
      onDraftChangeRef.current(change)
    }
    try {
      await onDraft({
        keyId: selectedKey.id,
        applicationId,
        mode,
        instructions: instruction,
        ...(mode === 'reply' && replyToId ? { replyToId } : {}),
        ...(hasDraftContent(draftBeforeGeneration) ? { currentDraft: draftBeforeGeneration } : {}),
        grants: grants.userProfile && selectedProfileAssetIds.size > 0
          ? { ...grants, profileAssetIds: [...selectedProfileAssetIds] }
          : grants,
      }, (event) => {
        if (!acceptsEvent()) return
        if (event.type === 'status') {
          if (event.phase === 'context') setPhase('context')
          else if (event.phase === 'attaching') setPhase('attaching')
          else setPhase('drafting')
          return
        }
        if (event.type === 'attachment-selection') {
          receivedAttachmentPlanRef.current = true
          onAttachmentPlanChangeRef.current?.(event.attachments)
          setPhase('attaching')
          return
        }
        if (event.type === 'token') {
          const next = outputRef.current + event.text
          outputRef.current = next
          setOutput(next)
          const streamed = parseDraft(next)
          if (streamed.hasCompleteHeader) {
            publishDraft({ ...(streamed.subject ? { subject: streamed.subject } : {}), body: streamed.body })
          } else if (streamed.subject) publishDraft({ subject: streamed.subject })
          else publishDraft({ body: streamed.body })
          return
        }
        if (event.type === 'error') {
          notify(normalizeErrorMessage(
            new ApiError(event.message, event.code ?? 'AI_DRAFT_FAILED', 422),
            lang,
            tx('dossier.aiGenerationFailed'),
          ), 'error')
          releaseGeneration(session, 'idle', true)
          return
        }
        if (event.type === 'done') {
          if (!receivedAttachmentPlanRef.current) onAttachmentPlanChangeRef.current?.([])
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
          publishDraft(completedDraft)
          releaseGeneration(session, 'done')
        }
      }, controller.signal)
    } catch (cause) {
      if (acceptsEvent()) {
        const fallback = tx('dossier.aiGenerationFailed')
        notify(normalizeErrorMessage(cause, lang, fallback), 'error')
        releaseGeneration(session, 'idle')
      }
    } finally {
      // A replaced request is not allowed to clear the controller, phase, or
      // generating flag of the newer resident session.
      if (activeGenerationRef.current === session && !session.settled) releaseGeneration(session, 'idle')
    }
  }

  const phaseLabel = phase === 'context'
    ? tx('dossier.aiReadingContext')
    : phase === 'attaching'
      ? tx('dossier.aiSelectingAttachments')
      : tx('dossier.aiDrafting')

  return (
    <aside ref={panelRef} className={`ai-draft-panel ${open ? 'open' : ''}`} aria-label={tx('dossier.aiTitle')} aria-hidden={!open}>
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
            <textarea aria-required="true" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={hasCompletedAiDraft ? tx('dossier.aiContinuePlaceholder') : mode === 'reply' ? tx('dossier.aiReplyPlaceholder') : tx('dossier.aiRequestPlaceholder')} rows={hasCompletedAiDraft ? 3 : 4} disabled={isGenerating} />
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
            <div className="ai-draft-consent-head">
              <span>
                {tx('dossier.aiContextTitle')}
                <InfoTooltip content={tx('dossier.aiContextHint')} className="ai-draft-info" />
              </span>
            </div>
            <div className="ai-draft-grant-list">
              {grantKeys.map((key) => (
                <div key={key} className={`ai-draft-grant${key === 'userProfile' ? ' has-detail' : ''}`}>
                  <div className="ai-draft-grant-row">
                    <div className="ai-draft-grant-copy">
                      <span className="ai-draft-grant-title">
                        <strong>{tx(`dossier.aiGrants.${key}`)}</strong>
                        <InfoTooltip content={tx(`dossier.aiGrantHints.${key}`)} className="ai-draft-info" />
                      </span>
                      {key === 'userProfile' && grants.userProfile ? (
                        <span className="ai-draft-grant-summary">{profileScopeSummary}</span>
                      ) : null}
                    </div>
                    {key === 'userProfile' && grants.userProfile && profileAssets.length > 0 ? (
                      <button
                        type="button"
                        className={`ai-draft-grant-expand${profilePickerOpen ? ' open' : ''}`}
                        aria-expanded={profilePickerOpen}
                        aria-controls={profilePickerId}
                        aria-label={tx('dossier.aiProfileChoose')}
                        disabled={isGenerating}
                        onClick={() => setProfilePickerOpen((open) => !open)}
                      >
                        <ChevronDown size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                    <SwitchControl checked={grants[key]} label={tx(`dossier.aiGrants.${key}`)} onChange={(checked) => setGrant(key, checked)} disabled={isGenerating} />
                  </div>
                  {key === 'userProfile' && profileAssets.length > 0 ? (
                    <CollapsiblePanel
                      id={profilePickerId}
                      open={profilePickerOpen && grants.userProfile}
                      className="ai-draft-profile-collapse"
                      openMs={300}
                      closeMs={230}
                    >
                      <div className="ai-draft-profile-picker">
                        <div className="ai-draft-profile-search">
                          <Search size={13} aria-hidden="true" />
                          <input
                            type="search"
                            value={profileQuery}
                            disabled={isGenerating}
                            onChange={(event) => setProfileQuery(event.target.value)}
                            placeholder={tx('dossier.aiProfileSearchPlaceholder')}
                            aria-label={tx('dossier.aiProfileSearchPlaceholder')}
                          />
                          <InlinePresence present={profileQuery.length > 0}>
                            <button
                              type="button"
                              className="ai-draft-profile-search-clear"
                              onClick={() => setProfileQuery('')}
                              aria-label={tx('datePicker.clear')}
                            >
                              <X size={11} aria-hidden="true" />
                            </button>
                          </InlinePresence>
                        </div>
                        <div className="ai-draft-profile-toolbar">
                          <span>{profileScopeSummary}</span>
                          <button
                            type="button"
                            className="ai-draft-profile-select-all"
                            disabled={isGenerating}
                            onClick={() => setSelectedProfileAssetIds(
                              selectedProfileAssetIds.size === 0 ? new Set(visibleProfileAssetIds) : new Set(),
                            )}
                          >
                            {selectedProfileAssetIds.size === 0
                              ? tx('dossier.aiProfileSelectVisible')
                              : tx('dossier.aiProfileUseAll')}
                          </button>
                        </div>
                        {visibleProfileAssets.length === 0 ? (
                          <p className="ai-draft-profile-empty">{tx('dossier.aiProfileNoMatch')}</p>
                        ) : (
                          <ul className="ai-draft-profile-list">
                            {visibleProfileAssets.map((asset, index) => {
                              const checked = selectedProfileAssetIds.has(asset.id)
                              return (
                                <li
                                  key={asset.id}
                                  style={{ '--ai-profile-index': Math.min(index, 12) } as ProfileRowMotionStyle}
                                >
                                  <label className={`ai-draft-profile-option${checked ? ' checked' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={isGenerating}
                                      onChange={() => toggleProfileAsset(asset.id)}
                                    />
                                    <span className="ai-draft-profile-check" aria-hidden="true"><Check size={10} /></span>
                                    <span className="ai-draft-profile-copy">
                                      <strong>{asset.name}</strong>
                                      <small>{profileKindLabel(asset.kind, lang, {
                                        zh: asset.customLabelZh,
                                        en: asset.customLabelEn,
                                      })}</small>
                                    </span>
                                  </label>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </CollapsiblePanel>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <CollapsiblePanel open={Boolean(isGenerating || output)} keepMounted className="ai-draft-progress-collapse">
            <div className={`ai-draft-progress ${isGenerating ? 'working' : 'complete'}`} aria-live="polite">
              <span className="ai-draft-progress-icon" aria-hidden="true">{isGenerating ? <LoaderCircle className="ai-spin" size={14} /> : <CheckCircle2 size={14} />}</span>
              <span>{isGenerating ? phaseLabel : tx('dossier.aiDraftReady')}</span>
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
