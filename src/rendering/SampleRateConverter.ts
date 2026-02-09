import { WavFileWriter } from '../encoders/WavFileWriter'

export class SampleRateConverter {
  static async convert(pcmSamples: Float32Array, oldRate: number, newRate: number): Promise<AudioBuffer> {
    const header = WavFileWriter.getWavHeader('float32', oldRate, pcmSamples.length, 1)
    const context = new OfflineAudioContext({
      sampleRate: newRate,
      numberOfChannels: 1,
      length: pcmSamples.length,
    })
    const toDecode = new Uint8Array(header.byteLength + pcmSamples.byteLength)
    toDecode.set(new Uint8Array(header))
    toDecode.set(new Uint8Array(pcmSamples.buffer), header.byteLength)
    return context.decodeAudioData(toDecode.buffer)
  }
}
