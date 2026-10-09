import FFT from 'fft.js'

export const GRANITE_SAMPLE_RATE = 16_000

const LOG_MEL_EPSILON = 1e-10
const AGC_TARGET = 0.12
const AGC_WINDOW_MS = 150
const AGC_MAX_GAIN = 20
const AGC_PEAK_LIMIT = 0.97
export const SILERO_VAD_SAMPLE_RATE = 16_000
export const SILERO_VAD_FRAME_SAMPLES = 512
const MAX_INFERENCE_SEGMENT_SAMPLES = 320_000
const SEGMENT_CUT_SEARCH_SAMPLES = 80_000

type NumericArray = ArrayLike<number | bigint>

export interface GraniteFrontendConfig {
  readonly sample_rate: number
  readonly n_fft: number
  readonly win_length: number
  readonly hop_length: number
  readonly n_mels: number
  readonly stack_factor: number
  readonly deltas: boolean
  readonly delta_win_length: number
  readonly logmel_floor_db: number
  readonly num_special_tokens: number
  readonly input_dim: number
  readonly blank_id: number
  readonly pad_multiple: number
  readonly subsample_factor: number
}

export interface GraniteFeatures {
  readonly data: Float32Array
  readonly frames: number
  readonly dimension: number
}

export interface GraniteModelInput extends GraniteFeatures {
  readonly paddingMask: Float32Array
  readonly realFrames: number
}

export interface CtcWordFrameSpan {
  readonly text: string
  readonly startFrame: number
  readonly endFrame: number
}
export interface GraniteTokenSpan {
  readonly id: number
  readonly startFrame: number
  readonly endFrame: number
}

export interface GraniteDecodedWord extends CtcWordFrameSpan {
  readonly firstToken: number
  readonly lastToken: number
}

export interface SelectedSourceSampleRange {
  readonly startSample: number
  readonly endSample: number
}

export interface GraniteSpeechSegment {
  readonly startSample: number
  readonly endSample: number
}

export interface GraniteSpeechSegmentation {
  readonly speechRegions: GraniteSpeechSegment[]
  readonly segments: GraniteSpeechSegment[]
}
interface MutableTokenSpan {
  readonly id: number
  readonly startFrame: number
  endFrame: number
}

export class GraniteCtcFrontend {
  private readonly fft: FFT
  private readonly fftInput: Float64Array
  private readonly fftOutput: number[]
  private readonly frequencyBins: number

  constructor(
    readonly config: GraniteFrontendConfig,
    private readonly melFilters: Float32Array,
    private readonly stftWindow: Float32Array,
  ) {
    validateFrontendConfig(config)
    this.frequencyBins = config.n_fft / 2 + 1
    if (melFilters.length !== config.n_mels * this.frequencyBins) {
      throw new Error(
        `Granite mel filter table has ${melFilters.length} values; expected ${config.n_mels * this.frequencyBins}`,
      )
    }
    if (stftWindow.length !== config.n_fft) {
      throw new Error(`Granite STFT window has ${stftWindow.length} values; expected ${config.n_fft}`)
    }
    this.fft = new FFT(config.n_fft)
    this.fftInput = new Float64Array(config.n_fft)
    this.fftOutput = this.fft.createComplexArray()
  }

  prepareInput(waveform: Float32Array): GraniteModelInput {
    const features = this.compute(applyGraniteAgc(waveform))
    if (features.frames === 0) {
      return {
        data: features.data,
        frames: 0,
        dimension: features.dimension,
        paddingMask: new Float32Array(0),
        realFrames: 0,
      }
    }

    const paddedFrames = Math.ceil(features.frames / this.config.pad_multiple) * this.config.pad_multiple
    const data = new Float32Array(paddedFrames * features.dimension)
    data.set(features.data)
    const paddingMask = new Float32Array(paddedFrames)
    paddingMask.fill(1, features.frames)
    return {
      data,
      frames: paddedFrames,
      dimension: features.dimension,
      paddingMask,
      realFrames: features.frames,
    }
  }

