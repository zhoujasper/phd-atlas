import { Lightbulb, ScatterChart, Sparkles, Target } from 'lucide-react'
import clsx from 'clsx'
import type { DiscoverStats } from '../../data/discover'
import { useI18n } from '../hooks/useI18n'

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `$${Math.round(value).toLocaleString()}`
}

export function DiscoverAdvancedInsights({
  stats,
  onOpenProgram,
}: {
  stats: DiscoverStats
  onOpenProgram?: (id: string) => void
}) {
  const { tx, format } = useI18n()
  const advanced = stats.advanced
  if (!advanced) return null

  const frontier = advanced.pareto?.frontier || []
  const maxMatch = Math.max(1, ...frontier.map((p) => p.matchScore), 100)
  const maxReal = Math.max(1, ...frontier.map((p) => p.realStipendUSD), 50000)
  const heatmap = advanced.interestHeatmap || []
  const maxHeat = Math.max(1, ...heatmap.map((h) => h.weight))

  return (
    <div className="discover-advanced">
      <div className="discover-panel discover-strategy-panel">
        <h3>
          <Lightbulb size={16} aria-hidden="true" />
          {tx('discover.strategyTips', 'Strategy tips')}
        </h3>
        <p className="hint">{tx('discover.strategyTipsHint', 'Plain-language recommendations from your current catalog slice.')}</p>
        <div className="discover-strategy-grid">
          {(advanced.strategyTips || []).map((tip, index) => (
            <article
              key={tip.id}
              className={clsx('discover-strategy-card', `tone-${tip.tone || 'info'}`)}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <strong>{tip.title}</strong>
              <p>{tip.body}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="discover-panel">
        <h3>
          <Target size={16} aria-hidden="true" />
          {tx('discover.paretoTitle', 'Pareto frontier')}
        </h3>
        <p className="hint">
          {tx('discover.paretoHintFull', 'Programs that are not dominated on both match and COL-adjusted stipend.')}
        </p>
        <div className="discover-pareto">
          <svg viewBox="0 0 320 200" className="discover-pareto-svg" role="img" aria-label={tx('discover.paretoTitle', 'Pareto frontier')}>
            <line x1="36" y1="12" x2="36" y2="172" className="discover-pareto-axis" />
            <line x1="36" y1="172" x2="308" y2="172" className="discover-pareto-axis" />
            <text x="8" y="20" className="discover-pareto-label">{tx('discover.matchAxis')}</text>
            <text x="250" y="192" className="discover-pareto-label">{tx('discover.realAxis')}</text>
            {(advanced.pareto?.dominated || []).slice(0, 40).map((point) => {
              const x = 36 + (point.realStipendUSD / maxReal) * 260
              const y = 172 - (point.matchScore / maxMatch) * 150
              return <circle key={point.id} cx={x} cy={y} r={3.5} className="discover-pareto-dot muted" />
            })}
            {frontier.map((point, index) => {
              const x = 36 + (point.realStipendUSD / maxReal) * 260
              const y = 172 - (point.matchScore / maxMatch) * 150
              return (
                <g key={point.id} className="discover-pareto-point" style={{ animationDelay: `${index * 40}ms` }}>
                  <circle
                    cx={x}
                    cy={y}
                    r={6}
                    className="discover-pareto-dot hot"
                    onClick={() => onOpenProgram?.(point.id)}
                  />
                  <title>{`${point.school} · match ${point.matchScore} · ${money(point.realStipendUSD)}`}</title>
                </g>
              )
            })}
          </svg>
          <ul className="discover-pareto-list">
            {frontier.slice(0, 6).map((point) => (
              <li key={point.id}>
                <button type="button" onClick={() => onOpenProgram?.(point.id)}>
                  <strong>{point.school}</strong>
                  <span>
                    {format(tx('discover.matchScore'), { score: point.matchScore })} · {money(point.realStipendUSD)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="discover-panel">
        <h3>
          <ScatterChart size={16} aria-hidden="true" />
          {tx('discover.clustersTitle', 'Program clusters')}
        </h3>
        <p className="hint">
          {tx('discover.clustersHint', 'K-means style grouping on match, real stipend, COL, and advisor density.')}
        </p>
        <div className="discover-cluster-grid">
          {(advanced.clusters?.clusters || []).map((cluster, index) => (
            <article key={cluster.id} className="discover-cluster-card" style={{ animationDelay: `${index * 45}ms` }}>
              <header>
                <strong>{cluster.label}</strong>
                <span>{format(tx('discover.clusterSize', '{count} programs'), { count: cluster.size })}</span>
              </header>
              <p>
                {tx('discover.kpiAvgStipend')}: {money(cluster.avgRealStipendUSD)} ·{' '}
                {format(tx('discover.matchScore'), { score: cluster.avgMatch })}
              </p>
              <div className="discover-cluster-members">
                {cluster.members.slice(0, 4).map((member) => (
                  <button key={member.id} type="button" onClick={() => onOpenProgram?.(member.id)}>
                    {member.school}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="discover-panel">
        <h3>
          <Sparkles size={16} aria-hidden="true" />
          {tx('discover.heatmapTitle', 'Interest heatmap')}
        </h3>
        <div className="discover-heatmap">
          {heatmap.map((item) => (
            <span
              key={item.tag}
              className="discover-heatmap-chip"
              style={{
                ['--heat' as string]: String(Math.max(0.2, item.weight / maxHeat)),
              }}
            >
              {item.tag}
            </span>
          ))}
          {!heatmap.length ? <p className="hint">{tx('discover.heatmapEmpty', 'Add interest tags in criteria to power the heatmap.')}</p> : null}
        </div>
        <div className="discover-stat-metrics">
          <div>
            <span className="label">{tx('discover.correlation', 'Stipend vs match')}</span>
            <strong>
              {advanced.spearmanMatchVsRealStipend == null
                ? '—'
                : `ρ = ${advanced.spearmanMatchVsRealStipend}`}
            </strong>
          </div>
          <div>
            <span className="label">{tx('discover.kruskal', 'Region differences (H)')}</span>
            <strong>
              {advanced.kruskalWallis == null
                ? '—'
                : `H = ${advanced.kruskalWallis.H} (df ${advanced.kruskalWallis.df})`}
            </strong>
          </div>
        </div>
      </div>
    </div>
  )
}
