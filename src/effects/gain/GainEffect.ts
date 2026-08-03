import { GainEffectMetadata } from "effects/BuiltinEffectMetadata";
import { EffectMetadata, EffectModule } from "effects/Effect";
import { ParameterMetadata } from "effects/ParameterMetadata";

export class GainEffect implements EffectModule {

    readonly metadata = GainEffectMetadata
    getUi(): Promise<Element> {
        throw new Error("Method not implemented.");
    }
    async getNode(audioContext: BaseAudioContext): Promise<AudioNode> {
        return new GainNode(audioContext)
    }
    
}