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

  getSummaryOfRange(startSample: number, endSample: number, skip: number): Array<Array<number>> {
    if (startSample < 0 || startSample > endSample) {
      throw new Error(
        `Bad input: start ${startSample} end ${endSample}, summarized samples ${this.samplesRepresented[0]}`,
      )
    }
    if (endSample > this.samplesRepresented[0]) {
      endSample = this.samplesRepresented[0]
    }
    const result = new Array<Array<number>>(this.channelCount)
    for (let i = 0; i < this.channelCount; ++i) {
      result[i] = new Array<number>(2 * Math.round((endSample - startSample) / skip))
    }

    for (let channel = 0; channel < this.channelCount; ++channel) {
      let resultIndex = 0
      for (let i = startSample; i < endSample; i += skip) {
        let chunkIndex = this.getChunkIndex(i)
        let chunkPosition = this.getChunkPosition(i) + 2 * channel
        let max = this.summaryValues[chunkIndex][chunkPosition]
        let min = this.summaryValues[chunkIndex][chunkPosition + 1]
        // How much should the summary buckets overlap for each output value?
        // This makes sure they don't overlap. It seems to be how Audacity
        // does it. Note that, while zooming, you can see where `skip`
        // becomes a new multiple of SAMPLE_PER_SUMMARY (same as Audacity).
        const maxIndex = skip / Summary.SAMPLES_PER_SUMMARY
        for (let j = 1; j < maxIndex; ++j) {
          chunkPosition += 2 * this.channelCount
          if (chunkPosition >= this.summaryValues[chunkIndex].length) {
            ++chunkIndex
            if (chunkIndex >= this.summaryValues.length) {
              break
            }
            chunkPosition = 2 * channel
          }
          max = Math.max(max, this.summaryValues[chunkIndex][chunkPosition])
          min = Math.min(min, this.summaryValues[chunkIndex][chunkPosition + 1])
        }
        result[channel][resultIndex] = this.int16ToFloat(max)
        result[channel][resultIndex + 1] = this.int16ToFloat(min)
        resultIndex += 2
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
      const int16Value =
        nextValue > 1.0
          ? 2 ** 15 - 1
          : nextValue < -1.0
            ? -(2 ** 15)
            : Math.round(nextValue > 0 ? nextValue * (2 ** 15 - 1) : nextValue * 2 ** 15)

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
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    const position = (chunkIndex * this.chunkSize + chunkPosition) * Int16Array.BYTES_PER_ELEMENT
    let written = 0
    while (written < bytes.byteLength) {
      const byteCount = this.syncFileHandle.write(bytes.subarray(written), { at: position + written })
      if (byteCount <= 0) throw new Error('Summary file write made no progress')
      written += byteCount
    }
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
