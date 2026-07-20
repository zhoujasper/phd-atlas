import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  FileSearch,
  Loader2,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { phdApi, type AiKey } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import type { DiscoverApplicationEnrichmentProposal, DiscoverEnrichmentChange } from '../../data/discover'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'
import { CollapsiblePanel } from './CollapsiblePanel'
import { Select } from './Select'
import { SwitchControl } from './SwitchControl'

const TARGET_LABELS: Record<string, [string, string]> = {
  'school.website': ['discover.enrichFieldWebsite', 'School website'],
  deadline: ['discover.enrichFieldDeadline', 'Application deadline'],
  'professor.english': ['discover.enrichFieldAdvisor', 'Advisor name'],
  'professor.email': ['discover.enrichFieldAdvisorEmail', 'Advisor email'],
  'professor.homepage': ['discover.enrichFieldAdvisorPage', 'Advisor homepage'],
  'professor.research': ['discover.enrichFieldAdvisorResearch', 'Advisor research'],
  tags: ['discover.enrichFieldTags', 'Research tags'],
  'dossier.discover': ['discover.enrichFieldDossier', 'Discover research card'],
  'scholarship.discover': ['discover.enrichFieldFunding', 'Funding snapshot'],
  'timeline.discover': ['discover.enrichFieldTimeline', 'Research timeline event'],
}

function EnrichmentChangeRow({
  change,
  checked,
  onToggle,
}: {
  change: DiscoverEnrichmentChange
  checked: boolean
  onToggle: () => void
}) {
  const { tx } = useI18n()
  const label = TARGET_LABELS[change.target] || ['discover.enrichFieldOther', 'Application detail']
  const displayValue = (value: string) => {
    if (change.id === 'discover-dossier') return value
      ? tx('discover.enrichDossierValue', 'Program fit, funding, requirements, outcomes and official sources')
      : value
    if (change.id === 'discover-timeline') return value
      ? tx('discover.enrichTimelineValue', 'Research snapshot added from Discover')
      : value
    if (change.id === 'discover-funding') return value.replace('(snapshot)', tx('discover.enrichSnapshotSuffix', '(research snapshot)'))
    if (change.id === 'research-tags') return value.replace('discover-enriched', tx('discover.enrichTagValue', 'Discover enriched'))
    return value
  }
  return (
    <button
      type="button"
      className={clsx('discover-enrich-change', checked && 'selected', change.mode === 'update' && 'replacement')}
      aria-pressed={checked}
      onClick={onToggle}
    >
      <span className="discover-enrich-check">{checked ? <Check size={13} /> : null}</span>
      <span className="discover-enrich-change-copy">
        <span className="discover-enrich-change-heading">
          <strong>{tx(label[0], label[1])}</strong>
          <i className={clsx('discover-enrich-source', change.source)}>
            {change.source === 'ai'
              ? tx('discover.enrichSourceAi', 'AI synthesis')
              : change.source === 'catalog_ai'
                ? tx('discover.enrichSourceBoth', 'Catalog + AI')
                : tx('discover.enrichSourceCatalog', 'Catalog')}
          </i>
          <i className="discover-enrich-confidence">{tx(`discover.enrichConfidence${change.confidence[0].toUpperCase()}${change.confidence.slice(1)}`, change.confidence)}</i>
        </span>
        {change.before ? (
          <span className="discover-enrich-diff">
            <del>{displayValue(change.before)}</del>
            <ArrowRight size={13} aria-hidden="true" />
            <ins>{displayValue(change.after)}</ins>
          </span>
        ) : <span className="discover-enrich-after">{displayValue(change.after)}</span>}
        {change.mode === 'update' ? (
          <small className="discover-enrich-warning"><AlertTriangle size={12} /> {tx('discover.enrichReplacementWarning', 'This replaces an existing value and is left unselected.')}</small>
        ) : null}
      </span>
    </button>
  )
}

