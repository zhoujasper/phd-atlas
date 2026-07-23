import {
  Compass,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { phdApi, type AiKey, type DiscoverResearchScope } from '../../api/phdApi'
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
  const usableAiKeys = useMemo(() => aiKeys.filter((key) => key.secretSet), [aiKeys])

  const applyPayload = useCallback((payload: DiscoverCatalogPayload | DiscoverResearchPayload | DiscoverResearchStartPayload) => {
    if ('meta' in payload) setMeta(payload.meta)
    stateRef.current = payload.state
    setState(payload.state)
    setPrograms(payload.programs)
    setPis(payload.pis)
    setRankerDraft(payload.state.ranker)
    setIntakeDraft(payload.state.intake)
    setProgramNoteDrafts(payload.state.programNotes)
    setPiNoteDrafts(payload.state.piNotes)
    const preferredKeyIds = payload.state.preferredAiKeyIds?.length
      ? payload.state.preferredAiKeyIds
      : (payload.state.preferredAiKeyId ? [payload.state.preferredAiKeyId] : [])
    if (preferredKeyIds.length) setSelectedKeyIds(preferredKeyIds)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [payload, keys] = await Promise.all([
        phdApi.getDiscoverCatalog(token, teamScope),
        phdApi.listAiKeys(token).catch(() => [] as AiKey[]),
      ])
      applyPayload(payload)
      setAiKeys(keys)
      const preferred = payload.state.preferredAiKeyIds?.length
        ? payload.state.preferredAiKeyIds
        : (payload.state.preferredAiKeyId ? [payload.state.preferredAiKeyId] : [])
      const usableKeys = keys.filter((key) => key.secretSet)
      const selected = preferred.filter((id) => usableKeys.some((key) => key.id === id))
      if (selected.length) {
        setSelectedKeyIds(selected)
      } else if (usableKeys[0]) {
        setSelectedKeyIds([usableKeys[0].id])
      } else {
        setSelectedKeyIds([])
      }
    } catch (reason) {
      setError(normalizeErrorMessage(reason, lang, tx('discover.loadError')))
    } finally {
      setLoading(false)
    }
  }, [applyPayload, lang, teamScope, token, tx])

  useEffect(() => { void load() }, [load])

  const announcedResearchJobRef = useRef<string | null>(null)
  const researchJobId = state?.researchJob?.id
  const researchJobStatus = state?.researchJob?.status
  const refreshResearchState = useCallback(async () => {
    try {
      const payload = await phdApi.getDiscoverCatalog(token, teamScope)
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

  useEffect(() => {
    if (
      realtimeConnected
      || !researchJobId
      || !researchJobStatus
      || !['queued', 'running'].includes(researchJobStatus)
    ) return undefined
    const initialTimer = window.setTimeout(() => { void refreshResearchState() }, 8_000)
    const fallbackTimer = window.setInterval(() => { void refreshResearchState() }, 60_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(fallbackTimer)
    }
  }, [realtimeConnected, refreshResearchState, researchJobId, researchJobStatus])

  const saveState = useCallback(async (patch: Partial<DiscoverUserState>, toast = false) => {
    setSaving(true)
    try {
      const payload = await phdApi.updateDiscoverState(token, patch, teamScope)
      applyPayload(payload)
      if (toast) onNotify(tx('discover.savedToast'), 'success')
    } catch (reason) {
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
    } finally {
      setSaving(false)
    }
  }, [applyPayload, lang, onNotify, teamScope, token, tx])

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
  }, [applications, applyPayload, intakeDraft, lang, onNotify, rankerDraft, selectedKeyIds, state?.interestPicks, teamScope, token, tx, usableAiKeys, useApplicationSeeds])

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
      onNotify(tx('discover.importedToast'), 'success')
    } catch (reason) {
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
    } finally {
      setImportingId(null)
    }
  }, [lang, onImported, onNotify, teamScope, token, tx])

  const scoreByProgramId = useMemo(() => Object.fromEntries(programs.map((program) => [program.id, weightedScore(program, rankerDraft)])), [programs, rankerDraft])

  const filteredPrograms = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
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
      if (!normalizedQuery) return true
      const requirements = [
        ...(program.requirements?.materials || []).map((item) => item.name),
        ...(program.requirements?.tests || []).map((item) => `${item.name} ${item.status}`),
      ].join(' ')
      return [program.school, program.program, program.city, program.country, program.researchFocus, requirements, ...(program.tags || [])]
        .join(' ').toLowerCase().includes(normalizedQuery)
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
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    return pis.filter((pi) => {
      if (!showHidden && pi.hidden) return false
      if (regionFilters.length && !regionFilters.includes(pi.region)) return false
      if (piCategory !== 'all' && pi.category !== piCategory) return false
      if (minHIndex && (pi.hIndex == null || pi.hIndex < minHIndex)) return false
      if (!normalizedQuery) return true
      return [pi.name, pi.school, pi.program, pi.research, pi.whyFit].join(' ').toLowerCase().includes(normalizedQuery)
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
    clearCompare: () => setCompareIds([]),
    requestDeletePrograms: (ids: string[]) => setPendingDeleteProgramIds([...new Set(ids)].filter(Boolean)),
    toggleWatch: toggleProgramWatch,
    toggleProgramHidden,
    togglePiHidden,
    importProgram: (programId: string, piId?: string | null) => void importProgram(programId, piId),
    updateProgramNote: (id: string, value: string) => setProgramNoteDrafts((current) => ({ ...current, [id]: value })),
    saveProgramNote: (id: string) => void saveState({ programNotes: { ...state.programNotes, [id]: programNoteDrafts[id] || '' } }, true),
    updatePiNote: (id: string, value: string) => setPiNoteDrafts((current) => ({ ...current, [id]: value })),
    savePiNote: (id: string) => void saveState({ piNotes: { ...state.piNotes, [id]: piNoteDrafts[id] || '' } }, true),
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
    setRankerWeight: (key: keyof DiscoverRankerWeights, value: number) => setRankerDraft((current) => ({ ...current, [key]: value })),
    saveRanker: () => void saveState({ ranker: rankerDraft }, true),
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
        onDraftChange={setIntakeDraft}
        onUseApplicationSeedsChange={setUseApplicationSeeds}
        onSelectedKeyIdsChange={setSelectedKeyIds}
        onTeamTargetChange={onTeamTargetChange}
        onConfigureAiKeys={onConfigureAiKeys}
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
          setPendingDeleteProgramIds(null)
          void deletePrograms(ids)
        }}
        onCancel={() => setPendingDeleteProgramIds(null)}
      />
    </div>
  )
}
