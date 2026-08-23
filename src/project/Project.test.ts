import { expect, test, vi } from 'vitest'
import { Project } from './Project'
import { Track } from './Track'

function attachPlayback(track: Track) {
  const playerNode = { disconnect: vi.fn() } as unknown as AudioWorkletNode
  const gainNode = { gain: { value: 0 } } as GainNode
  const pannerNode = { pan: { value: 0 } } as StereoPannerNode
  track.registerNewPlayback(playerNode, gainNode, pannerNode)
  return { playerNode, gainNode }
}

test('mute and solo update live track audibility without changing fader gain', () => {
  const project = new Project('test', 48000)
  const first = new Track('first', 2)
  const second = new Track('second', 2)
  first.setGain(0.5)
  second.setGain(0.75)
  project.addTrack(first)
  project.addTrack(second)
  const firstPlayback = attachPlayback(first)
  const secondPlayback = attachPlayback(second)

  project.setTrackSoloed(first, true)

  expect(firstPlayback.gainNode.gain.value).toBe(0.5)
  expect(secondPlayback.gainNode.gain.value).toBe(0)

  project.setTrackSoloed(second, true)

  expect(firstPlayback.gainNode.gain.value).toBe(0.5)
  expect(secondPlayback.gainNode.gain.value).toBe(0.75)

  project.setTrackMuted(first, true)
  first.setGain(0.25)

  expect(first.getGain()).toBe(0.25)
  expect(firstPlayback.gainNode.gain.value).toBe(0)
  expect(secondPlayback.gainNode.gain.value).toBe(0.75)
})

test('deleting the last soloed track restores the remaining mix', () => {
  const project = new Project('test', 48000)
  const soloed = new Track('soloed', 2)
  const remaining = new Track('remaining', 2)
  project.addTrack(soloed)
  project.addTrack(remaining)
  const soloedPlayback = attachPlayback(soloed)
  const remainingPlayback = attachPlayback(remaining)
  project.setTrackSoloed(soloed, true)

  project.deleteTrack(soloed)

  expect(soloedPlayback.playerNode.disconnect).toHaveBeenCalledOnce()
  expect(remainingPlayback.gainNode.gain.value).toBe(1)
})
