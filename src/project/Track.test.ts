import { Clip } from './Clip'
import { ClipView } from './ClipView'
import { Track } from './Track'
import { expect, test } from 'vitest'

test('createTrack_titleAndChannelCountMatch', async () => {
  const track = new Track('test', 2)

  expect(track.name).toBe('test')
  expect(track.getChannelCount()).toBe(2)
})

test('addClipView_secondOverlapsFirst_succeeds', async () => {
  const clip = new Clip('test', 2, 4)
  const firstClipView = new ClipView(clip, 0, 0, 3)
  const secondClipView = new ClipView(clip, 0, 2, 2)

  const track = new Track('test', 2)
  track.addClipView(firstClipView)
  track.addClipView(secondClipView)

  expect(track.clipViews).toEqual([firstClipView, secondClipView])
})

test('addClipView_firstOverlapsSecond_succeedsAndSorts', async () => {
  const clip = new Clip('test', 2, 4)
  const firstClipView = new ClipView(clip, 0, 2, 2)
  const secondClipView = new ClipView(clip, 0, 0, 3)

  const track = new Track('test', 2)
  track.addClipView(firstClipView)
  track.addClipView(secondClipView)

  expect(track.clipViews).toEqual([secondClipView, firstClipView])
})

test('addClipView_overlapsTwoClipsAtOnce_throwsError', async () => {
  const clip = new Clip('test', 2, 5)
  const track = new Track('test', 2)
  track.addClipView(new ClipView(clip, 0, 0, 3))
  track.addClipView(new ClipView(clip, 0, 2, 3))

  const thirdClipView = new ClipView(clip, 0, 1, 3)

  expect(track.canAddClipView(thirdClipView)).toBe(false)
  expect(() => track.addClipView(thirdClipView)).toThrow('New clip would overlap two existing clips!')
})

test('addClipView_overlapsTwoClipsAtDifferentPositions_succeeds', async () => {
  const clip = new Clip('test', 2, 7)
  const track = new Track('test', 2)
  track.addClipView(new ClipView(clip, 0, 0, 3))
  track.addClipView(new ClipView(clip, 0, 4, 3))

  const crossfadeClipView = new ClipView(clip, 0, 2, 3)

  expect(track.canAddClipView(crossfadeClipView)).toBe(true)
  track.addClipView(crossfadeClipView)
})

test('addClipView_inBetweenWithoutOverlap_succeeds', async () => {
  const clip = new Clip('test', 2, 8)
  const firstClipView = new ClipView(clip, 0, 0, 2)
  const secondClipView = new ClipView(clip, 0, 2, 2)
  const thirdClipView = new ClipView(clip, 0, 4, 2)

  const track = new Track('test', 2)
  track.addClipView(firstClipView)
  track.addClipView(thirdClipView)
  track.addClipView(secondClipView)
})

test('addClipView_inSequenceWithoutOverlap_succeeds', async () => {
  const clip = new Clip('test', 2, 8)
  const firstClipView = new ClipView(clip, 0, 0, 2)
  const secondClipView = new ClipView(clip, 0, 2, 2)
  const thirdClipView = new ClipView(clip, 0, 4, 2)

  const track = new Track('test', 2)
  track.addClipView(firstClipView)
  track.addClipView(secondClipView)
  track.addClipView(thirdClipView)
})

test('slice_singleClipView_removesSlice', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2, 8)
  track.addClipView(new ClipView(clip, 0, 0, 8))

  const result = track.slice(2, 4, true)

  expect(result.length).toBe(1)
  expect(result[0]).toEqual(new ClipView(clip, 2, 2, 2))
  expect(track.clipViews.length).toBe(2)
  expect(track.clipViews).toEqual([new ClipView(clip, 0, 0, 2), new ClipView(clip, 4, 4, 4)])
})

test('slice_startsInsideCrossfade_discardsShortLeftRemnant', async () => {
  const track = new Track('test', 2)
  const clip = new Clip('test', 2, 10)
  track.addClipView(new ClipView(clip, 0, 0, 6))
  track.addClipView(new ClipView(clip, 0, 4, 6))

  const result = track.slice(5, 8, true)

  expect(result).toEqual([new ClipView(clip, 5, 5, 1), new ClipView(clip, 1, 5, 3)])
  expect(track.clipViews).toEqual([new ClipView(clip, 0, 0, 5), new ClipView(clip, 4, 8, 2)])
})