  compute(waveform: Float32Array): GraniteFeatures {
    const { hop_length: hop, n_fft: fftSize, n_mels: melCount, stack_factor: stack } = this.config
    const sourceMelFrames = Math.floor(waveform.length / hop)
    if (sourceMelFrames === 0) {
      return { data: new Float32Array(0), frames: 0, dimension: this.config.input_dim }
    }

    const melFrames = stack * Math.ceil(sourceMelFrames / stack)
    const effectiveWaveformLength = Math.max(waveform.length, (melFrames - 1) * hop + 1)
    const halfFft = fftSize >> 1
    const centeredWaveform = new Float32Array(effectiveWaveformLength + fftSize)
    centeredWaveform.set(waveform, halfFft)
    for (let index = 0; index < halfFft; ++index) {
      const leftSource = Math.min(index + 1, effectiveWaveformLength - 1)
      const rightSource = Math.max(effectiveWaveformLength - 2 - index, 0)
      centeredWaveform[halfFft - 1 - index] = leftSource < waveform.length ? waveform[leftSource] : 0
      centeredWaveform[halfFft + effectiveWaveformLength + index] =
        rightSource < waveform.length ? waveform[rightSource] : 0
    }

    const channelCount = this.config.deltas ? melCount * 2 : melCount
    const channels = new Float32Array(channelCount * melFrames)
    const power = new Float64Array(this.frequencyBins)
    for (let frame = 0; frame < melFrames; ++frame) {
      const frameOffset = frame * hop
      for (let index = 0; index < fftSize; ++index) {
        this.fftInput[index] = centeredWaveform[frameOffset + index] * this.stftWindow[index]
      }
      this.fft.realTransform(this.fftOutput, this.fftInput)
      for (let frequency = 0; frequency < this.frequencyBins; ++frequency) {
        const real = this.fftOutput[frequency * 2]
        const imaginary = this.fftOutput[frequency * 2 + 1]
        power[frequency] = real * real + imaginary * imaginary
      }
      for (let mel = 0; mel < melCount; ++mel) {
        const filterOffset = mel * this.frequencyBins
        let energy = 0
        for (let frequency = 0; frequency < this.frequencyBins; ++frequency) {
          energy += this.melFilters[filterOffset + frequency] * power[frequency]
        }
        channels[mel * melFrames + frame] = energy
      }
    }

    let maximumLogEnergy = -Infinity
    const baseChannelLength = melCount * melFrames
    for (let index = 0; index < baseChannelLength; ++index) {
      const logEnergy = Math.log10(Math.max(channels[index], LOG_MEL_EPSILON))
      channels[index] = logEnergy
      maximumLogEnergy = Math.max(maximumLogEnergy, logEnergy)
    }
    const logFloor = maximumLogEnergy - this.config.logmel_floor_db
    for (let index = 0; index < baseChannelLength; ++index) {
      channels[index] = Math.max(channels[index], logFloor) / 4 + 1
    }

    if (this.config.deltas) {
      for (let mel = 0; mel < melCount; ++mel) {
        const sourceOffset = mel * melFrames
        const destinationOffset = (melCount + mel) * melFrames
        for (let frame = 0; frame < melFrames; ++frame) {
          const previous = channels[sourceOffset + Math.max(0, frame - 1)]
          const next = channels[sourceOffset + Math.min(melFrames - 1, frame + 1)]
          channels[destinationOffset + frame] = (next - previous) / 2
        }
      }
    }

    const outputFrames = melFrames / stack
    const dimension = channelCount * stack
    const data = new Float32Array(outputFrames * dimension)
    for (let outputFrame = 0; outputFrame < outputFrames; ++outputFrame) {
      for (let stackIndex = 0; stackIndex < stack; ++stackIndex) {
        const sourceFrame = outputFrame * stack + stackIndex
        const destinationOffset = outputFrame * dimension + stackIndex * channelCount
        for (let channel = 0; channel < channelCount; ++channel) {
          data[destinationOffset + channel] = channels[channel * melFrames + sourceFrame]
        }
      }
    }
    return { data, frames: outputFrames, dimension }
  }
}

