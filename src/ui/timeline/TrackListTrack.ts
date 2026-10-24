import { EffectPanelController } from '../../ui/effects/EffectPanelController'
import { ProjectManager } from '../../project/ProjectManager'
import { Track } from '../../project/Track'
import { EditorHistory } from '../undo/EditorHistory'
import { SetTrackPropertyCommand, TrackProperty } from '../undo/UndoableActions'
import { PeakMeterController } from '../PeakMeterController'
import { Project } from '../../project/Project'
import type { TrackDisplayMode } from './TrackDisplayMode'
import { createSvgIcon } from '../SvgIcon'
import { announce } from '../LiveAnnouncer'

let nextDisplayModeMenuId = 0

export type TrackMenuActions = {
  onDisplayModeChange: (mode: TrackDisplayMode) => void
  hasTranscript: () => boolean
  onShowTranscript: () => void
  onChangeHeight: (deltaRem: number) => void
  onShowVideo: () => void
}

export class TrackListTrack {
  private readonly peakMeter: PeakMeterController

  constructor(
    private readonly project: Project,
    track: Track,
    private readonly trackInfoDiv: HTMLDivElement,
    private readonly history: EditorHistory,
    initialDisplayMode: TrackDisplayMode,
    actions: TrackMenuActions,
  ) {
    this.trackInfoDiv.classList = 'track-info tracklist-item'

    const trackHeading = document.createElement('div')
    trackHeading.className = 'track-heading'

    const trackTitle = document.createElement('div')
    trackTitle.className = 'track-title'
    trackTitle.innerText = track.name
    trackTitle.id = `track-title-${track.id}`
    this.trackInfoDiv.setAttribute('role', 'group')
    this.trackInfoDiv.setAttribute('aria-labelledby', trackTitle.id)

    let titleEditStart = track.name
    const trackMenu = this.createTrackMenu(track, initialDisplayMode, actions, () => {
      titleEditStart = track.name
      this.makeEditable(trackTitle, titleEditStart, trackMenu.button)
    })
    trackTitle.addEventListener('dblclick', () => {
      titleEditStart = track.name
      this.makeEditable(trackTitle, titleEditStart, trackMenu.button)
    })
    trackTitle.addEventListener('blur', () => this.saveChanges(trackTitle, track, titleEditStart))

    trackHeading.appendChild(trackTitle)
    this.trackInfoDiv.appendChild(trackHeading)
    // Shown by CSS only while the track has a video lane.
    const videoButton = document.createElement('button')
    videoButton.type = 'button'
    videoButton.className = 'track-video-button clickable'
    videoButton.textContent = 'Video'
    const updateVideoButtonName = () => videoButton.setAttribute('aria-label', `Video for ${track.name}`)
    updateVideoButtonName()
    videoButton.addEventListener('click', actions.onShowVideo)
    this.trackInfoDiv.appendChild(videoButton)

    const deleteTrackButton = document.createElement('button')
    deleteTrackButton.type = 'button'
    deleteTrackButton.className = 'clickable track-delete-button'
    deleteTrackButton.appendChild(createSvgIcon('trash'))
    const updateDeleteButtonName = () => {
      deleteTrackButton.title = `Delete ${track.name}`
      deleteTrackButton.setAttribute('aria-label', `Delete track ${track.name}`)
    }
    updateDeleteButtonName()
    this.trackInfoDiv.appendChild(deleteTrackButton)

    const effectButton = document.createElement('button')
    effectButton.classList = 'track-effect-selector clickable'
    effectButton.innerText = 'Effects'
    effectButton.addEventListener('click', () => {
      EffectPanelController.getInstance().showTrackEffectsList(track)
    })
    ProjectManager.addTrackListener(track, () => {
      effectButton.innerText = 'Effects' + (track.effectRegions.length > 0 ? ` (${track.effectRegions.length})` : '')
    })
    this.trackInfoDiv.appendChild(effectButton)

    const mixControls = document.createElement('div')
    mixControls.className = 'track-mix-controls'
    const muteButton = this.createMixButton('Mute', `Mute ${track.name}`, 'track-mute-button')
    const soloButton = this.createMixButton('Solo', `Solo ${track.name}`, 'track-solo-button')
    const updateMixButtons = () => {
      muteButton.setAttribute('aria-pressed', `${track.isMuted()}`)
      soloButton.setAttribute('aria-pressed', `${track.isSoloed()}`)
    }
    muteButton.addEventListener('click', () => {
      this.project.setTrackMuted(track, !track.isMuted())
      updateMixButtons()
      void ProjectManager.saveTrack(track)
    })
    soloButton.addEventListener('click', () => {
      this.project.setTrackSoloed(track, !track.isSoloed())
      updateMixButtons()
      void ProjectManager.saveTrack(track)
    })
    updateMixButtons()
    mixControls.append(muteButton, soloButton)
    this.trackInfoDiv.appendChild(mixControls)

    const gainSliderParent = document.createElement('div')
    gainSliderParent.className = 'track-slider-controls track-gain-controls'
    this.trackInfoDiv.appendChild(gainSliderParent)

    const gainSlider = document.createElement('input')
    gainSlider.type = 'range'
    gainSlider.className = 'track-slider'
    gainSlider.min = '-36'
    gainSlider.max = '36'
    const initialGainNumber = 20 * Math.log10(track.getGain())
    gainSlider.value = `${initialGainNumber}`
    const gainOutput = document.createElement('output')
    gainOutput.classList = 'slider-value'
    gainOutput.setAttribute('aria-hidden', 'true')
    gainSlider.setAttribute('aria-label', `Gain for ${track.name}`)
    this.updateGainOutput(gainOutput, gainSlider, initialGainNumber)
    gainSlider.oninput = () => {
      const gainNumber = Number(gainSlider.value)
      track.setGain(10 ** (gainNumber / 20))
      this.updateGainOutput(gainOutput, gainSlider, gainNumber)
    }
    let gainEditStart = track.getGain()
    const startGainEdit = () => {
      gainEditStart = track.getGain()
    }
    const commitGainEdit = async () => {
      const newGain = track.getGain()
      if (newGain == gainEditStart) {
        return
      }
      await this.history.recordApplied(new SetTrackPropertyCommand(track, TrackProperty.GAIN, gainEditStart, newGain))
      gainEditStart = newGain
    }
    gainSlider.addEventListener('pointerdown', startGainEdit)
    gainSlider.addEventListener('focus', startGainEdit)
    gainSlider.addEventListener('change', () => {
      void commitGainEdit()
    })
    gainSliderParent.appendChild(gainSlider)
    gainSliderParent.appendChild(gainOutput)

    const panSliderParent = document.createElement('div')
    panSliderParent.className = 'track-slider-controls track-pan-controls'
    this.trackInfoDiv.appendChild(panSliderParent)

    const panSlider = document.createElement('input')
    panSlider.type = 'range'
    panSlider.className = 'track-slider'
    panSlider.min = '-10'
    panSlider.max = '10'
    const initialPanValue = track.getPan()
    panSlider.value = `${initialPanValue * 10}`
    const panOutput = document.createElement('output')
    panOutput.classList = 'slider-value'
    panOutput.setAttribute('aria-hidden', 'true')
    panSlider.setAttribute('aria-label', `Pan for ${track.name}`)
    this.updatePanOutput(panOutput, panSlider, initialPanValue)

    panSlider.oninput = () => {
      const value = Number(panSlider.value) / 10
      track.setPan(value)
      this.updatePanOutput(panOutput, panSlider, value)
    }
    let panEditStart = track.getPan()
    const startPanEdit = () => {
      panEditStart = track.getPan()
    }
    const commitPanEdit = async () => {
      const newPan = track.getPan()
      if (newPan == panEditStart) {
        return
      }
      await this.history.recordApplied(new SetTrackPropertyCommand(track, TrackProperty.PAN, panEditStart, newPan))
      panEditStart = newPan
    }
    panSlider.addEventListener('pointerdown', startPanEdit)
    panSlider.addEventListener('focus', startPanEdit)
    panSlider.addEventListener('change', () => {
      void commitPanEdit()
    })
    panSliderParent.appendChild(panSlider)
    panSliderParent.appendChild(panOutput)

    trackHeading.append(trackMenu.button, trackMenu.popover)

    const peakMeterDiv = document.createElement('div')
    peakMeterDiv.className = 'track-peak-meter'
    this.trackInfoDiv.appendChild(peakMeterDiv)
    this.peakMeter = new PeakMeterController(peakMeterDiv, track, false, track.getChannelCount())
    this.peakMeter.svg.setAttribute('preserveAspectRatio', 'none')
    this.peakMeter.draw(this.peakMeter)
    this.peakMeter.setLabel(`Level meter for ${track.name}`)

    void ProjectManager.addTrackListener(track, () => {
      if (!trackTitle.isContentEditable) {
        trackTitle.innerText = track.name
      }
      muteButton.title = `Mute ${track.name}`
      muteButton.setAttribute('aria-label', `Mute ${track.name}`)
      soloButton.title = `Solo ${track.name}`
      soloButton.setAttribute('aria-label', `Solo ${track.name}`)
      updateMixButtons()
      updateDeleteButtonName()
      trackMenu.updateAccessibleName()
      updateVideoButtonName()
      gainSlider.setAttribute('aria-label', `Gain for ${track.name}`)
      panSlider.setAttribute('aria-label', `Pan for ${track.name}`)
      this.peakMeter.setLabel(`Level meter for ${track.name}`)
      const gainNumber = 20 * Math.log10(track.getGain())
      gainSlider.value = `${gainNumber}`
      this.updateGainOutput(gainOutput, gainSlider, gainNumber)
      const panValue = track.getPan()
      panSlider.value = `${panValue * 10}`
      this.updatePanOutput(panOutput, panSlider, panValue)
    })

    deleteTrackButton.onclick = (event) => {
      if (!globalThis.confirm(`Are you sure you want to delete track \"${track.name}\"?`)) {
        return
      }
      const tracks = this.project.getTracks()
      const trackIndex = tracks.indexOf(track)
      const neighbour = tracks[trackIndex + 1] ?? (trackIndex > 0 ? tracks[trackIndex - 1] : undefined)
      this.history.clear()
      void ProjectManager.deleteTrack(track).then(() => {
        const target = neighbour
          ? document.querySelector<HTMLElement>(
              `#track-info-list [data-track-id="${neighbour.id}"] .track-delete-button`,
            )
          : document.getElementById('third-header-button')
        target?.focus()
        announce(`Deleted track ${track.name}`)
      })
      event.stopPropagation()
      event.preventDefault()
    }
  }

