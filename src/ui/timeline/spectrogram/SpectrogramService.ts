import { AudioControl, AudioState } from '../../../audiocontext/AudioControl'
import { FileSystemUtils } from '../../../filesystem/FileSystemUtils'
import { Logger } from '../../../global/Logger'
import type { Clip } from '../../../project/Clip'
import {
  SpectrogramGpu,
  SPECTROGRAM_TEXTURE_COLUMNS,
  SPECTROGRAM_TILE_BYTES_PER_CHANNEL,
  type SpectrogramGpuCanvas,
  type SpectrogramGpuDraw,
  type SpectrogramGpuTile,
} from './SpectrogramGpu'
import type { SpectrogramSourceCommand, SpectrogramSourceMessage } from './SpectrogramSourceProtocol'
import {
  BASE_HOP,
  FFT_SIZE,
  HALO_COLUMNS,
  MAX_DPR,
  TILE_CACHE_BYTES,
  TILE_COLUMNS,
  getSpectrogramLevel,
  getSpectrogramTileKeys,
  selectSpectrogramCoverage,
  type SpectrogramTileKey,
} from './SpectrogramTiling'

export interface SpectrogramClipPlacement {
  clip: Clip
  timelineStart: number
  sourceStart: number
  length: number
  startFadeLength: number
  endFadeLength: number
}

export interface SpectrogramTrackFrame {
  cssWidth: number
  cssHeight: number
  dpr: number
  timelineStart: number
  samplesPerCssPixel: number
  headerHeight: number
  channelCount: number
  clips: readonly SpectrogramClipPlacement[]
}

export interface SpectrogramTrackRenderer {
  draw(frame: SpectrogramTrackFrame): void
  clear(): void
  destroy(): void
}

interface CachedSpectrogramTile {
  readonly key: SpectrogramTileKey
  readonly gpuTile: SpectrogramGpuTile
  readonly bytes: number
  readonly sourceFrameCount: number
  lastUsed: number
  lastRefreshAt: number
  lastRequestedClipLength: number
  refreshEpoch: number
}

interface TileWorkflow {
  readonly requestId: number
  readonly generation: number
  readonly keyString: string
  readonly key: SpectrogramTileKey
  readonly clip: Clip
  readonly requestedClipLength: number
  readonly refreshEpoch: number
  readonly gpuTile: SpectrogramGpuTile
  readonly firstColumn: number
  readonly hop: number
  readonly resolve: (entry: CachedSpectrogramTile | null) => void
  messageChain: Promise<void>
  settled: boolean
}

interface TileDemand {
  readonly key: SpectrogramTileKey
  readonly clip: Clip
  readonly rank: number
  forceTailRefresh: boolean
}

interface VisiblePlacement {
  readonly placement: SpectrogramClipPlacement
  readonly sourceStart: number
  readonly sourceEnd: number
  readonly timelineStart: number
  readonly timelineEnd: number
  readonly clipStartX: number
  readonly fadeInEndX: number
  readonly fadeOutStartX: number
  readonly clipEndX: number
}

export class SpectrogramService {
  private readonly logger = new Logger('Spectrogram')
  private readonly gpu = new SpectrogramGpu((message) => this.handleDeviceLost(message))
  private readonly cache = new Map<string, CachedSpectrogramTile>()
  private readonly pinnedKeys = new Set<string>()
  private readonly failedKeys = new Set<string>()
  private readonly renderers = new Set<SpectrogramTrackRendererImpl>()
  private worker: Worker | null = null
  private workflow: TileWorkflow | null = null
  private directoryName = ''
  private sampleRate = 0
  private generation = 0
  private nextRequestId = 1
  private cacheBytes = 0
  private useCounter = 0
  private failureLogged = false
  private renderingUnavailable = false
  private queuedDemands = new Array<TileDemand>()
  private processingQueue = false
  private tailRefreshEpoch = 0
  private lastAudioState: AudioState

  constructor() {
    this.lastAudioState = AudioControl.getState()
    AudioControl.addAudioControlListener((state) => {
      if (state === AudioState.STOPPED && this.lastAudioState !== AudioState.STOPPED) {
        this.tailRefreshEpoch++
        this.rebuildQueue()
      }
      this.lastAudioState = state
    })
  }