export class GraniteCtcDecoder {
  private readonly encodedPieces: Uint8Array[]
  private readonly textDecoder = new TextDecoder('utf-8')
  private readonly wordInitialIds = new Map<string, number>()

  constructor(
    vocabulary: readonly string[],
    private readonly blankId: number,
    private readonly numSpecialTokens: number,
  ) {
    const codepointToByte = createByteLevelReverseMap()
    this.encodedPieces = vocabulary.map((piece) => {
      const bytes = new Uint8Array(piece.length)
      let byteCount = 0
      for (const character of piece) {
        const byte = codepointToByte.get(character.codePointAt(0)!)
        if (byte !== undefined) {
          bytes[byteCount++] = byte
        }
      }
      return bytes.subarray(0, byteCount)
    })
    this.encodedPieces.forEach((bytes, index) => {
      if (bytes.length > 1 && bytes[0] === 0x20) {
        this.wordInitialIds.set(this.textDecoder.decode(bytes.subarray(1)), index + numSpecialTokens)
      }
    })
  }

  /** Ids of the word-initial vocabulary pieces that spell a prefix of `text`, including the whole word. */
  wordPrefixTokenIds(text: string): number[] {
    const ids = new Array<number>()
    for (let length = 1; length <= text.length; ++length) {
      const id = this.wordInitialIds.get(text.slice(0, length))
      if (id !== undefined) {
        ids.push(id)
      }
    }
    return ids
  }

  decodeTokenSpans(rawIds: NumericArray): GraniteTokenSpan[] {
    const tokenSpans = new Array<MutableTokenSpan>()
    let previousId = -1
    let previousToken: MutableTokenSpan | null = null
    for (let frame = 0; frame < rawIds.length; ++frame) {
      const id = Number(rawIds[frame])
      if (id === previousId) {
        if (previousToken && id === previousToken.id) {
          previousToken.endFrame = frame + 1
        }
      } else if (id !== this.blankId && id >= this.numSpecialTokens) {
        previousToken = { id, startFrame: frame, endFrame: frame + 1 }
        tokenSpans.push(previousToken)
      } else {
        previousToken = null
      }
      previousId = id
    }
    return tokenSpans
  }

  groupWords(tokenSpans: readonly GraniteTokenSpan[]): GraniteDecodedWord[] {
    const words = new Array<GraniteDecodedWord>()
    const wordBytes = new Array<number>()
    let wordStartFrame = -1
    let wordEndFrame = -1
    let firstToken = -1
    let lastToken = -1
    const flushWord = () => {
      if (wordBytes.length === 0) {
        return
      }
      const text = this.textDecoder.decode(Uint8Array.from(wordBytes))
      if (text.length > 0) {
        words.push({
          text,
          startFrame: wordStartFrame,
          endFrame: wordEndFrame,
          firstToken,
          lastToken,
        })
      }
      wordBytes.length = 0
      wordStartFrame = -1
      wordEndFrame = -1
      firstToken = -1
      lastToken = -1
    }

    for (let tokenIndex = 0; tokenIndex < tokenSpans.length; ++tokenIndex) {
      const token = tokenSpans[tokenIndex]
      const piece = this.encodedPieces[token.id - this.numSpecialTokens]
      if (!piece) {
        continue
      }
      for (const byte of piece) {
        if (isAsciiWhitespace(byte)) {
          flushWord()
          continue
        }
        if (wordBytes.length === 0) {
          wordStartFrame = token.startFrame
          firstToken = tokenIndex
        }
        wordBytes.push(byte)
        wordEndFrame = token.endFrame
        lastToken = tokenIndex
      }
    }
    flushWord()
    return words
  }

