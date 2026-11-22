import {
  dragHorizontally,
  expect,
  importFile,
  pixelsPerSecond,
  test,
  TONE_SECONDS,
  toneFile,
  trackSeconds,
} from './fixtures'

test.beforeEach(async ({ page }) => {
  await importFile(page, toneFile)
  await expect.poll(() => trackSeconds(page)).toBe(TONE_SECONDS)
})

test('dragging a clip by its header moves it, and undo and redo step between positions', async ({ page }) => {
  const secondPixels = await pixelsPerSecond(page, TONE_SECONDS)

  await dragHorizontally(page, page.locator('#track-list rect.clip-view-header'), secondPixels)
  // The track now ends one second later.
  await expect.poll(() => trackSeconds(page)).toBeCloseTo(TONE_SECONDS + 1, 2)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => trackSeconds(page)).toBe(TONE_SECONDS)
  await expect(page.getByRole('status').filter({ hasText: 'Undid move clip view' })).toBeAttached()

  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => trackSeconds(page)).toBeCloseTo(TONE_SECONDS + 1, 2)
})

test("dragging a clip's end handle trims it, and undo restores the full clip", async ({ page }) => {
  const secondPixels = await pixelsPerSecond(page, TONE_SECONDS)

  await dragHorizontally(page, page.locator('#track-list line.clip-view-handle-right'), -secondPixels / 2)
  await expect.poll(() => trackSeconds(page)).toBeCloseTo(TONE_SECONDS - 0.5, 2)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => trackSeconds(page)).toBe(TONE_SECONDS)
})
