import { Effect, replaceEffectRegion } from 'effects/Effects'
import { TimeUtils } from 'global/TimeUtils'
import { Track } from 'project/Track'
import { editorHistory } from 'ui/undo/EditorHistory'
import { SetTrackEffectRegionsCommand } from 'ui/undo/UndoableActions'

let openEffectPanelState: { track: Track; effectRegionId: string } | null = null
let effectEditStart: { track: Track; effectRegions: Effect[] } | null = null
let openEffectPanelInput: HTMLInputElement | null = null
let openEffectPanelOutput: HTMLOutputElement | null = null

function openGainEffectPanel(track: Track, effectRegion: Effect) {
  const valueLabelElement = document.createElement('label')
  valueLabelElement.textContent = 'Gain'
  valueLabelElement.htmlFor = 'effect-panel-gain-value'

  const valueSlider = document.createElement('input')
  valueSlider.id = 'effect-panel-gain-value'
  valueSlider.type = 'range'
  valueSlider.min = '-36'
  valueSlider.max = '36'
  valueSlider.step = '0.1'
  valueSlider.value = `${effectRegion.value}`

  const valueOutput = document.createElement('output')
  valueOutput.className = 'slider-value effect-panel-value-output'
  valueOutput.style.opacity = '1'
  updateGainEffectOutput(valueOutput, effectRegion.value)

  valueSlider.addEventListener('pointerdown', () => startEffectRegionEdit(track))
  valueSlider.addEventListener('focus', () => startEffectRegionEdit(track))
  valueSlider.addEventListener('input', () => {
    const value = Number(valueSlider.value)
    updateGainEffectOutput(valueOutput, value)
    updateGainEffectRegion(track, effectRegion.id, value)
  })
  valueSlider.addEventListener('change', () => void commitEffectRegionEdit(track))

  const valueGroup = document.createElement('div')
  valueGroup.className = 'effect-panel-control-group'
  valueGroup.append(valueLabelElement, valueSlider, valueOutput)

  const deleteButton = document.createElement('button')
  deleteButton.className = 'menu-item clickable effect-panel-delete'
  deleteButton.textContent = 'Delete Region'
  deleteButton.type = 'button'
  deleteButton.addEventListener('click', () => void deleteEffectRegion(track, effectRegion.id))

  openEffectPanelInput = valueSlider
  openEffectPanelOutput = valueOutput
  effectPanelController.open({
    title: 'Gain',
    subtitle: getEffectPanelSubtitle(track, effectRegion),
    body: [valueGroup],
    actions: [deleteButton],
    onClose: () => {
      openEffectPanelState = null
      effectEditStart = null
      openEffectPanelInput = null
      openEffectPanelOutput = null
    },
  })
}

function updateGainEffectOutput(output: HTMLOutputElement, value: number) {
  output.value = `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
}

function startEffectRegionEdit(track: Track) {
  if (effectEditStart?.track == track) {
    return
  }
  effectEditStart = {
    track,
    effectRegions: cloneEffectRegions(track.getEffectRegions()),
  }
}

function cloneEffectRegions(effectRegions: Effect[]) {
  return effectRegions.map((effectRegion) => ({ ...effectRegion }))
}

async function deleteEffectRegion(track: Track, effectRegionId: string) {
  const oldEffectRegions = cloneEffectRegions(track.getEffectRegions())
  const newEffectRegions = oldEffectRegions.filter((effectRegion) => effectRegion.id != effectRegionId)
  if (newEffectRegions.length == oldEffectRegions.length) {
    return
  }
  openEffectPanelState = null
  effectEditStart = null
  openEffectPanelInput = null
  openEffectPanelOutput = null
  effectPanelController.hide()
  await editorHistory.execute(new SetTrackEffectRegionsCommand(track, oldEffectRegions, newEffectRegions))
}

function refreshOpenEffectPanel() {
  if (!openEffectPanelState) {
    return
  }
  const effectRegion = openEffectPanelState.track.getEffectRegionById(openEffectPanelState.effectRegionId)
  if (!effectRegion) {
    openEffectPanelState = null
    effectEditStart = null
    openEffectPanelInput = null
    openEffectPanelOutput = null
    effectPanelController.hide()
    return
  }
  effectPanelController.setSubtitle(getEffectPanelSubtitle(openEffectPanelState.track, effectRegion))
  if (effectRegion.effect == 'gain' && openEffectPanelInput && openEffectPanelOutput) {
    openEffectPanelInput.value = `${effectRegion.value}`
    updateGainEffectOutput(openEffectPanelOutput, effectRegion.value)
  }
}

function getEffectPanelSubtitle(track: Track, effectRegion: Effect) {
  const start = TimeUtils.positionToString(effectRegion.startSample, this.sampleRate, true)
  const end = TimeUtils.positionToString(effectRegion.startSample + effectRegion.length, this.sampleRate, true)
  return `${track.name} · ${start} - ${end}`
}

function updateGainEffectRegion(track: Track, effectRegionId: string, value: number) {
  const effectRegion = track.getEffectRegionById(effectRegionId)
  if (!effectRegion || effectRegion.effect != 'gain') {
    return
  }
  track.setEffectRegions(
    replaceEffectRegion(track.getEffectRegions(), {
      ...effectRegion,
      value,
    }),
  )
  this.draw()
}

async function commitEffectRegionEdit(track: Track) {
  if (!effectEditStart || effectEditStart.track != track) {
    return
  }
  const newEffectRegions = cloneEffectRegions(track.getEffectRegions())
  if (effectArraysEqual(effectEditStart.effectRegions, newEffectRegions)) {
    effectEditStart = null
    return
  }
  await editorHistory.recordApplied(
    new SetTrackEffectRegionsCommand(track, effectEditStart.effectRegions, newEffectRegions),
  )
  effectEditStart = null
}

function effectArraysEqual(a: Effect[], b: Effect[]) {
  return (
    a.length == b.length &&
    a.every(
      (effectRegion, index) =>
        effectRegion.id == b[index]?.id &&
        effectRegion.effect == b[index]?.effect &&
        effectRegion.startSample == b[index]?.startSample &&
        effectRegion.length == b[index]?.length &&
        effectRegion.value == b[index]?.value,
    )
  )
}