  decodeWords(rawIds: NumericArray): CtcWordFrameSpan[] {
    return this.groupWords(this.decodeTokenSpans(rawIds)).map(({ text, startFrame, endFrame }) => ({
      text,
      startFrame,
      endFrame,
    }))
  }
}

export function parseGraniteFrontendConfig(bytes: Uint8Array): GraniteFrontendConfig {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Granite frontend_config.json is not an object')
  }
  const config = parsed as GraniteFrontendConfig
  validateFrontendConfig(config)
  return config
}

export function parseGraniteVocabulary(bytes: Uint8Array): string[] {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!Array.isArray(parsed) || !parsed.every((piece) => typeof piece === 'string')) {
    throw new Error('Granite vocab.json is not an array of strings')
  }
  return parsed
}

export function createFloat32AssetView(bytes: Uint8Array, assetName: string): Float32Array {
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`${assetName} does not contain complete Float32 values`)
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT)
}

export function applyGraniteAgc(waveform: Float32Array): Float32Array {
  if (waveform.length === 0) {
    return waveform
  }
  const windowLength = Math.max(1, Math.round((GRANITE_SAMPLE_RATE * AGC_WINDOW_MS) / 1000))
  const squared = new Float32Array(waveform.length)
  for (let index = 0; index < waveform.length; ++index) {
    squared[index] = waveform[index] * waveform[index]
  }
  const meanSquares = centeredMovingAverage(squared, windowLength)
  const gains = new Float32Array(waveform.length)
  for (let index = 0; index < waveform.length; ++index) {
    const envelope = Math.sqrt(meanSquares[index] + 1e-9)
    gains[index] = Math.min(AGC_MAX_GAIN, AGC_TARGET / Math.max(envelope, 1e-4))
  }
  const smoothedGains = centeredMovingAverage(gains, windowLength)
  const output = new Float32Array(waveform.length)
  let peak = 0
  for (let index = 0; index < waveform.length; ++index) {
    output[index] = waveform[index] * smoothedGains[index]
    peak = Math.max(peak, Math.abs(output[index]))
  }
  if (peak > AGC_PEAK_LIMIT) {
    const scale = AGC_PEAK_LIMIT / peak
    for (let index = 0; index < output.length; ++index) {
      output[index] *= scale
    }
  }
  return output
}

export function graniteRealOutputFrames(realInputFrames: number): number {
  return Math.floor(Math.floor(realInputFrames / 2) / 2)
}

export interface VadSegmentationSettings {
  readonly positiveThreshold: number
  readonly negativeThreshold: number
  readonly redemptionMs: number
  readonly minSpeechMs: number
  readonly preSpeechMs: number
  readonly postSpeechMs: number
}

/**
 * Silero hysteresis in the configuration the reference browser demo ships as
 * its "balanced" preset. Pre/post speech padding is applied to the detected
 * bounds so onset and offset audio reaches the model; padding never extends
 * past the interval bounds.
 */
export const GRANITE_VAD_SEGMENTATION_SETTINGS: VadSegmentationSettings = {
  positiveThreshold: 0.5,
  negativeThreshold: 0.35,
  redemptionMs: 600,
  minSpeechMs: 250,
  preSpeechMs: 750,
  postSpeechMs: 300,
}

