import { Effect } from "effects/Effects"
import { TimeUtils } from "global/TimeUtils"
import { Track } from "project/Track"

export class EffectPanelController {



}

export function updateEffect() {

}

export function getPanelSubtitle(track: Track, sampleRate: number, effect: Effect) {
  return `${track.name}: ` + 
    `${TimeUtils.positionToString(effect.startPosition, sampleRate, false)}` +
    `${TimeUtils.positionToString(effect.startPosition + effect.length, sampleRate, false)}`
}
