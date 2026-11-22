import { clipInfoButton, expect, test, trackSeconds, waveformExtent } from './fixtures'

const RECORDING_MS = 2_000

test('recording from the microphone creates a clip as long as the recording', async ({ page }) => {
  const recordButton = page.locator('#first-header-button')

  await page.getByRole('button', { name: 'Record from microphone', exact: true }).click()
  await expect(recordButton).toHaveText('Recording')
  const started = Date.now()
  await page.waitForTimeout(RECORDING_MS)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  const elapsedSeconds = (Date.now() - started) / 1000

  await expect(recordButton).toHaveText('Record')
  await expect(clipInfoButton(page, /Recording: /)).toBeVisible()
  const seconds = await trackSeconds(page)
  expect(seconds).toBeGreaterThan((RECORDING_MS / 1000) * 0.75)
  // Recording starts slightly before the UI reports it, and stops only after the click is handled.
  expect(seconds).toBeLessThan(elapsedSeconds + 1)
  // Chromium's fake microphone beeps; a broken capture path records silence, drawn as a flat line.
  expect(await waveformExtent(page)).toBeGreaterThan(20)
})
