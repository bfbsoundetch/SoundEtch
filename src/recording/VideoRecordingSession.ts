import type { EnhancedAudioContext } from '../audiocontext/EnhancedAudioContext'
import type { Clip } from '../project/Clip'
import { ProjectManager } from '../project/ProjectManager'
import type { Track } from '../project/Track'
import { NotificationsController } from '../ui/NotificationsController'
import { VideoInputs, type VideoInput } from '../videoinputs/VideoInputs'
import { VideoTrackRecorder } from './VideoTrackRecorder'

/** Guests' streams start small while their connection ramps up; recording at this height keeps later detail. */
const REMOTE_MINIMUM_HEIGHT = 720

type Entry = {
  readonly input: VideoInput
  readonly clip: Clip
  readonly track: Track
  readonly recorder: VideoTrackRecorder
}

/**
 * Records the video inputs of one recording into their clips. Frames are placed by the recording context's sample
 * position, which pauses and resumes with the audio; closing the context finalizes the footage.
 */
export class VideoRecordingSession {
  private readonly entries = new Array<Entry>()
  private readonly originPosition: number
  private removeInputListener: (() => void) | null = null

  constructor(
    private readonly audioContext: EnhancedAudioContext,
    private readonly directory: string,
    private readonly sampleRate: number,
    private readonly onFinished: (tracksWithVideo: Array<Track>) => void,
  ) {
    // The context has not run yet, so this is the position of the first recorded audio sample.
    this.originPosition = audioContext.getPosition()
  }

  add(input: VideoInput, clip: Clip, track: Track) {
    const recorder = new VideoTrackRecorder({
      directory: this.directory,
      filename: `${clip.filename}_video_0`,
      sampleRate: this.sampleRate,
      timeline: () => ({
        seconds: (this.audioContext.getPosition() - this.originPosition) / this.audioContext.sampleRate,
        running: this.audioContext.state == 'running',
      }),
      minimumHeight: input.remote ? REMOTE_MINIMUM_HEIGHT : 0,
      onProgress: (endSeconds) => {
        // Grows the clip while recording, which a clip without audio needs to be visible at all.
        clip.videoLength = Math.max(clip.videoLength, Math.round(endSeconds * this.sampleRate))
      },
      onError: (error) => {
        NotificationsController.showErrorMessage(`Video recording of ${input.name} stopped: ${error.message}`)
      },
    })
    recorder.attach(input.track)
    this.entries.push({ input, clip, track, recorder })
  }

  start() {
    this.removeInputListener = VideoInputs.addListener(() => this.updateTracks())
    this.audioContext.addEventListener('statechange', this.handleStateChange)
  }

  private readonly handleStateChange = () => {
    if (this.audioContext.state == 'closed') void this.finish()
  }

  /** Follows cameras turned off and on, guests whose stream is replaced, and sources that leave. */
  private updateTracks() {
    const inputs = VideoInputs.gather()
    for (const entry of this.entries) {
      entry.recorder.attach(inputs.find((input) => input.id == entry.input.id)?.track ?? null)
    }
  }

  private async finish() {
    this.audioContext.removeEventListener('statechange', this.handleStateChange)
    this.removeInputListener?.()
    this.removeInputListener = null
    const results = await Promise.all(
      this.entries.map(async (entry) => ({ entry, segment: await entry.recorder.finish() })),
    )
    const tracksWithVideo = new Array<Track>()
    for (const { entry, segment } of results) {
      try {
        if (segment) {
          entry.clip.videoSegments = [segment]
          entry.clip.videoLength = segment.startSample + segment.length
          await ProjectManager.saveClip(entry.clip)
          tracksWithVideo.push(entry.track)
        } else if (entry.clip.audioPresent) {
          entry.clip.videoLength = 0
          await ProjectManager.saveClip(entry.clip)
        } else {
          // A video-only source that never delivered a frame leaves nothing to keep.
          try {
            await ProjectManager.deleteClip(entry.clip)
          } finally {
            await ProjectManager.deleteTrack(entry.track)
          }
        }
      } catch (error) {
        NotificationsController.showErrorMessage(
          `Could not save the video recording of ${entry.input.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    this.onFinished(tracksWithVideo)
  }
}
