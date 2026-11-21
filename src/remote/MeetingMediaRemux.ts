import {
  ALL_FORMATS,
  CustomSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny'
import type { StreamTargetChunk } from 'mediabunny'
import type { VideoSegment } from '../project/Video'
import { VideoFileWriter } from '../recording/VideoFileWriter'
import { readRecordedVideoSegment } from '../recording/VideoTrackRecorder'
import { mapSessionSample, type Run } from './HighQualityAlignment'
import { HQ_SAMPLE_RATE, HQ_VIDEO_CHUNK_BYTES } from './HighQualityAudioFormat'

export interface RemuxRequest {
  readonly dirname: string
  readonly filename: string
  /** The uploaded MP4's size: the sum of its chunks. */
  readonly size: number
  /** Chunk `index`, which holds bytes from `index·HQ_VIDEO_CHUNK_BYTES`, verified against the manifest. */
  readChunk(index: number): Promise<Uint8Array>
  /** The session's alignment; video timestamps are in session seconds, like its audio. */
  readonly runs: readonly Run[]
}

/**
 * Copies a guest's uploaded MP4 into the clip's video file `filename` without re-encoding, moving every frame to the
 * clip position its audio was aligned to. Returns the written file's segment, on the clip's timeline but unclamped.
 */
export async function remuxSessionVideo(request: RemuxRequest): Promise<VideoSegment> {
  const aligned = (seconds: number) =>
    mapSessionSample(request.runs, Math.round(seconds * HQ_SAMPLE_RATE))! / HQ_SAMPLE_RATE
  if (!(await writeRemux(request, aligned, false))) {
    // Piecewise mapping can reorder B-frames' presentation; one constant shift keeps their order.
    const shift = medianOffset(request.runs) / HQ_SAMPLE_RATE
    await writeRemux(request, (seconds) => seconds + shift, true)
  }
  return readRecordedVideoSegment(request.dirname, request.filename, HQ_SAMPLE_RATE)
}

/** Returns false, having written nothing usable, when the stream has B-frames and they are not `allowed`. */
async function writeRemux(
  request: RemuxRequest,
  map: (seconds: number) => number,
  bFramesAllowed: boolean,
): Promise<boolean> {
  const input = new Input({
    source: new CustomSource({
      getSize: () => request.size,
      read: (start, end) => readRange(request, start, end),
      prefetchProfile: 'network',
    }),
    formats: ALL_FORMATS,
  })
  let writer: VideoFileWriter | null = null
  let output: Output | null = null
  try {
    const track = (await input.getVideoTracks())[0]
    if (!track) throw new Error('the uploaded video has no video track')
    const codec = track.codec
    if (!codec) throw new Error('the uploaded video has an unknown codec')
    const decoderConfig = await track.getDecoderConfig()
    if (!decoderConfig) throw new Error('the uploaded video has no decoder configuration')
    const fileWriter = await VideoFileWriter.open(request.dirname, request.filename)
    writer = fileWriter
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
      target: new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write: ({ data, position }) => fileWriter.write(data, position),
          close: () => fileWriter.close(),
        }),
      ),
    })
    const source = new EncodedVideoPacketSource(codec)
    output.addVideoTrack(source)
    await output.start()
    let lastRaw = -Infinity
    let last = -Infinity
    let first = true
    for await (const packet of new EncodedPacketSink(track).packets()) {
      if (!bFramesAllowed && packet.timestamp < lastRaw) {
        await output.cancel()
        return false
      }
      lastRaw = packet.timestamp
      // Decode order is presentation order here, so timestamps must keep increasing after mapping.
      const timestamp = bFramesAllowed
        ? Math.max(0, map(packet.timestamp))
        : Math.max(0, map(packet.timestamp), last + 0.001)
      last = timestamp
      await source.add(packet.clone({ timestamp }), first ? { decoderConfig } : undefined)
      first = false
    }
    if (first) throw new Error('the uploaded video has no frames')
    await output.finalize()
    return true
  } catch (error) {
    if (output && output.state != 'finalized' && output.state != 'canceled') await output.cancel().catch(() => {})
    throw error
  } finally {
    // Releases the file even when cancelling skipped the stream's close.
    await writer?.close().catch(() => {})
    input.dispose()
  }
}

async function readRange(request: RemuxRequest, start: number, end: number): Promise<Uint8Array> {
  const firstChunk = Math.floor(start / HQ_VIDEO_CHUNK_BYTES)
  const lastChunk = Math.floor((end - 1) / HQ_VIDEO_CHUNK_BYTES)
  if (firstChunk == lastChunk) {
    const offset = firstChunk * HQ_VIDEO_CHUNK_BYTES
    return (await request.readChunk(firstChunk)).subarray(start - offset, end - offset)
  }
  const bytes = new Uint8Array(end - start)
  for (let index = firstChunk; index <= lastChunk; ++index) {
    const offset = index * HQ_VIDEO_CHUNK_BYTES
    const chunk = await request.readChunk(index)
    const from = Math.max(start, offset)
    const to = Math.min(end, offset + chunk.length)
    bytes.set(chunk.subarray(from - offset, to - offset), from - start)
  }
  return bytes
}

function medianOffset(runs: readonly Run[]): number {
  const offsets = runs.map((run) => run.filePosition - run.sessionSample).sort((a, b) => a - b)
  return offsets[Math.floor(offsets.length / 2)]
}