  setProject(directoryName: string, sampleRate: number): void {
    this.generation++
    this.directoryName = directoryName
    this.sampleRate = sampleRate
    this.tailRefreshEpoch++
    this.queuedDemands = []
    this.failedKeys.clear()
    this.cancelWorkflow()
    this.clearCache()
    this.gpu.updateSampleRateIfInitialized(sampleRate)
    for (const renderer of this.renderers) renderer.projectChanged()
  }

  createTrackRenderer(
    canvas: HTMLCanvasElement,
    onAvailabilityChange: (available: boolean) => void,
  ): SpectrogramTrackRenderer {
    const renderer = new SpectrogramTrackRendererImpl(this, canvas, onAvailabilityChange)
    this.renderers.add(renderer)
    return renderer
  }

  rendererDrew(renderer: SpectrogramTrackRendererImpl): void {
    this.updateRendererDemands(renderer)
    this.renderRenderer(renderer)
    this.rebuildQueue()
  }

  rendererNeedsRedraw(renderer: SpectrogramTrackRendererImpl): void {
    if (!renderer.isActive) return
    this.renderRenderer(renderer)
  }

  rendererCleared(renderer: SpectrogramTrackRendererImpl): void {
    renderer.setDemands([], [])
    this.rebuildQueue()
    const gpuCanvas = renderer.currentGpuCanvas
    if (gpuCanvas !== null && renderer.canvas.width > 0 && renderer.canvas.height > 0) {
      try {
        void this.gpu.render(gpuCanvas, renderer.canvas.width, renderer.canvas.height, [])
      } catch (error) {
        this.handleRenderingFailure(error)
      }
    }
  }

  rendererDestroyed(renderer: SpectrogramTrackRendererImpl): void {
    this.renderers.delete(renderer)
    this.rebuildQueue()
  }

  private updateRendererDemands(renderer: SpectrogramTrackRendererImpl): void {
    const frame = renderer.currentFrame
    if (frame === null || frame.samplesPerCssPixel <= 0 || frame.cssWidth <= 0) {
      renderer.setDemands([], [])
      return
    }

    const targetLevel = getSpectrogramLevel(frame.samplesPerCssPixel, frame.dpr)
    const timelineEnd = frame.timelineStart + frame.cssWidth * frame.samplesPerCssPixel
    const visibleByKey = new Map<string, TileDemand>()
    const marginByKey = new Map<string, TileDemand>()

    for (const placement of frame.clips) {
      const clipId = placement.clip.id
      if (clipId === undefined) continue
      const visibleTimelineStart = Math.max(frame.timelineStart, placement.timelineStart)
      const visibleTimelineEnd = Math.min(timelineEnd, placement.timelineStart + placement.length)
      if (visibleTimelineEnd <= visibleTimelineStart) continue

      const sourceStart = Math.max(
        0,
        placement.sourceStart + visibleTimelineStart - placement.timelineStart,
      )
      const sourceEnd = Math.min(
        placement.clip.length,
        placement.sourceStart + visibleTimelineEnd - placement.timelineStart,
      )
      if (sourceEnd <= sourceStart) continue

      const sourceCenter = (sourceStart + sourceEnd) / 2
      const visibleKeys = getSpectrogramTileKeys(clipId, sourceStart, sourceEnd, targetLevel, 0)
      for (const key of visibleKeys) {
        const tileSpan = BASE_HOP * 2 ** key.level * TILE_COLUMNS
        const rank = Math.abs((key.tileIndex + 0.5) * tileSpan - sourceCenter)
        const keyString = this.getKeyString(key)
        const previous = visibleByKey.get(keyString)
        if (previous === undefined || rank < previous.rank) {
          visibleByKey.set(keyString, { key, clip: placement.clip, rank, forceTailRefresh: false })
        }
      }

      const marginKeys = getSpectrogramTileKeys(clipId, sourceStart, sourceEnd, targetLevel, 1)
      for (const key of marginKeys) {
        const keyString = this.getKeyString(key)
        if (visibleByKey.has(keyString)) continue
        const tileSpan = BASE_HOP * 2 ** key.level * TILE_COLUMNS
        const rank = Math.abs((key.tileIndex + 0.5) * tileSpan - sourceCenter)
        const previous = marginByKey.get(keyString)
        if (previous === undefined || rank < previous.rank) {
          marginByKey.set(keyString, { key, clip: placement.clip, rank, forceTailRefresh: false })
        }
      }
    }

    const byRank = (left: TileDemand, right: TileDemand): number =>
      left.rank - right.rank || left.key.clipId - right.key.clipId || left.key.tileIndex - right.key.tileIndex
    renderer.setDemands([...visibleByKey.values()].sort(byRank), [...marginByKey.values()].sort(byRank))
  }

