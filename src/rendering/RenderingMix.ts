import { RawDataAudioContext } from '@descript/web-audio-js'
import type { api } from '@descript/web-audio-js'
import { createRenderingAudioSource } from './RenderingAudioSource'
import type { RenderingAudioSource } from './RenderingAudioSource'
import type { RenderingArgument } from './RenderingWorkerProtocol'
import { scheduleParameterValues } from '../effects/ParameterScheduling'
import {
  BoostEffectMetadata,
  CompressionEffectMetadata,
  FadeEffectMetadata,
  NoiseReductionEffectMetadata,
  DeesserEffectMetadata,
  LimiterEffectMetadata,
  GateEffectMetadata,
} from '../effects/BuiltinEffectMetadata'
import { EqualizerEffectMetadata } from '../effects/equalizer/EqualizerMetadata'
import { BoostEffect, FadeEffect } from '../effects/gain/GainEffects'
import { NoiseReductionEffect } from '../effects/noisereduction/NoiseReductionEffect'
import type { EffectModule } from '../effects/Effect'
import type { EffectData } from '../effects/EffectData'
import { CompressionEffect } from '../effects/compression/CompressionEffect'
import { EqualizerEffect } from '../effects/equalizer/EqualizerEffect'
import { DeesserEffect } from '../effects/deesser/DeesserEffect'
import { LimiterEffect } from '../effects/limiter/LimiterEffect'
import { GateEffect } from '../effects/gate/GateEffect'

export interface RenderingMix {
  /** One source per track subset, in the same order; fill its channel data before processing each block. */
  readonly sources: readonly RenderingAudioSource[]
  disconnect(): void
}

/**
 * Connects each track through its effects, gain, and pan into the output effect chain, which feeds the
 * destination. Bypassed effects are left out, and automation is scheduled from `argument.startPosition`.
 */
export async function connectRenderingMix(
  audioContext: RawDataAudioContext,
  argument: RenderingArgument,
): Promise<RenderingMix> {
  const connectedEffectModules = new Array<EffectModule>()
  // Effect modules use DOM node types while this renderer uses web-audio-js nodes.
  const outputInput = (await connectEffects(
    audioContext,
    argument.outputEffects,
    audioContext.destination as unknown as AudioNode,
    argument.startPosition,
    connectedEffectModules,
  )) as unknown as api.AudioNode

  const sources = new Array<RenderingAudioSource>()
  for (const track of argument.trackSubsets) {
    const source = createRenderingAudioSource(audioContext, track.channelCount)
    sources.push(source)

    const gainNode = audioContext.createGain()
    gainNode.channelCount = argument.channelCount
    gainNode.channelCountMode = 'explicit'
    gainNode.channelInterpretation = 'speakers'
    gainNode.gain.value = track.gain
    if (argument.channelCount == 1) {
      gainNode.connect(outputInput, 0, 0)
    } else {
      const pannerNode = audioContext.createStereoPanner()
      pannerNode.pan.value = track.pan
      gainNode.connect(pannerNode, 0, 0)
      pannerNode.connect(outputInput, 0, 0)
    }

    const trackInput = await connectEffects(
      audioContext,
      track.effects,
      gainNode as unknown as AudioNode,
      argument.startPosition,
      connectedEffectModules,
    )
    source.node.connect(trackInput as unknown as api.AudioNode, 0, 0)
  }

  return {
    sources,
    disconnect() {
      sources.forEach(({ node }) => node.disconnect())
      connectedEffectModules.forEach((effectModule) => effectModule.disconnect())
    },
  }
}

/** Connects the unbypassed `effects` in order in front of `destination` and returns the chain's input. */
async function connectEffects(
  audioContext: RawDataAudioContext,
  effects: readonly EffectData[],
  destination: AudioNode,
  startPosition: number,
  connectedEffectModules: EffectModule[],
): Promise<AudioNode> {
  const context = audioContext as unknown as BaseAudioContext
  const effectModules = new Array<EffectModule>()
  for (const effectData of effects) {
    if (effectData.bypassed) {
      continue
    }
    const effectModule = getRenderingEffect(effectData.id)
    if (!effectModule) {
      console.error(`Effect ${effectData.id} is unavailable`)
      continue
    }
    effectModule.setState?.(effectData.state)
    const parameters = await effectModule.getParameters(context)
    for (const [name, sequence] of Object.entries(effectData.params)) {
      const parameter = parameters[name]
      if (parameter) {
        scheduleParameterValues(parameter, sequence, context, startPosition)
      }
    }
    effectModules.push(effectModule)
  }

  let input = destination
  for (const effectModule of effectModules.toReversed()) {
    input = await effectModule.connect(context, input)
    connectedEffectModules.push(effectModule)
  }
  return input
}

function getRenderingEffect(id: string): EffectModule | null {
  switch (id) {
    case FadeEffectMetadata.id:
      return new FadeEffect()
    case BoostEffectMetadata.id:
      return new BoostEffect()
    case NoiseReductionEffectMetadata.id:
      return new NoiseReductionEffect()
    case CompressionEffectMetadata.id:
      return new CompressionEffect()
    case DeesserEffectMetadata.id:
      return new DeesserEffect()
    case LimiterEffectMetadata.id:
      return new LimiterEffect()
    case GateEffectMetadata.id:
      return new GateEffect()
    case EqualizerEffectMetadata.id:
      return new EqualizerEffect()
    default:
      return null
  }
}
