import { AudioControl, isRecordingState } from '../audiocontext/AudioControl'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Clip } from './Clip'
import { ProjectManager } from './ProjectManager'
import { Summary } from './Summary'

export class SummaryGenerator {
  private static readonly clipSummarizers = new Map<Clip, ClipSummarizer>()

  private constructor() {}

  /**
   * [max, min] per channel for each bin [binEdges[i], binEdges[i + 1]) of the clip's source samples, through the last
   * bin with summarized audio. Bins narrower than a summary bucket (`samplesPerBin`) read the raw samples.
   */
  static async summarizeClipChannel(
    clip: Clip,
    binEdges: readonly number[],
    samplesPerBin: number,
  ): Promise<Array<Array<number>>> {
    const length = clip.summary.length
    let binCount = binEdges.length - 1
    while (binCount > 0 && binEdges[binCount - 1] >= length) --binCount
    if (!clip.audioPresent || binCount <= 0) {
      return Array.from({ length: clip.getChannelCount() }, () => [])
    }
    const edges = binEdges.slice(0, binCount + 1)
    edges[binCount] = Math.min(edges[binCount], length)
    let clipSummarizer = this.clipSummarizers.get(clip)
    if (!clipSummarizer) {
      clipSummarizer = new ClipSummarizer(clip)
      this.clipSummarizers.set(clip, clipSummarizer)
    }
    return await clipSummarizer.summarizeChannel(edges, samplesPerBin)
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

  async summarizeChannel(binEdges: readonly number[], samplesPerBin: number): Promise<Array<Array<number>>> {
    const startPosition = binEdges[0]
    const endPosition = binEdges[binEdges.length - 1]
    if (startPosition < 0 || endPosition > this.clip.length) {
      throw new Error(
        `Range provided does not cover this ClipView : start ${startPosition} end ${endPosition} ${this.clip.length}`,
      )
    }

    // prewarm to reduce laggy transitions from summary to raw file
    if (
      !isRecordingState(AudioControl.getState()) &&
      samplesPerBin > Summary.SAMPLES_PER_SUMMARY &&
      samplesPerBin < Summary.SAMPLES_PER_SUMMARY * 1.2
    ) {
      this.warmFileCache(startPosition, endPosition)
    }

    return !isRecordingState(AudioControl.getState()) && samplesPerBin < Summary.SAMPLES_PER_SUMMARY
      ? this.getPcmBins(binEdges)
      : (this.clip.summary?.getSummaryOfBins(binEdges) ?? [])
  }

  private async warmFileCache(startPosition: number, endPosition: number) {
    if (startPosition < this.fileCacheStart || endPosition > this.fileCacheEnd) {
      const diskReadSamples = Math.max(1_000_000, endPosition + 1 - startPosition)
      const twiceMidPoint = endPosition + startPosition + 1
      const startPoint = Math.max(Math.round((twiceMidPoint - diskReadSamples) / 2), 0)
      const endPoint = startPoint + diskReadSamples
      this.fileCache = new Float32Array(
        await (
          await this.getFile()
        )
          .slice(this.samplePositionToFilePosition(startPoint), this.samplePositionToFilePosition(endPoint))
          .arrayBuffer(),
      )
      this.fileCacheStart = startPoint
      this.fileCacheEnd = endPoint
    }
  }

  private async getPcmBins(binEdges: readonly number[]) {
    const channelCount = this.clip.getChannelCount()
    await this.warmFileCache(binEdges[0], binEdges[binEdges.length - 1])
    const data = this.fileCache!
    const binCount = binEdges.length - 1
    const result = Array.from({ length: channelCount }, () => new Array<number>(2 * binCount))
    for (let bin = 0; bin < binCount; ++bin) {
      const binStart = (binEdges[bin] - this.fileCacheStart) * channelCount
      const binEnd = (binEdges[bin + 1] - this.fileCacheStart) * channelCount
      for (let channel = 0; channel < channelCount; ++channel) {
        let max = -1
        let min = 1
        for (let i = binStart + channel; i < binEnd; i += channelCount) {
          if (data[i] > max) max = data[i]
          if (data[i] < min) min = data[i]
        }
        result[channel][2 * bin] = Math.min(max, 1)
        result[channel][2 * bin + 1] = Math.max(min, -1)
      }
    }
    return result
  }

  private samplePositionToFilePosition(samplePosition: number) {
    return this.clip.getChannelCount() * samplePosition * Float32Array.BYTES_PER_ELEMENT
  }
}
