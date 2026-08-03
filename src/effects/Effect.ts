import { ParameterMetadata } from "./ParameterMetadata"

export interface EffectModule {

    metadata: EffectMetadata

    getUi(): Promise<Element>

    getNode(audioContext: BaseAudioContext): Promise<AudioNode>

}

export interface EffectMetadata {
    id: string
    name: string
    description: string
    categories: string[]
    parameters: Array<ParameterMetadata>
}