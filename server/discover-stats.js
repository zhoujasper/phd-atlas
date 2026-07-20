/**
 * Advanced Discover analytics (planner-parity):
 * Spearman, Kruskal-Wallis (by region), Pareto frontier, K-means clusters + strategy tips.
 * Pure functions over scored program lists — no fabrication of missing data.
 */

function rankArray(values) {
  const indexed = values.map((value, index) => ({ value, index }))
  indexed.sort((a, b) => a.value - b.value)
  const ranks = new Array(values.length)
  let i = 0
  while (i < indexed.length) {
    let j = i
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j += 1
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) ranks[indexed[k].index] = avg
    i = j + 1
  }
  return ranks
}

export function spearmanCorrelation(xs, ys) {
  if (!xs?.length || xs.length !== ys?.length || xs.length < 3) return null
  const n = xs.length
  const rx = rankArray(xs)
  const ry = rankArray(ys)
  let num = 0
  let dx = 0
  let dy = 0
  const mx = rx.reduce((a, b) => a + b, 0) / n
  const my = ry.reduce((a, b) => a + b, 0) / n
  for (let i = 0; i < n; i += 1) {
    const a = rx[i] - mx
    const b = ry[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  if (dx === 0 || dy === 0) return 0
  return Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000
}

/** Kruskal–Wallis H statistic across region groups for matchScore. */
export function kruskalWallisByRegion(programs) {
  const groups = {}
  for (const program of programs) {
    if (program.hidden) continue
    const key = program.region || 'OTHER'
    if (!groups[key]) groups[key] = []
    groups[key].push(Number(program.matchScore) || 0)
  }
  const keys = Object.keys(groups).filter((key) => groups[key].length > 0)
  if (keys.length < 2) return null
  const all = []
  for (const key of keys) {
    for (const value of groups[key]) all.push({ key, value })
  }
  const n = all.length
  if (n < 4) return null
  const ranks = rankArray(all.map((item) => item.value))
  const sumRank = {}
  const count = {}
  for (let i = 0; i < all.length; i += 1) {
    const key = all[i].key
    sumRank[key] = (sumRank[key] || 0) + ranks[i]
    count[key] = (count[key] || 0) + 1
  }
  let h = 0
  for (const key of keys) {
    h += (sumRank[key] * sumRank[key]) / count[key]
  }
  h = (12 / (n * (n + 1))) * h - 3 * (n + 1)
  const df = keys.length - 1
  // Rough p-value via chi-square approximation (Wilson-Hilferty-ish not needed — report H + plain language)
  return {
    H: Math.round(h * 1000) / 1000,
    df,
    groups: keys.map((key) => ({
      region: key,
      n: count[key],
      meanMatch: Math.round((groups[key].reduce((a, b) => a + b, 0) / count[key]) * 10) / 10,
    })),
    significant: h > df + 2, // soft threshold for plain language, not a formal test
  }
}

/** Pareto frontier: maximize matchScore and realStipendUSD. */
export function paretoFrontier(programs) {
  const points = programs
    .filter((p) => !p.hidden && p.matchScore != null && p.realStipendUSD != null)
    .map((p) => ({
      id: p.id,
      school: p.school,
      program: p.program,
      region: p.region,
      matchScore: p.matchScore,
      realStipendUSD: p.realStipendUSD,
      stipendUSD: p.stipendUSD,
    }))
  if (points.length < 2) return { frontier: points, dominated: [] }

  const frontier = []
  const dominated = []
  for (const candidate of points) {
    let isDominated = false
    for (const other of points) {
      if (other.id === candidate.id) continue
      if (
        other.matchScore >= candidate.matchScore &&
        other.realStipendUSD >= candidate.realStipendUSD &&
        (other.matchScore > candidate.matchScore || other.realStipendUSD > candidate.realStipendUSD)
      ) {
        isDominated = true
        break
      }
    }
    if (isDominated) dominated.push(candidate)
    else frontier.push(candidate)
  }
  frontier.sort((a, b) => b.matchScore - a.matchScore)
  return { frontier, dominated }
}

function euclidean(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i]
    s += d * d
  }
  return Math.sqrt(s)
}

