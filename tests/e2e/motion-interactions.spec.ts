import { expect, test } from '@playwright/test'

type MotionAuditWindow = Window & {
  __atlasIntermediateSkeletons?: string[]
  __atlasFallbackScopes?: string[]
  __atlasFallbackPhases?: string[]
  __atlasNativeScopes?: string[]
  __atlasMotionAuditObserver?: MutationObserver
}

const genericDossierDeferredClassNames = ['dossier-list-deferred'] as const
const dossierSummaryDeferredClassNames = [
  'dossier-secondary-deferred',
  'resource-card-list-deferred',
] as const
const intermediateSkeletonSelector = [
  '.screen-skeleton',
  ...genericDossierDeferredClassNames.map((className) => `.${className}`),
  ...dossierSummaryDeferredClassNames.map((className) => `.${className}`),
].join(', ')

async function resetMotionAudit(page: import('@playwright/test').Page) {
  await page.evaluate((selector) => {
    const runtimeWindow = window as MotionAuditWindow
    runtimeWindow.__atlasIntermediateSkeletons = []
    runtimeWindow.__atlasFallbackScopes = []
    runtimeWindow.__atlasFallbackPhases = []
    runtimeWindow.__atlasNativeScopes = []

    const captureSkeleton = (element: Element) => {
      const skeletons = runtimeWindow.__atlasIntermediateSkeletons ?? []
      const candidates = [
        ...(element.matches(selector) ? [element as HTMLElement] : []),
        ...element.querySelectorAll<HTMLElement>(selector),
      ]
      for (const candidate of candidates) {
        const label = candidate.className || candidate.tagName.toLowerCase()
        if (!skeletons.includes(label)) skeletons.push(label)
      }
      runtimeWindow.__atlasIntermediateSkeletons = skeletons
    }

    const capture = (records: MutationRecord[] = []) => {
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (node instanceof Element) captureSkeleton(node)
          }
        } else if (record.target instanceof Element) {
          captureSkeleton(record.target)
        }
      }
      for (const element of document.querySelectorAll<HTMLElement>(selector)) captureSkeleton(element)

      const scope = document.documentElement.dataset.atlasFallbackScope
      const scopes = runtimeWindow.__atlasFallbackScopes ?? []
      if (scope && !scopes.includes(scope)) scopes.push(scope)
      runtimeWindow.__atlasFallbackScopes = scopes

      const phase = document.documentElement.dataset.atlasFallbackPhase
      const phases = runtimeWindow.__atlasFallbackPhases ?? []
      if (phase && !phases.includes(phase)) phases.push(phase)
      runtimeWindow.__atlasFallbackPhases = phases

      const nativeScope = document.documentElement.dataset.atlasTransitionScope
      const nativeScopes = runtimeWindow.__atlasNativeScopes ?? []
      if (nativeScope && !nativeScopes.includes(nativeScope)) nativeScopes.push(nativeScope)
      runtimeWindow.__atlasNativeScopes = nativeScopes
    }

    runtimeWindow.__atlasMotionAuditObserver?.disconnect()
    runtimeWindow.__atlasMotionAuditObserver = new MutationObserver((records) => capture(records))
    runtimeWindow.__atlasMotionAuditObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-atlas-fallback-scope', 'data-atlas-transition-scope'],
      childList: true,
      subtree: true,
    })
    capture()
  }, intermediateSkeletonSelector)
}

