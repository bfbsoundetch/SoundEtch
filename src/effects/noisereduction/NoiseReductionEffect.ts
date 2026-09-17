import { RingBuffer } from 'ringbuf.js'
import { NoiseReducer } from '../../noisereduction/NoiseReducer'
import { createSynchronousNoiseReductionNode } from '../../noisereduction/SynchronousNoiseReductionNode'
import {
  defaultDeepFilterParameters,
  readDeepFilterParameters,
  type DeepFilterParameters,
} from '../../noisereduction/DeepFilterParameters'
import { NoiseReductionEffectMetadata } from '../BuiltinEffectMetadata'
import type { EffectEditorContext, EffectModule } from '../Effect'

interface NoiseReductionRuntime {
  node: AudioNode
  setParameters(parameters: DeepFilterParameters): void
  dispose(): void
}

interface NoiseReductionControl {
  key: keyof DeepFilterParameters
  label: string
  minimum: number
  maximum: number
  step: number
  display(value: number): string
}

const controls: readonly NoiseReductionControl[] = [
  {
    key: 'attenuationLimit',
    label: 'Attenuation Limit',
    minimum: 0,
    maximum: 100,
    step: 1,
    display: (value) => `${value.toFixed(0)} dB`,
  },
  {
    key: 'minDbThreshold',
    label: 'Minimum Local SNR',
    minimum: -30,
    maximum: 0,
    step: 0.5,
    display: (value) => `${value.toFixed(1)} dB`,
  },
  {
    key: 'maxDbErbThreshold',
    label: 'ERB Decoder Maximum',
    minimum: 0,
    maximum: 100,
    step: 0.5,
    display: (value) => `${value.toFixed(1)} dB`,
  },
  {
    key: 'maxDbDfThreshold',
    label: 'DF Decoder Maximum',
    minimum: 0,
    maximum: 100,
    step: 0.5,
    display: (value) => `${value.toFixed(1)} dB`,
  },
  {
    key: 'postFilterBeta',
    label: 'Post-filter Beta',
    minimum: 0,
    maximum: 0.05,
    step: 0.001,
    display: (value) => value.toFixed(3),
  },
]

export class NoiseReductionEffect implements EffectModule {
  readonly metadata = NoiseReductionEffectMetadata

  private state: DeepFilterParameters
  private audioContext: BaseAudioContext | null = null
  private runtime: NoiseReductionRuntime | null = null
  private syncEditor: ((state: DeepFilterParameters) => void) | null = null

  constructor(parameters: Partial<DeepFilterParameters> = {}) {
    this.state = readDeepFilterParameters({ ...defaultDeepFilterParameters, ...parameters })
  }

  async connect(audioContext: BaseAudioContext, destination: AudioNode): Promise<AudioNode> {
    const runtime = await this.getRuntime(audioContext)
    runtime.node.connect(destination)
    return runtime.node
  }

  disconnect() {
    this.runtime?.dispose()
    this.audioContext = null
    this.runtime = null
  }

  async getParameters() {
    return {}
  }

  setState(state: unknown) {
    this.state = readDeepFilterParameters(state)
    this.syncEditor?.(this.state)
    this.runtime?.setParameters(this.state)
  }

