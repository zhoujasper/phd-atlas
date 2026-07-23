import { describe, expect, it } from 'vitest'
import { expandDiscoverResearchTerms } from './discover-query-terms.js'

describe('Discover research query terms', () => {
  it('splits Chinese compound fields and adds English scholarly aliases', () => {
    expect(expandDiscoverResearchTerms('量子计算、形式化验证')).toEqual([
      'quantum computing',
      '量子计算',
      'formal verification',
      '形式化验证',
    ])
  })

  it('deduplicates existing English terms without altering display text', () => {
    expect(expandDiscoverResearchTerms(['machine learning', 'machine learning', '机器学习'])).toEqual([
      'machine learning',
      '机器学习',
    ])
  })
})
