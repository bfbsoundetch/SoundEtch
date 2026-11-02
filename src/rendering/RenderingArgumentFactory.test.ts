import { expect, test } from 'vitest'
import { Project } from '../project/Project'
import { Track } from '../project/Track'
import { createRenderingArgument } from './RenderingArgumentFactory'
import { Clip } from '../project/Clip'
import { ClipView } from '../project/ClipView'

test('rendering uses the project mute and solo mix', () => {
  const project = new Project('test', 48000)
  const first = new Track('first', 2)
  const second = new Track('second', 2)
  first.setGain(0.5)
  second.setGain(0.75)
  project.addTrack(first)
  project.addTrack(second)
  project.setTrackSoloed(second, true)

  const soloedMix = createRenderingArgument(project, 2, 0, 48000, [first, second], [])

  expect(soloedMix.trackSubsets.map((track) => track.gain)).toEqual([0, 0.75])

  project.setTrackMuted(second, true)
  const mutedSoloMix = createRenderingArgument(project, 2, 0, 48000, [first, second], [])

  expect(mutedSoloMix.trackSubsets.map((track) => track.gain)).toEqual([0, 0])
})

test('video duration retains the timeline while PCM reads exclude silent clips and video tails', () => {
  const project = new Project('video mix', 48_000)
  const silent = new Clip('silent footage', 1)
  silent.audioPresent = false
  silent.videoLength = 96_000
  const linked = new Clip('linked footage', 1, 48_000)
  linked.videoLength = 96_000
  const track = new Track('footage', 1)
  track.addClipView(new ClipView(silent, 0, 0, 96_000))
  track.addClipView(new ClipView(linked, 24_000, 96_000, 72_000))
  track.addClipView(new ClipView(linked, 60_000, 168_000, 36_000))
  project.addTrack(track)

  const argument = createRenderingArgument(project, 1, 0, track.length, [track], [])

  expect(argument.length).toBe(204_000)
  expect(argument.trackSubsets[0].length).toBe(204_000)
  expect(
    argument.trackSubsets[0].clipViews.map(({ startPosition, offset, length }) => [startPosition, offset, length]),
  ).toEqual([[96_000, 24_000, 24_000]])
})
