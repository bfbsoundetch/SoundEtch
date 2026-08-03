import { GainEffectMetadata } from "effects/BuiltinEffectMetadata";
import { EffectMetadata, EffectModule } from "effects/Effect";
import { ParameterMetadata } from "effects/ParameterMetadata";

export class GainEffect implements EffectModule {

    private state: { gain: number } = { gain: 1 }
    private gainNode: GainNode | null = null

    constructor() {}

    readonly metadata = GainEffectMetadata

    getUi(): Promise<Element> {
        throw new Error("Method not implemented.");
    }

    async getNode(audioContext: BaseAudioContext): Promise<AudioNode> {
        if (audioContext != this.gainNode?.context) {
            this.gainNode = new GainNode(audioContext, { gain: this.state.gain })
        }
        return this.gainNode
    }

    async getState() {
        return JSON.stringify(this.state)
    }

    async setState(state: string) {
        this.state = JSON.parse(state)
        if (this.gainNode) {
            this.gainNode.gain.value = JSON.parse(state).gain
        }
    }
    
}