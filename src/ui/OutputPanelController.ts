import { AudioControl, AudioState, isRecordingState } from '../audiocontext/AudioControl'
import { TimeUtils } from '../global/TimeUtils'
import type { Project } from '../project/Project'
import {
  clampOutputCropScale,
  cloneOutputScene,
  DEFAULT_OUTPUT_TRANSITION_DURATION,
  getOutputCropPosition,
  getOutputCropScale,
  getOutputLayoutCells,
  getOutputSceneTrack,
  getOutputTransition,
  MAX_OUTPUT_CROP_SCALE,
  MAX_OUTPUT_LAYOUT_CELLS,
  MIN_OUTPUT_CROP_SCALE,
  getOutputSceneIndex,
  OUTPUT_LAYOUTS,
  OUTPUT_TRANSITION_DIRECTIONS,
  OUTPUT_TRANSITION_KINDS,
  setOutputCropPosition,
  setOutputSceneTrack,
  splitOutputScene,
  type OutputLayout,
  type OutputScene,
  type OutputTransitionDirection,
} from '../project/OutputScene'
import { OutputBus } from '../project/OutputBus'
import { ProjectManager } from '../project/ProjectManager'
import type { Track } from '../project/Track'
import { getOutputSceneLayers, OUTPUT_TRANSITION_LABELS, type OutputSceneLayer } from '../video/OutputTransition'
import { resolveVideoFrame } from '../video/VideoFrameResolver'
import { VideoPreview } from '../video/VideoPreview'
import { TopPanelController } from './TopPanelController'
import { EffectPanelController } from './effects/EffectPanelController'
import { NotificationsController } from './NotificationsController'
import { OutputCaptionsController } from './OutputCaptionsController'
import type { TrackListController } from './timeline/TrackListController'
import { editorHistory } from './undo/EditorHistory'
import { SetOutputScenesCommand } from './undo/SetOutputScenesCommand'

interface OutputPanelWindow extends Window {
  readonly trackListController?: Pick<TrackListController, 'canEdit' | 'outputTimelineController'>
}

type PreviewSlot = {
  layer: PreviewLayer
  /** Area in the layer's scene layout, in source order. */
  index: number
  element: HTMLDivElement
  canvas: HTMLCanvasElement
  status: HTMLParagraphElement
  preview: VideoPreview
  empty: boolean
}

/** One scene's composed picture. A transition shows two, moved and faded like the export's. */
type PreviewLayer = {
  element: HTMLDivElement
  slots: PreviewSlot[]
  /** The layout the slots are positioned for; null before any is applied. */
  layout: OutputLayout | null
  /** Start of the scene shown by the last render; NaN while hidden. */
  sceneStart: number
  /** The applied stacking order, opacity, and transform. */
  style: string
}

type CropDrag = {
  project: Project
  scene: OutputScene
  sample: number
  slot: PreviewSlot
  slotIndex: number
  /** Null while the finished gesture waits for its history command to complete. */
  pointerId: number | null
  clientX: number
  clientY: number
  lastClientX: number
  lastClientY: number
  startX: number
  startY: number
  /** Current drag baseline after a resize; startX/startY retain the original saved crop. */
  originX: number
  originY: number
  overflowX: number
  overflowY: number
  x: number
  y: number
}

type FrameStyleProperty = 'cornerRadius' | 'margin'

type FrameStyleEdit = {
  project: Project
  scene: OutputScene
  property: FrameStyleProperty
  input: HTMLInputElement
  value: number
}

export type OutputSection = 'audio' | 'video'

const SECTIONS: readonly OutputSection[] = ['audio', 'video']
const SECTION_LABELS: Record<OutputSection, string> = { audio: 'Audio', video: 'Video' }
const FRAME_REFERENCE_HEIGHT = 1080
const MAX_CORNER_RADIUS = FRAME_REFERENCE_HEIGHT / 2
const MAX_FRAME_MARGIN = 240
const DIRECTION_LABELS: Record<OutputTransitionDirection, string> = {
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
}
const TRANSITION_DURATIONS = [0.25, 0.5, 0.75, 1, 1.5, 2]
const LAYOUT_LABELS: Record<OutputLayout, string> = {
  single: 'Single video',
  'side-by-side': 'Side by side',
  'three-across': 'Three in a row',
  'grid-2x2': '2×2 grid',
}
/** Names of each layout's areas, in source order. */
const AREA_NAMES: Record<OutputLayout, readonly string[]> = {
  single: ['video'],
  'side-by-side': ['left video', 'right video'],
  'three-across': ['left video', 'middle video', 'right video'],
  'grid-2x2': ['top-left video', 'top-right video', 'bottom-left video', 'bottom-right video'],
}

function areaName(layout: OutputLayout, slot: number): string {
  return AREA_NAMES[layout][slot] ?? `video ${slot + 1}`
}

function sourceLabel(layout: OutputLayout, slot: number): string {
  const name = areaName(layout, slot)
  return `${name[0].toUpperCase()}${name.slice(1)} source`
}

function scaleButtonLabel(layout: OutputLayout, slot: number, direction: -1 | 1): string {
  return `${direction < 0 ? 'Decrease' : 'Increase'} ${areaName(layout, slot)} scale`
}

const cancelledEdit = new Error('The output scene is no longer editable.')

