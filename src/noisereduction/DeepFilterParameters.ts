export interface DeepFilterParameters {
  attenuationLimit: number
  minDbThreshold: number
  maxDbErbThreshold: number
  maxDbDfThreshold: number
  postFilterBeta: number
}

export const defaultDeepFilterParameters: Readonly<DeepFilterParameters> = {
  attenuationLimit: 100,
  minDbThreshold: -15,
  maxDbErbThreshold: 35,
  maxDbDfThreshold: 35,
  postFilterBeta: 0,
}

export function readDeepFilterParameters(value: unknown): DeepFilterParameters {
  const candidate =
    value && typeof value == 'object' ? (value as Partial<Record<keyof DeepFilterParameters, unknown>>) : {}
  return {
    attenuationLimit: readNumber(candidate.attenuationLimit, defaultDeepFilterParameters.attenuationLimit, 0, 100),
    minDbThreshold: readNumber(candidate.minDbThreshold, defaultDeepFilterParameters.minDbThreshold, -30, 0),
    maxDbErbThreshold: readNumber(candidate.maxDbErbThreshold, defaultDeepFilterParameters.maxDbErbThreshold, 0, 100),
    maxDbDfThreshold: readNumber(candidate.maxDbDfThreshold, defaultDeepFilterParameters.maxDbDfThreshold, 0, 100),
    postFilterBeta: readNumber(candidate.postFilterBeta, defaultDeepFilterParameters.postFilterBeta, 0, 0.05),
  }
}

function readNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value == 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback
}
