import { EffectMetadata } from "./Effect";

export const GainEffectMetadata: EffectMetadata = {
    id: "soundetch.gain",
    name: "gain",
    description: "Adjust volume",
    categories: [],
    parameters: [{
        name: "gain",
        minValue: 0,
        maxValue: 64,
        units: "",
        normalize: (gain) => Math.log2(gain) / 6,
        denormalize: (value) => 2 ** (6 * value),
    }],
}