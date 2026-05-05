import { Analyzable } from '../analyzers/Analyzable'

export interface AudioInput extends Analyzable {
  name: string
  id: string
  init(context: AudioContext): void
  connect(destination: AudioNode): Promise<void>
  stop(): void
  mute(): void
  unmute(): void
  channelCount: number
}
