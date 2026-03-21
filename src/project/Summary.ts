import { FileSystemSyncAccessHandle } from 'filesystem/FileSystemSyncAccessHandle'

export class Summary {
  static SAMPLES_PER_SUMMARY = 256

  private summaryValues: Int16Array[]
  private samplesRepresented = new Uint32Array(new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT))
  private readonly id: string
  private syncFileHandle: FileSystemSyncAccessHandle | null = null
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
        for (let j = 1; j < skip / Summary.SAMPLES_PER_SUMMARY; ++j) {
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

  summarizeInterleavedData(data: Float32Array, length: number) {
    if (data.length % this.channelCount != 0) {
      throw new Error(`Input array length ${data.length} is not a multiple of ${this.channelCount} channel count`)
    }
    this.summarizeDataInternal(data.slice(0, length), length / this.channelCount)
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
    let chunkIndex = this.getChunkIndex(this.samplesRepresented[0])
    let chunkPosition = this.getChunkPosition(this.samplesRepresented[0])
    let channel = 0
    if (this.samplesRepresented[0] == 0) {
      this.addNewChunk()
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
        ++this.samplesRepresented[0]
      }
      if (
        this.samplesRepresented[0] % Summary.SAMPLES_PER_SUMMARY == 0 &&
        this.samplesRepresented[0] > 0 &&
        channel == 0
      ) {
        this.writeValueToDisk(chunkPosition, chunkIndex)
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
    this.syncFileHandle?.flush()
  }

  private writeValueToDisk(chunkPosition: number, chunkIndex: number) {
    if (!this.syncFileHandle) {
      return
    }
    const result = this.summaryValues[chunkIndex].slice(chunkPosition, chunkPosition + 2 * this.channelCount)
    this.syncFileHandle.write(result.buffer)
  }

  private addNewChunk() {
    const newValueArray = new Int16Array(new SharedArrayBuffer(Int16Array.BYTES_PER_ELEMENT * this.chunkSize))
    for (let c = 0; c < this.channelCount; ++c) {
      newValueArray[2 * c] = -(2 ** 15)
      newValueArray[2 * c + 1] = 2 ** 15 - 1
    }
    this.summaryValues.push(newValueArray)
    postMessage({
      id: this.id,
      type: 'summaryValues',
      summaryValues: newValueArray,
    })
  }

  async populateFromFile(summaryFile: File, mainFile: File, channelCount: number) {
    const arrayBuffer = await summaryFile.arrayBuffer()
    this.summaryValues = [new Int16Array(arrayBuffer)]
    this.chunkSize = this.summaryValues[0].length
    this.samplesRepresented[0] = mainFile.size / 4 / channelCount
    this.channelCount = channelCount
  }

  finishSummarizing() {
    this.writeValueToDisk(
      this.getChunkPosition(this.samplesRepresented[0]),
      this.getChunkIndex(this.samplesRepresented[0]),
    )
    this.syncFileHandle?.close()
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