  private rebuildQueue(): void {
    if (this.renderingUnavailable) {
      this.queuedDemands = []
      return
    }

    const activeRenderers = [...this.renderers].filter((renderer) => renderer.isActive)
    const queued = new Array<TileDemand>()
    const seen = new Set<string>()
    this.appendRoundRobinDemands(activeRenderers, false, queued, seen)
    this.appendRoundRobinDemands(activeRenderers, true, queued, seen)
    this.queuedDemands = queued
    this.processQueue()
  }

  private appendRoundRobinDemands(
    renderers: readonly SpectrogramTrackRendererImpl[],
    margins: boolean,
    output: TileDemand[],
    seen: Set<string>,
  ): void {
    const maximumLength = renderers.reduce(
      (maximum, renderer) => Math.max(maximum, renderer.getDemands(margins).length),
      0,
    )
    for (let rank = 0; rank < maximumLength; rank++) {
      for (const renderer of renderers) {
        const demand = renderer.getDemands(margins)[rank]
        if (demand === undefined) continue
        const keyString = this.getKeyString(demand.key)
        if (seen.has(keyString) || keyString === this.workflow?.keyString || !this.shouldQueueDemand(demand)) continue
        seen.add(keyString)
        output.push(demand)
      }
    }
  }

  private shouldQueueDemand(demand: TileDemand): boolean {
    const keyString = this.getKeyString(demand.key)
    if (this.failedKeys.has(keyString)) return false
    const hop = BASE_HOP * 2 ** demand.key.level
    const ownedStart = demand.key.tileIndex * TILE_COLUMNS * hop
    const ownedEnd = (demand.key.tileIndex + 1) * TILE_COLUMNS * hop
    if (ownedEnd <= 0 || ownedStart >= demand.clip.length) return false
    const entry = this.cache.get(keyString)
    if (entry === undefined) return true
    if (demand.clip.length <= entry.sourceFrameCount) return false

    const firstColumn = demand.key.tileIndex * TILE_COLUMNS - HALO_COLUMNS
    const finalColumn = firstColumn + TILE_COLUMNS + 2 * HALO_COLUMNS - 1
    const firstWindowFrame = firstColumn * hop - FFT_SIZE / 2
    const finalWindowFrame = finalColumn * hop - FFT_SIZE / 2 + FFT_SIZE
    if (finalWindowFrame <= entry.sourceFrameCount || firstWindowFrame >= demand.clip.length) return false

    const stoppedGrowth =
      this.lastAudioState === AudioState.STOPPED && demand.clip.length > entry.lastRequestedClipLength
    demand.forceTailRefresh = entry.refreshEpoch < this.tailRefreshEpoch || stoppedGrowth
    return demand.forceTailRefresh || performance.now() - entry.lastRefreshAt >= 500
  }

  private processQueue(): void {
    if (this.processingQueue) return
    this.processingQueue = true
    void (async () => {
      try {
        while (this.queuedDemands.length > 0) {
          const demand = this.queuedDemands.shift()
          if (demand === undefined || !this.isStillDemanded(demand.key)) continue
          const entry = await this.loadTile(demand.key, demand.clip, demand.forceTailRefresh)
          if (entry !== null) {
            for (const renderer of this.renderers) {
              if (renderer.isActive) renderer.requestRedraw()
            }
          }
          this.rebuildQueueWithoutStartingProcessor()
        }
      } finally {
        this.processingQueue = false
        if (this.queuedDemands.length > 0) this.processQueue()
      }
    })()
  }

  private rebuildQueueWithoutStartingProcessor(): void {
    if (this.renderingUnavailable) {
      this.queuedDemands = []
      return
    }
    const activeRenderers = [...this.renderers].filter((renderer) => renderer.isActive)
    const queued = new Array<TileDemand>()
    const seen = new Set<string>()
    this.appendRoundRobinDemands(activeRenderers, false, queued, seen)
    this.appendRoundRobinDemands(activeRenderers, true, queued, seen)
    this.queuedDemands = queued
  }

