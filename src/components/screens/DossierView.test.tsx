import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../../api/phdApi'
import { applications, type ApplicationRecord } from '../../data/applications'
import englishDossier from '../../i18n/en/dossier.json'
import { getDict, registerLanguage, t as translate, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { DossierView } from './DossierView'

const session: AuthSession = {
  token: 'test-token',
  user: {
    id: 'user_1',
    name: 'Jasper',
    email: 'jasper@example.com',
    role: 'user',
    createdAt: '2026-06-29T00:00:00.000Z',
    lastLoginAt: null,
    settings: {
      language: 'en',
      highContrast: false,
      themeAccent: 'Alpine blue',
      sendFrom: 'jasper@example.com',
      receiveAt: 'jasper@example.com',
      receiveEmails: [{ address: 'jasper@example.com', isPrimary: true, notify: true, verified: true }],
      membershipPlan: 'pro',
    },
  },
  settings: {
    allowRegistration: true,
    notificationMailbox: 'admin@phd-atlas.local',
    backupFrequency: 'weekly',
    encryptionAtRest: true,
  },
}

beforeAll(() => {
  registerLanguage('en', englishDossier, 'dossier')
})

afterEach(() => {
  vi.useRealTimers()
})

function renderDossier({
  isDirty = false,
  onSave = vi.fn(),
  onDiscardDraft = vi.fn(),
  onRegisterNavigationGuard,
  onTab = vi.fn(),
  tab = 'mail',
  deferHeavyContent = false,
  application: applicationOverride,
  onUpdateScholarship = vi.fn(),
  activeSession = session,
  onOpenUpgrade = vi.fn(),
}: {
  isDirty?: boolean
  onSave?: () => void | Promise<void>
  onDiscardDraft?: () => void
  onRegisterNavigationGuard?: (guard: ((proceed: () => void) => boolean) | null) => void
  onTab?: (tab: 'dossier' | 'materials' | 'mail' | 'funding' | 'timeline' | 'review', direction?: 'forward' | 'backward') => void
  tab?: 'dossier' | 'mail' | 'materials' | 'funding' | 'timeline' | 'review'
  deferHeavyContent?: boolean
  application?: ApplicationRecord
  onUpdateScholarship?: (id: string, input: Omit<ApplicationRecord['scholarships'][number], 'id'>) => void | Promise<void>
  activeSession?: AuthSession
  onOpenUpgrade?: (feature: string, requested: string, limit?: string) => void
} = {}) {
  const renderTree = (application: ApplicationRecord) => (
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => translate('en', path, fallback),
    }}>
      <DossierView
        application={application}
        draft={structuredClone(application)}
        tab={tab}
        saving={false}
        isDirty={isDirty}
        profileAssets={[]}
        session={activeSession}
        deferHeavyContent={deferHeavyContent}
        onTab={onTab}
        onDraft={vi.fn()}
        onSave={onSave}
        onDiscardDraft={onDiscardDraft}
        onDelete={vi.fn()}
        onShare={vi.fn()}
        onOpenUpgrade={onOpenUpgrade}
        onRegisterNavigationGuard={onRegisterNavigationGuard}
        onUpload={vi.fn()}
        onDownload={vi.fn()}
        onAddTask={vi.fn()}
        onToggleTask={vi.fn()}
        onRemoveTask={vi.fn()}
        onAddCommunication={vi.fn()}
        onRemoveCommunication={vi.fn()}
        onAddScholarship={vi.fn()}
        onUpdateScholarship={onUpdateScholarship}
        onRemoveScholarship={vi.fn()}
        onAddFee={vi.fn()}
        onUpdateFee={vi.fn()}
        onDeleteFee={vi.fn()}
      />
    </I18nContext.Provider>
  )

  const application = { ...structuredClone(applicationOverride ?? applications[0]), ownerId: session.user.id }
  const view = render(renderTree(application))
  return {
    ...view,
    rerenderDossier: (nextApplication: ApplicationRecord) => view.rerender(
      renderTree({ ...structuredClone(nextApplication), ownerId: session.user.id }),
    ),
  }
}

