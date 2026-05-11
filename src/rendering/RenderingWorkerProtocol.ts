import { EncoderInfo } from '../encoders/EncoderType'
import { Effect } from '../effects/Effects'
import { ClipViewSubset } from '../playback/AudioFileReader'

export type RenderingWorkerStartMessage = {
  argument: RenderingArgument
  encodingPort: MessagePort
}

export type RenderingEncodingInitMessage = {
  type: 'init'
  file: FileSystemFileHandle
  encoderInfo: EncoderInfo
  channelCount: number
  encodingPort: MessagePort
  length: number
}

export type RenderingEncodingPortMessage =
  | {
      type: 'audio'
      buffer: ArrayBuffer
      length: number
    }
  | {
      type: 'stop'
    }

export type TrackSubset = {
  name: string
  length: number
  channelCount: number
  clipViews: Array<ClipViewSubset>
  effects: Array<Effect>
  gain: number
  pan: number
}

export type RenderingArgument = {
  file: FileSystemFileHandle
  encoderInfo: EncoderInfo
  projectId: number
  sampleRate: number
  channelCount: number
  startPosition: number
  trackSubsets: Array<TrackSubset>
  length: number
}
