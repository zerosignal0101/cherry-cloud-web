import { expect, type Page, test } from '@playwright/test'

const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-password-123'

async function login(page: Page): Promise<void> {
  await page.goto('/login?next=%2Fapp%2Fchat')
  await page.locator('#password').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/app\/chat/, { timeout: 30_000 })
  await expect(page.locator('[data-ui="app.shell"]')).toBeVisible({ timeout: 30_000 })
}

function failOnPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
}

test('unauthenticated app routes land on the password gate', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'auth redirect is covered once')
  await page.goto('/app/chat')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('#password')).toBeVisible()
})

test('desktop main path: chat, data settings and notes render without page errors', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'desktop project only')
  const pageErrors = failOnPageErrors(page)

  await login(page)
  await expect(page.locator('[data-ui="app.desktop-nav"]')).toBeVisible()
  await expect(page.locator('[data-ui="app.mobile-nav"]')).toBeHidden()

  await page.goto('/settings/data')
  await expect(page.locator('[data-ui="settings.view"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-ui="settings.navigation"]')).toBeVisible()

  await page.goto('/app/notes')
  await expect(page.locator('[data-ui="notes.view"]')).toBeVisible({ timeout: 30_000 })

  for (const [path, view] of [
    ['/app/agents', 'agent.view'],
    ['/app/mini-app', 'mini-apps.view'],
    ['/app/translate', 'translate.view'],
    ['/settings/general', 'settings.view']
  ] as const) {
    await page.goto(path)
    await expect(page.locator(`[data-ui="${view}"]`)).toBeVisible({ timeout: 30_000 })
  }

  await expectNoHorizontalOverflow(page)
  expect(pageErrors).toEqual([])
})

test('mobile main path: bottom navigation, settings and chat fit the viewport', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'mobile project only')
  const pageErrors = failOnPageErrors(page)

  await login(page)
  const mobileNav = page.locator('[data-ui="app.mobile-nav"]')
  await expect(mobileNav).toBeVisible()
  await expect(page.locator('[data-ui="app.desktop-nav"]')).toBeHidden()
  await expectNoHorizontalOverflow(page)

  await page.goto('/settings/data')
  await expect(page.locator('[data-ui="settings.view"]')).toBeVisible({ timeout: 30_000 })
  await expectNoHorizontalOverflow(page)

  await page.goto('/app/chat')
  await expect(page.locator('[data-ui="app.shell"]')).toBeVisible({ timeout: 30_000 })
  await expect(mobileNav).toBeVisible()
  await expectNoHorizontalOverflow(page)

  expect(pageErrors).toEqual([])
})
