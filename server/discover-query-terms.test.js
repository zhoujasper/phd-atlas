import { describe, expect, it } from 'vitest'
import { expandDiscoverResearchTerms } from './discover-query-terms.js'

describe('Discover research query terms', () => {
  it('splits Chinese compound fields and adds English scholarly aliases', () => {
    expect(expandDiscoverResearchTerms('量子计算、形式化验证')).toEqual([
      'quantum computing',
      '量子计算',
      'formal verification',
      '形式化验证',
      'quantum information',
      'quantum algorithms',
      'quantum error correction',
      'quantum software',
      'model checking',
      'theorem proving',
      'program verification',
      'formal methods',
    ])
  })

  it('deduplicates existing English terms without altering display text', () => {
    expect(expandDiscoverResearchTerms(['machine learning', 'machine learning', '机器学习'])).toEqual([
      'machine learning',
      '机器学习',
    ])
  })

  it('adds focused engineering aliases before broader field aliases', () => {
    expect(expandDiscoverResearchTerms('相场模型、计算材料科学、图神经网络')).toEqual([
      'phase-field modeling',
      '相场模型',
      'computational materials science',
      'materials science',
      '计算材料科学',
      'graph neural networks',
      '图神经网络',
      'microstructure evolution',
      'phase transformations',
      'materials modelling',
      'integrated computational materials engineering',
      'materials engineering',
      'materials characterization',
      'geometric deep learning',
      'graph representation learning',
    ])
  })
})
