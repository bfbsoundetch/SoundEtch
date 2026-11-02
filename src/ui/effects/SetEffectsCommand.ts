import { EffectData } from '../../effects/EffectData'
import type { EffectHost } from '../../project/EffectHost'
import { OutputBus } from '../../project/OutputBus'
import { ProjectManager } from '../../project/ProjectManager'
import { Undoable } from '../undo/Undoable'

export function cloneEffectData(effectData: readonly EffectData[]) {
  return structuredClone(effectData) as EffectData[]
}

export class SetEffectsCommand implements Undoable {
  private readonly oldEffects: EffectData[]
  private readonly newEffects: EffectData[]

  constructor(
    private readonly host: EffectHost,
    oldEffects: readonly EffectData[],
    newEffects: readonly EffectData[],
    private readonly description: string,
  ) {
    this.oldEffects = cloneEffectData(oldEffects)
    this.newEffects = cloneEffectData(newEffects)
  }

  async perform() {
    this.host.setEffectRegions(cloneEffectData(this.newEffects))
    await this.host.applyPlaybackEffectSettings()
  }

  async undo() {
    this.host.setEffectRegions(cloneEffectData(this.oldEffects))
    await this.host.applyPlaybackEffectSettings()
  }

  async save() {
    if (this.host instanceof OutputBus) {
      await ProjectManager.saveOutputEffects(this.host.project)
    } else {
      await ProjectManager.saveTrack(this.host)
    }
  }

  toString() {
    return this.description
  }
}
