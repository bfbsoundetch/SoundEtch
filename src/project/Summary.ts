import { FileSystemSyncAccessHandle } from 'filesystem/FileSystemSyncAccessHandle'

export class Summary {
  static SAMPLES_PER_SUMMARY = 256

  private summaryValues: Int16Array[]
  private samplesRepresented = new Uint32Array(new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT))
  private readonly id: string
  private syncFileHandle: FileSystemSyncAccessHandle | null = null
  private writeFailed = false
  private readonly tmp = new Map<number, number>()

  getWorkerMessageListener() {
    return (message: MessageEvent) => {
      if (message.data.id == this.id && message.data.type == 'summaryValues') {
        this.summaryValues.push(message.data.summaryValues)
      }
    }
  }

  constructor(
    private channelCount: number,
    private chunkSize = 32 * 1024 * channelCount,
  ) {
    this.id = `${Date.now()}`
    this.summaryValues = new Array<Int16Array>()
  }

  /**
   * [max, min] per channel for each bin [binEdges[i], binEdges[i + 1]). A bucket counts toward the bin holding its
   * middle sample, so neighboring bins don't share peaks; a bin holding no bucket middle takes the bucket its first
   * sample is in. Stops at the first bin past the represented samples or whose buckets haven't reached this thread.
   */
  getSummaryOfBins(binEdges: readonly number[]): Array<Array<number>> {
    const end = this.samplesRepresented[0]
    const lastRepresentedBucket = Math.floor((end - 1) / Summary.SAMPLES_PER_SUMMARY)
    const halfBucket = Summary.SAMPLES_PER_SUMMARY / 2
    const result = Array.from({ length: this.channelCount }, () => new Array<number>())
    for (let bin = 0; bin + 1 < binEdges.length && binEdges[bin] < end; ++bin) {
      let firstBucket = Math.ceil((binEdges[bin] - halfBucket) / Summary.SAMPLES_PER_SUMMARY)
      let lastBucket = Math.min(
        Math.ceil((binEdges[bin + 1] - halfBucket) / Summary.SAMPLES_PER_SUMMARY) - 1,
        lastRepresentedBucket,
      )
      if (lastBucket < firstBucket) {
        firstBucket = lastBucket = Math.floor(binEdges[bin] / Summary.SAMPLES_PER_SUMMARY)
      }
      if (!this.summaryValues[this.getChunkIndex(lastBucket * Summary.SAMPLES_PER_SUMMARY)]) break
      for (let channel = 0; channel < this.channelCount; ++channel) {
        let max = -(2 ** 15)
        let min = 2 ** 15 - 1
        for (let bucket = firstBucket; bucket <= lastBucket; ++bucket) {
          const sample = bucket * Summary.SAMPLES_PER_SUMMARY
          const values = this.summaryValues[this.getChunkIndex(sample)]
          const position = this.getChunkPosition(sample) + 2 * channel
          if (values[position] > max) max = values[position]
          if (values[position + 1] < min) min = values[position + 1]
        }
        result[channel].push(this.int16ToFloat(max), this.int16ToFloat(min))
      }
    }
    return result
  }

  /**
   * Channel-averaged power estimate from waveform peaks, weighted by covered samples.
   * NaN means the represented audio's summary buckets have not arrived yet, not silence.
   */
  getMeanSquaredPeak(startSample: number, endSample: number): number {
    const start = Math.max(0, startSample)
    const end = Math.min(this.samplesRepresented[0], endSample)
    if (end <= start) return 0
    let energy = 0
    for (
      let sample = Math.floor(start / Summary.SAMPLES_PER_SUMMARY) * Summary.SAMPLES_PER_SUMMARY;
      sample < end;
      sample += Summary.SAMPLES_PER_SUMMARY
    ) {
      const values = this.summaryValues[this.getChunkIndex(sample)]
      if (!values) return NaN
      const position = this.getChunkPosition(sample)
      const weight = Math.min(end, sample + Summary.SAMPLES_PER_SUMMARY) - Math.max(start, sample)
      for (let channel = 0; channel < this.channelCount; ++channel) {
        const peak = Math.max(
          Math.abs(this.int16ToFloat(values[position + channel * 2])),
          Math.abs(this.int16ToFloat(values[position + channel * 2 + 1])),
        )
        energy += peak * peak * weight
      }
    }
    return energy / ((end - start) * this.channelCount)
  }

  summarizeInterleavedData(data: Float32Array, length: number) {
    if (length % this.channelCount != 0) {
      throw new Error(`Input array length ${length} is not a multiple of ${this.channelCount} channel count`)
    }
    this.summarizeDataInternal(data.subarray(0, length), length / this.channelCount)
  }

  summarizeSeparateChannelData(data: Float32Array[], length: number) {
    this.summarizeDataInternal(this.interleaveGenerator(data, length), length)
  }

  getNumberOfSamplesRepresented(): number {
    return this.samplesRepresented[0]
  }

  setSyncFileHandle(syncFileHandle: FileSystemSyncAccessHandle) {
    this.syncFileHandle = syncFileHandle
  }

  private *interleaveGenerator(data: Float32Array[], length: number) {
    for (let i = 0; i < length; ++i) {
      for (let channel = 0; channel < data.length; ++channel) {
        yield data[channel][i]
      }
    }
  }

  private int16ToFloat(int16: number): number {
    return int16 > 0 ? int16 / (2 ** 15 - 1.0) : int16 / 2.0 ** 15
  }

  private summarizeDataInternal(numberIterable: Iterable<number>, length: number) {
    let samplesRepresented = this.samplesRepresented[0]
    let chunkIndex = this.getChunkIndex(samplesRepresented)
    let chunkPosition = this.getChunkPosition(samplesRepresented)
    let channel = 0
    let failed = false
    let failure: unknown
    if (length > 0 && !this.summaryValues[chunkIndex]) {
      this.addNewChunk()
    }
    if (length > 0 && samplesRepresented % Summary.SAMPLES_PER_SUMMARY === 0) {
      for (let c = 0; c < this.channelCount; ++c) {
        this.summaryValues[chunkIndex][chunkPosition + c * 2] = -(2 ** 15)
        this.summaryValues[chunkIndex][chunkPosition + c * 2 + 1] = 2 ** 15 - 1
      }
    }
    for (const nextValue of numberIterable) {
      const int16Value = Summary.toInt16(nextValue)

      this.summaryValues[chunkIndex][chunkPosition + channel * 2] = Math.max(
        int16Value,
        this.summaryValues[chunkIndex][chunkPosition + channel * 2],
      )
      this.summaryValues[chunkIndex][chunkPosition + channel * 2 + 1] = Math.min(
        int16Value,
        this.summaryValues[chunkIndex][chunkPosition + channel * 2 + 1],
      )
      channel = (channel + 1) % this.channelCount
      if (channel == 0) {
        ++samplesRepresented
      }
      if (samplesRepresented % Summary.SAMPLES_PER_SUMMARY == 0 && samplesRepresented > 0 && channel == 0) {
        if (!failed && !this.writeFailed) {
          try {
            this.writeValueToDisk(chunkPosition, chunkIndex)
          } catch (error) {
            this.writeFailed = true
            failed = true
            failure = error
          }
        }
        chunkPosition += 2 * this.channelCount
        if (chunkPosition >= this.chunkSize) {
          this.addNewChunk()
          chunkPosition = 0
          ++chunkIndex
        }
        for (let c = 0; c < this.channelCount; ++c) {
          this.summaryValues[chunkIndex][chunkPosition + c * 2] = -(2 ** 15)
          this.summaryValues[chunkIndex][chunkPosition + c * 2 + 1] = 2 ** 15 - 1
        }
      }
    }
    this.samplesRepresented[0] = samplesRepresented
    try {
      this.syncFileHandle?.flush()
    } catch (error) {
      this.writeFailed = true
      if (!failed) {
        failed = true
        failure = error
      }
    }
    if (failed) throw failure
  }

  private writeValueToDisk(chunkPosition: number, chunkIndex: number) {
    if (!this.syncFileHandle) {
      return
    }
    const values = this.summaryValues[chunkIndex].subarray(chunkPosition, chunkPosition + 2 * this.channelCount)
    this.writeBytesToDisk(values, (chunkIndex * this.chunkSize + chunkPosition) * Int16Array.BYTES_PER_ELEMENT)
  }

  private writeBytesToDisk(values: Int16Array, position: number) {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    let written = 0
    while (written < bytes.byteLength) {
      const byteCount = this.syncFileHandle!.write(bytes.subarray(written), { at: position + written })
      if (byteCount <= 0) throw new Error('Summary file write made no progress')
      written += byteCount
    }
  }

  /**
   * Replaces whole buckets from `firstBucket` on with `values` ([max, min] per channel per bucket), in memory where
   * the chunks reach that far (a recording shares them with the main thread) and in the summary file.
   */
  overwriteBuckets(firstBucket: number, values: Int16Array) {
    const valuesPerBucket = 2 * this.channelCount
    if (values.length % valuesPerBucket !== 0) {
      throw new Error(`${values.length} summary values are not whole buckets of ${this.channelCount} channels`)
    }
    const bucketCount = values.length / valuesPerBucket
    if (bucketCount === 0) return
    const lastChunk = Math.floor(((firstBucket + bucketCount - 1) * valuesPerBucket) / this.chunkSize)
    if (lastChunk < this.summaryValues.length) {
      for (let bucket = 0; bucket < bucketCount; ++bucket) {
        const index = (firstBucket + bucket) * valuesPerBucket
        this.summaryValues[Math.floor(index / this.chunkSize)].set(
          values.subarray(bucket * valuesPerBucket, (bucket + 1) * valuesPerBucket),
          index % this.chunkSize,
        )
      }
    }
    if (this.syncFileHandle) {
      this.writeBytesToDisk(values, firstBucket * valuesPerBucket * Int16Array.BYTES_PER_ELEMENT)
      this.syncFileHandle.flush()
    }
  }

  static toInt16(value: number): number {
    return value > 1.0
      ? 2 ** 15 - 1
      : value < -1.0
        ? -(2 ** 15)
        : Math.round(value > 0 ? value * (2 ** 15 - 1) : value * 2 ** 15)
  }

  /** [max, min] per channel per bucket of interleaved `samples`, which start on a bucket boundary. */
  static computeBuckets(samples: Float32Array, channelCount: number): Int16Array {
    const frameCount = Math.floor(samples.length / channelCount)
    const valuesPerBucket = 2 * channelCount
    const result = new Int16Array(Math.ceil(frameCount / Summary.SAMPLES_PER_SUMMARY) * valuesPerBucket)
    for (let index = 0; index < result.length; index += 2) {
      result[index] = -(2 ** 15)
      result[index + 1] = 2 ** 15 - 1
    }
    for (let frame = 0; frame < frameCount; ++frame) {
      const bucketStart = Math.floor(frame / Summary.SAMPLES_PER_SUMMARY) * valuesPerBucket
      for (let channel = 0; channel < channelCount; ++channel) {
        const value = Summary.toInt16(samples[frame * channelCount + channel])
        const position = bucketStart + 2 * channel
        if (value > result[position]) result[position] = value
        if (value < result[position + 1]) result[position + 1] = value
      }
    }
    return result
  }

  private addNewChunk() {
    const newValueArray = new Int16Array(new SharedArrayBuffer(Int16Array.BYTES_PER_ELEMENT * this.chunkSize))
    for (let c = 0; c < this.channelCount; ++c) {
      newValueArray[2 * c] = -(2 ** 15)
      newValueArray[2 * c + 1] = 2 ** 15 - 1
    }
    this.summaryValues.push(newValueArray)
    if (typeof (globalThis as any).importScripts === 'function') {
      postMessage({
        id: this.id,
        type: 'summaryValues',
        summaryValues: newValueArray,
      })
    }
  }

  async populateFromFile(summaryFile: File, mainFile: File, channelCount: number) {
    const arrayBuffer = await summaryFile.arrayBuffer()
    this.channelCount = channelCount
    const frameBytes = Float32Array.BYTES_PER_ELEMENT * channelCount
    const frameCount = Math.floor(mainFile.size / frameBytes)
    const valuesPerBucket = 2 * channelCount
    const requiredValues = Math.ceil(frameCount / Summary.SAMPLES_PER_SUMMARY) * valuesPerBucket
    const savedBuckets = Math.floor(arrayBuffer.byteLength / (Int16Array.BYTES_PER_ELEMENT * valuesPerBucket))
    const savedValues = new Int16Array(arrayBuffer, 0, Math.min(savedBuckets * valuesPerBucket, requiredValues))
    if (savedValues.length === requiredValues) {
      this.summaryValues = [savedValues]
      this.chunkSize = Math.max(savedValues.length, valuesPerBucket)
      this.samplesRepresented[0] = frameCount
      return
    }

    // A quota failure may preserve more PCM than summary data. Recover only the missing tail in memory.
    this.chunkSize = Math.max(32 * 1024 * channelCount, savedValues.length)
    const values = new Int16Array(new SharedArrayBuffer(this.chunkSize * Int16Array.BYTES_PER_ELEMENT))
    values.set(savedValues)
    this.summaryValues = [values]
    this.samplesRepresented[0] = savedBuckets * Summary.SAMPLES_PER_SUMMARY
    for (let frame = this.samplesRepresented[0]; frame < frameCount; frame += 8192) {
      const end = Math.min(frame + 8192, frameCount)
      const data = new Float32Array(await mainFile.slice(frame * frameBytes, end * frameBytes).arrayBuffer())
      this.summarizeInterleavedData(data, data.length)
    }
  }

  finishSummarizing() {
    const handle = this.syncFileHandle
    let failed = false
    let failure: unknown
    try {
      if (!this.writeFailed && this.samplesRepresented[0] % Summary.SAMPLES_PER_SUMMARY !== 0) {
        this.writeValueToDisk(
          this.getChunkPosition(this.samplesRepresented[0]),
          this.getChunkIndex(this.samplesRepresented[0]),
        )
      }
      handle?.flush()
    } catch (error) {
      failed = true
      failure = error
    } finally {
      this.syncFileHandle = null
      try {
        handle?.close()
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
    if (failed) throw failure
  }

  get length(): number {
    return this.samplesRepresented[0]
  }

  set length(length: number) {
    this.samplesRepresented[0] = length
  }

  private getChunkIndex(sample: number): number {
    return Math.floor((2 * this.channelCount * Math.floor(sample / Summary.SAMPLES_PER_SUMMARY)) / this.chunkSize)
  }

  private getChunkPosition(sample: number): number {
    return (2 * this.channelCount * Math.floor(sample / Summary.SAMPLES_PER_SUMMARY)) % this.chunkSize
  }
}
