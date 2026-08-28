import { DEFAULT_SPEC, FILTER_TYPES, WEQ8Runtime, type FilterType, type WEQ8Spec } from '@bfbsoundetch/weq8'
import { EffectEditorContext, EffectModule } from '../Effect'
import { EqualizerEffectMetadata, EqualizerParameter, getEqualizerParameterId } from './EqualizerMetadata'

const cloneSpec = (spec: WEQ8Spec) => structuredClone(spec)

function readSpec(state: unknown): WEQ8Spec {
  if (!Array.isArray(state) || state.length != 8) {
    return cloneSpec(DEFAULT_SPEC)
  }
  const supportedTypes = new Set<string>(['noop', ...FILTER_TYPES])
  return state.map((candidate, band) => {
    const fallback = DEFAULT_SPEC[band]
    if (!candidate || typeof candidate != 'object') {
      return { ...fallback }
    }
    const value = candidate as Record<string, unknown>
    return {
      type: supportedTypes.has(String(value.type)) ? (value.type as FilterType | 'noop') : fallback.type,
      frequency: Number.isFinite(value.frequency) ? Number(value.frequency) : fallback.frequency,
      gain: Number.isFinite(value.gain) ? Number(value.gain) : fallback.gain,
      Q: Number.isFinite(value.Q) ? Number(value.Q) : fallback.Q,
      bypass: typeof value.bypass == 'boolean' ? value.bypass : fallback.bypass,
    }
  }) as WEQ8Spec
}

export class EqualizerEffect implements EffectModule {
  readonly metadata = EqualizerEffectMetadata

  private runtime: WEQ8Runtime | null = null
  private destination: AudioNode | null = null
  private state = cloneSpec(DEFAULT_SPEC)

  async connect(audioContext: BaseAudioContext, destination: AudioNode) {
    const runtime = this.getRuntime(audioContext)
    if (this.destination) {
      runtime.disconnect(this.destination)
    }
    runtime.connect(destination)
    this.destination = destination
    return runtime.input
  }

  disconnect() {
    this.runtime?.dispose()
    this.destination = null
    this.runtime = null
  }

  async getParameters(audioContext: BaseAudioContext) {
    const runtime = this.getRuntime(audioContext)
    return Object.fromEntries(
      runtime.parameters.flatMap((parameters, band) =>
        (['frequency', 'gain', 'Q'] as EqualizerParameter[]).map((parameter) => [
          getEqualizerParameterId(band, parameter),
          parameters[parameter],
        ]),
      ),
    )
  }

  setState(state: unknown) {
    this.state = readSpec(state)
    if (!this.runtime) {
      return
    }
    for (const [band, filter] of this.state.entries()) {
      this.runtime.spec[band].frequency = filter.frequency
      this.runtime.spec[band].gain = filter.gain
      this.runtime.spec[band].Q = filter.Q
      this.runtime.setFilterType(band, filter.type)
      this.runtime.toggleBypass(band, filter.bypass)
    }
  }

  async createEditor(context: EffectEditorContext) {
    if (!this.runtime) {
      throw new Error('Equalizer runtime has not been initialized')
    }
    await import('@bfbsoundetch/weq8/ui')

    const body = document.createElement('div')
    body.className = 'effect-editor-body equalizer-editor'
    const editor = document.createElement('weq8-ui') as HTMLElement & { runtime: WEQ8Runtime }
    editor.runtime = this.runtime
    editor.addEventListener(
      'weq8-commit',
      (event) => {
        const spec = readSpec((event as CustomEvent<WEQ8Spec>).detail)
        const parameters = Object.fromEntries(
          spec.flatMap((filter, band) => [
            [getEqualizerParameterId(band, 'frequency'), filter.frequency],
            [getEqualizerParameterId(band, 'gain'), filter.gain],
            [getEqualizerParameterId(band, 'Q'), filter.Q],
          ]),
        )
        void context.commit(parameters, spec, 'change equalizer')
      },
      { signal: context.signal },
    )
    body.appendChild(editor)
    return body
  }

  private getRuntime(audioContext: BaseAudioContext) {
    if (this.runtime?.audioCtx != audioContext) {
      this.disconnect()
      this.runtime = new WEQ8Runtime(audioContext, this.state)
    }
    return this.runtime
  }
}