describe('DossierView exit motion', () => {
  it('retains the dossier host while resetting record-scoped disclosure state', async () => {
    const user = userEvent.setup()
    const firstRecord = {
      ...structuredClone(applications[0]),
      id: 'record-one',
      ownerId: session.user.id,
    }
    const secondRecord = {
      ...structuredClone(firstRecord),
      id: 'record-two',
      school: { ...firstRecord.school, name: 'Second record university' },
    }
    const { rerenderDossier } = renderDossier({ tab: 'dossier', application: firstRecord })
    const originalHost = document.querySelector('.dossier-pane')
    const schoolDisclosure = screen.getByRole('button', { name: /collapse school/i })

    await user.click(schoolDisclosure)
    expect(schoolDisclosure).toHaveAttribute('aria-expanded', 'false')

    rerenderDossier(secondRecord)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /second record university/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /collapse school/i })).toHaveAttribute('aria-expanded', 'true')
    })
    expect(document.querySelector('.dossier-pane')).toBe(originalHost)
  })

  it('keeps long checklist rows out of a deferred transition target', () => {
    renderDossier({ tab: 'materials', deferHeavyContent: true })

    expect(document.querySelector('.checklist-list-deferred')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /checklist item title/i })).not.toBeInTheDocument()
  })

  it('keeps the checklist explanation behind an accessible info control', async () => {
    const user = userEvent.setup()
    renderDossier({ tab: 'materials' })

    const title = screen.getByRole('heading', { name: /checklist/i })
    const titleRow = title.closest('.checklist-hero-title-row')
    const infoButton = within(titleRow as HTMLElement).getByRole('button', { name: /reminder/i })

    expect(titleRow).toHaveClass('checklist-hero-title-row')
    expect(screen.getByRole('button', { name: /add (item|checklist)/i })).toHaveClass('checklist-hero-add-btn')
    await user.click(infoButton)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/reminder/i)
  })

  it('locks draft saving for free accounts while preserving send and discard actions', async () => {
    const user = userEvent.setup()
    const freeSession = structuredClone(session)
    freeSession.user.settings.membershipPlan = 'free'
    const onOpenUpgrade = vi.fn()
    renderDossier({ activeSession: freeSession, onOpenUpgrade })

    await user.click(screen.getByRole('tab', { name: /draft email/i }))

    expect(screen.getByRole('button', { name: /send now/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^discard$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /schedule send/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save draft/i }))
    expect(onOpenUpgrade).toHaveBeenCalledWith('draft-mailbox', 'draft-mailbox', 'free')

    await user.type(screen.getByPlaceholderText(/email subject/i), 'Follow-up')
    await user.click(screen.getByRole('button', { name: /^discard$/i }))

    const dialog = screen.getByRole('alertdialog', { name: /what would you like to do with this email/i })
    expect(within(dialog).getByRole('button', { name: /^send$/i })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
  })

  it('reports the visual direction with a tab selection', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderDossier({ tab: 'materials', onTab })

    await user.click(screen.getByRole('tab', { name: /dossier/i }))

    expect(onTab).toHaveBeenCalledWith('dossier', 'backward')
  })

  it('keeps the checklist upload dialog mounted through its exit animation', async () => {
    const user = userEvent.setup()
    renderDossier({ tab: 'materials' })

    await user.click(screen.getAllByRole('button', { name: /upload attachment/i })[0])
    const dialog = screen.getByRole('dialog', { name: /upload attachment/i })
    await user.keyboard('{Escape}')

    expect(dialog.closest('.checklist-upload-layer')).toHaveClass('exiting')
    // The exit state is applied synchronously. Under a busy parallel suite, the
    // short removal timer may finish before user-event yields back to this assertion.
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('keeps the composer warning mounted while its cancel animation runs', async () => {
    const user = userEvent.setup()
    renderDossier()

    await user.click(screen.getByRole('tab', { name: /draft email/i }))
    await user.type(screen.getByPlaceholderText(/email subject/i), 'Draft to preserve')
    await user.click(screen.getByRole('button', { name: /close composer/i }))

    const dialog = screen.getByRole('alertdialog', { name: /what would you like to do with this email/i })
    expect(within(dialog).getByRole('button', { name: /^send$/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^save draft$/i })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(dialog.closest('.dialog-layer')).toHaveClass('exiting')
    expect(dialog).toBeInTheDocument()
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('animates the dossier warning before running its discard continuation', async () => {
    vi.useFakeTimers()
    const onDiscardDraft = vi.fn()
    const proceed = vi.fn()
    let navigationGuard: ((proceed: () => void) => boolean) | null = null
    renderDossier({
      isDirty: true,
      onDiscardDraft,
      onRegisterNavigationGuard: (guard) => { navigationGuard = guard },
    })

    expect(navigationGuard).not.toBeNull()
    act(() => {
      expect(navigationGuard?.(proceed)).toBe(true)
    })

    const dialog = screen.getByRole('alertdialog', { name: /save these changes/i })
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))

    expect(dialog.closest('.dialog-layer')).toHaveClass('exiting')
    expect(onDiscardDraft).not.toHaveBeenCalled()
    expect(proceed).not.toHaveBeenCalled()
    act(() => vi.runAllTimers())
    expect(onDiscardDraft).toHaveBeenCalledOnce()
    expect(proceed).toHaveBeenCalledOnce()
  })
})

describe('DossierView timeline scroll motion', () => {
  it('keeps lazy-painted rows visible without IntersectionObserver and preserves the Today action exit slot', () => {
    renderDossier({ tab: 'timeline' })

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-timeline-scroll-reveal]'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.classList.contains('is-scroll-revealed'))).toBe(true)

    const todaySlot = document.querySelector('.timeline-jump-today-slot')
    const todayButton = screen.getByRole('button', { name: /go to today/i, hidden: true })
    expect(todaySlot).toHaveClass('is-hidden')
    expect(todayButton).toHaveAttribute('tabindex', '-1')
  })
})

