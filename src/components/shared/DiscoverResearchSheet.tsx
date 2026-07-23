import { CheckCircle2, ChevronDown, KeyRound, RefreshCw, Server, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { useEffect } from 'react'
import type { AiKey } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import type { DiscoverCatalogMeta, DiscoverIntake, DiscoverRegion, PiCategory } from '../../data/discover'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { Select } from './Select'
import { DiscoverMultiSelectOption } from './DiscoverMultiSelect'
import { SmoothDisclosure } from './SmoothDisclosure'
import { SwitchControl } from './SwitchControl'

const PI_PREFERENCES: Array<{ id: PiCategory; key: string }> = [
  { id: 'rising_star', key: 'discover.prefRising' },
  { id: 'direction_fit', key: 'discover.prefFit' },
  { id: 'interesting', key: 'discover.prefInteresting' },
  { id: 'famous_but_fits', key: 'discover.prefFamous' },
]

export type DiscoverResearchSubmissionPhase = 'idle' | 'saving' | 'validating' | 'queued'

export function DiscoverResearchSheet({
  open,
  meta,
  draft,
  applications,
  useApplicationSeeds,
  aiKeys,
  selectedKeyIds,
  teamTargetUserId,
  teamTargetOptions = [],
  researching,
  submissionPhase,
  submissionError,
  onClose,
  onDraftChange,
  onUseApplicationSeedsChange,
  onSelectedKeyIdsChange,
  onTeamTargetChange,
  onConfigureAiKeys,
  onSubmit,
}: {
  open: boolean
  meta: DiscoverCatalogMeta | null
  draft: DiscoverIntake
  applications: ApplicationRecord[]
  useApplicationSeeds: boolean
  aiKeys: AiKey[]
  selectedKeyIds: string[]
  teamTargetUserId?: string
  teamTargetOptions?: Array<{ id: string; name: string; email?: string; count?: number }>
  researching: boolean
  submissionPhase: DiscoverResearchSubmissionPhase
  submissionError: string | null
  onClose: () => void
  onDraftChange: (draft: DiscoverIntake) => void
  onUseApplicationSeedsChange: (value: boolean) => void
  onSelectedKeyIdsChange: (value: string[]) => void
  onTeamTargetChange?: (userId: string) => void
  onConfigureAiKeys: () => void
  onSubmit: () => void
}) {
  const { tx } = useI18n()
  const { exiting, requestClose } = useAnimatedClose(open, onClose, 150)
  const submissionBusy = submissionPhase === 'saving' || submissionPhase === 'validating'
  const submissionVisible = submissionPhase !== 'idle' || Boolean(submissionError)
  const submissionLabel = submissionError
    ? submissionError
    : submissionPhase === 'saving'
      ? tx('discover.researchSavingPreferences', 'Saving research preferences…')
      : submissionPhase === 'validating'
        ? tx('discover.researchCheckingConfiguration', 'Checking model access and configuration…')
        : submissionPhase === 'queued'
          ? tx('discover.researchConfigurationReady', 'Configuration verified. Handed to the background server.')
          : ''
  useEffect(() => {
    if (submissionPhase === 'queued') requestClose()
  }, [requestClose, submissionPhase])
  const regionLabel = (region: DiscoverRegion) => tx(({
    US: 'discover.regionUS', UK: 'discover.regionUK', EU: 'discover.regionEU', CA: 'discover.regionCA',
    SG: 'discover.regionSG', HK: 'discover.regionHK', CN: 'discover.regionCN', AU: 'discover.regionAU',
  } as Record<string, string>)[region.key] || 'discover.region', region.label)
  if (!open) return null
  const toggleRegion = (key: string) => {
    const regions = draft.regions.includes(key) ? draft.regions.filter((item) => item !== key) : [...draft.regions, key]
    onDraftChange({ ...draft, regions })
  }
  const togglePreference = (id: string) => {
    const piPreferences = draft.piPreferences.includes(id) ? draft.piPreferences.filter((item) => item !== id) : [...draft.piPreferences, id]
    onDraftChange({ ...draft, piPreferences })
  }
  const toggleKey = (id: string) => {
    onSelectedKeyIdsChange(selectedKeyIds.includes(id)
      ? selectedKeyIds.filter((keyId) => keyId !== id)
      : [...selectedKeyIds, id])
  }
  return (
    <div className={`discover-sheet-backdrop${exiting ? ' is-exiting' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
      <aside className={`discover-side-sheet${exiting ? ' is-exiting' : ''}`} role="dialog" aria-modal="true" aria-labelledby="discover-research-sheet-title">
        <header className="discover-side-sheet-header">
          <div>
            <h3 id="discover-research-sheet-title">{tx('discover.updateResearch', 'Update research')}</h3>
            <p>{tx('discover.researchSheetSubtitle', 'Adjust your direction, then re-check programs, advisors and funding.')}</p>
          </div>
          <button type="button" className="discover-icon-btn" onClick={() => requestClose()} aria-label={tx('discover.close', 'Close')}><X size={17} /></button>
        </header>

        <div className="discover-side-sheet-scroll" aria-busy={submissionBusy || undefined} inert={submissionBusy || undefined}>
          {teamTargetOptions.length > 0 && teamTargetUserId && onTeamTargetChange ? (
            <SmoothDisclosure
              className="discover-sheet-section"
              defaultOpen
              summary={tx('team.teacherStudentSelectLabel', 'Student')}
              indicator={<ChevronDown size={15} />}
              bodyClassName="discover-sheet-section-body"
            >
              <label className="field">
                <span>{tx('team.teamDiscoverTitle', 'Research a student’s programs')}</span>
                <Select
                  size="small"
                  value={teamTargetUserId}
                  onChange={onTeamTargetChange}
                  options={teamTargetOptions.map((student) => ({
                    value: student.id,
                    label: student.name,
                    description: student.email || tx('team.teamDiscoverStudentMeta', '{count} applications').replace('{count}', String(student.count ?? 0)),
                  }))}
                  ariaLabel={tx('team.teacherStudentSelectLabel', 'Student')}
                  searchable
                />
                <small>{tx('team.teamDiscoverDesc', 'Choose one assigned student. Research and matching are saved only for that student.')}</small>
              </label>
            </SmoothDisclosure>
          ) : null}

          <SmoothDisclosure
            className="discover-sheet-section"
            defaultOpen
            summary={tx('discover.researchDirection', 'Research direction')}
            indicator={<ChevronDown size={15} />}
            bodyClassName="discover-sheet-section-body"
          >
              <label className="field">
                <span>{tx('discover.field')}</span>
                <input value={draft.field} onChange={(event) => onDraftChange({ ...draft, field: event.target.value })} placeholder={tx('discover.fieldPlaceholder')} />
              </label>
              <label className="field">
                <span>{tx('discover.relatedTopics', 'Related topics')}</span>
                <input
                  value={draft.subfields.join(', ')}
                  onChange={(event) => onDraftChange({ ...draft, subfields: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })}
                  placeholder={tx('discover.subfieldsPlaceholder')}
                />
              </label>
              <label className="field">
                <span>{tx('discover.seedPrograms', 'Seed schools or programs')}</span>
                <textarea
                  rows={3}
                  value={(draft.seedPrograms || []).join('\n')}
                  onChange={(event) => onDraftChange({ ...draft, seedPrograms: event.target.value.split(/\n|,/).map((value) => value.trim()).filter(Boolean).slice(0, 30) })}
                  placeholder={tx('discover.seedProgramsPlaceholder', 'One school or program per line')}
                />
              </label>
          </SmoothDisclosure>

          <SmoothDisclosure
            className="discover-sheet-section"
            defaultOpen
            summary={tx('discover.targetRegions', 'Target regions')}
            indicator={<ChevronDown size={15} />}
            bodyClassName="discover-sheet-section-body discover-multiselect-grid"
          >
              {(meta?.regions || []).map((region) => (
                <DiscoverMultiSelectOption
                  key={region.key}
                  checked={draft.regions.includes(region.key)}
                  onChange={() => toggleRegion(region.key)}
                  label={regionLabel(region)}
                />
              ))}
          </SmoothDisclosure>

          <SmoothDisclosure
            className="discover-sheet-section"
            defaultOpen
            summary={tx('discover.fundingFloor', 'Funding floor')}
            indicator={<ChevronDown size={15} />}
            bodyClassName="discover-sheet-section-body discover-sheet-two-column"
          >
              <label className="field">
                <span>{tx('discover.currency', 'Currency')}</span>
                <Select
                  size="small"
                  value={draft.currency}
                  onChange={(currency) => onDraftChange({ ...draft, currency })}
                  options={['USD', 'GBP', 'EUR', 'CAD', 'CNY', 'AUD'].map((value) => ({ value, label: value }))}
                />
              </label>
              <label className="field">
                <span>{tx('discover.annualMinimum', 'Minimum annual funding')}</span>
                <input type="number" min={0} step={1000} value={draft.stipendFloor} onChange={(event) => onDraftChange({ ...draft, stipendFloor: Number(event.target.value) || 0 })} />
              </label>
          </SmoothDisclosure>

          <SmoothDisclosure
            className="discover-sheet-section"
            summary={tx('discover.advisorPreferences', 'Advisor preferences')}
            indicator={<ChevronDown size={15} />}
            bodyClassName="discover-sheet-section-body"
          >
              <div className="discover-multiselect-grid">
                {PI_PREFERENCES.map((preference) => (
                  <DiscoverMultiSelectOption
                    key={preference.id}
                    checked={draft.piPreferences.includes(preference.id)}
                    onChange={() => togglePreference(preference.id)}
                    label={tx(preference.key)}
                  />
                ))}
              </div>
              <label className="field">
                <span>{tx('discover.risingBias')}</span>
                <Select
                  size="small"
                  value={draft.risingStarBias}
                  onChange={(risingStarBias) => onDraftChange({ ...draft, risingStarBias })}
                  options={[
                    { value: 'strong', label: tx('discover.biasStrong') },
                    { value: 'moderate', label: tx('discover.biasModerate') },
                    { value: 'neutral', label: tx('discover.biasNeutral') },
                  ]}
                />
              </label>
          </SmoothDisclosure>

          <SmoothDisclosure
            className="discover-sheet-section"
            summary={tx('discover.constraintsAndLifestyle', 'Application constraints and lifestyle')}
            indicator={<ChevronDown size={15} />}
            bodyClassName="discover-sheet-section-body"
          >
              <label className="field">
                <span>{tx('discover.extraNotes', 'What else matters')}</span>
                <textarea rows={5} value={draft.notes} onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })} placeholder={tx('discover.notesPlaceholder')} />
              </label>
              <div className="discover-sheet-two-column">
                <label className="field"><span>{tx('discover.nPrograms')}</span><input type="number" min={5} max={120} value={draft.nPrograms} onChange={(event) => onDraftChange({ ...draft, nPrograms: Number(event.target.value) || 20 })} /></label>
                <label className="field"><span>{tx('discover.nPis')}</span><input type="number" min={1} max={20} value={draft.nPisPerProgram} onChange={(event) => onDraftChange({ ...draft, nPisPerProgram: Number(event.target.value) || 6 })} /></label>
              </div>
          </SmoothDisclosure>

          <section className="discover-sheet-switch-row">
            <div>
              <strong>{tx('discover.useApplicationsAsSeeds', 'Use my applications as a starting point')}</strong>
              <span>{tx('discover.useApplicationsAsSeedsHint', 'Include {count} current applications in this research scope.').replace('{count}', String(applications.length))}</span>
            </div>
            <SwitchControl checked={useApplicationSeeds} onChange={onUseApplicationSeedsChange} label={tx('discover.useApplicationsAsSeeds', 'Use my applications as a starting point')} />
          </section>

          <SmoothDisclosure
            className="discover-sheet-section discover-sheet-advanced"
            defaultOpen
            summary={tx('discover.useAi', 'Use AI research agents')}
            indicator={<ChevronDown size={15} />}
            bodyClassName="discover-sheet-section-body"
          >
            {aiKeys.length > 0 ? (
              <div className="field">
                <span>{tx('discover.aiKeysLabel', 'AI keys')}</span>
                <div className="discover-multiselect-grid">
                  {aiKeys.map((key) => (
                    <DiscoverMultiSelectOption
                      key={key.id}
                      checked={selectedKeyIds.includes(key.id)}
                      onChange={() => toggleKey(key.id)}
                      label={`${key.label || key.model} · ${key.provider}`}
                    />
                  ))}
                </div>
                <small>{selectedKeyIds.length > 0
                  ? tx('discover.aiKeysHint', 'Selected keys are used evenly across independent research batches.')
                  : tx('discover.selectAiKeyRequired', 'Select at least one AI research model.')}</small>
              </div>
            ) : (
              <div className="discover-ai-key-required" role="status">
                <KeyRound size={17} aria-hidden="true" />
                <span>
                  <strong>{tx('discover.useAiNoKeys', 'Add an AI key in Settings before starting research.')}</strong>
                  <small>{tx('discover.useAiMultiHint', 'AI agents search, organize and cross-check official program and advisor evidence.')}</small>
                </span>
                <button type="button" className="secondary-action" onClick={onConfigureAiKeys}>
                  {tx('discover.configureAiKey', 'Configure AI key')}
                </button>
              </div>
            )}
          </SmoothDisclosure>
        </div>

        <footer className="discover-side-sheet-footer">
          <div
            className={`discover-research-validation${submissionVisible ? ' is-visible' : ''}${submissionPhase === 'queued' ? ' is-complete' : ''}${submissionError ? ' is-error' : ''}`}
            role={submissionError ? 'alert' : 'status'}
            aria-live="polite"
          >
            <span className="discover-research-validation-copy">
              {submissionError
                ? <ShieldAlert size={13} aria-hidden="true" />
                : submissionPhase === 'queued'
                  ? <CheckCircle2 size={13} aria-hidden="true" />
                  : submissionPhase === 'validating'
                    ? <ShieldCheck size={13} aria-hidden="true" />
                    : <Server size={13} aria-hidden="true" />}
              <strong>{submissionLabel}</strong>
            </span>
            <span className="discover-research-validation-line" aria-hidden="true"><i /></span>
          </div>
          <div className="discover-sheet-safety-note">{tx('discover.researchBackgroundNote', 'Research continues safely in the background after this sheet closes. Updates never overwrite watched, hidden or personal notes.')}</div>
          <div>
            <button type="button" className="secondary-action" disabled={submissionBusy} onClick={() => requestClose()}>{tx('discover.cancel', 'Cancel')}</button>
            <button type="button" className="primary-action" disabled={researching || !draft.field.trim() || draft.regions.length === 0 || aiKeys.length === 0 || selectedKeyIds.length === 0} onClick={onSubmit}>
              {submissionPhase === 'queued'
                ? <CheckCircle2 size={14} aria-hidden="true" />
                : <RefreshCw size={14} className={researching ? 'spin-icon' : undefined} />}
              {submissionPhase === 'saving'
                ? tx('discover.researchSavingPreferences', 'Saving research preferences…')
                : submissionPhase === 'validating'
                  ? tx('discover.researchCheckingConfiguration', 'Checking model access and configuration…')
                  : submissionPhase === 'queued'
                    ? tx('discover.researchConfigurationReadyShort', 'Queued in background')
                    : tx('discover.startUpdate', 'Start update')}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}
