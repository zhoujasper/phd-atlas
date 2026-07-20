import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './logs/tmp/playwright-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './logs/tmp/playwright-report', open: 'never' }],
  ],
  timeout: 30_000,
  // E2E scenarios share the local SQLite database and seeded demo accounts.
  // Keep them single-worker so write flows do not select each other's records.
  workers: 1,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chromium',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev:full',
    url: 'http://127.0.0.1:5173',
    env: {
      JWT_SECRET: 'phd-atlas-playwright-secret',
      RATE_LIMIT_DISABLED: '1',
    },
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1',
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
