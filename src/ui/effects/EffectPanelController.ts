import { PointerStateManager } from 'ui/PointerStateManager'
import { AudioControl } from '../../audiocontext/AudioControl'
import { EffectMetadata, EffectModule } from '../../effects/Effect'
import { EffectData } from '../../effects/EffectData'
import { EffectIndex } from '../../effects/EffectIndex'
import { ParameterMetadata } from '../../effects/ParameterMetadata'
import { ParameterValueSequence } from '../../effects/ParameterValueSequence'
import { TimeUtils } from '../../global/TimeUtils'
import { Track } from '../../project/Track'
import { BottomPanelController } from '../BottomPanelController'
import { NotificationsController } from '../NotificationsController'
import { createArrowIcon, createSvgIcon } from '../SvgIcon'
import { AutomationController } from '../timeline/AutomationController'
import { TrackListController } from '../timeline/TrackListController'
import { editorHistory } from '../undo/EditorHistory'
import { cloneEffectData, SetTrackEffectsCommand } from './SetTrackEffectsCommand'

type EffectViewSession = {
  track: Track
  effectInstanceId: string
  module: EffectModule
  node: AudioNode
  parameters: Record<string, AudioParam>
  audioContext: BaseAudioContext
  ownsModule: boolean
  abortController: AbortController
  closed: boolean
}

