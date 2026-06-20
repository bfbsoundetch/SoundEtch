// import { Effect } from "effects/Effects"
// import { Track } from "project/Track"
// import { EffectPanelController } from "./EffectPanelController"
// import { Project } from "project/Project"
// import { EffectsController } from "./EffectsController"
// import { TimeUtils } from "global/TimeUtils"

// export class GainPanelController {
//   private openEffectPanelInput: HTMLInputElement
//   private openEffectPanelOutput: HTMLOutputElement

//   constructor(project: Project, track: Track, effectRegion: Effect, effectsController: EffectsController, effectPanelController: EffectPanelController) {
//     const valueLabelElement = document.createElement('label')
//     valueLabelElement.textContent = 'Gain'
//     valueLabelElement.htmlFor = 'effect-panel-gain-value'
  
//     const valueSlider = document.createElement('input')
//     valueSlider.id = 'effect-panel-gain-value'
//     valueSlider.type = 'range'
//     valueSlider.min = '-36'
//     valueSlider.max = '36'
//     valueSlider.step = '0.1'
//     valueSlider.value = `${effectRegion.value}`
  
//     const valueOutput = document.createElement('output')
//     valueOutput.className = 'slider-value effect-panel-value-output'
//     valueOutput.style.opacity = '1'
//     updateGainEffectOutput(valueOutput, effectRegion.value)
  
//     valueSlider.addEventListener('pointerdown', () => effectsController.startEffectRegionEdit(track))
//     valueSlider.addEventListener('focus', () => effectsController.startEffectRegionEdit(track))
//     valueSlider.addEventListener('input', () => {
//       const value = Number(valueSlider.value)
//       updateGainEffectOutput(valueOutput, value)
//       effectsController.updateGainEffectRegion(track, effectRegion.id, value)
//     })
//     valueSlider.addEventListener('change', () => effectPanelController.commitEffectRegionEdit(track))
  
//     const valueGroup = document.createElement('div')
//     valueGroup.className = 'effect-panel-control-group'
//     valueGroup.append(valueLabelElement, valueSlider, valueOutput)
  
//     const deleteButton = document.createElement('button')
//     deleteButton.className = 'menu-item clickable effect-panel-delete'
//     deleteButton.textContent = 'Delete Region'
//     deleteButton.type = 'button'
//     deleteButton.addEventListener('click', () => deleteEffectRegion(track, effectRegion.id))
  
//     this.openEffectPanelInput = valueSlider
//     this.openEffectPanelOutput = valueOutput

//     const start = TimeUtils.positionToString(effectRegion.startSample, project.sampleRate, true)
//     const end = TimeUtils.positionToString(effectRegion.startSample + effectRegion.length, project.sampleRate, true)  

//     effectPanelController.open({
//       title: 'Gain',
//       subtitle: `${track.name} · ${start} - ${end}`,
//       body: [valueGroup],
//       actions: [deleteButton],
//       onClose: () => {
//         this.openEffectPanelInput.remove()
//         this.openEffectPanelOutput.remove()
//       },
//     })
//   }
  
//   updateGainEffectOutput(output: HTMLOutputElement, value: number) {
//     output.value = `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
//   }
// }