import {
  AudioSample,
  AudioSampleSource,
  Mp4OutputFormat,
  NullTarget,
  Output,
  type AudioEncodingConfig,
} from 'mediabunny'

/** AAC backends do not consistently report priming in packet timestamps. Measure the actual export configuration. */
export async function measureAacEncoderDelay(
  config: AudioEncodingConfig & { codec: 'aac' },
  sampleRate: number,
  channelCount: number,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted()
  if (typeof AudioDecoder === 'undefined') {
    throw new Error('This browser needs an AAC audio decoder to synchronize video exports')
  }
  const frameCount = Math.round(sampleRate / 4)
  const impulseFrame = Math.floor(frameCount / 2)
  const pcm = new Float32Array(frameCount * channelCount)
  for (let channel = 0; channel < channelCount; ++channel) pcm[impulseFrame * channelCount + channel] = 0.5

  let firstTimestamp: number | null = null
  let peak = 0
  let peakTime = 0
  let plane = new Float32Array(0)
  let decodeError: Error | null = null
  const decoder = new AudioDecoder({
    output: (sample) => {
      try {
        if (plane.length < sample.numberOfFrames) plane = new Float32Array(sample.numberOfFrames)
        sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' })
        for (let frame = 0; frame < sample.numberOfFrames; ++frame) {
          const amplitude = Math.abs(plane[frame])
          if (amplitude > peak) {
            peak = amplitude
            peakTime = sample.timestamp / 1_000_000 + frame / sample.sampleRate
          }
        }
      } finally {
        sample.close()
      }
    },
    error: (error) => {
      decodeError = error
    },
  })
  const source = new AudioSampleSource({
    ...config,
    onEncodedPacket: (packet, metadata) => {
      signal.throwIfAborted()
      firstTimestamp ??= packet.timestamp
      if (decoder.state === 'unconfigured') {
        if (!metadata?.decoderConfig) throw new Error('AAC encoder did not provide its decoder configuration')
        decoder.configure(metadata.decoderConfig)
      }
      decoder.decode(packet.toEncodedAudioChunk())
    },
  })
  const output = new Output({ format: new Mp4OutputFormat(), target: new NullTarget() })
  output.addAudioTrack(source)
  const abort = () => {
    if (decoder.state !== 'closed') decoder.close()
    void output.cancel().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  const sample = new AudioSample({
    data: pcm,
    format: 'f32',
    numberOfChannels: channelCount,
    sampleRate,
    timestamp: 0,
  })
  try {
    await output.start()
    signal.throwIfAborted()
    await source.add(sample)
    source.close()
    await output.finalize()
    signal.throwIfAborted()
    await decoder.flush()
    signal.throwIfAborted()
    if (decodeError) throw decodeError
    if (firstTimestamp === null || peak === 0) throw new Error('Could not measure AAC encoder priming')
    const delaySamples = Math.round((peakTime - firstTimestamp - impulseFrame / sampleRate) * sampleRate)
    if (delaySamples < 0) throw new Error('AAC encoder reported an invalid presentation delay')
    return delaySamples / sampleRate
  } finally {
    sample.close()
    signal.removeEventListener('abort', abort)
    if (decoder.state !== 'closed') decoder.close()
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {})
  }
}
