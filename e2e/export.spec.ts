import { expect, importFile, replaceSaveFilePicker, savedFiles, test, toneFile, toneSamples } from './fixtures'
import { decodeWav } from './wav'

test('publishing as WAV renders the mix to the chosen file, matching the imported audio', async ({ page }) => {
  await importFile(page, toneFile)
  await replaceSaveFilePicker(page)

  await page.getByRole('button', { name: 'Main menu' }).click()
  await page.locator('#menu-dropdown').getByRole('button', { name: 'Publish', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Publish Settings' })
  await settings.getByLabel('Publish Format').selectOption('wav')
  await settings.getByRole('button', { name: 'Publish', exact: true }).click()

  await expect.poll(async () => [...(await savedFiles(page)).values()].some((bytes) => bytes.length > 0)).toBe(true)
  await expect(page.locator('#processing-modal')).toBeHidden()
  const files = await savedFiles(page)
  expect(files.size).toBe(1)
  const [[name, bytes]] = files
  expect(name).toMatch(/\.wav$/)

  const wav = decodeWav(bytes)
  expect(wav.sampleRate).toBe(48_000)
  expect(wav.channelCount).toBe(1)
  expect(wav.samples.length).toBe(toneSamples.length)
  // A single unity-gain clip passes through the mixer unchanged, up to rounding through float and back.
  let maxError = 0
  for (let i = 0; i < toneSamples.length; i++) {
    maxError = Math.max(maxError, Math.abs(wav.samples[i] - toneSamples[i]))
  }
  expect(maxError).toBeLessThanOrEqual(1)
})
