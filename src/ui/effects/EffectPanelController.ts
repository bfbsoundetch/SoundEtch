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
import { announce } from '../LiveAnnouncer'
import { createArrowIcon, createSvgIcon } from '../SvgIcon'
import { TrackListController } from '../timeline/TrackListController'
import { editorHistory } from '../undo/EditorHistory'
import { cloneEffectData, SetTrackEffectsCommand } from './SetTrackEffectsCommand'

type EffectViewSession = {
  track: Track
  effectInstanceId: string
  module: EffectModule
  parameters: Record<string, AudioParam>
  audioContext: BaseAudioContext
  ownsModule: boolean
  abortController: AbortController
  commitQueue: Promise<void>
  unsubscribePlaybackChange: () => void
  closed: boolean
}

// Effects listed under several categories appear more than once in the catalog, so name ids need a counter.
let nextCatalogNameId = 0

// Keeps the human context ("what failed") in front of the underlying error message
// so the notification shows the cause instead of a bare generic sentence.
function withCause(context: string, error: unknown): Error {
  const cause = error instanceof Error ? error.message : String(error)
  return new Error(`${context}: ${cause}`)
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
  private effectViewRebindRequested = false
  private effectViewRebindRunning = false

  private constructor() {
    editorHistory.addChangeListener(() => this.refreshOwnedEffectView())
  }

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
    announce(`Loading ${metadata.name}`)

    try {
      const session = await this.startEffectSession(track, effectData)
      if (viewVersion != this.viewVersion) {
        this.destroyEffectSession(session)
        return
      }
      this.activeEffectView = session
      const unsubscribePlaybackChange = session.track.addPlaybackChangeListener(() => this.requestEffectViewRebind())
      const handleContextStateChange = () => {
        if (session.audioContext.state == 'closed') {
          this.requestEffectViewRebind()
        }
      }
      session.audioContext.addEventListener('statechange', handleContextStateChange)
      session.unsubscribePlaybackChange = () => {
        unsubscribePlaybackChange()
        session.audioContext.removeEventListener('statechange', handleContextStateChange)
      }
      const body = await this.resolveEffectEditor(metadata, session)
      if (viewVersion != this.viewVersion) {
        this.destroyEffectSession(session)
        return
      }
      this.bottomPanelController.open({
        tab: 'tracks',
        owner: this,
        title: metadata.name,
        subtitle: track.name,
        body,
        onBack: () => this.showTrackEffectsList(track),
        onClose: () => this.handlePanelClose(),
      })
      if (!this.effectViewMatchesPlayback()) {
        this.requestEffectViewRebind()
      }
    } catch (error) {
      console.error(`Failed to open effect ${metadata.id}`, error)
      if (viewVersion == this.viewVersion) {
        this.showMessage('Effect failed to load', String(error), track)
      }
    }
  }

  /** Opens the Tracks tab on `track`'s effect chain. */
  async showTrackEffectsList(track: Track) {
    const viewVersion = ++this.viewVersion
    await this.closeEffectView()
    if (viewVersion != this.viewVersion) {
      return
    }
    this.trackListController.trackPanelController.show(track, 'effects')
  }

  createTrackEffectsChain(track: Track): HTMLElement {
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
    return bodyElement
  }

  async showAvailableEffectsList(track: Track) {
    const viewVersion = ++this.viewVersion
    await this.closeEffectView()
    if (viewVersion != this.viewVersion) {
      return
    }

    const bodyElement = document.createElement('div')
    bodyElement.className = 'effect-list-body effect-catalog-body'
    const effectsByCategory = new Map<string, EffectMetadata[]>()
    for (const metadata of this.effectIndex.getAvailableEffects()) {
      const categories = metadata.categories.length > 0 ? new Set(metadata.categories) : ['Other']
      for (const category of categories) {
        const categoryEffects = effectsByCategory.get(category) ?? []
        categoryEffects.push(metadata)
        effectsByCategory.set(category, categoryEffects)
      }
    }

    for (const [category, effects] of effectsByCategory) {
      const categoryElement = document.createElement('details')
      categoryElement.className = 'effect-category-section'
      categoryElement.open = true

      const categorySummaryElement = document.createElement('summary')
      categorySummaryElement.className = 'effect-category-summary'
      categorySummaryElement.textContent = category

      const categoryItemsElement = document.createElement('div')
      categoryItemsElement.className = 'effect-category-items'
      for (const metadata of effects) {
        categoryItemsElement.appendChild(this.createEffectCatalogItem(track, metadata))
      }

      categoryElement.append(categorySummaryElement, categoryItemsElement)
      bodyElement.appendChild(categoryElement)
    }
    this.openSubview('Add Effect', track.name, bodyElement, track)
  }

  private async startEffectSession(track: Track, effectData: EffectData): Promise<EffectViewSession> {
    const playbackEffect = track.getPlaybackEffect(effectData.instanceId)
    const module = playbackEffect?.module ?? (await this.effectIndex.getEffectById(effectData.id))
    if (!module) {
      throw new Error(`Effect ${effectData.id} is unavailable`)
    }
    const audioContext = playbackEffect?.audioContext ?? (await AudioControl.getOrCreateAudioContext())
    module.setState?.(effectData.state)
    const parameters = await module.getParameters(audioContext)
    if (!playbackEffect) {
      for (const [name, sequence] of Object.entries(effectData.params)) {
        const parameter = parameters[name]
        if (parameter) {
          parameter.setValueAtTime(sequence.initialValue, audioContext.currentTime)
        }
      }
    }
    return {
      track,
      effectInstanceId: effectData.instanceId,
      module,
      parameters,
      audioContext,
      ownsModule: !playbackEffect,
      abortController: new AbortController(),
      commitQueue: Promise.resolve(),
      unsubscribePlaybackChange: () => {},
      closed: false,
    }
  }

  private async resolveEffectEditor(metadata: EffectMetadata, session: EffectViewSession) {
    if (session.module.createEditor) {
      try {
        const editor = await session.module.createEditor({
          signal: session.abortController.signal,
          commit: (parameters, state, description) => this.commitEffectValues(session, parameters, state, description),
        })
        if (editor) {
          return editor
        }
      } catch (error) {
        console.error(`Failed to create custom editor for ${metadata.id}; using generic controls`, error)
      }
    }
    return this.createGenericEffectEditor(metadata, session)
  }

  private createGenericEffectEditor(metadata: EffectMetadata, session: EffectViewSession) {
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
    range.setAttribute('aria-label', metadata.displayName)
    range.setAttribute('aria-valuetext', metadata.displayValue(initialValue))

    const valueRow = document.createElement('span')
    valueRow.className = 'effect-parameter-value'
    const output = document.createElement('output')
    output.textContent = metadata.displayValue(initialValue)
    output.setAttribute('aria-hidden', 'true')
    valueRow.appendChild(output)

    const applyValue = (value: number) => {
      const boundedValue = this.clamp(value, metadata.minValue, metadata.maxValue)
      range.value = String(this.clamp(metadata.normalize(boundedValue), 0, 1))
      output.textContent = metadata.displayValue(boundedValue)
      range.setAttribute('aria-valuetext', metadata.displayValue(boundedValue))
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

    field.append(name, valueRow, range)
    return field
  }

  private async commitParameterValue(session: EffectViewSession, metadata: ParameterMetadata, value: number) {
    const state = session.track.effectRegions.find((effect) => effect.instanceId == session.effectInstanceId)?.state
    await this.commitEffectValues(session, { [metadata.id]: value }, state, `change ${metadata.id}`)
  }

  private commitEffectValues(
    session: EffectViewSession,
    parameters: Readonly<Record<string, number>>,
    state: unknown,
    description: string,
  ) {
    const commit = async () => {
      try {
        const effectIndex = session.track.effectRegions.findIndex(
          (effect) => effect.instanceId == session.effectInstanceId,
        )
        if (effectIndex < 0) {
          return
        }
        const oldEffects = cloneEffectData(session.track.effectRegions)
        const newEffects = cloneEffectData(oldEffects)
        const effect = newEffects[effectIndex]
        let changed = JSON.stringify(effect.state) != JSON.stringify(state)
        effect.state = structuredClone(state)
        for (const [parameterId, value] of Object.entries(parameters)) {
          const sequence = effect.params[parameterId]
          if (!sequence) {
            continue
          }
          changed ||= sequence.initialValue != value
          sequence.initialValue = value
        }
        if (!changed) {
          return
        }
        await editorHistory.execute(new SetTrackEffectsCommand(session.track, oldEffects, newEffects, description))
      } catch (error) {
        await this.refreshOwnedEffectView()
        NotificationsController.showError(withCause('Could not persist the latest effect setting', error))
      }
    }
    const result = session.commitQueue.then(commit)
    session.commitQueue = result.catch(() => {})
    return result
  }

  private async refreshOwnedEffectView() {
    const session = this.activeEffectView
    if (!session || session.closed || !session.ownsModule) {
      return
    }
    const effectData = session.track.effectRegions.find((effect) => effect.instanceId == session.effectInstanceId)
    if (!effectData) {
      return
    }
    session.module.setState?.(effectData.state)
    for (const [name, sequence] of Object.entries(effectData.params)) {
      session.parameters[name]?.setValueAtTime(sequence.initialValue, session.audioContext.currentTime)
    }
  }

  private requestEffectViewRebind() {
    this.effectViewRebindRequested = true
    if (!this.effectViewRebindRunning) {
      void this.processEffectViewRebinds()
    }
  }

  private async processEffectViewRebinds() {
    this.effectViewRebindRunning = true
    try {
      while (this.effectViewRebindRequested) {
        this.effectViewRebindRequested = false
        await this.rebindEffectView()
        if (!this.effectViewMatchesPlayback()) {
          this.effectViewRebindRequested = true
        }
      }
    } finally {
      this.effectViewRebindRunning = false
      if (this.effectViewRebindRequested) {
        void this.processEffectViewRebinds()
      }
    }
  }

  private effectViewMatchesPlayback() {
    const session = this.activeEffectView
    if (!session || session.closed) {
      return true
    }
    const playbackEffect = session.track.getPlaybackEffect(session.effectInstanceId)
    return playbackEffect
      ? playbackEffect.module == session.module && playbackEffect.audioContext == session.audioContext
      : session.ownsModule && session.audioContext.state != 'closed'
  }

  private async rebindEffectView() {
    const session = this.activeEffectView
    if (!session || session.closed || this.effectViewMatchesPlayback()) {
      return
    }
    const effectIndex = session.track.effectRegions.findIndex((effect) => effect.instanceId == session.effectInstanceId)
    const metadata =
      effectIndex >= 0 ? this.effectIndex.getEffectMetadataById(session.track.effectRegions[effectIndex].id) : null
    if (!metadata) {
      return
    }

    await this.showEffectForTrack(metadata, session.track, effectIndex)
  }

  private createEffectChainItem(track: Track, index: number, effectData: EffectData, metadata: EffectMetadata | null) {
    const bypassed = effectData.bypassed ?? false
    const item = document.createElement('article')
    item.className = 'effect-list-item effect-chain-item effect-chain-effect'
    item.classList.toggle('effect-chain-bypassed', bypassed)
    item.dataset.instanceId = effectData.instanceId
    item.style.border = 'double'

    const openButton = document.createElement('button')
    openButton.type = 'button'
    openButton.className = 'clickable effect-chain-open'
    const nameElement = document.createElement('strong')
    nameElement.textContent = metadata?.name ?? effectData.id
    const nameId = `effect-chain-name-${effectData.instanceId}`
    nameElement.id = nameId
    const typeElement = document.createElement('span')
    typeElement.textContent = bypassed ? 'Bypassed' : 'Effect'
    openButton.append(nameElement, typeElement)
    openButton.disabled = !metadata
    if (metadata) {
      openButton.addEventListener('click', () => void this.showEffectForTrack(metadata, track, index))
    } else {
      openButton.title = 'Effect metadata could not be loaded'
    }

    const controls = document.createElement('div')
    controls.className = 'effect-chain-controls'
    const bypassButton = this.createControlButton('Bypass', 'power')
    bypassButton.classList.add('effect-chain-bypass')
    bypassButton.setAttribute('aria-pressed', String(bypassed))
    bypassButton.addEventListener('click', () => void this.setEffectBypassed(track, effectData.instanceId, !bypassed))
    const automationButton = this.createControlButton('Automate', 'automation')
    automationButton.disabled = !metadata?.parameters.length
    if (metadata?.parameters.length) {
      automationButton.addEventListener('click', () => this.openAutomationView(track, effectData, metadata))
    }
    const moveLeftButton = this.createControlButton('Move left', 'arrow-right', 'effect-icon-left')
    moveLeftButton.classList.add('effect-chain-move-left')
    moveLeftButton.disabled = index == 0
    moveLeftButton.addEventListener('click', () => void this.moveEffect(track, index, index - 1))
    const moveRightButton = this.createControlButton('Move right', 'arrow-right')
    moveRightButton.classList.add('effect-chain-move-right')
    moveRightButton.disabled = index == track.effectRegions.length - 1
    moveRightButton.addEventListener('click', () => void this.moveEffect(track, index, index + 1))
    const removeButton = this.createControlButton('Remove', 'trash')
    removeButton.classList.add('effect-chain-remove')
    removeButton.addEventListener('click', () => void this.removeEffect(track, index))
    const buttons = [bypassButton, automationButton, moveLeftButton, moveRightButton, removeButton]
    for (const button of buttons) {
      button.setAttribute('aria-describedby', nameId)
    }
    controls.append(...buttons)
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

  private createControlButton(label: string, symbolId: string, iconClassName?: string) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'clickable effect-chain-control'
    const labelElement = document.createElement('span')
    labelElement.textContent = label
    button.append(
      createSvgIcon(symbolId, { className: `effect-chain-control-icon ${iconClassName ?? ''}` }),
      labelElement,
    )
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
      const instanceId = this.createInstanceId()
      newEffects.push({
        instanceId,
        id: metadata.id,
        params,
        state: metadata.createDefaultState?.(),
      })
      await editorHistory.execute(
        new SetTrackEffectsCommand(track, oldEffects, newEffects, `add ${metadata.name} effect`),
      )
      if (viewVersion == this.viewVersion) {
        await this.showTrackEffectsList(track)
        this.chainItem(instanceId)?.querySelector<HTMLElement>('.effect-chain-open')?.focus()
        announce(`Added ${metadata.name}`)
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
        const item = this.chainItem(effect.instanceId)
        const moveButton = item?.querySelector<HTMLButtonElement>(
          toIndex < fromIndex ? '.effect-chain-move-left' : '.effect-chain-move-right',
        )
        if (moveButton && !moveButton.disabled) {
          moveButton.focus()
        } else {
          item?.querySelector<HTMLElement>('.effect-chain-open')?.focus()
        }
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
      const removed = oldEffects[index]
      const name = this.effectIndex.getEffectMetadataById(removed.id)?.name ?? removed.id
      const neighbourId = (oldEffects[index + 1] ?? oldEffects[index - 1])?.instanceId
      newEffects.splice(index, 1)
      await editorHistory.execute(new SetTrackEffectsCommand(track, oldEffects, newEffects, 'remove track effect'))
      if (viewVersion == this.viewVersion) {
        await this.showTrackEffectsList(track)
        const neighbour = neighbourId === undefined ? null : this.chainItem(neighbourId)
        if (neighbour) {
          neighbour.querySelector<HTMLElement>('.effect-chain-open')?.focus()
        } else {
          document.querySelector<HTMLElement>('#bottom-panel .effect-chain-add')?.focus()
        }
        announce(`Removed ${name}`)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private async setEffectBypassed(track: Track, instanceId: string, bypassed: boolean) {
    const index = track.effectRegions.findIndex((effect) => effect.instanceId == instanceId)
    if (this.chainChangePending || index < 0) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(track.effectRegions)
      const newEffects = cloneEffectData(oldEffects)
      const effect = newEffects[index]
      const name = this.effectIndex.getEffectMetadataById(effect.id)?.name ?? effect.id
      if ((effect.bypassed ?? false) != bypassed) {
        effect.bypassed = bypassed
        await editorHistory.execute(
          new SetTrackEffectsCommand(track, oldEffects, newEffects, `${bypassed ? 'bypass' : 'enable'} ${name} effect`),
        )
      }
      if (viewVersion == this.viewVersion) {
        await this.showTrackEffectsList(track)
        this.chainItem(instanceId)?.querySelector<HTMLElement>('.effect-chain-bypass')?.focus()
        announce(`${bypassed ? 'Bypassed' : 'Enabled'} ${name}`)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private chainItem(instanceId: string) {
    return document.querySelector<HTMLElement>(`#bottom-panel [data-instance-id="${CSS.escape(instanceId)}"]`)
  }

  private get trackListController() {
    return (window as any).trackListController as TrackListController
  }

  private openAutomationView(track: Track, effectData: EffectData, metadata: EffectMetadata) {
    const parameters = metadata.parameters.filter((parameter) => effectData.params[parameter.id])
    if (parameters.length == 0) {
      return
    }
    this.bottomPanelController.close(this)
    this.trackListController.enterAutomationMode(track, effectData.instanceId, parameters)
  }

  private async closeEffectView() {
    const session = this.activeEffectView
    if (!session || session.closed) {
      return
    }
    this.activeEffectView = null
    this.destroyEffectSession(session)
    await session.commitQueue
  }

  private destroyEffectSession(session: EffectViewSession) {
    session.unsubscribePlaybackChange()
    session.abortController.abort()
    session.closed = true
    if (session.ownsModule) {
      session.module.disconnect()
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
      tab: 'tracks',
      owner: this,
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
    announce(`${title}. ${message}`, 'assertive')
    this.openSubview(title, track.name, body, track)
  }

  private createEffectCatalogItem(track: Track, metadata: EffectMetadata) {
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
        NotificationsController.showError(withCause('Could not add the effect', error))
      })
    })

    const [nameElement, descriptionElement] = this.getEffectDescriptionElements(metadata)
    addEffectButton.setAttribute('aria-describedby', nameElement.id)
    listItemElement.append(nameElement, addEffectButton, descriptionElement)
    return listItemElement
  }

  private getEffectDescriptionElements(metadata: EffectMetadata) {
    const nameElement = document.createElement('p')
    nameElement.className = 'effect-name'
    nameElement.textContent = metadata.name
    nameElement.id = `effect-catalog-name-${metadata.id}-${++nextCatalogNameId}`

    const descriptionElement = document.createElement('p')
    descriptionElement.className = 'effect-description'
    descriptionElement.textContent = metadata.description
    return [nameElement, descriptionElement]
  }
}

export function getPanelSubtitle(track: Track, sampleRate: number, startPosition: number, endPosition: number) {
  return (
    `${track.name}: ` +
    `${TimeUtils.positionToString(startPosition, sampleRate, false)}` +
    ` - ${TimeUtils.positionToString(endPosition, sampleRate, false)}`
  )
}
