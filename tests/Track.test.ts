import { Clip } from '../src/project/Clip'
import { ClipView } from '../src/project/ClipView'
import { Track } from '../src/project/Track'

test('createTrack_titleAndChannelCountMatch', async () => {
  const track = new Track('test', 2)

  expect(track.name).toBe('test')
  expect(track.getChannelCount()).toBe(2)
})

test('addClipView_secondOverlapsFirst_throwsError', async () => {
  const clip = new Clip('test', 2)
  clip.addData([new Float32Array(new SharedArrayBuffer(8)), new Float32Array(new SharedArrayBuffer(8))])
  const firstClipView = new ClipView(clip, 0, 0, 1)
  const secondClipView = new ClipView(clip, 0, 2, 0)

  const track = new Track('test', 2)
  track.addClipView(firstClipView)

  expect(() => {
    track.addClipView(secondClipView)
  }).toThrow()
})

test('addClip_firstOverlapsSecond_throwsError', async () => {
  const clip = new Clip('test', 2)
  clip.addData([new Float32Array(new SharedArrayBuffer(8)), new Float32Array(new SharedArrayBuffer(8))])
  const firstClipView = new ClipView(clip, 0, 2, 0)
  const secondClipView = new ClipView(clip, 0, 2, 1)

  const track = new Track('test', 2)
  track.addClipView(firstClipView)

  expect(() => {
    track.addClipView(secondClipView)
  }).toThrow()
})

test('addClipView_inBetweenWithoutOverlap_succeeds', async () => {
  const clip = new Clip('test', 2)
  clip.addData([new Float32Array(new SharedArrayBuffer(8)), new Float32Array(new SharedArrayBuffer(8))])
  const firstClipView = new ClipView(clip, 0, 2, 0)
  const secondClipView = new ClipView(clip, 0, 2, 2)
  const thirdClipView = new ClipView(clip, 0, 2, 4)

  const track = new Track('test', 2)
  track.addClipView(firstClipView)
  track.addClipView(thirdClipView)
  track.addClipView(secondClipView)
})

test('addClipView_inSequenceWithoutOverlap_succeeds', async () => {
  const clip = new Clip('test', 2)
  clip.addData([new Float32Array(new SharedArrayBuffer(8)), new Float32Array(new SharedArrayBuffer(8))])
  const firstClipView = new ClipView(clip, 0, 2, 0)
  const secondClipView = new ClipView(clip, 0, 2, 2)
  const thirdClipView = new ClipView(clip, 0, 2, 4)

  const track = new Track('test', 2)
  track.addClipView(firstClipView)
  track.addClipView(secondClipView)
  track.addClipView(thirdClipView)
})

test('slice_singleClipView_removesSlice', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2)
  const clipData = [
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 8)),
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 8)),
  ]
  clip.addData(clipData)
  track.addClipView(new ClipView(clip, 0, 8, 0))

  const result = track.slice(2, 4, true)

  expect(result.length).toBe(1)
  expect(result[0]).toEqual(new ClipView(clip, 2, 2, 2))
  expect(track.clipViews.length).toBe(2)
  expect(track.clipViews).toEqual([new ClipView(clip, 0, 2, 0), new ClipView(clip, 4, 4, 4)])
})

test('slice_multipleClipViews_removesSlice', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2)
  const clipData = [
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)),
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)),
  ]
  clip.addData(clipData)
  track.addClipView(new ClipView(clip, 0, 2, 0))
  track.addClipView(new ClipView(clip, 0, 2, 4))
  track.addClipView(new ClipView(clip, 0, 2, 8))
  track.addClipView(new ClipView(clip, 0, 4, 12))

  const result = track.slice(1, 15, true)

  expect(result.length).toBe(4)
  expect(result).toEqual([
    new ClipView(clip, 1, 1, 1),
    new ClipView(clip, 0, 2, 4),
    new ClipView(clip, 0, 2, 8),
    new ClipView(clip, 0, 3, 12),
  ])
  expect(track.clipViews.length).toBe(2)
  expect(track.clipViews).toEqual([new ClipView(clip, 0, 1, 0), new ClipView(clip, 3, 1, 15)])
})

test('slice_multipleClipViews_throughEnd', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2)
  const clipData = [
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)),
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)),
  ]
  clip.addData(clipData)
  track.addClipView(new ClipView(clip, 0, 2, 0))
  track.addClipView(new ClipView(clip, 0, 2, 4))
  track.addClipView(new ClipView(clip, 0, 2, 8))
  track.addClipView(new ClipView(clip, 0, 4, 12))

  const result = track.slice(2, 16, true)

  expect(result.length).toBe(3)
  expect(result).toEqual([new ClipView(clip, 0, 2, 4), new ClipView(clip, 0, 2, 8), new ClipView(clip, 0, 4, 12)])
  expect(track.clipViews.length).toBe(1)
  expect(track.clipViews).toEqual([new ClipView(clip, 0, 2, 0)])
})

test('slice_multipleClipViews_startsAtBeginning', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2)
  const clipData = [
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)),
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)),
  ]
  clip.addData(clipData)
  track.addClipView(new ClipView(clip, 0, 2, 0))
  track.addClipView(new ClipView(clip, 0, 2, 4))
  track.addClipView(new ClipView(clip, 0, 2, 8))
  track.addClipView(new ClipView(clip, 0, 4, 12))

  const result = track.slice(0, 15, true)

  expect(result.length).toBe(4)
  expect(result).toEqual([
    new ClipView(clip, 0, 2, 0),
    new ClipView(clip, 0, 2, 4),
    new ClipView(clip, 0, 2, 8),
    new ClipView(clip, 0, 3, 12),
  ])
  expect(track.clipViews.length).toBe(1)
  expect(track.clipViews).toEqual([new ClipView(clip, 3, 1, 15)])
})

test('slice_multipleClipViews_allClipViewsDeleted', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2)
  const clipData = [
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)),
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)),
  ]
  clip.addData(clipData)
  track.addClipView(new ClipView(clip, 0, 2, 0))
  track.addClipView(new ClipView(clip, 0, 2, 4))
  track.addClipView(new ClipView(clip, 0, 2, 8))
  track.addClipView(new ClipView(clip, 0, 4, 12))

  const result = track.slice(0, 16, true)

  expect(result.length).toBe(4)
  expect(result).toEqual([
    new ClipView(clip, 0, 2, 0),
    new ClipView(clip, 0, 2, 4),
    new ClipView(clip, 0, 2, 8),
    new ClipView(clip, 0, 4, 12),
  ])
  expect(track.clipViews.length).toBe(0)
})
