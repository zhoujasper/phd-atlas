import { describe, expect, it } from 'vitest'
import { materialStatusMenuTone, statusCssSlug, statusLabel, statusMenuTone } from './statusLabels'

const zhStatus: Record<string, string> = {
  'status.In progress': '进行中',
  'status.Needs Review': '待审核',
  'status.Approved': '已通过',
}

const tx = (path: string) => zhStatus[path] ?? path

describe('statusLabel', () => {
  it('localizes known title-case material statuses from historical data', () => {
    expect(statusLabel('In Progress', tx)).toBe('进行中')
    expect(statusLabel('Needs Review', tx)).toBe('待审核')
    expect(statusLabel('Approved', tx)).toBe('已通过')
  })

  it('normalizes common imported status variants', () => {
    expect(statusLabel('in_progress', tx)).toBe('进行中')
    expect(statusLabel('needs-review', tx)).toBe('待审核')
  })

  it('keeps custom user statuses unchanged', () => {
    expect(statusLabel('Portfolio QA gate', tx)).toBe('Portfolio QA gate')
  })
})

describe('statusMenuTone', () => {
  it('maps material and task statuses to semantic tones for pickers', () => {
    expect(materialStatusMenuTone('Missing')).toBe('danger')
    expect(statusMenuTone('In progress')).toBe('info')
    expect(statusMenuTone('Needs Review')).toBe('warning')
    expect(statusMenuTone('Submitted')).toBe('success')
    expect(statusMenuTone('Draft')).toBe('neutral')
    expect(statusMenuTone('Done')).toBe('success')
    expect(statusMenuTone('Open')).toBe('neutral')
    expect(statusMenuTone('Waitlist')).toBe('purple')
  })
})

describe('statusCssSlug', () => {
  it('normalizes status labels into stable CSS slugs', () => {
    expect(statusCssSlug('Needs Review')).toBe('needs-review')
    expect(statusCssSlug('In Progress')).toBe('in-progress')
    expect(statusCssSlug('Not started')).toBe('not-started')
    expect(statusCssSlug('Done')).toBe('done')
  })
})