export function DiscoverApplicationEnrichment({
  token,
  applications,
  aiKeys,
  preferredKeyId,
  onApplied,
  onNotify,
}: {
  token: string
  applications: ApplicationRecord[]
  aiKeys: AiKey[]
  preferredKeyId?: string | null
  onApplied: (application: ApplicationRecord) => void
  onNotify: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
}) {
  const { tx, format, lang } = useI18n()
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? '')
  const [useAi, setUseAi] = useState(aiKeys.length > 0)
  const [keyId, setKeyId] = useState(preferredKeyId || aiKeys[0]?.id || '')
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [proposal, setProposal] = useState<DiscoverApplicationEnrichmentProposal | null>(null)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [replacementsOpen, setReplacementsOpen] = useState(false)

  useEffect(() => {
    if (!applications.some((item) => item.id === applicationId)) setApplicationId(applications[0]?.id ?? '')
  }, [applicationId, applications])

  useEffect(() => {
    if (!keyId && aiKeys[0]) setKeyId(preferredKeyId || aiKeys[0].id)
    if (!aiKeys.length) setUseAi(false)
  }, [aiKeys, keyId, preferredKeyId])

  const applicationOptions = useMemo(() => applications.map((item) => ({
    value: item.id,
    label: item.school.name || item.program,
    description: [item.program, item.professor.english].filter(Boolean).join(' · '),
  })), [applications])
  const keyOptions = useMemo(() => aiKeys.map((key) => ({
    value: key.id,
    label: key.label,
    description: `${key.provider} · ${key.model}`,
  })), [aiKeys])

  const preview = async () => {
    if (!applicationId) return
    setBusy('preview')
    setProposal(null)
    setDetailsOpen(false)
    setReplacementsOpen(false)
    try {
      const next = await phdApi.previewDiscoverApplicationEnrichment(token, applicationId, {
        useAi,
        keyId: useAi ? keyId : undefined,
      })
      setProposal(next)
      setAccepted(new Set(next.changes.filter((change) => change.recommended).map((change) => change.id)))
      if (!next.matchedProgram) onNotify(tx('discover.enrichNoMatch', 'No close catalog match was found. Research or add this program in Discover first.'), 'warning')
    } catch (error) {
      onNotify(normalizeErrorMessage(error, lang, tx('discover.enrichPreviewError', 'Could not generate the enrichment preview.')), 'error')
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!proposal || !applicationId || accepted.size === 0) return
    setBusy('apply')
    try {
      const updated = await phdApi.applyDiscoverApplicationEnrichment(
        token,
        applicationId,
        proposal,
        Array.from(accepted),
      )
      onApplied(updated)
      onNotify(format(tx('discover.enrichApplied', 'Applied {count} reviewed changes.'), { count: accepted.size }), 'success')
      setProposal(null)
      setAccepted(new Set())
    } catch (error) {
      onNotify(normalizeErrorMessage(error, lang, tx('discover.enrichApplyError', 'Could not apply the selected changes.')), 'error')
    } finally {
      setBusy(null)
    }
  }

  const toggle = (id: string) => setAccepted((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const recommendedChanges = proposal?.changes.filter((change) => change.mode !== 'update') ?? []
  const replacementChanges = proposal?.changes.filter((change) => change.mode === 'update') ?? []

  if (!applications.length) {
    return (
      <div className="discover-enrich-empty">
        <FileSearch size={22} aria-hidden="true" />
        <div>
          <strong>{tx('discover.enrichEmptyTitle', 'No existing applications yet')}</strong>
          <p>{tx('discover.enrichEmptyBody', 'Add a discovered program first, then return here to research and fill its missing details.')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="discover-enrichment-workflow">
      <div className="discover-enrich-intro">
        <span><ScanSearch size={16} aria-hidden="true" /></span>
        <div>
          <strong>{tx('discover.enrichIntroTitle', 'Research first, apply second')}</strong>
          <p>{tx('discover.enrichIntroBody', 'PhD Atlas compares the application with your Discover catalog and shows every proposed change. Existing values are never selected for replacement by default.')}</p>
        </div>
      </div>

      <div className="discover-enrich-controls">
        {applications.length === 1 ? (
          <div className="discover-enrich-application-context">
            <span>{tx('discover.enrichChooseApplication', 'Application')}</span>
            <strong>{applications[0].school.name}</strong>
            <small>{[applications[0].program, applications[0].professor.english].filter(Boolean).join(' · ')}</small>
          </div>
        ) : (
          <label>
            <span>{tx('discover.enrichChooseApplication', 'Application')}</span>
            <Select
              value={applicationId}
              options={applicationOptions}
              onChange={(value) => {
                setApplicationId(value)
                setProposal(null)
              }}
              ariaLabel={tx('discover.enrichChooseApplication', 'Application')}
              searchable
            />
          </label>
        )}
        <div className="discover-enrich-ai-control">
          <div>
            <strong>{tx('discover.enrichUseAi', 'Use intelligent research')}</strong>
            <small>{aiKeys.length
              ? tx('discover.enrichUseAiHint', 'Uses only the application and catalog evidence shown here.')
              : tx('discover.useAiNoKeys', 'Add a research model key in Profile / Settings first.')}</small>
          </div>
          <SwitchControl
            checked={useAi}
            disabled={!aiKeys.length}
            label={tx('discover.enrichUseAi', 'Use intelligent research')}
            onChange={setUseAi}
          />
        </div>
        {useAi && keyOptions.length ? (
          <label>
            <span>{tx('discover.aiKey', 'Research model')}</span>
            <Select value={keyId} options={keyOptions} onChange={setKeyId} ariaLabel={tx('discover.aiKey', 'Research model')} />
          </label>
        ) : null}
        <button
          type="button"
          className="primary-action discover-enrich-preview-btn"
          disabled={busy !== null || (useAi && !keyId)}
          onClick={() => void preview()}
        >
          {busy === 'preview' ? <Loader2 size={15} className="spin-icon" /> : <FileSearch size={15} />}
          {busy === 'preview' ? tx('discover.enrichPreviewing', 'Building preview…') : tx('discover.enrichPreview', 'Preview changes')}
        </button>
      </div>

      {proposal ? (
        <section className="discover-enrich-preview" aria-labelledby="discover-enrich-preview-title">
          <header>
            <div>
              <span>{tx('discover.enrichPreviewEyebrow', 'Review before applying')}</span>
              <h3 id="discover-enrich-preview-title">
                {proposal.matchedProgram
                  ? `${proposal.matchedProgram.school} · ${proposal.matchedProgram.program}`
                  : tx('discover.enrichNoMatchTitle', 'No confident catalog match')}
              </h3>
              <p>{proposal.matchedProgram
                ? format(tx('discover.enrichMatchHint', 'Catalog match confidence: {score}%. Intelligent research suggestions are labeled separately.'), { score: proposal.matchedProgram.matchScore })
                : tx('discover.enrichNoMatch', 'No close catalog match was found. Research or add this program in Discover first.')}</p>
            </div>
            {proposal.matchedProgram ? <span className="discover-enrich-match-score">{proposal.matchedProgram.matchScore}%</span> : null}
          </header>

          {proposal.changes.length ? (
            <div className="discover-enrich-change-list">
              {recommendedChanges.length ? (
                <div className="discover-enrich-change-group">
                  <div className="discover-enrich-group-label">
                    <span>{tx('discover.enrichRecommendedGroup', 'Suggested additions')}</span>
                    <b>{recommendedChanges.length}</b>
                  </div>
                  {recommendedChanges.map((change) => (
                    <EnrichmentChangeRow
                      key={change.id}
                      change={change}
                      checked={accepted.has(change.id)}
                      onToggle={() => toggle(change.id)}
                    />
                  ))}
                </div>
              ) : null}
              {replacementChanges.length ? (
                <div className="discover-enrich-change-group replacements">
                  <button
                    type="button"
                    className="discover-enrich-replacements-toggle"
                    aria-expanded={replacementsOpen}
                    aria-controls="discover-enrich-replacements"
                    onClick={() => setReplacementsOpen((value) => !value)}
                  >
                    <span>
                      <strong>{format(tx('discover.enrichReplacementGroup', '{count} existing values differ'), { count: replacementChanges.length })}</strong>
                      <small>{tx('discover.enrichReplacementGroupHint', 'Collapsed for safety; review only if you intend to replace saved information.')}</small>
                    </span>
                    <ChevronDown size={15} />
                  </button>
                  <CollapsiblePanel id="discover-enrich-replacements" open={replacementsOpen} warmMount innerClassName="discover-enrich-replacements-inner">
                    {replacementChanges.map((change) => (
                      <EnrichmentChangeRow
                        key={change.id}
                        change={change}
                        checked={accepted.has(change.id)}
                        onToggle={() => toggle(change.id)}
                      />
                    ))}
                  </CollapsiblePanel>
                </div>
              ) : null}
            </div>
          ) : null}

          {(proposal.caveats.length || proposal.changes.some((change) => change.sources.length)) ? (
            <div className="discover-enrich-evidence">
              <button
                type="button"
                className="discover-enrich-evidence-toggle"
                aria-expanded={detailsOpen}
                aria-controls="discover-enrich-evidence-content"
                onClick={() => setDetailsOpen((value) => !value)}
              >
                <span><ShieldCheck size={15} /> {tx('discover.enrichEvidenceDetails', 'Sources and verification notes')}</span>
                <ChevronDown size={15} />
              </button>
              <CollapsiblePanel id="discover-enrich-evidence-content" open={detailsOpen} warmMount innerClassName="discover-enrich-evidence-inner">
                {proposal.caveats.length ? (
                  <ul>{proposal.caveats.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : null}
                <div className="discover-enrich-sources">
                  {Array.from(new Set(proposal.changes.flatMap((change) => change.sources))).map((source) => (
                    <a key={source} href={source} target="_blank" rel="noreferrer">{source}</a>
                  ))}
                </div>
              </CollapsiblePanel>
            </div>
          ) : null}

          <footer>
            <span>{format(tx('discover.enrichSelectedCount', '{count} changes selected'), { count: accepted.size })}</span>
            <div>
              <button type="button" className="quiet-action" disabled={busy !== null} onClick={() => setProposal(null)}>
                {tx('discover.enrichCancel', 'Cancel')}
              </button>
              <button type="button" className="primary-action" disabled={!accepted.size || busy !== null} onClick={() => void apply()}>
                {busy === 'apply' ? <Loader2 size={15} className="spin-icon" /> : <Check size={15} />}
                {busy === 'apply' ? tx('discover.enrichApplying', 'Applying…') : tx('discover.enrichApply', 'Apply selected changes')}
              </button>
            </div>
          </footer>
        </section>
      ) : null}
    </div>
  )
}