  private isStillDemanded(key: SpectrogramTileKey): boolean {
    const keyString = this.getKeyString(key)
    for (const renderer of this.renderers) {
      if (renderer.isActive && renderer.hasDemand(keyString)) return true
    }
    return false
  }

  private renderRenderer(renderer: SpectrogramTrackRendererImpl): void {
    const frame = renderer.currentFrame
    if (frame === null || !renderer.isActive || this.renderingUnavailable) return
    const renderDpr = Math.min(MAX_DPR, Math.max(1, frame.dpr))
    const width = Math.max(1, Math.floor(frame.cssWidth * renderDpr))
    const height = Math.max(1, Math.floor(frame.cssHeight * renderDpr))
    if (renderer.canvas.width !== width) renderer.canvas.width = width
    if (renderer.canvas.height !== height) renderer.canvas.height = height

    const gpuCanvas = renderer.currentGpuCanvas
    if (gpuCanvas === null) {
      this.prepareRendererCanvas(renderer)
      return
    }

    try {
      const draws = this.buildDraws(frame, renderDpr)
      const submitted = this.gpu.render(gpuCanvas, width, height, draws)
      this.releaseFramePins()
      renderer.frameSubmitted(submitted)
      void submitted.catch((error: unknown) => this.handleRenderingFailure(error))
    } catch (error) {
      this.releaseFramePins()
      this.handleRenderingFailure(error)
    }
  }

  private prepareRendererCanvas(renderer: SpectrogramTrackRendererImpl): void {
    if (renderer.isPreparingCanvas || this.renderingUnavailable) return
    renderer.isPreparingCanvas = true
    void this.gpu.prepareCanvas(renderer.canvas, this.sampleRate).then(
      (gpuCanvas) => {
        renderer.isPreparingCanvas = false
        if (renderer.isDestroyed) {
          gpuCanvas.context.unconfigure()
          return
        }
        renderer.setGpuCanvas(gpuCanvas)
        if (renderer.isActive) this.renderRenderer(renderer)
      },
      (error: unknown) => {
        renderer.isPreparingCanvas = false
        this.handleRenderingFailure(error)
      },
    )
  }

  private buildDraws(frame: SpectrogramTrackFrame, dpr: number): SpectrogramGpuDraw[] {
    const targetLevel = getSpectrogramLevel(frame.samplesPerCssPixel, frame.dpr)
    const visiblePlacements = this.getVisiblePlacements(frame, dpr)
    const backgroundDraws = new Array<SpectrogramGpuDraw>()
    const coverageDraws = new Array<SpectrogramGpuDraw>()
    const bodyHeight = Math.max(0, (frame.cssHeight - frame.headerHeight) * dpr)
    const channelHeight = frame.channelCount > 0 ? bodyHeight / frame.channelCount : 0

    for (const visible of visiblePlacements) {
      const rectangleX = (visible.timelineStart - frame.timelineStart) / frame.samplesPerCssPixel * dpr
      const rectangleEndX = (visible.timelineEnd - frame.timelineStart) / frame.samplesPerCssPixel * dpr
      for (let channel = 0; channel < frame.channelCount; channel++) {
        backgroundDraws.push({
          rectangleX,
          rectangleY: frame.headerHeight * dpr + channel * channelHeight,
          rectangleWidth: rectangleEndX - rectangleX,
          rectangleHeight: channelHeight,
          textureStartX: 0,
          textureEndX: 0,
          fadeStartX: visible.clipStartX,
          fadeInEndX: visible.fadeInEndX,
          fadeOutStartX: visible.fadeOutStartX,
          fadeEndX: visible.clipEndX,
          textureView: null,
        })
      }
    }

    for (const visible of visiblePlacements) {
      const clipId = visible.placement.clip.id
      if (clipId === undefined) continue
      const readyKeys = this.getReadyKeys(clipId)
      const coverage = selectSpectrogramCoverage(
        readyKeys,
        clipId,
        visible.sourceStart,
        visible.sourceEnd,
        targetLevel,
      )
      for (const segment of coverage) {
        const entry = this.getCachedTile(segment.key)
        if (entry === null) continue
        this.pinTile(segment.key)
        const hop = BASE_HOP * 2 ** segment.key.level
        const ownedFirstColumn = segment.key.tileIndex * TILE_COLUMNS
        const textureStartX =
          (segment.sourceStart / hop - ownedFirstColumn + HALO_COLUMNS + 0.5) / SPECTROGRAM_TEXTURE_COLUMNS
        const textureEndX =
          (segment.sourceEnd / hop - ownedFirstColumn + HALO_COLUMNS + 0.5) / SPECTROGRAM_TEXTURE_COLUMNS
        const segmentTimelineStart =
          visible.placement.timelineStart + segment.sourceStart - visible.placement.sourceStart
        const segmentTimelineEnd =
          visible.placement.timelineStart + segment.sourceEnd - visible.placement.sourceStart
        const rectangleX = (segmentTimelineStart - frame.timelineStart) / frame.samplesPerCssPixel * dpr
        const rectangleEndX = (segmentTimelineEnd - frame.timelineStart) / frame.samplesPerCssPixel * dpr
        const channelCount = Math.min(frame.channelCount, entry.gpuTile.channelCount)
        for (let channel = 0; channel < channelCount; channel++) {
          coverageDraws.push({
            rectangleX,
            rectangleY: frame.headerHeight * dpr + channel * channelHeight,
            rectangleWidth: rectangleEndX - rectangleX,
            rectangleHeight: channelHeight,
            textureStartX,
            textureEndX,
            fadeStartX: visible.clipStartX,
            fadeInEndX: visible.fadeInEndX,
            fadeOutStartX: visible.fadeOutStartX,
            fadeEndX: visible.clipEndX,
            textureView: entry.gpuTile.channelViews[channel],
          })
        }
      }
    }

    return backgroundDraws.concat(coverageDraws)
  }

