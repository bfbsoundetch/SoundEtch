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