  async createEditor(context: EffectEditorContext) {
    const body = document.createElement('form')
    body.className = 'effect-editor-body effect-parameter-form noise-reduction-editor'
    body.addEventListener('submit', (event) => event.preventDefault())

    const description1 = document.createElement('p')
    description1.className = 'noise-reduction-editor-description'
    description1.innerHTML =
      'Changes take effect when you click Apply. Powered by ' +
      '<a href="https://github.com/rikorose/deepfilternet" target="_blank">DeepFilterNet</a>'
    body.appendChild(description1)

    let draft = { ...this.state }
    let applying = false
    const effect = this
    const inputs = new Map<keyof DeepFilterParameters, HTMLInputElement>()
    const outputs = new Map<keyof DeepFilterParameters, HTMLOutputElement>()
    const updateDraft = (parameters: Readonly<DeepFilterParameters>) => {
      draft = { ...parameters }
      for (const control of controls) {
        inputs.get(control.key)!.value = String(draft[control.key])
        outputs.get(control.key)!.textContent = control.display(draft[control.key])
      }
      applyButton.disabled = applying || parametersEqual(draft, effect.state)
    }

    for (const control of controls) {
      const field = document.createElement('label')
      field.className = 'effect-parameter-control'
      const name = document.createElement('strong')
      name.textContent = control.label
      const value = document.createElement('span')
      value.className = 'effect-parameter-value'
      const output = document.createElement('output')
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(control.minimum)
      input.max = String(control.maximum)
      input.step = String(control.step)
      input.addEventListener(
        'input',
        () => {
          draft[control.key] = Number(input.value)
          output.textContent = control.display(draft[control.key])
          applyButton.disabled = applying || parametersEqual(draft, this.state)
        },
        { signal: context.signal },
      )
      value.appendChild(output)
      field.append(name, value, input)
      body.appendChild(field)
      inputs.set(control.key, input)
      outputs.set(control.key, output)
    }

    const actions = document.createElement('div')
    actions.className = 'noise-reduction-editor-actions'
    const resetButton = document.createElement('button')
    resetButton.type = 'button'
    resetButton.className = 'clickable'
    resetButton.style.border = 'solid 1px'
    resetButton.style.padding = '.2rem'
    resetButton.textContent = 'Reset defaults'
    const applyButton = document.createElement('button')
    applyButton.type = 'button'
    applyButton.className = 'clickable primary'
    applyButton.style.border = 'solid 1px'
    applyButton.style.padding = '.2rem'
    applyButton.textContent = 'Apply'
    applyButton.disabled = true
    resetButton.addEventListener('click', () => updateDraft(defaultDeepFilterParameters), { signal: context.signal })
    applyButton.addEventListener(
      'click',
      () => {
        if (applying) {
          return
        }
        applying = true
        applyButton.disabled = true
        resetButton.disabled = true
        void context.commit({}, draft, 'change noise reduction').finally(() => {
          applying = false
          resetButton.disabled = false
          applyButton.disabled = parametersEqual(draft, this.state)
        })
      },
      { signal: context.signal },
    )
    actions.append(resetButton, applyButton)
    body.appendChild(actions)

    const syncEditor = (state: DeepFilterParameters) => updateDraft(state)
    this.syncEditor = syncEditor
    context.signal.addEventListener(
      'abort',
      () => {
        if (this.syncEditor == syncEditor) {
          this.syncEditor = null
        }
      },
      { once: true },
    )
    updateDraft(this.state)
    return body
  }

  private async getRuntime(audioContext: BaseAudioContext) {
    if (this.audioContext == audioContext && this.runtime) {
      return this.runtime
    }
    this.disconnect()
    this.audioContext = audioContext
    return (this.runtime = await createRuntime(audioContext, this.state))
  }
}

async function createRuntime(
  audioContext: BaseAudioContext,
  parameters: DeepFilterParameters,
): Promise<NoiseReductionRuntime> {
  if ('process' in audioContext) {
    return createSynchronousNoiseReductionNode(audioContext, parameters)
  }

  const rawSab = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)
  const denoisedSab = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)
  const noiseReducer = new NoiseReducer()
  try {
    const node = await noiseReducer.getNoiseReducerNode(audioContext, rawSab, denoisedSab)
    await noiseReducer.start(audioContext, rawSab, denoisedSab, parameters)
    return {
      node,
      setParameters: (values) => noiseReducer.setParameters(values),
      dispose: () => noiseReducer.dispose(),
    }
  } catch (error) {
    noiseReducer.dispose()
    throw error
  }
}

function parametersEqual(left: DeepFilterParameters, right: DeepFilterParameters | null) {
  return right != null && controls.every((control) => left[control.key] == right[control.key])
}
