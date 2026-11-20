import { defineConfig, devices } from '@playwright/test'

/**
 * Browser acceptance suite for the built Web deployment.
 *
 * `pnpm test:e2e` builds the SPA/server first, then Playwright starts
 * `scripts/e2e-server.mjs` on a throwaway DATA_DIR. The two projects mirror the
 * layout targets from the architecture doc: desktop 1440×900 and phone 390×844.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8799',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: 'chrome', viewport: { width: 390, height: 844 } }
    }
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node scripts/e2e-server.mjs',
        url: 'http://127.0.0.1:8799/api/health',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe'
      }
})