/** Edits the output effect chain, and the scene at the timeline marker with a preview of its composed video. */
export class OutputPanelController {
  private readonly shell = TopPanelController.getInstance()
  private readonly content = document.createElement('section')
  private readonly nav = document.createElement('div')
  private readonly sectionTabs = {} as Record<OutputSection, HTMLButtonElement>
  private readonly sectionPanels = {} as Record<OutputSection, HTMLElement>
  private readonly effects = document.createElement('div')
  private readonly controls = document.createElement('div')
  private readonly sceneLabel = document.createElement('p')
  private readonly layoutSelect = document.createElement('select')
  private readonly fitSelect = document.createElement('select')
  private readonly cornerRadiusInput = document.createElement('input')
  private readonly marginInput = document.createElement('input')
  private readonly sourceSelects = Array.from({ length: MAX_OUTPUT_LAYOUT_CELLS }, () =>
    document.createElement('select'),
  )
  private readonly sourceFields: HTMLLabelElement[] = []
  private readonly sourceLabels: HTMLSpanElement[] = []
  private readonly scaleFields: HTMLDivElement[] = []
  private readonly scaleButtons: [HTMLButtonElement, HTMLButtonElement][] = []
  private readonly transitionSelect = document.createElement('select')
  private readonly directionSelect = document.createElement('select')
  private readonly durationSelect = document.createElement('select')
  private readonly transitionSection: HTMLDetailsElement
  private readonly directionField: HTMLLabelElement
  private readonly durationField: HTMLLabelElement
  private readonly splitButton = document.createElement('button')
  private readonly stage = document.createElement('div')
  private readonly captions: OutputCaptionsController
  private readonly emptyMessage = document.createElement('p')
  private readonly resizeObserver: ResizeObserver
  /** Each layer keeps showing its scene across frames, so its decoders continue. */
  private readonly layers: readonly [PreviewLayer, PreviewLayer]
  /** The layer showing the scene at the position marker, which crop gestures and scale buttons edit. */
  private controlLayer: PreviewLayer | null = null
  private transitioning = false
  private project: Project | null = null
  /** What the effect chain was last built from; refreshes rebuild it only when it changes. */
  private renderedEffects = ''
  private videoTracks: Track[] = []
  private section: OutputSection = 'video'
  private rootShown = false
  private running = false
  private animationFrame = 0
  private geometryChanged = true
  private editing = false
  private controlScene: OutputScene | null = null
  private controlSample = NaN
  private cropDrag: CropDrag | null = null
  private frameStyleEdit: FrameStyleEdit | null = null