/** Simple k-means on [matchScore, realStipend normalized, colIndex, fittingPiCount]. */
export function kMeansPrograms(programs, k = 3, maxIter = 25) {
  const rows = programs
    .filter((p) => !p.hidden)
    .map((p) => {
      const match = Number(p.matchScore) || 0
      const real = Number(p.realStipendUSD) || 0
      const col = Number(p.colIndex) || 1
      const advisors = Number(p.fittingPiCount) || (p.pis?.length || 0)
      return {
        id: p.id,
        school: p.school,
        program: p.program,
        region: p.region,
        matchScore: match,
        realStipendUSD: real,
        vec: [match / 100, real / 50000, col / 2, advisors / 6],
      }
    })
  if (rows.length < k) {
    return {
      k: rows.length,
      clusters: rows.map((row, index) => ({
        id: index,
        label: `Cluster ${index + 1}`,
        size: 1,
        centroid: row.vec,
        members: [row],
      })),
    }
  }

  // init: pick k spread by match score
  const sorted = [...rows].sort((a, b) => b.matchScore - a.matchScore)
  const centroids = []
  for (let i = 0; i < k; i += 1) {
    const idx = Math.round((i * (sorted.length - 1)) / Math.max(1, k - 1))
    centroids.push([...sorted[idx].vec])
  }

  let assignments = new Array(rows.length).fill(0)
  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false
    for (let i = 0; i < rows.length; i += 1) {
      let best = 0
      let bestDist = Infinity
      for (let c = 0; c < k; c += 1) {
        const d = euclidean(rows[i].vec, centroids[c])
        if (d < bestDist) {
          bestDist = d
          best = c
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best
        changed = true
      }
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0])
    const counts = new Array(k).fill(0)
    for (let i = 0; i < rows.length; i += 1) {
      const c = assignments[i]
      counts[c] += 1
      for (let d = 0; d < 4; d += 1) sums[c][d] += rows[i].vec[d]
    }
    for (let c = 0; c < k; c += 1) {
      if (counts[c] === 0) continue
      centroids[c] = sums[c].map((value) => value / counts[c])
    }
    if (!changed) break
  }

  const clusterLabels = [
    'High fit / strong shortlist',
    'Balanced options',
    'Funding / COL value plays',
    'Exploratory / long-shot',
  ]

  const clusters = []
  for (let c = 0; c < k; c += 1) {
    const members = rows.filter((_, i) => assignments[i] === c)
    const avgMatch = members.length
      ? members.reduce((s, m) => s + m.matchScore, 0) / members.length
      : 0
    const avgReal = members.length
      ? members.reduce((s, m) => s + m.realStipendUSD, 0) / members.length
      : 0
    let label = clusterLabels[Math.min(c, clusterLabels.length - 1)]
    if (avgMatch >= 70 && avgReal >= 30000) label = 'High fit / strong shortlist'
    else if (avgReal >= 35000 && avgMatch < 65) label = 'Funding / COL value plays'
    else if (avgMatch < 50) label = 'Exploratory / long-shot'
    else label = 'Balanced options'
    clusters.push({
      id: c,
      label,
      size: members.length,
      avgMatch: Math.round(avgMatch * 10) / 10,
      avgRealStipendUSD: Math.round(avgReal),
      members: members.map((m) => ({
        id: m.id,
        school: m.school,
        program: m.program,
        region: m.region,
        matchScore: m.matchScore,
        realStipendUSD: m.realStipendUSD,
      })),
    })
  }
  clusters.sort((a, b) => b.avgMatch - a.avgMatch)
  return { k, clusters }
}

