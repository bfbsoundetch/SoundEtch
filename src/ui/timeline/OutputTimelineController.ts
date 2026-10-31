import { AudioControl, AudioState } from '../../audiocontext/AudioControl'
import { TimeUtils } from '../../global/TimeUtils'
import type { Project } from '../../project/Project'
import { ProjectManager } from '../../project/ProjectManager'
import { getOutputSceneIndex } from '../../project/OutputScene'
import type { OutputScene } from '../../project/OutputScene'
import type { OutputPanelController } from '../OutputPanelController'
import type { TrackListController } from './TrackListController'
import { stepTimelinePosition } from './TimelineKeyboardSteps'

interface OutputTimelineWindow extends Window {
  readonly outputPanelController?: OutputPanelController
}

/** Renders scenes in the shared timeline surface; pointer movement belongs to PointerStateManager. */
export class OutputTimelineController {
  private readonly lane = document.querySelector<HTMLElement>('.timeline-output-lane')!
  private readonly blocks: HTMLElement[] = []
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
    this.lane.setAttribute('role', 'slider')
    this.lane.setAttribute('aria-label', 'Output scenes timeline')
    this.lane.setAttribute('aria-orientation', 'horizontal')
    this.lane.setAttribute('aria-valuemin', '0')
    this.lane.setAttribute(
      'aria-description',
      'Click to move the position marker and open Output. Arrow keys move by a ruler tick; Enter opens Output.',
    )
    this.lane.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return
      event.preventDefault()
      this.lane.focus({ preventScroll: true })
      this.showPanel()
    })
    this.lane.addEventListener('keydown', (event) => this.handleKeyDown(event))
    void ProjectManager.addProjectListener((project) => {
      this.project = project
      this.renderedScenes = null
      this.draw()
    })
  }

  draw(sample = this.currentSample()): void {
    const project = this.project
    if (!project || !Number.isFinite(this.timeline.sampleScale) || this.timeline.sampleScale <= 0) return
    const scenes = project.outputScenes
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
      this.renderedScenes = scenes
      this.renderedScale = this.timeline.sampleScale
      this.renderedTranslation = this.timeline.translation
      this.renderedWidth = width
      this.renderedLength = length
    } else if (active !== this.activeIndex) {
      this.blocks[this.activeIndex]?.classList.remove('is-active')
      this.blocks[active]?.classList.add('is-active')
    }
    if (sample !== this.renderedSample || active !== this.activeIndex || geometryChanged) {
      this.lane.setAttribute('aria-valuemax', `${Math.max(length, sample)}`)
      this.lane.setAttribute('aria-valuenow', `${sample}`)
      this.lane.setAttribute(
        'aria-valuetext',
        `Scene ${active + 1}, ${TimeUtils.positionToString(sample, project.sampleRate, true)}`,
      )
      this.renderedSample = sample
    }
    this.activeIndex = active
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
    ;(window as OutputTimelineWindow).outputPanelController?.show(this.lane)
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
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
