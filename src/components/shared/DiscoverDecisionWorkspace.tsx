import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Info,
  ListChecks,
  Plus,
  Radar,
  Sparkles,
  Target,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type {
  DiscoverUserState,
  ScoredDiscoverProgram,
} from '../../data/discover'
import {
  daysUntilIso,
  deadlineUrgencyClass,
  primaryDeadline,
} from '../../data/discover'
import { localeForLanguage } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { CollapsiblePanel } from './CollapsiblePanel'

type DecisionView = 'tradeoff' | 'deadline' | 'evidence'

type EvidenceSummary = {
  score: number
  missing: string[]
  official: number
  reviewed: number
}

function money(value: number | null | undefined, currency = 'USD') {
  if (value == null || !Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `$${Math.round(value).toLocaleString()}`
  }
}

function evidenceFor(program: ScoredDiscoverProgram): EvidenceSummary {
  const checks = [
    Boolean(program.website),
    Boolean(program.sources?.length),
    Boolean(program.stipendFoundOfficial),
    Boolean(program.deadlineIso || primaryDeadline(program.requirements)?.date),
    Boolean(program.requirements?.verified?.deadlines),
    Boolean(program.requirements?.verified?.restrictions),
    Boolean(program.pis?.some((pi) => pi.url || pi.scholarUrl)),
  ]
  const missing: string[] = []
  if (!checks[1]) missing.push('sources')
  if (!checks[2]) missing.push('funding')
  if (!checks[3] || !checks[4]) missing.push('deadline')
  if (!checks[5]) missing.push('restrictions')
  if (!checks[6]) missing.push('advisors')
  const official = checks.filter(Boolean).length
  return {
    score: Math.round((official / checks.length) * 100),
    missing,
    official,
    reviewed: checks.length - official,
  }
}

function deadlineFor(program: ScoredDiscoverProgram) {
  return program.deadlineIso || primaryDeadline(program.requirements)?.date || null
}

function DisclosureSection({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className={clsx('discover-disclosure', open && 'open')}>
      <button
        type="button"
        className="discover-disclosure-summary"
        aria-expanded={open}
        aria-controls={`${id}-content`}
        onClick={onToggle}
      >
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <CollapsiblePanel
        id={`${id}-content`}
        open={open}
        openMs={380}
        closeMs={260}
        warmMount
        innerClassName="discover-disclosure-inner"
      >
        {children}
      </CollapsiblePanel>
    </section>
  )
}

function Guide({
  what,
  how,
  next,
}: {
  what: string
  how: string
  next: string
}) {
  const { tx } = useI18n()
  return (
    <dl className="discover-chart-guide">
      <div>
        <dt>{tx('discover.guideWhat', 'What to look at')}</dt>
        <dd>{what}</dd>
      </div>
      <div>
        <dt>{tx('discover.guideHow', 'How to read it')}</dt>
        <dd>{how}</dd>
      </div>
      <div>
        <dt>{tx('discover.guideNext', 'What to do next')}</dt>
        <dd>{next}</dd>
      </div>
    </dl>
  )
}

