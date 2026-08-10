import '../../styles/discover.css'
import {
  Compass,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { phdApi, readSessionTokenSubject, type AiKey, type DiscoverResearchScope } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import { normalizeErrorMessage } from '../../errorMessages'
import type {
  DiscoverCatalogMeta,
  DiscoverCatalogPayload,
  DiscoverIntake,
  DiscoverRankerWeights,
  DiscoverResearchPayload,
  DiscoverResearchStartPayload,
  DiscoverUserState,
  RequirementFilterState,
  ScoredDiscoverPi,
  ScoredDiscoverProgram,
} from '../../data/discover'
import {
  DEFAULT_RANKER,
  DEFAULT_REQUIREMENT_FILTERS,
  programMatchesRequirementFilters,
} from '../../data/discover'
import { useI18n } from '../hooks/useI18n'
import { useVisibilityAwarePolling } from '../hooks/useVisibilityAwarePolling'
import {
  DiscoverResearchSheet,
  type DiscoverResearchSubmissionPhase,
} from '../shared/DiscoverResearchSheet'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import {
  DiscoverWorkspace,
  type DiscoverProgramSort,
  type DiscoverSortDirection,
  type DiscoverWorkspaceMode,
} from '../shared/DiscoverWorkspace'
import {
  loadRecoverableDiscoverDraft,
  opaqueDiscoverDraftUserId,
  saveRecoverableDiscoverDraft,
} from './discoverDraftStorage'
import {
  normalizeDiscoverQuery,
  piMatchesDiscoverQuery,
  programMatchesDiscoverQuery,
} from './discoverSearch'

function toggleInList(list: string[], id: string) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
}

function deadlineValue(program: ScoredDiscoverProgram) {
  const dated = program.requirements?.deadlines?.filter((deadline) => deadline.date).map((deadline) => deadline.date as string).sort()
  return dated?.[0] || program.deadlineIso || '9999-12-31'
}

function collectedValue(program: ScoredDiscoverProgram) {
  return program.collectedAt || program.verification?.checkedAt || ''
}

function weightedScore(program: ScoredDiscoverProgram, weights: DiscoverRankerWeights) {
  if (!program.matchDimensions) return program.matchScore
  const total = Math.max(1, weights.fit + weights.stipend + weights.city + weights.advisorDensity + weights.topics)
  return (
    program.matchDimensions.fit * weights.fit
    + program.matchDimensions.stipend * weights.stipend
    + program.matchDimensions.city * weights.city
    + program.matchDimensions.advisorDensity * weights.advisorDensity
    + program.matchDimensions.topics * weights.topics
  ) / total
}

function uniqueSeeds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 50)
}

