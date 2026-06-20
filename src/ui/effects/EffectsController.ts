// import { Effect, replaceEffectRegion } from 'effects/Effects'
// import { TimeUtils } from 'global/TimeUtils'
// import { Track } from 'project/Track'
// import { editorHistory } from 'ui/undo/EditorHistory'
// import { SetTrackEffectRegionsCommand } from 'ui/undo/UndoableActions'

// export class EffectsController {

//   private effectEditStart: { track: Track; effectRegions: Effect[] } | null = null

//   startEffectRegionEdit(track: Track) {
//     if (effectEditStart?.track == track) {
//       return
//     }
//     effectEditStart = {
//       track,
//       effectRegions: cloneEffectRegions(track.getEffectRegions()),
//     }
//   }

//   updateGainEffectRegion(track: Track, effectRegionId: string, value: number) {
//     const effectRegion = track.getEffectRegionById(effectRegionId)
//     if (!effectRegion || effectRegion.effect != 'gain') {
//       return
//     }
//     track.setEffectRegions(
//       replaceEffectRegion(track.getEffectRegions(), {
//         ...effectRegion,
//         value,
//       }),
//     )
//   }
// }

// let openEffectPanelState: { track: Track; effectRegionId: string } | null = null
// let effectEditStart: { track: Track; effectRegions: Effect[] } | null = null

// function startEffectRegionEdit(track: Track) {
//   if (effectEditStart?.track == track) {
//     return
//   }
//   effectEditStart = {
//     track,
//     effectRegions: cloneEffectRegions(track.getEffectRegions()),
//   }
// }

// function cloneEffectRegions(effectRegions: Effect[]) {
//   return effectRegions.map((effectRegion) => ({ ...effectRegion }))
// }

// async function deleteEffectRegion(track: Track, effectRegionId: string) {
//   const oldEffectRegions = cloneEffectRegions(track.getEffectRegions())
//   const newEffectRegions = oldEffectRegions.filter((effectRegion) => effectRegion.id != effectRegionId)
//   if (newEffectRegions.length == oldEffectRegions.length) {
//     return
//   }
//   openEffectPanelState = null
//   effectEditStart = null
//   openEffectPanelInput = null
//   openEffectPanelOutput = null
//   effectPanelController.hide()
//   await editorHistory.execute(new SetTrackEffectRegionsCommand(track, oldEffectRegions, newEffectRegions))
// }

// function refreshOpenEffectPanel() {
//   if (!openEffectPanelState) {
//     return
//   }
//   const effectRegion = openEffectPanelState.track.getEffectRegionById(openEffectPanelState.effectRegionId)
//   if (!effectRegion) {
//     openEffectPanelState = null
//     effectEditStart = null
//     openEffectPanelInput = null
//     openEffectPanelOutput = null
//     effectPanelController.hide()
//     return
//   }
//   effectPanelController.setSubtitle(getEffectPanelSubtitle(openEffectPanelState.track, effectRegion))
//   if (effectRegion.effect == 'gain' && openEffectPanelInput && openEffectPanelOutput) {
//     openEffectPanelInput.value = `${effectRegion.value}`
//     updateGainEffectOutput(openEffectPanelOutput, effectRegion.value)
//   }
// }

// function getEffectPanelSubtitle(track: Track, effectRegion: Effect) {
//   const start = TimeUtils.positionToString(effectRegion.startSample, this.sampleRate, true)
//   const end = TimeUtils.positionToString(effectRegion.startSample + effectRegion.length, this.sampleRate, true)
//   return `${track.name} · ${start} - ${end}`
// }

// function updateGainEffectRegion(track: Track, effectRegionId: string, value: number) {
//   const effectRegion = track.getEffectRegionById(effectRegionId)
//   if (!effectRegion || effectRegion.effect != 'gain') {
//     return
//   }
//   track.setEffectRegions(
//     replaceEffectRegion(track.getEffectRegions(), {
//       ...effectRegion,
//       value,
//     }),
//   )
//   this.draw()
// }

//   function openEffectRegion(track: Track, effectRegionId: string) {
//     const effectRegion = track.getEffectRegionById(effectRegionId)
//     if (!effectRegion) {
//       return
//     }
//     openEffectPanelState = { track, effectRegionId }
//     effectEditStart = null
//     switch (effectRegion.effect) {
//       case 'gain':
//         openGainEffectPanel(track, effectRegion)
//         break
//     }
//   }

//   async function commitEffectRegionEdit(track: Track) {
//     if (!this.effectEditStart) {
//       return
//     }
//     await editorHistory.recordApplied(
//       new SetTrackEffectRegionsCommand(track, this.effectEditStart.effectRegions, track.getEffectRegions()),
//     )
//     this.effectEditStart = null
//   }
