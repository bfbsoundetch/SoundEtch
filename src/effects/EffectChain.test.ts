import { expect, test } from 'vitest'
import { RawDataAudioContext } from '@descript/web-audio-js'
import { createRenderingAudioSource } from '../rendering/RenderingAudioSource'
import { EffectChain } from './EffectChain'
import { BoostEffect } from './gain/GainEffects'

test('bypass reroutes a running chain around each effect', async () => {
  const blockSize = 128
  const audioContext = new RawDataAudioContext({ sampleRate: 48000, blockSize, numberOfChannels: 1 })
  const context = audioContext as unknown as BaseAudioContext
  const source = createRenderingAudioSource(audioContext, 1)
  source.channelData[0].fill(1)
  audioContext.resume()

  const createEffect = async (instanceId: string, gain: number) => {
    const module = new BoostEffect()
    ;(await module.getParameters(context)).gain.value = gain
    return { instanceId, module, audioContext: context }
  }
  const half = await createEffect('half', 0.5)
  const quarter = await createEffect('quarter', 0.25)
  const chain = await EffectChain.connect(
    context,
    [
      { effect: half, bypassed: false },
      { effect: quarter, bypassed: true },
    ],
    audioContext.destination as unknown as AudioNode,
  )
  source.node.connect(chain.input as unknown as typeof source.node, 0, 0)

  const render = () => {
    const output = new Float32Array(blockSize)
    audioContext.process([output])
    return output[blockSize - 1]
  }

  expect(render()).toBe(0.5)
  chain.setBypassed('quarter', false)
  expect(render()).toBe(0.125)
  chain.setBypassed('half', true)
  expect(render()).toBe(0.25)
  chain.setBypassed('half', true)
  chain.setBypassed('quarter', true)
  expect(render()).toBe(1)
  chain.setBypassed('half', false)
  expect(render()).toBe(0.5)
})
