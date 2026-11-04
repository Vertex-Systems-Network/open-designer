import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('startup update checks can be disabled and the choice persists', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.getByTestId('app-settings-trigger').click()
  const check = page.getByTestId('settings-update-check-on-startup')
  await expect(check).toBeChecked()
  await check.click()
  await expect(check).not.toBeChecked()

  await page.reload()
  await canvas.waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await expect(page.getByTestId('settings-update-check-on-startup')).not.toBeChecked()
})