  private getVisiblePlacements(frame: SpectrogramTrackFrame, dpr: number): VisiblePlacement[] {
    const timelineEnd = frame.timelineStart + frame.cssWidth * frame.samplesPerCssPixel
    const visible = new Array<VisiblePlacement>()
    for (const placement of frame.clips) {
      const placementEnd = placement.timelineStart + placement.length
      let visibleTimelineStart = Math.max(frame.timelineStart, placement.timelineStart)
      let visibleTimelineEnd = Math.min(timelineEnd, placementEnd)
      if (visibleTimelineEnd <= visibleTimelineStart) continue

      let sourceStart = placement.sourceStart + visibleTimelineStart - placement.timelineStart
      let sourceEnd = placement.sourceStart + visibleTimelineEnd - placement.timelineStart
      if (sourceStart < 0) {
        visibleTimelineStart -= sourceStart
        sourceStart = 0
      }
      if (sourceEnd > placement.clip.length) {
        visibleTimelineEnd -= sourceEnd - placement.clip.length
        sourceEnd = placement.clip.length
      }
      if (sourceEnd <= sourceStart || visibleTimelineEnd <= visibleTimelineStart) continue

      const clipStartX = (placement.timelineStart - frame.timelineStart) / frame.samplesPerCssPixel * dpr
      const clipEndX = (placementEnd - frame.timelineStart) / frame.samplesPerCssPixel * dpr
      visible.push({
        placement,
        sourceStart,
        sourceEnd,
        timelineStart: visibleTimelineStart,
        timelineEnd: visibleTimelineEnd,
        clipStartX,
        fadeInEndX: clipStartX + placement.startFadeLength / frame.samplesPerCssPixel * dpr,
        fadeOutStartX: clipEndX - placement.endFadeLength / frame.samplesPerCssPixel * dpr,
        clipEndX,
      })
    }
    return visible
  }

  private getCachedTile(key: SpectrogramTileKey): CachedSpectrogramTile | null {
    const entry = this.cache.get(this.getKeyString(key)) ?? null
    if (entry !== null) entry.lastUsed = ++this.useCounter
    return entry
  }

  private getReadyKeys(clipId: number): SpectrogramTileKey[] {
    const keys = new Array<SpectrogramTileKey>()
    for (const entry of this.cache.values()) {
      if (entry.key.clipId === clipId) keys.push(entry.key)
    }
    return keys
  }