export function segmentSpeechFromVadProbabilities(
  probabilities: ArrayLike<number>,
  audioSampleCount: number,
  settings: VadSegmentationSettings = GRANITE_VAD_SEGMENTATION_SETTINGS,
): GraniteSpeechSegmentation {
  if (audioSampleCount <= 0) {
    return { speechRegions: [], segments: [] }
  }

  const frameMs = (SILERO_VAD_FRAME_SAMPLES / SILERO_VAD_SAMPLE_RATE) * 1_000
  const redemptionFrameLimit = Math.ceil(settings.redemptionMs / frameMs)
  const minSpeechFrames = Math.ceil(settings.minSpeechMs / frameMs)
  const preSpeechSamples = Math.round((settings.preSpeechMs / 1_000) * SILERO_VAD_SAMPLE_RATE)
  const postSpeechSamples = Math.round((settings.postSpeechMs / 1_000) * SILERO_VAD_SAMPLE_RATE)
  const totalFrames = Math.min(probabilities.length, Math.ceil(audioSampleCount / SILERO_VAD_FRAME_SAMPLES))

  const speechRegions = new Array<GraniteSpeechSegment>()
  let speaking = false
  let speechStart = 0
  let speechFrames = 0
  let redemptionFrames = 0

  for (let frameIndex = 0; frameIndex < totalFrames; ++frameIndex) {
    const offset = frameIndex * SILERO_VAD_FRAME_SAMPLES
    const probability = probabilities[frameIndex]

    if (probability >= settings.positiveThreshold) {
      if (!speaking) {
        speaking = true
        speechStart = offset
        speechFrames = 0
      }
      speechFrames += 1
      redemptionFrames = 0
    } else if (speaking && probability < settings.negativeThreshold) {
      redemptionFrames += 1
      if (redemptionFrames >= redemptionFrameLimit) {
        const silenceStartSample = offset - (redemptionFrames - 1) * SILERO_VAD_FRAME_SAMPLES
        if (speechFrames >= minSpeechFrames) {
          speechRegions.push({ startSample: speechStart, endSample: silenceStartSample })
        }
        speaking = false
        speechFrames = 0
        redemptionFrames = 0
      }
    }
  }

  if (speaking && speechFrames >= minSpeechFrames) {
    speechRegions.push({ startSample: speechStart, endSample: audioSampleCount })
  }

  const segments = new Array<GraniteSpeechSegment>()
  if (speechRegions.length === 0) {
    appendCappedSegment(segments, 0, audioSampleCount, probabilities, totalFrames, settings.negativeThreshold)
    return { speechRegions, segments }
  }

  const merged: Array<{ startSample: number; endSample: number }> = []
  for (const region of speechRegions) {
    const startSample = Math.max(0, region.startSample - preSpeechSamples)
    const endSample = Math.min(audioSampleCount, region.endSample + postSpeechSamples)
    const previous = merged[merged.length - 1]
    if (previous && startSample <= previous.endSample) {
      previous.endSample = Math.max(previous.endSample, endSample)
    } else {
      merged.push({ startSample, endSample })
    }
  }
  for (const segment of merged) {
    appendCappedSegment(
      segments,
      segment.startSample,
      segment.endSample,
      probabilities,
      totalFrames,
      settings.negativeThreshold,
    )
  }
  return { speechRegions, segments }
}

/**
 * Splits a speech segment into inference segments of at most 20 s. Granite
 * transcribes a word cut by a segment boundary, often with its neighbours, in
 * both segments, so each cut falls within the last 5 s before the cap: in the
 * middle of the longest run of frames below the negative threshold (the latest
 * on ties) or, in speech without such a pause, in the frame with the lowest
 * speech probability. Without probabilities the cut falls at the cap.
 */
