import { expect, test, type Page } from '@playwright/test'

async function signInAndOpenSettings(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('phd-atlas-interface-mode', 'personal')
    window.localStorage.setItem('phd-atlas-language', 'zh')
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/Email|邮箱/i).fill('jasper@example.com')
  await page.locator('input[type="password"]').fill('demo123456')
  await page.getByRole('button', { name: /^(Sign in|登录)$/ }).click()
  await expect(page.getByRole('heading', { name: /Dashboard|仪表盘/i })).toBeVisible({ timeout: 12_000 })
  await page.goto('/settings', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.settings-screen')).toBeVisible({ timeout: 12_000 })
  const mailboxCard = page.getByRole('region', { name: /Receive emails|收件邮箱/ })
  const mailboxSummary = mailboxCard.locator('.mail-config-summary')
  if (await mailboxSummary.getAttribute('aria-expanded') !== 'true') {
    await mailboxSummary.click()
    await expect(mailboxCard).toHaveClass(/expanded/)
  }
  await expect(mailboxCard.locator('.receive-email-row .mail-test-btn').first()).toBeVisible({ timeout: 12_000 })
}

test('test-email action visibly moves through sending and sent states without layout overflow', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  await page.route('**/api/settings/test-email', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { delivery?: string }
    await new Promise((resolve) => setTimeout(resolve, 900))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { sent: true, delivery: body.delivery || 'jasper@example.com' } }),
    })
  })
  await signInAndOpenSettings(page)

  const row = page.locator('.receive-email-row').filter({ has: page.locator('.mail-test-btn') }).first()
  const button = row.locator('.mail-test-btn')
  await button.click()
  await expect(button).toHaveAttribute('data-state', 'pending')
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await expect(button).toHaveAccessibleName(/Sending|发送中/)
  await expect(button.locator('.async-action-pending .spin-icon')).toBeVisible()

  const pendingGeometry = await row.evaluate((element) => {
    const rowRect = element.getBoundingClientRect()
    const buttonRect = element.querySelector<HTMLElement>('.mail-test-btn')?.getBoundingClientRect()
    const spinner = element.querySelector<HTMLElement>('.async-action-pending .spin-icon')
    return {
      rowLeft: rowRect.left,
      rowRight: rowRect.right,
      buttonLeft: buttonRect?.left ?? -1,
      buttonRight: buttonRect?.right ?? Number.POSITIVE_INFINITY,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      spinnerAnimation: spinner ? getComputedStyle(spinner).animationName : 'none',
    }
  })
  expect(pendingGeometry.buttonLeft).toBeGreaterThanOrEqual(pendingGeometry.rowLeft - 1)
  expect(pendingGeometry.buttonRight).toBeLessThanOrEqual(pendingGeometry.rowRight + 1)
  expect(pendingGeometry.documentOverflow).toBeLessThanOrEqual(2)
  expect(pendingGeometry.spinnerAnimation).not.toBe('none')
  await page.screenshot({ path: `logs/tmp/test-email-sending-${testInfo.project.name}.png`, fullPage: false })

  await expect(button).toHaveAttribute('data-state', 'success', { timeout: 5_000 })
  await expect(button).toHaveAccessibleName(/Test email sent|测试邮件已发送/)
  await expect(button.locator('.async-action-success')).toBeVisible()
})

test('test-email failure returns an inline retry sentence and reduced motion removes the transition', async ({ page }) => {
  test.setTimeout(45_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/settings/test-email', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350))
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'SMTP unavailable' }),
    })
  })
  await signInAndOpenSettings(page)

  const button = page.locator('.receive-email-row .mail-test-btn').first()
  await button.click()
  await expect(button).toHaveAttribute('data-state', 'pending')
  await expect(button).toHaveAttribute('data-state', 'error', { timeout: 5_000 })
  await expect(button).toHaveAccessibleName(/Send failed|发送失败/)
  await expect(button).toBeEnabled()

  const transitionDurations = await button.locator('.async-action-error').evaluate((element) => (
    getComputedStyle(element).transitionDuration
      .split(',')
      .map((value) => Number.parseFloat(value) * (value.includes('ms') ? 1 : 1000))
  ))
  expect(Math.max(...transitionDurations)).toBeLessThanOrEqual(0.02)
})