  private async loadTile(
    key: SpectrogramTileKey,
    clip: Clip,
    forceTailRefresh: boolean,
  ): Promise<CachedSpectrogramTile | null> {
    if (this.workflow !== null) throw new Error('SpectrogramService supports one source workflow at a time')
    if (this.sampleRate <= 0 || this.directoryName.length === 0) return null

    const keyString = this.getKeyString(key)
    const existing = this.cache.get(keyString) ?? null
    const hop = BASE_HOP * 2 ** key.level
    const ownedStart = key.tileIndex * TILE_COLUMNS * hop
    const ownedEnd = (key.tileIndex + 1) * TILE_COLUMNS * hop
    if (ownedEnd <= 0 || ownedStart >= clip.length) return existing

    const now = performance.now()
    if (
      existing !== null &&
      clip.length > existing.sourceFrameCount &&
      !forceTailRefresh &&
      now - existing.lastRefreshAt < 500
    ) {
      existing.lastUsed = ++this.useCounter
      return existing
    }

    try {
      const [file] = await Promise.all([
        FileSystemUtils.getFileHandle(this.directoryName, clip.filename).then((handle) => handle.getFile()),
        this.gpu.ensureAvailable(this.sampleRate),
      ])
      const sourceChannelCount = clip.getChannelCount()
      const fileFrameCount = Math.floor(file.size / (sourceChannelCount * Float32Array.BYTES_PER_ELEMENT))
      const sourceFrameCount = Math.max(0, Math.min(fileFrameCount, Math.floor(clip.length)))
      const firstColumn = key.tileIndex * TILE_COLUMNS - HALO_COLUMNS
      const finalColumn = firstColumn + TILE_COLUMNS + 2 * HALO_COLUMNS - 1
      const firstWindowFrame = firstColumn * hop - FFT_SIZE / 2
      const finalWindowFrame = finalColumn * hop - FFT_SIZE / 2 + FFT_SIZE

      if (existing !== null) {
        existing.lastRefreshAt = now
        existing.lastRequestedClipLength = clip.length
        existing.refreshEpoch = this.tailRefreshEpoch
        const newlyAvailableFramesCrossTile =
          sourceFrameCount > existing.sourceFrameCount &&
          finalWindowFrame > existing.sourceFrameCount &&
          firstWindowFrame < sourceFrameCount
        if (!newlyAvailableFramesCrossTile) {
          existing.lastUsed = ++this.useCounter
          return existing
        }
      }

      const worker = this.ensureWorker()
      const gpuTile = this.gpu.createTile(sourceChannelCount)
      const requestId = this.nextRequestId++
      return await new Promise<CachedSpectrogramTile | null>((resolve) => {
        const workflow: TileWorkflow = {
          requestId,
          generation: this.generation,
          keyString,
          key,
          clip,
          requestedClipLength: clip.length,
          refreshEpoch: this.tailRefreshEpoch,
          gpuTile,
          firstColumn,
          hop,
          resolve,
          messageChain: Promise.resolve(),
          settled: false,
        }
        this.workflow = workflow
        const command: SpectrogramSourceCommand = {
          type: 'load',
          requestId,
          file,
          clipLength: clip.length,
          sourceChannelCount,
          hop,
          firstColumn,
          columnCount: TILE_COLUMNS + 2 * HALO_COLUMNS,
        }
        try {
          worker.postMessage(command)
        } catch (error) {
          this.failWorkflow(workflow, error)
        }
      })
    } catch (error) {
      this.failedKeys.add(keyString)
      this.logFailure(error)
      return existing
    }
  }

  private pinTile(key: SpectrogramTileKey): void {
    this.pinnedKeys.add(this.getKeyString(key))
  }

  private releaseFramePins(): void {
    this.pinnedKeys.clear()
    this.evictIfNeeded()
  }

  private ensureWorker(): Worker {
    if (this.worker !== null) return this.worker
    const worker = new Worker(new URL('./SpectrogramSourceWorker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<SpectrogramSourceMessage>) => {
      const workflow = this.workflow
      if (workflow === null || event.data.requestId !== workflow.requestId) return
      workflow.messageChain = workflow.messageChain
        .then(() => this.handleSourceMessage(workflow, event.data))
        .catch((error: unknown) => this.failWorkflow(workflow, error))
    })
    worker.addEventListener('error', (event) => {
      const workflow = this.workflow
      if (workflow !== null) this.failWorkflow(workflow, event.error ?? new Error(event.message))
    })
    worker.addEventListener('messageerror', () => {
      const workflow = this.workflow
      if (workflow !== null) this.failWorkflow(workflow, new Error('Invalid spectrogram source-worker message'))
    })
    this.worker = worker
    return worker
  }

