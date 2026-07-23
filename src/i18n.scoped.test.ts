import { describe, expect, it } from 'vitest'
import { getDictForNamespaces, registerLanguage } from './i18n'

describe('namespace-scoped i18n dictionaries', () => {
  it('keeps an existing screen dictionary stable when an unrelated overlay pack registers', () => {
    const lang = 'zz-otest'
    registerLanguage(lang, { base: 'Core' }, 'core')
    registerLanguage(lang, { screen: { title: 'Workspace' } }, 'workspace')

    const beforeOverlay = getDictForNamespaces(lang, ['core', 'workspace'])
    registerLanguage(lang, { dialog: { title: 'Share' } }, 'share')
    const afterOverlay = getDictForNamespaces(lang, ['core', 'workspace'])

    expect(afterOverlay).toBe(beforeOverlay)
    expect(afterOverlay).toMatchObject({ base: 'Core', screen: { title: 'Workspace' } })
  })

  it('invalidates only scoped dictionaries that include the updated namespace', () => {
    const lang = 'zz-stest'
    registerLanguage(lang, { base: 'Core' }, 'core')
    registerLanguage(lang, { dialog: { title: 'Old title' } }, 'share')

    const beforeUpdate = getDictForNamespaces(lang, ['share'])
    registerLanguage(lang, { dialog: { title: 'New title' } }, 'share')
    const afterUpdate = getDictForNamespaces(lang, ['share'])

    expect(afterUpdate).not.toBe(beforeUpdate)
    expect(afterUpdate).toMatchObject({ dialog: { title: 'New title' } })
  })
})