export class EffectPanelController {
  private static instance: EffectPanelController | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new EffectPanelController())
  }

  private readonly effectIndex = EffectIndex.getInstance()
  private readonly bottomPanelController = BottomPanelController.getInstance()
  private activeEffectView: EffectViewSession | null = null
  private viewVersion = 0
  private chainChangePending = false

  private constructor() {}

  async showEffectForTrack(metadata: EffectMetadata, track: Track, effectIndex?: number) {
    const viewVersion = ++this.viewVersion
    await this.closeEffectView()
    if (viewVersion != this.viewVersion) {
      return
    }

    const resolvedIndex = effectIndex ?? track.effectRegions.findIndex((effect) => effect.id == metadata.id)
    const effectData = track.effectRegions[resolvedIndex]
    if (!effectData || effectData.id != metadata.id) {
      this.showMessage('Effect unavailable', 'This effect is no longer on the track.', track)
      return
    }

    const loadingElement = document.createElement('div')
    loadingElement.className = 'effect-panel-message'
    loadingElement.textContent = `Loading ${metadata.name}...`
    this.openSubview(metadata.name, track.name, loadingElement, track)

    try {
      const session = await this.startEffectSession(track, effectData)
      if (viewVersion != this.viewVersion) {
        this.destroyEffectSession(session)
        return
      }
      this.activeEffectView = session
      const body = this.createEffectEditor(metadata, session)
      this.bottomPanelController.open({
        title: metadata.name,
        subtitle: track.name,
        body,
        onBack: () => this.showTrackEffectsList(track),
        onClose: () => this.handlePanelClose(),
      })
    } catch (error) {
      console.error(`Failed to open effect ${metadata.id}`, error)
      if (viewVersion == this.viewVersion) {
        this.showMessage('Effect failed to load', String(error), track)
      }
    }
  }

  async showTrackEffectsList(track: Track) {
    const viewVersion = ++this.viewVersion
    await this.closeEffectView()
    if (viewVersion != this.viewVersion) {
      return
    }

    const bodyElement = document.createElement('div')
    bodyElement.className = 'effect-list-body'
    bodyElement.appendChild(this.createChainEndpoint('Track', track.name))

    track.effectRegions.forEach((effectData, index) => {
      bodyElement.appendChild(this.createChainArrow())
      bodyElement.appendChild(
        this.createEffectChainItem(track, index, effectData, this.effectIndex.getEffectMetadataById(effectData.id)),
      )
    })

    bodyElement.appendChild(this.createChainArrow())
    const addEffectElement = document.createElement('button')
    addEffectElement.type = 'button'
    addEffectElement.className = 'effect-list-item effect-chain-item effect-chain-add clickable'
    addEffectElement.append('Add New Effect', createSvgIcon('plus', { className: 'effect-chain-add-icon' }))
    addEffectElement.style.fontWeight = 'bold'
    addEffectElement.addEventListener('click', () => void this.showAvailableEffectsList(track))
    bodyElement.appendChild(addEffectElement)

    bodyElement.appendChild(this.createChainArrow())
    bodyElement.appendChild(this.createChainEndpoint('Output'))
    this.bottomPanelController.open({
      title: 'Effects',
      subtitle: track.name,
      body: bodyElement,
      onClose: () => this.handlePanelClose(),
    })
  }

  async showAvailableEffectsList(track: Track) {
    const viewVersion = ++this.viewVersion
    await this.closeEffectView()
    if (viewVersion != this.viewVersion) {
      return
    }

    const bodyElement = document.createElement('div')
    bodyElement.className = 'effect-list-body'
    for (const metadata of this.effectIndex.getAvailableEffects()) {
      const listItemElement = document.createElement('article')
      listItemElement.className = 'effect-list-item effect-catalog-item'

      const addEffectButton = document.createElement('button')
      addEffectButton.type = 'button'
      addEffectButton.className = 'clickable effect-catalog-add'
      addEffectButton.textContent = 'Add to track'
      addEffectButton.addEventListener('click', () => {
        addEffectButton.disabled = true
        void this.addEffect(track, metadata).catch((error) => {
          addEffectButton.disabled = false
          console.error('Failed to add effect', error)
          NotificationsController.showErrorMessage('Could not add the effect.')
        })
      })
      listItemElement.append(addEffectButton, this.getEffectDescriptionElement(metadata))
      bodyElement.appendChild(listItemElement)
    }
    this.openSubview('Add Effect', track.name, bodyElement, track)
  }

  private async startEffectSession(track: Track, effectData: EffectData): Promise<EffectViewSession> {
    const playbackModule = track.getPlaybackEffectModule(effectData.instanceId)
    const module = playbackModule ?? (await this.effectIndex.getEffectById(effectData.id))
    if (!module) {
      throw new Error(`Effect ${effectData.id} is unavailable`)
    }
    const audioContext = await AudioControl.getOrCreateAudioContext()
    const node = await module.getNode(audioContext)
    const parameters = await module.getParameters(audioContext)
    for (const [name, sequence] of Object.entries(effectData.params)) {
      const parameter = parameters[name]
      if (parameter) {
        parameter.setValueAtTime(sequence.initialValue, audioContext.currentTime)
      }
    }
    return {
      track,
      effectInstanceId: effectData.instanceId,
      module,
      node,
      parameters,
      audioContext,
      ownsModule: !playbackModule,
      abortController: new AbortController(),
      closed: false,
    }
  }

  private createEffectEditor(metadata: EffectMetadata, session: EffectViewSession) {
    const body = document.createElement('form')
    body.className = 'effect-editor-body effect-parameter-form'
    body.addEventListener('submit', (event) => event.preventDefault())

    if (metadata.parameters.length == 0) {
      const message = document.createElement('p')
      message.textContent = 'This effect has no adjustable parameters.'
      body.appendChild(message)
      return body
    }

    for (const parameterMetadata of metadata.parameters) {
      const effectData = session.track.effectRegions.find((effect) => effect.instanceId == session.effectInstanceId)
      const sequence = effectData?.params[parameterMetadata.id]
      const audioParameter = session.parameters[parameterMetadata.id]
      if (!sequence || !audioParameter) {
        continue
      }
      body.appendChild(this.createParameterControl(session, parameterMetadata, sequence.initialValue, audioParameter))
    }
    return body
  }

  private createParameterControl(
    session: EffectViewSession,
    metadata: ParameterMetadata,
    initialValue: number,
    audioParameter: AudioParam,
  ) {
    const field = document.createElement('label')
    field.className = 'effect-parameter-control'
    const name = document.createElement('strong')
    name.textContent = metadata.displayName

    const range = document.createElement('input')
    range.type = 'range'
    range.min = '0'
    range.max = '1'
    range.step = '0.001'
    range.value = String(this.clamp(metadata.normalize(initialValue), 0, 1))

    const valueRow = document.createElement('span')
    valueRow.className = 'effect-parameter-value'
    const output = document.createElement('output')
    output.textContent = metadata.displayValue(initialValue)
    valueRow.appendChild(output)

    const applyValue = (value: number) => {
      const boundedValue = this.clamp(value, metadata.minValue, metadata.maxValue)
      range.value = String(this.clamp(metadata.normalize(boundedValue), 0, 1))
      output.textContent = metadata.displayValue(boundedValue)
      audioParameter.setValueAtTime(boundedValue, session.audioContext.currentTime)
      return boundedValue
    }
    range.addEventListener('input', () => applyValue(metadata.denormalize(Number(range.value))), {
      signal: session.abortController.signal,
    })
    const commit = () => {
      const value = metadata.denormalize(Number(range.value))
      void this.commitParameterValue(session, metadata, applyValue(value))
    }
    range.addEventListener('change', commit, { signal: session.abortController.signal })

    field.append(name, range, valueRow)
    return field
  }

  private async commitParameterValue(session: EffectViewSession, metadata: ParameterMetadata, value: number) {
    const effectIndex = session.track.effectRegions.findIndex((effect) => effect.instanceId == session.effectInstanceId)
    if (effectIndex < 0) {
      return
    }
    const currentValue = session.track.effectRegions[effectIndex].params[metadata.id]?.initialValue
    if (currentValue == value) {
      return
    }
    const oldEffects = cloneEffectData(session.track.effectRegions)
    const newEffects = cloneEffectData(oldEffects)
    newEffects[effectIndex].params[metadata.id].initialValue = value
    try {
      await editorHistory.execute(
        new SetTrackEffectsCommand(session.track, oldEffects, newEffects, `change ${metadata.id}`),
      )
    } catch (error) {
      console.error('Failed to save effect parameter', error)
      NotificationsController.showErrorMessage('Could not persist the latest effect setting.')
    }
  }

  private createEffectChainItem(track: Track, index: number, effectData: EffectData, metadata: EffectMetadata | null) {
    const item = document.createElement('article')
    item.className = 'effect-list-item effect-chain-item effect-chain-effect'
    item.style.border = 'double'

    const openButton = document.createElement('button')
    openButton.type = 'button'
    openButton.className = 'clickable effect-chain-open'
    const typeElement = document.createElement('strong')
    typeElement.textContent = 'Effect'
    const nameElement = document.createElement('span')
    nameElement.textContent = metadata?.name ?? effectData.id
    openButton.append(typeElement, nameElement)
    openButton.disabled = !metadata
    if (metadata) {
      openButton.addEventListener('click', () => void this.showEffectForTrack(metadata, track, index))
    } else {
      openButton.title = 'Effect metadata could not be loaded'
    }

    const controls = document.createElement('div')
    controls.className = 'effect-chain-controls'
    const moveLeftButton = this.createIconButton('Move effect left', 'arrow-right', 'effect-icon-left')
    moveLeftButton.disabled = index == 0
    moveLeftButton.addEventListener('click', () => void this.moveEffect(track, index, index - 1))
    const moveRightButton = this.createIconButton('Move effect right', 'arrow-right')
    moveRightButton.disabled = index == track.effectRegions.length - 1
    moveRightButton.addEventListener('click', () => void this.moveEffect(track, index, index + 1))
    const removeButton = this.createIconButton('Remove effect', 'trash')
    removeButton.classList.add('effect-chain-remove')
    removeButton.addEventListener('click', () => void this.removeEffect(track, index))
    const automationButton = this.createIconButton('Automate', 'pencil')
    automationButton.disabled = !metadata?.parameters.length
    if (metadata?.parameters.length) {
      automationButton.addEventListener('click', () => this.openAutomationView(track, effectData, metadata))
    }
    controls.append(moveLeftButton, moveRightButton, removeButton, automationButton)
    item.append(openButton, controls)
    return item
  }

  private createChainEndpoint(title: string, name?: string) {
    const element = document.createElement('div')
    element.className = 'effect-list-item effect-chain-item effect-chain-endpoint'
    element.style.border = 'dotted'
    const titleElement = document.createElement('strong')
    titleElement.textContent = title
    element.appendChild(titleElement)
    if (name) {
      const nameElement = document.createElement('span')
      nameElement.textContent = name
      element.appendChild(nameElement)
    }
    return element
  }

  private createChainArrow() {
    const arrow = document.createElement('div')
    arrow.className = 'effect-list-arrow'
    arrow.appendChild(createArrowIcon())
    return arrow
  }

  private createIconButton(label: string, symbolId: string, iconClassName?: string) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'clickable effect-chain-control'
    button.title = label
    button.setAttribute('aria-label', label)
    button.appendChild(createSvgIcon(symbolId, { className: iconClassName }))
    return button
  }

  private async addEffect(track: Track, metadata: EffectMetadata) {
    if (this.chainChangePending) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(track.effectRegions)
      const newEffects = cloneEffectData(oldEffects)
      const params = Object.fromEntries(
        metadata.parameters.map((parameter) => [parameter.id, new ParameterValueSequence(parameter.defaultValue)]),
      )
      newEffects.push({ instanceId: this.createInstanceId(), id: metadata.id, params })
      await editorHistory.execute(
        new SetTrackEffectsCommand(track, oldEffects, newEffects, `add ${metadata.name} effect`),
      )
      if (viewVersion == this.viewVersion) {
        await this.showTrackEffectsList(track)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private async moveEffect(track: Track, fromIndex: number, toIndex: number) {
    if (
      this.chainChangePending ||
      fromIndex == toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= track.effectRegions.length ||
      toIndex >= track.effectRegions.length
    ) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(track.effectRegions)
      const newEffects = cloneEffectData(oldEffects)
      const [effect] = newEffects.splice(fromIndex, 1)
      newEffects.splice(toIndex, 0, effect)
      await editorHistory.execute(new SetTrackEffectsCommand(track, oldEffects, newEffects, 'reorder track effects'))
      if (viewVersion == this.viewVersion) {
        await this.showTrackEffectsList(track)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private async removeEffect(track: Track, index: number) {
    if (this.chainChangePending || index < 0 || index >= track.effectRegions.length) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(track.effectRegions)
      const newEffects = cloneEffectData(oldEffects)
      newEffects.splice(index, 1)
      await editorHistory.execute(new SetTrackEffectsCommand(track, oldEffects, newEffects, 'remove track effect'))
      if (viewVersion == this.viewVersion) {
        await this.showTrackEffectsList(track)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private openAutomationView(track: Track, effectData: EffectData, metadata: EffectMetadata) {
    const trackListController = (window as any).trackListController as TrackListController
    const waveformSvg = trackListController.waveforms.find((waveform) => waveform.track == track)?.topGroupElement
    const parameterMetadata = metadata.parameters[0]
    const sequence = effectData.params[parameterMetadata.id]
    if (!waveformSvg || !sequence) {
      return
    }
    const automationController = new AutomationController(
      trackListController,
      effectData.instanceId,
      waveformSvg,
      track,
      parameterMetadata,
      parameterMetadata.normalize(sequence.initialValue),
    )
    ;((window as any).trackListController as TrackListController).pointerStateManager.startAutomating()
    automationController.draw()
  }

  private async closeEffectView() {
    const session = this.activeEffectView
    if (!session || session.closed) {
      return
    }
    this.activeEffectView = null
    this.destroyEffectSession(session)
  }

  private destroyEffectSession(session: EffectViewSession) {
    session.abortController.abort()
    session.closed = true
    if (session.ownsModule) {
      session.node.disconnect()
    }
  }

  private createInstanceId() {
    return globalThis.crypto.randomUUID()
  }

  private clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value))
  }

  private openSubview(title: string, subtitle: string, body: HTMLElement, track: Track) {
    this.bottomPanelController.open({
      title,
      subtitle,
      body,
      onBack: () => this.showTrackEffectsList(track),
      onClose: () => this.handlePanelClose(),
    })
  }

  private async handlePanelClose() {
    ++this.viewVersion
    await this.closeEffectView()
  }

  private showMessage(title: string, message: string, track: Track) {
    const body = document.createElement('div')
    body.className = 'effect-panel-message'
    body.textContent = message
    this.openSubview(title, track.name, body, track)
  }

  private getEffectDescriptionElement(metadata: EffectMetadata) {
    const parentElement = document.createElement('div')
    parentElement.className = 'effect-description'

    const nameElement = document.createElement('p')
    nameElement.className = 'effect-name'
    nameElement.textContent = metadata.name
    parentElement.appendChild(nameElement)

    if (metadata.categories.length) {
      const categoryElement = document.createElement('p')
      categoryElement.className = 'effect-category'
      categoryElement.textContent = metadata.categories.join(', ')
      parentElement.appendChild(categoryElement)
    }

    const descriptionElement = document.createElement('p')
    descriptionElement.textContent = metadata.description
    parentElement.appendChild(descriptionElement)
    return parentElement
  }
}

export function getPanelSubtitle(track: Track, sampleRate: number, startPosition: number, endPosition: number) {
  return (
    `${track.name}: ` +
    `${TimeUtils.positionToString(startPosition, sampleRate, false)}` +
    ` - ${TimeUtils.positionToString(endPosition, sampleRate, false)}`
  )
}
