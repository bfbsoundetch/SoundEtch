import {
  clipInfoButton,
  expect,
  importFile,
  test,
  TONE_SECONDS,
  toneFile,
  trackSeconds,
  trackTimeline,
  waveformExtent,
} from './fixtures'

test('an imported audio file becomes a clip on a new track and survives a reload', async ({ page }) => {
  await importFile(page, toneFile)

  await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeHidden()
  await expect(clipInfoButton(page, 'File: tone.wav')).toBeVisible()
  await expect(trackTimeline(page)).toHaveAttribute('aria-valuemax', TONE_SECONDS.toFixed(3))
  // The tone peaks at half of full scale; silence would draw a flat line.
  expect(await waveformExtent(page)).toBeGreaterThan(20)

  await page.reload()

  await expect(clipInfoButton(page, 'File: tone.wav')).toBeVisible()
  expect(await trackSeconds(page)).toBe(TONE_SECONDS)
  expect(await waveformExtent(page)).toBeGreaterThan(20)
})

test('an imported clip plays in real time to its end, then playback stops', async ({ page }) => {
  await importFile(page, toneFile)
  const play = page.getByRole('button', { name: 'Play', exact: true })
  const marker = page.locator('#position-line')

  const started = Date.now()
  await play.click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  const markerX = () => marker.getAttribute('x1').then(Number)
  const firstX = await markerX()
  await expect.poll(markerX).toBeGreaterThan(firstX + 10)

  await expect(play).toBeVisible({ timeout: 10_000 })
  expect((Date.now() - started) / 1000).toBeGreaterThan(TONE_SECONDS * 0.75)
})
