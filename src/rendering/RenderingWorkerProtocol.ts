import { EncoderInfo } from '../encoders/EncoderType'
import { ClipViewSubset } from '../playback/AudioFileReader'
import { Clip } from '../project/Clip'

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

export type RenderingFileWritingInitMessage = {
  type: 'init'
  dirname: string
  clip: Clip
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
  gain: number
  pan: number
}

export type RenderingArgument = {
  projectId: number
  sampleRate: number
  channelCount: number
  startPosition: number
  trackSubsets: Array<TrackSubset>
  length: number
}
