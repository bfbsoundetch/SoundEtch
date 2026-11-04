import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { KeyPressController } from '../KeyPressController'
import { TimelineRegionController } from './TimelineRegionController'
import type { TrackListController } from './TrackListController'
import type { Waveform } from './Waveform'

vi.mock('../KeyPressController', () => ({ KeyPressController: { metaPressed: false } }))

beforeEach(() => {
  KeyPressController.metaPressed = false
  vi.stubGlobal('document', {
    createElementNS: () => ({
      height: { baseVal: { value: 0 } },
      y2: { baseVal: { value: 0 } },
      classList: { add: vi.fn() },
      setAttribute: vi.fn(),
      addEventListener: vi.fn(),
      remove: vi.fn(),
    }),
  })
})

afterEach(() => vi.unstubAllGlobals())

function selection() {
  const waveforms = Array.from({ length: 5 }, (_, index) => ({
    track: { name: `Track ${index}` },
    fullHeight: 100,
    topGroupElement: { appendChild: vi.fn() },
  })) as unknown as Waveform[]
  const trackList = {
    waveforms,
    sampleScale: 1,
    translation: 0,
    timelineController: { drawSelection: vi.fn(), removeSelection: vi.fn() },
    positionMarkerController: { hidePositionMarker: vi.fn() },
  } as unknown as TrackListController
  const controller = new TimelineRegionController(false, vi.fn(), vi.fn(), trackList)
  return { controller, waveforms }
}

function expectRange(controller: TimelineRegionController, start: number, end: number, waveforms: Waveform[]) {
  const region = controller.selectedRegion
  expect(region?.startSample).toBe(start)
  expect(region?.endSample).toBe(end)
  expect(new Set(region?.tracks)).toEqual(new Set(waveforms.map((waveform) => waveform.track)))
}

test('extending includes the original clicked track and every intervening track', () => {
  const { controller, waveforms } = selection()
  controller.updateSelection(100, waveforms[1], false)
  controller.updateSelection(300, waveforms[4], true)
  expectRange(controller, 100, 300, waveforms.slice(1))
})

test('extending backwards orders the time bounds and includes intervening tracks', () => {
  const { controller, waveforms } = selection()
  controller.updateSelection(300, waveforms[4], false)
  controller.updateSelection(100, waveforms[1], true)
  expectRange(controller, 100, 300, waveforms.slice(1))
})

test('repeated extension contracts and crosses the original anchor without retaining outside tracks', () => {
  const { controller, waveforms } = selection()
  controller.updateSelection(200, waveforms[2], false)
  controller.updateSelection(400, waveforms[4], true)
  controller.updateSelection(300, waveforms[3], true)
  expectRange(controller, 200, 300, waveforms.slice(2, 4))
  controller.updateSelection(100, waveforms[0], true)
  expectRange(controller, 100, 200, waveforms.slice(0, 3))
  controller.updateSelection(250, waveforms[2], true)
  expectRange(controller, 200, 250, [waveforms[2]])
})

test('a selection set by clip, track, transcript, or keyboard actions can extend across tracks', () => {
  const { controller, waveforms } = selection()
  controller.setSelection(100, 200, new Set([waveforms[1]]))
  controller.updateSelection(400, waveforms[4], true)
  expectRange(controller, 100, 400, waveforms.slice(1))
})

test('extending on the ruler changes time without changing selected tracks', () => {
  const { controller, waveforms } = selection()
  controller.setSelection(100, 200, new Set(waveforms.slice(1, 4)))
  controller.updateSelection(400, null, true)
  expectRange(controller, 100, 400, waveforms.slice(1, 4))
})

test('Command-modified extension retains tracks outside the contiguous range', () => {
  const { controller, waveforms } = selection()
  controller.updateSelection(100, waveforms[1], false)
  controller.updateSelection(300, waveforms[4], true)
  KeyPressController.metaPressed = true
  controller.updateSelection(200, waveforms[2], true)
  expectRange(controller, 100, 200, waveforms.slice(1))
})
