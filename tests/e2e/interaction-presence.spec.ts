import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    window.localStorage.setItem('phd-atlas-interface-mode', 'personal')
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/Email|邮箱/i).fill('jasper@example.com')
  await page.locator('input[type="password"]').fill('demo123456')
  await page.getByRole('button', { name: /^(Sign in|登录)$/ }).click()
  await expect(page.getByRole('heading', { name: /Dashboard|仪表盘/i })).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.launch-screen-skeleton')).toHaveCount(0, { timeout: 2_000 })
}

function distinctFrames(values: number[]) {
  return new Set(values.map((value) => Math.round(value))).size
}

test('animates Discover disclosure height in both directions and honors reduced motion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop disclosure geometry is audited in Chromium.')
  await signIn(page)
  await page.locator('.atlas-rail').getByRole('button', { name: /^(Discover|发现|探索)$/ }).click()
  await expect(page.locator('.discover-v2')).toBeVisible({ timeout: 12_000 })
  // Let the screen-level handoff settle before auditing local component state;
  // the outgoing transition shell intentionally swaps its child once.
  await page.waitForTimeout(520)

  const group = page.locator('.discover-filter-group').first()
  const summary = group.locator('.smooth-disclosure-summary')
  const panel = group.locator('.collapsible-panel')
  await expect(summary).toHaveAttribute('aria-expanded', 'true')

  await summary.click()
  const closingFrames = await panel.evaluate(async (element) => {
    const values = [element.getBoundingClientRect().height]
    for (let index = 0; index < 7; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 48))
      values.push(element.getBoundingClientRect().height)
    }
    return values
  })
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  expect(closingFrames.at(-1)).toBeLessThan(closingFrames[0])
  expect(distinctFrames(closingFrames), 'collapse should expose multiple interpolated layout frames').toBeGreaterThanOrEqual(3)
  await expect(panel.locator('.collapsible-panel-inner')).toHaveCount(1)

  await summary.click()
  const openingFrames = await panel.evaluate(async (element) => {
    const values = [element.getBoundingClientRect().height]
    for (let index = 0; index < 9; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 48))
      values.push(element.getBoundingClientRect().height)
    }
    return values
  })
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  expect(openingFrames.at(-1)).toBeGreaterThan(openingFrames[0])
  expect(distinctFrames(openingFrames), 'expand should expose multiple interpolated layout frames').toBeGreaterThanOrEqual(3)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  const transitionDurations = await panel.evaluate((element) => getComputedStyle(element).transitionDuration
    .split(',')
    .map((duration) => Number.parseFloat(duration) * (duration.includes('ms') ? 1 : 1000)))
  expect(Math.max(...transitionDurations)).toBeLessThanOrEqual(0.02)
})

test('moves the verified recovery-email label continuously when primary status changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop mailbox layout is audited in Chromium.')
  await signIn(page)
  await page.locator('.atlas-rail').getByRole('button', { name: /^(Settings|系统设置)$/ }).click()
  await expect(page.locator('.settings-screen')).toBeVisible({ timeout: 12_000 })

  const originalPrimary = page.locator('.receive-email-row:has(.mailbox-primary-status[data-present="true"])').first()
  const makePrimary = page.locator('.receive-email-row .mailbox-primary-action:not(:disabled)').first()
  if (await originalPrimary.count() === 0 || await makePrimary.count() === 0) {
    testInfo.annotations.push({ type: 'skip-condition', description: 'The seeded account does not have two verified recovery emails.' })
    return
  }

  const originalAddress = (await originalPrimary.locator('.receive-email-main > strong').innerText()).trim()
  const movement = await makePrimary.evaluate(async (button) => {
    const primaryRow = document.querySelector<HTMLElement>('.receive-email-row:has(.mailbox-primary-status[data-present="true"])')
    const status = primaryRow?.querySelector<HTMLElement>('.mailbox-primary-status')
    const verified = primaryRow?.querySelector<HTMLElement>('.receive-email-meta em.verified')
    if (!primaryRow || !status || !verified) return []
    const values = [verified.getBoundingClientRect().left]
    button.click()
    const deadline = performance.now() + 3_000
    while (status.dataset.present !== 'false' && performance.now() < deadline) {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    }
    values.push(verified.getBoundingClientRect().left)
    for (let index = 0; index < 7; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 52))
      values.push(verified.getBoundingClientRect().left)
    }
    return values
  })

  const originalRow = page.locator('.receive-email-row', { hasText: originalAddress })
  await expect(originalRow.locator('.mailbox-primary-status')).toHaveAttribute('data-present', 'false')
  const restoreButton = originalRow.locator('.mailbox-primary-action')
  await expect(restoreButton).toBeEnabled()
  await restoreButton.click()
  await expect(originalRow.locator('.mailbox-primary-status')).toHaveAttribute('data-present', 'true')

  expect(movement.length).toBeGreaterThan(4)
  expect(movement.at(-1)).toBeLessThan(movement[0] - 4)
  expect(distinctFrames(movement), 'Verified should glide left instead of jumping after the badge unmounts').toBeGreaterThanOrEqual(3)
})