async function expectSmoothHandoff(
  page: import('@playwright/test').Page,
  expectedScope: string,
  {
    expectedDeferredDossierShells = [],
    expectedEngine = 'css',
  }: {
    expectedDeferredDossierShells?: readonly string[]
    expectedEngine?: 'css' | 'native' | 'either'
  } = {},
) {
  // Let the 120-160ms exit and 220-240ms enter handoff finish so mutation
  // observer callbacks have consumed every intermediate DOM frame.
  await page.waitForTimeout(460)
  const audit = await page.evaluate(() => {
    const runtimeWindow = window as MotionAuditWindow
    return {
      skeletons: runtimeWindow.__atlasIntermediateSkeletons ?? [],
      scopes: runtimeWindow.__atlasFallbackScopes ?? [],
      phases: runtimeWindow.__atlasFallbackPhases ?? [],
      nativeScopes: runtimeWindow.__atlasNativeScopes ?? [],
    }
  })

  if (expectedDeferredDossierShells.length > 0) {
    for (const className of expectedDeferredDossierShells) {
      expect(
        audit.skeletons.some((skeleton) => skeleton.includes(className)),
        `the ${className} shell should keep heavy dossier content out of the transition snapshot`,
      ).toBe(true)
    }
  } else {
    expect(audit.skeletons, 'a full-screen handoff must not flash a generic skeleton').toEqual([])
  }
  if (expectedEngine === 'css') {
    expect(audit.scopes, 'high-frequency interactions must stay on the composited CSS handoff').toContain(expectedScope)
    const expectedPhases = expectedScope === 'screen' || expectedScope === 'workspace-view'
      ? ['exit', 'enter']
      : ['enter']
    expect(
      audit.phases,
      expectedPhases.length === 2
        ? 'primary screen handoffs should move the outgoing surface before the incoming one enters'
        : 'rapid dossier changes should enter smoothly without delaying on an artificial exit hold',
    ).toEqual(expect.arrayContaining(expectedPhases))
    expect(audit.nativeScopes, 'the CSS handoff must not create a bitmap View Transition').not.toContain(expectedScope)
  } else if (expectedEngine === 'native') {
    expect(audit.nativeScopes, 'the interaction should use the native snapshot handoff').toContain(expectedScope)
  } else {
    expect(
      audit.scopes.includes(expectedScope) || audit.nativeScopes.includes(expectedScope),
      'the interaction should use a declared handoff scope',
    ).toBe(true)
  }
  await expect(page.locator(intermediateSkeletonSelector)).toHaveCount(0)
}

async function signIn(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    window.localStorage.setItem('phd-atlas-interface-mode', 'personal')
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (callback: IdleRequestCallback) => window.setTimeout(
        () => callback({ didTimeout: false, timeRemaining: () => 48 }),
        440,
      ),
    })
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: (handle: number) => window.clearTimeout(handle),
    })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/Email|邮箱/i).fill('jasper@example.com')
  await page.locator('input[type="password"]').fill('demo123456')
  await page.getByRole('button', { name: /^(Sign in|登录)$/ }).click()
  await expect(page.getByRole('heading', { name: /Dashboard|仪表盘/i })).toBeVisible({ timeout: 12_000 })
  // The initial launch curtain intentionally completes its own exit after the
  // dashboard is usable. Start the navigation audit after that unrelated
  // startup overlay has left the DOM.
  await expect(page.locator('.launch-screen-skeleton')).toHaveCount(0, { timeout: 2_000 })
}

test('keeps rail and dossier switches on composited handoffs', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'This test captures desktop rail and dossier motion.')
  test.setTimeout(75_000)
  await signIn(page)

  const rail = page.locator('.atlas-rail')
  const railRoutes = [
    { label: /^(Profile|用户画像)$/, path: '/profile' },
    { label: /^(Settings|系统设置)$/, path: '/settings' },
    { label: /^(Dashboard|仪表盘)$/, path: '/' },
  ]

  for (const route of railRoutes) {
    await resetMotionAudit(page)
    await rail.getByRole('button', { name: route.label }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(route.path)
    await expect(page.locator('.screen-stage')).toBeVisible()
    await expectSmoothHandoff(page, 'screen')
  }

  await resetMotionAudit(page)
  await rail.getByRole('button', { name: /^(Applications|申请项目)$/ }).click()
  const list = page.getByRole('region', { name: /Application list|申请列表/i })
  const rows = list.locator('.application-line')
  await expect(rows.first()).toBeVisible({ timeout: 12_000 })
  await expectSmoothHandoff(page, 'screen')

  await resetMotionAudit(page)
  await rows.first().click()

  const dossier = page.getByRole('region', { name: /Application dossier|申请档案/i })
  await expect(dossier).toBeVisible({ timeout: 12_000 })
  await expect(dossier.locator('.dossier-tab-panel')).toBeVisible()
  // The dossier now keeps its ready content mounted throughout this handoff.
  // A deferred shell looked like a refresh and left a visible blank beat on
  // rapid application switches, so the no-skeleton assertion is intentional.
  await expectSmoothHandoff(page, 'workspace-view')
  await expect(dossier.locator('.dossier-tab-panel')).toHaveCSS('animation-name', 'none')

  const modeToggle = page.locator('.workspace-layout-toolbar .view-mode-toggle')
  const boardButton = modeToggle.getByRole('button', { name: /^(Kanban view|看板视图)$/ })
  const listButton = modeToggle.getByRole('button', { name: /^(List view|列表视图)$/ })
  const workspaceToolbarPanel = page.locator('.workspace-layout-toolbar-panel')

  await resetMotionAudit(page)
  await workspaceToolbarPanel.hover()
  await boardButton.click()
  await expect(boardButton).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.kanban-workspace')).toBeVisible()
  await expectSmoothHandoff(page, 'workspace-view')

  await resetMotionAudit(page)
  await workspaceToolbarPanel.hover()
  await listButton.click()
  await expect(listButton).toHaveAttribute('aria-pressed', 'true')
  await expect(dossier).toBeVisible()
  await expectSmoothHandoff(page, 'workspace-view')

  const tabs = [
    {
      label: /^(Checklist|清单)$/,
      panel: '.checklist-page',
    },
    {
      label: /^(Correspondence|往来消息)$/,
      panel: '.correspondence-page',
    },
    {
      label: /^(Tuition \/ Scholarships|学费\/奖学金)$/,
      panel: '.funding-page',
    },
    {
      label: /^(Timeline|时间线)$/,
      panel: '.timeline-page',
    },
    {
      label: /^(Dossier|档案)$/,
      panel: '.dossier-summary',
    },
  ]

  for (const tab of tabs) {
    await resetMotionAudit(page)
    const tabButton = dossier.getByRole('tab', { name: tab.label })
    await tabButton.click()
    await expect(tabButton).toHaveAttribute('aria-selected', 'true')
    await expect(dossier.locator(tab.panel)).toBeVisible()
    await expectSmoothHandoff(page, 'dossier-tab')
  }
})

