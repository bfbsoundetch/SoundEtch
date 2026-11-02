import { AudioControl, AudioState } from '../../audiocontext/AudioControl'
import { TimeUtils } from '../../global/TimeUtils'
import type { Project } from '../../project/Project'
import { ProjectManager } from '../../project/ProjectManager'
import { OutputBus } from '../../project/OutputBus'
import { getOutputSceneIndex, getOutputTransition, moveOutputSceneBoundary } from '../../project/OutputScene'
import type { OutputScene } from '../../project/OutputScene'
import { EffectPanelController } from '../effects/EffectPanelController'
import { NotificationsController } from '../NotificationsController'
import { SetOutputScenesCommand } from '../undo/SetOutputScenesCommand'
import type { OutputPanelController } from '../OutputPanelController'
import type { TrackListController } from './TrackListController'
import { stepTimelinePosition } from './TimelineKeyboardSteps'
import { getOutputTransitionWindow, OUTPUT_TRANSITION_LABELS } from '../../video/OutputTransition'

interface OutputTimelineWindow extends Window {
  readonly outputPanelController?: OutputPanelController
}

type BoundaryDrag = {
  project: Project
  before: readonly OutputScene[]
  preview: readonly OutputScene[]
  index: number
  length: number
  pointerId: number
  clientX: number
  offset: number
  sample: number
}

const cancelledBoundaryEdit = new Error('The output scene boundary is no longer editable.')

/** Scene boundaries own their drag gestures; seeking uses the shared PointerStateManager. */
export class OutputTimelineController {
  /** The Output row's header in the timeline's information column. */
  readonly infoElement = document.getElementById('timeline-output-info')!
  private readonly effectsButton = document.getElementById('timeline-output-effects')!
  private readonly lane = document.querySelector<HTMLElement>('.timeline-output-lane')!
  private readonly automationSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  private automating = false
  private readonly blocks: HTMLElement[] = []
  private readonly boundaries: HTMLElement[] = []
  /** One per boundary: where its transition plays, if any. */
  private readonly transitionBands: HTMLElement[] = []
  private drag: BoundaryDrag | null = null
  private editing = false
  private renderedDrag: BoundaryDrag | null = null
  private renderedEditable = false
  private project: Project | null = null
  private renderedScenes: readonly OutputScene[] | null = null
  private renderedScale = NaN
  private renderedTranslation = NaN
  private renderedWidth = 0
  private renderedLength = 0
  private activeIndex = -1
  private renderedSample = NaN

