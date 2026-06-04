import {
  AudioSample,
  AudioSampleSource,
  OggOutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny'
import { OpusBitrateMode, OpusEncoderInfo } from './EncoderType'

export class MediabunnyOpusFileWriter {
  private static readonly INPUT_BUFFER_FRAME_SIZE = 32 * 1024

  private readonly inputBuffer: Float32Array
  private writtenFrameCount = 0

  static async create(fileWritable: FileSystemWritableFileStream, opusEncoderInfo: OpusEncoderInfo) {
    const bitrateMode = MediabunnyOpusFileWriter.getBitrateMode(opusEncoderInfo.bitrateMode)
    const audioSource = new AudioSampleSource({
      codec: 'opus',
      bitrate: opusEncoderInfo.bitrate,
      bitrateMode,
    })
    const output = new Output({
      format: new OggOutputFormat(),
      target: new StreamTarget(fileWritable as unknown as WritableStream<StreamTargetChunk>, {
        chunked: true,
        chunkSize: 2 ** 20,
      }),
    })

    output.addAudioTrack(audioSource)
    await output.start()

    return new MediabunnyOpusFileWriter(opusEncoderInfo, output, audioSource)
  }

  private constructor(
    private readonly opusEncoderInfo: OpusEncoderInfo,
    private readonly output: Output,
    private readonly audioSource: AudioSampleSource,
  ) {
    this.inputBuffer = new Float32Array(opusEncoderInfo.channelCount * MediabunnyOpusFileWriter.INPUT_BUFFER_FRAME_SIZE)
  }

  readonly inputSampleFormat = 'interleaved'

  getInputBuffer(): Float32Array {
    return this.inputBuffer
  }

  async writeChunk(length: number) {
    if (length === 0) {
      return
    }

    const sampleCount = length * this.opusEncoderInfo.channelCount
    const sample = new AudioSample({
      data: this.inputBuffer.slice(0, sampleCount),
      format: 'f32',
      numberOfChannels: this.opusEncoderInfo.channelCount,
      sampleRate: this.opusEncoderInfo.sampleRate,
      timestamp: this.writtenFrameCount / this.opusEncoderInfo.sampleRate,
    })

    try {
      await this.audioSource.add(sample)
    } finally {
      sample.close()
    }

    this.writtenFrameCount += length
  }

  async finish() {
    this.audioSource.close()
    await this.output.finalize()
  }

  private static getBitrateMode(bitrateMode: OpusBitrateMode): 'constant' | 'variable' {
    return bitrateMode === OpusBitrateMode.CONSTANT ? 'constant' : 'variable'
  }
}
