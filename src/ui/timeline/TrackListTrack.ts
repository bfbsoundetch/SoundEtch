import { ProjectManager } from '../../project/ProjectManager'
import { Track } from '../../project/Track'

export class TrackListTrack {
  constructor(
    track: Track,
    private readonly trackInfoDiv: HTMLDivElement,
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

    trackTitle.addEventListener('dblclick', () => this.makeEditable(trackTitle, track))
    trackTitle.addEventListener('blur', () => this.saveChanges(trackTitle, track))

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

    const effectsDropdown = document.createElement('select')
    effectsDropdown.disabled = true
    effectsDropdown.title = 'Effect selection is not wired up yet'
    effectsDropdown.style.gridArea = 'effects'
    effectsDropdown.style.width = '100%'
    effectsDropdown.style.boxSizing = 'border-box'
    effectsDropdown.style.font = 'inherit'
    effectsDropdown.style.minWidth = '0'
    effectsDropdown.style.alignSelf = 'center'
    const effectPlaceholder = document.createElement('option')
    effectPlaceholder.innerText = 'Effect'
    effectPlaceholder.value = ''
    effectsDropdown.appendChild(effectPlaceholder)
    this.trackInfoDiv.appendChild(effectsDropdown)

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
    gainOutput.value = `gain: ${initialGainNumber > 0 ? '+' : ''}${initialGainNumber} dB`
    gainSlider.oninput = () => {
      const gainNumber = Number(gainSlider.value)
      track.setGain(10 ** (gainNumber / 20))
      gainOutput.value = `gain: ${gainNumber > 0 ? '+' : ''}${gainNumber} dB`
    }
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
    const initialPanValue = track.getPan() * 10
    panSlider.value = `${initialPanValue}`
    panSlider.style.background =
      'repeating-linear-gradient(to right, #000, #000 10%, #000 10%, #000 11%, #000 11%, #000 20%)'
    const panOutput = document.createElement('output')
    panOutput.classList = 'slider-value'
    if (initialPanValue == 0) {
      panOutput.value = `pan: centered`
    } else if (initialPanValue < 0) {
      panOutput.value = `pan: ${-initialPanValue * 100}% left`
    } else {
      panOutput.value = `pan: ${initialPanValue * 100}% right`
    }

    panSlider.oninput = () => {
      const value = Number(panSlider.value) / 10
      track.setPan(value)
      if (value == 0) {
        panOutput.value = `pan: centered`
      } else if (value < 0) {
        panOutput.value = `pan: ${-value * 100}% left`
      } else {
        panOutput.value = `pan: ${value * 100}% right`
      }
    }
    panSlider.addEventListener('mouseenter', () => {
      panOutput.style.opacity = '1'
    })
    panSlider.addEventListener('mouseleave', () => {
      panOutput.style.opacity = '0'
    })
    panSliderParent.appendChild(panSlider)
    panSliderParent.appendChild(panOutput)

    const peakMeterDiv = document.createElement('div')
    peakMeterDiv.style.gridArea = 'peak'
    peakMeterDiv.style.height = '100%'
    peakMeterDiv.style.width = '100%'
    this.trackInfoDiv.appendChild(peakMeterDiv)

    deleteTrackButton.onclick = () => ProjectManager.deleteTrack(track)
  }

  private makeEditable(div: HTMLDivElement, track: Track) {
    div.contentEditable = 'true'
    div.style.maxHeight = '100%'
    div.style.height = '100%'
    div.style.overflow = 'scroll'
    div.focus()

    // Save on Enter or blur
    div.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.blur()
      }
    })
  }

  private saveChanges(div: HTMLDivElement, track: Track) {
    div.contentEditable = 'false'
    track.name = div.innerText
    div.style.maxHeight = '3em'
    div.style.height = ''
    div.style.overflow = 'hidden'
    div.scrollTo({
      top: 0,
    })

    ProjectManager.saveTrack(track)
  }
}