test('prewarms rail-critical screens before the first navigation click', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'This test captures desktop rail warmup behavior.')
  test.setTimeout(30_000)

  const requestedAt = new Map<string, number>()
  await page.route('**/ApplicationPane.tsx', async (route) => {
    requestedAt.set('application-pane', Date.now())
    await route.continue()
  })
  await page.route('**/KanbanBoard.tsx', async (route) => {
    requestedAt.set('kanban', Date.now())
    await route.continue()
  })
  await page.route('**/Inspector.tsx', async (route) => {
    requestedAt.set('inspector', Date.now())
    await route.continue()
  })
  await page.route('**/ProfileScreen.tsx', async (route) => {
    requestedAt.set('profile', Date.now())
    await route.continue()
  })
  await page.route('**/SettingsScreen.tsx', async (route) => {
    requestedAt.set('settings', Date.now())
    await route.continue()
  })

  await signIn(page)
  const dashboardReadyAt = Date.now()
  const railCriticalModules = ['application-pane', 'kanban', 'inspector', 'profile', 'settings']

  await expect.poll(
    () => railCriticalModules.every((moduleName) => requestedAt.has(moduleName)),
    { timeout: 250 },
  ).toBe(true)

  for (const moduleName of railCriticalModules) {
    expect(requestedAt.get(moduleName), `${moduleName} should start before a rail click`).toBeLessThanOrEqual(
      dashboardReadyAt + 250,
    )
  }
  expect(new URL(page.url()).pathname).toBe('/')

  const profileButton = page.locator('.atlas-rail').getByRole('button', { name: /^(Profile|用户画像)$/ })
  await expect.poll(
    () => page.evaluate(() => document.documentElement.dataset.atlasTransitionScope ?? null),
    { timeout: 500 },
  ).toBe(null)
  await profileButton.click()
  await expect.poll(
    () => page.evaluate(() => document.documentElement.dataset.atlasFallbackScope ?? null),
    { timeout: 250 },
  ).toBe('screen')
  await expect.poll(
    () => new URL(page.url()).pathname,
    { timeout: 2_000 },
  ).toBe('/profile')
})