/** Interest-area heatmap: which tags appear most among top-scoring PIs/programs. */
export function interestHeatmap(programs, interestAreas = {}) {
  const buckets = Object.keys(interestAreas || {})
  if (!buckets.length) {
    // Fall back to program tags
    const counts = {}
    for (const program of programs) {
      if (program.hidden) continue
      for (const tag of program.tags || []) {
        counts[tag] = (counts[tag] || 0) + (program.matchScore || 1)
      }
    }
    return Object.entries(counts)
      .map(([tag, weight]) => ({ tag, weight: Math.round(weight) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12)
  }

  const counts = Object.fromEntries(buckets.map((b) => [b, 0]))
  for (const program of programs) {
    if (program.hidden) continue
    const blob = [
      program.researchFocus,
      program.fitRationale,
      ...(program.tags || []),
      ...(program.pis || []).map((pi) => `${pi.research} ${pi.whyFit}`),
    ]
      .join(' ')
      .toLowerCase()
    for (const [bucket, kws] of Object.entries(interestAreas)) {
      const hit = (kws || []).some((kw) => blob.includes(String(kw).toLowerCase()))
        || (program.tags || []).some((tag) => tag.toLowerCase() === bucket.toLowerCase())
      if (hit) counts[bucket] += program.matchScore || 10
    }
  }
  return Object.entries(counts)
    .map(([tag, weight]) => ({ tag, weight: Math.round(weight) }))
    .sort((a, b) => b.weight - a.weight)
}

export function buildStrategyTips({ spearman, kruskal, pareto, clusters, meetFloorCount, programCount }) {
  const tips = []
  if (spearman != null) {
    if (spearman > 0.35) {
      tips.push({
        id: 'spearman-pos',
        tone: 'info',
        title: 'Fit and real stipend move together',
        body: `Spearman ρ ≈ ${spearman}. Higher-match programs also tend to pay more after COL — prioritize the Pareto frontier.`,
      })
    } else if (spearman < -0.2) {
      tips.push({
        id: 'spearman-neg',
        tone: 'warning',
        title: 'Fit vs funding trade-off',
        body: `Spearman ρ ≈ ${spearman}. Strong research fits may cost more in real stipend — decide which dimension you can sacrifice.`,
      })
    } else {
      tips.push({
        id: 'spearman-flat',
        tone: 'info',
        title: 'Fit and funding are weakly linked',
        body: `Spearman ρ ≈ ${spearman}. You can optimize fit and stipend somewhat independently — use the ranker sliders deliberately.`,
      })
    }
  }
  if (kruskal?.significant) {
    tips.push({
      id: 'region-diff',
      tone: 'info',
      title: 'Region differences look meaningful',
      body: `Kruskal–Wallis H ≈ ${kruskal.H} (df=${kruskal.df}). Match scores differ across regions — rebalance region filters if one cluster dominates.`,
    })
  }
  if (pareto?.frontier?.length) {
    const names = pareto.frontier.slice(0, 3).map((p) => p.school).join(', ')
    tips.push({
      id: 'pareto',
      tone: 'success',
      title: 'Pareto shortlist',
      body: `Non-dominated options (max fit & real stipend): ${names}. These are efficient candidates before pure prestige chasing.`,
    })
  }
  if (clusters?.clusters?.length) {
    const top = clusters.clusters[0]
    tips.push({
      id: 'cluster',
      tone: 'info',
      title: top.label,
      body: `${top.size} programs cluster as “${top.label}” (avg match ${top.avgMatch}, avg real stipend ~$${top.avgRealStipendUSD}). Start applications here.`,
    })
  }
  if (programCount > 0 && meetFloorCount / programCount < 0.4) {
    tips.push({
      id: 'floor',
      tone: 'warning',
      title: 'Many programs miss your stipend floor',
      body: `Only ${meetFloorCount}/${programCount} meet the floor. Lower the floor, expand regions, or focus on employment-style PhD contracts (e.g. CH/DE).`,
    })
  }
  if (!tips.length) {
    tips.push({
      id: 'default',
      tone: 'info',
      title: 'Keep verifying official pages',
      body: 'Stats describe your current catalog slice only. Stipends and deadlines are snapshots — confirm before applying.',
    })
  }
  return tips
}

export function computeAdvancedDiscoverStats(programs, meta = {}) {
  const visible = (programs || []).filter((p) => !p.hidden)
  const withReal = visible.filter((p) => p.realStipendUSD != null && p.matchScore != null)
  const spearman = spearmanCorrelation(
    withReal.map((p) => p.matchScore),
    withReal.map((p) => p.realStipendUSD),
  )
  const kruskal = kruskalWallisByRegion(visible)
  const pareto = paretoFrontier(visible)
  const clusters = kMeansPrograms(visible, Math.min(3, Math.max(2, Math.floor(visible.length / 5))))
  const heatmap = interestHeatmap(visible, meta.interestAreas || {})
  const tips = buildStrategyTips({
    spearman,
    kruskal,
    pareto,
    clusters,
    meetFloorCount: visible.filter((p) => p.meetsFloor).length,
    programCount: visible.length,
  })
  return {
    spearmanMatchVsRealStipend: spearman,
    kruskalWallis: kruskal,
    pareto,
    clusters,
    interestHeatmap: heatmap,
    strategyTips: tips,
  }
}
