import { AudioControl, AudioState, isRecordingState } from '../audiocontext/AudioControl'
import { TimeUtils } from '../global/TimeUtils'
import type { Project } from '../project/Project'
import {
  cloneOutputScene,
  getOutputCropPosition,
  getOutputSceneIndex,
  splitOutputScene,
  type OutputScene,
} from '../project/OutputScene'
import { ProjectManager } from '../project/ProjectManager'
import type { Track } from '../project/Track'
import { resolveVideoFrame } from '../video/VideoFrameResolver'
import { VideoPreview } from '../video/VideoPreview'
import { BottomPanelController } from './BottomPanelController'
import { NotificationsController } from './NotificationsController'
import { editorHistory } from './undo/EditorHistory'
import { SetOutputScenesCommand } from './undo/SetOutputScenesCommand'

interface OutputPanelWindow extends Window {
  readonly trackListController?: { canEdit(): boolean }
}

type PreviewSlot = {
  element: HTMLDivElement
  canvas: HTMLCanvasElement
  status: HTMLParagraphElement
  preview: VideoPreview
  empty: boolean
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

type OutputSection = 'audio' | 'video'

const SECTIONS: readonly OutputSection[] = ['audio', 'video']
const SECTION_LABELS: Record<OutputSection, string> = { audio: 'Audio', video: 'Video' }
const FRAME_REFERENCE_HEIGHT = 1080
const MAX_CORNER_RADIUS = FRAME_REFERENCE_HEIGHT / 2
const MAX_FRAME_MARGIN = 240

const cancelledEdit = new Error('The output scene is no longer editable.')

/** Edits the scene at the timeline marker and previews its composed video output. */
export class OutputPanelController {
  private readonly shell = BottomPanelController.getInstance()
  private readonly content = document.createElement('section')
  private readonly nav = document.createElement('div')
  private readonly sectionTabs = {} as Record<OutputSection, HTMLButtonElement>
  private readonly sectionPanels = {} as Record<OutputSection, HTMLElement>
  private readonly controls = document.createElement('div')
  private readonly sceneLabel = document.createElement('p')
  private readonly layoutSelect = document.createElement('select')
  private readonly fitSelect = document.createElement('select')
  private readonly cornerRadiusInput = document.createElement('input')
  private readonly marginInput = document.createElement('input')
  private readonly sourceSelects = [document.createElement('select'), document.createElement('select')]
  private readonly sourceFields: HTMLLabelElement[] = []
  private readonly splitButton = document.createElement('button')
  private readonly stage = document.createElement('div')
  private readonly emptyMessage = document.createElement('p')
  private readonly resizeObserver: ResizeObserver
  private readonly slots: PreviewSlot[] = []
  private project: Project | null = null
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
  private renderedFrameMargin = NaN

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
    const audioMessage = document.createElement('p')
    audioMessage.className = 'bottom-panel-message'
    audioMessage.textContent = 'Output audio effects and automation are not available yet.'
    this.sectionPanels.audio.appendChild(audioMessage)

    this.controls.className = 'output-panel-controls'
    this.sceneLabel.id = 'output-panel-scene'
    this.sceneLabel.className = 'output-panel-scene'
    this.controls.appendChild(this.sceneLabel)
    this.layoutSelect.id = 'output-panel-layout'
    this.layoutSelect.append(new Option('Single video', 'single'), new Option('Side by side', 'side-by-side'))
    this.fitSelect.id = 'output-panel-fit'
    this.fitSelect.append(new Option('Fit (contain)', 'contain'), new Option('Crop (cover)', 'cover'))
    this.controls.append(this.field('Layout', this.layoutSelect), this.field('Framing', this.fitSelect))
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
      this.controls.appendChild(this.field(label, input))
    }
    this.sourceSelects.forEach((select, index) => {
      select.id = `output-panel-source-${index + 1}`
      const field = this.field(index === 0 ? 'Video source' : 'Right video source', select)
      this.sourceFields.push(field)
      this.controls.appendChild(field)
      select.addEventListener('change', () => {
        const track = this.videoTracks[select.selectedIndex - 1] ?? null
        void this.editScene((scene) => {
          if (track && !this.project?.getTracks().includes(track)) return
          scene.tracks[index] = track
        }, 'change output video source')
      })
    })
    this.layoutSelect.addEventListener('change', () => {
      const layout = this.layoutSelect.value === 'side-by-side' ? 'side-by-side' : 'single'
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
    const note = document.createElement('p')
    note.className = 'output-panel-note'
    note.textContent =
      'Automatic uses the first video track, then the second for the right side. Gaps stay black. Video publishing renders these scenes with the project audio mix.'
    this.controls.append(this.splitButton, note)

    const previewArea = document.createElement('div')
    previewArea.className = 'output-panel-preview-area'
    this.stage.id = 'output-panel-preview'
    this.stage.className = 'output-panel-preview'
    this.stage.setAttribute('aria-label', 'Composed output preview, 16 by 9')
    previewArea.appendChild(this.stage)
    this.emptyMessage.className = 'bottom-panel-message'
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
      }
      if (this.running) this.render()
      else this.refreshControls()
    }).catch((error) => NotificationsController.showError(error))
  }

  /** Selects Output and opens the bottom panel without requiring a track selection. */
  show(timelineAnchor?: HTMLElement): void {
    if (timelineAnchor) this.setSection('video')
    this.openRoot()
    this.shell.reveal('output', timelineAnchor)
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

  private canEdit(): boolean {
    const trackList = (window as OutputPanelWindow).trackListController
    if (trackList) return trackList.canEdit()
    const state = AudioControl.getState()
    return state === AudioState.STOPPED || state === AudioState.MONITORING || state === AudioState.MONITORING_PAUSED
  }

  private refreshControls(): OutputScene | null {
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
    const sample = this.cursorSample()
    const index = getOutputSceneIndex(project.outputScenes, sample)
    const scene = project.outputScenes[index]
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
    this.sourceSelects.forEach((select, slot) => {
      const track = scene.tracks[slot]
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
      this.sourceFields[slot].hidden = slot === 1 && scene.layout === 'single'
    })
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
    const scene = this.refreshControls()
    const project = this.project
    if (!project || !scene || !this.running) return
    const count = scene.layout === 'single' ? 1 : 2
    if (this.slots.length !== count) {
      while (this.slots.length > count) {
        const slot = this.slots.pop()!
        slot.preview.release()
        slot.element.remove()
      }
      while (this.slots.length < count) this.addSlot()
      this.geometryChanged = true
    }
    this.stage.classList.toggle('output-panel-preview-split', count === 2)
    const frameScale = this.stage.clientHeight / FRAME_REFERENCE_HEIGHT
    const frameMargin = Math.max(0, Math.min(MAX_FRAME_MARGIN, this.frameStyleValue(scene, 'margin'))) * frameScale
    const frameRadius =
      Math.max(0, Math.min(MAX_CORNER_RADIUS, this.frameStyleValue(scene, 'cornerRadius'))) * frameScale
    if (frameMargin !== this.renderedFrameMargin) {
      this.stage.style.setProperty('--output-frame-margin', `${frameMargin}px`)
      this.renderedFrameMargin = frameMargin
      this.geometryChanged = true
    }
    const recording = isRecordingState(AudioControl.getState())
    const sample = this.cursorSample()
    for (let index = 0; index < count; ++index) {
      const slot = this.slots[index]
      const selected = scene.tracks[index]
      const track = selected === null ? this.videoTracks[index] : selected
      const target =
        !recording && track && project.getTracks().includes(track)
          ? resolveVideoFrame(track.clipViews, sample, project.sampleRate)
          : null
      const position = getOutputCropPosition(scene, index)
      const drag = this.cropDrag?.slot === slot ? this.cropDrag : null
      slot.preview.setFraming(scene.fit, drag?.x ?? position.x, drag?.y ?? position.y, frameRadius)
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
      slot.canvas.setAttribute(
        'aria-label',
        `Output ${count === 1 ? 'video' : index === 0 ? 'left video' : 'right video'}: ${track!.name}`,
      )
      slot.preview.request(project.directoryName, project.sampleRate, target, this.geometryChanged)
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
      const pannable = this.canEdit() && !this.editing && overflow !== null && (overflow.x > 0 || overflow.y > 0)
      slot.element.classList.toggle('is-pannable', pannable)
      slot.canvas.tabIndex = pannable ? 0 : -1
    }
    this.geometryChanged = false
  }

  private addSlot(): void {
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
    this.slots.push(slot)
    this.stage.appendChild(element)
  }

  private setStatus(slot: PreviewSlot, message: string): void {
    if (slot.status.textContent !== message) slot.status.textContent = message
    slot.status.hidden = message.length === 0
  }

  private releaseSlots(): void {
    this.cancelCropDrag()
    this.frameStyleEdit = null
    for (const slot of this.slots) slot.preview.release()
    this.slots.length = 0
    this.stage.replaceChildren()
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
      slot.empty
    )
      return
    const sample = this.cursorSample()
    const scene = project.outputScenes[getOutputSceneIndex(project.outputScenes, sample)]
    const overflow = slot.preview.getCropOverflow()
    if (!scene || scene.fit !== 'cover' || !overflow || (overflow.x === 0 && overflow.y === 0)) return
    event.preventDefault()
    event.stopPropagation()
    slot.canvas.focus({ preventScroll: true })
    const position = getOutputCropPosition(scene, this.slots.indexOf(slot))
    this.cropDrag = {
      project,
      scene,
      sample,
      slot,
      slotIndex: this.slots.indexOf(slot),
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
      this.setSceneCropPosition(scene, drag.slotIndex, drag.x, drag.y)
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

  private setSceneCropPosition(scene: OutputScene, slot: number, x: number, y: number): void {
    scene.cropPositions ??= [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ]
    scene.cropPositions[slot] = { x, y }
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
      slot.empty
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
    const index = this.slots.indexOf(slot)
    const position = getOutputCropPosition(scene, index)
    const x = overflow.x > 0 ? Math.max(0, Math.min(1, position.x - dx / overflow.x)) : position.x
    const y = overflow.y > 0 ? Math.max(0, Math.min(1, position.y - dy / overflow.y)) : position.y
    if (x === position.x && y === position.y) return
    void this.editScene((current) => this.setSceneCropPosition(current, index, x, y), 'pan output video')
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