export function DiscoverDecisionWorkspace({
  programs,
  state,
  importingId,
  researching,
  onConfigure,
  onResearch,
  onOpenProgram,
  onImportProgram,
  onToggleWatch,
}: {
  programs: ScoredDiscoverProgram[]
  state: DiscoverUserState
  importingId: string | null
  researching: boolean
  onConfigure: () => void
  onResearch: () => void
  onOpenProgram: (id: string) => void
  onImportProgram: (id: string) => void
  onToggleWatch: (id: string) => void
}) {
  const { tx, format, lang } = useI18n()
  const visible = useMemo(() => programs.filter((program) => !program.hidden), [programs])
  const topPrograms = visible.slice(0, 5)
  const [selectedId, setSelectedId] = useState<string | null>(topPrograms[0]?.id ?? null)
  const [openView, setOpenView] = useState<DecisionView | null>('tradeoff')
  const [inspectorSection, setInspectorSection] = useState<'meaning' | 'evidence' | 'next' | null>('meaning')

  useEffect(() => {
    if (!selectedId || !visible.some((program) => program.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null)
    }
  }, [selectedId, visible])

  const selected = visible.find((program) => program.id === selectedId) ?? visible[0] ?? null
  const selectedEvidence = selected ? evidenceFor(selected) : null
  const deadlineRows = useMemo(() => visible
    .map((program) => ({ program, deadline: deadlineFor(program) }))
    .filter((row): row is { program: ScoredDiscoverProgram; deadline: string } => Boolean(row.deadline))
    .map((row) => ({ ...row, days: daysUntilIso(row.deadline) }))
    .filter((row) => row.days != null && row.days >= 0)
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
    .slice(0, 7), [visible])
  const evidenceRows = useMemo(() => visible
    .map((program) => ({ program, evidence: evidenceFor(program) }))
    .sort((a, b) => b.evidence.score - a.evidence.score), [visible])
  const evidenceAverage = evidenceRows.length
    ? Math.round(evidenceRows.reduce((total, row) => total + row.evidence.score, 0) / evidenceRows.length)
    : 0
  const tradeoffRows = visible
    .filter((program) => program.realStipendUSD != null)
    .slice(0, 28)
  const maxReal = Math.max(1, ...tradeoffRows.map((program) => program.realStipendUSD || 0))
  const watchedCount = visible.filter((program) => program.watched).length
  const nearest = deadlineRows[0]
  const step = !state.intakeCompleted ? 0 : !state.lastResearchAt ? 1 : watchedCount === 0 ? 2 : 3
  const dateFormatter = new Intl.DateTimeFormat(localeForLanguage(lang), { month: 'short', day: 'numeric' })

  if (!selected) {
    return (
      <div className="discover-empty discover-decision-empty">
        <Target size={24} aria-hidden="true" />
        <h3>{tx('discover.noPrograms')}</h3>
        <p>{tx('discover.noProgramsHint')}</p>
        <button type="button" className="primary-action" onClick={onConfigure}>
          {tx('discover.tabIntake')}
        </button>
      </div>
    )
  }

  const stageItems = [
    tx('discover.flowDirection', 'Set direction'),
    tx('discover.flowResearch', 'Research and verify'),
    tx('discover.flowShortlist', 'Build shortlist'),
    tx('discover.flowImport', 'Add to applications'),
  ]

  return (
    <div className="discover-decision-workspace">
      <ol className="discover-flow" aria-label={tx('discover.flowTitle', 'Discover workflow')}>
        {stageItems.map((label, index) => (
          <li key={label} className={clsx(index < step && 'done', index === step && 'active')}>
            <span>{index < step ? <CheckCircle2 size={13} /> : index + 1}</span>
            <strong>{label}</strong>
            {index < stageItems.length - 1 ? <ArrowRight size={13} aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>

      <section className="discover-next-action" aria-labelledby="discover-next-title">
        <div className="discover-next-icon"><Sparkles size={17} aria-hidden="true" /></div>
        <div>
          <h3 id="discover-next-title">{tx('discover.nextActionTitle', 'Your next best action')}</h3>
          <p>
            {!state.intakeCompleted
              ? tx('discover.nextActionCriteria', 'Set your field, regions and funding floor so the ranking reflects your priorities.')
              : !state.lastResearchAt
                ? tx('discover.nextActionResearch', 'Run the research flow once to refresh program, advisor and funding evidence.')
                : watchedCount === 0
                  ? tx('discover.nextActionWatch', 'Review the top matches and watch 3–5 serious candidates before starting applications.')
                  : nearest
                    ? format(tx('discover.nextActionDeadline', 'Your nearest visible deadline is in {days} days. Verify it and prepare the required materials.'), { days: nearest.days ?? 0 })
                    : tx('discover.nextActionImport', 'Your shortlist is ready. Add a program to the application workspace and begin the checklist.')}
          </p>
          <ul>
            <li><CheckCircle2 size={13} /> {tx('discover.nextCheckAdvisor', 'Confirm at least two fitting advisors')}</li>
            <li><CheckCircle2 size={13} /> {tx('discover.nextCheckEvidence', 'Open official funding and deadline sources')}</li>
            <li><CheckCircle2 size={13} /> {tx('discover.nextCheckImport', 'Import only when the evidence is good enough')}</li>
          </ul>
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={researching}
          onClick={!state.intakeCompleted ? onConfigure : onResearch}
        >
          {researching ? <Radar size={14} className="spin-icon" /> : <ArrowRight size={14} />}
          {!state.intakeCompleted ? tx('discover.configureNow', 'Set criteria') : tx('discover.runResearch')}
        </button>
      </section>

      <div className="discover-decision-layout">
        <section className="discover-shortlist-panel" aria-labelledby="discover-shortlist-title">
          <header className="discover-section-heading">
            <div>
              <h3 id="discover-shortlist-title">{tx('discover.shortlistTitle', 'Ranked candidates')}</h3>
              <p>{format(tx('discover.shortlistHint', '{count} visible programs, ranked for your current priorities.'), { count: visible.length })}</p>
            </div>
            <button type="button" className="quiet-action" onClick={() => onOpenProgram(selected.id)}>
              {tx('discover.viewAllPrograms', 'View all')}
              <ArrowRight size={14} />
            </button>
          </header>
          <div className="discover-shortlist-table" role="list">
            {topPrograms.map((program, index) => {
              const deadline = deadlineFor(program)
              const days = daysUntilIso(deadline)
              const evidence = evidenceFor(program)
              const active = program.id === selected.id
              return (
                <article
                  key={program.id}
                  className={clsx('discover-shortlist-row', active && 'selected')}
                  role="listitem"
                  style={{ animationDelay: `${index * 45}ms` }}
                >
                  <button
                    type="button"
                    className="discover-shortlist-select"
                    aria-pressed={active}
                    onClick={() => setSelectedId(program.id)}
                  >
                    <span className="discover-shortlist-rank">{index + 1}</span>
                    <span className="discover-shortlist-identity">
                      <strong>{program.school}</strong>
                      <small>{program.program} · {program.city}</small>
                    </span>
                    <span className="discover-shortlist-match">
                      <strong>{program.matchScore}</strong>
                      <small>{tx('discover.matchShort', 'match')}</small>
                    </span>
                    <span className="discover-shortlist-money">
                      <strong>{money(program.realStipendUSD)}</strong>
                      <small>{tx('discover.realShort', 'real / yr')}</small>
                    </span>
                    <span className={clsx('discover-shortlist-deadline', deadlineUrgencyClass(days))}>
                      <strong>{days == null ? '—' : format(tx('discover.daysShort', '{days}d'), { days })}</strong>
                      <small>{deadline || tx('discover.unverified', 'Unverified')}</small>
                    </span>
                    <span className="discover-shortlist-evidence">
                      <i className={clsx(evidence.score >= 75 ? 'good' : evidence.score >= 50 ? 'medium' : 'low')} />
                      <strong>{evidence.score}%</strong>
                      <small>{tx('discover.evidenceShort', 'evidence')}</small>
                    </span>
                  </button>
                  <div className="discover-shortlist-actions">
                    <button
                      type="button"
                      className={clsx('discover-row-icon', program.watched && 'active')}
                      aria-label={program.watched ? tx('discover.unwatch') : tx('discover.watch')}
                      aria-pressed={program.watched}
                      onClick={() => onToggleWatch(program.id)}
                    >
                      {program.watched ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                    </button>
                    <button
                      type="button"
                      className="secondary-action discover-row-import"
                      disabled={importingId === program.id}
                      onClick={() => onImportProgram(program.id)}
                    >
                      <Plus size={14} />
                      {tx('discover.import')}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <aside className="discover-selection-inspector" aria-label={tx('discover.selectedProgramGuide', 'Selected program guide')}>
          <header>
            <div>
              <span>{tx('discover.selectedProgram', 'Selected program')}</span>
              <h3>{selected.school}</h3>
              <p>{selected.program}</p>
            </div>
            <button type="button" className="discover-row-icon" onClick={() => onOpenProgram(selected.id)} aria-label={tx('discover.expand')}>
              <ExternalLink size={15} />
            </button>
          </header>

          <DisclosureSection
            id="discover-inspector-meaning"
            title={tx('discover.inspectorWhat', 'What you are seeing')}
            summary={selected.fitRationale || tx('discover.fitRationale')}
            open={inspectorSection === 'meaning'}
            onToggle={() => setInspectorSection(inspectorSection === 'meaning' ? null : 'meaning')}
          >
            <p>{selected.fitRationale}</p>
            <div className="discover-inspector-facts">
              <span><Target size={13} /> {format(tx('discover.matchScore'), { score: selected.matchScore })}</span>
              <span><WalletCards size={13} /> {money(selected.realStipendUSD)}</span>
              <span><ListChecks size={13} /> {format(tx('discover.viewPis'), { count: selected.fittingPiCount ?? 0 })}</span>
            </div>
          </DisclosureSection>

          <DisclosureSection
            id="discover-inspector-evidence"
            title={tx('discover.inspectorWhy', 'Why it matters')}
            summary={format(tx('discover.evidenceScore', '{score}% evidence complete'), { score: selectedEvidence?.score ?? 0 })}
            open={inspectorSection === 'evidence'}
            onToggle={() => setInspectorSection(inspectorSection === 'evidence' ? null : 'evidence')}
          >
            <p>{tx('discover.inspectorWhyBody', 'Match is useful only when funding, deadlines and advisor availability can be checked. Missing evidence is shown instead of guessed.')}</p>
            <div className="discover-evidence-meter" aria-label={format(tx('discover.evidenceScore', '{score}% evidence complete'), { score: selectedEvidence?.score ?? 0 })}>
              <span style={{ width: `${selectedEvidence?.score ?? 0}%` }} />
            </div>
            {selectedEvidence?.missing.length ? (
              <p className="discover-missing-copy">
                <CircleAlert size={13} />
                {format(tx('discover.missingEvidence', 'Needs review: {items}'), { items: selectedEvidence.missing.join(', ') })}
              </p>
            ) : null}
          </DisclosureSection>

          <DisclosureSection
            id="discover-inspector-next"
            title={tx('discover.inspectorNext', 'Recommended next step')}
            summary={tx('discover.inspectorNextSummary', 'Verify, watch, then add to applications')}
            open={inspectorSection === 'next'}
            onToggle={() => setInspectorSection(inspectorSection === 'next' ? null : 'next')}
          >
            <ol className="discover-next-list">
              <li>{tx('discover.inspectorStepSources', 'Open the official program and funding sources.')}</li>
              <li>{tx('discover.inspectorStepAdvisor', 'Check recent work from the best-fitting advisors.')}</li>
              <li>{tx('discover.inspectorStepImport', 'Add the program when you are ready to start its checklist.')}</li>
            </ol>
            <div className="discover-detail-actions">
              <button type="button" className="secondary-action" onClick={() => onToggleWatch(selected.id)}>
                {selected.watched ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                {selected.watched ? tx('discover.unwatch') : tx('discover.watch')}
              </button>
              <button type="button" className="primary-action" onClick={() => onImportProgram(selected.id)}>
                <Plus size={14} /> {tx('discover.import')}
              </button>
            </div>
          </DisclosureSection>
        </aside>
      </div>

      <section className="discover-analysis-section" aria-labelledby="discover-analysis-title">
        <header className="discover-section-heading">
          <div>
            <h3 id="discover-analysis-title">{tx('discover.decisionAnalysisTitle', 'Decision analysis')}</h3>
            <p>{tx('discover.decisionAnalysisHint', 'Open one view at a time. Every chart explains what it shows and what action it supports.')}</p>
          </div>
          <span className="discover-analysis-count">3</span>
        </header>

        <DisclosureSection
          id="discover-tradeoff-view"
          title={tx('discover.tradeoffTitle', 'Match and real purchasing power')}
          summary={tx('discover.tradeoffSummary', 'Find programs that are strong on both fit and after-cost funding.')}
          open={openView === 'tradeoff'}
          onToggle={() => setOpenView(openView === 'tradeoff' ? null : 'tradeoff')}
        >
          <div className="discover-chart-layout">
            <svg
              className="discover-tradeoff-chart"
              viewBox="0 0 560 270"
              role="img"
              aria-label={tx('discover.tradeoffAria', 'Scatter plot comparing match score and cost-of-living adjusted stipend')}
            >
              <line x1="48" y1="224" x2="536" y2="224" className="discover-chart-axis" />
              <line x1="48" y1="20" x2="48" y2="224" className="discover-chart-axis" />
              <text x="48" y="250" className="discover-chart-label">{tx('discover.matchAxis', 'Match →')}</text>
              <text x="12" y="16" className="discover-chart-label">{tx('discover.realAxis', 'Real / yr')}</text>
              {[25, 50, 75, 100].map((tick) => (
                <g key={tick}>
                  <line x1={48 + tick * 4.75} x2={48 + tick * 4.75} y1="20" y2="224" className="discover-chart-grid" />
                  <text x={48 + tick * 4.75} y="242" textAnchor="middle" className="discover-chart-tick">{tick}</text>
                </g>
              ))}
              {tradeoffRows.map((program, index) => {
                const x = 48 + (program.matchScore / 100) * 475
                const y = 224 - ((program.realStipendUSD || 0) / maxReal) * 190
                const active = selected.id === program.id
                return (
                  <g
                    key={program.id}
                    className={clsx('discover-chart-point', active && 'selected')}
                    role="button"
                    tabIndex={0}
                    aria-label={`${program.school}, ${format(tx('discover.matchScore'), { score: program.matchScore })}, ${money(program.realStipendUSD)}`}
                    onClick={() => setSelectedId(program.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedId(program.id)
                      }
                    }}
                    style={{ animationDelay: `${index * 28}ms` }}
                  >
                    <circle cx={x} cy={y} r={active ? 7 : 4.5} />
                    {active ? <text x={x + 10} y={y - 8} className="discover-chart-direct-label">{program.school}</text> : null}
                  </g>
                )
              })}
            </svg>
            <div className="discover-chart-explanation">
              <strong>{selected.school}</strong>
              <p>{format(tx('discover.tradeoffSelected', 'Match {match}; real purchasing power {money} per year.'), { match: selected.matchScore, money: money(selected.realStipendUSD) })}</p>
              <Guide
                what={tx('discover.tradeoffWhat', 'Each dot is one program. Right means a stronger match; higher means more spending power after local costs.')}
                how={tx('discover.tradeoffHow', 'Programs near the upper-right offer the strongest balance. A lower-left dot is not automatically bad, but it needs a clear reason to keep.')}
                next={tx('discover.tradeoffNext', 'Select a dot, inspect its evidence, then watch only the options that still make sense after verification.')}
              />
            </div>
          </div>
        </DisclosureSection>

        <DisclosureSection
          id="discover-deadline-view"
          title={tx('discover.deadlineRunwayTitle', 'Deadline runway')}
          summary={nearest
            ? format(tx('discover.deadlineRunwaySummary', 'The nearest visible deadline is in {days} days.'), { days: nearest.days ?? 0 })
            : tx('discover.deadlineRunwayEmpty', 'No dated deadlines are available yet.')}
          open={openView === 'deadline'}
          onToggle={() => setOpenView(openView === 'deadline' ? null : 'deadline')}
        >
          <div className="discover-runway-layout">
            <div className="discover-runway" role="img" aria-label={tx('discover.deadlineRunwayAria', 'Upcoming program deadlines over the next 120 days')}>
              <div className="discover-runway-axis">
                <span>{tx('discover.today', 'Today')}</span>
                <span>30d</span><span>60d</span><span>90d</span><span>120d</span>
              </div>
              {deadlineRows.map(({ program, deadline, days }) => {
                const position = Math.min(100, Math.max(0, ((days || 0) / 120) * 100))
                return (
                  <button
                    key={program.id}
                    type="button"
                    className={clsx('discover-runway-row', selected.id === program.id && 'selected')}
                    onClick={() => setSelectedId(program.id)}
                  >
                    <span className="discover-runway-name">{program.school}</span>
                    <span className="discover-runway-track">
                      <i style={{ width: `${position}%` }} />
                      <b className={deadlineUrgencyClass(days)} style={{ left: `${position}%` }} />
                    </span>
                    <span className="discover-runway-date">{dateFormatter.format(new Date(`${deadline}T00:00:00`))}</span>
                  </button>
                )
              })}
            </div>
            <Guide
              what={tx('discover.deadlineWhat', 'Each row ends at a program deadline. Shorter lines need attention sooner.')}
              how={tx('discover.deadlineHow', 'Red is urgent, orange is approaching, and green has more runway. These dates are snapshots until officially verified.')}
              next={tx('discover.deadlineNext', 'Verify the nearest dates first, then add material reminders after importing the program.')}
            />
          </div>
        </DisclosureSection>

        <DisclosureSection
          id="discover-evidence-view"
          title={tx('discover.evidenceHealthTitle', 'Evidence completeness')}
          summary={format(tx('discover.evidenceHealthSummary', 'Average evidence completeness is {score}% across visible programs.'), { score: evidenceAverage })}
          open={openView === 'evidence'}
          onToggle={() => setOpenView(openView === 'evidence' ? null : 'evidence')}
        >
          <div className="discover-evidence-layout">
            <div className="discover-evidence-list" role="list">
              {evidenceRows.slice(0, 7).map(({ program, evidence }) => (
                <button
                  key={program.id}
                  type="button"
                  className={clsx('discover-evidence-row', selected.id === program.id && 'selected')}
                  onClick={() => setSelectedId(program.id)}
                >
                  <span>{program.school}</span>
                  <span className="discover-evidence-bar"><i style={{ width: `${evidence.score}%` }} /></span>
                  <strong>{evidence.score}%</strong>
                  <small>{evidence.missing.length ? evidence.missing.slice(0, 2).join(', ') : tx('discover.evidenceReady', 'Ready to review')}</small>
                </button>
              ))}
            </div>
            <div>
              <div className="discover-evidence-legend" aria-hidden="true">
                <span><i className="good" />{tx('discover.evidenceOfficial', 'Present / official')}</span>
                <span><i className="review" />{tx('discover.evidenceReview', 'Needs review')}</span>
              </div>
              <Guide
                what={tx('discover.evidenceWhat', 'The bar measures whether sources, funding, deadline, restrictions and advisor links are available—not whether admission is likely.')}
                how={tx('discover.evidenceHow', 'A fuller bar means fewer unknowns. It never turns an estimate into an official fact.')}
                next={tx('discover.evidenceNext', 'Open the selected program, resolve the missing items, then import only the evidence you trust.')}
              />
            </div>
          </div>
        </DisclosureSection>

        <footer className="discover-analysis-caveat">
          <Info size={13} aria-hidden="true" />
          {tx('discover.analysisCaveat', 'These views describe the current catalog and your saved preferences. They are decision aids, not admissions predictions.')}
        </footer>
      </section>
    </div>
  )
}
