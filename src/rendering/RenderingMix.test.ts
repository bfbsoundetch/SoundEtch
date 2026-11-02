import { expect, test } from 'vitest'
import { RawDataAudioContext } from '@descript/web-audio-js'
import { BoostEffectMetadata, FadeEffectMetadata, LimiterEffectMetadata } from '../effects/BuiltinEffectMetadata'
import type { EffectData } from '../effects/EffectData'
import { ParameterValueSequence, ParamValueTransition } from '../effects/ParameterValueSequence'
import { connectRenderingMix } from './RenderingMix'
import type { RenderingArgument, TrackSubset } from './RenderingWorkerProtocol'

const BLOCK_SIZE = 128

function monoTrack(gain: number): TrackSubset {
  return { name: 'track', length: 0, channelCount: 1, clipViews: [], gain, pan: 0, effects: [] }
}

function effect(id: string, params: Record<string, number | ParameterValueSequence>, bypassed = false): EffectData {
  return {
    instanceId: crypto.randomUUID(),
    id,
    params: Object.fromEntries(
      Object.entries(params).map(([name, value]) => [
        name,
        typeof value == 'number' ? new ParameterValueSequence(value) : value,
      ]),
    ),
    bypassed,
  }
}

/** Renders mono blocks while each track's source plays a constant from `levels`. */
async function render(argument: RenderingArgument, levels: readonly number[], blockCount: number) {
  const audioContext = new RawDataAudioContext({
    sampleRate: argument.sampleRate,
    blockSize: BLOCK_SIZE,
    numberOfChannels: 1,
  })
  audioContext.resume()
  const mix = await connectRenderingMix(audioContext, argument)
  const output = new Float32Array(BLOCK_SIZE)
  const blocks = new Array<Float32Array>()
  for (let block = 0; block < blockCount; ++block) {
    mix.sources.forEach((source, index) => source.channelData[0].fill(levels[index]))
    audioContext.process([output])
    blocks.push(output.slice())
  }
  mix.disconnect()
  return blocks
}

function argument(startPosition: number, outputEffects: EffectData[]): RenderingArgument {
  return {
    projectId: 1,
    sampleRate: 48_000,
    channelCount: 1,
    startPosition,
    length: 0,
    trackSubsets: [monoTrack(0.5), monoTrack(1)],
    outputEffects,
  }
}

test('output effects follow track gain, skip bypass, and automate from the export start', async () => {
  const volume = new ParameterValueSequence(1)
  const startPosition = 10_000
  volume.transitionSequence.push(
    // Already reached when the export starts, so the export begins at half volume.
    new ParamValueTransition('linear', 0.5, startPosition - 5_000),
    new ParamValueTransition('linear', 0.25, startPosition + 4 * BLOCK_SIZE),
  )
  const outputEffects = [
    effect(BoostEffectMetadata.id, { gain: 8 }, true),
    effect(FadeEffectMetadata.id, { gain: volume }),
  ]

  const blocks = await render(argument(startPosition, outputEffects), [1, 0.5], 6)

  // The tracks mix to 1 * 0.5 + 0.5 * 1.
  expect(blocks[0][0]).toBe(0.5)
  expect(blocks[2][0]).toBeLessThan(0.5)
  expect(blocks[2][0]).toBeGreaterThan(0.25)
  expect(blocks[5].every((sample) => sample == 0.25)).toBe(true)
})

test('an output limiter limits the mix of the tracks, not each track', async () => {
  const ceilingDb = -6
  const outputEffects = [effect(LimiterEffectMetadata.id, { ceiling: ceilingDb, release: 50 })]

  // Each track's 0.4 stays under the ceiling; only their 0.8 sum exceeds it.
  const blocks = await render(argument(0, outputEffects), [0.8, 0.4], 40)

  const settled = blocks.slice(-10).flatMap((block) => Array.from(block))
  const ceiling = 10 ** (ceilingDb / 20)
  expect(Math.max(...settled)).toBeLessThanOrEqual(ceiling + 1e-6)
  expect(Math.min(...settled)).toBeGreaterThan(ceiling * 0.95)
})
