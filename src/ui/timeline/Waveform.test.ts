import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Clip } from '../../project/Clip'
import { ClipView } from '../../project/ClipView'
import { Track } from '../../project/Track'
import { ClipViewController, Waveform } from './Waveform'

vi.mock('../../project/SummaryGenerator', () => ({ SummaryGenerator: {} }))

// Only the SVG group lifecycle matters here; waveform drawing and browser geometry are separate.
class Group {
  readonly children = new Set<Group>()
  parentNode: Group | null = null

  appendChild(child: Group) {
    child.remove()
    this.children.add(child)
    child.parentNode = this
  }

  remove() {
    this.parentNode?.children.delete(this)
    this.parentNode = null
  }

  setAttribute() {}
}

beforeEach(() => vi.stubGlobal('document', { activeElement: null }))
afterEach(() => vi.unstubAllGlobals())

function waveform(track: Track) {
  return Object.assign(Object.create(Waveform.prototype) as Waveform, {
    track,
    trackListController: { sampleScale: 1, translation: 0 },
    width: 1000,
    topSvgElement: new Group(),
    clipViewGroupElement: new Group(),
    aboveClipViewGroupElement: new Group(),
    clipViewControllerMap: new Map<ClipView, ClipViewController>(),
    dragInProgressClipViews: new Set<ClipViewController>(),
    transientClipViewControllers: new Set<ClipViewController>(),
    transferredClipViews: new Set<ClipView>(),
    requestSpectrogramDraw: vi.fn(),
    requestVideoDraw: vi.fn(),
  })
}

function controller(waveform: Waveform, clipView: ClipView) {
  const group = new Group()
  const handles = new Group()
  const controller = Object.assign(Object.create(ClipViewController.prototype) as ClipViewController, {
    waveform,
    clipView,
    trackListController: { sampleScale: 1, translation: 0 },
    draggedShift: 0,
    startCrossFadeDuration: 0,
    endCrossFadeDuration: 0,
    clipElementsGroup: group,
    handleElementsGroup: handles,
    transcriptionOverlay: { remove: vi.fn() },
    draw: vi.fn(),
  })
  for (const name of [
    'rectElement',
    'headerElement',
    'headerTitleElement',
    'headerInfoElement',
    'endCrossFadeHeaderElement',
    'endCrossFadeHeaderTitleElement',
    'svgPathElement',
    'startCrossFadePathElement',
    'endCrossFadePathElement',
    'leftHandle',
    'rightHandle',
  ]) {
    Object.assign(controller, { [name]: new Group() })
  }
  ;(waveform.clipViewGroupElement as unknown as Group).appendChild(group)
  // The production ordering routine only handles real SVG nodes, not this lifecycle fixture.
  waveform.adoptClipViewController(controller)
  return { controller, group }
}

test.each([10, 30])('trimming %s samples then moving the right clip does not resurrect the old crossfade', (trim) => {
  const clip = new Clip('take', 1, 100)
  const track = new Track('track', 1)
  const left = new ClipView(clip, 0, 0, 100)
  const right = new ClipView(clip, 0, 80, 100)
  track.addClipView(left)
  track.addClipView(right)
  const wave = waveform(track)
  const old = controller(wave, left)
  const next = controller(wave, right)

  // Overlapping the right clip leaves the left controller in the drag preview.
  wave.drawClipViewOver(next.controller)
  expect(old.controller.endCrossFadeDuration).toBe(20)

  const resized = new ClipView(clip, 0, 0, 100 - trim)
  expect(track.replaceClipView(0, resized)).toBe(true)
  const replacement = controller(wave, resized)
  wave.drawAudioData()
  expect(old.group.parentNode).toBeNull()
  expect(replacement.controller.endCrossFadeDuration).toBe(Math.max(0, 20 - trim))

  next.controller.draggedShift = 150
  wave.drawClipViewOver(next.controller)

  expect(old.group.parentNode).toBeNull()
  expect(replacement.controller.endCrossFadeDuration).toBe(0)
  expect(next.controller.startCrossFadeDuration).toBe(0)
  expect((wave.clipViewGroupElement as unknown as Group).children).toEqual(new Set([replacement.group, next.group]))
})