test('waits for a cold rail screen before starting its snapshot handoff', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'This test captures desktop rail motion.')
  test.setTimeout(45_000)

  let profileModuleRequested = false
  let releaseProfileModule: (() => void) | null = null
  const profileModuleGate = new Promise<void>((resolve) => {
    releaseProfileModule = resolve
  })

  await page.route('**/ProfileScreen.tsx', async (route) => {
    profileModuleRequested = true
    await profileModuleGate
    await route.continue()
  })

  try {
    await signIn(page)
    const rail = page.locator('.atlas-rail')

    await resetMotionAudit(page)
    await rail.getByRole('button', { name: /^(Profile|用户画像)$/ }).click()
    await expect.poll(() => profileModuleRequested).toBe(true)
    await page.waitForTimeout(600)

    expect(new URL(page.url()).pathname, 'the current screen stays visible while its module is cold').toBe('/')
    await expect(page.locator(intermediateSkeletonSelector)).toHaveCount(0)
    const waitingAudit = await page.evaluate(() => {
      const runtimeWindow = window as MotionAuditWindow
      return {
        scopes: runtimeWindow.__atlasFallbackScopes ?? [],
        nativeScopes: runtimeWindow.__atlasNativeScopes ?? [],
      }
    })
    expect(waitingAudit.scopes, 'no CSS handoff starts before Profile is renderable').toEqual([])
    expect(waitingAudit.nativeScopes, 'no native snapshot starts before Profile is renderable').toEqual([])

    releaseProfileModule?.()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/profile')
    await expect(page.getByRole('heading', { name: /Snippets library|片段库/i })).toBeVisible()
    await expectSmoothHandoff(page, 'screen')
  } finally {
    releaseProfileModule?.()
  }
})

test('keeps the mobile Discover filter rail mounted through its exit animation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'This test captures the responsive Discover filter dismissal.')
  test.setTimeout(45_000)
  await signIn(page)
  await page.setViewportSize({ width: 900, height: 900 })

  await page.locator('.atlas-rail').getByRole('button', { name: /^(Discover|发现|探索)$/ }).click()
  await expect(page.locator('.discover-v2')).toBeVisible({ timeout: 12_000 })

  await page.locator('.discover-filter-button').click()
  const overlay = page.locator('.discover-mobile-overlay')
  await expect(overlay).toBeVisible()
  await overlay.getByRole('button', { name: /^(Close|关闭)$/ }).click()

  await expect(overlay).toHaveClass(/is-exiting/)
  await expect(overlay.locator('.discover-filter-rail.is-mobile')).toBeVisible()
  await expect(overlay).toHaveCount(0, { timeout: 1_000 })
})

test('keeps application handoffs and Markdown controls calm', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'This test exercises desktop hover and dossier handoff motion.')
  test.setTimeout(60_000)
  await signIn(page)

  await page.locator('.atlas-rail').getByRole('button', { name: /^(Applications|申请项目)$/ }).click()
  const list = page.getByRole('region', { name: /Application list|申请列表/i })
  const rows = list.locator('.application-line')
  await expect(rows.first()).toBeVisible({ timeout: 12_000 })
  expect(await rows.count()).toBeGreaterThan(1)

  const firstName = (await rows.first().locator('.line-main strong').innerText()).trim()
  const secondName = (await rows.nth(1).locator('.line-main strong').innerText()).trim()
  await rows.first().click()

  const dossier = page.getByRole('region', { name: /Application dossier|申请档案/i })
  await expect(dossier).toBeVisible()
  await page.waitForTimeout(520)
  await expect(dossier).toContainText(firstName)

  await resetMotionAudit(page)
  await rows.nth(1).click()
  await expect(dossier.locator('.screen-skeleton')).toHaveCount(0)
  await expect(dossier).toContainText(secondName, { timeout: 4_000 })
  await expectSmoothHandoff(page, 'dossier-record')
  await expect(dossier.locator('.dossier-tab-panel')).toHaveCSS('animation-name', 'none')

  await page.getByRole('button', { name: /^(New|新建)$/ }).first().click()
  const dialog = page.getByRole('dialog', { name: /Application dossier|申请档案/i })
  await expect(dialog).toBeVisible()
  const editor = dialog.locator('.markdown-textarea')
  await expect(editor).toBeVisible({ timeout: 12_000 })
  await expect(editor.locator('.markdown-format-badge')).toHaveCount(0)

  const modeToolbar = editor.locator('.markdown-mode-toolbar')
  const modeToggle = editor.locator('.markdown-mode-toggle')
  await modeToolbar.hover()
  await expect(modeToggle).toHaveCSS('opacity', '1')
  await modeToggle.click()
  await expect(editor.locator('textarea.markdown-source-input')).toBeVisible()
})
