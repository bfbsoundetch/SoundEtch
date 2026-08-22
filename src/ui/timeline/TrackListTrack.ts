import { EffectPanelController } from '../../ui/effects/EffectPanelController'
import { ProjectManager } from '../../project/ProjectManager'
import { Track } from '../../project/Track'
import { EditorHistory } from '../undo/EditorHistory'
import { SetTrackPropertyCommand, TrackProperty } from '../undo/UndoableActions'
import { PeakMeterController } from '../PeakMeterController'

export class TrackListTrack {
  private readonly peakMeter: PeakMeterController

  constructor(
    track: Track,
    private readonly trackInfoDiv: HTMLDivElement,
    private readonly history: EditorHistory,
  ) {
    this.trackInfoDiv.classList = 'track-info tracklist-item'

    const trackTitle = document.createElement('div')
    trackTitle.style.padding = '.25rem'
    trackTitle.style.textWrap = 'pretty'
    trackTitle.style.width = '100%'
    trackTitle.style.boxSizing = 'border-box'
    trackTitle.style.maxHeight = '3em'
    trackTitle.style.overflow = 'hidden'
    trackTitle.style.wordBreak = 'break-all'
    trackTitle.style.gridArea = 'title'
    trackTitle.innerText = track.name

    let titleEditStart = track.name
    trackTitle.addEventListener('dblclick', () => {
      titleEditStart = track.name
      this.makeEditable(trackTitle)
    })
    trackTitle.addEventListener('blur', () => this.saveChanges(trackTitle, track, titleEditStart))

    this.trackInfoDiv.appendChild(trackTitle)

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
    this.trackInfoDiv.appendChild(effectButton)

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

    const peakMeterDiv = document.createElement('div')
    peakMeterDiv.className = 'track-peak-meter'
    peakMeterDiv.style.gridArea = 'peak'
    this.trackInfoDiv.appendChild(peakMeterDiv)
    this.peakMeter = new PeakMeterController(peakMeterDiv, track)
    this.peakMeter.svg.setAttribute('preserveAspectRatio', 'none')
    this.peakMeter.draw(this.peakMeter)

    void ProjectManager.addTrackListener(track, () => {
      if (!trackTitle.isContentEditable) {
        trackTitle.innerText = track.name
      }
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
