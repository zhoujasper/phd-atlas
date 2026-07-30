import { describe, expect, it } from 'vitest'
import { getHtmlAutoCloseEdit, getSourceCompletions, type SourceCompletion } from './sourceCompletions'

function applyCompletion(value: string, item: SourceCompletion) {
  const nextValue = value.slice(0, item.from) + item.insertText + value.slice(item.to)
  return {
    nextValue,
    selectionStart: item.from + item.selectFrom,
    selectionEnd: item.from + item.selectTo,
  }
}

describe('source completions', () => {
  it('suggests safe HTML elements after an opening bracket', () => {
    const items = getSourceCompletions('<se', 3, 'html')
    const section = items.find((item) => item.label === 'section')

    expect(section).toBeDefined()
    if (!section) return
    expect(applyCompletion('<se', section)).toEqual({
      nextValue: '<section></section>',
      selectionStart: 9,
      selectionEnd: 9,
    })
  })

  it('suggests contextual HTML attributes', () => {
    const items = getSourceCompletions('<a hr', 5, 'html')
    const href = items.find((item) => item.label === 'href')

    expect(href).toBeDefined()
    if (!href) return
    expect(applyCompletion('<a hr', href)).toEqual({
      nextValue: '<a href=""',
      selectionStart: 9,
      selectionEnd: 9,
    })
  })

  it('offers Markdown structures without interrupting ordinary prose', () => {
    expect(getSourceCompletions('ordinary prose', 14, 'markdown')).toEqual([])

    const items = getSourceCompletions('-', 1, 'markdown')
    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(['-', '- [ ]', '---']))

    const task = items.find((item) => item.label === '- [ ]')
    expect(task).toBeDefined()
    if (!task) return
    expect(applyCompletion('-', task)).toEqual({
      nextValue: '- [ ] ',
      selectionStart: 6,
      selectionEnd: 6,
    })
  })

  it('opens the full Markdown snippet list with slash or explicit invocation', () => {
    const slashItems = getSourceCompletions('/', 1, 'markdown')
    const forcedItems = getSourceCompletions('Notes: ', 7, 'markdown', true)

    expect(slashItems.some((item) => item.label === '| |')).toBe(true)
    expect(forcedItems.some((item) => item.label === '[]()')).toBe(true)
    expect(slashItems.every((item) => item.from === 0 && item.to === 1)).toBe(true)
  })

  it('creates closing tags while keeping void elements single', () => {
    expect(getHtmlAutoCloseEdit('<section', 8)).toEqual({
      insertText: '></section>',
      caretOffset: 1,
    })
    expect(getHtmlAutoCloseEdit('<img src=""', 11)).toEqual({
      insertText: '>',
      caretOffset: 1,
    })
    expect(getHtmlAutoCloseEdit('<a href="https://', 17)).toBeNull()
  })
})
