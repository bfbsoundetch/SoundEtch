import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { encodeWav, sineTone } from './wav'

export { expect }

/**
 * Every test gets a fresh browser context (empty OPFS and IndexedDB), so the app starts on its welcome page.
 * An uncaught page error or a console.error fails the test: NotificationsController reports user-facing errors
 * through console.error, and workers' console output reaches the page too.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`Uncaught: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
    })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeVisible()
    await use(page)
    expect(errors, 'browser errors').toEqual([])
  },
})

export const TONE_SECONDS = 2
export const toneSamples = sineTone(TONE_SECONDS, 440, 0.5)
export const toneFile = { name: 'tone.wav', mimeType: 'audio/wav', buffer: encodeWav(toneSamples) }

/** Imports through the welcome page's button and the native file chooser it opens. */
export async function importFile(page: Page, file: typeof toneFile) {
  await page.getByRole('button', { name: 'Import a file' }).click()
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('dialog', { name: 'Add Clip' }).getByRole('button', { name: 'Choose local file' }).click()
  await (await fileChooser).setFiles(file)
  await expect(page.getByRole('dialog', { name: 'Add Clip' })).toBeHidden()
}

/** The keyboard-operable timeline of the only track; strict, so a second track fails the locator. */
export function trackTimeline(page: Page): Locator {
  return page.locator('#track-list').getByRole('slider')
}

/** The track's length in seconds, as the timeline slider reports it to assistive technology. */
export async function trackSeconds(page: Page): Promise<number> {
  return Number(await trackTimeline(page).getAttribute('aria-valuemax'))
}

export function clipInfoButton(page: Page, clipName: string | RegExp): Locator {
  const name =
    typeof clipName === 'string' ? `View info for ${clipName}` : new RegExp(`^View info for ${clipName.source}`)
  return page.locator('#track-list').getByRole('button', { name })
}

/** Vertical extent in pixels of the drawn waveform; a flat line (silence) is 0. */
export async function waveformExtent(page: Page): Promise<number> {
  const path = await page
    .locator('#track-list path.waveform-path:not(.waveform-crossfade-path)')
    .getAttribute('d', { timeout: 5_000 })
  const ys = [...(path ?? '').matchAll(/[ML]\s*-?[\d.]+[\s,]+(-?[\d.]+)/g)].map((match) => Number(match[1]))
  return ys.length === 0 ? 0 : Math.max(...ys) - Math.min(...ys)
}

/** Horizontal screen pixels per second of audio, from the rendered width of a clip of known length. */
export async function pixelsPerSecond(page: Page, clipSeconds: number): Promise<number> {
  const box = await page.locator('#track-list rect.waveform-rect').boundingBox()
  return box!.width / clipSeconds
}

/** Presses on the centre of `target` and drags it `dx` pixels horizontally with intermediate moves. */
export async function dragHorizontally(page: Page, target: Locator, dx: number) {
  const box = (await target.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 10 })
  await page.mouse.up()
}

const SAVED_FILES_DIRECTORY = 'e2e-saved-files'

/**
 * Playwright cannot drive the native save dialog, so the File System Access picker is replaced by one that hands
 * the app a writable file in OPFS under the suggested name. The app writes it through the same handle API.
 */
export async function replaceSaveFilePicker(page: Page) {
  await page.evaluate((directoryName) => {
    Object.assign(window, {
      showSaveFilePicker: async (options?: { suggestedName?: string }) => {
        const root = await navigator.storage.getDirectory()
        const directory = await root.getDirectoryHandle(directoryName, { create: true })
        return directory.getFileHandle(options?.suggestedName ?? 'untitled', { create: true })
      },
    })
  }, SAVED_FILES_DIRECTORY)
}

/**
 * The files written through the replaced save picker. A file is empty until the app closes its writable stream,
 * which commits the content atomically.
 */
export async function savedFiles(page: Page): Promise<Map<string, Buffer>> {
  const files = await page.evaluate(async (directoryName) => {
    const root = await navigator.storage.getDirectory()
    let directory: FileSystemDirectoryHandle
    try {
      directory = await root.getDirectoryHandle(directoryName)
    } catch {
      return []
    }
    const contents: Array<[string, number[]]> = []
    for await (const handle of directory.values()) {
      if (handle.kind !== 'file') continue
      const file = await (handle as FileSystemFileHandle).getFile()
      contents.push([handle.name, Array.from(new Uint8Array(await file.arrayBuffer()))])
    }
    return contents
  }, SAVED_FILES_DIRECTORY)
  return new Map(files.map(([name, bytes]) => [name, Buffer.from(bytes)]))
}