test('contracts AI delete controls immediately while cancel fades them out', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop AI-key action geometry is audited in Chromium.')
  await signIn(page)
  await page.locator('.atlas-rail').getByRole('button', { name: /^(Settings|系统设置)$/ }).click()
  await expect(page.locator('.settings-screen')).toBeVisible({ timeout: 12_000 })

  const keyRow = page.locator('.ai-key-item').first()
  if (await keyRow.count() === 0) {
    testInfo.annotations.push({ type: 'skip-condition', description: 'The seeded account has no AI key to exercise.' })
    return
  }

  await keyRow.hover()
  await keyRow.locator('.inline-confirm-idle').click()
  const cancel = keyRow.locator('.inline-confirm-cancel')
  await expect(cancel).toBeVisible()
  const frames = await cancel.evaluate(async (button) => {
    const confirm = button.closest<HTMLElement>('.inline-confirm')
    const rail = button.closest<HTMLElement>('.ai-key-summary-actions')
    if (!confirm || !rail) return []
    const values = [{
      confirmWidth: confirm.getBoundingClientRect().width,
      railWidth: rail.getBoundingClientRect().width,
    }]
    button.click()
    for (let index = 0; index < 8; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 48))
      values.push({
        confirmWidth: confirm.getBoundingClientRect().width,
        railWidth: rail.getBoundingClientRect().width,
      })
    }
    return values
  })

  await expect(keyRow).not.toHaveClass(/is-deleting/)
  await expect(keyRow.locator('.inline-confirm-actions')).toHaveCount(1)
  expect(frames[1].railWidth, 'the outer action rail should start contracting on the first sampled frame').toBeLessThan(frames[0].railWidth - 4)
  expect(frames.at(-1)?.confirmWidth).toBeLessThan(frames[0].confirmWidth)
  expect(distinctFrames(frames.map((frame) => frame.confirmWidth)), 'cancel should release inline width over multiple frames').toBeGreaterThanOrEqual(3)
  expect(distinctFrames(frames.map((frame) => frame.railWidth)), 'the outer rail should contract continuously instead of pausing').toBeGreaterThanOrEqual(3)
})

test('keeps the animated Discover rail usable at 400px in dark mode', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The compact dark layout is captured once in desktop Chromium.')
  await signIn(page)
  await page.locator('.atlas-rail').getByRole('button', { name: /^(Discover|发现|探索)$/ }).click()
  await expect(page.locator('.discover-v2')).toBeVisible({ timeout: 12_000 })
  await page.waitForTimeout(520)
  await page.setViewportSize({ width: 400, height: 844 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))

  await page.locator('.discover-mode-tabs').getByRole('button', { name: /Advisor|导师/ }).click()
  const mobileResults = page.locator('.discover-mobile-result')
  await expect(mobileResults.first()).toBeVisible()
  await expect(page.locator('.discover-data-table')).toBeHidden()

  const listGeometry = await page.locator('.discover-pi-table').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(listGeometry.scrollWidth - listGeometry.clientWidth).toBeLessThanOrEqual(1)

  await mobileResults.first().locator('.discover-mobile-result-main').click()
  const inspector = page.locator('.discover-inspector.is-mobile-open')
  await expect(inspector).toBeVisible()
  await inspector.locator('.discover-inspector-close').click()
  await expect(inspector).toBeHidden()
  await expect(mobileResults.first()).toBeVisible()

  await page.locator('.discover-filter-button').click()
  const overlay = page.locator('.discover-mobile-overlay')
  const rail = overlay.locator('.discover-filter-rail.is-mobile')
  await expect(rail).toBeVisible()
  const firstSummary = rail.locator('.smooth-disclosure-summary').first()
  await firstSummary.click()
  await expect(firstSummary).toHaveAttribute('aria-expanded', 'false')
  await firstSummary.click()
  await expect(firstSummary).toHaveAttribute('aria-expanded', 'true')

  const geometry = await rail.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      navigationTop: document.querySelector('.atlas-rail')?.getBoundingClientRect().top ?? window.innerHeight,
      viewport: window.innerWidth,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      background: getComputedStyle(element).backgroundColor,
      nestedInScreenStage: Boolean(element.closest('.screen-stage')),
    }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1)
  expect(Math.abs(geometry.navigationTop - geometry.bottom)).toBeLessThanOrEqual(1)
  expect(geometry.overflow).toBeLessThanOrEqual(1)
  expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(geometry.nestedInScreenStage).toBe(false)

  await page.screenshot({ path: 'logs/tmp/discover-motion-mobile-dark.png', fullPage: true })
})
