import { EffectPanelController } from '../../ui/effects/EffectPanelController'
import { ProjectManager } from '../../project/ProjectManager'
import { Track } from '../../project/Track'
import { EditorHistory } from '../undo/EditorHistory'
import { SetTrackPropertyCommand, TrackProperty } from '../undo/UndoableActions'
import { PeakMeterController } from '../PeakMeterController'
import { Project } from '../../project/Project'
import type { TrackDisplayMode } from './TrackDisplayMode'
import { createSvgIcon } from '../SvgIcon'

let nextDisplayModeMenuId = 0

export class TrackListTrack {
  private readonly peakMeter: PeakMeterController

  constructor(
    private readonly project: Project,
    track: Track,
    private readonly trackInfoDiv: HTMLDivElement,
    private readonly history: EditorHistory,
    initialDisplayMode: TrackDisplayMode,
    onDisplayModeChange: (mode: TrackDisplayMode) => void,
  ) {
    this.trackInfoDiv.classList = 'track-info tracklist-item'

    const trackHeading = document.createElement('div')
    trackHeading.className = 'track-heading'

    const trackTitle = document.createElement('div')
    trackTitle.style.padding = '.25rem'
    trackTitle.style.textWrap = 'pretty'
    trackTitle.style.width = '100%'
    trackTitle.style.boxSizing = 'border-box'
    trackTitle.style.height = '100%'
    trackTitle.style.overflow = 'hidden'
    trackTitle.style.wordBreak = 'break-all'
    trackTitle.innerText = track.name

    let titleEditStart = track.name
    trackTitle.addEventListener('dblclick', () => {
      titleEditStart = track.name
      this.makeEditable(trackTitle)
    })
    trackTitle.addEventListener('blur', () => this.saveChanges(trackTitle, track, titleEditStart))

    trackHeading.appendChild(trackTitle)
    this.trackInfoDiv.appendChild(trackHeading)

    const deleteTrackButton = document.createElement('div')
    deleteTrackButton.className = 'clickable'
    deleteTrackButton.style.height = '1.5rem'
    deleteTrackButton.style.width = '1.5rem'
    deleteTrackButton.style.flex = '0 0 1'
    deleteTrackButton.style.gridArea = 'delete'
    deleteTrackButton.style.alignSelf = 'center'
    deleteTrackButton.style.justifySelf = 'center'
    const deleteTrackIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    deleteTrackIcon.setAttribute('viewBox', '0 0 500 500')
    const trashIcon = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    trashIcon.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#trash')
    deleteTrackIcon.appendChild(trashIcon)
    deleteTrackButton.appendChild(deleteTrackIcon)
    this.trackInfoDiv.appendChild(deleteTrackButton)

    const effectButton = document.createElement('button')
    effectButton.style.gridArea = 'effects'
    effectButton.style.width = '100%'
    effectButton.style.boxSizing = 'border-box'
    effectButton.style.font = 'inherit'
    effectButton.style.minWidth = '0'
    effectButton.style.textAlign = 'center'
    effectButton.style.objectFit = 'contain'
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
    gainSliderParent.style.width = '100%'
    gainSliderParent.style.display = 'grid'
    gainSliderParent.style.gridArea = 'gain'
    gainSliderParent.style.position = 'relative'
    gainSliderParent.style.padding = '0 .25rem'
    gainSliderParent.style.boxSizing = 'border-box'
    this.trackInfoDiv.appendChild(gainSliderParent)

    const gainSlider = document.createElement('input')
    gainSlider.type = 'range'
    gainSlider.min = '-36'
    gainSlider.max = '36'
    gainSlider.style.width = '100%'
    gainSlider.style.margin = 'auto'
    gainSlider.style.accentColor = 'var(--color)'
    const initialGainNumber = 20 * Math.log10(track.getGain())
    gainSlider.value = `${initialGainNumber}`
    const gainOutput = document.createElement('output')
    gainOutput.classList = 'slider-value'
    this.updateGainOutput(gainOutput, initialGainNumber)
    gainSlider.oninput = () => {
      const gainNumber = Number(gainSlider.value)
      track.setGain(10 ** (gainNumber / 20))
      this.updateGainOutput(gainOutput, gainNumber)
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
    gainSlider.addEventListener('mouseenter', () => {
      gainOutput.style.opacity = '1'
    })
    gainSlider.addEventListener('mouseleave', () => {
      gainOutput.style.opacity = '0'
    })
    gainSliderParent.appendChild(gainSlider)
    gainSliderParent.appendChild(gainOutput)

    const panSliderParent = document.createElement('div')
    panSliderParent.style.width = '100%'
    panSliderParent.style.display = 'grid'
    panSliderParent.style.gridArea = 'pan'
    panSliderParent.style.position = 'relative'
    panSliderParent.style.padding = '0 .25rem'
    panSliderParent.style.boxSizing = 'border-box'
    this.trackInfoDiv.appendChild(panSliderParent)

    const panSlider = document.createElement('input')
    panSlider.type = 'range'
    panSlider.min = '-10'
    panSlider.max = '10'
    panSlider.style.width = '100%'
    panSlider.style.margin = 'auto'
    panSlider.style.accentColor = 'var(--color)'
    const initialPanValue = track.getPan()
    panSlider.value = `${initialPanValue * 10}`
    panSlider.style.background =
      'repeating-linear-gradient(to right, #000, #000 10%, #000 10%, #000 11%, #000 11%, #000 20%)'
    const panOutput = document.createElement('output')
    panOutput.classList = 'slider-value'
    this.updatePanOutput(panOutput, initialPanValue)

    panSlider.oninput = () => {
      const value = Number(panSlider.value) / 10
      track.setPan(value)
      this.updatePanOutput(panOutput, value)
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
    panSlider.addEventListener('mouseenter', () => {
      panOutput.style.opacity = '1'
    })
    panSlider.addEventListener('mouseleave', () => {
      panOutput.style.opacity = '0'
    })
    panSliderParent.appendChild(panSlider)
    panSliderParent.appendChild(panOutput)

    const displayModeMenu = this.createDisplayModeMenu(track, initialDisplayMode, onDisplayModeChange)
    trackHeading.append(displayModeMenu.button, displayModeMenu.popover)

    const peakMeterDiv = document.createElement('div')
    peakMeterDiv.className = 'track-peak-meter'
    peakMeterDiv.style.gridArea = 'peak'
    this.trackInfoDiv.appendChild(peakMeterDiv)
    this.peakMeter = new PeakMeterController(peakMeterDiv, track, false, track.getChannelCount())
    this.peakMeter.svg.setAttribute('preserveAspectRatio', 'none')
    this.peakMeter.draw(this.peakMeter)

    void ProjectManager.addTrackListener(track, () => {
      if (!trackTitle.isContentEditable) {
        trackTitle.innerText = track.name
      }
      muteButton.title = `Mute ${track.name}`
      muteButton.setAttribute('aria-label', `Mute ${track.name}`)
      soloButton.title = `Solo ${track.name}`
      soloButton.setAttribute('aria-label', `Solo ${track.name}`)
      updateMixButtons()
      displayModeMenu.updateAccessibleName()
      const gainNumber = 20 * Math.log10(track.getGain())
      gainSlider.value = `${gainNumber}`
      this.updateGainOutput(gainOutput, gainNumber)
      const panValue = track.getPan()
      panSlider.value = `${panValue * 10}`
      this.updatePanOutput(panOutput, panValue)
    })

    deleteTrackButton.onclick = (event) => {
      this.history.clear()
      void ProjectManager.deleteTrack(track)
      event.stopPropagation()
      event.preventDefault()
    }
  }

  remove() {
    this.peakMeter.stop()
  }

  private makeEditable(div: HTMLDivElement) {
    div.contentEditable = 'true'
    div.style.maxHeight = '100%'
    div.style.height = '100%'
    div.style.overflow = 'scroll'
    div.focus()

    // Save on Enter or blur
    div.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        div.blur()
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

  private createDisplayModeMenu(
    track: Track,
    initialDisplayMode: TrackDisplayMode,
    onDisplayModeChange: (mode: TrackDisplayMode) => void,
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
    button.addEventListener('click', (event) => event.stopPropagation())

    const modes: ReadonlyArray<{ mode: TrackDisplayMode; label: string }> = [
      { mode: 'waveform', label: 'Waveform' },
      { mode: 'spectrogram', label: 'Spectrogram' },
    ]
    let currentDisplayMode = initialDisplayMode
    const optionButtons = modes.map(({ mode, label }) => {
      const option = document.createElement('button')
      option.type = 'button'
      option.className = 'track-display-mode-option'
      option.setAttribute('role', 'menuitemradio')
      option.textContent = label
      option.addEventListener('click', () => {
        if (mode != currentDisplayMode) {
          currentDisplayMode = mode
          updateMenuState()
          onDisplayModeChange(mode)
        }
        popover.hidePopover()
        button.setAttribute('aria-expanded', 'false')
        button.focus()
      })
      return option
    })
    popover.append(...optionButtons)
    popover.addEventListener('click', (event) => event.stopPropagation())

    const updateAccessibleName = () => {
      const label = modes.find(({ mode }) => mode == currentDisplayMode)!.label
      button.title = `Display mode: ${label}`
      button.setAttribute('aria-label', `Display mode for ${track.name}: ${label}`)
      popover.setAttribute('aria-label', `Display mode for ${track.name}`)
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

    popover.addEventListener('toggle', () => {
      const isOpen = popover.matches(':popover-open')
      button.setAttribute('aria-expanded', `${isOpen}`)
      if (isOpen) positionPopover()
    })
    button.addEventListener('keydown', (event) => {
      if (event.key != 'ArrowDown' && event.key != 'ArrowUp') return
      event.preventDefault()
      if (!popover.matches(':popover-open')) {
        popover.showPopover()
        button.setAttribute('aria-expanded', 'true')
        positionPopover()
      }
      const selectedIndex = modes.findIndex(({ mode }) => mode == currentDisplayMode)
      optionButtons[event.key == 'ArrowUp' ? optionButtons.length - 1 : selectedIndex].focus()
    })
    popover.addEventListener('keydown', (event) => {
      const focusedIndex = optionButtons.indexOf(document.activeElement as HTMLButtonElement)
      let nextIndex: number | null = null
      if (event.key == 'ArrowDown') nextIndex = (focusedIndex + 1) % optionButtons.length
      if (event.key == 'ArrowUp') nextIndex = (focusedIndex - 1 + optionButtons.length) % optionButtons.length
      if (event.key == 'Home') nextIndex = 0
      if (event.key == 'End') nextIndex = optionButtons.length - 1
      if (event.key == 'Escape') {
        event.preventDefault()
        popover.hidePopover()
        button.setAttribute('aria-expanded', 'false')
        button.focus()
        return
      }
      if (nextIndex === null) return
      event.preventDefault()
      optionButtons[nextIndex].focus()
    })

    updateMenuState()
    return { button, popover, updateAccessibleName }
  }

  private async saveChanges(div: HTMLDivElement, track: Track, oldName: string) {
    if (!div.isContentEditable) {
      return
    }
    div.contentEditable = 'false'
    const newName = div.innerText
    div.style.maxHeight = '3em'
    div.style.height = ''
    div.style.overflow = 'hidden'
    div.scrollTo({
      top: 0,
    })

    if (newName != oldName) {
      await this.history.execute(new SetTrackPropertyCommand(track, TrackProperty.TITLE, oldName, newName))
    }
  }

  private updateGainOutput(output: HTMLOutputElement, gainNumber: number) {
    output.value = `gain: ${gainNumber > 0 ? '+' : ''}${gainNumber} dB`
  }

  private updatePanOutput(output: HTMLOutputElement, value: number) {
    if (value == 0) {
      output.value = 'pan: centered'
    } else if (value < 0) {
      output.value = `pan: ${-value * 100}% left`
    } else {
      output.value = `pan: ${value * 100}% right`
    }
  }
}
