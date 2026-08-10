import {
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bookmark,
  Braces,
  CircleAlert,
  CircleDollarSign,
  Database,
  ExternalLink,
  FileDown,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  phdApi,
  type AdmissionDiscussionRecord,
  type AdmissionBookmark,
  type AdmissionCycleSummary,
  type AdmissionExploreLink,
  type AdmissionInsights,
  type AdmissionOfficialFact,
  type AdmissionOfficialPage,
  type AdmissionOutcomeRecord,
  type AdmissionSignalReport,
  type AdmissionSourceReport,
  type AdvisorRecord,
  type AiKey,
} from '../../api/phdApi'
import { localeForLanguage, type Language } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import '../../styles/admissions.css'
import '../../styles/admissionsSignals.css'

type AdmissionSignalsPanelProps = {
  token: string
  applicationId: string
  /** Passing a key adds the AI reading of the records; omitting it skips it. */
  aiKeyId?: string | null
  aiKeys?: AiKey[]
}

type Tx = (key: string, fallback?: string) => string
type Format = (template: string, values: Record<string, string | number>) => string
type OutcomeFilter = 'all' | 'accepted' | 'rejected' | 'waitlisted' | 'interview' | 'pending'

type BookmarkCandidate = {
  type: AdmissionBookmark['type']
  title: string
  data: Record<string, unknown>
}

function formatFetchedAt(value: string | undefined, lang: Language) {
  if (!value) return ''
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  try {
    return new Intl.DateTimeFormat(localeForLanguage(lang), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed)
  } catch {
    return value
  }
}

