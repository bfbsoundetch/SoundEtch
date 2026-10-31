import type { VideoSample } from 'mediabunny'
import {
  cloneOutputScene,
  getOutputCropPosition,
  getOutputCropScale,
  getOutputSceneIndex,
  type OutputScene,
} from '../project/OutputScene'
import type { Project } from '../project/Project'
import type { Track } from '../project/Track'
import { paintVideoFrame } from './VideoFramePainter'
import { VideoFrameReader } from './VideoFrameReader'
import { resolveVideoFrame, type VideoFrameTarget, type VideoPlacement } from './VideoFrameResolver'

/** A fixed snapshot of the Output scene and source edits, independent of preview size and device pixels. */
export class OutputVideoCompositor {
  private readonly scenes: readonly OutputScene[]
  private readonly placements = new Map<Track, readonly VideoPlacement[]>()
  private readonly automaticSources: (readonly VideoPlacement[])[] = []
  private readonly readers: readonly [VideoFrameReader, VideoFrameReader]
  private readonly sampleRate: number
  private readonly scale: number
  private readonly viewportX: number
  private readonly viewportY: number
  private readonly viewportWidth: number
  private readonly viewportHeight: number
  private disposed = false
  private readonly onAbort = (): void => this.dispose()

  constructor(
    project: Project,
    private readonly context: CanvasRenderingContext2D,
    private readonly width: number,
    private readonly height: number,
    private readonly signal: AbortSignal,
  ) {
    this.scenes = project.outputScenes.map(cloneOutputScene)
    this.sampleRate = project.sampleRate
    // Keep Track identity only for explicit scene-source lookup; none of its editable data is read later.
    for (const track of project.getTracks()) {
      const placements: VideoPlacement[] = track.clipViews.map((view) => ({
        offset: view.offset,
        startPosition: view.startPosition,
        length: view.length,
        clip: {
          filename: view.clip.filename,
          videoSegments: view.clip.videoSegments.map((segment) => ({ ...segment })),
        },
      }))
      this.placements.set(track, placements)
      // OutputPanelController uses all video-bearing tracks in project order, regardless of mute or solo.
      if (placements.some((placement) => placement.clip.videoSegments.length > 0)) {
        this.automaticSources.push(placements)
      }
    }
    this.scale = Math.min(width / 1920, height / 1080)
    this.viewportWidth = 1920 * this.scale
    this.viewportHeight = 1080 * this.scale
    this.viewportX = (width - this.viewportWidth) / 2
    this.viewportY = (height - this.viewportHeight) / 2
    this.readers = [
      new VideoFrameReader(project.directoryName, this.sampleRate, signal),
      new VideoFrameReader(project.directoryName, this.sampleRate, signal),
    ]
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.dispose()
  }

  /** The caller awaits each frame before encoding or requesting another; reader samples remain borrowed. */
  async drawFrame(projectSample: number): Promise<void> {
    this.throwIfDisposed()
    const context = this.context
    context.save()
    try {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = '#000'
      context.fillRect(0, 0, this.width, this.height)
      const scene = this.scenes[getOutputSceneIndex(this.scenes, projectSample)]
      if (!scene) return
      const count = scene.layout === 'single' ? 1 : 2
      const margin = Math.max(0, Math.min(240, scene.margin ?? 0)) * this.scale
      const radius = Math.max(0, Math.min(540, scene.cornerRadius ?? 0)) * this.scale
      const cellWidth = this.viewportWidth / count
      let firstTarget: VideoFrameTarget | null = null
      let firstFrame: VideoSample | null = null
      for (let slot = 0; slot < count; ++slot) {
        const selected = scene.tracks[slot]
        const placements = selected === null ? this.automaticSources[slot] : this.placements.get(selected)
        const target = placements ? resolveVideoFrame(placements, projectSample, this.sampleRate) : null
        if (!target) continue
        let frame: VideoSample | null
        if (
          slot === 1 &&
          firstTarget &&
          firstTarget.filename === target.filename &&
          firstTarget.segment.trackNumber === target.segment.trackNumber &&
          firstTarget.mediaTimeSeconds === target.mediaTimeSeconds
        ) {
          // The first reader is not advanced again until the next output frame, so its sample is still valid.
          frame = firstFrame
        } else {
          frame = await this.readers[slot].getFrame(target)
          this.throwIfDisposed()
        }
        if (slot === 0) {
          firstTarget = target
          firstFrame = frame
        }
        if (!frame) continue
        const crop = getOutputCropPosition(scene, slot)
        paintVideoFrame(
          context,
          frame,
          this.viewportX + slot * cellWidth,
          this.viewportY,
          cellWidth,
          this.viewportHeight,
          scene.fit,
          crop.x,
          crop.y,
          radius,
          getOutputCropScale(scene, slot),
          margin,
        )
      }
    } finally {
      context.restore()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.signal.removeEventListener('abort', this.onAbort)
    for (const reader of this.readers) reader.dispose()
  }

  private throwIfDisposed(): void {
    if (this.signal.aborted) {
      throw this.signal.reason ?? new DOMException('Video export canceled', 'AbortError')
    }
    if (this.disposed) throw new Error('The output video compositor has been disposed')
  }
}