  private async handleSourceMessage(workflow: TileWorkflow, message: SpectrogramSourceMessage): Promise<void> {
    if (workflow.settled || this.workflow !== workflow) return
    if (message.type === 'error') {
      this.failWorkflow(workflow, new Error(message.message))
      return
    }
    if (message.type === 'source-batch') {
      this.gpu.processSourceBatch(workflow.gpuTile, message, workflow.firstColumn, workflow.hop)
      if (
        message.layout === 'packed-windows' &&
        message.firstChannel + message.batchChannelCount < workflow.gpuTile.channelCount
      ) {
        const command: SpectrogramSourceCommand = {
          type: 'continue',
          requestId: workflow.requestId,
          reusableBuffer: message.data,
        }
        this.ensureWorker().postMessage(command, [message.data])
      }
      return
    }

    if (workflow.generation !== this.generation) {
      this.finishCanceledWorkflow(workflow)
      return
    }

    const entry: CachedSpectrogramTile = {
      key: workflow.key,
      gpuTile: workflow.gpuTile,
      bytes: SPECTROGRAM_TILE_BYTES_PER_CHANNEL * workflow.gpuTile.channelCount,
      sourceFrameCount: message.sourceFrameCount,
      lastUsed: ++this.useCounter,
      lastRefreshAt: performance.now(),
      lastRequestedClipLength: workflow.requestedClipLength,
      refreshEpoch: workflow.refreshEpoch,
    }
    const replaced = this.cache.get(workflow.keyString)
    this.cache.set(workflow.keyString, entry)
    this.cacheBytes += entry.bytes - (replaced?.bytes ?? 0)
    workflow.settled = true
    this.workflow = null
    workflow.resolve(entry)
    if (replaced !== undefined) this.destroyTileAfterSubmittedWork(replaced.gpuTile)
    this.evictIfNeeded()
  }

  private failWorkflow(workflow: TileWorkflow, error: unknown): void {
    if (workflow.settled) return
    workflow.settled = true
    if (this.workflow === workflow) this.workflow = null
    const cancel: SpectrogramSourceCommand = { type: 'cancel', requestId: workflow.requestId }
    this.worker?.postMessage(cancel)
    this.gpu.destroyTile(workflow.gpuTile)
    this.failedKeys.add(workflow.keyString)
    workflow.resolve(this.cache.get(workflow.keyString) ?? null)
    this.logFailure(error)
  }

  private finishCanceledWorkflow(workflow: TileWorkflow): void {
    if (workflow.settled) return
    workflow.settled = true
    if (this.workflow === workflow) this.workflow = null
    this.gpu.destroyTile(workflow.gpuTile)
    workflow.resolve(null)
  }

  private cancelWorkflow(): void {
    const workflow = this.workflow
    if (workflow === null) return
    const command: SpectrogramSourceCommand = { type: 'cancel', requestId: workflow.requestId }
    this.worker?.postMessage(command)
    this.finishCanceledWorkflow(workflow)
  }

  private getKeyString(key: SpectrogramTileKey): string {
    return `${key.clipId}:${key.level}:${key.tileIndex}`
  }

  private evictIfNeeded(): void {
    if (this.cacheBytes <= TILE_CACHE_BYTES) return
    const candidates = [...this.cache.entries()]
      .filter(([key]) => !this.pinnedKeys.has(key) && key !== this.workflow?.keyString)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)

    for (const [key, entry] of candidates) {
      if (this.cacheBytes <= TILE_CACHE_BYTES) break
      this.cache.delete(key)
      this.cacheBytes -= entry.bytes
      this.destroyTileAfterSubmittedWork(entry.gpuTile)
    }
  }

  private clearCache(): void {
    const entries = [...this.cache.values()]
    this.cache.clear()
    this.cacheBytes = 0
    this.pinnedKeys.clear()
    for (const entry of entries) this.destroyTileAfterSubmittedWork(entry.gpuTile)
  }

  private destroyTileAfterSubmittedWork(tile: SpectrogramGpuTile): void {
    void this.gpu.submittedWorkDone().then(
      () => this.gpu.destroyTile(tile),
      () => this.gpu.destroyTile(tile),
    )
  }

  private handleRenderingFailure(error: unknown): void {
    this.renderingUnavailable = true
    this.queuedDemands = []
    for (const renderer of this.renderers) renderer.renderingFailed()
    this.logFailure(error)
  }

  private handleDeviceLost(message: string): void {
    this.cache.clear()
    this.cacheBytes = 0
    this.pinnedKeys.clear()
    this.failedKeys.clear()
    this.renderingUnavailable = false
    this.cancelWorkflow()
    for (const renderer of this.renderers) renderer.deviceLost()
    this.logFailure(new Error(message))
    this.rebuildQueue()
  }

  private logFailure(error: unknown): void {
    if (this.failureLogged) return
    this.failureLogged = true
    this.logger.errorMessage(error instanceof Error ? error.message : String(error))
  }
}

