import { expect, test } from 'vitest'
import { Project } from '../project/Project'
import { Track } from '../project/Track'
import { createRenderingArgument } from './RenderingArgumentFactory'

test('rendering uses the project mute and solo mix', () => {
  const project = new Project('test', 48000)
  const first = new Track('first', 2)
  const second = new Track('second', 2)
  first.setGain(0.5)
  second.setGain(0.75)
  project.addTrack(first)
  project.addTrack(second)
  project.setTrackSoloed(second, true)

  const soloedMix = createRenderingArgument(project, 2, 0, 48000, [first, second])

  expect(soloedMix.trackSubsets.map((track) => track.gain)).toEqual([0, 0.75])

  project.setTrackMuted(second, true)
  const mutedSoloMix = createRenderingArgument(project, 2, 0, 48000, [first, second])

  expect(mutedSoloMix.trackSubsets.map((track) => track.gain)).toEqual([0, 0])
})
