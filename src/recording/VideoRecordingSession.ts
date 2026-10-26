import type { EnhancedAudioContext } from '../audiocontext/EnhancedAudioContext'
import type { Clip } from '../project/Clip'
import type { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import type { Track } from '../project/Track'
import type { VideoSegment } from '../project/Video'
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

/** The file a recording writes `clip`'s video into. */
export function recordedVideoFilename(clip: Clip): string {
  return `${clip.filename}_video_0`
}

/**
 * Saves the outcome of recording `clip`'s video, `segment` or nothing, and clears its in-progress marker; returns
 * whether the clip has video. A video-only clip without footage is deleted, along with the tracks it leaves empty.
 */
export async function settleRecordedVideo(
  project: Project,
  clip: Clip,
  segment: VideoSegment | null,
): Promise<boolean> {
  clip.videoRecordingInProgress = false
  if (segment) {
    clip.videoSegments = [segment]
    clip.videoLength = segment.startSample + segment.length
    await ProjectManager.saveClip(clip)
    return true
  }
  if (clip.audioPresent) {
    clip.videoLength = 0
    await ProjectManager.saveClip(clip)
    return false
  }
  // A video-only source that never delivered a frame leaves nothing to keep.
  const tracks = project.getTracks().filter((track) => track.clipViews.some((view) => view.clip === clip))
  try {
    await ProjectManager.deleteClip(clip, project)
  } finally {
    for (const track of tracks) {
      if (track.clipViews.length == 0) await ProjectManager.deleteTrack(track, project)
    }
  }
  return false
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
    private readonly project: Project,
    private readonly onFinished: (tracksWithVideo: Array<Track>) => void,
  ) {
    // The context has not run yet, so this is the position of the first recorded audio sample.
    this.originPosition = audioContext.getPosition()
  }

  async add(input: VideoInput, clip: Clip, track: Track) {
    // Lets the next load recover the footage if the tab closes before the recording finishes.
    clip.videoRecordingInProgress = true
    await ProjectManager.saveClip(clip)
    const recorder = new VideoTrackRecorder({
      directory: this.project.directoryName,
      filename: recordedVideoFilename(clip),
      sampleRate: this.project.sampleRate,
      timeline: () => ({
        seconds: (this.audioContext.getPosition() - this.originPosition) / this.audioContext.sampleRate,
        running: this.audioContext.state == 'running',
      }),
      minimumHeight: input.remote ? REMOTE_MINIMUM_HEIGHT : 0,
      onProgress: (endSeconds) => {
        // Grows the clip while recording, which a clip without audio needs to be visible at all.
        clip.videoLength = Math.max(clip.videoLength, Math.round(endSeconds * this.project.sampleRate))
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
        if (await settleRecordedVideo(this.project, entry.clip, segment)) tracksWithVideo.push(entry.track)
      } catch (error) {
        NotificationsController.showErrorMessage(
          `Could not save the video recording of ${entry.input.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    this.onFinished(tracksWithVideo)
  }
}
