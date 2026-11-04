import {
  DEFAULT_OUTPUT_CAPTIONS,
  OUTPUT_CAPTION_FONTS,
  type OutputCaptionCue,
  type OutputCaptionSettings,
} from '../project/OutputCaptions'
import type { Clip } from '../project/Clip'
import type { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import type { Track } from '../project/Track'
import { findOutputCaptionWord } from '../video/OutputCaptionCues'
import { OutputCaptionSource } from '../video/OutputCaptionSource'
import { paintOutputCaption } from '../video/OutputCaptionPainter'
import { NotificationsController } from './NotificationsController'
import { editorHistory } from './undo/EditorHistory'
import { SetOutputCaptionsCommand } from './undo/SetOutputCaptionsCommand'

const cancelledEdit = new Error('The caption settings are no longer editable.')

/** Project-wide caption controls and the final, untransformed layer over the scene preview. */
export class OutputCaptionsController {
  readonly controls = document.createElement('div')
  private readonly enabled = document.createElement('input')
  private readonly source = document.createElement('select')
  private readonly position = document.createElement('select')
  private readonly font = document.createElement('select')
  private readonly size = document.createElement('input')
  private readonly sizeLabel: HTMLSpanElement
  private readonly color = document.createElement('input')
  private readonly highlight = document.createElement('input')
  private readonly borderEnabled = document.createElement('input')
  private readonly borderColor = document.createElement('input')
  private readonly note = document.createElement('p')
  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private project: Project | null = null
  private tracks: Track[] = []
  private captionSource: OutputCaptionSource | null = null
  private draft: OutputCaptionSettings | null = null
  private saving = false
  private lastSample = 0
  private paintedCue: OutputCaptionCue | null = null
  private paintedWord = -1
  private paintedSettings: Readonly<OutputCaptionSettings> | null = null
  private controlsEditable: boolean | null = null
  private shownSize = NaN
  private readonly observedClips = new WeakSet<Clip>()

  constructor(stage: HTMLElement, private readonly canEdit: () => boolean) {
    this.controls.className = 'output-panel-caption-controls'
    this.enabled.id = 'output-captions-enabled'
    this.enabled.type = 'checkbox'
    const enabledLabel = this.field('Show transcript captions', this.enabled)
    enabledLabel.classList.add('output-panel-caption-toggle')
    this.source.id = 'output-captions-source'
    this.position.id = 'output-captions-position'
    this.position.append(new Option('Bottom', 'bottom'), new Option('Middle', 'middle'), new Option('Top', 'top'))
    this.font.id = 'output-captions-font'
    this.font.append(...OUTPUT_CAPTION_FONTS.map((font) => new Option(font.label, font.value)))
    this.size.id = 'output-captions-size'
    this.size.type = 'range'
    this.size.min = '24'
    this.size.max = '144'
    this.size.step = '2'
    const sizeField = this.field('Font size', this.size)
    this.sizeLabel = sizeField.firstElementChild as HTMLSpanElement
    this.color.id = 'output-captions-color'
    this.color.type = 'color'
    this.highlight.id = 'output-captions-highlight'
    this.highlight.type = 'color'
    this.borderEnabled.id = 'output-captions-border-enabled'
    this.borderEnabled.type = 'checkbox'
    const borderLabel = this.field('Text border', this.borderEnabled)
    borderLabel.classList.add('output-panel-caption-toggle')
    this.borderColor.id = 'output-captions-border-color'
    this.borderColor.type = 'color'
    this.note.className = 'output-panel-note'
    this.note.setAttribute('role', 'status')
    this.controls.append(
      enabledLabel,
      this.field('Transcript track', this.source),
      this.field('Position', this.position),
      this.field('Font', this.font),
      sizeField,
      this.field('Text color', this.color),
      this.field('Spoken word color', this.highlight),
      borderLabel,
      this.field('Border color', this.borderColor),
      this.note,
    )
    for (const control of [this.enabled, this.source, this.position, this.font, this.size, this.color, this.highlight, this.borderEnabled, this.borderColor]) {
      control.addEventListener('change', () => void this.commit())
    }
    for (const control of [this.size, this.color, this.highlight, this.borderColor]) {
      control.addEventListener('input', () => {
        if (!this.canEdit() || this.saving) return
        this.draft = this.readSettings()
        this.render(this.lastSample)
      })
      control.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !this.draft || this.saving) return
        event.preventDefault()
        event.stopPropagation()
        this.cancelDraft()
      })
      control.addEventListener('pointercancel', () => this.cancelDraft())
    }
    window.addEventListener('blur', () => this.cancelDraft())
    this.canvas.id = 'output-panel-captions'
    this.canvas.className = 'output-panel-captions'
    this.canvas.width = 1920
    this.canvas.height = 1080
    this.canvas.hidden = true
    this.canvas.setAttribute('role', 'img')
    stage.appendChild(this.canvas)
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('Could not create a canvas context for captions')
    this.context = context
    this.syncControls()
  }

  setProject(project: Project): void {
    if (project !== this.project) this.draft = null
    this.project = project
    for (const clip of project.getClips()) {
      if (this.observedClips.has(clip)) continue
      this.observedClips.add(clip)
      void ProjectManager.addClipListener(clip, () => {
        if (!this.project?.getClips().includes(clip)) return
        this.rebuildSource()
        this.render(this.lastSample)
      })
    }
    const tracks = project.getTracks()
    const changed = tracks.length !== this.tracks.length || tracks.some((track, index) =>
      track !== this.tracks[index] || this.source.options[index + 2]?.text !== track.name,
    )
    if (changed || this.source.options.length === 0) {
      this.tracks = [...tracks]
      this.source.replaceChildren(
        new Option('Automatic (first audible transcript)', 'automatic'),
        new Option('Loudest speaking track', 'loudest'),
        ...tracks.map((track, index) => new Option(track.name, String(index))),
      )
    }
    this.rebuildSource()
    if (!this.draft) this.syncControls()
    this.render(this.lastSample)
  }

  render(sample: number): void {
    this.lastSample = sample
    const settings = this.settings()
    const editable = this.project !== null && this.canEdit() && !this.saving
    const controlsEditable = editable && settings.enabled
    if (this.enabled.disabled === editable) this.enabled.disabled = !editable
    if (controlsEditable !== this.controlsEditable) {
      this.controlsEditable = controlsEditable
      for (const control of [this.source, this.position, this.font, this.size, this.color, this.highlight, this.borderEnabled]) {
        control.disabled = !controlsEditable
      }
    }
    const borderColorEditable = controlsEditable && settings.borderEnabled !== false
    if (this.borderColor.disabled === borderColorEditable) this.borderColor.disabled = !borderColorEditable
    if (settings.fontSize !== this.shownSize) {
      this.shownSize = settings.fontSize
      this.sizeLabel.textContent = `Font size (${settings.fontSize} px)`
    }
    if (settings.followLoudest && this.project && this.captionSource?.updateLevels(this.project)) {
      this.refreshSourceNote()
    }
    const cue = settings.enabled ? this.captionSource?.getCue(sample) ?? null : null
    if (!cue) {
      if (!this.canvas.hidden) this.canvas.hidden = true
      this.paintedCue = null
      return
    }
    const word = findOutputCaptionWord(cue, sample)
    if (cue !== this.paintedCue || word !== this.paintedWord || settings !== this.paintedSettings) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
      paintOutputCaption(this.context, cue, word, settings, 0, 0, this.canvas.width, this.canvas.height)
      this.canvas.dataset.position = settings.position ?? 'bottom'
      const text = cue.words.map((word) => word.text).join(' ')
      this.canvas.setAttribute('aria-label', `Captions: ${text}${word < 0 ? '' : ` — spoken word: ${cue.words[word].text}`}`)
      this.paintedCue = cue
      this.paintedWord = word
      this.paintedSettings = settings
    }
    if (this.canvas.hidden) this.canvas.hidden = false
  }

  private field(text: string, control: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
    const label = document.createElement('label')
    label.className = 'output-panel-field'
    label.htmlFor = control.id
    const title = document.createElement('span')
    title.textContent = text
    label.append(title, control)
    return label
  }

  private settings(): Readonly<OutputCaptionSettings> {
    return this.draft ?? this.project?.outputCaptions ?? DEFAULT_OUTPUT_CAPTIONS
  }

  private readSettings(): OutputCaptionSettings {
    return {
      enabled: this.enabled.checked,
      track: this.tracks[this.source.selectedIndex - 2] ?? null,
      followLoudest: this.source.value === 'loudest',
      position: this.position.value as OutputCaptionSettings['position'],
      fontFamily: this.font.value,
      fontSize: this.size.valueAsNumber,
      color: this.color.value,
      highlightColor: this.highlight.value,
      borderEnabled: this.borderEnabled.checked,
      borderColor: this.borderColor.value,
    }
  }

  private syncControls(): void {
    const settings = this.settings()
    this.enabled.checked = settings.enabled
    const trackIndex = settings.track === null ? -1 : this.tracks.indexOf(settings.track)
    this.source.selectedIndex = settings.followLoudest ? 1 : trackIndex < 0 ? 0 : trackIndex + 2
    this.position.value = settings.position ?? 'bottom'
    this.font.value = settings.fontFamily
    this.size.value = String(settings.fontSize)
    this.color.value = settings.color
    this.highlight.value = settings.highlightColor
    this.borderEnabled.checked = settings.borderEnabled !== false
    this.borderColor.value = settings.borderColor ?? DEFAULT_OUTPUT_CAPTIONS.borderColor!
    this.controlsEditable = null
  }

  private rebuildSource(): void {
    const settings = this.settings()
    this.captionSource = this.project ? new OutputCaptionSource(this.project, settings) : null
    this.paintedCue = null
    this.refreshSourceNote()
  }

  private refreshSourceNote(): void {
    const settings = this.settings()
    const status = this.captionSource?.hasCues
      ? 'Short fragments follow the timeline in preview and MP4 export. Font size uses the 1920×1080 composition.'
      : 'No played transcript found. Transcribe a track in Tracks → Transcript, then choose it here. Automatic uses the first audible track with a transcript.'
    this.note.textContent = settings.followLoudest
      ? `${status} Loudest speaking track switches between speaking captioned tracks, respecting mute, solo, and gain, using approximately 100 ms waveform levels before effects.`
      : status
  }

  private cancelDraft(): void {
    if (!this.draft || this.saving) return
    this.draft = null
    this.syncControls()
    this.render(this.lastSample)
  }

  private async commit(): Promise<void> {
    const project = this.project
    if (!project || !this.canEdit() || this.saving) return
    const requested = this.readSettings()
    const current = project.outputCaptions
    if ((Object.keys(requested) as (keyof OutputCaptionSettings)[]).every((key) => requested[key] === current[key])) {
      this.cancelDraft()
      return
    }
    this.draft = requested
    this.saving = true
    this.rebuildSource()
    this.render(this.lastSample)
    let command: SetOutputCaptionsCommand | null = null
    try {
      const action = {
        perform: async () => {
          if (await ProjectManager.getActiveProject() !== project || !this.canEdit()) throw cancelledEdit
          if (requested.track && !project.getTracks().includes(requested.track)) throw cancelledEdit
          command ??= new SetOutputCaptionsCommand(project, project.outputCaptions, requested)
          await command.perform()
        },
        undo: async () => { await command!.undo() },
        save: async () => { await command!.save() },
        toString: () => 'change output captions',
      }
      await editorHistory.execute(action)
    } catch (error) {
      if (error !== cancelledEdit)
        NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.saving = false
      this.draft = null
      this.rebuildSource()
      this.syncControls()
      this.render(this.lastSample)
    }
  }
}
