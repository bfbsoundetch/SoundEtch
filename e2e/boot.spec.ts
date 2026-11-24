import { expect, test } from './fixtures'

test('a fresh profile opens on the welcome page, cross-origin isolated', async ({ page }) => {
  // Recording and playback hand audio to worklets through SharedArrayBuffer, which only exists with COOP/COEP.
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  for (const name of [
    'Record from microphone',
    'Record from microphone + camera',
    'Record a browser tab or screen',
    'Import a file',
    'Start a meeting',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
})

test('every main menu dialog opens, including those whose code loads on demand', async ({ page }) => {
  const menu = page.locator('#menu-dropdown')
  for (const { path, dialog } of [
    { path: ['Project', 'Manage Projects'], dialog: 'Projects' },
    { path: ['Project', 'Import / Export'], dialog: 'Import / Export Project' },
    { path: ['Publish'], dialog: 'Publish Settings' },
    { path: ['Manage Clips'], dialog: 'Manage Clips' },
    { path: ['Settings'], dialog: 'Settings' },
    { path: ['Logs'], dialog: 'Logs' },
  ]) {
    await page.getByRole('button', { name: 'Main menu' }).click()
    for (const item of path) {
      await menu.getByRole('button', { name: item, exact: true }).click()
    }
    const opened = page.getByRole('dialog', { name: dialog, exact: true })
    await expect(opened).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(opened).toBeHidden()
  }
})

test('a modal stays open when a drag starts in its content and ends outside, and closes on a click outside', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Main menu' }).click()
  const menu = page.locator('#menu-dropdown')
  await menu.getByRole('button', { name: 'Project', exact: true }).click()
  await menu.getByRole('button', { name: 'Import / Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import / Export Project', exact: true })
  await dialog.getByLabel('Service').selectOption({ label: 'S3-compatible storage' })
  const endpoint = dialog.getByLabel('Endpoint')
  await endpoint.fill('https://ACCOUNT.r2.cloudflarestorage.com')
  const field = (await endpoint.boundingBox())!
  const content = (await dialog.locator('.overlay-content').boundingBox())!
  const outside = { x: content.x / 2, y: field.y + field.height / 2 }

  // Selecting the field's text by dragging past the content's edge.
  await page.mouse.move(field.x + field.width / 2, outside.y)
  await page.mouse.down()
  await page.mouse.move(outside.x, outside.y, { steps: 5 })
  await page.mouse.up()
  await expect(dialog).toBeVisible()

  await page.mouse.click(outside.x, outside.y)
  await expect(dialog).toBeHidden()
})
