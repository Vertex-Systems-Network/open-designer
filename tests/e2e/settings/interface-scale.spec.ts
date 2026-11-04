import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('interface size scales chrome and persists independently of canvas zoom', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  const zoomBefore = await page.evaluate(() => window.openPencil?.getStore?.().state.zoom)
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-interface-scale').click()
  await page.getByRole('option', { name: '125%' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-interface-scale', '125')
  await expect
    .poll(() =>
      page.getByTestId('app-settings-dialog').evaluate((el) => getComputedStyle(el).fontSize)
    )
    .toBe('16.25px')
  await expect(page.evaluate(() => window.openPencil?.getStore?.().state.zoom)).resolves.toBe(
    zoomBefore
  )

  await page.reload()
  await canvas.waitForInit()
  await expect(page.locator('html')).toHaveAttribute('data-interface-scale', '125')
  await page.getByTestId('app-settings-trigger').click()
  await expect(page.getByTestId('settings-interface-scale')).toContainText('125%')
})
