import {
  Compass,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { phdApi, type AiKey } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import { normalizeErrorMessage } from '../../errorMessages'
import type {
  DiscoverCatalogMeta,
  DiscoverCatalogPayload,
  DiscoverIntake,
  DiscoverRankerWeights,
  DiscoverResearchPayload,
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
import { DiscoverResearchSheet } from '../shared/DiscoverResearchSheet'
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
}: {
  token: string
  applications: ApplicationRecord[]
  onImported: (application: ApplicationRecord) => void
  onNotify: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  deferProgressiveReveal?: boolean
}) {
  const { tx, lang } = useI18n()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [researching, setResearching] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<DiscoverCatalogMeta | null>(null)
  const [state, setState] = useState<DiscoverUserState | null>(null)
  const stateRef = useRef<DiscoverUserState | null>(null)
  const [programs, setPrograms] = useState<ScoredDiscoverProgram[]>([])
  const [pis, setPis] = useState<ScoredDiscoverPi[]>([])
  const [aiKeys, setAiKeys] = useState<AiKey[]>([])

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
  const [programSort, setProgramSort] = useState<DiscoverProgramSort>('match')
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
  const [useAi, setUseAi] = useState(false)
  const [selectedKeyId, setSelectedKeyId] = useState('')

  const applyPayload = useCallback((payload: DiscoverCatalogPayload | DiscoverResearchPayload) => {
    if ('meta' in payload) setMeta(payload.meta)
    stateRef.current = payload.state
    setState(payload.state)
    setPrograms(payload.programs)
    setPis(payload.pis)
    setRankerDraft(payload.state.ranker)
    setIntakeDraft(payload.state.intake)
    setProgramNoteDrafts(payload.state.programNotes)
    setPiNoteDrafts(payload.state.piNotes)
    if (payload.state.preferredAiKeyId) setSelectedKeyId(payload.state.preferredAiKeyId)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [payload, keys] = await Promise.all([
        phdApi.getDiscoverCatalog(token),
        phdApi.listAiKeys(token).catch(() => [] as AiKey[]),
      ])
      applyPayload(payload)
      setAiKeys(keys)
      const preferred = payload.state.preferredAiKeyId
      if (preferred && keys.some((key) => key.id === preferred)) {
        setSelectedKeyId(preferred)
        setUseAi(true)
      } else if (keys[0]) {
        setSelectedKeyId(keys[0].id)
      }
    } catch (reason) {
      setError(normalizeErrorMessage(reason, lang, tx('discover.loadError')))
    } finally {
      setLoading(false)
    }
  }, [applyPayload, lang, token, tx])

  useEffect(() => { void load() }, [load])

  const saveState = useCallback(async (patch: Partial<DiscoverUserState>, toast = false) => {
    setSaving(true)
    try {
      const payload = await phdApi.updateDiscoverState(token, patch)
      applyPayload(payload)
      if (toast) onNotify(tx('discover.savedToast'), 'success')
    } catch (reason) {
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
    } finally {
      setSaving(false)
    }
  }, [applyPayload, lang, onNotify, token, tx])

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

    void phdApi.updateDiscoverState(token, { [key]: nextIds }).catch((reason) => {
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
  }, [lang, onNotify, token, tx])

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
    setResearching(true)
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
        preferredAiKeyId: selectedKeyId || null,
      })
      const payload = await phdApi.runDiscoverResearch(token, {
        notify: true,
        useAi: useAi && Boolean(selectedKeyId),
        keyId: selectedKeyId || undefined,
        acceptSuggestions: true,
      })
      applyPayload(payload)
      setResearchSheetOpen(false)
      onNotify(tx('discover.researchUpdatedToast', 'Research updated and verified.'), 'success')
    } catch (reason) {
      onNotify(normalizeErrorMessage(reason, lang, tx('discover.loadError')), 'error')
    } finally {
      setResearching(false)
    }
  }, [applications, applyPayload, intakeDraft, lang, onNotify, rankerDraft, selectedKeyId, state?.interestPicks, token, tx, useAi, useApplicationSeeds])

  const importProgram = useCallback(async (programId: string, piId?: string | null) => {
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
  }, [lang, onImported, onNotify, token, tx])

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
        researching={researching}
        saving={saving}
        hiddenProgramCount={programs.filter((program) => program.hidden).length}
        hiddenPiCount={pis.filter((pi) => pi.hidden).length}
        actions={actions}
      />

      <DiscoverResearchSheet
        open={researchSheetOpen}
        meta={meta}
        draft={intakeDraft}
        applications={applications}
        useApplicationSeeds={useApplicationSeeds}
        useAi={useAi}
        aiKeys={aiKeys}
        selectedKeyId={selectedKeyId}
        researching={researching}
        onClose={() => setResearchSheetOpen(false)}
        onDraftChange={setIntakeDraft}
        onUseApplicationSeedsChange={setUseApplicationSeeds}
        onUseAiChange={setUseAi}
        onSelectedKeyChange={setSelectedKeyId}
        onSubmit={() => void runResearch()}
      />
    </div>
  )
}
