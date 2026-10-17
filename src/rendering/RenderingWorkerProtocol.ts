import { EncoderInfo } from '../encoders/EncoderType'
import { ClipViewSubset } from '../playback/AudioFileReader'
import { Clip } from '../project/Clip'
import { EffectData } from '../effects/EffectData'

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

export type LoudnessMeasuringInitMessage = {
  type: 'init'
  dirname: string
  filename: string
  sampleRate: number
  channelCount: number
  encodingPort: MessagePort
  length: number
}

export type LoudnessNormalizingStartMessage = {
  dirname: string
  filename: string
  sampleRate: number
  channelCount: number
  length: number
  gain: number
  truePeakCeilingDb: number
  encodingPort: MessagePort
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

// Consumer → source, one per processed 'audio' message. Sources that throttle (LoudnessNormalizingWorker)
// wait for these; RenderingJob ignores them.
export type RenderingConsumerPortMessage = { type: 'consumed' }

export type RenderingOutputWorkerMessage = {
  progress?: number
  done?: boolean
  error?: string
  integratedLufs?: number
}

export type TrackSubset = {
  name: string
  length: number
  channelCount: number
  clipViews: Array<ClipViewSubset>
  gain: number
  pan: number
  effects: Array<EffectData>
}

export type RenderingArgument = {
  projectId: number
  sampleRate: number
  channelCount: number
  startPosition: number
  trackSubsets: Array<TrackSubset>
  length: number
}