describe('DossierView scholarship card interactions', () => {
  const scholarshipApplication = (): ApplicationRecord => ({
    ...structuredClone(applications[0]),
    ownerId: session.user.id,
    scholarships: [{
      id: 'scholarship-card',
      name: 'Graduate fellowship',
      amount: 'Full funding',
      startDate: '2026-09-01',
      endDate: '2026-11-01',
      materials: [{
        id: 'budget-statement',
        name: 'Budget statement',
        status: 'Draft',
        due: '2026-09-25',
      }],
      tasks: [{
        id: 'award-rules',
        title: 'Confirm award rules',
        due: '2026-09-27',
        done: false,
      }],
      timeline: [],
    }],
  })

  it('persists one-click material and task completion from the browsing card', async () => {
    const user = userEvent.setup()
    const onUpdateScholarship = vi.fn(() => new Promise<void>(() => {}))
    renderDossier({ tab: 'funding', application: scholarshipApplication(), onUpdateScholarship })

    const completionControls = screen.getAllByRole('button', { name: /mark complete/i })
    await user.click(completionControls[0])
    expect(completionControls[0]).toHaveAttribute('aria-pressed', 'true')
    expect(onUpdateScholarship).toHaveBeenLastCalledWith(
      'scholarship-card',
      expect.objectContaining({
        materials: [expect.objectContaining({ id: 'budget-statement', status: 'Submitted' })],
      }),
    )

    await user.click(completionControls[0])
    expect(completionControls[0]).toHaveAttribute('aria-pressed', 'false')
    expect(onUpdateScholarship).toHaveBeenLastCalledWith(
      'scholarship-card',
      expect.objectContaining({
        materials: [expect.objectContaining({ id: 'budget-statement', status: 'Draft' })],
      }),
    )

    await user.click(completionControls[1])
    expect(completionControls[1]).toHaveAttribute('aria-pressed', 'true')
    expect(onUpdateScholarship).toHaveBeenLastCalledWith(
      'scholarship-card',
      expect.objectContaining({
        tasks: [expect.objectContaining({ id: 'award-rules', done: true })],
      }),
    )
  })

  it('changes a scholarship status from its context menu', async () => {
    const user = userEvent.setup()
    const onUpdateScholarship = vi.fn()
    renderDossier({ tab: 'funding', application: scholarshipApplication(), onUpdateScholarship })

    const card = document.getElementById('scholarship-scholarship-card')
    expect(card).toBeInTheDocument()
    fireEvent.contextMenu(card!, { clientX: 120, clientY: 120 })

    await user.click(screen.getByRole('menuitem', { name: 'explorer.changeStatus' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Awarded' }))

    expect(onUpdateScholarship).toHaveBeenCalledWith(
      'scholarship-card',
      expect.objectContaining({ status: 'Awarded' }),
    )
  })

  it('returns the editor to the browsing card after the scholarship save resolves', async () => {
    const user = userEvent.setup()
    let resolveSave: (() => void) | undefined
    const onUpdateScholarship = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve
    }))
    renderDossier({ tab: 'funding', application: scholarshipApplication(), onUpdateScholarship })

    await user.click(screen.getByRole('button', { name: 'explorer.edit' }))
    await user.click(screen.getByRole('button', { name: /^save changes$/i }))

    const card = document.getElementById('scholarship-scholarship-card')
    expect(card).toHaveClass('saving')

    resolveSave?.()
    await waitFor(() => expect(card).not.toHaveClass('editing'))
  })

  it('asks whether to save when the active edit control closes a changed editor', async () => {
    const user = userEvent.setup()
    const onUpdateScholarship = vi.fn().mockResolvedValue(undefined)
    renderDossier({ tab: 'funding', application: scholarshipApplication(), onUpdateScholarship })

    await user.click(screen.getByRole('button', { name: 'explorer.edit' }))
    const nameInput = screen.getByDisplayValue('Graduate fellowship')
    await user.clear(nameInput)
    await user.type(nameInput, 'Doctoral excellence award')
    const activeEditControl = document.querySelector<HTMLButtonElement>('.funding-mini-btn.active')
    expect(activeEditControl).toBeInTheDocument()
    await user.click(activeEditControl!)

    const dialog = screen.getByRole('alertdialog', { name: 'Save this edit?' })
    expect(dialog).toHaveTextContent('This editor has unsaved changes')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onUpdateScholarship).toHaveBeenCalledWith(
      'scholarship-card',
      expect.objectContaining({ name: 'Doctoral excellence award' }),
    ))
  })
})
