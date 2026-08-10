import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AuthSession,
  ProfileAsset,
  ProfilePreset,
  ProfileRecommender,
  UserSettingsPatch,
} from '../../api/phdApi'
import { applications as applicationFixtures, type ApplicationRecord } from '../../data/applications'
import { getDict, registerLanguage, t, tpl, type LangDict } from '../../i18n'
import englishProfile from '../../i18n/en/profile.json'
import { I18nContext } from '../hooks/useI18n'
import { ProfileScreen } from './ProfileScreen'

registerLanguage('en', englishProfile as LangDict, 'profile')

afterEach(() => {
  vi.unstubAllGlobals()
})

const session: AuthSession = {
  token: 'profile-test-token',
  user: {
    id: 'profile-user',
    name: 'Profile User',
    email: 'profile@example.com',
    role: 'user',
    createdAt: '2026-07-15T00:00:00.000Z',
    lastLoginAt: null,
    settings: { language: 'en', highContrast: false, themeAccent: '#0071e3' },
  },
  settings: {
    allowRegistration: true,
    notificationMailbox: 'alerts@example.com',
    backupFrequency: 'weekly',
    encryptionAtRest: true,
  },
}

function renderProfile(
  onUpdateSettings: (patch: UserSettingsPatch, message?: string) => void,
  profilePresets?: ProfilePreset[],
  assets: ProfileAsset[] = [],
  removingAssetIds?: ReadonlySet<string>,
  applications: ApplicationRecord[] = [],
  onUpdateProfileRecommenders?: (
    nextProfiles: ProfileRecommender[],
    baseProfiles: ProfileRecommender[],
  ) => void | Promise<void>,
) {
  const nextSession: AuthSession = {
    ...session,
    user: { ...session.user, settings: { ...session.user.settings, ...(profilePresets === undefined ? {} : { profilePresets }) } },
  }
  return render(
    <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
      <ProfileScreen
        assets={assets}
        applications={applications}
        session={nextSession}
        onCreateSnippet={vi.fn()}
        onUpdateAsset={vi.fn()}
        onDeleteAsset={vi.fn()}
        removingAssetIds={removingAssetIds}
        onUploadFiles={vi.fn()}
        onRenameFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onDownloadFile={vi.fn()}
        onLoadFile={vi.fn(async () => new Blob(['preview']))}
        onCreateShare={vi.fn()}
        onRevokeShare={vi.fn()}
        onUpdateSettings={onUpdateSettings}
        onUpdateProfileRecommenders={onUpdateProfileRecommenders}
      />
    </I18nContext.Provider>,
  )
}