function appendCappedSegment(
  segments: GraniteSpeechSegment[],
  startSample: number,
  endSample: number,
  probabilities: ArrayLike<number>,
  frameCount: number,
  negativeThreshold: number,
): void {
  let chunkStart = startSample
  while (endSample - chunkStart > MAX_INFERENCE_SEGMENT_SAMPLES) {
    const capSample = chunkStart + MAX_INFERENCE_SEGMENT_SAMPLES
    const firstFrame = Math.ceil((capSample - SEGMENT_CUT_SEARCH_SAMPLES) / SILERO_VAD_FRAME_SAMPLES)
    const endFrame = Math.min(frameCount, Math.floor(capSample / SILERO_VAD_FRAME_SAMPLES))
    let cutSample = capSample
    let longestPauseFrames = 0
    let quietestFrame = -1
    for (let frame = firstFrame, pauseStart = firstFrame; frame < endFrame; ++frame) {
      if (probabilities[frame] >= negativeThreshold) {
        pauseStart = frame + 1
      } else if (frame + 1 - pauseStart >= longestPauseFrames) {
        longestPauseFrames = frame + 1 - pauseStart
        cutSample = (pauseStart + frame + 1) * (SILERO_VAD_FRAME_SAMPLES / 2)
      }
      if (quietestFrame < 0 || probabilities[frame] <= probabilities[quietestFrame]) {
        quietestFrame = frame
      }
    }
    if (longestPauseFrames === 0 && quietestFrame >= 0) {
      cutSample = quietestFrame * SILERO_VAD_FRAME_SAMPLES + SILERO_VAD_FRAME_SAMPLES / 2
    }
    segments.push({ startSample: chunkStart, endSample: cutSample })
    chunkStart = cutSample
  }
  if (chunkStart < endSample) {
    segments.push({ startSample: chunkStart, endSample })
  }
}

function validateFrontendConfig(config: GraniteFrontendConfig): void {
  const expected: Record<keyof GraniteFrontendConfig, number | boolean> = {
    sample_rate: 16_000,
    n_fft: 512,
    win_length: 400,
    hop_length: 160,
    n_mels: 80,
    stack_factor: 2,
    deltas: true,
    delta_win_length: 3,
    logmel_floor_db: 8,
    num_special_tokens: 1,
    input_dim: 320,
    blank_id: 0,
    pad_multiple: 512,
    subsample_factor: 4,
  }
  for (const key of Object.keys(expected) as Array<keyof GraniteFrontendConfig>) {
    if (config[key] !== expected[key]) {
      throw new Error(`Unsupported Granite frontend setting ${key}: ${String(config[key])}`)
    }
  }
}

function centeredMovingAverage(values: Float32Array, requestedWindowLength: number): Float32Array {
  if (values.length <= 1 || requestedWindowLength <= 1) {
    return values
  }
  const windowLength = Math.min(values.length, requestedWindowLength)
  const cumulative = new Float64Array(values.length + 1)
  for (let index = 0; index < values.length; ++index) {
    cumulative[index + 1] = cumulative[index] + values[index]
  }
  const validLength = values.length - windowLength + 1
  const leftPadding = (windowLength - 1) >> 1
  const firstAverage = cumulative[windowLength] / windowLength
  const lastAverage = (cumulative[values.length] - cumulative[values.length - windowLength]) / windowLength
  const output = new Float32Array(values.length)
  for (let index = 0; index < values.length; ++index) {
    const validIndex = index - leftPadding
    if (validIndex < 0) {
      output[index] = firstAverage
    } else if (validIndex >= validLength) {
      output[index] = lastAverage
    } else {
      output[index] = (cumulative[validIndex + windowLength] - cumulative[validIndex]) / windowLength
    }
  }
  return output
}

function createByteLevelReverseMap(): Map<number, number> {
  const printableBytes = new Array<number>()
  for (let byte = 0x21; byte <= 0x7e; ++byte) {
    printableBytes.push(byte)
  }
  for (let byte = 0xa1; byte <= 0xac; ++byte) {
    printableBytes.push(byte)
  }
  for (let byte = 0xae; byte <= 0xff; ++byte) {
    printableBytes.push(byte)
  }
  const bytes = printableBytes.slice()
  const codepoints = printableBytes.slice()
  const printableSet = new Set(printableBytes)
  let replacementOffset = 0
  for (let byte = 0; byte < 256; ++byte) {
    if (!printableSet.has(byte)) {
      bytes.push(byte)
      codepoints.push(256 + replacementOffset++)
    }
  }
  return new Map(codepoints.map((codepoint, index) => [codepoint, bytes[index]]))
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d)
}
