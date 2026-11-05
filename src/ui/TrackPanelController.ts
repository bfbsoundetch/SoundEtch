import { AudioControl, AudioState, isRecordingState } from '../audiocontext/AudioControl'
import type { Project } from '../project/Project'
import type { Track } from '../project/Track'
import { resolveVideoFrame } from '../video/VideoFrameResolver'
import { VideoPreview } from '../video/VideoPreview'
import { BottomPanelController } from './BottomPanelController'
import { EffectPanelController } from './effects/EffectPanelController'
import { NotificationsController } from './NotificationsController'
import type { TrackListController } from './timeline/TrackListController'
import { getTrackTranscriptEntries, type TrackTranscriptEntry } from './transcript/TrackTranscript'
import { TranscriptPanelController } from './TranscriptPanelController'

export type TrackSection = 'effects' | 'video' | 'transcript'

const SECTIONS: readonly TrackSection[] = ['effects', 'video', 'transcript']
const SECTION_LABELS: Record<TrackSection, string> = { effects: 'Effects', video: 'Video', transcript: 'Transcript' }

function hasVideo(track: Track): boolean {
  return track.clipViews.some((view) => view.clip.videoSegments.length > 0)
}

/**
 * The top panel's Tracks tab: a track chooser and vertical Effects, Video and Transcript tabs for that track.
 * The effect catalog, effect editors and automation open over it in the same tab and return to it.
 */
export class TrackPanelController {
  readonly transcript: TranscriptPanelController
  private readonly shell = BottomPanelController.getInstance()
  private readonly content = document.createElement('section')
  private readonly nav = document.createElement('div')
  private readonly trackSelect = document.createElement('select')
  private readonly sectionTabs = {} as Record<TrackSection, HTMLButtonElement>
  private readonly sectionPanels = {} as Record<TrackSection, HTMLElement>
  private readonly effects = document.createElement('div')
  private readonly stage = document.createElement('div')
  private readonly canvas = document.createElement('canvas')
  private readonly status = document.createElement('p')
  private readonly noVideoMessage = document.createElement('p')
  private readonly transcribePrompt = document.createElement('div')
  private readonly emptyMessage = document.createElement('p')
  private readonly preview: VideoPreview
  private readonly resizeObserver: ResizeObserver
  private project: Project | null = null
  private tracks: Track[] = []
  private selectedTrack: Track | null = null
  private section: TrackSection = 'effects'
  private renderedTrack: Track | null = null
  /** What the effect chain was last built from; refreshes rebuild it only when it changes. */
  private renderedEffects = ''
  private rootShown = false
  private videoRunning = false
  private animationFrame = 0
  private geometryChanged = true
  private showingEmpty = true