function formatUsd(value: unknown, lang: Language) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  try {
    return new Intl.NumberFormat(localeForLanguage(lang), {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return String(value)
  }
}

function decisionLabel(decision: string, tx: Tx) {
  const normalized = decision.trim().toLowerCase().replace(/\s+/g, ' ')
  if (normalized === 'accepted' || normalized === 'admitted') return tx('dossier.admissions.accepted')
  if (normalized === 'rejected') return tx('dossier.admissions.rejected')
  if (normalized === 'waitlisted' || normalized === 'wait listed') {
    return tx('dossier.admissions.waitlisted')
  }
  if (normalized === 'interview') return tx('dossier.admissions.interview')
  if (normalized === 'pending') return tx('dossier.admissions.pending')
  if (normalized === 'unclassified') return tx('dossier.admissions.unclassified')
  return decision
}

function decisionKey(decision: string): Exclude<OutcomeFilter, 'all'> | 'unclassified' {
  const normalized = decision.trim().toLowerCase().replace(/\s+/g, ' ')
  if (normalized === 'accepted' || normalized === 'admitted') return 'accepted'
  if (normalized === 'rejected') return 'rejected'
  if (normalized === 'waitlisted' || normalized === 'wait listed') return 'waitlisted'
  if (normalized === 'interview') return 'interview'
  if (normalized === 'pending') return 'pending'
  return 'unclassified'
}

function recordCycle(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? String(new Date(timestamp).getUTCFullYear()) : 'unknown'
}

function summarizeCycles(records: AdmissionOutcomeRecord[]): AdmissionCycleSummary[] {
  const byCycle = new Map<string, AdmissionOutcomeRecord[]>()
  for (const record of records) {
    const cycle = recordCycle(record.value.date)
    const rows = byCycle.get(cycle) ?? []
    rows.push(record)
    byCycle.set(cycle, rows)
  }
  return [...byCycle.entries()].map(([cycle, rows]) => {
    const counts = {
      total: rows.length,
      accepted: 0,
      rejected: 0,
      waitlisted: 0,
      interview: 0,
      pending: 0,
      unclassified: 0,
    }
    let latestDecisionAt: string | null = null
    for (const row of rows) {
      counts[decisionKey(row.value.decision)] += 1
      const timestamp = Date.parse(row.value.date)
      if (Number.isFinite(timestamp) && (!latestDecisionAt || timestamp > Date.parse(latestDecisionAt))) {
        latestDecisionAt = new Date(timestamp).toISOString()
      }
    }
    const decided = counts.accepted + counts.rejected + counts.waitlisted
    return {
      cycle,
      ...counts,
      latestDecisionAt,
      acceptedShare: decided >= 4 ? Number((counts.accepted / decided).toFixed(3)) : null,
    }
  }).sort((left, right) => {
    if (left.cycle === 'unknown') return 1
    if (right.cycle === 'unknown') return -1
    return Number(right.cycle) - Number(left.cycle)
  })
}

function bookmarkRecordKey(type: AdmissionBookmark['type'], sourceUrl: string, title: string) {
  return `${type}:${sourceUrl || title}`
}

function storedBookmarkKey(bookmark: AdmissionBookmark) {
  return typeof bookmark.data?.recordKey === 'string'
    ? bookmark.data.recordKey
    : bookmarkRecordKey(bookmark.type, String(bookmark.data?.sourceUrl || ''), bookmark.title)
}

function BookmarkButton({
  active,
  busy,
  label,
  onClick,
}: {
  active: boolean
  busy: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`admissions-bookmark-action${active ? ' is-active' : ''}`}
      aria-pressed={active}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
    >
      <Bookmark size={14} fill={active ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  )
}

function sourceStatusClass(status: AdmissionSourceReport['status']) {
  if (status === 'error') return 'is-error'
  if (status === 'disabled') return 'is-disabled'
  if (status === 'not-configured') return 'is-not-configured'
  if (status === 'empty') return 'is-empty'
  return 'is-success'
}

function sourceStatusLabelKey(status: AdmissionSourceReport['status']) {
  return status === 'not-configured' ? 'notConfigured' : status
}

/**
 * The evidence tying one record to the person or programme that was asked
 * about. Shown on every record, because "we found this" and "this is theirs"
 * are different claims and the panel used to make only the first while
 * displaying the second.
 */
function MatchBadge({ match, tx }: { match: AdmissionOutcomeRecord['match']; tx: Tx }) {
  if (!match) return null
  const key = match.verified
    ? match.nameMatch === 'exact' || match.schoolMatch
      ? 'confirmed'
      : 'likely'
    : 'unconfirmed'
  return (
    <span className={`admissions-match-badge ${key}`} title={match.reasons.join(' · ')}>
      {match.verified ? <BadgeCheck size={11} aria-hidden="true" /> : <CircleAlert size={11} aria-hidden="true" />}
      {tx(`dossier.admissions.match.${key}`)}
    </span>
  )
}

/**
 * Provenance, ordered the way somebody checking a claim wants it: the page the
 * record lives on, then places to keep looking, then the raw API response.
 * The raw JSON is deliberately last and visually quietest -- it used to be the
 * only thing a source link led to.
 */
function ProvenanceLinks({
  record,
  sourceName,
  lang,
  tx,
  format,
}: {
  record: { sourceUrl?: string; apiUrl?: string; sourceId?: string; fetchedAt: string }
  sourceName: string
  lang: Language
  tx: Tx
  format: Format
}) {
  const provenance = format(tx('dossier.admissions.provenance'), {
    source: sourceName || record.sourceId || '',
    date: formatFetchedAt(record.fetchedAt, lang),
  })
  return (
    <div className="admissions-provenance-row">
      {record.sourceUrl ? (
        <a className="admissions-provenance" href={record.sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={11} aria-hidden="true" />
          {provenance}
        </a>
      ) : (
        <span className="admissions-provenance">{provenance}</span>
      )}
      {record.apiUrl ? (
        <a
          className="admissions-raw-link"
          href={record.apiUrl}
          target="_blank"
          rel="noreferrer"
          title={tx('dossier.admissions.rawJsonHint')}
        >
          <Braces size={10} aria-hidden="true" />
          {tx('dossier.admissions.rawJson')}
        </a>
      ) : null}
    </div>
  )
}

function ExploreLinks({ links, title, tx }: { links: AdmissionExploreLink[]; title: string; tx: Tx }) {
  const searchLinks = links.filter((entry) => entry.kind === 'search')
  if (searchLinks.length === 0) return null
  return (
    <div className="admissions-explore">
      <span className="admissions-explore-label">{title}</span>
      <div className="admissions-explore-links">
        {searchLinks.map((entry) => (
          <a key={entry.id} href={entry.url} target="_blank" rel="noreferrer" className="admissions-explore-link">
            <Search size={11} aria-hidden="true" />
            {entry.label}
            <ArrowUpRight size={11} aria-hidden="true" />
          </a>
        ))}
      </div>
      <small>{tx('dossier.admissions.exploreHint')}</small>
    </div>
  )
}

function OutcomeTableRow({
  record,
  sourceName,
  lang,
  tx,
  format,
  bookmarked,
  bookmarkBusy,
  onBookmark,
}: {
  record: AdmissionOutcomeRecord
  sourceName: string
  lang: Language
  tx: Tx
  format: Format
  bookmarked: boolean
  bookmarkBusy: boolean
  onBookmark: () => void
}) {
  const decision = decisionKey(record.value.decision)
  return (
    <tr className="admissions-outcome-row admissions-reveal">
      <td data-label={tx('dossier.admissions.outcomeDate')}>
        <time>{record.value.date || '—'}</time>
      </td>
      <td data-label={tx('dossier.admissions.outcomeDecision')}>
        <span className={`admissions-decision is-${decision}`}>
          <span aria-hidden="true" />
          {decisionLabel(record.value.decision, tx)}
        </span>
      </td>
      <td data-label={tx('dossier.admissions.outcomeProgram')}>
        <strong>{record.value.program}</strong>
        <small>{record.value.school}</small>
      </td>
      <td data-label={tx('dossier.admissions.evidence', 'Evidence')}>
        <MatchBadge match={record.match} tx={tx} />
        <ProvenanceLinks record={record} sourceName={sourceName} lang={lang} tx={tx} format={format} />
      </td>
      <td className="admissions-row-action">
        <BookmarkButton
          active={bookmarked}
          busy={bookmarkBusy}
          label={tx(
            bookmarked ? 'dossier.admissions.bookmarks.remove' : 'dossier.admissions.bookmarks.add',
            bookmarked ? 'Remove bookmark' : 'Bookmark record',
          )}
          onClick={onBookmark}
        />
      </td>
    </tr>
  )
}

function DiscussionRow({
  record,
  sourceName,
  lang,
  tx,
  format,
  bookmarked,
  bookmarkBusy,
  onBookmark,
}: {
  record: AdmissionDiscussionRecord
  sourceName: string
  lang: Language
  tx: Tx
  format: Format
  bookmarked: boolean
  bookmarkBusy: boolean
  onBookmark: () => void
}) {
  let href = record.sourceUrl
  if (record.value.permalink) {
    try {
      href = new URL(record.value.permalink, 'https://www.reddit.com').toString()
    } catch {
      href = record.sourceUrl
    }
  }
  const meta = [
    typeof record.value.score === 'number' && Number.isFinite(record.value.score)
      ? String(record.value.score)
      : '',
    typeof record.value.numComments === 'number' && Number.isFinite(record.value.numComments)
      ? String(record.value.numComments)
      : '',
  ].filter(Boolean)
  return (
    <article className="admissions-discussion-row admissions-reveal">
      <a className="admissions-discussion-title" href={href} target="_blank" rel="noreferrer">
        <span>{record.value.title}</span>
        <ArrowUpRight size={13} aria-hidden="true" />
      </a>
      {meta.length > 0 ? <div className="admissions-discussion-meta">{meta.join(' · ')}</div> : null}
      <BookmarkButton
        active={bookmarked}
        busy={bookmarkBusy}
        label={tx(
          bookmarked ? 'dossier.admissions.bookmarks.remove' : 'dossier.admissions.bookmarks.add',
          bookmarked ? 'Remove bookmark' : 'Bookmark record',
        )}
        onClick={onBookmark}
      />
      <ProvenanceLinks
        record={{ ...record, sourceUrl: href }}
        sourceName={sourceName}
        lang={lang}
        tx={tx}
        format={format}
      />
    </article>
  )
}

function AdvisorRecordRow({
  record,
  sourceName,
  lang,
  tx,
  format,
  highlighted,
  bookmarked,
  bookmarkBusy,
  onBookmark,
}: {
  record: AdvisorRecord
  sourceName: string
  lang: Language
  tx: Tx
  format: Format
  highlighted?: boolean
  bookmarked: boolean
  bookmarkBusy: boolean
  onBookmark: () => void
}) {
  const value = record.value as {
    title?: string
    awardeeName?: string
    organizationName?: string
    piName?: string
    startDate?: string
    endDate?: string
    expDate?: string
    estimatedTotalAmt?: number | null
    awardAmount?: number | null
    publicationYear?: number | null
    citedByCount?: number | null
    role?: string
    status?: string
    leadFunder?: string
  }
  const amount = formatUsd(value.estimatedTotalAmt ?? value.awardAmount, lang)
  const meta = [
    value.piName || '',
    value.awardeeName || value.organizationName || '',
    value.startDate || '',
    value.endDate || value.expDate || '',
    value.publicationYear ? String(value.publicationYear) : '',
    typeof value.citedByCount === 'number'
      ? format(tx('dossier.admissions.citationCount', '{count} citations'), { count: value.citedByCount })
      : '',
    value.role || '',
    value.status || '',
    value.leadFunder || '',
    amount,
  ].filter(Boolean)
  return (
    <article className={`admissions-advisor-row admissions-reveal${highlighted ? ' is-highlighted' : ''}`}>
      <div className="admissions-advisor-row-main">
        <strong>{value.title || record.sourceId}</strong>
        {meta.length > 0 ? <span>{meta.join(' · ')}</span> : null}
      </div>
      {highlighted ? (
        <span className="admissions-relevance-tag">
          <Sparkles size={11} aria-hidden="true" />
          {tx('dossier.admissions.ai.relevantToYou')}
        </span>
      ) : null}
      <BookmarkButton
        active={bookmarked}
        busy={bookmarkBusy}
        label={tx(
          bookmarked ? 'dossier.admissions.bookmarks.remove' : 'dossier.admissions.bookmarks.add',
          bookmarked ? 'Remove bookmark' : 'Bookmark record',
        )}
        onClick={onBookmark}
      />
      <MatchBadge match={record.match} tx={tx} />
      <ProvenanceLinks record={record} sourceName={sourceName} lang={lang} tx={tx} format={format} />
    </article>
  )
}

function SourcesBlock({
  sources,
  tx,
  format,
}: {
  sources: AdmissionSourceReport[]
  tx: Tx
  format: Format
}) {
  if (sources.length === 0) return null
  return (
    <section className="admissions-sources" aria-label={tx('dossier.admissions.knownSources')}>
      <div className="admissions-section-heading">
        <Database size={15} aria-hidden="true" />
        <h4>{tx('dossier.admissions.knownSources')}</h4>
      </div>
      <div className="admissions-sources-list" role="list">
        {sources.map((source) => (
          <div
            key={source.id}
            className={`admissions-source-line ${sourceStatusClass(source.status)}`}
            role="listitem"
          >
            <span className="admissions-source-status-dot" aria-hidden="true" />
            <strong>{source.name}</strong>
            <span className="admissions-source-state">
              {tx(`dossier.admissions.sourceStatus.${sourceStatusLabelKey(source.status)}`, source.status)}
            </span>
            <span className="admissions-source-count">
              {source.verifiedCount === undefined
                ? format(tx('dossier.admissions.sourceRecordCount'), { count: source.recordCount ?? 0 })
                : format(tx('dossier.admissions.sourceVerifiedCount'), {
                    verified: source.verifiedCount,
                    total: source.recordCount ?? 0,
                  })}
            </span>
            {source.status === 'not-configured' ? (
              <small>
                {source.id === 'reddit-submissions'
                  ? tx('dossier.admissions.redditCredentials')
                  : tx('dossier.admissions.genericCredentials')}
              </small>
            ) : null}
            {source.status === 'error' && source.error?.message ? <small>{source.error.message}</small> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function InsightsBlock({
  insights,
  insightsError,
  tx,
}: {
  insights: AdmissionInsights | null
  insightsError: string | null
  tx: Tx
}) {
  if (insightsError) {
    return (
      <section className="admissions-section admissions-insights is-error">
        <div className="admissions-section-heading">
          <Sparkles size={15} aria-hidden="true" />
          <h4>{tx('dossier.admissions.ai.title')}</h4>
        </div>
        <p className="admissions-section-error" role="status">
          {tx('dossier.admissions.ai.failed')}
        </p>
      </section>
    )
  }
  if (!insights) return null
  const lists: Array<[string, string[]]> = [
    ['dossier.admissions.ai.talkingPoints', insights.talkingPoints],
    ['dossier.admissions.ai.openQuestions', insights.openQuestions],
  ]
  return (
    <section className="admissions-section admissions-insights admissions-reveal">
      <div className="admissions-section-heading">
        <Sparkles size={15} aria-hidden="true" />
        <h4>{tx('dossier.admissions.ai.title')}</h4>
        <span className={`admissions-confidence ${insights.fundingConfidence}`}>
          {tx(`dossier.admissions.ai.confidence.${insights.fundingConfidence}`)}
        </span>
      </div>
      <p className="admissions-insights-note">{tx('dossier.admissions.ai.disclaimer')}</p>
      {insights.fundingOutlook ? (
        <div className="admissions-insight-block">
          <strong>{tx('dossier.admissions.ai.fundingOutlook')}</strong>
          <p>{insights.fundingOutlook}</p>
        </div>
      ) : null}
      {insights.profileFit ? (
        <div className="admissions-insight-block">
          <strong>{tx('dossier.admissions.ai.profileFit')}</strong>
          <p>{insights.profileFit}</p>
        </div>
      ) : null}
      {insights.outcomeReading ? (
        <div className="admissions-insight-block">
          <strong>{tx('dossier.admissions.ai.outcomeReading')}</strong>
          <p>{insights.outcomeReading}</p>
        </div>
      ) : null}
      {lists.map(([key, items]) =>
        items.length > 0 ? (
          <div className="admissions-insight-block" key={key}>
            <strong>{tx(key)}</strong>
            <ul>
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {insights.mismatchedIndexes.length > 0 ? (
        <div className="admissions-insight-block admissions-insight-warning">
          <TriangleAlert size={13} aria-hidden="true" />
          <div>
            <strong>{tx('dossier.admissions.ai.mismatched')}</strong>
            <ul>
              {insights.mismatchedIndexes.map((entry) => (
                <li key={`${entry.kind}:${entry.index}`}>{entry.reason || entry.kind}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function OfficialEvidenceBlock({
  facts,
  pages,
  sourceName,
  lang,
  tx,
  format,
}: {
  facts: AdmissionOfficialFact[]
  pages: AdmissionOfficialPage[]
  sourceName: string
  lang: Language
  tx: Tx
  format: Format
}) {
  if (facts.length === 0 && pages.length === 0) return null
  return (
    <section className="admissions-official-evidence" aria-label={tx('dossier.admissions.evidence', 'Evidence')}>
      <div className="admissions-section-heading">
        <BadgeCheck size={15} aria-hidden="true" />
        <h4>{tx('dossier.admissions.knownSources')}</h4>
        <span className="admissions-count">{facts.length}</span>
      </div>
      {facts.length > 0 ? (
        <div className="admissions-table-scroll">
          <table className="admissions-official-facts">
            <thead>
              <tr>
                <th>{tx('dossier.admissions.officialMetric', 'Official metric')}</th>
                <th>{tx('dossier.admissions.officialStatement', 'Published statement')}</th>
                <th>{tx('dossier.admissions.evidence', 'Evidence')}</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((fact, index) => (
                <tr key={`${fact.sourceUrl}:${fact.value.factType}:${fact.value.year ?? ''}:${index}`}>
                  <td data-label={tx('dossier.admissions.officialMetric', 'Official metric')}>
                    <strong>{fact.value.unit === 'percent' ? `${fact.value.value}%` : fact.value.value}</strong>
                    <span>{fact.value.label}{fact.value.year ? ` · ${fact.value.year}` : ''}</span>
                  </td>
                  <td data-label={tx('dossier.admissions.officialStatement', 'Published statement')}>
                    <p>{fact.value.statement}</p>
                  </td>
                  <td data-label={tx('dossier.admissions.evidence', 'Evidence')}>
                    <ProvenanceLinks record={fact} sourceName={sourceName} lang={lang} tx={tx} format={format} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {pages.length > 0 ? (
        <details className="admissions-official-pages">
          <summary>
            {tx('dossier.admissions.knownSources')}
            <span>{pages.length}</span>
          </summary>
          <div>
            {pages.map((page) => (
              <a href={page.url} target="_blank" rel="noreferrer" key={page.url}>
                <span>{page.title || page.url}</span>
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

const CYCLE_SEGMENTS: Array<{
  key: 'accepted' | 'rejected' | 'waitlisted' | 'interview' | 'pending' | 'unclassified'
  labelKey: string
}> = [
  { key: 'accepted', labelKey: 'dossier.admissions.accepted' },
  { key: 'rejected', labelKey: 'dossier.admissions.rejected' },
  { key: 'waitlisted', labelKey: 'dossier.admissions.waitlisted' },
  { key: 'interview', labelKey: 'dossier.admissions.interview' },
  { key: 'pending', labelKey: 'dossier.admissions.pending' },
  { key: 'unclassified', labelKey: 'dossier.admissions.unclassified' },
]

function AdmissionCycleChart({
  cycles,
  tx,
  format,
}: {
  cycles: AdmissionCycleSummary[]
  tx: Tx
  format: Format
}) {
  const datedCycles = cycles.filter((cycle) => cycle.cycle !== 'unknown' && cycle.total > 0)
  if (datedCycles.length === 0) return null
  return (
    <figure className="admissions-cycle-chart" aria-label={tx('dossier.admissions.trends.title')}>
      <figcaption>
        <span>
          <BarChart3 size={14} aria-hidden="true" />
          <strong>{tx('dossier.admissions.trends.title')}</strong>
        </span>
        <small>{tx('dossier.admissions.trends.caveat', 'Applicant-reported sample, not an official acceptance rate.')}</small>
      </figcaption>
      <div className="admissions-cycle-rows">
        {datedCycles.map((cycle) => (
          <div className="admissions-cycle-row" key={cycle.cycle}>
            <div className="admissions-cycle-label">
              <strong>{cycle.cycle}</strong>
              <span>
                {format(tx('dossier.admissions.trends.verifiedSample', '{count} verified'), {
                  count: cycle.total,
                })}
              </span>
            </div>
            <div className="admissions-cycle-track">
              {CYCLE_SEGMENTS.map(({ key, labelKey }) => {
                const count = cycle[key]
                if (!count) return null
                const label = tx(labelKey)
                return (
                  <span
                    key={key}
                    className={`admissions-cycle-segment is-${key}`}
                    style={{ flexGrow: count }}
                    title={`${label}: ${count}`}
                    aria-label={`${label}: ${count}`}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="admissions-cycle-legend" aria-hidden="true">
        {CYCLE_SEGMENTS.map(({ key, labelKey }) => (
          <span key={key}>
            <i className={`is-${key}`} />
            {tx(labelKey)}
          </span>
        ))}
      </div>
    </figure>
  )
}

function BookmarksDisclosure({
  bookmarks,
  busyKey,
  lang,
  tx,
  onRemove,
}: {
  bookmarks: AdmissionBookmark[]
  busyKey: string | null
  lang: Language
  tx: Tx
  onRemove: (bookmark: AdmissionBookmark) => void
}) {
  if (bookmarks.length === 0) return null
  return (
    <details className="admissions-bookmarks">
      <summary>
        <Bookmark size={14} aria-hidden="true" />
        <span>{tx('dossier.admissions.bookmarks.title')}</span>
        <span className="admissions-count">{bookmarks.length}</span>
      </summary>
      <div className="admissions-bookmark-list">
        {bookmarks.map((bookmark) => (
          <div className="admissions-bookmark-row" key={bookmark.id}>
            <div>
              <strong>{bookmark.title}</strong>
              {bookmark.note ? <p>{bookmark.note}</p> : null}
              <small>{formatFetchedAt(bookmark.createdAt, lang)}</small>
            </div>
            <button
              type="button"
              className="admissions-text-action"
              disabled={busyKey === storedBookmarkKey(bookmark)}
              onClick={() => onRemove(bookmark)}
            >
              {tx('dossier.admissions.bookmarks.remove', 'Remove')}
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

export function AdmissionSignalsPanel({
  token,
  applicationId,
  aiKeyId = null,
  aiKeys = [],
}: AdmissionSignalsPanelProps) {
  const { tx, format, lang } = useI18n()
  const abortRef = useRef<AbortController | null>(null)
  const [report, setReport] = useState<AdmissionSignalReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [failed, setFailed] = useState(false)
  const [staleReport, setStaleReport] = useState(false)
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all')
  const [bookmarks, setBookmarks] = useState<AdmissionBookmark[]>([])
  const [bookmarkBusyKey, setBookmarkBusyKey] = useState<string | null>(null)
  const [bookmarkFailed, setBookmarkFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    phdApi
      .getAdmissionBookmarks(token, applicationId)
      .then((data) => {
        if (!cancelled) setBookmarks(data)
      })
      .catch(() => {
        if (!cancelled) setBookmarks([])
      })
    return () => {
      cancelled = true
    }
  }, [token, applicationId])

  const handleDeleteBookmark = async (bookmark: AdmissionBookmark) => {
    const key = storedBookmarkKey(bookmark)
    if (bookmarkBusyKey) return
    setBookmarkBusyKey(key)
    setBookmarkFailed(false)
    try {
      await phdApi.deleteAdmissionBookmark(token, bookmark.id)
      setBookmarks((previous) => previous.filter((entry) => entry.id !== bookmark.id))
    } catch {
      setBookmarkFailed(true)
    } finally {
      setBookmarkBusyKey(null)
    }
  }

  const toggleBookmark = async (candidate: BookmarkCandidate) => {
    const key = String(candidate.data.recordKey || '')
    if (!key || bookmarkBusyKey) return
    const existing = bookmarks.find((bookmark) => storedBookmarkKey(bookmark) === key)
    if (existing) {
      await handleDeleteBookmark(existing)
      return
    }
    setBookmarkBusyKey(key)
    setBookmarkFailed(false)
    try {
      const id = await phdApi.createAdmissionBookmark(token, {
        applicationId,
        ...candidate,
      })
      const now = new Date().toISOString()
      setBookmarks((previous) => [{
        id,
        applicationId,
        type: candidate.type,
        title: candidate.title,
        data: candidate.data,
        note: null,
        createdAt: now,
        updatedAt: now,
      }, ...previous])
    } catch {
      setBookmarkFailed(true)
    } finally {
      setBookmarkBusyKey(null)
    }
  }


  // The saved report is what turns an empty panel into last week's answer, and
  // it is what decides whether the button says "query" or "update".
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setRestoring(true)
    setReport(null)
    setStaleReport(false)
    setFailed(false)
    phdApi
      .getAdmissionSignalReport(token, applicationId, { signal: controller.signal })
      .then((result) => {
        if (!cancelled) {
          setReport(result.report)
          setStaleReport(result.stale === true)
        }
      })
      .catch(() => {
        // A missing saved report is not an error worth showing: the panel just
        // offers to run the lookup.
      })
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [applicationId, token])

  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const resolvedKeyId = aiKeyId && aiKeys.some((key) => key.id === aiKeyId && key.enabled !== false)
    ? aiKeyId
    : aiKeys.find((key) => key.enabled !== false)?.id ?? null

  const startQuery = async () => {
    if (loading) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setFailed(false)
    try {
      const result = await phdApi.refreshAdmissionSignalReport(
        token,
        applicationId,
        resolvedKeyId ? { keyId: resolvedKeyId } : {},
        { signal: controller.signal },
      )
      setReport(result.report)
      setStaleReport(false)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }

  const stopQuery = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
  }

  const advisor = report?.advisor ?? null
  const outcomes = report?.outcomes ?? null
  const insights = report?.insights ?? null

  const sourceNameById = useMemo(() => {
    const names = new Map<string, string>()
    for (const source of [...(outcomes?.sources ?? []), ...(advisor?.sources ?? [])]) {
      names.set(source.id, source.name)
    }
    return names
  }, [advisor, outcomes])

  const combinedSources = useMemo(() => {
    const byId = new Map<string, AdmissionSourceReport>()
    for (const source of [...(outcomes?.sources ?? []), ...(advisor?.sources ?? [])]) {
      byId.set(source.id, source)
    }
    return Array.from(byId.values())
  }, [advisor, outcomes])

  const relevantAwards = useMemo(
    () => new Set(insights?.relevantAwardIndexes ?? []),
    [insights],
  )
  const relevantProjects = useMemo(
    () => new Set(insights?.relevantProjectIndexes ?? []),
    [insights],
  )
  const relevantWorks = useMemo(
    () => new Set(insights?.relevantWorkIndexes ?? []),
    [insights],
  )

  const summary = outcomes?.summary
  const acceptedShare =
    summary && summary.acceptedShare !== null && summary.acceptedShare !== undefined
      ? summary.acceptedShare
      : null
  const hasReport = Boolean(report)
  const sourceNameFor = (record: { sourceId?: string }) =>
    sourceNameById.get(record.sourceId ?? '') ?? record.sourceId ?? ''
  const cycles = useMemo(
    () => outcomes?.cycles?.length ? outcomes.cycles : summarizeCycles(outcomes?.outcomes ?? []),
    [outcomes],
  )
  const filteredOutcomes = useMemo(
    () => (outcomes?.outcomes ?? []).filter((record) => (
      outcomeFilter === 'all' || decisionKey(record.value.decision) === outcomeFilter
    )),
    [outcomeFilter, outcomes],
  )
  const bookmarkKeys = useMemo(
    () => new Set(bookmarks.map(storedBookmarkKey)),
    [bookmarks],
  )
  const bookmarkCandidateFor = (
    type: AdmissionBookmark['type'],
    title: string,
    record: { sourceUrl?: string; sourceId?: string; value?: unknown },
  ): BookmarkCandidate => {
    const recordKey = bookmarkRecordKey(type, record.sourceUrl ?? '', title)
    return {
      type,
      title,
      data: {
        recordKey,
        sourceUrl: record.sourceUrl ?? '',
        sourceId: record.sourceId ?? '',
        value: record.value ?? null,
      },
    }
  }

  const renderAdvisorRows = (
    records: AdvisorRecord[],
    highlighted: Set<number>,
    prefix: string,
  ) => records.map((record, index) => {
    const value = record.value as { title?: string }
    const title = value.title || record.sourceId
    const candidate = bookmarkCandidateFor('funding', title, record)
    const key = String(candidate.data.recordKey)
    return (
      <AdvisorRecordRow
        key={`${prefix}:${record.sourceUrl}:${index}`}
        record={record}
        sourceName={sourceNameFor(record)}
        lang={lang}
        tx={tx}
        format={format}
        highlighted={highlighted.has(index)}
        bookmarked={bookmarkKeys.has(key)}
        bookmarkBusy={bookmarkBusyKey === key}
        onBookmark={() => void toggleBookmark(candidate)}
      />
    )
  })

  return (
    <section className="admissions-panel" aria-label={tx('dossier.admissions.title')}>
      <header className="admissions-hero">
        <div className="admissions-hero-info">
          <span className="eyebrow">{tx('dossier.admissions.eyebrow')}</span>
          <h3>{tx('dossier.admissions.title')}</h3>
          <p>{tx('dossier.admissions.description')}</p>
          {report?.target ? (
            <small className="admissions-target">
              {format(tx('dossier.admissions.searchedFor'), {
                school: report.target.school || '—',
                program: report.target.program || '—',
                advisor: report.target.advisorName || '—',
              })}
            </small>
          ) : !hasReport ? <small>{tx('dossier.admissions.queryHint')}</small> : null}
          {report?.savedAt ? (
            <small className="admissions-saved-at">
              {format(tx('dossier.admissions.lastUpdated'), {
                date: formatFetchedAt(report.savedAt, lang),
              })}
            </small>
          ) : null}
        </div>
        <div className="admissions-query-actions">
          {hasReport ? (
            <button
              type="button"
              className="quiet-action compact-action admissions-export-action"
              onClick={phdApi.exportAdmissionReportToPdf}
            >
              <FileDown size={14} aria-hidden="true" />
              {tx('dossier.admissions.export.title')}
            </button>
          ) : null}
          {loading ? (
            <button type="button" className="quiet-action compact-action" onClick={stopQuery}>
              {tx('dossier.admissions.cancel')}
            </button>
          ) : (
            <button
              type="button"
              className="primary-action"
              onClick={() => void startQuery()}
              disabled={restoring}
            >
              {hasReport ? <RefreshCw size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
              {hasReport ? tx('dossier.admissions.updateButton') : tx('dossier.admissions.queryButton')}
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <div className="admissions-loading" role="status" aria-live="polite">
          <span><LoaderCircle className="spin-icon" size={16} aria-hidden="true" />
            {resolvedKeyId ? tx('dossier.admissions.loadingAi') : tx('dossier.admissions.loading')}
          </span>
          <div className="admissions-skeletons" aria-hidden="true">
            <span className="admissions-skeleton" />
            <span className="admissions-skeleton" />
            <span className="admissions-skeleton" />
          </div>
        </div>
      ) : null}

      {failed && !loading ? <p className="admissions-section-error" role="alert">{tx('dossier.admissions.queryFailed')}</p> : null}

      {staleReport && !loading ? (
        <p className="admissions-stale-report" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          {tx('dossier.admissions.staleReport', 'The saved evidence is for an earlier application target. Update results before using it.')}
        </p>
      ) : null}

      {!hasReport && !loading && !restoring ? (
        <div className="admissions-empty">
          <Database size={18} aria-hidden="true" />
          <div><strong>{tx('dossier.admissions.title')}</strong><p>{tx('dossier.admissions.description')}</p></div>
        </div>
      ) : null}

      {hasReport && !loading ? (
        <div className="admissions-sections" key={report?.fetchedAt}>
          {bookmarkFailed ? (
            <p className="admissions-section-error" role="status">
              {tx('dossier.admissions.bookmarks.failed', 'Could not update bookmarks. Try again.')}
            </p>
          ) : null}
          <BookmarksDisclosure
            bookmarks={bookmarks}
            busyKey={bookmarkBusyKey}
            lang={lang}
            tx={tx}
            onRemove={(bookmark) => void handleDeleteBookmark(bookmark)}
          />

          <section className="admissions-section admissions-reveal" aria-label={tx('dossier.admissions.outcomesTitle')}>
            <div className="admissions-section-heading">
              <Database size={15} aria-hidden="true" />
              <h4>{tx('dossier.admissions.outcomesTitle')}</h4>
              {summary?.total ? <span className="admissions-count">{summary.total}</span> : null}
            </div>
            {outcomes ? (
              <>
                {summary ? (
                  <div className="admissions-summary-strip">
                    <span><strong>{summary.total}</strong><small>{tx('dossier.admissions.trends.total')}</small></span>
                    <span><strong>{summary.accepted}</strong><small>{tx('dossier.admissions.accepted')}</small></span>
                    <span><strong>{summary.rejected}</strong><small>{tx('dossier.admissions.rejected')}</small></span>
                    <span><strong>{summary.waitlisted}</strong><small>{tx('dossier.admissions.waitlisted')}</small></span>
                    <span className="admissions-summary-share">
                      {acceptedShare === null ? (
                        <><strong>—</strong><small>{tx('dossier.admissions.sampleTooSmall')}</small></>
                      ) : (
                        <><strong>{Math.round(acceptedShare * 100)}%</strong><small>{tx('dossier.admissions.acceptedShare')}</small></>
                      )}
                    </span>
                  </div>
                ) : null}

                <OfficialEvidenceBlock
                  facts={outcomes.officialFacts ?? []}
                  pages={outcomes.officialPages ?? []}
                  sourceName={sourceNameById.get('official-program-history') ?? ''}
                  lang={lang}
                  tx={tx}
                  format={format}
                />

                <AdmissionCycleChart cycles={cycles} tx={tx} format={format} />

                {outcomes.outcomes.length === 0 ? (
                  <p className="admissions-section-empty">{tx('dossier.admissions.noOutcomes')}</p>
                ) : (
                  <>
                    <div className="admissions-filter-row" role="toolbar" aria-label={tx('dossier.admissions.outcomesTitle')}>
                      {([
                        ['all', tx('dossier.admissions.allResults', 'All'), summary?.total ?? 0],
                        ['accepted', tx('dossier.admissions.accepted'), summary?.accepted ?? 0],
                        ['rejected', tx('dossier.admissions.rejected'), summary?.rejected ?? 0],
                        ['waitlisted', tx('dossier.admissions.waitlisted'), summary?.waitlisted ?? 0],
                        ['interview', tx('dossier.admissions.interview'), summary?.interview ?? 0],
                      ] as Array<[OutcomeFilter, string, number]>).filter(([key, , count]) => key === 'all' || count > 0).map(([key, label, count]) => (
                        <button
                          type="button"
                          key={key}
                          className={outcomeFilter === key ? 'is-active' : ''}
                          aria-pressed={outcomeFilter === key}
                          onClick={() => setOutcomeFilter(key)}
                        >
                          {label}<span>{count}</span>
                        </button>
                      ))}
                    </div>
                    <div className="admissions-table-scroll">
                      <table className="admissions-outcomes-table">
                        <thead><tr>
                          <th>{tx('dossier.admissions.outcomeDate')}</th>
                          <th>{tx('dossier.admissions.outcomeDecision')}</th>
                          <th>{tx('dossier.admissions.outcomeProgram')}</th>
                          <th>{tx('dossier.admissions.evidence', 'Evidence')}</th>
                          <th><span className="sr-only">{tx('dossier.admissions.bookmarks.title')}</span></th>
                        </tr></thead>
                        <tbody>
                          {filteredOutcomes.map((record, index) => {
                            const title = `${record.value.school} · ${record.value.program} · ${decisionLabel(record.value.decision, tx)}`
                            const candidate = bookmarkCandidateFor('outcome', title, record)
                            const key = String(candidate.data.recordKey)
                            return (
                              <OutcomeTableRow
                                key={`${record.sourceUrl}:${index}`}
                                record={record}
                                sourceName={sourceNameFor(record)}
                                lang={lang}
                                tx={tx}
                                format={format}
                                bookmarked={bookmarkKeys.has(key)}
                                bookmarkBusy={bookmarkBusyKey === key}
                                onBookmark={() => void toggleBookmark(candidate)}
                              />
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {(outcomes.unmatchedOutcomes?.length ?? 0) > 0 ? (
                  <details className="admissions-unmatched">
                    <summary>{format(tx('dossier.admissions.unmatchedOutcomes'), { count: outcomes.unmatchedOutcomes?.length ?? 0 })}</summary>
                    <p className="admissions-unmatched-note">{tx('dossier.admissions.unmatchedHint')}</p>
                    <div className="admissions-table-scroll">
                      <table className="admissions-outcomes-table is-unmatched"><tbody>
                        {(outcomes.unmatchedOutcomes ?? []).map((record, index) => {
                          const title = `${record.value.school} · ${record.value.program} · ${decisionLabel(record.value.decision, tx)}`
                          const candidate = bookmarkCandidateFor('outcome', title, record)
                          const key = String(candidate.data.recordKey)
                          return (
                            <OutcomeTableRow
                              key={`unmatched:${record.sourceUrl}:${index}`}
                              record={record}
                              sourceName={sourceNameFor(record)}
                              lang={lang}
                              tx={tx}
                              format={format}
                              bookmarked={bookmarkKeys.has(key)}
                              bookmarkBusy={bookmarkBusyKey === key}
                              onBookmark={() => void toggleBookmark(candidate)}
                            />
                          )
                        })}
                      </tbody></table>
                    </div>
                  </details>
                ) : null}
              </>
            ) : <p className="admissions-section-empty">{tx('dossier.admissions.noProgramQuery')}</p>}
            <ExploreLinks links={report?.links.program ?? []} title={tx('dossier.admissions.exploreProgram')} tx={tx} />
          </section>

          <section className="admissions-section admissions-reveal" aria-label={tx('dossier.admissions.fundingTitle')}>
            <div className="admissions-section-heading">
              <CircleDollarSign size={15} aria-hidden="true" />
              <h4>{tx('dossier.admissions.fundingTitle')}</h4>
            </div>
            {advisor ? (
              <>
                <p className="admissions-funding-description">{tx('dossier.admissions.fundingDescription')}</p>
                <div className={`admissions-funding-status ${advisor.funding.hasPublicAward ? 'has-award' : 'no-award'}`}>
                  {advisor.funding.hasPublicAward ? <BadgeCheck size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
                  <span>{advisor.funding.hasPublicAward ? tx('dossier.admissions.hasPublicAward') : tx('dossier.admissions.noPublicAward')}</span>
                </div>
                <div className="admissions-advisor-subsections">
                  <div className="admissions-advisor-subsection">
                    <div className="admissions-advisor-subsection-head"><strong>{tx('dossier.admissions.awardsTitle')}</strong><span>{format(tx('dossier.admissions.awardCount'), { count: advisor.funding.awardCount })}</span></div>
                    {advisor.awards.length ? <div className="admissions-advisor-list">{renderAdvisorRows(advisor.awards, relevantAwards, 'award')}</div> : <p className="admissions-section-empty">{tx('dossier.admissions.noAwards')}</p>}
                  </div>
                  <div className="admissions-advisor-subsection">
                    <div className="admissions-advisor-subsection-head"><strong>{tx('dossier.admissions.projectsTitle')}</strong><span>{format(tx('dossier.admissions.projectCount'), { count: advisor.funding.projectCount })}</span></div>
                    {advisor.projects.length ? <div className="admissions-advisor-list">{renderAdvisorRows(advisor.projects, relevantProjects, 'project')}</div> : <p className="admissions-section-empty">{tx('dossier.admissions.noProjects')}</p>}
                  </div>
                  <div className="admissions-advisor-subsection">
                    <div className="admissions-advisor-subsection-head"><strong>{tx('dossier.admissions.worksTitle', 'Recent matched publications')}</strong><span>{advisor.works.length}</span></div>
                    {advisor.works.length ? <div className="admissions-advisor-list">{renderAdvisorRows(advisor.works, relevantWorks, 'work')}</div> : <p className="admissions-section-empty">{tx('dossier.admissions.noWorks', 'No matched publication records returned.')}</p>}
                  </div>
                </div>

                {(advisor.possibleAwards?.length ?? 0) + (advisor.possibleProjects?.length ?? 0) + (advisor.possibleWorks?.length ?? 0) > 0 ? (
                  <details className="admissions-unmatched">
                    <summary>{format(tx('dossier.admissions.possibleMatches'), { count: (advisor.possibleAwards?.length ?? 0) + (advisor.possibleProjects?.length ?? 0) + (advisor.possibleWorks?.length ?? 0) })}</summary>
                    <p className="admissions-unmatched-note">{tx('dossier.admissions.possibleMatchesHint')}</p>
                    <div className="admissions-advisor-list">{renderAdvisorRows([...(advisor.possibleAwards ?? []), ...(advisor.possibleProjects ?? []), ...(advisor.possibleWorks ?? [])], new Set(), 'possible')}</div>
                  </details>
                ) : null}
              </>
            ) : null}
            <ExploreLinks links={report?.links.advisor ?? []} title={tx('dossier.admissions.exploreAdvisor')} tx={tx} />
          </section>

          <section className="admissions-section admissions-reveal" aria-label={tx('dossier.admissions.discussionsTitle')}>
            <div className="admissions-section-heading"><MessageSquare size={15} aria-hidden="true" /><h4>{tx('dossier.admissions.discussionsTitle')}</h4></div>
            {!outcomes || outcomes.discussions.length === 0 ? <p className="admissions-section-empty">{tx('dossier.admissions.noDiscussions')}</p> : (
              <div className="admissions-discussion-list">
                {outcomes.discussions.map((record, index) => {
                  const candidate = bookmarkCandidateFor('discussion', record.value.title, record)
                  const key = String(candidate.data.recordKey)
                  return (
                    <DiscussionRow
                      key={`${record.sourceUrl}:${index}`}
                      record={record}
                      sourceName={sourceNameFor(record)}
                      lang={lang}
                      tx={tx}
                      format={format}
                      bookmarked={bookmarkKeys.has(key)}
                      bookmarkBusy={bookmarkBusyKey === key}
                      onBookmark={() => void toggleBookmark(candidate)}
                    />
                  )
                })}
              </div>
            )}
            {(outcomes?.unmatchedDiscussions?.length ?? 0) > 0 ? (
              <details className="admissions-unmatched admissions-unmatched-discussions">
                <summary>
                  {format(tx('dossier.admissions.unmatchedDiscussions', 'Show {count} discussion(s) for another school or field'), {
                    count: outcomes?.unmatchedDiscussions?.length ?? 0,
                  })}
                </summary>
                <p className="admissions-unmatched-note">
                  {tx('dossier.admissions.unmatchedDiscussionsHint', 'These posts were returned by Reddit but do not contain enough visible evidence for this application target, so they are excluded from the result count.')}
                </p>
                <div className="admissions-discussion-list">
                  {(outcomes?.unmatchedDiscussions ?? []).map((record, index) => {
                    const candidate = bookmarkCandidateFor('discussion', record.value.title, record)
                    const key = String(candidate.data.recordKey)
                    return (
                      <DiscussionRow
                        key={`unmatched:${record.sourceUrl}:${index}`}
                        record={record}
                        sourceName={sourceNameFor(record)}
                        lang={lang}
                        tx={tx}
                        format={format}
                        bookmarked={bookmarkKeys.has(key)}
                        bookmarkBusy={bookmarkBusyKey === key}
                        onBookmark={() => void toggleBookmark(candidate)}
                      />
                    )
                  })}
                </div>
              </details>
            ) : null}
          </section>

          <InsightsBlock insights={insights} insightsError={report?.insightsError ?? null} tx={tx} />
          <SourcesBlock sources={combinedSources} tx={tx} format={format} />
        </div>
      ) : null}
    </section>
  )
}
