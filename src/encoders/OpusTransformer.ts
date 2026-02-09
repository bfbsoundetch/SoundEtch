export class OpusTransformer implements Transformer<Float32Array, ArrayBuffer | SharedArrayBuffer> {
  private timestampMicroseconds = 0
  private controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer> | null = null
  private readonly encoder = new AudioEncoder({
    output: (encodedAudioChunk) => {
      const output = new ArrayBuffer(encodedAudioChunk.byteLength)
      encodedAudioChunk.copyTo(output)
      this.controller!.enqueue(output)
      console.error(encodedAudioChunk.timestamp + ' ' + encodedAudioChunk.type)
    },
    error: (e) => {
      console.error(e)
    },
  })

  constructor(
    private readonly sampleRate: number,
    private readonly channelCount: number,
  ) {
    this.encoder.configure({
      codec: 'opus',
      numberOfChannels: channelCount,
      sampleRate: sampleRate,
    })
  }
  async flush() {
    await this.encoder.flush()
    this.encoder.close()
  }
  start: TransformerStartCallback<ArrayBuffer | SharedArrayBuffer> = (
    controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>,
  ) => {
    this.controller = controller
  }
  transform: TransformerTransformCallback<Float32Array, ArrayBuffer | SharedArrayBuffer> = (
    chunk: Float32Array,
    controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>,
  ) => {
    this.encoder.encode(
      new AudioData({
        data: chunk,
        format: 'f32',
        numberOfChannels: this.channelCount,
        sampleRate: this.sampleRate,
        numberOfFrames: chunk.length / this.channelCount,
        timestamp: this.timestampMicroseconds,
      }),
    )
    this.timestampMicroseconds += (chunk.length / this.channelCount) * this.sampleRate * 1_000
  }
  /**
     *     flush?: TransformerFlushCallback<O>;
    readableType?: undefined;
    start?: TransformerStartCallback<O>;
    transform?: TransformerTransformCallback<I, O>;
    writableType?: undefined;
     */
}
