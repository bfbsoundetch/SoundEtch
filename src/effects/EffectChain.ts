import type { EffectModule } from './Effect'

export interface PlaybackEffect {
  readonly instanceId: string
  readonly module: EffectModule
  readonly audioContext: BaseAudioContext
}

interface EffectInsert {
  readonly effect: PlaybackEffect
  /** Feeds the effect, or carries the dry signal straight to `next` while bypassed. */
  readonly send: GainNode
  readonly input: AudioNode
  /** Receives the effect's output; disconnected from `next` while bypassed. */
  readonly output: GainNode
  readonly next: AudioNode
  bypassed: boolean
}

/**
 * Serial effect inserts whose bypass can change while audio runs. Every effect sits between two unity-gain
 * junctions so bypass disconnects only those junctions; `EffectModule.disconnect()` would dispose some
 * runtimes (equalizer, noise reduction) and lose their scheduled parameters.
 */
export class EffectChain {
  private constructor(
    private readonly inserts: readonly EffectInsert[],
    /** Connect the chain's source here. */
    readonly input: AudioNode,
  ) {}

  /** Connects `effects` in order, ending at `destination`. */
  static async connect(
    audioContext: BaseAudioContext,
    effects: readonly { effect: PlaybackEffect; bypassed: boolean }[],
    destination: AudioNode,
  ) {
    const inserts = new Array<EffectInsert>(effects.length)
    let next = destination
    for (let index = effects.length - 1; index >= 0; --index) {
      const { effect, bypassed } = effects[index]
      const output = audioContext.createGain()
      const input = await effect.module.connect(audioContext, output)
      const send = audioContext.createGain()
      if (bypassed) {
        send.connect(next)
      } else {
        send.connect(input)
        output.connect(next)
      }
      inserts[index] = { effect, send, input, output, next, bypassed }
      next = send
    }
    return new EffectChain(inserts, next)
  }

  getEffect(instanceId: string) {
    return this.findInsert(instanceId)?.effect ?? null
  }

  setBypassed(instanceId: string, bypassed: boolean) {
    const insert = this.findInsert(instanceId)
    if (!insert || insert.bypassed == bypassed) {
      return
    }
    // The effect must never be pulled while its input is disconnected: the noise reducer's worklet returns
    // false from process() on empty input, and Chrome never calls process() again after that.
    if (bypassed) {
      insert.output.disconnect()
      insert.send.disconnect(insert.input)
      insert.send.connect(insert.next)
    } else {
      insert.send.connect(insert.input)
      insert.send.disconnect(insert.next)
      insert.output.connect(insert.next)
    }
    insert.bypassed = bypassed
  }

  disconnect() {
    for (const insert of this.inserts) {
      insert.send.disconnect()
      insert.output.disconnect()
      insert.effect.module.disconnect()
    }
  }

  private findInsert(instanceId: string) {
    return this.inserts.find((insert) => insert.effect.instanceId == instanceId)
  }
}