class SpectrogramTrackRendererImpl implements SpectrogramTrackRenderer {
  private frame: SpectrogramTrackFrame | null = null
  private gpuCanvas: SpectrogramGpuCanvas | null = null
  private visibleDemands = new Array<TileDemand>()
  private marginDemands = new Array<TileDemand>()
  private active = false
  private destroyed = false
  private completedFrame = false
  private handoffPending = false
  private handoffGeneration = 0
  private redrawFrame = 0
  isPreparingCanvas = false

  constructor(
    private readonly service: SpectrogramService,
    readonly canvas: HTMLCanvasElement,
    private readonly onAvailabilityChange: (available: boolean) => void,
  ) {
    this.onAvailabilityChange(false)
  }

  get currentFrame(): SpectrogramTrackFrame | null {
    return this.frame
  }

  get currentGpuCanvas(): SpectrogramGpuCanvas | null {
    return this.gpuCanvas
  }

  get isActive(): boolean {
    return this.active
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  draw(frame: SpectrogramTrackFrame): void {
    if (this.destroyed) return
    this.frame = frame
    this.active = true
    this.service.rendererDrew(this)
  }

  clear(): void {
    if (this.destroyed) return
    this.active = false
    this.frame = null
    this.handoffGeneration++
    this.handoffPending = false
    if (this.redrawFrame !== 0) cancelAnimationFrame(this.redrawFrame)
    this.redrawFrame = 0
    this.onAvailabilityChange(false)
    this.service.rendererCleared(this)
  }

  destroy(): void {
    if (this.destroyed) return
    this.clear()
    this.destroyed = true
    this.gpuCanvas?.context.unconfigure()
    this.gpuCanvas = null
    this.service.rendererDestroyed(this)
  }

  setDemands(visible: TileDemand[], margins: TileDemand[]): void {
    this.visibleDemands = visible
    this.marginDemands = margins
  }

  getDemands(margins: boolean): readonly TileDemand[] {
    return margins ? this.marginDemands : this.visibleDemands
  }

  hasDemand(keyString: string): boolean {
    return (
      this.visibleDemands.some(
        (demand) => `${demand.key.clipId}:${demand.key.level}:${demand.key.tileIndex}` === keyString,
      ) ||
      this.marginDemands.some(
        (demand) => `${demand.key.clipId}:${demand.key.level}:${demand.key.tileIndex}` === keyString,
      )
    )
  }

  setGpuCanvas(gpuCanvas: SpectrogramGpuCanvas): void {
    this.gpuCanvas = gpuCanvas
  }

  requestRedraw(): void {
    if (!this.active || this.destroyed || this.redrawFrame !== 0) return
    this.redrawFrame = requestAnimationFrame(() => {
      this.redrawFrame = 0
      this.service.rendererNeedsRedraw(this)
    })
  }

  frameSubmitted(completion: Promise<void>): void {
    if (this.completedFrame) {
      this.onAvailabilityChange(true)
      return
    }
    if (this.handoffPending) return
    this.handoffPending = true
    const generation = this.handoffGeneration
    void completion.then(
      () => {
        requestAnimationFrame(() => {
          if (!this.active || this.destroyed || generation !== this.handoffGeneration) return
          this.handoffPending = false
          this.completedFrame = true
          this.onAvailabilityChange(true)
        })
      },
      () => {
        if (generation === this.handoffGeneration) this.handoffPending = false
      },
    )
  }

  projectChanged(): void {
    this.visibleDemands = []
    this.marginDemands = []
    this.handoffGeneration++
    this.handoffPending = false
  }

  renderingFailed(): void {
    this.handoffGeneration++
    this.handoffPending = false
    this.onAvailabilityChange(false)
  }

  deviceLost(): void {
    this.gpuCanvas?.context.unconfigure()
    this.gpuCanvas = null
    this.isPreparingCanvas = false
    this.completedFrame = false
    this.renderingFailed()
    if (this.active) this.requestRedraw()
  }
}

