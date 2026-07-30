import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { getDict, registerLanguage, t, tpl, type LangDict } from '../../i18n'
import englishTeam from '../../i18n/en/team.json'
import { teamPermissionDefaults } from '../../teamPermissions'
import { I18nContext } from '../hooks/useI18n'
import {
  TeamDefaultPermissionsEditor,
  TeamMemberPermissionEditor,
} from './TeamPermissionEditor'

registerLanguage('en', englishTeam as LangDict, 'team')

function renderWithI18n(node: ReactNode) {
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => t('en', path, fallback),
    }}>
      {node}
    </I18nContext.Provider>,
  )
}

describe('TeamPermissionEditor', () => {
  it('moves switches immediately while serializing rapid saves in order', async () => {
    let resolveFirst: (() => void) | undefined
    const onSave = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce(undefined)

    renderWithI18n(<TeamDefaultPermissionsEditor onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: /Student default/i }))
    const editApplications = await screen.findByRole('switch', { name: 'Edit team applications' })
    const [studentDiscover] = screen.getAllByRole('switch', { name: 'Use Discover' })
    expect(editApplications).toHaveAttribute('aria-checked', 'true')
    expect(studentDiscover).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(editApplications)
    expect(editApplications).toHaveAttribute('aria-checked', 'false')
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))

    fireEvent.click(studentDiscover)
    expect(studentDiscover).toHaveAttribute('aria-checked', 'true')
    expect(onSave).toHaveBeenCalledTimes(1)

    resolveFirst?.()
    await waitFor(() => {
      expect(onSave).toHaveBeenNthCalledWith(2, {
        student: { useDiscover: true },
      })
    })
  })

  it('restores a member to the live Team defaults with a null override patch', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderWithI18n(
      <TeamMemberPermissionEditor
        role="member"
        relationships={{
          permissionOverridesVersion: 1,
          studentPermissions: { useDiscover: true },
        }}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Student permissions/i }))
    expect(await screen.findByRole('switch', { name: 'Use Discover' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }))
    expect(screen.getByRole('switch', { name: 'Use Discover' })).toHaveAttribute('aria-checked', 'false')

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ studentPermissions: null })
    })
  })

  it('keeps role details mounted behind a reversible disclosure', async () => {
    renderWithI18n(<TeamDefaultPermissionsEditor onSave={vi.fn().mockResolvedValue(undefined)} />)

    const studentToggle = screen.getByRole('button', { name: /Student default/i })
    const panelId = studentToggle.getAttribute('aria-controls')
    const panel = panelId ? document.getElementById(panelId) : null

    expect(studentToggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('data-collapsible-open', 'false')

    fireEvent.click(studentToggle)
    expect(studentToggle).toHaveAttribute('aria-expanded', 'true')
    expect(panel).toHaveAttribute('data-collapsible-open', 'true')
    expect(await screen.findByRole('switch', { name: 'Edit team applications' })).toBeVisible()

    fireEvent.click(studentToggle)
    expect(studentToggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('data-collapsible-open', 'false')
  })

  it('accepts -1 as unlimited and settles the edited field to infinity', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderWithI18n(
      <TeamDefaultPermissionsEditor
        defaults={teamPermissionDefaults({
          student: { activeApplicationLimit: 12 },
        })}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Student default/i }))
    const limitsToggle = await screen.findByRole('button', { name: /Usage limits: 1 limited/i })
    fireEvent.click(limitsToggle)

    const input = await screen.findByRole('textbox', { name: 'Active applications' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '-1' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        student: { activeApplicationLimit: null },
      })
    })
    expect(screen.getByRole('textbox', { name: 'Active applications' })).toHaveValue('∞')
  })
})
