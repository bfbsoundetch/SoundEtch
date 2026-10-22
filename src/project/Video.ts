export interface VideoSegment {
  index: number
  // One-based ordinal in the stored file's Mediabunny video-track list.
  trackNumber: number
  startSample: number
  length: number
  mediaStartSeconds: number
  mimeType: string
}
