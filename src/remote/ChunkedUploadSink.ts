import { type BinaryFileWriter, FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { VideoByteSink } from '../recording/VideoTrackRecorder'
import { HQ_VIDEO_CHUNK_BYTES } from './HighQualityAudioFormat'

/** `name` is the chunk's cloud name; `file` is its spool file, which carries the sink's prefix. */
export type SealedVideoChunk = { name: string; file: string; index: number; size: number }

type OpenChunk = { index: number; size: number; writer: BinaryFileWriter }

export function videoChunkName(index: number) {
  return `video-${String(index).padStart(5, '0')}.part`
}

/**
 * Spools a muxed video stream into fixed-size numbered chunk files so finished chunks can upload while recording
 * continues. The fragmented MP4 muxer only rewrites recent bytes, so a chunk is sealed once writing moves past it.
 */
export class ChunkedUploadSink implements VideoByteSink {
  /** Chunks still accepting writes: the one the stream is in, and any a spanning write has reached past it. */
  private readonly open = new Map<number, OpenChunk>()
  /** Every 0-based chunk index below this is sealed. */
  private sealedBelow = 0
  private closed = false

  /** `filePrefix` keeps several sessions' chunks apart in one spool directory. */
  constructor(
    private readonly directory: string,
    private readonly onSealed: (chunk: SealedVideoChunk) => void,
    private readonly filePrefix = '',
  ) {}

  async write(data: Uint8Array<ArrayBuffer>, position: number): Promise<void> {
    if (this.closed) throw new Error('Cannot write to a closed video sink')
    const startChunk = Math.floor(position / HQ_VIDEO_CHUNK_BYTES)
    if (startChunk < this.sealedBelow) throw new Error(`Video write at ${position} reaches an uploaded chunk`)
    while (this.sealedBelow < startChunk) await this.seal(this.sealedBelow)
    let offset = 0
    while (offset < data.byteLength) {
      const at = position + offset
      const index = Math.floor(at / HQ_VIDEO_CHUNK_BYTES)
      const chunkStart = index * HQ_VIDEO_CHUNK_BYTES
      const length = Math.min(data.byteLength - offset, chunkStart + HQ_VIDEO_CHUNK_BYTES - at)
      const chunk = await this.chunk(index)
      await chunk.writer.write(data.slice(offset, offset + length), at - chunkStart)
      chunk.size = Math.max(chunk.size, at - chunkStart + length)
      offset += length
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const index of [...this.open.keys()].sort((a, b) => a - b)) await this.seal(index)
  }

  /** The open chunk at `index`, opening it when a spanning write first reaches it. */
  private async chunk(index: number): Promise<OpenChunk> {
    const existing = this.open.get(index)
    if (existing) return existing
    const chunk = {
      index,
      size: 0,
      writer: await FileSystemUtils.createFileWriter(this.directory, this.filePrefix + videoChunkName(index + 1)),
    }
    this.open.set(index, chunk)
    return chunk
  }

  /** Closes chunk `index` (opening it empty if never written, so chunk numbering stays contiguous) and reports it. */
  private async seal(index: number) {
    const chunk = await this.chunk(index)
    await chunk.writer.close()
    this.open.delete(index)
    this.sealedBelow = index + 1
    const name = videoChunkName(index + 1)
    this.onSealed({ name, file: this.filePrefix + name, index: index + 1, size: chunk.size })
  }
}