describe('ProfileScreen presets', () => {
  it('keeps the profile explanation behind the title info control', () => {
    renderProfile(vi.fn())

    const description = 'Build one reliable source for your academic story, reusable materials, and writing preferences. Keep versions here, then reuse them deliberately in applications, email, and AI drafts.'
    const trigger = screen.getByRole('button', { name: description })
    const title = screen.getByRole('heading', { name: 'My Profile' })
    expect(title.parentElement).toHaveClass('profile-heading-title-row')
    expect(title.parentElement).toContainElement(trigger)
    const tooltip = document.querySelector('.info-tooltip-portal')!
    expect(tooltip).not.toHaveClass('is-open')

    fireEvent.click(trigger)
    expect(tooltip).toHaveClass('is-open')
    expect(tooltip).toHaveTextContent(description)

    fireEvent.click(trigger)
    expect(tooltip).not.toHaveClass('is-open')
  })

  it('switches between application materials and the private recommender workspace', async () => {
    const user = userEvent.setup()
    const view = renderProfile(vi.fn())

    await user.click(screen.getByRole('tab', { name: 'Recommenders' }))
    expect(screen.getByRole('heading', { name: 'Recommenders' })).toBeInTheDocument()
    expect(screen.getByText('No recommenders yet')).toBeInTheDocument()
    expect(view.container.querySelector('.profile-domain-pane.is-recommenders')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search snippets…')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Application materials' }))
    expect(view.container.querySelector('.profile-domain-pane.is-materials')).toBeInTheDocument()
  })

  it('automatically includes a saved application teacher even when a legacy personal record has no owner id', async () => {
    const user = userEvent.setup()
    const application = structuredClone(applicationFixtures[0])
    delete application.ownerId
    application.recommenders = [{
      id: 'application-teacher',
      name: 'Professor Jim Wright',
      contact: 'jim.wright@example.edu',
    }]
    renderProfile(vi.fn(), undefined, [], undefined, [application])

    await user.click(screen.getByRole('tab', { name: 'Recommenders' }))

    expect(screen.getByText('Professor Jim Wright')).toBeInTheDocument()
    expect(screen.getByText('jim.wright@example.edu')).toBeInTheDocument()
  })

  it('routes recommender edits through the atomic directory callback with the resident base snapshot', async () => {
    const user = userEvent.setup()
    const onUpdateSettings = vi.fn()
    let settleSave!: () => void
    const onUpdateProfileRecommenders = vi.fn(
      (_nextProfiles: ProfileRecommender[], _baseProfiles: ProfileRecommender[]) => new Promise<void>((resolve) => {
        settleSave = resolve
      }),
    )
    renderProfile(onUpdateSettings, undefined, [], undefined, [], onUpdateProfileRecommenders)

    await user.click(screen.getByRole('tab', { name: 'Recommenders' }))
    await user.click(screen.getAllByRole('button', { name: 'Add recommender' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Add recommender' })
    await user.type(within(dialog).getByLabelText('Name'), 'Professor Grace Hopper')
    await user.type(within(dialog).getByLabelText('Email'), 'grace.hopper@example.edu')
    await user.type(within(dialog).getByLabelText('Phone'), '+1 202 555 0180')
    await user.click(within(dialog).getByRole('button', { name: 'Save recommender' }))

    expect(onUpdateSettings).not.toHaveBeenCalled()
    expect(onUpdateProfileRecommenders).toHaveBeenCalledTimes(1)
    const [nextProfiles, baseProfiles] = onUpdateProfileRecommenders.mock.calls[0]
    expect(baseProfiles).toEqual([])
    expect(nextProfiles).toEqual([
      expect.objectContaining({
        name: 'Professor Grace Hopper',
        email: 'grace.hopper@example.edu',
        phone: '+1 202 555 0180',
      }),
    ])
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled()

    settleSave()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add recommender' })).not.toBeInTheDocument())
  })

  it('switches smoothly between grouped cards and the compact snippet list', async () => {
    const user = userEvent.setup()
    const assets: ProfileAsset[] = [
      { id: 'view-cv', name: 'General CV', kind: 'CV', description: 'Academic CV.', attachments: [] },
      { id: 'view-sop', name: 'Core SOP', kind: 'SOP', description: 'Reusable statement.', attachments: [] },
    ]
    const view = renderProfile(vi.fn(), undefined, assets)

    expect(view.container.querySelector('.profile-library-view.is-cards')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'List view' }))

    expect(view.container.querySelector('.profile-library-view.is-list')).toBeInTheDocument()
    expect(view.container.querySelectorAll('.profile-snippet-list-row')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Card view' }))
    expect(view.container.querySelector('.profile-library-view.is-cards')).toBeInTheDocument()
  })

  it('keeps a confirmed single material mounted with a collapsing exit class', () => {
    const asset: ProfileAsset = {
      id: 'statement-delete',
      name: 'Research statement',
      kind: 'Research statement',
      description: 'A focused research plan.',
      attachments: [],
      updatedAt: '2026-07-17T00:00:00.000Z',
    }

    const view = renderProfile(vi.fn(), undefined, [asset], new Set([asset.id]))
    expect(view.container.querySelector('.snippet-stack')).toHaveClass('is-removing')
  })

  it('animates only the target version out of an expanded material stack', async () => {
    const user = userEvent.setup()
    const assets: ProfileAsset[] = [
      { id: 'cv-one', name: 'General CV', kind: 'CV', description: 'General.', attachments: [] },
      { id: 'cv-two', name: 'Robotics CV', kind: 'CV', description: 'Robotics.', attachments: [] },
    ]
    const view = renderProfile(vi.fn(), undefined, assets, new Set(['cv-two']))

    await user.click(screen.getByRole('button', { name: /expand group: CV \/ Resume/i }))
    expect(view.container.querySelector('.snippet-stack')).not.toHaveClass('is-removing')
    expect(view.container.querySelector('.snippet-stack-version')).toHaveClass('is-removing')
  })

  it('creates a preset without showing file upload controls and stores it in preset settings', async () => {
    const user = userEvent.setup()
    let savedPresets: ProfilePreset[] | undefined
    const onUpdateSettings = vi.fn((patch: UserSettingsPatch) => {
      savedPresets = patch.profilePresets
    })
    const view = renderProfile(onUpdateSettings)

    await user.click(screen.getByRole('button', { name: /add custom preset/i }))
    const dialog = screen.getByRole('dialog', { name: /create preset/i })
    expect(dialog).not.toHaveTextContent('Attachments')
    expect(dialog).not.toHaveTextContent('Upload files')

    await user.type(screen.getByLabelText('Name'), 'My project portfolio pack')
    const guides = screen.getAllByLabelText(/guide$/i)
    await user.type(guides[0], 'Portfolio projects and evidence')
    await user.type(guides[1], '作品与项目证明')
    await user.click(screen.getByRole('button', { name: /save preset/i }))

    expect(onUpdateSettings).toHaveBeenCalledTimes(1)
    expect(savedPresets?.some((preset) => (
      preset.nameEn === 'My project portfolio pack'
      && preset.nameZh === 'My project portfolio pack'
      && preset.descriptionEn === 'Portfolio projects and evidence'
      && preset.descriptionZh === '作品与项目证明'
    ))).toBe(true)

    view.unmount()
    renderProfile(vi.fn(), savedPresets)
    expect(screen.getByText('My project portfolio pack', { selector: '.profile-preset-card strong' })).toBeInTheDocument()
  })

  it('keeps a custom preset editor open until its settings write settles', async () => {
    const user = userEvent.setup()
    let resolveSave!: () => void
    const onUpdateSettings = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve
    }))
    renderProfile(onUpdateSettings)

    await user.click(screen.getByRole('button', { name: /add custom preset/i }))
    const dialog = screen.getByRole('dialog', { name: /create preset/i })
    await user.type(screen.getByLabelText('Name'), 'Durable preset')
    const guides = screen.getAllByLabelText(/guide$/i)
    await user.type(guides[0], 'Primary guide')
    await user.type(guides[1], 'Secondary guide')
    await user.click(screen.getByRole('button', { name: /save preset/i }))

    expect(onUpdateSettings).toHaveBeenCalledTimes(1)
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /working/i })).toBeDisabled()

    resolveSave()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /create preset/i })).not.toBeInTheDocument(), {
      timeout: 1000,
    })
  })

  it('offers custom presets from the Add snippet template picker', async () => {
    const user = userEvent.setup()
    const customPreset: ProfilePreset = {
      id: 'portfolio-template',
      kind: 'Other',
      nameEn: 'Fieldwork portfolio',
      nameZh: '田野作品集',
      descriptionEn: 'Selected fieldwork, evidence, and project context.',
      descriptionZh: '精选田野工作、证明材料与项目背景。',
      contentEn: 'Start with the fieldwork project that most directly supports this application.',
      contentZh: '从最能支持本次申请的田野项目开始。',
      icon: 'briefcase',
      color: 'teal',
      builtIn: false,
    }
    renderProfile(vi.fn(), [customPreset])

    await user.click(screen.getAllByRole('button', { name: /add snippet/i })[0])
    const dialog = await screen.findByRole('dialog', { name: /add snippet/i }, { timeout: 5000 })
    const template = within(dialog).getByRole('button', { name: 'Fieldwork portfolio' })

    await user.click(template)

    expect(template).toHaveClass('active')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Fieldwork portfolio')
    expect(within(dialog).getByText('Start with the fieldwork project that most directly supports this application.')).toBeInTheDocument()
  })

  it('automatically stacks same-type materials and expands them as equal item cards', async () => {
    const user = userEvent.setup()
    const assets: ProfileAsset[] = [
      {
        id: 'cv-general',
        name: 'General CV',
        kind: 'CV',
        description: 'Broad academic CV for general applications.',
        familyId: 'legacy-family-one',
        isPrimary: true,
        attachments: [],
        updatedAt: '2026-07-16T00:00:00.000Z',
      },
      {
        id: 'cv-robotics',
        name: 'Robotics CV',
        kind: 'CV',
        description: 'Robotics-focused projects and publications.',
        familyId: 'legacy-family-two',
        isPrimary: true,
        attachments: [],
        updatedAt: '2026-07-17T00:00:00.000Z',
      },
    ]

    const view = renderProfile(vi.fn(), undefined, assets)
    expect(view.container.querySelectorAll('.snippet-stack')).toHaveLength(1)
    const stack = view.container.querySelector('.snippet-stack') as HTMLElement
    const grid = stack.parentElement as HTMLElement
    const getFront = () => stack.querySelector<HTMLElement>(
      ':scope > .snippet-stack-front',
    ) as HTMLElement
    let front = getFront()
    const expandedCards = stack.nextElementSibling as HTMLElement
    expect(front).toBeInTheDocument()
    expect(front).toHaveClass('snippet-stack-card-layout')
    expect(expandedCards).toBeInTheDocument()
    expect(expandedCards).toHaveClass('snippet-stack-flow')
    expect(front).not.toContainElement(expandedCards)

    const stackButton = screen.getByRole('button', { name: /expand group: CV \/ Resume/i })
    expect(stackButton).toHaveAttribute('aria-expanded', 'false')
    const familyCount = within(front).getByText('2 items')
    expect(familyCount).not.toHaveAttribute('aria-hidden')
    const currentMaterialButton = within(front).getByRole('button', { name: /open material:/i })
    const currentMaterialLabel = currentMaterialButton.getAttribute('aria-label')

    fireEvent.wheel(front, { deltaY: 80 })
    expect(stack).toHaveClass('is-turning')
    const wheelIncoming = stack.querySelector('.is-deck-incoming') as HTMLElement
    expect(wheelIncoming).toBeInTheDocument()
    expect(front).toHaveClass('is-deck-outgoing')
    expect(stackButton).toHaveAttribute('aria-expanded', 'false')

    await waitFor(() => {
      expect(within(getFront()).getByRole('button', { name: /open material:/i })).not.toHaveAttribute('aria-label', currentMaterialLabel)
    }, { timeout: 800 })
    front = getFront()
    expect(front).toBe(wheelIncoming)
    fireEvent.pointerDown(front, { pointerId: 17, pointerType: 'touch', clientX: 180, clientY: 180 })
    fireEvent.pointerMove(front, { pointerId: 17, pointerType: 'touch', clientX: 52, clientY: 184 })
    const movingLayer = stack.querySelector('.snippet-stack-deck-card:not(.snippet-stack-front)') as HTMLElement
    await waitFor(() => {
      expect(front).toHaveClass('is-swiping')
      expect(front.style.transform).toContain('translate3d')
      expect(Number(front.style.opacity)).toBeLessThan(1)
      expect(movingLayer.style.transform).not.toBe('')
    })
    fireEvent.pointerUp(front, { pointerId: 17, pointerType: 'touch', clientX: 52, clientY: 184 })
    const gestureIncoming = stack.querySelector('.is-deck-incoming') as HTMLElement
    expect(stack).toHaveClass('is-turning-forward', 'is-gesture-turn')
    expect(front.style.getPropertyValue('--snippet-deck-turn-from')).not.toBe('')
    expect(front.style.getPropertyValue('--snippet-deck-turn-opacity-from')).not.toBe('')
    expect(gestureIncoming.style.getPropertyValue('--snippet-deck-turn-from')).not.toBe('')
    expect(gestureIncoming.style.getPropertyValue('--snippet-deck-turn-opacity-from')).not.toBe('')
    await waitFor(() => {
      expect(within(getFront()).getByRole('button', { name: /open material:/i })).toHaveAttribute('aria-label', currentMaterialLabel)
    }, { timeout: 800 })
    expect(front.style.getPropertyValue('--snippet-deck-turn-from')).toBe('')
    front = getFront()
    expect(front).toBe(gestureIncoming)

    fireEvent.pointerDown(front, { pointerId: 18, pointerType: 'touch', clientX: 52, clientY: 184 })
    fireEvent.pointerMove(front, { pointerId: 18, pointerType: 'touch', clientX: 180, clientY: 180 })
    fireEvent.pointerUp(front, { pointerId: 18, pointerType: 'touch', clientX: 180, clientY: 180 })
    expect(stack).toHaveClass('is-turning-backward', 'is-gesture-turn')
    await waitFor(() => {
      expect(within(getFront()).getByRole('button', { name: /open material:/i })).not.toHaveAttribute('aria-label', currentMaterialLabel)
    }, { timeout: 800 })
    front = getFront()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.wheel(front, { deltaY: -80 })
    expect(stack).toHaveClass('is-turning-backward')
    const reverseWheelIncoming = stack.querySelector('.is-deck-incoming') as HTMLElement
    await waitFor(() => {
      expect(within(getFront()).getByRole('button', { name: /open material:/i })).toHaveAttribute('aria-label', currentMaterialLabel)
    }, { timeout: 800 })
    front = getFront()
    expect(front).toBe(reverseWheelIncoming)

    const movingSibling = grid.querySelector<HTMLElement>(':scope > .snippet-card-add') as HTMLElement
    const animationCancel = vi.fn()
    const layoutAnimate = vi.fn(() => ({ cancel: animationCancel }) as unknown as Animation)
    Object.defineProperty(movingSibling, 'animate', { configurable: true, value: layoutAnimate })
    vi.spyOn(movingSibling, 'getBoundingClientRect').mockImplementation(() => {
      const x = stack.classList.contains('is-expanded') ? 504 : 252
      return {
        x,
        y: 0,
        left: x,
        top: 0,
        right: x + 224,
        bottom: 278,
        width: 224,
        height: 278,
        toJSON: () => ({}),
      }
    })

    await user.click(stackButton)

    expect(stackButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(getFront()).getByText('2 items')).toHaveAttribute('aria-hidden', 'true')
    expect(within(expandedCards).queryByText('2 items')).not.toBeInTheDocument()
    expect(front).toHaveAttribute('aria-hidden', 'false')
    expect(expandedCards).toHaveClass('open')
    expect(stack.querySelector(':scope > .is-deck-incoming')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit snippet: General CV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit snippet: Robotics CV' })).toBeInTheDocument()
    const cards = [...expandedCards.querySelectorAll<HTMLElement>('.snippet-stack-version')]
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveClass('snippet-stack-card-layout')
    expect(stack.style.getPropertyValue('--snippet-stack-expanded-width')).toBe('476px')
    expect(cards[0]?.style.getPropertyValue('--snippet-version-index')).toBe('1')
    expect(cards[0]?.style.getPropertyValue('--snippet-version-origin-x')).toBe('-244px')
    expect(cards[0]?.style.getPropertyValue('--snippet-version-mobile-origin-x')).toBe('calc(-100% - 12px)')
    expect(cards[0]?.style.getPropertyValue('--snippet-version-mobile-origin-y')).toBe('8px')
    expect(front.querySelector('.snippet-card-info')).toBeInTheDocument()
    expect(cards[0]?.querySelector('.snippet-card-info')).toBeInTheDocument()
    expect(cards[0]?.querySelector('.snippet-card-title-row')).toBeInTheDocument()
    expect(layoutAnimate).toHaveBeenCalledWith(
      [
        { transform: 'translate3d(-252px, 0px, 0)' },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      expect.objectContaining({ duration: 560 }),
    )
    expect(stack.querySelector('.snippet-version-add')).not.toBeInTheDocument()
    expect(screen.queryByText(/version family/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /collapse group: CV \/ Resume/i }))
    expect(stackButton).toHaveAttribute('aria-expanded', 'false')
    expect(front).toHaveAttribute('aria-hidden', 'false')
    expect(expandedCards).not.toHaveClass('open')
    expect(stack.querySelector(':scope > .snippet-stack-deck-card:not(.snippet-stack-front)')).toBeInTheDocument()
    expect(animationCancel).toHaveBeenCalled()
  })

  it('chains continuous wheel input through one buffered turn and animates only visible deck cards', async () => {
    const assets: ProfileAsset[] = Array.from({ length: 7 }, (_, index) => ({
      id: `cv-${index + 1}`,
      name: `CV ${index + 1}`,
      kind: 'CV',
      description: `Version ${index + 1}.`,
      attachments: [],
      updatedAt: `2026-07-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`,
    }))

    const view = renderProfile(vi.fn(), undefined, assets)
    const stack = view.container.querySelector('.snippet-stack.has-stack') as HTMLElement
    const getFront = () => stack.querySelector<HTMLElement>(':scope > .snippet-stack-front') as HTMLElement
    const front = getFront()
    const getAnimations = vi.fn(() => [])
    stack.querySelectorAll<HTMLElement>('.snippet-stack-deck-card').forEach((card) => {
      Object.defineProperty(card, 'getAnimations', {
        configurable: true,
        value: getAnimations,
      })
    })

    fireEvent.wheel(front, { deltaY: 12 })
    fireEvent.wheel(front, { deltaY: 12 })
    fireEvent.wheel(front, { deltaY: 12 })
    expect(stack).not.toHaveClass('is-turning')

    fireEvent.wheel(front, { deltaY: 12 })
    expect(stack).toHaveClass('is-turning-forward')
    const firstIncoming = stack.querySelector('.is-deck-incoming') as HTMLElement
    const firstOutgoingId = stack.querySelector('.is-deck-outgoing')?.getAttribute('data-asset-id')
    expect(firstIncoming).toBeInTheDocument()
    expect(stack.querySelectorAll('.is-deck-active-turn')).toHaveLength(5)
    expect(stack.querySelectorAll('.is-deck-dormant')).toHaveLength(2)

    // A sustained, non-decaying stream requests another turn while the first is
    // active. Further input is intentionally coalesced into the same one-slot
    // buffer, so releasing the wheel never replays a long delayed queue.
    for (let index = 0; index < 20; index += 1) {
      fireEvent.wheel(front, { deltaY: 12 })
    }

    expect(stack.querySelector('.is-deck-outgoing')).toHaveAttribute('data-asset-id', firstOutgoingId)
    expect(stack.querySelector('.is-deck-incoming')).toBe(firstIncoming)
    expect(getAnimations).not.toHaveBeenCalled()

    fireEvent.animationEnd(stack.querySelector('.is-deck-outgoing') as HTMLElement)
    const secondTurn = await waitFor(() => {
      const incoming = stack.querySelector<HTMLElement>('.is-deck-incoming')
      const outgoing = stack.querySelector<HTMLElement>('.is-deck-outgoing')
      expect(stack).toHaveClass('is-turning-forward')
      expect(incoming).not.toBeNull()
      expect(incoming).not.toBe(firstIncoming)
      expect(outgoing).not.toBeNull()
      return { incoming: incoming!, outgoing: outgoing! }
    })
    fireEvent.animationEnd(secondTurn.outgoing)

    await waitFor(() => {
      expect(getFront()).toBe(secondTurn.incoming)
      expect(stack).not.toHaveClass('is-turning')
    })
  })

  it('does not turn again for the decaying tail of a wheel gesture', async () => {
    const assets: ProfileAsset[] = [
      { id: 'cv-one', name: 'First CV', kind: 'CV', description: 'First.', attachments: [] },
      { id: 'cv-two', name: 'Second CV', kind: 'CV', description: 'Second.', attachments: [] },
      { id: 'cv-three', name: 'Third CV', kind: 'CV', description: 'Third.', attachments: [] },
    ]
    const view = renderProfile(vi.fn(), undefined, assets)
    const stack = view.container.querySelector('.snippet-stack.has-stack') as HTMLElement
    const getFront = () => stack.querySelector<HTMLElement>(':scope > .snippet-stack-front') as HTMLElement
    const firstFront = getFront()

    fireEvent.wheel(firstFront, { deltaY: 60 })
    const firstIncoming = stack.querySelector('.is-deck-incoming') as HTMLElement
    expect(stack).toHaveClass('is-turning-forward')

    for (const deltaY of [42, 30, 20, 10, 4]) {
      fireEvent.wheel(firstFront, { deltaY })
    }
    fireEvent.animationEnd(stack.querySelector('.is-deck-outgoing') as HTMLElement)

    await waitFor(() => {
      expect(getFront()).toBe(firstIncoming)
      expect(stack).not.toHaveClass('is-turning')
    })
  })

  it('captures wheel input only while a collapsed material family can turn', async () => {
    const user = userEvent.setup()
    const assets: ProfileAsset[] = [
      { id: 'cv-one', name: 'First CV', kind: 'CV', description: 'First.', attachments: [] },
      { id: 'cv-two', name: 'Second CV', kind: 'CV', description: 'Second.', attachments: [] },
    ]
    const view = renderProfile(vi.fn(), undefined, assets)
    const stack = view.container.querySelector('.snippet-stack.has-stack') as HTMLElement
    const front = stack.querySelector(':scope > .snippet-stack-front') as HTMLElement
    const dispatchWheel = (target: Element, init: WheelEventInit) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
      fireEvent(target, event)
      return event
    }

    expect(dispatchWheel(front, { deltaY: 80, ctrlKey: true }).defaultPrevented).toBe(false)
    expect(dispatchWheel(front, { deltaY: 0 }).defaultPrevented).toBe(false)
    expect(stack).not.toHaveClass('is-turning')

    await user.click(screen.getByRole('button', { name: /expand group: CV \/ Resume/i }))
    expect(dispatchWheel(front, { deltaY: 80 }).defaultPrevented).toBe(false)
    expect(stack).not.toHaveClass('is-turning')

    await user.click(screen.getByRole('button', { name: /collapse group: CV \/ Resume/i }))
    expect(dispatchWheel(front, { deltaY: 80 }).defaultPrevented).toBe(true)
    expect(stack).toHaveClass('is-turning')
  })

  it('settles a wheel turn immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
    const assets: ProfileAsset[] = [
      { id: 'cv-one', name: 'First CV', kind: 'CV', description: 'First.', attachments: [] },
      { id: 'cv-two', name: 'Second CV', kind: 'CV', description: 'Second.', attachments: [] },
    ]
    const view = renderProfile(vi.fn(), undefined, assets)
    const stack = view.container.querySelector('.snippet-stack.has-stack') as HTMLElement
    const front = stack.querySelector(':scope > .snippet-stack-front') as HTMLElement

    fireEvent.wheel(front, { deltaY: 80 })

    expect(stack).not.toHaveClass('is-turning')
    expect(stack.querySelector(':scope > .snippet-stack-front')).not.toBe(front)
  })

  it('places insert-phrase controls and preview before attachments in the editor', async () => {
    const user = userEvent.setup()
    renderProfile(vi.fn())

    await user.click(screen.getAllByRole('button', { name: /add snippet/i })[0])
    const dialog = await screen.findByRole('dialog', { name: /add snippet/i }, { timeout: 5000 })
    const phrase = within(dialog).getByText('Insert-phrase names')
    const preview = within(dialog).getByText('Insert-phrase preview')
    const attachments = within(dialog).getByText('Attachments')

    expect(phrase.compareDocumentPosition(attachments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(preview.compareDocumentPosition(attachments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(dialog).queryByText(/version family/i)).not.toBeInTheDocument()
  })
})
