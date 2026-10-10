import * as ort from 'onnxruntime-web'
import { SILERO_VAD_FRAME_SAMPLES, SILERO_VAD_SAMPLE_RATE } from './GraniteCtc'

/**
 * Silero VAD v5 (quantized ONNX from onnx-community/silero-vad), driven one
 * 512-sample frame at a time. The recurrent state is local to each
 * `computeProbabilities` call so every selected interval starts from a clean
 * state, matching standalone detection over that audio.
 */
export class SileroVad {
  private constructor(private readonly session: ort.InferenceSession) {}

  static async create(modelBytes: Uint8Array<ArrayBuffer>): Promise<SileroVad> {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    return new SileroVad(session)
  }

  async computeProbabilities(
    audio: Float32Array,
    continueWhile: () => void = () => undefined,
    onProgress: (progress: number) => void = () => undefined,
  ): Promise<Float32Array> {
    const totalFrames = Math.ceil(audio.length / SILERO_VAD_FRAME_SAMPLES)
    const probabilities = new Float32Array(totalFrames)
    if (totalFrames === 0) {
      return probabilities
    }
    const progressInterval = Math.max(1, Math.ceil(totalFrames / 50))

    const frame = new Float32Array(SILERO_VAD_FRAME_SAMPLES)
    const input = new ort.Tensor('float32', frame, [1, SILERO_VAD_FRAME_SAMPLES])
    const sampleRate = new ort.Tensor('int64', new BigInt64Array([BigInt(SILERO_VAD_SAMPLE_RATE)]), [1])
    let state: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128])

    try {
      for (let frameIndex = 0; frameIndex < totalFrames; ++frameIndex) {
        if (frameIndex % 16 === 0) {
          continueWhile()
        }
        const offset = frameIndex * SILERO_VAD_FRAME_SAMPLES
        frame.fill(0)
        frame.set(audio.subarray(offset, Math.min(audio.length, offset + SILERO_VAD_FRAME_SAMPLES)))
        const outputs = await this.session.run({ input, state, sr: sampleRate })
        probabilities[frameIndex] = Number(outputs.output.data[0])
        const nextState = outputs.stateN
        outputs.output.dispose()
        state.dispose()
        state = nextState
        if (frameIndex % progressInterval === 0 || frameIndex === totalFrames - 1) {
          onProgress((frameIndex + 1) / totalFrames)
        }
      }
    } finally {
      state.dispose()
    }
    return probabilities
  }
}
