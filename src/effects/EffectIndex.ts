import { GainEffectMetadata } from './BuiltinEffectMetadata'
import { EffectModule } from './Effect'

export class EffectIndex {

    private static instance: EffectIndex | null = null

    static getInstance() {
        return this.instance ?? (this.instance = new EffectIndex())
    }

    private constructor() {}

    async getEffectById(id: string) {
        let result: EffectModule | null = null
        switch(id) {
            case GainEffectMetadata.id:
                result = new (await import('./gain/GainEffect')).GainEffect()
                break
        }
        return result
    }
}