import { describe, expect, it } from 'vitest'
import {
  buildStrategyTips,
  computeAdvancedDiscoverStats,
  kMeansPrograms,
  kruskalWallisByRegion,
  paretoFrontier,
  spearmanCorrelation,
} from './discover-stats.js'

const sample = [
  { id: 'a', school: 'A', program: 'P', region: 'US', matchScore: 90, realStipendUSD: 40000, colIndex: 1.2, meetsFloor: true, tags: ['Machine Learning'], hidden: false },
  { id: 'b', school: 'B', program: 'P', region: 'US', matchScore: 80, realStipendUSD: 35000, colIndex: 1.1, meetsFloor: true, tags: ['NLP'], hidden: false },
  { id: 'c', school: 'C', program: 'P', region: 'EU', matchScore: 70, realStipendUSD: 50000, colIndex: 1.4, meetsFloor: true, tags: ['Systems'], hidden: false },
  { id: 'd', school: 'D', program: 'P', region: 'EU', matchScore: 60, realStipendUSD: 20000, colIndex: 0.9, meetsFloor: false, tags: ['Robotics'], hidden: false },
  { id: 'e', school: 'E', program: 'P', region: 'UK', matchScore: 55, realStipendUSD: 22000, colIndex: 1.2, meetsFloor: false, tags: ['Machine Learning'], hidden: false },
  { id: 'f', school: 'F', program: 'P', region: 'UK', matchScore: 50, realStipendUSD: 18000, colIndex: 1.3, meetsFloor: false, tags: ['HCI'], hidden: false },
]

describe('discover-stats', () => {
  it('computes Spearman correlation', () => {
    const rho = spearmanCorrelation(
      sample.map((p) => p.matchScore),
      sample.map((p) => p.realStipendUSD),
    )
    expect(rho).toBeTypeOf('number')
    expect(Math.abs(rho)).toBeLessThanOrEqual(1)
  })

  it('computes Kruskal-Wallis by region', () => {
    const kw = kruskalWallisByRegion(sample)
    expect(kw).toBeTruthy()
    expect(kw.df).toBeGreaterThanOrEqual(1)
    expect(kw.groups.length).toBeGreaterThanOrEqual(2)
  })

  it('finds Pareto frontier points', () => {
    const { frontier } = paretoFrontier(sample)
    expect(frontier.length).toBeGreaterThan(0)
    expect(frontier.some((p) => p.id === 'a' || p.id === 'c')).toBe(true)
  })

  it('clusters programs and builds tips', () => {
    const clusters = kMeansPrograms(sample, 3)
    expect(clusters.clusters.length).toBeGreaterThan(0)
    const advanced = computeAdvancedDiscoverStats(sample, {
      interestAreas: { 'Machine Learning': ['ml', 'learning'], NLP: ['nlp'] },
    })
    expect(advanced.strategyTips.length).toBeGreaterThan(0)
    expect(advanced.interestHeatmap.length).toBeGreaterThan(0)
    const tips = buildStrategyTips({
      spearman: 0.5,
      kruskal: advanced.kruskalWallis,
      pareto: advanced.pareto,
      clusters: advanced.clusters,
      meetFloorCount: 3,
      programCount: 6,
    })
    expect(tips.some((t) => t.id === 'spearman-pos' || t.id === 'pareto')).toBe(true)
  })
})
