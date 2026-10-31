import { AudioControl, AudioState, isRecordingState } from '../audiocontext/AudioControl'
import { TimeUtils } from '../global/TimeUtils'
import type { Project } from '../project/Project'
import { getOutputSceneIndex, splitOutputScene, type OutputScene } from '../project/OutputScene'
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

const cancelledEdit = new Error('The output scene is no longer editable.')

/** Edits the scene at the timeline marker and previews its composed, unexported video output. */
export class OutputPanelController {
  private readonly shell = BottomPanelController.getInstance()
  private readonly content = document.createElement('section')
  private readonly controls = document.createElement('div')
  private readonly sceneLabel = document.createElement('p')
  private readonly layoutSelect = document.createElement('select')
  private readonly fitSelect = document.createElement('select')
  private readonly sourceSelects = [document.createElement('select'), document.createElement('select')]
  private readonly sourceFields: HTMLLabelElement[] = []
  private readonly splitButton = document.createElement('button')
  private readonly stage = document.createElement('div')
  private readonly emptyMessage = document.createElement('p')
  private readonly resizeObserver: ResizeObserver
  private readonly slots: PreviewSlot[] = []
  private project: Project | null = null
  private videoTracks: Track[] = []
  private rootShown = false
  private running = false
  private animationFrame = 0
  private geometryChanged = true
  private editing = false
  private controlScene: OutputScene | null = null
  private controlSample = NaN

  constructor() {
    this.content.id = 'output-panel-content'
    this.content.className = 'output-panel-content'
    this.controls.className = 'output-panel-controls'
    this.sceneLabel.id = 'output-panel-scene'
    this.sceneLabel.className = 'output-panel-scene'
    this.controls.appendChild(this.sceneLabel)
    this.layoutSelect.id = 'output-panel-layout'
    this.layoutSelect.append(new Option('Single video', 'single'), new Option('Side by side', 'side-by-side'))
    this.fitSelect.id = 'output-panel-fit'
    this.fitSelect.append(new Option('Fit (contain)', 'contain'), new Option('Crop (cover)', 'cover'))
    this.controls.append(this.field('Layout', this.layoutSelect), this.field('Framing', this.fitSelect))
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
      'Automatic uses the first video track, then the second for the right side. Gaps stay black. These scenes do not change exports or audio.'
    this.controls.append(this.splitButton, note)

    const previewArea = document.createElement('div')
    previewArea.className = 'output-panel-preview-area'
    this.stage.id = 'output-panel-preview'
    this.stage.className = 'output-panel-preview'
    this.stage.setAttribute('aria-label', 'Composed output preview, 16 by 9')
    previewArea.appendChild(this.stage)
    this.emptyMessage.className = 'bottom-panel-message'
    this.emptyMessage.textContent = 'No project is open.'
    this.content.append(this.controls, previewArea, this.emptyMessage)
    this.resizeObserver = new ResizeObserver(() => {
      this.geometryChanged = true
    })
    this.shell.setRootView('output', () => this.openRoot())
    this.shell.addVisibilityListener('output', () => this.updateVisibility())
    this.openRoot()
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
    this.openRoot()
    this.shell.reveal('output', timelineAnchor)
  }

  private field(text: string, select: HTMLSelectElement): HTMLLabelElement {
    const label = document.createElement('label')
    label.className = 'output-panel-field'
    label.htmlFor = select.id
    const title = document.createElement('span')
    title.textContent = text
    label.append(title, select)
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
    const run = this.rootShown && this.shell.isVisible('output')
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
    const editable = this.canEdit() && !this.editing
    this.layoutSelect.disabled = !editable
    this.fitSelect.disabled = !editable
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
      slot.preview.setFit(scene.fit)
      if (!target) {
        if (!slot.empty) slot.preview.clear()
        slot.empty = true
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
    }
    this.geometryChanged = false
  }

  private addSlot(): void {
    const element = document.createElement('div')
    element.className = 'output-panel-preview-slot'
    const canvas = document.createElement('canvas')
    canvas.setAttribute('role', 'img')
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
    this.slots.push(slot)
    this.stage.appendChild(element)
  }

  private setStatus(slot: PreviewSlot, message: string): void {
    if (slot.status.textContent !== message) slot.status.textContent = message
    slot.status.hidden = message.length === 0
  }

  private releaseSlots(): void {
    for (const slot of this.slots) slot.preview.release()
    this.slots.length = 0
    this.stage.replaceChildren()
    this.geometryChanged = true
  }

  private editScene(change: (scene: OutputScene) => void, description: string): Promise<void> {
    const project = this.project
    const index = project ? getOutputSceneIndex(project.outputScenes, this.cursorSample()) : -1
    const start = project?.outputScenes[index]?.startSample
    return this.commit((current) => {
      const scenes = current.outputScenes.map((scene): OutputScene => ({ ...scene, tracks: [...scene.tracks] }))
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
