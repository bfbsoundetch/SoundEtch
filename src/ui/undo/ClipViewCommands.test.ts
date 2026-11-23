import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { Clip } from '../../project/Clip'
import { ClipView } from '../../project/ClipView'
import { Track } from '../../project/Track'
import { RemoveClipViewCommand, ReplaceClipViewCommand } from './UndoableActions'

test('undo restores a layout that a new edit would refuse', async () => {
  const clip = new Clip('take', 1, 200)
  const track = new Track('track', 1)
  // Splitting inside a crossfade leaves the second part playing entirely within the next clip.
  const first = new ClipView(clip, 0, 0, 90)
  const crossfaded = new ClipView(clip, 0, 80, 120)
  const nested = new ClipView(clip, 90, 90, 10)
  track.clipViews.push(first, crossfaded, nested)

  const remove = new RemoveClipViewCommand(nested, track)
  await remove.perform()
  expect(track.canAddClipView(nested)).toBe(false)
  await remove.undo()
  expect(track.clipViews).toEqual([first, crossfaded, nested])

  const replace = new ReplaceClipViewCommand(track, nested, new ClipView(clip, 90, 300, 10), 'move clip view')
  await replace.perform()
  await replace.undo()
  expect(track.clipViews).toEqual([first, crossfaded, nested])
})
