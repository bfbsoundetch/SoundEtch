import { EffectMetadata, EffectModule } from "effects/Effect";
import { ParameterMetadata } from "effects/ParameterMetadata";

export const GainParameterMetadata: ParameterMetadata = {
    name: "",
    minValue: 0,
    maxValue: 0,
    units: ""
}

export class GainEffect implements EffectModule {

    readonly metadata: EffectMetadata = {
        id: "soundetch.gain",
        name: "gain",
        description: "Adjust volume",
        categories: [],
        parameters: []
    }
    getUi(): Promise<Element> {
        throw new Error("Method not implemented.");
    }
    async getNode(audioContext: BaseAudioContext): Promise<AudioNode> {
        return new GainNode(audioContext)
    }
    
}