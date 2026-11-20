import { VideoInputs, type VideoInput } from '../videoinputs/VideoInputs'

export type RecordingMode = 'audio-video' | 'audio-only'

/** Whether recordings capture video inputs along with audio. Each page load starts with audio and video. */
export class RecordingModeSetting {
  private static mode: RecordingMode = 'audio-video'
  private static readonly listeners = new Set<() => void>()

  static get(): RecordingMode {
    return RecordingModeSetting.mode
  }

  static set(mode: RecordingMode) {
    if (mode == RecordingModeSetting.mode) return
    RecordingModeSetting.mode = mode
    RecordingModeSetting.listeners.forEach((listener) => listener())
  }

  /** Calls `listener` whenever the mode changes; returns an unsubscriber. */
  static addListener(listener: () => void): () => void {
    RecordingModeSetting.listeners.add(listener)
    return () => RecordingModeSetting.listeners.delete(listener)
  }

  /** The video inputs a recording started now would capture: none when recording audio only. */
  static gatherVideoInputs(): Array<VideoInput> {
    return RecordingModeSetting.mode == 'audio-only' ? [] : VideoInputs.gather()
  }
}