export function DiscoverScreen({
  token,
  applications,
  onImported,
  onNotify,
  deferProgressiveReveal = false,
  teamScope,
  teamTargetOptions = [],
  onTeamTargetChange,
  onExitTeamTarget,
  onConfigureAiKeys,
  realtimeConnected = false,
  realtimeRevision = 0,
}: {
  token: string
  applications: ApplicationRecord[]
  onImported: (application: ApplicationRecord) => void
  onNotify: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  deferProgressiveReveal?: boolean
  teamScope?: DiscoverResearchScope
  teamTargetOptions?: Array<{ id: string; name: string; email?: string; avatarUrl?: string | null; count?: number }>
  onTeamTargetChange?: (userId: string) => void
  onExitTeamTarget?: () => void
  onConfigureAiKeys: () => void
  realtimeConnected?: boolean
  realtimeRevision?: number
}) {
  const { tx, lang } = useI18n()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [researching, setResearching] = useState(false)
  const [researchSubmissionPhase, setResearchSubmissionPhase] = useState<DiscoverResearchSubmissionPhase>('idle')
  const [researchSubmissionError, setResearchSubmissionError] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [pendingDeleteProgramIds, setPendingDeleteProgramIds] = useState<string[] | null>(null)
  const [deletingProgramIds, setDeletingProgramIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<DiscoverCatalogMeta | null>(null)
  const [state, setState] = useState<DiscoverUserState | null>(null)
  const stateRef = useRef<DiscoverUserState | null>(null)
  const [programs, setPrograms] = useState<ScoredDiscoverProgram[]>([])
  const [pis, setPis] = useState<ScoredDiscoverPi[]>([])
  const [aiKeys, setAiKeys] = useState<AiKey[]>([])
  const activeTeamTarget = useMemo(() => {
    if (!teamScope?.targetUserId) return null
    return teamTargetOptions.find((student) => student.id === teamScope.targetUserId) ?? {
      id: teamScope.targetUserId,
      name: tx('team.memberFallback', 'Student'),
      count: applications.length,
    }
  }, [applications.length, teamScope?.targetUserId, teamTargetOptions, tx])
  const teamContext = useMemo(() => (
    activeTeamTarget && onExitTeamTarget
      ? { ...activeTeamTarget, onBack: onExitTeamTarget }
      : undefined
  ), [activeTeamTarget, onExitTeamTarget])
  const personalApplicationOwnerId = useMemo(() => (
    teamScope ? null : applications.find((application) => application.ownerId)?.ownerId ?? null
  ), [applications, teamScope])
  const discoverDraftUserId = readSessionTokenSubject(token)
    || personalApplicationOwnerId
    || opaqueDiscoverDraftUserId(token)
  const discoverDraftApplicationScope = teamScope
    ? `team-applications:${teamScope.teamId}:${teamScope.targetUserId}`
    : `personal-applications:${discoverDraftUserId}`
  const discoverDraftScope = useMemo(() => ({
    userId: discoverDraftUserId,
    applicationIds: [discoverDraftApplicationScope],
    teamId: teamScope?.teamId ?? null,
    targetUserId: teamScope?.targetUserId ?? null,
  }), [discoverDraftApplicationScope, discoverDraftUserId, teamScope?.targetUserId, teamScope?.teamId])

  const [mode, setMode] = useState<DiscoverWorkspaceMode>('programs')
  const [modeDirection, setModeDirection] = useState<'forward' | 'backward'>('forward')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [regionFilters, setRegionFilters] = useState<string[]>([])
  const [minStipend, setMinStipend] = useState(0)
  const [minMatch, setMinMatch] = useState(0)
  const [watchedOnly, setWatchedOnly] = useState(false)
  const [meetFloorOnly, setMeetFloorOnly] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [hedgeFilter, setHedgeFilter] = useState<'all' | 'multi' | 'single'>('all')
  const [piCategory, setPiCategory] = useState('all')
  const [minHIndex, setMinHIndex] = useState(0)
  const [reqFilters, setReqFilters] = useState<RequirementFilterState>({ ...DEFAULT_REQUIREMENT_FILTERS })
  const [rankerDraft, setRankerDraft] = useState<DiscoverRankerWeights>({ ...DEFAULT_RANKER })
  const [programSort, setProgramSort] = useState<DiscoverProgramSort>('collectedAt')
  const [sortDirection, setSortDirection] = useState<DiscoverSortDirection>('desc')

  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null)
  const [selectedPiId, setSelectedPiId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [programNoteDrafts, setProgramNoteDrafts] = useState<Record<string, string>>({})
  const [piNoteDrafts, setPiNoteDrafts] = useState<Record<string, string>>({})

  const [filterRailCollapsed, setFilterRailCollapsed] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [researchSheetOpen, setResearchSheetOpen] = useState(false)

  const [intakeDraft, setIntakeDraft] = useState<DiscoverIntake | null>(null)
  const [useApplicationSeeds, setUseApplicationSeeds] = useState(false)
  const [selectedKeyIds, setSelectedKeyIds] = useState<string[]>([])
  const programNoteDraftsRef = useRef(programNoteDrafts)
  const piNoteDraftsRef = useRef(piNoteDrafts)
  const intakeDraftRef = useRef(intakeDraft)
  const rankerDraftRef = useRef(rankerDraft)
  const dirtyProgramNoteIdsRef = useRef(new Set<string>())
  const dirtyPiNoteIdsRef = useRef(new Set<string>())
  const intakeDraftDirtyRef = useRef(false)
  const rankerDraftDirtyRef = useRef(false)
  const recoveryWarningShownRef = useRef(false)

  programNoteDraftsRef.current = programNoteDrafts
  piNoteDraftsRef.current = piNoteDrafts
  intakeDraftRef.current = intakeDraft
  rankerDraftRef.current = rankerDraft
  const usableAiKeys = useMemo(() => aiKeys.filter((key) => key.secretSet && key.enabled !== false), [aiKeys])

  const persistRecoverableDraft = useCallback(() => {
    const saved = saveRecoverableDiscoverDraft(discoverDraftScope, {
      intake: intakeDraftDirtyRef.current ? intakeDraftRef.current : null,
      ranker: rankerDraftDirtyRef.current ? rankerDraftRef.current : null,
      programNotes: programNoteDraftsRef.current,
      piNotes: piNoteDraftsRef.current,
      dirtyProgramNoteIds: [...dirtyProgramNoteIdsRef.current],
      dirtyPiNoteIds: [...dirtyPiNoteIdsRef.current],
    })
    if (!saved && !recoveryWarningShownRef.current) {
      recoveryWarningShownRef.current = true
      onNotify(tx(
        'localRecoveryUnavailable',
        'Local draft recovery is unavailable. This page will not reload automatically; save or discard your changes before leaving.',
      ), 'warning')
    } else if (saved) {
      recoveryWarningShownRef.current = false
    }
    return saved
  }, [discoverDraftScope, onNotify, tx])

  const hasResidentDraft = useCallback(() => (
    intakeDraftDirtyRef.current
    || rankerDraftDirtyRef.current
    || dirtyProgramNoteIdsRef.current.size > 0
    || dirtyPiNoteIdsRef.current.size > 0
  ), [])

  const applyPayload = useCallback((payload: DiscoverCatalogPayload | DiscoverResearchPayload | DiscoverResearchStartPayload) => {
    if ('meta' in payload) setMeta(payload.meta)
    stateRef.current = payload.state
    setState(payload.state)
    setPrograms(payload.programs)
    setPis(payload.pis)
    setRankerDraft((current) => rankerDraftDirtyRef.current ? current : payload.state.ranker)
    setIntakeDraft((current) => intakeDraftDirtyRef.current ? current : payload.state.intake)
    setProgramNoteDrafts((current) => {
      if (!dirtyProgramNoteIdsRef.current.size) return payload.state.programNotes
      const next = { ...payload.state.programNotes }
      dirtyProgramNoteIdsRef.current.forEach((id) => {
        if (Object.hasOwn(current, id)) next[id] = current[id]
      })
      programNoteDraftsRef.current = next
      return next
    })
    setPiNoteDrafts((current) => {
      if (!dirtyPiNoteIdsRef.current.size) return payload.state.piNotes
      const next = { ...payload.state.piNotes }
      dirtyPiNoteIdsRef.current.forEach((id) => {
        if (Object.hasOwn(current, id)) next[id] = current[id]
      })
      piNoteDraftsRef.current = next
      return next
    })
    const preferredKeyIds = payload.state.preferredAiKeyIds?.length
      ? payload.state.preferredAiKeyIds
      : (payload.state.preferredAiKeyId ? [payload.state.preferredAiKeyId] : [])
    if (preferredKeyIds.length) setSelectedKeyIds(preferredKeyIds)
  }, [])

  useEffect(() => {
    const recovered = loadRecoverableDiscoverDraft(discoverDraftScope)
    const nextProgramNotes = recovered?.programNotes ?? {}
    const nextPiNotes = recovered?.piNotes ?? {}
    const nextIntake = recovered?.intake ?? null
    const nextRanker = recovered?.ranker ?? { ...DEFAULT_RANKER }
    dirtyProgramNoteIdsRef.current = new Set(recovered?.dirtyProgramNoteIds ?? [])
    dirtyPiNoteIdsRef.current = new Set(recovered?.dirtyPiNoteIds ?? [])
    intakeDraftDirtyRef.current = Boolean(recovered?.intake)
    rankerDraftDirtyRef.current = Boolean(recovered?.ranker)
    programNoteDraftsRef.current = nextProgramNotes
    piNoteDraftsRef.current = nextPiNotes
    intakeDraftRef.current = nextIntake
    rankerDraftRef.current = nextRanker
    setProgramNoteDrafts(nextProgramNotes)
    setPiNoteDrafts(nextPiNotes)
    setIntakeDraft(nextIntake)
    setRankerDraft(nextRanker)
  }, [discoverDraftScope])

  useEffect(() => {
    persistRecoverableDraft()
  }, [intakeDraft, persistRecoverableDraft, piNoteDrafts, programNoteDrafts, rankerDraft])

  useEffect(() => {
    const flush = () => { persistRecoverableDraft() }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      persistRecoverableDraft()
      if (!hasResidentDraft()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      flush()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [hasResidentDraft, persistRecoverableDraft])

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const [payload, keys] = await Promise.all([
        phdApi.getDiscoverCatalog(token, teamScope, { signal }),
        phdApi.listAiKeys(token, { signal }).catch((error) => {
          if (signal?.aborted) throw error
          return [] as AiKey[]
        }),
      ])
      if (signal?.aborted) return
      applyPayload(payload)
      const scopedKeys = teamScope
        ? keys.filter((key) => key.scope === 'team' && key.teamId === teamScope.teamId)
        : keys
      setAiKeys(scopedKeys)
      const preferred = payload.state.preferredAiKeyIds?.length
        ? payload.state.preferredAiKeyIds
        : (payload.state.preferredAiKeyId ? [payload.state.preferredAiKeyId] : [])
      const usableKeys = scopedKeys.filter((key) => key.secretSet && key.enabled !== false)
      const selected = preferred.filter((id) => usableKeys.some((key) => key.id === id))
      if (selected.length) {
        setSelectedKeyIds(selected)
      } else if (usableKeys[0]) {
        setSelectedKeyIds([usableKeys[0].id])
      } else {
        setSelectedKeyIds([])
      }
    } catch (reason) {
      if (!signal?.aborted) {
        setError(normalizeErrorMessage(reason, lang, tx('discover.loadError')))
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [applyPayload, lang, teamScope, token, tx])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const announcedResearchJobRef = useRef<string | null>(null)
  const researchJobId = state?.researchJob?.id
  const researchJobStatus = state?.researchJob?.status
  const refreshResearchState = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await phdApi.getDiscoverCatalog(token, teamScope, { signal })
      if (signal?.aborted) return
      applyPayload(payload)
      const nextJob = payload.state.researchJob
      if (!nextJob) return
      const marker = `${nextJob.id}:${nextJob.status}`
      if (nextJob.status === 'completed' && announcedResearchJobRef.current !== marker) {
        announcedResearchJobRef.current = marker
        onNotify(tx('discover.researchCompletedToast', 'Research is complete. Your Discover results were refreshed.'), 'success')
      } else if (nextJob.status === 'failed' && announcedResearchJobRef.current !== marker) {
        announcedResearchJobRef.current = marker
        onNotify(tx('discover.researchFailedToast', 'Research did not finish. Your previous results were kept.'), 'error')
      }
    } catch {
      // Realtime refresh is an optimization. A transient failure must not turn
      // a healthy server-side job into a client-visible failure.
    }
  }, [applyPayload, onNotify, teamScope, token, tx])

  useEffect(() => {
    if (realtimeRevision <= 0) return
    void refreshResearchState()
  }, [realtimeRevision, refreshResearchState])

  useVisibilityAwarePolling({
    enabled: Boolean(
      !realtimeConnected
      && researchJobId
      && researchJobStatus
      && ['queued', 'running'].includes(researchJobStatus)
    ),
    initialDelayMs: 8_000,
    intervalMs: 60_000,
    restartKey: `${researchJobId ?? ''}:${researchJobStatus ?? ''}`,
    poll: refreshResearchState,
  })

  const saveState = useCallback(async (
    patch: Partial<DiscoverUserState>,
    toast = false,
    beforeApply?: () => void,
  ) => {
    setSaving(true)
    try {
      const payload = await phdApi.updateDiscoverState(token, patch, teamScope)
      beforeApply?.()
      persistRecoverableDraft()
      applyPayload(payload)
      if (toast) onNotify(tx('discover.submittedToast'), 'success')
    } catch (reason) {
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
    } finally {
      setSaving(false)
    }
  }, [applyPayload, lang, onNotify, persistRecoverableDraft, teamScope, token, tx])

  const toggleLocalListState = useCallback((
    key: 'watchedProgramIds' | 'hiddenProgramIds' | 'hiddenPiIds',
    id: string,
    applyEntityState: (enabled: boolean) => void,
  ) => {
    const current = stateRef.current
    if (!current) return
    const wasEnabled = current[key].includes(id)
    const enabled = !wasEnabled
    const nextIds = toggleInList(current[key], id)
    const nextState = { ...current, [key]: nextIds }

    stateRef.current = nextState
    setState(nextState)
    applyEntityState(enabled)

    void phdApi.updateDiscoverState(token, { [key]: nextIds }, teamScope).catch((reason) => {
      const latest = stateRef.current
      if (latest && latest[key].includes(id) === enabled) {
        const rollbackIds = toggleInList(latest[key], id)
        const rollbackState = { ...latest, [key]: rollbackIds }
        stateRef.current = rollbackState
        setState(rollbackState)
        applyEntityState(wasEnabled)
      }
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
    })
  }, [lang, onNotify, teamScope, token, tx])

  const enableLocalListStateMany = useCallback((
    key: 'watchedProgramIds' | 'hiddenProgramIds',
    ids: string[],
    applyEntityState: (states: Record<string, boolean>) => void,
  ) => {
    const current = stateRef.current
    const targetIds = [...new Set(ids)].filter(Boolean)
    if (!current || targetIds.length === 0) return
    const previousIds = current[key]
    const previousSet = new Set(previousIds)
    const nextIds = [...new Set([...previousIds, ...targetIds])]
    if (nextIds.length === previousIds.length) return

    const nextState = { ...current, [key]: nextIds }
    stateRef.current = nextState
    setState(nextState)
    applyEntityState(Object.fromEntries(targetIds.map((id) => [id, true])))

    void phdApi.updateDiscoverState(token, { [key]: nextIds }, teamScope).catch((reason) => {
      const latest = stateRef.current
      const requestStillCurrent = latest
        && latest[key].length === nextIds.length
        && latest[key].every((id) => nextIds.includes(id))
      if (latest && requestStillCurrent) {
        const rollbackState = { ...latest, [key]: previousIds }
        stateRef.current = rollbackState
        setState(rollbackState)
        applyEntityState(Object.fromEntries(targetIds.map((id) => [id, previousSet.has(id)])))
      }
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
    })
  }, [lang, onNotify, teamScope, token, tx])

  const toggleProgramWatch = useCallback((id: string) => {
    toggleLocalListState('watchedProgramIds', id, (watched) => {
      setPrograms((current) => current.map((program) => program.id === id ? { ...program, watched } : program))
    })
  }, [toggleLocalListState])

  const toggleProgramHidden = useCallback((id: string) => {
    toggleLocalListState('hiddenProgramIds', id, (hidden) => {
      setPrograms((current) => current.map((program) => program.id === id ? { ...program, hidden } : program))
    })
  }, [toggleLocalListState])

  const watchPrograms = useCallback((ids: string[]) => {
    enableLocalListStateMany('watchedProgramIds', ids, (states) => {
      setPrograms((current) => current.map((program) => (
        states[program.id] === undefined ? program : { ...program, watched: states[program.id] }
      )))
    })
  }, [enableLocalListStateMany])

  const hidePrograms = useCallback((ids: string[]) => {
    enableLocalListStateMany('hiddenProgramIds', ids, (states) => {
      setPrograms((current) => current.map((program) => (
        states[program.id] === undefined ? program : { ...program, hidden: states[program.id] }
      )))
    })
  }, [enableLocalListStateMany])

  const togglePiHidden = useCallback((id: string) => {
    toggleLocalListState('hiddenPiIds', id, (hidden) => {
      setPis((current) => current.map((pi) => pi.id === id ? { ...pi, hidden } : pi))
    })
  }, [toggleLocalListState])

  const runResearch = useCallback(async () => {
    if (!intakeDraft) return
    const validKeyIds = selectedKeyIds.filter((id) => usableAiKeys.some((key) => key.id === id))
    const [primaryKeyId, ...verifierKeyIds] = validKeyIds
    if (!primaryKeyId) {
      setResearchSheetOpen(true)
      setResearchSubmissionPhase('idle')
      onNotify(tx('discover.selectAiKeyRequired', 'Select at least one AI research model.'), 'warning')
      return
    }
    const researchKeyIds: [string, ...string[]] = [primaryKeyId, ...verifierKeyIds]
    setResearchSubmissionError(null)
    setResearchSubmissionPhase('saving')
    setResearching(true)
    setProgramSort('collectedAt')
    setSortDirection('desc')
    try {
      const applicationSeeds = useApplicationSeeds
        ? applications.map((application) => `${application.school.name} — ${application.program}`)
        : []
      const nextIntake: DiscoverIntake = {
        ...intakeDraft,
        seedPrograms: uniqueSeeds([...(intakeDraft.seedPrograms || []), ...applicationSeeds]),
      }
      await phdApi.updateDiscoverState(token, {
        intake: nextIntake,
        intakeCompleted: true,
        ranker: rankerDraft,
        interestPicks: state?.interestPicks,
        preferredAiKeyId: primaryKeyId,
        preferredAiKeyIds: researchKeyIds,
      }, teamScope)
      setResearchSubmissionPhase('validating')
      const payload = await phdApi.runDiscoverResearch(token, {
        notify: true,
        useAi: true,
        keyId: primaryKeyId,
        keyIds: researchKeyIds,
        ...(teamScope || {}),
        acceptSuggestions: true,
      })
      if (intakeDraftRef.current === intakeDraft) intakeDraftDirtyRef.current = false
      if (rankerDraftRef.current === rankerDraft) rankerDraftDirtyRef.current = false
      persistRecoverableDraft()
      applyPayload(payload)
      setResearchSubmissionPhase('queued')
      onNotify(tx('discover.researchQueuedToast', 'Research is running in the background. We will refresh this page and notify you when it finishes.'), 'info')
    } catch (reason) {
      const message = normalizeErrorMessage(reason, lang, tx('discover.loadError'))
      setResearchSubmissionPhase('idle')
      setResearchSubmissionError(message)
      onNotify(message, 'error')
    } finally {
      setResearching(false)
    }
  }, [applications, applyPayload, intakeDraft, lang, onNotify, persistRecoverableDraft, rankerDraft, selectedKeyIds, state?.interestPicks, teamScope, token, tx, usableAiKeys, useApplicationSeeds])

  const configureAiKeys = useCallback(async () => {
    if (!intakeDraft) {
      onConfigureAiKeys()
      return
    }

    // The AI-key handoff is a real navigation boundary. Save the complete
    // research form first so a user never loses the direction they just set.
    setResearchSubmissionError(null)
    setResearchSubmissionPhase('saving')
    try {
      const preferredAiKeyIds = selectedKeyIds.filter((id) => usableAiKeys.some((key) => key.id === id))
      const payload = await phdApi.updateDiscoverState(token, {
        intake: intakeDraft,
        intakeCompleted: Boolean(intakeDraft.field.trim() && intakeDraft.regions.length),
        ranker: rankerDraft,
        interestPicks: state?.interestPicks,
        preferredAiKeyId: preferredAiKeyIds[0] ?? null,
        preferredAiKeyIds,
      }, teamScope)
      if (intakeDraftRef.current === intakeDraft) intakeDraftDirtyRef.current = false
      if (rankerDraftRef.current === rankerDraft) rankerDraftDirtyRef.current = false
      persistRecoverableDraft()
      applyPayload(payload)
      setResearchSubmissionPhase('idle')
      onNotify(tx('discover.submittedToast', 'Discover preferences submitted'), 'success')
      onConfigureAiKeys()
    } catch (reason) {
      const message = normalizeErrorMessage(reason, lang, tx('discover.loadError'))
      setResearchSubmissionError(message)
      setResearchSubmissionPhase('idle')
      onNotify(message, 'error')
    }
  }, [applyPayload, intakeDraft, lang, onConfigureAiKeys, onNotify, persistRecoverableDraft, rankerDraft, selectedKeyIds, state?.interestPicks, teamScope, token, tx, usableAiKeys])

  const deletePrograms = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter(Boolean)
    if (!uniqueIds.length) return
    setDeletingProgramIds(uniqueIds)
    try {
      const payload = await phdApi.deleteDiscoverPrograms(token, {
        ids: uniqueIds,
        ...(teamScope || {}),
      })
      applyPayload(payload)
      setCompareIds((current) => current.filter((id) => !uniqueIds.includes(id)))
      setSelectedProgramId((current) => current && uniqueIds.includes(current) ? null : current)
      onNotify(
        tx('discover.programsDeletedToast', 'Deleted {count} program results.')
          .replace('{count}', String(uniqueIds.length)),
        'success',
      )
    } catch (reason) {
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
      throw reason
    } finally {
      setDeletingProgramIds([])
    }
  }, [applyPayload, lang, onNotify, teamScope, token, tx])

  const importProgram = useCallback(async (programId: string, piId?: string | null) => {
    if (teamScope) {
      onNotify(tx('discover.teamImportUnavailable', 'Team Discover keeps research separate; create the student application from the team workspace.'), 'info')
      return
    }
    const key = piId ? `${programId}:${piId}` : programId
    setImportingId(key)
    try {
      const result = await phdApi.importDiscoverProgram(token, { programId, piId: piId || null, includeNotes: true })
      onImported(result.application)
      const importWarnings = result.warnings ?? []
      onNotify(
        importWarnings.length
          ? tx('discover.partialImportToast', 'Added available details. Official sources or the current deadline are still missing; verify them in the application.')
          : tx('discover.importedToast'),
        importWarnings.length ? 'warning' : 'success',
      )
    } catch (reason) {
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
    } finally {
      setImportingId(null)
    }
  }, [lang, onImported, onNotify, teamScope, token, tx])

  const scoreByProgramId = useMemo(() => Object.fromEntries(programs.map((program) => [program.id, weightedScore(program, rankerDraft)])), [programs, rankerDraft])

  const filteredPrograms = useMemo(() => {
    const normalizedQuery = normalizeDiscoverQuery(deferredQuery)
    const direction = sortDirection === 'asc' ? 1 : -1
    const visible = programs.filter((program) => {
      if (!showHidden && program.hidden) return false
      if (watchedOnly && !program.watched) return false
      if (meetFloorOnly && !program.meetsFloor) return false
      if (regionFilters.length && !regionFilters.includes(program.region)) return false
      if (minStipend && (program.stipendUSD == null || program.stipendUSD < minStipend)) return false
      if (minMatch && (scoreByProgramId[program.id] ?? program.matchScore) < minMatch) return false
      if (hedgeFilter !== 'all' && program.multiApply !== hedgeFilter) return false
      if (!programMatchesRequirementFilters(program.requirements, program.multiApply, reqFilters)) return false
      return programMatchesDiscoverQuery(program, normalizedQuery)
    })
    return visible.sort((left, right) => {
      if (programSort === 'program') return direction * `${left.school} ${left.program}`.localeCompare(`${right.school} ${right.program}`)
      if (programSort === 'location') return direction * `${left.country} ${left.city}`.localeCompare(`${right.country} ${right.city}`)
      if (programSort === 'funding') return direction * ((left.stipendUSD ?? -1) - (right.stipendUSD ?? -1))
      if (programSort === 'deadline') return direction * deadlineValue(left).localeCompare(deadlineValue(right))
      if (programSort === 'advisors') return direction * ((left.fittingPiCount ?? left.pis.length) - (right.fittingPiCount ?? right.pis.length))
      if (programSort === 'collectedAt') return direction * collectedValue(left).localeCompare(collectedValue(right))
      return direction * ((scoreByProgramId[left.id] ?? left.matchScore) - (scoreByProgramId[right.id] ?? right.matchScore))
    })
  }, [deferredQuery, hedgeFilter, meetFloorOnly, minMatch, minStipend, programSort, programs, regionFilters, reqFilters, scoreByProgramId, showHidden, sortDirection, watchedOnly])

  const filteredPis = useMemo(() => {
    const normalizedQuery = normalizeDiscoverQuery(deferredQuery)
    return pis.filter((pi) => {
      if (!showHidden && pi.hidden) return false
      if (regionFilters.length && !regionFilters.includes(pi.region)) return false
      if (piCategory !== 'all' && pi.category !== piCategory) return false
      if (minHIndex && (pi.hIndex == null || pi.hIndex < minHIndex)) return false
      return piMatchesDiscoverQuery(pi, normalizedQuery)
    }).sort((left, right) => right.matchScore - left.matchScore)
  }, [deferredQuery, minHIndex, piCategory, pis, regionFilters, showHidden])

  const selectedProgram = useMemo(() => {
    const selected = programs.find((program) => program.id === selectedProgramId)
    return selected || filteredPrograms[0] || null
  }, [filteredPrograms, programs, selectedProgramId])
  const selectedPi = useMemo(() => pis.find((pi) => pi.id === selectedPiId) || filteredPis[0] || null, [filteredPis, pis, selectedPiId])
  const comparePrograms = useMemo(() => compareIds.map((id) => programs.find((program) => program.id === id)).filter((program): program is ScoredDiscoverProgram => Boolean(program)), [compareIds, programs])
  useEffect(() => {
    const availableIds = new Set(programs.map((program) => program.id))
    setCompareIds((current) => {
      const next = current.filter((id) => availableIds.has(id))
      return next.length === current.length ? current : next
    })
    setSelectedProgramId((current) => current && availableIds.has(current) ? current : null)
  }, [programs])

  const activeFilterCount = useMemo(() => {
    const requirementCount = Object.entries(reqFilters).filter(([key, value]) => key === 'deadlineWithinDays' ? Number(value) > 0 : Boolean(value)).length
    return regionFilters.length
      + Number(minStipend > 0)
      + Number(minMatch > 0)
      + Number(watchedOnly)
      + Number(meetFloorOnly)
      + Number(showHidden)
      + Number(hedgeFilter !== 'all')
      + Number(piCategory !== 'all')
      + Number(minHIndex > 0)
      + requirementCount
  }, [hedgeFilter, meetFloorOnly, minHIndex, minMatch, minStipend, piCategory, regionFilters.length, reqFilters, showHidden, watchedOnly])

  const clearFilters = useCallback(() => {
    setRegionFilters([])
    setMinStipend(0)
    setMinMatch(0)
    setWatchedOnly(false)
    setMeetFloorOnly(false)
    setShowHidden(false)
    setHedgeFilter('all')
    setPiCategory('all')
    setMinHIndex(0)
    setReqFilters({ ...DEFAULT_REQUIREMENT_FILTERS })
  }, [])

  const setWorkspaceMode = useCallback((nextMode: DiscoverWorkspaceMode) => {
    setMode((currentMode) => {
      if (currentMode === nextMode) return currentMode
      const order: DiscoverWorkspaceMode[] = ['programs', 'pis', 'compare']
      setModeDirection(order.indexOf(nextMode) >= order.indexOf(currentMode) ? 'forward' : 'backward')
      return nextMode
    })
    setMobileInspectorOpen(false)
  }, [])

  const openFilters = useCallback(() => {
    if (window.matchMedia('(max-width: 980px)').matches) setMobileFiltersOpen((value) => !value)
    else setFilterRailCollapsed((value) => !value)
  }, [])
  const closeMobileFilters = useCallback(() => setMobileFiltersOpen(false), [])

  const selectProgram = useCallback((id: string) => {
    setSelectedProgramId(id)
    setInspectorOpen(true)
    if (window.matchMedia('(max-width: 820px)').matches) setMobileInspectorOpen(true)
  }, [])

  const selectPi = useCallback((id: string) => {
    setSelectedPiId(id)
    setWorkspaceMode('pis')
    setInspectorOpen(true)
    if (window.matchMedia('(max-width: 820px)').matches) setMobileInspectorOpen(true)
  }, [setWorkspaceMode])

  const closeInspector = useCallback(() => {
    setMobileInspectorOpen(false)
    if (!window.matchMedia('(max-width: 820px)').matches) setInspectorOpen(false)
  }, [])

  if (loading) {
    return <div className={clsx('discover-screen', deferProgressiveReveal && 'is-deferred')}><div className="discover-loading"><Loader2 size={18} className="spin-icon" /><span>{tx('discover.loadingCatalog', 'Loading Discover…')}</span></div></div>
  }
  if (error || !state || !intakeDraft) {
    return (
      <div className="discover-screen"><div className="discover-empty"><Compass size={22} /><h3>{tx('discover.loadError')}</h3><p>{error}</p><button type="button" className="primary-action" onClick={() => void load()}><RefreshCw size={14} />{tx('discover.retry')}</button></div></div>
    )
  }

  const filters = { regionFilters, minStipend, minMatch, watchedOnly, meetFloorOnly, showHidden, hedgeFilter, piCategory, minHIndex, requirements: reqFilters }
  const actions = {
    setMode: setWorkspaceMode,
    setQuery,
    toggleFilterRail: () => setFilterRailCollapsed((value) => !value),
    openMobileFilters: openFilters,
    closeMobileFilters,
    openResearch: () => setResearchSheetOpen(true),
    selectProgram,
    selectPi,
    openInspector: () => setInspectorOpen(true),
    closeInspector,
    toggleCompare: (id: string) => setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= 4) { onNotify(tx('discover.compareLimit', 'You can compare up to four programs.'), 'warning'); return current }
      return [...current, id]
    }),
    addProgramsToCompare: (ids: string[]) => setCompareIds((current) => {
      const additions = [...new Set(ids)].filter((id) => !current.includes(id))
      const availableSlots = Math.max(0, 4 - current.length)
      if (additions.length > availableSlots) {
        onNotify(tx('discover.compareLimit', 'You can compare up to four programs.'), 'warning')
      }
      return [...current, ...additions.slice(0, availableSlots)]
    }),
    clearCompare: () => setCompareIds([]),
    requestDeletePrograms: (ids: string[]) => setPendingDeleteProgramIds([...new Set(ids)].filter(Boolean)),
    toggleWatch: toggleProgramWatch,
    watchPrograms,
    toggleProgramHidden,
    hidePrograms,
    togglePiHidden,
    importProgram: (programId: string, piId?: string | null) => void importProgram(programId, piId),
    updateProgramNote: (id: string, value: string) => {
      dirtyProgramNoteIdsRef.current.add(id)
      const next = { ...programNoteDraftsRef.current, [id]: value }
      programNoteDraftsRef.current = next
      persistRecoverableDraft()
      setProgramNoteDrafts(next)
    },
    saveProgramNote: (id: string) => {
      const submitted = programNoteDraftsRef.current[id] || ''
      void saveState(
        { programNotes: { ...(stateRef.current?.programNotes || {}), [id]: submitted } },
        true,
        () => {
          if ((programNoteDraftsRef.current[id] || '') === submitted) {
            dirtyProgramNoteIdsRef.current.delete(id)
          }
        },
      )
    },
    updatePiNote: (id: string, value: string) => {
      dirtyPiNoteIdsRef.current.add(id)
      const next = { ...piNoteDraftsRef.current, [id]: value }
      piNoteDraftsRef.current = next
      persistRecoverableDraft()
      setPiNoteDrafts(next)
    },
    savePiNote: (id: string) => {
      const submitted = piNoteDraftsRef.current[id] || ''
      void saveState(
        { piNotes: { ...(stateRef.current?.piNotes || {}), [id]: submitted } },
        true,
        () => {
          if ((piNoteDraftsRef.current[id] || '') === submitted) {
            dirtyPiNoteIdsRef.current.delete(id)
          }
        },
      )
    },
    toggleRegion: (region: string) => setRegionFilters((current) => toggleInList(current, region)),
    setMinStipend,
    setMinMatch,
    setWatchedOnly,
    setMeetFloorOnly,
    setShowHidden,
    setHedgeFilter,
    setPiCategory,
    setMinHIndex,
    toggleRequirement: (key: keyof RequirementFilterState) => setReqFilters((current) => key === 'deadlineWithinDays' ? { ...current, deadlineWithinDays: current.deadlineWithinDays ? 0 : 60 } : { ...current, [key]: !current[key] }),
    setRankerWeight: (key: keyof DiscoverRankerWeights, value: number) => {
      rankerDraftDirtyRef.current = true
      const next = { ...rankerDraftRef.current, [key]: value }
      rankerDraftRef.current = next
      persistRecoverableDraft()
      setRankerDraft(next)
    },
    saveRanker: () => {
      const submitted = rankerDraftRef.current
      void saveState({ ranker: submitted }, true, () => {
        if (rankerDraftRef.current === submitted) rankerDraftDirtyRef.current = false
      })
    },
    clearFilters,
    setProgramSort,
    toggleSortDirection: () => setSortDirection((value) => value === 'asc' ? 'desc' : 'asc'),
  }

  return (
    <div className={clsx('discover-screen', 'animate-enter', deferProgressiveReveal && 'is-deferred')}>
      <DiscoverWorkspace
        meta={meta}
        state={state}
        mode={mode}
        modeDirection={modeDirection}
        query={query}
        catalogProgramCount={programs.length}
        programs={filteredPrograms}
        pis={filteredPis}
        selectedProgram={selectedProgram}
        selectedPi={selectedPi}
        comparePrograms={comparePrograms}
        compareIds={compareIds}
        scoreByProgramId={scoreByProgramId}
        filters={filters}
        activeFilterCount={activeFilterCount}
        filterRailCollapsed={filterRailCollapsed}
        mobileFiltersOpen={mobileFiltersOpen}
        mobileInspectorOpen={mobileInspectorOpen}
        inspectorOpen={inspectorOpen}
        programSort={programSort}
        sortDirection={sortDirection}
        rankerDraft={rankerDraft}
        programNoteDrafts={programNoteDrafts}
        piNoteDrafts={piNoteDrafts}
        importingId={importingId}
        deletingProgramIds={deletingProgramIds}
        researching={researching || ['queued', 'running'].includes(state.researchJob?.status || '')}
        saving={saving}
        hiddenProgramCount={programs.filter((program) => program.hidden).length}
        hiddenPiCount={pis.filter((pi) => pi.hidden).length}
        teamContext={teamContext}
        actions={actions}
      />

      <DiscoverResearchSheet
        open={researchSheetOpen}
        meta={meta}
        draft={intakeDraft}
        applications={applications}
        useApplicationSeeds={useApplicationSeeds}
        aiKeys={usableAiKeys}
        selectedKeyIds={selectedKeyIds}
        teamTargetUserId={teamScope?.targetUserId}
        teamTargetOptions={teamTargetOptions}
        researching={researching}
        submissionPhase={researchSubmissionPhase}
        submissionError={researchSubmissionError}
        onClose={() => {
          setResearchSheetOpen(false)
          setResearchSubmissionPhase('idle')
          setResearchSubmissionError(null)
        }}
        onDraftChange={(nextDraft) => {
          intakeDraftDirtyRef.current = true
          intakeDraftRef.current = nextDraft
          persistRecoverableDraft()
          setIntakeDraft(nextDraft)
        }}
        onUseApplicationSeedsChange={setUseApplicationSeeds}
        onSelectedKeyIdsChange={setSelectedKeyIds}
        onTeamTargetChange={onTeamTargetChange}
        onConfigureAiKeys={() => void configureAiKeys()}
        onSubmit={() => void runResearch()}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteProgramIds?.length)}
        title={tx('discover.deleteProgramsTitle', 'Delete program results?')}
        message={tx(
          pendingDeleteProgramIds?.length === 1
            ? 'discover.deleteProgramMessage'
            : 'discover.deleteProgramsMessage',
          pendingDeleteProgramIds?.length === 1
            ? 'This removes the selected result from Discover. It will not affect an application you already created.'
            : 'This removes {count} selected results from Discover. Applications you already created are not affected.',
        ).replace('{count}', String(pendingDeleteProgramIds?.length || 0))}
        confirmLabel={tx('discover.deleteSelected', 'Delete')}
        variant="danger"
        onConfirm={() => {
          const ids = pendingDeleteProgramIds || []
          return deletePrograms(ids).then(() => setPendingDeleteProgramIds(null))
        }}
        onCancel={() => setPendingDeleteProgramIds(null)}
      />
    </div>
  )
}
