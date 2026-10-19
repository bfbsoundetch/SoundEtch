import type { VideoSegment } from '../project/Video'

export interface VideoPlacement {
  readonly offset: number
  readonly startPosition: number
  readonly length: number
  readonly clip: {
    readonly filename: string
    readonly videoSegments: readonly VideoSegment[]
  }
}

export interface VideoFrameTarget {
  readonly placement: VideoPlacement
  readonly segment: VideoSegment
  readonly filename: string
  readonly mediaTimeSeconds: number
}

/** The latest placed video wins an overlap; gaps in that placement remain black. */
export function resolveVideoFrame(
  placements: readonly VideoPlacement[],
  sample: number,
  sampleRate: number,
): VideoFrameTarget | null {
  if (!Number.isFinite(sample) || !Number.isFinite(sampleRate) || sampleRate <= 0) return null
  for (let i = placements.length - 1; i >= 0; --i) {
    const placement = placements[i]
    if (
      placement.clip.videoSegments.length === 0 ||
      sample < placement.startPosition ||
      sample >= placement.startPosition + placement.length
    )
      continue
    const sourceSample = placement.offset + sample - placement.startPosition
    const segment = placement.clip.videoSegments.find(
      (segment) => sourceSample >= segment.startSample && sourceSample < segment.startSample + segment.length,
    )
    if (!segment) return null
    return {
      placement,
      segment,
      filename: `${placement.clip.filename}_video_${segment.index}`,
      mediaTimeSeconds: segment.mediaStartSeconds + (sourceSample - segment.startSample) / sampleRate,
    }
  }
  return null
}
