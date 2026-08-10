import { expect, test } from '@playwright/test'

async function signIn(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('phd-atlas-interface-mode', 'personal')
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"]').fill('jasper@example.com')
  await page.locator('input[type="password"]').fill('demo123456')
  await page.getByRole('button', { name: /^(Sign in|登录)$/ }).click()
  await expect(page.getByRole('heading', { name: /Dashboard|仪表盘/i })).toBeVisible()
}

test('opens the recoverable interview workspace on desktop and mobile', async ({ page }) => {
  await signIn(page)
  await page.locator('.atlas-rail').getByRole('button', { name: /Interview prep|面试准备/i }).click()

  await expect(page.getByRole('heading', { name: /Interview Prep|面试准备/i })).toBeVisible()
  await expect(page.locator('.interview-prep-layout')).toBeVisible()
  await expect(page.getByText(/No interviews yet|暂无面试/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Create interview|新建面试/i }).first()).toBeVisible()

  if ((page.viewportSize()?.width ?? 1280) <= 820) {
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  } else {
    await expect(page.getByRole('complementary', { name: /Coach|教练/i })).toBeVisible()
  }
})
