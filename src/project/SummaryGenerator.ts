import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Clip } from './Clip'
import { ProjectManager } from './ProjectManager'
import { Summary } from './Summary'

export class SummaryGenerator {
  private static readonly clipSummarizers = new Map<Clip, ClipSummarizer>()

  private constructor() {}

  static async summarizeClipChannel(
    clip: Clip,
    channel: number,
    startPosition: number,
    endPosition: number,
    skip: number,
  ): Promise<Array<Array<number>>> {
    let clipSummarizer = this.clipSummarizers.get(clip)
    if (!clipSummarizer) {
      clipSummarizer = new ClipSummarizer(clip)
      this.clipSummarizers.set(clip, clipSummarizer)
    }
    return await clipSummarizer.summarizeChannel(channel, startPosition, endPosition, skip)
  }
}

class ClipSummarizer {
  private fileLazy: File | null = null
  private fileCache: Float32Array | null = null
  private fileCacheStart = 0
  private fileCacheEnd = 0

  constructor(private readonly clip: Clip) {}

  private async getFile() {
    if (this.fileLazy) {
      return this.fileLazy
    }
    const dirName = (await ProjectManager.getActiveProject()).directoryName
    const fileHandle = await FileSystemUtils.getFileHandle(dirName, this.clip.filename)
    return fileHandle.getFile()
  }

  async summarizeChannel(
    channel: number,
    startPosition: number,
    endPosition: number,
    skip: number,
  ): Promise<Array<Array<number>>> {
    if (channel >= this.clip.getChannelCount()) {
      throw new Error('Channel out of range ' + channel)
    }
    if (startPosition < 0 || endPosition > this.clip.length) {
      throw new Error(
        `Range provided does not cover this ClipView : start ${startPosition} end ${endPosition} ${this.clip.length}`,
      )
    }

    return skip < Summary.SAMPLES_PER_SUMMARY
      ? this.getPcmSlice(startPosition, endPosition, skip)
      : (this.clip.summary?.getSummaryOfRange(startPosition, endPosition, skip) ?? [])
  }

  private async getPcmSlice(startPosition: number, endPosition: number, skip: number) {
    let data: Float32Array
    if (startPosition < this.fileCacheStart || endPosition > this.fileCacheEnd) {
      const diskReadSamples = Math.max(1_000_000, endPosition + 1 - startPosition)
      const twiceMidPoint = endPosition + startPosition + 1
      const startPoint = Math.max(Math.round((twiceMidPoint - diskReadSamples) / 2), 0)
      const endPoint = startPoint + diskReadSamples
      this.fileCache = new Float32Array(
        await (await this.getFile())
          .slice(this.samplePositionToFilePosition(startPoint), this.samplePositionToFilePosition(endPoint))
          .arrayBuffer(),
      )
      this.fileCacheStart = startPoint
      this.fileCacheEnd = endPoint
    }
    const sliceStart = (startPosition - this.fileCacheStart) * this.clip.getChannelCount()
    data = this.fileCache!.subarray(
      sliceStart,
      sliceStart + (endPosition - startPosition) * this.clip.getChannelCount(),
    )

    if (skip < 2) {
      const result = new Array<Array<number>>(this.clip.getChannelCount()).fill(
        new Array<number>((2 * data.length) / this.clip.getChannelCount()),
      )
      for (let i = 0; i < data.length; ++i) {
        result[i % this.clip.getChannelCount()][2 * Math.floor(i / this.clip.getChannelCount())] = Math.max(data[i], 0)
        result[i % this.clip.getChannelCount()][2 * Math.floor(i / this.clip.getChannelCount()) + 1] = Math.min(
          data[i],
          0,
        )
      }
      return result
    }

    const result = new Array<Array<number>>(this.clip.getChannelCount()).fill(
      new Array<number>(2 * Math.round(data.length / this.clip.getChannelCount() / skip)),
    )

    let max = new Array<number>(this.clip.getChannelCount()).fill(-1)
    let min = new Array<number>(this.clip.getChannelCount()).fill(1)
    let resultIndex = 0
    for (let i = 0; i < data.length; ++i) {
      const channel = i % this.clip.getChannelCount()
      if (i >= skip * this.clip.getChannelCount() * (resultIndex / 2 + 1)) {
        for (let c = 0; c < this.clip.getChannelCount(); ++c) {
          result[c][resultIndex] = max[c]
          result[c][resultIndex + 1] = min[c]
        }
        max.fill(-1)
        min.fill(1)
        resultIndex += 2
      }
      if (data[i] < min[channel]) {
        min[channel] = data[i]
      }
      if (data[i] > max[channel]) {
        max[channel] = data[i]
      }
    }
    for (let channel = 0; channel < this.clip.getChannelCount(); ++channel) {
      if (max[channel] != -1 || min[channel] != 1) {
        result[channel][resultIndex] = max[channel]
        result[channel][resultIndex + 1] = min[channel]
      }
    }
    return result
  }

  private samplePositionToFilePosition(samplePosition: number) {
    return this.clip.getChannelCount() * samplePosition * Float32Array.BYTES_PER_ELEMENT
  }
}
