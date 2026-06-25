import { ActiveAudioState } from './AudioControl'

export class EnhancedAudioContext extends AudioContext {
  readonly position = new Uint32Array(new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT))

  private reporterNode: AudioWorkletNode | null = null

  private constructor(
    readonly mode: ActiveAudioState,
    sampleRate: number,
  ) {
    super({ sampleRate: sampleRate })
  }

  private setReporterNode(reporterNode: AudioWorkletNode) {
    this.reporterNode = reporterNode
  }

  static async create(mode: ActiveAudioState, position: number, loopEnd: number = 0, sampleRate: number = 48000) {
    const result = new EnhancedAudioContext(mode, sampleRate)
    await result.audioWorklet.addModule(new URL('./ReportingAudioWorkletProcessor.js', import.meta.url))
    result.position[0] = position
    console.error(result.position[0], loopEnd)
    result.setReporterNode(
      new AudioWorkletNode(result, 'ReportingAudioWorkletProcessor', {
        processorOptions: {
          position: result.position,
          loopEnd: loopEnd,
        },
      }),
    )
    result.reporterNode!.connect(result.destination)
    return result
  }

  getDestination() {
    return this.reporterNode!
  }

  getPosition(): number {
    return this.position[0]
  }
}
