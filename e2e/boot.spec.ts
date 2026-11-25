import { expect, importFile, test, toneFile } from './fixtures'

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
  await page.locator('#menu-dropdown').getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByText('Cloud backup', { exact: true }).click()
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

test('the time entry dialog stays open when a drag starts anywhere inside it and ends outside', async ({ page }) => {
  await importFile(page, toneFile)
  await page.getByRole('button', { name: 'Go to time…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Go to time', exact: true })
  const heading = (await dialog.getByRole('heading', { name: 'Go to time' }).boundingBox())!
  const minutes = (await dialog.getByLabel('Minutes (MM)').boundingBox())!
  const outside = { x: 10, y: page.viewportSize()!.height / 2 }

  // From a field, as when selecting its text, and from the blank margin beside the heading.
  for (const start of [
    { x: minutes.x + minutes.width / 2, y: minutes.y + minutes.height / 2 },
    { x: heading.x - 8, y: heading.y + heading.height / 2 },
  ]) {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(outside.x, outside.y, { steps: 5 })
    await page.mouse.up()
    await expect(dialog).toBeVisible()
  }

  await page.mouse.click(outside.x, outside.y)
  await expect(dialog).toBeHidden()
})
