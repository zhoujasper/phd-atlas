const TERM_TRANSLATIONS = [
  [/量子(?:计算|信息)/i, 'quantum computing'],
  [/形式化验证/i, 'formal verification'],
  [/形式化方法/i, 'formal methods'],
  [/人工智能/i, 'artificial intelligence'],
  [/机器学习/i, 'machine learning'],
  [/深度学习/i, 'deep learning'],
  [/自然语言处理/i, 'natural language processing'],
  [/计算机视觉/i, 'computer vision'],
  [/机器人/i, 'robotics'],
  [/人机交互/i, 'human computer interaction'],
  [/网络安全|信息安全/i, 'cybersecurity'],
  [/数据科学/i, 'data science'],
  [/算法/i, 'algorithms'],
  [/理论计算机/i, 'theoretical computer science'],
  [/软件工程/i, 'software engineering'],
  [/分布式系统/i, 'distributed systems'],
  [/生物信息/i, 'bioinformatics'],
  [/计算生物/i, 'computational biology'],
  [/神经科学/i, 'neuroscience'],
  [/材料科学/i, 'materials science'],
  [/经济学/i, 'economics'],
  [/金融/i, 'finance'],
  [/物理/i, 'physics'],
  [/化学/i, 'chemistry'],
]

function splitTerms(value) {
  return String(value || '')
    .split(/[\n,，、;；|/]+/)
    .map((term) => term.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * Preserve the user's terms while adding stable English search aliases for
 * common Chinese research fields. The aliases improve official-page and
 * scholarly-index retrieval only; they never translate saved user content.
 */
export function expandDiscoverResearchTerms(values, { limit = 16 } = {}) {
  const input = (Array.isArray(values) ? values : [values]).flatMap(splitTerms)
  const output = []
  const seen = new Set()
  const add = (value) => {
    const term = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const key = term.toLocaleLowerCase()
    if (!term || seen.has(key) || output.length >= Math.max(1, Math.min(40, Number(limit) || 16))) return
    seen.add(key)
    output.push(term)
  }
  for (const term of input) {
    for (const [pattern, translation] of TERM_TRANSLATIONS) {
      if (pattern.test(term)) add(translation)
    }
    add(term)
  }
  return output
}