  constructor(private readonly timeline: TrackListController) {
    this.lane.tabIndex = 0
    this.lane.setAttribute('role', 'group')
    this.lane.setAttribute('aria-label', 'Output scenes timeline')
    this.lane.setAttribute(
      'aria-description',
      'Click to move the position marker and open Output. Drag a scene boundary to resize; collapse a scene to remove it. Arrow keys move by a ruler tick; Enter opens Output.',
    )
    this.lane.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary || this.automating) return
      const boundary =
        event.target instanceof Element ? event.target.closest<HTMLElement>('.output-scene-boundary') : null
      if (boundary) {
        this.startBoundaryDrag(event, Number(boundary.dataset.sceneBoundary), boundary)
        return
      }
      event.preventDefault()
      this.lane.focus({ preventScroll: true })
      this.showPanel()
    })
    this.lane.addEventListener('keydown', (event) => this.handleKeyDown(event))
    this.lane.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.drag?.pointerId) return
      event.stopPropagation()
      this.drag.clientX = event.clientX
      this.draw()
    })
    this.lane.addEventListener('pointerup', (event) => {
      const drag = this.drag
      if (!drag || event.pointerId !== drag.pointerId) return
      event.stopPropagation()
      drag.clientX = event.clientX
      this.draw()
      if (this.drag !== drag) return
      this.clearBoundaryDrag()
      void this.commitBoundaryEdit(drag.project, drag.before, drag.preview)
    })
    for (const name of ['pointercancel', 'lostpointercapture'] as const) {
      this.lane.addEventListener(name, (event) => {
        if (event.pointerId !== this.drag?.pointerId) return
        event.stopPropagation()
        this.clearBoundaryDrag()
        this.draw()
      })
    }
    window.addEventListener('blur', () => {
      this.clearBoundaryDrag()
      this.draw()
    })
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.drag) return
      event.preventDefault()
      event.stopPropagation()
      this.clearBoundaryDrag()
      this.draw()
    })
    AudioControl.addAudioControlListener(() => {
      if (!this.timeline.canEdit()) {
        this.clearBoundaryDrag()
        this.draw()
      }
    })
    void ProjectManager.addProjectListener((project) => {
      this.project = project
      this.renderedScenes = null
      this.updateEffectsButton()
      this.draw()
    })
    // Output effect edits are saved without notifying project listeners.
    this.timeline.history.addChangeListener(() => this.updateEffectsButton())
    this.effectsButton.addEventListener('click', () => {
      if (this.project) void EffectPanelController.getInstance().showEffectsList(OutputBus.of(this.project))
    })
    this.automationSvg.classList.add('output-automation')
  }

  private updateEffectsButton(): void {
    const effectCount = this.project?.outputEffects.length ?? 0
    this.effectsButton.textContent = 'Effects' + (effectCount > 0 ? ` (${effectCount})` : '')
  }

  draw(sample = this.currentSample()): void {
    const project = this.project
    if (!project || !Number.isFinite(this.timeline.sampleScale) || this.timeline.sampleScale <= 0) return
    if (this.drag && !this.isDragValid(this.drag)) this.clearBoundaryDrag()
    if (this.drag) this.updateBoundaryPreview(this.drag)
    const scenes = this.getScenes(project)
    const length = Math.max(0, project.getLength())
    const width = this.lane.clientWidth
    const geometryChanged =
      this.renderedScenes !== scenes ||
      this.renderedScale !== this.timeline.sampleScale ||
      this.renderedTranslation !== this.timeline.translation ||
      this.renderedWidth !== width ||
      this.renderedLength !== length
    const active = getOutputSceneIndex(scenes, sample)
    if (geometryChanged) {
      while (this.blocks.length > scenes.length) this.blocks.pop()!.remove()
      for (let index = 0; index < scenes.length; ++index) {
        const scene = scenes[index]
        let block = this.blocks[index]
        if (!block) {
          block = document.createElement('div')
          block.className = 'output-scene-block'
          block.setAttribute('aria-hidden', 'true')
          this.lane.appendChild(block)
          this.blocks.push(block)
        }
        const start = scene.startSample / this.timeline.sampleScale - this.timeline.translation
        const end = (scenes[index + 1]?.startSample ?? length) / this.timeline.sampleScale - this.timeline.translation
        const left = Math.max(0, start)
        const right = Math.min(width, end)
        block.hidden = right <= left
        block.style.left = `${left}px`
        block.style.width = `${Math.max(0, right - left)}px`
        block.textContent = `Scene ${index + 1} · ${scene.layout === 'single' ? 'One video' : 'Side by side'} · ${scene.fit === 'contain' ? 'Fit' : 'Crop'}`
        block.classList.toggle('is-active', index === active)
      }
      while (this.transitionBands.length > Math.max(0, scenes.length - 1)) this.transitionBands.pop()!.remove()
      for (let index = 1; index < scenes.length; ++index) {
        let band = this.transitionBands[index - 1]
        if (!band) {
          band = document.createElement('div')
          band.className = 'output-scene-transition'
          band.setAttribute('aria-hidden', 'true')
          this.lane.appendChild(band)
          this.transitionBands.push(band)
        }
        const span = getOutputTransitionWindow(scenes, index, project.sampleRate, length)
        const left = span ? Math.max(0, span.start / this.timeline.sampleScale - this.timeline.translation) : 0
        const right = span ? Math.min(width, span.end / this.timeline.sampleScale - this.timeline.translation) : 0
        band.hidden = right <= left
        band.style.left = `${left}px`
        band.style.width = `${Math.max(0, right - left)}px`
      }
      this.renderedScenes = scenes
      this.renderedScale = this.timeline.sampleScale
      this.renderedTranslation = this.timeline.translation
      this.renderedWidth = width
      this.renderedLength = length
    } else if (active !== this.activeIndex) {
      this.blocks[this.activeIndex]?.classList.remove('is-active')
      this.blocks[active]?.classList.add('is-active')
    }
    const editable = this.timeline.canEdit() && !this.editing
    if (geometryChanged || this.renderedDrag !== this.drag || this.renderedEditable !== editable) {
      const original = this.drag?.before ?? scenes
      const count = Math.max(0, original.length - 1)
      while (this.boundaries.length > count) this.boundaries.pop()!.remove()
      for (let index = 1; index < original.length; ++index) {
        let boundary = this.boundaries[index - 1]
        if (!boundary) {
          boundary = document.createElement('div')
          boundary.className = 'output-scene-boundary'
          boundary.setAttribute('role', 'slider')
          boundary.setAttribute('aria-orientation', 'horizontal')
          boundary.setAttribute(
            'aria-description',
            'Drag or use arrow keys to move this boundary. Home or End collapses the adjacent scene; Escape cancels a drag.',
          )
          this.lane.appendChild(boundary)
          this.boundaries.push(boundary)
        }
        const position = this.drag?.index === index ? this.drag.sample : original[index].startSample
        const x = position / this.timeline.sampleScale - this.timeline.translation
        boundary.hidden = x < 0 || x > width || position > length
        boundary.style.left = `${x}px`
        boundary.dataset.sceneBoundary = String(index)
        boundary.tabIndex = editable ? 0 : -1
        boundary.setAttribute('aria-disabled', String(!editable))
        const transition = getOutputTransition(original, index)
        boundary.setAttribute(
          'aria-label',
          `Boundary between scenes ${index} and ${index + 1}` +
            (transition ? `, ${OUTPUT_TRANSITION_LABELS[transition.kind]} transition` : ''),
        )
        boundary.setAttribute('aria-valuemin', String(original[index - 1].startSample))
        boundary.setAttribute('aria-valuemax', String(Math.min(original[index + 1]?.startSample ?? length, length)))
        boundary.setAttribute('aria-valuenow', String(position))
        boundary.setAttribute('aria-valuetext', TimeUtils.positionToString(position, project.sampleRate, true))
        boundary.classList.toggle('is-dragging', this.drag?.index === index)
      }
      this.renderedDrag = this.drag
      this.renderedEditable = editable
    }
    if (sample !== this.renderedSample || active !== this.activeIndex || geometryChanged) {
      this.lane.setAttribute(
        'aria-description',
        `Scene ${active + 1}, ${TimeUtils.positionToString(sample, project.sampleRate, true)}. Click to move the position marker and open Output. Drag boundaries to resize scenes; collapse a scene to remove it. Arrow keys move the marker; Enter opens Output.`,
      )
      this.renderedSample = sample
    }
    this.activeIndex = active
  }

  get isEditing(): boolean {
    return this.drag !== null || this.editing
  }

  /** Covers the lane with a surface for an AutomationController until `stopAutomation`. */
  startAutomation(): SVGSVGElement {
    this.clearBoundaryDrag()
    this.automating = true
    this.infoElement.classList.add('is-automating')
    this.lane.classList.add('is-automating')
    this.lane.appendChild(this.automationSvg)
    this.sizeAutomation()
    return this.automationSvg
  }

  stopAutomation(): void {
    this.automating = false
    this.infoElement.classList.remove('is-automating')
    this.lane.classList.remove('is-automating')
    this.automationSvg.remove()
  }

  /** Keeps the automation surface's units equal to the lane's CSS pixels. */
  sizeAutomation(): void {
    if (this.automating) {
      this.automationSvg.setAttribute('viewBox', `0 0 ${this.lane.clientWidth} ${this.lane.clientHeight}`)
    }
  }

  /** Dims and disables the Output row while a track's automation is edited. */
  setDimmed(dimmed: boolean): void {
    for (const element of [this.infoElement, this.lane]) {
      element.inert = dimmed
      element.classList.toggle('automation-dimmed', dimmed)
    }
  }

  /** A drag previews scenes without exposing uncommitted edits to persistence or export. */
  getScenes(project: Project): readonly OutputScene[] {
    return this.drag?.project === project && this.isDragValid(this.drag) ? this.drag.preview : project.outputScenes
  }

  private isDragValid(drag: BoundaryDrag): boolean {
    return (
      this.project === drag.project &&
      drag.project.outputScenes === drag.before &&
      drag.project.getLength() === drag.length &&
      this.timeline.canEdit()
    )
  }

  private sampleAt(clientX: number): number {
    return (clientX - this.lane.getBoundingClientRect().left + this.timeline.translation) * this.timeline.sampleScale
  }

  private startBoundaryDrag(event: PointerEvent, index: number, boundary: HTMLElement): void {
    event.preventDefault()
    event.stopPropagation()
    const project = this.project
    if (!project || !this.timeline.canEdit() || this.isEditing || index <= 0 || index >= project.outputScenes.length)
      return
    const before = project.outputScenes
    const sample = before[index].startSample
    this.drag = {
      project,
      before,
      preview: before,
      index,
      length: project.getLength(),
      pointerId: event.pointerId,
      clientX: event.clientX,
      offset: sample - this.sampleAt(event.clientX),
      sample,
    }
    this.lane.setPointerCapture(event.pointerId)
    this.lane.classList.add('is-resizing-scene')
    this.showPanel()
    boundary.focus({ preventScroll: true })
    this.draw()
  }

  private updateBoundaryPreview(drag: BoundaryDrag): void {
    const minimum = drag.before[drag.index - 1].startSample
    const maximum = Math.min(drag.before[drag.index + 1]?.startSample ?? drag.length, drag.length)
    const raw = Math.round(this.sampleAt(drag.clientX) + drag.offset)
    if (raw === drag.sample) return
    let sample = Math.max(minimum, Math.min(maximum, raw))
    // A visually collapsed scene must not survive as a few subpixel audio samples.
    const nearest = sample - minimum <= maximum - sample ? minimum : maximum
    if (Math.abs(sample - nearest) <= 3 * this.timeline.sampleScale) sample = nearest
    if (sample === drag.sample) return
    drag.sample = sample
    drag.preview = moveOutputSceneBoundary(drag.before, drag.index, sample, drag.length) ?? drag.before
  }

  private clearBoundaryDrag(): void {
    const drag = this.drag
    if (!drag) return
    this.drag = null
    this.lane.classList.remove('is-resizing-scene')
    if (this.lane.hasPointerCapture(drag.pointerId)) this.lane.releasePointerCapture(drag.pointerId)
  }

  private async commitBoundaryEdit(
    project: Project,
    before: readonly OutputScene[],
    after: readonly OutputScene[],
  ): Promise<void> {
    if (after === before) {
      this.draw()
      return
    }
    const length = project.getLength()
    this.editing = true
    this.draw()
    const description = after.length < before.length ? 'remove output scene' : 'move output scene boundary'
    let command: SetOutputScenesCommand | null = null
    try {
      const action = {
        perform: async () => {
          if ((await ProjectManager.getActiveProject()) !== project || !this.timeline.canEdit())
            throw cancelledBoundaryEdit
          if (!command) {
            if (project.outputScenes !== before || project.getLength() !== length) throw cancelledBoundaryEdit
            command = new SetOutputScenesCommand(project, before, after, description)
          }
          await command.perform()
        },
        undo: async () => {
          await command!.undo()
        },
        save: async () => {
          await command!.save()
        },
        toString: () => description,
      }
      await this.timeline.history.execute(action)
    } catch (error) {
      if (error !== cancelledBoundaryEdit)
        NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.editing = false
      this.draw()
    }
  }

  private handleBoundaryKeyDown(event: KeyboardEvent, index: number): void {
    const project = this.project
    if (!project || this.isEditing) return
    const scenes = project.outputScenes
    const sample = scenes[index]?.startSample
    if (index <= 0 || sample === undefined) return
    const { minor, major } = this.timeline.timelineController.getKeyboardSteps()
    let next: number
    switch (event.key) {
      case 'ArrowLeft':
        next = stepTimelinePosition(sample, minor, -1)
        break
      case 'ArrowRight':
        next = stepTimelinePosition(sample, minor, 1)
        break
      case 'PageDown':
        next = stepTimelinePosition(sample, major, -1)
        break
      case 'PageUp':
        next = stepTimelinePosition(sample, major, 1)
        break
      case 'Home':
        next = scenes[index - 1].startSample
        break
      case 'End':
        next = scenes[index + 1]?.startSample ?? project.getLength()
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!this.timeline.canEdit()) return
    const after = moveOutputSceneBoundary(scenes, index, next, project.getLength())
    if (after) void this.commitBoundaryEdit(project, scenes, after)
  }

  private currentSample(): number {
    const state = AudioControl.getState()
    return state === AudioState.PLAYING || state === AudioState.PLAYING_PAUSED
      ? (AudioControl.audioContext?.getPosition() ?? AudioControl.startPosition)
      : AudioControl.startPosition
  }

  private moveMarker(sample: number): void {
    if (!Number.isFinite(sample)) return
    AudioControl.startPosition = Math.max(0, Math.round(sample))
    this.timeline.clearSelection()
    this.timeline.positionMarkerController.draw()
    this.timeline.timelineKeyboard.refresh()
  }

  private showPanel(): void {
    ;(window as OutputTimelineWindow).outputPanelController?.show('video', this.lane)
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || this.automating) return
    const boundary =
      event.target instanceof Element ? event.target.closest<HTMLElement>('.output-scene-boundary') : null
    if (boundary) {
      this.handleBoundaryKeyDown(event, Number(boundary.dataset.sceneBoundary))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      this.showPanel()
      return
    }
    const sample = AudioControl.startPosition
    const { minor, major } = this.timeline.timelineController.getKeyboardSteps()
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = stepTimelinePosition(sample, minor, 1)
        break
      case 'ArrowLeft':
        next = stepTimelinePosition(sample, minor, -1)
        break
      case 'PageUp':
        next = stepTimelinePosition(sample, major, 1)
        break
      case 'PageDown':
        next = stepTimelinePosition(sample, major, -1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = Math.max(0, this.project?.getLength() ?? 0)
        break
      case '+':
      case '=':
        this.timeline.zoomBy(0.8, this.lane.clientWidth / 2)
        next = sample
        break
      case '-':
        this.timeline.zoomBy(1.25, this.lane.clientWidth / 2)
        next = sample
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!this.timeline.canEdit()) return
    this.moveMarker(next)
    const x = next / this.timeline.sampleScale - this.timeline.translation
    if (x < 0 || x > this.lane.clientWidth) this.timeline.goToSample(next)
  }
}
