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