  constructor() {
    this.content.id = 'output-panel-content'
    this.content.className = 'output-panel-content'
    this.nav.className = 'output-panel-nav'
    const tabList = document.createElement('div')
    tabList.className = 'output-panel-tabs'
    tabList.setAttribute('role', 'tablist')
    tabList.setAttribute('aria-orientation', 'vertical')
    tabList.setAttribute('aria-label', 'Output views')
    this.nav.appendChild(tabList)
    this.content.appendChild(this.nav)
    for (const section of SECTIONS) {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.id = `output-panel-${section}-tab`
      tab.className = 'clickable output-panel-tab'
      tab.textContent = SECTION_LABELS[section]
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', `output-panel-${section}`)
      tab.addEventListener('click', () => this.setSection(section))
      tabList.appendChild(tab)
      this.sectionTabs[section] = tab

      const panel = document.createElement('div')
      panel.id = `output-panel-${section}`
      panel.className = 'output-panel-section'
      panel.tabIndex = 0
      panel.setAttribute('role', 'tabpanel')
      panel.setAttribute('aria-labelledby', tab.id)
      this.content.appendChild(panel)
      this.sectionPanels[section] = panel
    }
    tabList.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const index = SECTIONS.indexOf(this.section)
      let next: number
      switch (event.key) {
        case 'ArrowUp':
          next = (index + SECTIONS.length - 1) % SECTIONS.length
          break
        case 'ArrowDown':
          next = (index + 1) % SECTIONS.length
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = SECTIONS.length - 1
          break
        default:
          return
      }
      this.setSection(SECTIONS[next])
      this.sectionTabs[SECTIONS[next]].focus()
      event.preventDefault()
      event.stopPropagation()
    })
    this.effects.className = 'output-panel-effects'
    this.sectionPanels.audio.appendChild(this.effects)

    this.controls.className = 'output-panel-controls'
    this.captions = new OutputCaptionsController(this.stage, () => this.canEdit() && !this.editing)
    this.sceneLabel.id = 'output-panel-scene'
    this.sceneLabel.className = 'output-panel-scene'
    this.controls.appendChild(this.sceneLabel)
    this.layoutSelect.id = 'output-panel-layout'
    this.layoutSelect.append(...OUTPUT_LAYOUTS.map((layout) => new Option(LAYOUT_LABELS[layout], layout)))
    this.fitSelect.id = 'output-panel-fit'
    this.fitSelect.append(new Option('Fit (contain)', 'contain'), new Option('Crop (cover)', 'cover'))
    const layoutSection = this.createControlsSection(
      'Layout',
      this.field('Layout', this.layoutSelect),
      this.field('Framing', this.fitSelect),
    )
    layoutSection.open = true
    const frameStyleFields: HTMLLabelElement[] = []
    for (const [property, label, input, maximum, id] of [
      ['cornerRadius', 'Corner radius', this.cornerRadiusInput, MAX_CORNER_RADIUS, 'output-panel-radius'],
      ['margin', 'Margin', this.marginInput, MAX_FRAME_MARGIN, 'output-panel-margin'],
    ] as const) {
      input.id = id
      input.type = 'range'
      input.min = '0'
      input.max = String(maximum)
      input.step = '1'
      input.setAttribute('aria-label', label)
      input.title = label
      input.addEventListener('input', () => this.previewFrameStyle(property, input))
      input.addEventListener('change', () => void this.finishFrameStyleEdit(input))
      input.addEventListener('pointercancel', () => this.cancelFrameStyleEdit(input))
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || this.frameStyleEdit?.input !== input) return
        event.preventDefault()
        event.stopPropagation()
        this.cancelFrameStyleEdit(input)
      })
      frameStyleFields.push(this.field(label, input))
    }
    const sourceControls: HTMLElement[] = []
    this.sourceSelects.forEach((select, index) => {
      select.id = `output-panel-source-${index + 1}`
      const field = this.field(sourceLabel('single', index), select)
      this.sourceFields.push(field)
      this.sourceLabels.push(field.querySelector('span')!)
      sourceControls.push(field)
      const scaleField = document.createElement('div')
      scaleField.className = 'output-panel-field'
      scaleField.setAttribute('role', 'group')
      const scaleLabel = document.createElement('span')
      scaleLabel.id = `output-panel-scale-${index + 1}`
      scaleLabel.textContent = 'Scale'
      scaleField.setAttribute('aria-labelledby', scaleLabel.id)
      const buttons = document.createElement('div')
      buttons.className = 'output-panel-scale-buttons'
      const decrease = document.createElement('button')
      const increase = document.createElement('button')
      for (const [button, direction, text] of [
        [decrease, -1, '−'],
        [increase, 1, '+'],
      ] as const) {
        button.type = 'button'
        button.className = 'bordered clickable'
        button.textContent = text
        const label = scaleButtonLabel('single', index, direction)
        button.setAttribute('aria-label', label)
        button.title = label
        button.addEventListener('click', () => this.changeCropScale(index, direction))
        buttons.appendChild(button)
      }
      scaleField.append(scaleLabel, buttons)
      this.scaleFields.push(scaleField)
      this.scaleButtons.push([decrease, increase])
      sourceControls.push(scaleField)
      select.addEventListener('change', () => {
        const track = this.videoTracks[select.selectedIndex - 1] ?? null
        void this.editScene((scene) => {
          if (track && !this.project?.getTracks().includes(track)) return
          setOutputSceneTrack(scene, index, track)
        }, 'change output video source')
      })
    })
    this.transitionSelect.id = 'output-panel-transition'
    this.transitionSelect.append(
      new Option('Cut', ''),
      ...OUTPUT_TRANSITION_KINDS.map((kind) => new Option(OUTPUT_TRANSITION_LABELS[kind], kind)),
    )
    this.directionSelect.id = 'output-panel-transition-direction'
    this.directionSelect.append(
      ...OUTPUT_TRANSITION_DIRECTIONS.map((direction) => new Option(DIRECTION_LABELS[direction], direction)),
    )
    this.durationSelect.id = 'output-panel-transition-duration'
    this.durationSelect.append(...TRANSITION_DURATIONS.map((seconds) => new Option(`${seconds} s`, String(seconds))))
    this.directionField = this.field('Direction', this.directionSelect)
    this.durationField = this.field('Duration', this.durationSelect)
    this.transitionSection = this.createControlsSection(
      'Transition',
      this.field('Transition from previous scene', this.transitionSelect),
      this.directionField,
      this.durationField,
    )
    this.controls.append(
      layoutSection,
      this.createControlsSection('Video sources', ...sourceControls),
      this.createControlsSection('Frame style', ...frameStyleFields),
      this.transitionSection,
      this.createControlsSection('Captions', this.captions.controls),
    )
    this.transitionSelect.addEventListener('change', () => {
      const kind = OUTPUT_TRANSITION_KINDS.find((candidate) => candidate === this.transitionSelect.value)
      void this.editScene((scene) => {
        if (!kind) {
          delete scene.transition
          return
        }
        scene.transition = {
          kind,
          duration: scene.transition?.duration ?? DEFAULT_OUTPUT_TRANSITION_DURATION,
          direction: scene.transition?.direction ?? 'left',
        }
      }, 'change output transition')
    })
    this.directionSelect.addEventListener('change', () => {
      const direction = OUTPUT_TRANSITION_DIRECTIONS.find((candidate) => candidate === this.directionSelect.value)
      void this.editScene((scene) => {
        if (scene.transition && direction) scene.transition.direction = direction
      }, 'change output transition direction')
    })
    this.durationSelect.addEventListener('change', () => {
      const duration = Number(this.durationSelect.value)
      void this.editScene((scene) => {
        if (scene.transition) scene.transition.duration = duration
      }, 'change output transition duration')
    })
    this.layoutSelect.addEventListener('change', () => {
      const layout = OUTPUT_LAYOUTS.find((candidate) => candidate === this.layoutSelect.value)
      if (!layout) return
      void this.editScene((scene) => {
        scene.layout = layout
      }, 'change output layout')
    })
    this.fitSelect.addEventListener('change', () => {
      const fit = this.fitSelect.value === 'cover' ? 'cover' : 'contain'
      void this.editScene((scene) => {
        scene.fit = fit
      }, 'change output framing')
    })
    this.splitButton.id = 'output-panel-split'
    this.splitButton.type = 'button'
    this.splitButton.className = 'bordered clickable'
    this.splitButton.textContent = 'Split at position marker'
    this.splitButton.addEventListener('click', () => {
      const sample = AudioControl.startPosition
      void this.commit(
        (project) => splitOutputScene(project.outputScenes, sample, project.getLength()),
        'split output scene',
      )
    })
    this.controls.append(this.splitButton)

    const previewArea = document.createElement('div')
    previewArea.className = 'output-panel-preview-area'
    this.stage.id = 'output-panel-preview'
    this.stage.className = 'output-panel-preview'
    this.stage.setAttribute('aria-label', 'Composed output preview, 16 by 9')
    this.layers = [this.createLayer(), this.createLayer()]
    previewArea.appendChild(this.stage)
    this.emptyMessage.className = 'top-panel-message'
    this.emptyMessage.textContent = 'No project is open.'
    const video = document.createElement('div')
    video.className = 'output-panel-video'
    video.append(previewArea, this.controls, this.emptyMessage)
    this.sectionPanels.video.appendChild(video)
    this.resizeObserver = new ResizeObserver(() => {
      this.geometryChanged = true
    })
    this.shell.setRootView('output', () => this.openRoot())
    this.shell.addVisibilityListener('output', () => this.updateVisibility())
    this.setSection(this.section)
    this.openRoot()
    window.addEventListener('blur', () => {
      this.cancelCropDrag()
      this.cancelFrameStyleEdit()
    })
    void ProjectManager.addProjectListener((project) => {
      if (project !== this.project) {
        this.releaseSlots()
        this.project = project
        this.videoTracks = []
        // The options must also reset when two projects happen to have identical track names.
        this.sourceSelects.forEach((select) => select.replaceChildren())
        // Views over the tab, such as effect editors, show the previous project's data.
        this.openRoot()
      }
      this.captions.setProject(project)
      if (this.running) this.render()
      else this.refreshControls()
      this.refreshEffects()
    }).catch((error) => NotificationsController.showError(error))
    // Output effect edits are saved without notifying project listeners.
    editorHistory.addChangeListener(() => {
      this.refreshEffects()
      if (this.project) this.captions.setProject(this.project)
    })
  }

  /** Selects Output on `section` and opens the top panel without requiring a track selection. */
  show(section: OutputSection, timelineAnchor?: HTMLElement): void {
    this.setSection(section)
    this.openRoot()
    this.shell.reveal('output', timelineAnchor)
  }

  private refreshEffects(): void {
    const project = this.project
    const effects = project
      ? [
          project.id,
          ...project.outputEffects.map((effect) => `${effect.instanceId}:${effect.id}:${effect.bypassed ?? false}`),
        ].join('|')
      : ''
    if (effects === this.renderedEffects) return
    this.renderedEffects = effects
    if (project)
      this.effects.replaceChildren(EffectPanelController.getInstance().createEffectsChain(OutputBus.of(project)))
    else this.effects.replaceChildren()
  }

  private setSection(section: OutputSection): void {
    this.section = section
    for (const other of SECTIONS) {
      const selected = other === section
      this.sectionTabs[other].setAttribute('aria-selected', `${selected}`)
      this.sectionTabs[other].tabIndex = selected ? 0 : -1
      this.sectionPanels[other].hidden = !selected
    }
    this.updateVisibility()
  }

  private createControlsSection(title: string, ...fields: HTMLElement[]): HTMLDetailsElement {
    const section = document.createElement('details')
    section.className = 'output-panel-controls-section'
    const summary = document.createElement('summary')
    summary.className = 'output-panel-controls-summary'
    summary.textContent = title
    const content = document.createElement('div')
    content.className = 'output-panel-controls-section-content'
    content.append(...fields)
    section.append(summary, content)
    return section
  }

  private field(text: string, control: HTMLSelectElement | HTMLInputElement): HTMLLabelElement {
    const label = document.createElement('label')
    label.className = 'output-panel-field'
    label.htmlFor = control.id
    const title = document.createElement('span')
    title.textContent = text
    label.append(title, control)
    return label
  }

  private openRoot(): void {
    this.shell.open({
      tab: 'output',
      owner: this,
      body: this.content,
      onClose: () => {
        this.rootShown = false
        this.updateVisibility()
      },
    })
    this.rootShown = true
    this.updateVisibility()
  }

  private updateVisibility(): void {
    const run = this.rootShown && this.shell.isVisible('output') && this.section === 'video'
    if (run === this.running) return
    this.running = run
    if (run) {
      this.geometryChanged = true
      this.resizeObserver.observe(this.stage)
      this.tick()
    } else {
      cancelAnimationFrame(this.animationFrame)
      this.resizeObserver.disconnect()
      this.releaseSlots()
    }
  }

  private readonly tick = (): void => {
    if (!this.running) return
    this.render()
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private cursorSample(): number {
    return AudioControl.isPlaying()
      ? (AudioControl.audioContext?.getPosition() ?? AudioControl.startPosition)
      : AudioControl.startPosition
  }

  /** Includes a scene boundary drag or edit in progress on the timeline. */
  private getScenes(project: Project): readonly OutputScene[] {
    return (
      (window as OutputPanelWindow).trackListController?.outputTimelineController.getScenes(project) ??
      project.outputScenes
    )
  }

  private canEdit(): boolean {
    const trackList = (window as OutputPanelWindow).trackListController
    if (trackList) return trackList.canEdit() && !trackList.outputTimelineController.isEditing
    const state = AudioControl.getState()
    return state === AudioState.STOPPED || state === AudioState.MONITORING || state === AudioState.MONITORING_PAUSED
  }

  private refreshControls(sample = this.cursorSample()): OutputScene | null {
    const project = this.project
    this.controls.hidden = !project
    this.stage.parentElement!.hidden = !project
    this.emptyMessage.hidden = project !== null
    if (!project) return null
    let videoCount = 0
    let tracksChanged = this.sourceSelects[0].options.length === 0
    for (const track of project.getTracks()) {
      if (!track.clipViews.some((view) => view.clip.videoSegments.length > 0)) continue
      if (
        track !== this.videoTracks[videoCount] ||
        this.sourceSelects[0].options[videoCount + 1]?.text !== track.name
      ) {
        tracksChanged = true
      }
      ++videoCount
    }
    if (tracksChanged || videoCount !== this.videoTracks.length) {
      this.videoTracks = project
        .getTracks()
        .filter((track) => track.clipViews.some((view) => view.clip.videoSegments.length > 0))
      for (const select of this.sourceSelects) {
        select.replaceChildren(
          new Option('Automatic', ''),
          ...this.videoTracks.map((track, i) => new Option(track.name, String(i))),
        )
      }
    }
    const scenes = this.getScenes(project)
    const index = getOutputSceneIndex(scenes, sample)
    const scene = scenes[index]
    if (!scene) return null
    if (scene !== this.controlScene || sample !== this.controlSample) {
      const time = TimeUtils.positionToString(sample, project.sampleRate, false)
      const start = TimeUtils.positionToString(scene.startSample, project.sampleRate, false)
      this.sceneLabel.textContent = `Scene ${index + 1} · ${time} (starts ${start})`
      this.controlScene = scene
      this.controlSample = sample
    }
    if (this.layoutSelect.value !== scene.layout) this.layoutSelect.value = scene.layout
    if (this.fitSelect.value !== scene.fit) this.fitSelect.value = scene.fit
    const radius = Math.max(0, Math.min(MAX_CORNER_RADIUS, this.frameStyleValue(scene, 'cornerRadius')))
    const margin = Math.max(0, Math.min(MAX_FRAME_MARGIN, this.frameStyleValue(scene, 'margin')))
    if (this.cornerRadiusInput.valueAsNumber !== radius) {
      this.cornerRadiusInput.value = String(radius)
    }
    if (this.marginInput.valueAsNumber !== margin) {
      this.marginInput.value = String(margin)
    }
    const editable = this.canEdit() && !this.editing && this.cropDrag === null
    this.layoutSelect.disabled = !editable
    this.fitSelect.disabled = !editable
    this.cornerRadiusInput.disabled = !editable
    this.marginInput.disabled = !editable
    const areas = getOutputLayoutCells(scene.layout).length
    this.sourceSelects.forEach((select, slot) => {
      const track = getOutputSceneTrack(scene, slot)
      const trackIndex = track === null ? -1 : this.videoTracks.indexOf(track)
      const unavailable = select.options[this.videoTracks.length + 1]
      // A track that no longer has video remains explicit (black), not Automatic.
      if (track && trackIndex === -1) {
        const option = unavailable ?? new Option('', 'unavailable')
        option.disabled = true
        const text = `${track.name} (unavailable)`
        if (option.text !== text) option.text = text
        if (!unavailable) select.appendChild(option)
        select.selectedIndex = this.videoTracks.length + 1
      } else {
        unavailable?.remove()
        select.selectedIndex = trackIndex + 1
      }
      select.disabled = !editable
      const sourceText = sourceLabel(scene.layout, slot)
      if (this.sourceLabels[slot].textContent !== sourceText) this.sourceLabels[slot].textContent = sourceText
      this.sourceFields[slot].hidden = slot >= areas
      const scale = getOutputCropScale(scene, slot)
      this.scaleFields[slot].hidden = scene.fit !== 'cover' || slot >= areas
      this.scaleButtons[slot][0].disabled = !editable || scale <= MIN_OUTPUT_CROP_SCALE
      this.scaleButtons[slot][1].disabled = !editable || scale >= MAX_OUTPUT_CROP_SCALE
      this.scaleButtons[slot].forEach((button, direction) => {
        const label = scaleButtonLabel(scene.layout, slot, direction === 0 ? -1 : 1)
        if (button.title !== label) {
          button.title = label
          button.setAttribute('aria-label', label)
        }
      })
    })
    const transition = getOutputTransition(scenes, index)
    // The first scene starts the video, so it has nothing to transition from.
    this.transitionSection.hidden = index === 0
    this.directionField.hidden = transition?.kind !== 'slide' && transition?.kind !== 'push'
    this.durationField.hidden = !transition
    const kind = transition?.kind ?? ''
    if (this.transitionSelect.value !== kind) this.transitionSelect.value = kind
    if (transition) {
      if (this.directionSelect.value !== transition.direction) this.directionSelect.value = transition.direction
      const duration = String(transition.duration)
      if (this.durationSelect.value !== duration) this.durationSelect.value = duration
    }
    this.transitionSelect.disabled = !editable
    this.directionSelect.disabled = !editable
    this.durationSelect.disabled = !editable
    const marker = AudioControl.startPosition
    const validSplit =
      Number.isInteger(marker) &&
      marker > 0 &&
      marker < project.getLength() &&
      !project.outputScenes.some((candidate) => candidate.startSample === marker)
    this.splitButton.disabled = !editable || !validSplit
    return scene
  }

  private render(): void {
    if (this.cropDrag && !this.isCropDragValid(this.cropDrag)) this.cancelCropDrag()
    if (this.frameStyleEdit && !this.isFrameStyleEditValid(this.frameStyleEdit)) this.frameStyleEdit = null
    const sample = this.cursorSample()
    const scene = this.refreshControls(sample)
    const project = this.project
    this.captions.render(sample)
    if (!project || !scene || !this.running) return
    const scenes = this.getScenes(project)
    const visible = getOutputSceneLayers(scenes, sample, project.sampleRate, project.getLength())
    const layers = this.assignLayers(visible.map((composition) => scenes[composition.index]))
    const control = getOutputSceneIndex(scenes, sample)
    this.controlLayer = layers[visible.findIndex((composition) => composition.index === control)] ?? null
    this.transitioning = visible.length > 1
    for (const layer of this.layers) if (!layers.includes(layer)) this.hideLayer(layer)
    const recording = isRecordingState(AudioControl.getState())
    visible.forEach((composition, order) =>
      this.renderLayer(layers[order], scenes[composition.index], composition, order, project, sample, recording),
    )
    this.geometryChanged = false
  }

  /** Keeps each layer on the scene it showed, so its decoders continue; other scenes take the remaining layers. */
  private assignLayers(scenes: readonly OutputScene[]): PreviewLayer[] {
    const kept = scenes.map((scene) => this.layers.find((layer) => layer.sceneStart === scene.startSample))
    // A layer that showed a scene in the last frame goes first: at a cut, the next scene continues decoding there.
    const free = this.layers
      .filter((layer) => !kept.includes(layer))
      .sort((a, b) => Number(Number.isNaN(a.sceneStart)) - Number(Number.isNaN(b.sceneStart)))
    return kept.map((layer) => layer ?? free.shift()!)
  }

  private hideLayer(layer: PreviewLayer): void {
    if (layer.element.hidden) return
    layer.element.hidden = true
    layer.sceneStart = NaN
    for (const slot of layer.slots) {
      if (!slot.empty) slot.preview.clear()
      slot.empty = true
    }
  }

  private renderLayer(
    layer: PreviewLayer,
    scene: OutputScene,
    composition: OutputSceneLayer,
    order: number,
    project: Project,
    sample: number,
    recording: boolean,
  ): void {
    let redraw = this.geometryChanged || layer.element.hidden
    layer.element.hidden = false
    layer.sceneStart = scene.startSample
    const cells = getOutputLayoutCells(scene.layout)
    if (layer.slots.length !== cells.length || layer.layout !== scene.layout) {
      while (layer.slots.length > cells.length) {
        const slot = layer.slots.pop()!
        slot.preview.release()
        slot.element.remove()
      }
      while (layer.slots.length < cells.length) this.addSlot(layer)
      // Place each area as the export paints it.
      layer.slots.forEach((slot, index) => {
        const cell = cells[index]
        slot.element.style.left = `${cell.x * 100}%`
        slot.element.style.top = `${cell.y * 100}%`
        slot.element.style.width = `${cell.width * 100}%`
        slot.element.style.height = `${cell.height * 100}%`
      })
      layer.layout = scene.layout
      redraw = true
    }
    const { x, y, scale } = composition
    const transform = x !== 0 || y !== 0 || scale !== 1 ? `translate(${x * 100}%, ${y * 100}%) scale(${scale})` : ''
    const opacity = composition.opacity === 1 ? '' : String(composition.opacity)
    const style = `${order}|${opacity}|${transform}`
    if (layer.style !== style) {
      // As in the export, the incoming scene paints over the outgoing one, each with its black background.
      layer.style = style
      layer.element.style.zIndex = String(order)
      layer.element.style.opacity = opacity
      layer.element.style.transform = transform
    }
    const frameScale = this.stage.clientHeight / FRAME_REFERENCE_HEIGHT
    const frameMargin = Math.max(0, Math.min(MAX_FRAME_MARGIN, this.frameStyleValue(scene, 'margin'))) * frameScale
    const frameRadius =
      Math.max(0, Math.min(MAX_CORNER_RADIUS, this.frameStyleValue(scene, 'cornerRadius'))) * frameScale
    // Reframing edits the scene at the marker, and only while no transition moves or fades its picture.
    const reframable = layer === this.controlLayer && !this.transitioning && this.canEdit() && !this.editing
    for (const slot of layer.slots) {
      const selected = getOutputSceneTrack(scene, slot.index)
      const track = selected === null ? this.videoTracks[slot.index] : selected
      const target =
        !recording && track && project.getTracks().includes(track)
          ? resolveVideoFrame(track.clipViews, sample, project.sampleRate)
          : null
      const position = getOutputCropPosition(scene, slot.index)
      const drag = this.cropDrag?.slot === slot ? this.cropDrag : null
      slot.preview.setFraming(
        scene.fit,
        drag?.x ?? position.x,
        drag?.y ?? position.y,
        frameRadius,
        getOutputCropScale(scene, slot.index),
        frameMargin,
      )
      if (!target) {
        if (!slot.empty) slot.preview.clear()
        slot.empty = true
        slot.element.classList.remove('is-pannable')
        slot.canvas.tabIndex = -1
        this.setStatus(
          slot,
          recording
            ? 'Recording — timeline preview available after stop.'
            : track
              ? 'No video at this timeline position.'
              : 'No video source. Import a video or record with the camera on.',
        )
        continue
      }
      slot.empty = false
      slot.canvas.setAttribute('aria-label', `Output ${areaName(scene.layout, slot.index)}: ${track!.name}`)
      slot.preview.request(project.directoryName, project.sampleRate, target, redraw)
      const overflow = slot.preview.getCropOverflow()
      if (
        drag &&
        drag.pointerId !== null &&
        overflow &&
        (drag.overflowX !== overflow.x || drag.overflowY !== overflow.y)
      ) {
        drag.clientX = drag.lastClientX
        drag.clientY = drag.lastClientY
        drag.originX = drag.x
        drag.originY = drag.y
        drag.overflowX = overflow.x
        drag.overflowY = overflow.y
      }
      const pannable = reframable && overflow !== null && (overflow.x > 0 || overflow.y > 0)
      slot.element.classList.toggle('is-pannable', pannable)
      slot.canvas.tabIndex = pannable ? 0 : -1
    }
  }

  private createLayer(): PreviewLayer {
    const element = document.createElement('div')
    element.className = 'output-panel-preview-layer'
    element.hidden = true
    this.stage.appendChild(element)
    return { element, slots: [], layout: null, sceneStart: NaN, style: '' }
  }

  private addSlot(layer: PreviewLayer): void {
    const element = document.createElement('div')
    element.className = 'output-panel-preview-slot'
    const canvas = document.createElement('canvas')
    canvas.setAttribute('role', 'img')
    canvas.tabIndex = -1
    canvas.setAttribute(
      'aria-description',
      'In Crop mode, drag to reframe the video or use the arrow keys. Escape cancels a drag.',
    )
    const status = document.createElement('p')
    status.className = 'output-panel-preview-status'
    status.setAttribute('role', 'status')
    element.append(canvas, status)
    const slot: PreviewSlot = {
      layer,
      index: layer.slots.length,
      element,
      canvas,
      status,
      empty: true,
      preview: new VideoPreview(
        canvas,
        (message) => this.setStatus(slot, message),
        (error) => NotificationsController.showError(error),
      ),
    }
    canvas.addEventListener('pointerdown', (event) => this.beginCropDrag(slot, event))
    canvas.addEventListener('pointermove', (event) => this.moveCropDrag(event))
    canvas.addEventListener('pointerup', (event) => this.finishCropDrag(event, true))
    canvas.addEventListener('pointercancel', (event) => this.finishCropDrag(event, false))
    // Chrome on macOS can drop pointerup after a fast release (crbug.com/489633223), leaving capture loss as the
    // only end signal. Every deliberate cancel clears the drag first, so capture loss still pending commits it.
    canvas.addEventListener('lostpointercapture', (event) => this.finishCropDrag(event, true))
    canvas.addEventListener('keydown', (event) => this.moveCropWithKeyboard(slot, event))
    layer.slots.push(slot)
    layer.element.appendChild(element)
  }

  private setStatus(slot: PreviewSlot, message: string): void {
    if (slot.status.textContent !== message) slot.status.textContent = message
    slot.status.hidden = message.length === 0
  }

  private releaseSlots(): void {
    this.cancelCropDrag()
    this.frameStyleEdit = null
    for (const layer of this.layers) {
      for (const slot of layer.slots) slot.preview.release()
      layer.slots.length = 0
      layer.element.replaceChildren()
      layer.element.hidden = true
      layer.sceneStart = NaN
    }
    this.controlLayer = null
    this.transitioning = false
    this.geometryChanged = true
  }

  private beginCropDrag(slot: PreviewSlot, event: PointerEvent): void {
    const project = this.project
    if (
      !project ||
      !event.isPrimary ||
      event.button !== 0 ||
      this.cropDrag ||
      this.editing ||
      !this.running ||
      !this.canEdit() ||
      slot.empty ||
      slot.layer !== this.controlLayer ||
      this.transitioning
    )
      return
    const sample = this.cursorSample()
    const scene = project.outputScenes[getOutputSceneIndex(project.outputScenes, sample)]
    const overflow = slot.preview.getCropOverflow()
    if (!scene || scene.fit !== 'cover' || !overflow || (overflow.x === 0 && overflow.y === 0)) return
    event.preventDefault()
    event.stopPropagation()
    slot.canvas.focus({ preventScroll: true })
    const position = getOutputCropPosition(scene, slot.index)
    this.cropDrag = {
      project,
      scene,
      sample,
      slot,
      slotIndex: slot.index,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startX: position.x,
      startY: position.y,
      originX: position.x,
      originY: position.y,
      overflowX: overflow.x,
      overflowY: overflow.y,
      x: position.x,
      y: position.y,
    }
    slot.element.classList.add('is-panning')
    slot.canvas.setPointerCapture(event.pointerId)
  }

  private isCropDragValid(drag: CropDrag): boolean {
    return (
      this.running &&
      this.project === drag.project &&
      this.canEdit() &&
      this.cursorSample() === drag.sample &&
      drag.project.outputScenes[getOutputSceneIndex(drag.project.outputScenes, drag.sample)] === drag.scene
    )
  }

  private moveCropDrag(event: PointerEvent): void {
    const drag = this.cropDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (this.geometryChanged) this.render()
    if (this.cropDrag !== drag) return
    if (!this.isCropDragValid(drag)) {
      this.cancelCropDrag()
      return
    }
    drag.x =
      drag.overflowX > 0
        ? Math.max(0, Math.min(1, drag.originX - (event.clientX - drag.clientX) / drag.overflowX))
        : drag.originX
    drag.y =
      drag.overflowY > 0
        ? Math.max(0, Math.min(1, drag.originY - (event.clientY - drag.clientY) / drag.overflowY))
        : drag.originY
    drag.lastClientX = event.clientX
    drag.lastClientY = event.clientY
    drag.slot.preview.setFraming('cover', drag.x, drag.y)
  }

  private finishCropDrag(event: PointerEvent, commit: boolean): void {
    const drag = this.cropDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!commit) {
      this.cancelCropDrag()
      return
    }
    // Only pointerup reports where the pointer ended; capture loss keeps the last move's position.
    if (event.type === 'pointerup') {
      this.moveCropDrag(event)
      if (this.cropDrag !== drag) return
    }
    drag.pointerId = null
    drag.slot.element.classList.remove('is-panning')
    if (drag.slot.canvas.hasPointerCapture(event.pointerId)) drag.slot.canvas.releasePointerCapture(event.pointerId)
    if (drag.x === drag.startX && drag.y === drag.startY) {
      this.cancelCropDrag()
      return
    }
    void this.commit((project) => {
      if (this.cropDrag !== drag || !this.isCropDragValid(drag)) return null
      const scenes = project.outputScenes.map(cloneOutputScene)
      const scene = scenes.find((candidate) => candidate.startSample === drag.scene.startSample)!
      setOutputCropPosition(scene, drag.slotIndex, drag.x, drag.y)
      return scenes
    }, 'pan output video').finally(() => {
      if (this.cropDrag === drag) this.cancelCropDrag()
    })
  }

  private cancelCropDrag(): void {
    const drag = this.cropDrag
    if (!drag) return
    this.cropDrag = null
    const pointerId = drag.pointerId
    drag.pointerId = null
    drag.slot.element.classList.remove('is-panning')
    if (pointerId !== null && drag.slot.canvas.hasPointerCapture(pointerId))
      drag.slot.canvas.releasePointerCapture(pointerId)
    const project = this.project
    const scene = project?.outputScenes[getOutputSceneIndex(project.outputScenes, this.cursorSample())]
    if (scene) {
      const position = getOutputCropPosition(scene, drag.slotIndex)
      drag.slot.preview.setFraming(scene.fit, position.x, position.y)
    }
  }

  private changeCropScale(index: number, direction: -1 | 1): void {
    const project = this.project
    if (!project || !this.running || !this.canEdit() || this.editing || this.cropDrag) return
    const scene = project.outputScenes[getOutputSceneIndex(project.outputScenes, this.cursorSample())]
    if (!scene || scene.fit !== 'cover' || index >= getOutputLayoutCells(scene.layout).length) return
    const oldScale = getOutputCropScale(scene, index)
    const scale = clampOutputCropScale(Math.round((oldScale + direction * 0.1) * 10) / 10)
    if (scale === oldScale) return
    const position = getOutputCropPosition(scene, index)
    let { x, y } = position
    const slot = this.controlLayer?.slots[index]
    const overflow = slot && !slot.empty ? slot.preview.getCropOverflow() : null
    if (slot && overflow) {
      const ratio = scale / oldScale
      const recenter = (offset: number, size: number, travel: number): number => {
        const newTravel = (size + travel) * ratio - size
        if (size <= 0 || newTravel <= 0) return offset
        return Math.max(0, Math.min(1, ((size / 2 + offset * travel) * ratio - size / 2) / newTravel))
      }
      x = recenter(x, slot.canvas.clientWidth, overflow.x)
      y = recenter(y, slot.canvas.clientHeight, overflow.y)
    }
    void this.editScene((current) => {
      setOutputCropPosition(current, index, x, y)
      current.cropPositions![index].scale = scale
    }, 'scale output video')
  }

  private moveCropWithKeyboard(slot: PreviewSlot, event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.cropDrag) {
      event.preventDefault()
      event.stopPropagation()
      this.cancelCropDrag()
      return
    }
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      this.cropDrag ||
      this.editing ||
      !this.canEdit() ||
      slot.empty ||
      slot.layer !== this.controlLayer ||
      this.transitioning
    )
      return
    let dx = 0
    let dy = 0
    const step = event.shiftKey ? 40 : 10
    switch (event.key) {
      case 'ArrowLeft':
        dx = -step
        break
      case 'ArrowRight':
        dx = step
        break
      case 'ArrowUp':
        dy = -step
        break
      case 'ArrowDown':
        dy = step
        break
      default:
        return
    }
    const overflow = slot.preview.getCropOverflow()
    const project = this.project
    const scene = project?.outputScenes[getOutputSceneIndex(project.outputScenes, this.cursorSample())]
    if (!scene || scene.fit !== 'cover' || !overflow || (overflow.x === 0 && overflow.y === 0)) return
    event.preventDefault()
    event.stopPropagation()
    const index = slot.index
    const position = getOutputCropPosition(scene, index)
    const x = overflow.x > 0 ? Math.max(0, Math.min(1, position.x - dx / overflow.x)) : position.x
    const y = overflow.y > 0 ? Math.max(0, Math.min(1, position.y - dy / overflow.y)) : position.y
    if (x === position.x && y === position.y) return
    void this.editScene((current) => setOutputCropPosition(current, index, x, y), 'pan output video')
  }

  private frameStyleValue(scene: OutputScene, property: FrameStyleProperty): number {
    const edit = this.frameStyleEdit
    return edit?.scene === scene && edit.property === property ? edit.value : (scene[property] ?? 0)
  }

  private isFrameStyleEditValid(edit: FrameStyleEdit): boolean {
    return (
      this.running &&
      this.canEdit() &&
      this.project === edit.project &&
      edit.project.outputScenes[getOutputSceneIndex(edit.project.outputScenes, this.cursorSample())] === edit.scene
    )
  }

  private previewFrameStyle(property: FrameStyleProperty, input: HTMLInputElement): void {
    const project = this.project
    if (!project || !this.running || !this.canEdit() || this.editing || this.cropDrag) return
    const scene = project.outputScenes[getOutputSceneIndex(project.outputScenes, this.cursorSample())]
    if (!scene) return
    const edit = this.frameStyleEdit
    if (edit?.scene === scene && edit.input === input) {
      edit.value = input.valueAsNumber
    } else {
      // Like crop dragging, preview a draft without changing saved scenes or creating per-move undo entries.
      this.frameStyleEdit = { project, scene, property, input, value: input.valueAsNumber }
    }
    this.render()
  }

  private async finishFrameStyleEdit(input: HTMLInputElement): Promise<void> {
    const edit = this.frameStyleEdit
    if (!edit || edit.input !== input || this.editing) return
    if (!this.isFrameStyleEditValid(edit) || edit.value === (edit.scene[edit.property] ?? 0)) {
      this.cancelFrameStyleEdit(input)
      return
    }
    try {
      await this.commit(
        (project) => {
          if (this.frameStyleEdit !== edit || !this.isFrameStyleEditValid(edit)) return null
          const scenes = project.outputScenes.map(cloneOutputScene)
          scenes[project.outputScenes.indexOf(edit.scene)][edit.property] = edit.value
          return scenes
        },
        `change output ${edit.property === 'cornerRadius' ? 'corner radius' : 'margin'}`,
      )
    } finally {
      if (this.frameStyleEdit === edit) this.cancelFrameStyleEdit(input)
    }
  }

  private cancelFrameStyleEdit(input?: HTMLInputElement): void {
    if (!this.frameStyleEdit || (input && this.frameStyleEdit.input !== input)) return
    this.frameStyleEdit = null
    if (this.running) this.render()
  }

  private editScene(change: (scene: OutputScene) => void, description: string): Promise<void> {
    this.cancelCropDrag()
    const project = this.project
    const index = project ? getOutputSceneIndex(project.outputScenes, this.cursorSample()) : -1
    const start = project?.outputScenes[index]?.startSample
    return this.commit((current) => {
      const scenes = current.outputScenes.map(cloneOutputScene)
      const scene = scenes.find((candidate) => candidate.startSample === start)
      if (!scene) return null
      change(scene)
      return scenes
    }, description)
  }

  private async commit(change: (project: Project) => OutputScene[] | null, description: string): Promise<void> {
    const project = this.project
    if (!project || !this.canEdit() || this.editing) return
    this.editing = true
    this.refreshControls()
    let command: SetOutputScenesCommand | null = null
    try {
      // Build snapshots inside history's queue, not before earlier edits/undo finish. A project switch
      // while waiting must never let a stale command save and reactivate the previous project.
      const action = {
        perform: async () => {
          if ((await ProjectManager.getActiveProject()) !== project || !this.canEdit()) throw cancelledEdit
          if (!command) {
            const scenes = change(project)
            if (!scenes) throw cancelledEdit
            command = new SetOutputScenesCommand(project, project.outputScenes, scenes, description)
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
      await editorHistory.execute(action)
    } catch (error) {
      if (error !== cancelledEdit)
        NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.editing = false
      if (this.running) this.render()
    }
  }
}