  remove() {
    this.peakMeter.stop()
  }

  private makeEditable(div: HTMLDivElement, oldName: string, returnFocusTo: HTMLElement) {
    div.contentEditable = 'true'
    div.setAttribute('role', 'textbox')
    div.setAttribute('aria-label', 'Track name')
    div.focus()

    // Save on Enter or blur
    div.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        div.blur()
        returnFocusTo.focus()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        div.innerText = oldName
        div.blur()
        returnFocusTo.focus()
      }
    }
  }

  private createMixButton(label: string, title: string, className: string) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `clickable track-mix-button ${className}`
    button.textContent = label
    button.title = title
    button.setAttribute('aria-label', title)
    return button
  }

  private createTrackMenu(
    track: Track,
    initialDisplayMode: TrackDisplayMode,
    actions: TrackMenuActions,
    onRename: () => void,
  ) {
    const popover = document.createElement('div')
    popover.id = `track-display-mode-menu-${++nextDisplayModeMenuId}`
    popover.className = 'track-display-mode-menu'
    popover.setAttribute('popover', 'auto')
    popover.setAttribute('role', 'menu')

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'track-display-mode-menu-button clickable'
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-controls', popover.id)
    button.setAttribute('popovertarget', popover.id)
    button.appendChild(createSvgIcon('three-dots'))

    const modes: ReadonlyArray<{ mode: TrackDisplayMode; label: string }> = [
      { mode: 'waveform', label: 'Waveform' },
      { mode: 'spectrogram', label: 'Spectrogram' },
    ]
    let currentDisplayMode = initialDisplayMode
    const createItem = (label: string, role: 'menuitem' | 'menuitemradio') => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'track-display-mode-option'
      item.setAttribute('role', role)
      item.tabIndex = -1
      item.textContent = label
      return item
    }
    const closeMenu = () => {
      popover.hidePopover()
      button.setAttribute('aria-expanded', 'false')
    }
    const optionButtons = modes.map(({ mode, label }) => {
      const option = createItem(label, 'menuitemradio')
      option.addEventListener('click', () => {
        if (mode != currentDisplayMode) {
          currentDisplayMode = mode
          updateMenuState()
          actions.onDisplayModeChange(mode)
        }
        closeMenu()
        button.focus()
      })
      return option
    })
    const separator = document.createElement('div')
    separator.setAttribute('role', 'separator')
    separator.className = 'track-menu-separator'
    const renameItem = createItem('Rename track…', 'menuitem')
    renameItem.addEventListener('click', () => {
      closeMenu()
      onRename()
    })
    const transcriptItem = createItem('Show transcript', 'menuitem')
    // A transcript can be added or removed between openings of the menu.
    const refreshTranscriptItem = () => {
      transcriptItem.hidden = !actions.hasTranscript()
    }
    refreshTranscriptItem()
    transcriptItem.addEventListener('click', () => {
      closeMenu()
      actions.onShowTranscript()
    })
    const increaseHeightItem = createItem('Increase track height', 'menuitem')
    increaseHeightItem.addEventListener('click', () => {
      actions.onChangeHeight(2)
      button.focus()
    })
    const decreaseHeightItem = createItem('Decrease track height', 'menuitem')
    decreaseHeightItem.addEventListener('click', () => {
      actions.onChangeHeight(-2)
      button.focus()
    })
    popover.append(...optionButtons, separator, renameItem, transcriptItem, increaseHeightItem, decreaseHeightItem)
    popover.addEventListener('click', (event) => event.stopPropagation())

    button.addEventListener('click', (event) => {
      event.stopPropagation()
      refreshTranscriptItem()
    })

    const updateAccessibleName = () => {
      const label = modes.find(({ mode }) => mode == currentDisplayMode)!.label
      button.title = `Track options (display: ${label})`
      button.setAttribute('aria-label', `Options for ${track.name}`)
      popover.setAttribute('aria-label', `Options for ${track.name}`)
    }
    const updateMenuState = () => {
      updateAccessibleName()
      for (let index = 0; index < modes.length; index++) {
        optionButtons[index].setAttribute('aria-checked', `${modes[index].mode == currentDisplayMode}`)
      }
    }
    const positionPopover = () => {
      const triggerBounds = button.getBoundingClientRect()
      const gap = 4
      const viewportPadding = 8
      const left = Math.max(
        viewportPadding,
        Math.min(triggerBounds.right - popover.offsetWidth, window.innerWidth - popover.offsetWidth - viewportPadding),
      )
      let top = triggerBounds.bottom + gap
      if (top + popover.offsetHeight > window.innerHeight - viewportPadding) {
        top = Math.max(viewportPadding, triggerBounds.top - popover.offsetHeight - gap)
      }
      popover.style.left = `${left}px`
      popover.style.top = `${top}px`
    }

    popover.addEventListener('beforetoggle', (event) => {
      if (event.newState !== 'open') return
      // Closed popovers have no layout; measure invisibly before the browser reveals the menu.
      popover.classList.add('track-display-mode-menu-positioning')
      positionPopover()
      popover.classList.remove('track-display-mode-menu-positioning')
    })
    popover.addEventListener('toggle', () => {
      const isOpen = popover.matches(':popover-open')
      button.setAttribute('aria-expanded', `${isOpen}`)
      if (isOpen) {
        if (!popover.contains(document.activeElement)) {
          optionButtons[modes.findIndex(({ mode }) => mode == currentDisplayMode)].focus()
        }
      }
    })
    popover.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as Node | null
      if (!popover.matches(':popover-open')) return
      if (next && (popover.contains(next) || next === button)) return
      closeMenu()
    })
    button.addEventListener('keydown', (event) => {
      if (event.key != 'ArrowDown' && event.key != 'ArrowUp') return
      event.preventDefault()
      refreshTranscriptItem()
      if (!popover.matches(':popover-open')) {
        popover.showPopover()
        button.setAttribute('aria-expanded', 'true')
      }
      const items = Array.from(popover.querySelectorAll<HTMLButtonElement>('button:not([hidden])'))
      const checkedItem = optionButtons[modes.findIndex(({ mode }) => mode == currentDisplayMode)]
      ;(event.key == 'ArrowUp' ? items[items.length - 1] : checkedItem).focus()
    })
    popover.addEventListener('keydown', (event) => {
      const items = Array.from(popover.querySelectorAll<HTMLButtonElement>('button:not([hidden])'))
      const focusedIndex = items.indexOf(document.activeElement as HTMLButtonElement)
      let nextIndex: number | null = null
      if (event.key == 'ArrowDown') nextIndex = (focusedIndex + 1) % items.length
      if (event.key == 'ArrowUp') nextIndex = (focusedIndex - 1 + items.length) % items.length
      if (event.key == 'Home') nextIndex = 0
      if (event.key == 'End') nextIndex = items.length - 1
      if (event.key == 'Escape') {
        event.preventDefault()
        closeMenu()
        button.focus()
        return
      }
      if (nextIndex === null) return
      event.preventDefault()
      items[nextIndex].focus()
    })

    updateMenuState()
    return { button, popover, updateAccessibleName }
  }

  private async saveChanges(div: HTMLDivElement, track: Track, oldName: string) {
    if (!div.isContentEditable) {
      return
    }
    div.contentEditable = 'false'
    div.removeAttribute('role')
    div.removeAttribute('aria-label')
    const newName = div.innerText
    div.scrollTo({
      top: 0,
    })

    if (newName != oldName) {
      await this.history.execute(new SetTrackPropertyCommand(track, TrackProperty.TITLE, oldName, newName))
    }
  }

  private updateGainOutput(output: HTMLOutputElement, slider: HTMLInputElement, gainNumber: number) {
    const r = Math.round(gainNumber * 10) / 10
    const text = `${r > 0 ? '+' : ''}${r} dB`
    output.value = `gain: ${text}`
    slider.setAttribute('aria-valuetext', text)
  }

  private updatePanOutput(output: HTMLOutputElement, slider: HTMLInputElement, value: number) {
    const text = value == 0 ? 'centered' : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? 'left' : 'right'}`
    output.value = `pan: ${text}`
    slider.setAttribute('aria-valuetext', text)
  }
}
