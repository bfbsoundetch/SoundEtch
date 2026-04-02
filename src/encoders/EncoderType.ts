import { FlacFileWriter } from './FlacFileWriter'
import { Mp3FileWriter } from './Mp3FileWriter'
import { Mp3Transformer } from './Mp3Transformer'
import { OpusFileWriter } from './OpusFileWriter'
import { OpusTransformer } from './OpusTransformer'
import { WavFileWriter } from './WavFileWriter'
import { WavTransformer } from './WavTransformer'

export type EncoderInfo = WavEncoderInfo | OpusEncoderInfo | Mp3EncoderInfo | FlacEncoderInfo

export type WavSampleFormat = 'float32' | 'int24' | 'int16' | 'int8'

export type WavEncoderInfo = {
  encoder: 'wav'
  sampleRate: number
  channelCount: number
  sampleFormat: WavSampleFormat
  sampleCount: number
}

// Constants defined in
// https://github.com/xiph/opus/blob/b5dc74f26ff9a9ef1f1af9a473b9ae07520eed7d/include/opus_defines.h
export enum OpusApplication {
  OPUS_APPLICATION_VOIP = 2048,
  OPUS_APPLICATION_AUDIO = 2049,
  OPUS_APPLICATION_RESTRICTED_LOWDELAY = 2051,
}

export enum OpusBandwidth {
  AUTO = 0,
  NARROWBAND = 1101,
  MEDIUMBAND = 1102,
  WIDEBAND = 1103,
  SUPERWIDEBAND = 1104,
  FULLBAND = 1105,
}

// Duplicated in opus_encoder.c
export enum OpusBitrateMode {
  VARIABLE = 0,
  CONSTANT = 1,
  CONSTRAINED = 2,
}

export type OpusEncoderInfo = {
  encoder: 'opus'
  sampleRate: number
  channelCount: number
  bitrate: number
  bitrateMode: OpusBitrateMode
  complexity: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  bandwidth: OpusBandwidth
  application: OpusApplication
  frameSize: 2.5 | 5 | 10 | 20 | 40 | 60
}

export type Mp3CbrValue = 8 | 16 | 24 | 32 | 40 | 48 | 64 | 80 | 96 | 112 | 128 | 160 | 192 | 224 | 256 | 320

export type Mp3OutputSampleRate = 8000 | 11025 | 12000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000

export type Mp3EncoderInfo = {
  encoder: 'mp3'
  sampleRate: Mp3OutputSampleRate
  channelCount: number
  bitrate: number | undefined
  vbrQuality: number | undefined
}

export type FlacEncoderInfo = {
  encoder: 'flac'
  sampleRate: number
  channelCount: number
  bitDepth: 8 | 16 | 24
  compressionLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

export async function encoderInforWritableStreamFactory(
  fileWritable: FileSystemWritableFileStream,
  encoderInfo: EncoderInfo,
) {
  switch (encoderInfo.encoder) {
    case 'wav':
      return new WavFileWriter(fileWritable, encoderInfo)
    case 'opus':
      return OpusFileWriter.create(fileWritable, encoderInfo)
    case 'mp3':
      return Mp3FileWriter.create(fileWritable, encoderInfo)
    case 'flac':
      return FlacFileWriter.create(fileWritable, encoderInfo)
  }
}

export async function encoderInfoTransformerFactory(
  length: number,
  encoderInfo: EncoderInfo,
): Promise<TransformStream> {
  switch (encoderInfo.encoder) {
    case 'wav':
      return new TransformStream(
        new WavTransformer(length, encoderInfo.sampleRate, encoderInfo.channelCount, encoderInfo.sampleFormat),
      )
    case 'opus':
      return new TransformStream(new OpusTransformer(encoderInfo.sampleRate, encoderInfo.channelCount))
    case 'mp3':
      if (encoderInfo.bitrate) {
        return new TransformStream(
          await Mp3Transformer.createCbrEncoder(
            encoderInfo.sampleRate,
            encoderInfo.sampleRate as Mp3OutputSampleRate,
            encoderInfo.channelCount as 1 | 2,
            encoderInfo.bitrate as Mp3CbrValue,
          ),
        )
      } else {
        return new TransformStream(
          await Mp3Transformer.createVbrEncoder(
            encoderInfo.sampleRate,
            encoderInfo.sampleRate as Mp3OutputSampleRate,
            encoderInfo.channelCount as 1 | 2,
            encoderInfo.vbrQuality!,
          ),
        )
      }
    case 'flac':
      throw new Error('Unimplemented')
  }
}
