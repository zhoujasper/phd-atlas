import { describe, expect, it } from 'vitest'
import { avatarInitial } from './avatarInitial'

describe('avatarInitial', () => {
  it('uses the meaningful teacher name instead of a numeric duplicate suffix', () => {
    expect(avatarInitial('Prof. Daniel Kim 002', 'daniel.kim.002@example.test')).toBe('DK')
  })

  it('keeps CJK teacher names meaningful after removing the honorific suffix', () => {
    expect(avatarInitial('王小明教授002', 'wang@example.test')).toBe('王小')
  })
})
