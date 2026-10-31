import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, VideoSampleSink } from 'mediabunny'
import type { VideoSample } from 'mediabunny'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { VideoFrameTarget } from './VideoFrameResolver'

const RESTART_SAVING_SECONDS = 0.25

type Source = {
  key: string
  input: Input
  sink: VideoSampleSink | null
  packets: EncodedPacketSink | null
  endTime: number
  iterator: AsyncGenerator<VideoSample, void, unknown> | null
  iteratorEnd: number
  lastTime: number
  current: VideoSample | null
  next: VideoSample | null
}

/**
 * Awaited, sequential video lookup for export. Only the current and following decoded samples are retained here;
 * Mediabunny owns its bounded decoder queue. A returned sample is borrowed until the next request or disposal.
 */
export class VideoFrameReader {
  private source: Source | null = null
  private closedError: Error | null = null
  private rejectPending: ((reason: Error) => void) | null = null
  private readonly onAbort = () => this.dispose()

  constructor(
    private readonly directory: string,
    private readonly sampleRate: number,
    private readonly signal: AbortSignal,
  ) {
    if (signal.aborted) this.dispose()
    else signal.addEventListener('abort', this.onAbort, { once: true })
  }

  async getFrame(target: VideoFrameTarget): Promise<VideoSample | null> {
    this.throwIfClosed()
    try {
      // File-system and codec capability requests cannot all be interrupted. Reject the caller immediately on
      // disposal, while still observing the underlying operation and cleaning up anything it delivers later.
      const { promise, resolve, reject } = Promise.withResolvers<VideoSample | null>()
      this.rejectPending = reject
      void this.readFrame(target).then(resolve, reject)
      const frame = await promise
      this.throwIfClosed()
      return frame
    } catch (error) {
      this.releaseSource()
      if (this.closedError) throw this.closedError
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Video ${target.filename} (track ${target.segment.trackNumber}) is unavailable: ${message}`, {
        cause: error,
      })
    } finally {
      this.rejectPending = null
    }
  }

  dispose(): void {
    if (this.closedError) return
    this.closedError = this.signal.aborted
      ? this.signal.reason instanceof Error
        ? this.signal.reason
        : new DOMException('Video export canceled', 'AbortError')
      : new Error('Video frame reader has been disposed')
    this.signal.removeEventListener('abort', this.onAbort)
    this.rejectPending?.(this.closedError)
    this.releaseSource()
  }

  private throwIfClosed(): void {
    if (this.closedError) throw this.closedError
  }

  private async getSource(target: VideoFrameTarget): Promise<Source> {
    const key = `${target.filename}#${target.segment.trackNumber}`
    if (this.source?.key === key) return this.source
    this.releaseSource()
    const file = await FileSystemUtils.getExistingFile(this.directory, target.filename)
    this.throwIfClosed()
    if (file.size === 0) throw new Error('The stored video file is empty')
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const source: Source = {
      key,
      input,
      sink: null,
      packets: null,
      endTime: 0,
      iterator: null,
      iteratorEnd: 0,
      lastTime: -Infinity,
      current: null,
      next: null,
    }
    // Register before validation so disposal also covers an input that fails or stalls while opening.
    this.source = source
    const readable = await input.canRead()
    this.throwIfClosed()
    if (!readable) throw new Error('The video container is not supported')
    const tracks = await input.getVideoTracks()
    this.throwIfClosed()
    const track = tracks[target.segment.trackNumber - 1]
    if (!track) throw new Error(`Video track ${target.segment.trackNumber} is missing`)
    const decodable = await track.canDecode()
    this.throwIfClosed()
    if (!decodable) throw new Error('The selected video track cannot be decoded in this browser')
    const packets = new EncodedPacketSink(track)
    const lastPacket = await packets.getPacket(Infinity, { metadataOnly: true })
    this.throwIfClosed()
    if (!lastPacket) throw new Error('The selected video track contains no video packets')
    const firstKey = await packets.getFirstKeyPacket({ verifyKeyPackets: true })
    this.throwIfClosed()
    if (!firstKey) throw new Error('The selected video track contains no decodable key frame')
    source.endTime = lastPacket.timestamp + lastPacket.duration
    source.packets = packets
    // The sink preserves the stored timestamps, rotation, and display aspect ratio on the original samples.
    source.sink = new VideoSampleSink(track)
    return source
  }

  private async readFrame(target: VideoFrameTarget): Promise<VideoSample | null> {
    const source = await this.getSource(target)
    this.throwIfClosed()
    const time = target.mediaTimeSeconds
    const end = target.segment.mediaStartSeconds + target.segment.length / this.sampleRate
    let restart = !source.iterator || source.iteratorEnd !== end || time < source.lastTime
    const current = source.current
    if (
      !restart &&
      current &&
      time >= (source.next?.timestamp ?? current.timestamp + current.duration) &&
      time - current.timestamp > RESTART_SAVING_SECONDS
    ) {
      // A forward cut may skip hours of footage. Seek when its key frame is substantially ahead of this decoder.
      const key = await source.packets!.getKeyPacket(time, { metadataOnly: true })
      this.throwIfClosed()
      restart = key !== null && key.timestamp - current.timestamp > RESTART_SAVING_SECONDS
    }
    if (restart) {
      this.stopIterator(source)
      const iterator = source.sink!.samples(time, end)
      source.iterator = iterator
      source.iteratorEnd = end
      await this.pull(source, iterator, 'current')
      if (source.current) await this.pull(source, iterator, 'next')
    }
    source.lastTime = time
    const iterator = source.iterator!
    while (source.next && source.next.timestamp <= time) {
      source.current?.close()
      source.current = source.next
      source.next = null
      await this.pull(source, iterator, 'next')
    }
    this.throwIfClosed()
    const frame = source.current
    if (frame) {
      // Like the preview, hold a frame until the following timestamp; the final frame ends at its own duration.
      return time >= frame.timestamp && time < (source.next?.timestamp ?? frame.timestamp + frame.duration)
        ? frame
        : null
    }
    // An empty decoded range is legitimate before/after the source timeline, but not where stored video packets
    // should have produced a picture. In particular, never turn a silently failing decoder into a black export.
    const packet = await source.packets!.getPacket(time, { metadataOnly: true })
    this.throwIfClosed()
    if (packet && time < source.endTime) throw new Error('The selected video track produced no decoded video frame')
    return null
  }

  private async pull(
    source: Source,
    iterator: AsyncGenerator<VideoSample, void, unknown>,
    slot: 'current' | 'next',
  ): Promise<void> {
    const result = await iterator.next()
    const sample = result.done ? null : result.value
    if (this.closedError || this.source !== source || source.iterator !== iterator) {
      sample?.close()
      this.throwIfClosed()
      throw new Error('The video source was released during decoding')
    }
    // Transfer ownership before resolving, so an abort between async continuations can still close the sample.
    source[slot] = sample
  }

  private stopIterator(source: Source): void {
    const iterator = source.iterator
    source.iterator = null
    source.current?.close()
    source.current = null
    source.next?.close()
    source.next = null
    // Returning the iterator wakes pending reads and closes its prefetched samples; input disposal below also
    // interrupts file reads and codec work. Observe the return promise even when shutdown follows a decoder error.
    if (iterator) void iterator.return().catch(() => {})
  }

  private releaseSource(): void {
    const source = this.source
    this.source = null
    if (!source) return
    this.stopIterator(source)
    source.input.dispose()
  }
}
