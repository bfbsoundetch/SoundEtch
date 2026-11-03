import type { VideoSample } from 'mediabunny'
import type { OutputCaptionSettings } from '../project/OutputCaptions'
import { cloneOutputScene, getOutputCropPosition, getOutputCropScale, type OutputScene } from '../project/OutputScene'
import type { Project } from '../project/Project'
import type { Track } from '../project/Track'
import { findOutputCaptionWord } from './OutputCaptionCues'
import { OutputCaptionSource } from './OutputCaptionSource'
import { paintOutputCaption } from './OutputCaptionPainter'
import { getOutputSceneLayers, getOutputTransitionWindow } from './OutputTransition'
import { paintVideoFrame } from './VideoFramePainter'
import { VideoFrameReader } from './VideoFrameReader'
import { resolveVideoFrame, type VideoFrameTarget, type VideoPlacement } from './VideoFrameResolver'

type ReaderPair = readonly [VideoFrameReader, VideoFrameReader]

/** A fixed snapshot of the Output scene and source edits, independent of preview size and device pixels. */
export class OutputVideoCompositor {
  private readonly scenes: readonly OutputScene[]
  private readonly projectLength: number
  private readonly captionSettings: Readonly<OutputCaptionSettings>
  private readonly captionSource: OutputCaptionSource | null
  /**
   * The reader pair of each scene. A cut keeps the previous scene's pair, so its decoders continue; a transition
   * switches pairs, so both of its scenes decode sequentially while it plays.
   */
  private readonly sceneReaders: (0 | 1)[] = []
  private readonly placements = new Map<Track, readonly VideoPlacement[]>()
  private readonly automaticSources: (readonly VideoPlacement[])[] = []
  private readonly readers: readonly [ReaderPair, ReaderPair]
  /** The current output frame's pictures; identical requests reuse the first reader's borrowed sample. */
  private readonly reads: { target: VideoFrameTarget; frame: VideoSample | null }[] = []
  /** Scenes that a transition moves or fades are composed here first, by paint order. */
  private readonly layerContexts: OffscreenCanvasRenderingContext2D[] = []
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
    this.projectLength = project.getLength()
    this.captionSettings = { ...project.outputCaptions }
    this.captionSource = this.captionSettings.enabled ? new OutputCaptionSource(project, this.captionSettings) : null
    let pair: 0 | 1 = 0
    for (let index = 0; index < this.scenes.length; ++index) {
      if (getOutputTransitionWindow(this.scenes, index, this.sampleRate, this.projectLength)) pair = pair === 0 ? 1 : 0
      this.sceneReaders.push(pair)
    }
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
    const pairOfReaders = (): ReaderPair => [
      new VideoFrameReader(project.directoryName, this.sampleRate, signal),
      new VideoFrameReader(project.directoryName, this.sampleRate, signal),
    ]
    this.readers = [pairOfReaders(), pairOfReaders()]
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.dispose()
  }

  /** The caller awaits each frame before encoding or requesting another; reader samples remain borrowed. */
  async drawFrame(projectSample: number): Promise<void> {
    this.throwIfDisposed()
    const layers = getOutputSceneLayers(this.scenes, projectSample, this.sampleRate, this.projectLength).filter(
      (layer) => layer.opacity > 0,
    )
    // Read every picture before painting: each reader is asked at most once per output frame, so a sample it lent
    // stays valid for all slots and scenes that show the same picture.
    this.reads.length = 0
    const pictures: (VideoSample | null)[][] = []
    for (const layer of layers) {
      const scene = this.scenes[layer.index]
      const readers = this.readers[this.sceneReaders[layer.index]]
      const frames: (VideoSample | null)[] = []
      for (let slot = 0; slot < (scene.layout === 'single' ? 1 : 2); ++slot) {
        frames.push(await this.readFrame(readers[slot], scene, slot, projectSample))
      }
      pictures.push(frames)
    }
    const context = this.context
    context.save()
    try {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = '#000'
      context.fillRect(0, 0, this.width, this.height)
      // Moving pictures stay inside the 16:9 frame, out of a portrait export's black bars.
      context.beginPath()
      context.rect(this.viewportX, this.viewportY, this.viewportWidth, this.viewportHeight)
      context.clip()
      const centerX = this.viewportX + this.viewportWidth / 2
      const centerY = this.viewportY + this.viewportHeight / 2
      layers.forEach((layer, order) => {
        const scene = this.scenes[layer.index]
        if (order === 0 && layer.opacity === 1 && layer.x === 0 && layer.y === 0 && layer.scale === 1) {
          // As outside transitions, a still, opaque bottom scene paints directly over the black frame.
          this.paintScene(context, scene, pictures[order])
          return
        }
        // Compose the scene's 16:9 frame with its black background, so it fades and moves as one picture. Outside
        // the frame the layer stays transparent: a portrait export's bars must not cover the other scene.
        const layerContext = this.getLayerContext(order)
        layerContext.clearRect(0, 0, this.width, this.height)
        layerContext.fillStyle = '#000'
        layerContext.fillRect(this.viewportX, this.viewportY, this.viewportWidth, this.viewportHeight)
        this.paintScene(layerContext, scene, pictures[order])
        context.globalAlpha = layer.opacity
        context.setTransform(
          layer.scale,
          0,
          0,
          layer.scale,
          centerX + layer.x * this.viewportWidth - layer.scale * centerX,
          centerY + layer.y * this.viewportHeight - layer.scale * centerY,
        )
        context.drawImage(layerContext.canvas, 0, 0)
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.globalAlpha = 1
      })
      // Captions are project-wide: draw last, in the fixed viewport, never inside a moving/fading scene.
      const cue = this.captionSource?.getCue(projectSample)
      if (cue) {
        paintOutputCaption(
          context,
          cue,
          findOutputCaptionWord(cue, projectSample),
          this.captionSettings,
          this.viewportX,
          this.viewportY,
          this.viewportWidth,
          this.viewportHeight,
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
    for (const pair of this.readers) for (const reader of pair) reader.dispose()
    this.reads.length = 0
    this.layerContexts.length = 0
  }

  private async readFrame(
    reader: VideoFrameReader,
    scene: OutputScene,
    slot: number,
    projectSample: number,
  ): Promise<VideoSample | null> {
    const selected = scene.tracks[slot]
    const placements = selected === null ? this.automaticSources[slot] : this.placements.get(selected)
    const target = placements ? resolveVideoFrame(placements, projectSample, this.sampleRate) : null
    if (!target) return null
    const read = this.reads.find(
      (candidate) =>
        candidate.target.filename === target.filename &&
        candidate.target.segment.trackNumber === target.segment.trackNumber &&
        candidate.target.mediaTimeSeconds === target.mediaTimeSeconds,
    )
    if (read) return read.frame
    const frame = await reader.getFrame(target)
    this.throwIfDisposed()
    this.reads.push({ target, frame })
    return frame
  }

  private paintScene(
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    scene: OutputScene,
    frames: readonly (VideoSample | null)[],
  ): void {
    const margin = Math.max(0, Math.min(240, scene.margin ?? 0)) * this.scale
    const radius = Math.max(0, Math.min(540, scene.cornerRadius ?? 0)) * this.scale
    const cellWidth = this.viewportWidth / frames.length
    frames.forEach((frame, slot) => {
      if (!frame) return
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
    })
  }

  private getLayerContext(order: number): OffscreenCanvasRenderingContext2D {
    let context = this.layerContexts[order]
    if (!context) {
      const created = new OffscreenCanvas(this.width, this.height).getContext('2d')
      if (!created) throw new Error('Could not create a canvas context for video transitions')
      context = this.layerContexts[order] = created
    }
    return context
  }

  private throwIfDisposed(): void {
    if (this.signal.aborted) {
      throw this.signal.reason ?? new DOMException('Video export canceled', 'AbortError')
    }
    if (this.disposed) throw new Error('The output video compositor has been disposed')
  }
}
