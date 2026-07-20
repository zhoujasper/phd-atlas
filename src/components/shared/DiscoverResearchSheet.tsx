import { ChevronDown, RefreshCw, X } from 'lucide-react'
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

export function DiscoverResearchSheet({
  open,
  meta,
  draft,
  applications,
  useApplicationSeeds,
  useAi,
  aiKeys,
  selectedKeyId,
  researching,
  onClose,
  onDraftChange,
  onUseApplicationSeedsChange,
  onUseAiChange,
  onSelectedKeyChange,
  onSubmit,
}: {
  open: boolean
  meta: DiscoverCatalogMeta | null
  draft: DiscoverIntake
  applications: ApplicationRecord[]
  useApplicationSeeds: boolean
  useAi: boolean
  aiKeys: AiKey[]
  selectedKeyId: string
  researching: boolean
  onClose: () => void
  onDraftChange: (draft: DiscoverIntake) => void
  onUseApplicationSeedsChange: (value: boolean) => void
  onUseAiChange: (value: boolean) => void
  onSelectedKeyChange: (value: string) => void
  onSubmit: () => void
}) {
  const { tx } = useI18n()
  const { exiting, requestClose } = useAnimatedClose(open, onClose, 180)
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

        <div className="discover-side-sheet-scroll">
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
                <label className="field"><span>{tx('discover.nPrograms')}</span><input type="number" min={5} max={50} value={draft.nPrograms} onChange={(event) => onDraftChange({ ...draft, nPrograms: Number(event.target.value) || 20 })} /></label>
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

          {aiKeys.length ? (
            <SmoothDisclosure
              className="discover-sheet-section discover-sheet-advanced"
              summary={tx('discover.researchMethod', 'Research method')}
              indicator={<ChevronDown size={15} />}
              bodyClassName="discover-sheet-section-body"
            >
                <section className="discover-sheet-switch-row is-inner">
                  <div><strong>{tx('discover.useConfiguredResearch', 'Use configured intelligent research')}</strong><span>{tx('discover.useConfiguredResearchHint', 'Official-source verification rules remain unchanged.')}</span></div>
                  <SwitchControl checked={useAi} onChange={onUseAiChange} label={tx('discover.useConfiguredResearch', 'Use configured intelligent research')} />
                </section>
                {useAi ? <label className="field"><span>{tx('discover.aiKeyLabel')}</span><Select size="small" value={selectedKeyId} onChange={onSelectedKeyChange} options={aiKeys.map((key) => ({ value: key.id, label: `${key.label || key.model} · ${key.provider}` }))} /></label> : null}
            </SmoothDisclosure>
          ) : null}
        </div>

        <footer className="discover-side-sheet-footer">
          <div className="discover-sheet-safety-note">{tx('discover.researchPreservesState', 'Updates never overwrite watched, hidden or personal notes.')}</div>
          <div>
            <button type="button" className="secondary-action" onClick={() => requestClose()}>{tx('discover.cancel', 'Cancel')}</button>
            <button type="button" className="primary-action" disabled={researching || !draft.field.trim() || draft.regions.length === 0} onClick={onSubmit}>
              <RefreshCw size={14} className={researching ? 'spin-icon' : undefined} />
              {researching ? tx('discover.runningResearch') : tx('discover.startUpdate', 'Start update')}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}
