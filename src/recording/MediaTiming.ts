export function getAudioChunkPlacement(
  timestampUs: number,
  firstTimestampUs: number,
  frameCount: number,
  sourceRate: number,
  framesWritten: number,
  leadingOffsetSeconds: number,
): { gapFrames: number; skipFrames: number } {
  if (
    !Number.isFinite(timestampUs) ||
    !Number.isFinite(firstTimestampUs) ||
    !Number.isFinite(leadingOffsetSeconds) ||
    !Number.isFinite(sourceRate) ||
    sourceRate <= 0 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount < 0 ||
    !Number.isSafeInteger(framesWritten) ||
    framesWritten < 0
  ) {
    throw new Error('Invalid media audio timing')
  }
  const targetFrame = Math.round(((timestampUs - firstTimestampUs) / 1e6 + leadingOffsetSeconds) * sourceRate)
  if (!Number.isSafeInteger(targetFrame)) {
    throw new Error('Media audio timestamp exceeds the supported sample range')
  }
  return {
    gapFrames: Math.max(0, targetFrame - framesWritten),
    skipFrames: Math.min(frameCount, Math.max(0, framesWritten - targetFrame)),
  }
}

export interface MediaPresentation {
  /** Clip sample of the first presented video frame. */
  videoStartSample: number
  videoLength: number
  /** Media timestamp presented at `videoStartSample`. */
  videoMediaStartSeconds: number
  /** Clip position of the first decoded audio frame; a negative offset discards that much pre-roll. */
  leadingAudioOffsetSeconds: number
}

/**
 * Places linked video and audio on one clip timeline that starts at the first presented sample of either stream.
 * Negative timestamps are pre-roll the container excludes from presentation, such as AAC priming behind an edit list
 * or frames before a stream-copy cut; like Mediabunny's own conversions, presentation starts no earlier than zero.
 */
export function getMediaPresentation(
  firstVideoSeconds: number,
  videoEndSeconds: number,
  firstAudioSeconds: number | null,
  sampleRate: number,
): MediaPresentation {
  const videoStart = Math.max(firstVideoSeconds, 0)
  if (!Number.isFinite(firstVideoSeconds) || !Number.isFinite(videoEndSeconds) || videoEndSeconds <= videoStart) {
    throw new Error('Video stream has no finite, nonempty presentation interval')
  }
  if (firstAudioSeconds !== null && !Number.isFinite(firstAudioSeconds)) {
    throw new Error('Audio stream has no finite presentation timestamp')
  }
  const origin = firstAudioSeconds === null ? videoStart : Math.min(videoStart, Math.max(firstAudioSeconds, 0))
  const videoStartSample = Math.round((videoStart - origin) * sampleRate)
  const videoLength = Math.round((videoEndSeconds - videoStart) * sampleRate)
  if (
    !Number.isSafeInteger(videoStartSample) ||
    !Number.isSafeInteger(videoLength) ||
    !Number.isSafeInteger(videoStartSample + videoLength) ||
    videoLength <= 0
  ) {
    throw new Error('Video presentation interval is outside the supported sample range')
  }
  return {
    videoStartSample,
    videoLength,
    videoMediaStartSeconds: videoStart,
    leadingAudioOffsetSeconds: firstAudioSeconds === null ? 0 : firstAudioSeconds - origin,
  }
}