  constructor(private readonly trackListController: TrackListController) {
    this.transcript = new TranscriptPanelController(trackListController)
    this.content.className = 'track-panel-content'

    this.nav.className = 'track-panel-nav'
    const trackLabel = document.createElement('label')
    trackLabel.textContent = 'Track'
    this.trackSelect.id = 'track-panel-track'
    trackLabel.htmlFor = this.trackSelect.id
    const tabList = document.createElement('div')
    tabList.className = 'track-panel-tabs'
    tabList.setAttribute('role', 'tablist')
    tabList.setAttribute('aria-orientation', 'vertical')
    tabList.setAttribute('aria-label', 'Track views')
    this.nav.append(trackLabel, this.trackSelect, tabList)
    this.content.appendChild(this.nav)

    for (const section of SECTIONS) {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.id = `track-panel-${section}-tab`
      tab.className = 'clickable track-panel-tab'
      tab.textContent = SECTION_LABELS[section]
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', `track-panel-${section}`)
      tab.addEventListener('click', () => this.selectSection(section))
      tabList.appendChild(tab)
      this.sectionTabs[section] = tab

      const panel = document.createElement('div')
      panel.id = `track-panel-${section}`
      panel.className = 'track-panel-section'
      panel.tabIndex = 0
      panel.setAttribute('role', 'tabpanel')
      panel.setAttribute('aria-labelledby', tab.id)
      this.content.appendChild(panel)
      this.sectionPanels[section] = panel
    }
    tabList.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
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
      this.selectSection(SECTIONS[next])
      this.sectionTabs[SECTIONS[next]].focus()
      event.preventDefault()
      event.stopPropagation()
    })

    this.effects.className = 'track-panel-effects'
    this.sectionPanels.effects.appendChild(this.effects)

    this.stage.className = 'video-preview-stage'
    this.canvas.setAttribute('role', 'img')
    this.status.className = 'video-preview-status'
    this.status.setAttribute('role', 'status')
    this.stage.append(this.canvas, this.status)
    this.noVideoMessage.className = 'bottom-panel-message'
    this.noVideoMessage.textContent = 'This track has no video. Import a video file or record with the camera on.'
    this.sectionPanels.video.append(this.stage, this.noVideoMessage)

    this.transcribePrompt.className = 'bottom-panel-message'
    const transcribeText = document.createElement('p')
    transcribeText.textContent = 'This track has no transcript yet.'
    const transcribeButton = document.createElement('button')
    transcribeButton.type = 'button'
    transcribeButton.className = 'bordered clickable track-panel-transcribe'
    transcribeButton.textContent = 'Transcribe track'
    transcribeButton.addEventListener('click', () => {
      const track = this.selectedTrack
      if (track) void this.trackListController.transcribeTrack(track)
    })
    this.transcribePrompt.append(transcribeText, transcribeButton)

    this.emptyMessage.className = 'bottom-panel-message'
    this.emptyMessage.textContent = 'No tracks yet. Record or add a clip to see its effects, video, and transcript.'
    this.content.appendChild(this.emptyMessage)

    this.preview = new VideoPreview(
      this.canvas,
      (message) => this.setStatus(message),
      (error) => NotificationsController.showError(error),
    )
    this.trackSelect.addEventListener('change', () => {
      this.selectedTrack = this.tracks[this.trackSelect.selectedIndex] ?? null
      this.update()
    })
    this.resizeObserver = new ResizeObserver(() => {
      this.geometryChanged = true
    })
    this.shell.setRootView('tracks', () => this.openRoot())
    this.shell.addVisibilityListener('tracks', () => this.update())
    this.setSection(this.section)
    this.openRoot()
  }

  /** Shows `track`, or the current track, in the Tracks tab and opens the panel there. */
  show(track?: Track, section?: TrackSection): void {
    this.refreshData()
    if (track && this.tracks.includes(track)) this.selectedTrack = track
    if (section) this.setSection(section)
    this.openRoot()
    this.shell.reveal('tracks')
  }

  /** Opens `track`'s transcript and selects the placed occurrence `entry`. */
  showTranscript(track: Track, entry: TrackTranscriptEntry): void {
    this.show(track, 'transcript')
    if (this.transcript.track === track) this.transcript.selectEntry(entry)
  }

  refreshData(project = this.project): void {
    if (!project) return
    const switched = project !== this.project
    if (switched) {
      this.project = project
      this.selectedTrack = null
      // The footage belongs to the previous project; do not keep its input open.
      this.preview.release()
    }
    const tracks = project.getTracks()
    if (
      tracks.length !== this.tracks.length ||
      tracks.some((track, i) => track !== this.tracks[i] || this.trackSelect.options[i]?.textContent !== track.name)
    ) {
      this.tracks = [...tracks]
      this.trackSelect.replaceChildren(
        ...tracks.map((track) => {
          const option = document.createElement('option')
          option.textContent = track.name
          return option
        }),
      )
    }
    const removed = this.selectedTrack !== null && !tracks.includes(this.selectedTrack)
    if (this.selectedTrack === null || removed) this.selectedTrack = tracks[0] ?? null
    // Views over the tab show another project's or a deleted track's data, so they must not stay up.
    if (switched || removed) this.openRoot()
    else this.update()
  }

  private openRoot(): void {
    this.shell.open({
      tab: 'tracks',
      owner: this,
      body: this.content,
      onClose: () => {
        this.rootShown = false
        this.update()
      },
    })
    this.rootShown = true
    this.update()
  }

  private setSection(section: TrackSection): void {
    this.section = section
    for (const other of SECTIONS) {
      const selected = other === section
      this.sectionTabs[other].setAttribute('aria-selected', `${selected}`)
      this.sectionTabs[other].tabIndex = selected ? 0 : -1
    }
  }

  private selectSection(section: TrackSection): void {
    this.setSection(section)
    this.update()
  }

  /** Brings the tab in line with the selected track and section, and runs only the views that can be seen. */
  private update(): void {
    const track = this.selectedTrack
    this.nav.hidden = track === null
    this.emptyMessage.hidden = track !== null
    for (const section of SECTIONS) this.sectionPanels[section].hidden = track === null || section !== this.section
    if (track) {
      this.trackSelect.selectedIndex = this.tracks.indexOf(track)
      if (track !== this.renderedTrack) {
        this.preview.clear()
        this.showingEmpty = true
        this.geometryChanged = true
        this.canvas.setAttribute('aria-label', `Video preview: ${track.name}`)
      }
      const effects = [
        track.name,
        ...track.effectRegions.map((effect) => `${effect.instanceId}:${effect.id}:${effect.bypassed ?? false}`),
      ].join('|')
      if (track !== this.renderedTrack || effects !== this.renderedEffects) {
        this.renderedEffects = effects
        this.effects.replaceChildren(EffectPanelController.getInstance().createEffectsChain(track))
      }
      const video = hasVideo(track)
      this.stage.hidden = !video
      this.noVideoMessage.hidden = video
    } else {
      this.effects.replaceChildren()
      this.renderedEffects = ''
    }
    this.renderedTrack = track
    const showing = track !== null && this.rootShown && this.shell.isVisible('tracks')
    this.updateTranscript(showing && this.section === 'transcript' ? track : null)
    this.updateVideo(showing && this.section === 'video' && hasVideo(track))
  }

  /** The transcript stays live, following selection and playback, only while it can be seen. */
  private updateTranscript(track: Track | null): void {
    const panel = this.sectionPanels.transcript
    if (track && getTrackTranscriptEntries(track).length > 0) {
      const content = this.transcript.activate(track)
      if (panel.firstElementChild !== content) panel.replaceChildren(content)
      return
    }
    this.transcript.deactivate()
    if (panel.firstElementChild !== this.transcribePrompt) panel.replaceChildren(this.transcribePrompt)
  }

  /** Decodes only while the picture can be seen. */
  private updateVideo(run: boolean): void {
    if (run === this.videoRunning) return
    this.videoRunning = run
    this.geometryChanged = true
    this.showingEmpty = true
    if (run) {
      this.resizeObserver.observe(this.stage)
      this.tick()
    } else {
      cancelAnimationFrame(this.animationFrame)
      this.resizeObserver.disconnect()
      this.preview.release()
    }
  }

  private readonly tick = (): void => {
    if (!this.videoRunning) return
    this.drawVideo()
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private drawVideo(): void {
    // The clock also refreshes the tab: saves and live placement edits need no permanent listeners.
    this.refreshData()
    const project = this.project
    const track = this.selectedTrack
    if (!this.videoRunning || !project || !track) return
    const state = AudioControl.getState()
    if (isRecordingState(state)) {
      this.showEmpty('Recording — timeline preview available after stop.')
      return
    }
    const playing = state === AudioState.PLAYING || state === AudioState.PLAYING_PAUSED
    // A selected region owns the stopped cursor until marker dragging clears the selection.
    const sample = playing
      ? (AudioControl.audioContext?.getPosition() ?? AudioControl.startPosition)
      : (this.trackListController.selectedRegion?.startSample ?? AudioControl.startPosition)
    const target = resolveVideoFrame(track.clipViews, sample, project.sampleRate)
    if (!target) {
      this.showEmpty('No video at this timeline position.')
      return
    }
    this.showingEmpty = false
    this.preview.request(project.directoryName, project.sampleRate, target, this.geometryChanged)
    this.geometryChanged = false
  }

  private showEmpty(message: string): void {
    if (!this.showingEmpty || this.status.textContent !== message) this.preview.clear()
    this.showingEmpty = true
    this.setStatus(message)
  }

  private setStatus(message: string): void {
    if (this.status.textContent !== message) this.status.textContent = message
    this.status.hidden = message.length === 0
  }
}