test('slice_endsInsideCrossfade_discardsShortRightRemnant', async () => {
  const track = new Track('test', 2)
  const clip = new Clip('test', 2, 10)
  track.addClipView(new ClipView(clip, 0, 0, 6))
  track.addClipView(new ClipView(clip, 0, 4, 6))

  const result = track.slice(2, 5, true)

  expect(result).toEqual([new ClipView(clip, 2, 2, 3), new ClipView(clip, 0, 4, 1)])
  expect(track.clipViews).toEqual([new ClipView(clip, 0, 0, 2), new ClipView(clip, 1, 5, 5)])
})

test('slice_multipleClipViews_removesSlice', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2, 4)
  track.addClipView(new ClipView(clip, 0, 0, 2))
  track.addClipView(new ClipView(clip, 0, 4, 2))
  track.addClipView(new ClipView(clip, 0, 8, 2))
  track.addClipView(new ClipView(clip, 0, 12, 4))

  const result = track.slice(1, 15, true)

  expect(result.length).toBe(4)
  expect(result).toEqual([
    new ClipView(clip, 1, 1, 1),
    new ClipView(clip, 0, 4, 2),
    new ClipView(clip, 0, 8, 2),
    new ClipView(clip, 0, 12, 3),
  ])
  expect(track.clipViews.length).toBe(2)
  expect(track.clipViews).toEqual([new ClipView(clip, 0, 0, 1), new ClipView(clip, 3, 15, 1)])
})

test('slice_multipleClipViews_throughEnd', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2, 4)
  track.addClipView(new ClipView(clip, 0, 0, 2))
  track.addClipView(new ClipView(clip, 0, 4, 2))
  track.addClipView(new ClipView(clip, 0, 8, 2))
  track.addClipView(new ClipView(clip, 0, 12, 4))

  const result = track.slice(2, 16, true)

  expect(result.length).toBe(3)
  expect(result).toEqual([new ClipView(clip, 0, 4, 2), new ClipView(clip, 0, 8, 2), new ClipView(clip, 0, 12, 4)])
  expect(track.clipViews.length).toBe(1)
  expect(track.clipViews).toEqual([new ClipView(clip, 0, 0, 2)])
})

test('slice_multipleClipViews_startsAtBeginning', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2, 4)
  track.addClipView(new ClipView(clip, 0, 0, 2))
  track.addClipView(new ClipView(clip, 0, 4, 2))
  track.addClipView(new ClipView(clip, 0, 8, 2))
  track.addClipView(new ClipView(clip, 0, 12, 4))

  const result = track.slice(0, 15, true)

  expect(result.length).toBe(4)
  expect(result).toEqual([
    new ClipView(clip, 0, 0, 2),
    new ClipView(clip, 0, 4, 2),
    new ClipView(clip, 0, 8, 2),
    new ClipView(clip, 0, 12, 3),
  ])
  expect(track.clipViews.length).toBe(1)
  expect(track.clipViews).toEqual([new ClipView(clip, 3, 15, 1)])
})

test('slice_multipleClipViews_allClipViewsDeleted', async () => {
  const track = new Track('test', 2)

  const clip = new Clip('test', 2, 4)
  track.addClipView(new ClipView(clip, 0, 0, 2))
  track.addClipView(new ClipView(clip, 0, 4, 2))
  track.addClipView(new ClipView(clip, 0, 8, 2))
  track.addClipView(new ClipView(clip, 0, 12, 4))

  const result = track.slice(0, 16, true)

  expect(result.length).toBe(4)
  expect(result).toEqual([
    new ClipView(clip, 0, 0, 2),
    new ClipView(clip, 0, 4, 2),
    new ClipView(clip, 0, 8, 2),
    new ClipView(clip, 0, 12, 4),
  ])
  expect(track.clipViews.length).toBe(0)
})
