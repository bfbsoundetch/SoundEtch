import { PointerStateManager } from 'ui/PointerStateManager'
import { AudioControl } from '../../audiocontext/AudioControl'
import { EffectMetadata, EffectModule } from '../../effects/Effect'
import { EffectData } from '../../effects/EffectData'
import { EffectIndex } from '../../effects/EffectIndex'
import { ParameterMetadata } from '../../effects/ParameterMetadata'
import { ParameterValueSequence } from '../../effects/ParameterValueSequence'
import { TimeUtils } from '../../global/TimeUtils'
import type { EffectHost } from '../../project/EffectHost'
import { OutputBus } from '../../project/OutputBus'
import { Track } from '../../project/Track'
import { TopPanelController, type TopPanelTabId } from '../TopPanelController'
import { NotificationsController } from '../NotificationsController'
import { announce } from '../LiveAnnouncer'
import type { OutputPanelController } from '../OutputPanelController'
import { createArrowIcon, createSvgIcon } from '../SvgIcon'
import { TrackListController } from '../timeline/TrackListController'
import { editorHistory } from '../undo/EditorHistory'
import { cloneEffectData, SetEffectsCommand } from './SetEffectsCommand'

type EffectViewSession = {
  host: EffectHost
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

/** The top panel tab that shows `host`'s effect chain. */
function panelTab(host: EffectHost): TopPanelTabId {
  return host instanceof OutputBus ? 'output' : 'tracks'
}

/** What the chain belongs to, as undo descriptions and messages name it. */
function chainOwner(host: EffectHost): 'output' | 'track' {
  return host instanceof OutputBus ? 'output' : 'track'
}

export class EffectPanelController {
  private static instance: EffectPanelController | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new EffectPanelController())
  }

  private readonly effectIndex = EffectIndex.getInstance()
  private readonly topPanelController = TopPanelController.getInstance()
  private activeEffectView: EffectViewSession | null = null
  /** The tab holding this controller's view, which is in one tab at a time. */
  private viewTab: TopPanelTabId | null = null
  private viewVersion = 0
  private chainChangePending = false
  private effectViewRebindRequested = false
  private effectViewRebindRunning = false

  private constructor() {
    editorHistory.addChangeListener(() => this.refreshOwnedEffectView())
  }

  async showEffect(metadata: EffectMetadata, host: EffectHost, effectIndex?: number) {
    this.closeViewInOtherTab(host)
    const viewVersion = ++this.viewVersion
    await this.closeEffectView()
    if (viewVersion != this.viewVersion) {
      return
    }

    const resolvedIndex = effectIndex ?? host.effectRegions.findIndex((effect) => effect.id == metadata.id)
    const effectData = host.effectRegions[resolvedIndex]
    if (!effectData || effectData.id != metadata.id) {
      this.showMessage('Effect unavailable', `This effect is no longer on the ${chainOwner(host)}.`, host)
      return
    }

    const loadingElement = document.createElement('div')
    loadingElement.className = 'effect-panel-message'
    loadingElement.textContent = `Loading ${metadata.name}...`
    this.openSubview(metadata.name, host.name, loadingElement, host)
    announce(`Loading ${metadata.name}`)

    try {
      const session = await this.startEffectSession(host, effectData)
      if (viewVersion != this.viewVersion) {
        this.destroyEffectSession(session)
        return
      }
      this.activeEffectView = session
      const unsubscribePlaybackChange = session.host.addPlaybackChangeListener(() => this.requestEffectViewRebind())
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
      this.openSubview(metadata.name, host.name, body, host)
      if (!this.effectViewMatchesPlayback()) {
        this.requestEffectViewRebind()
      }
    } catch (error) {
      console.error(`Failed to open effect ${metadata.id}`, error)
      if (viewVersion == this.viewVersion) {
        this.showMessage('Effect failed to load', String(error), host)
      }
    }
  }

  /** Opens the top panel on `host`'s effect chain: a track's Effects view, or the output's Audio view. */
  async showEffectsList(host: EffectHost) {
    this.closeViewInOtherTab(host)
    const viewVersion = ++this.viewVersion
    await this.closeEffectView()
    if (viewVersion != this.viewVersion) {
      return
    }
    if (host instanceof OutputBus) {
      this.outputPanelController.show('audio')
    } else {
      this.trackListController.trackPanelController.show(host, 'effects')
    }
  }

  createEffectsChain(host: EffectHost): HTMLElement {
    const output = host instanceof OutputBus
    const bodyElement = document.createElement('div')
    bodyElement.className = 'effect-list-body'
    bodyElement.appendChild(
      output ? this.createChainEndpoint('All tracks') : this.createChainEndpoint('Track', host.name),
    )

    host.effectRegions.forEach((effectData, index) => {
      bodyElement.appendChild(this.createChainArrow())
      bodyElement.appendChild(
        this.createEffectChainItem(host, index, effectData, this.effectIndex.getEffectMetadataById(effectData.id)),
      )
    })

    bodyElement.appendChild(this.createChainArrow())
    const addEffectElement = document.createElement('button')
    addEffectElement.type = 'button'
    addEffectElement.className = 'effect-list-item effect-chain-item effect-chain-add clickable'
    addEffectElement.append('Add New Effect', createSvgIcon('plus', { className: 'effect-chain-add-icon' }))
    addEffectElement.style.fontWeight = 'bold'
    addEffectElement.addEventListener('click', () => void this.showAvailableEffectsList(host))
    bodyElement.appendChild(addEffectElement)

    bodyElement.appendChild(this.createChainArrow())
    bodyElement.appendChild(
      output ? this.createChainEndpoint('Final mix', 'Playback and export') : this.createChainEndpoint('Output'),
    )
    return bodyElement
  }

  async showAvailableEffectsList(host: EffectHost) {
    this.closeViewInOtherTab(host)
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
        categoryItemsElement.appendChild(this.createEffectCatalogItem(host, metadata))
      }

      categoryElement.append(categorySummaryElement, categoryItemsElement)
      bodyElement.appendChild(categoryElement)
    }
    this.openSubview('Add Effect', host.name, bodyElement, host)
  }

  private async startEffectSession(host: EffectHost, effectData: EffectData): Promise<EffectViewSession> {
    const playbackEffect = host.getPlaybackEffect(effectData.instanceId)
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
      host,
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
      const effectData = session.host.effectRegions.find((effect) => effect.instanceId == session.effectInstanceId)
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
    const state = session.host.effectRegions.find((effect) => effect.instanceId == session.effectInstanceId)?.state
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
        const effectIndex = session.host.effectRegions.findIndex(
          (effect) => effect.instanceId == session.effectInstanceId,
        )
        if (effectIndex < 0) {
          return
        }
        const oldEffects = cloneEffectData(session.host.effectRegions)
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
        await editorHistory.execute(new SetEffectsCommand(session.host, oldEffects, newEffects, description))
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
    const effectData = session.host.effectRegions.find((effect) => effect.instanceId == session.effectInstanceId)
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
    const playbackEffect = session.host.getPlaybackEffect(session.effectInstanceId)
    return playbackEffect
      ? playbackEffect.module == session.module && playbackEffect.audioContext == session.audioContext
      : session.ownsModule && session.audioContext.state != 'closed'
  }

  private async rebindEffectView() {
    const session = this.activeEffectView
    if (!session || session.closed || this.effectViewMatchesPlayback()) {
      return
    }
    const effectIndex = session.host.effectRegions.findIndex((effect) => effect.instanceId == session.effectInstanceId)
    const metadata =
      effectIndex >= 0 ? this.effectIndex.getEffectMetadataById(session.host.effectRegions[effectIndex].id) : null
    if (!metadata) {
      return
    }

    await this.showEffect(metadata, session.host, effectIndex)
  }

  private createEffectChainItem(
    host: EffectHost,
    index: number,
    effectData: EffectData,
    metadata: EffectMetadata | null,
  ) {
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
      openButton.addEventListener('click', () => void this.showEffect(metadata, host, index))
    } else {
      openButton.title = 'Effect metadata could not be loaded'
    }

    const controls = document.createElement('div')
    controls.className = 'effect-chain-controls'
    const bypassButton = this.createControlButton('Bypass', 'power')
    bypassButton.classList.add('effect-chain-bypass')
    bypassButton.setAttribute('aria-pressed', String(bypassed))
    bypassButton.addEventListener('click', () => void this.setEffectBypassed(host, effectData.instanceId, !bypassed))
    const automationButton = this.createControlButton('Automate', 'automation')
    automationButton.disabled = !metadata?.parameters.length
    if (metadata?.parameters.length) {
      automationButton.addEventListener('click', () => this.openAutomationView(host, effectData, metadata))
    }
    const moveLeftButton = this.createControlButton('Move left', 'arrow-right', 'effect-icon-left')
    moveLeftButton.classList.add('effect-chain-move-left')
    moveLeftButton.disabled = index == 0
    moveLeftButton.addEventListener('click', () => void this.moveEffect(host, index, index - 1))
    const moveRightButton = this.createControlButton('Move right', 'arrow-right')
    moveRightButton.classList.add('effect-chain-move-right')
    moveRightButton.disabled = index == host.effectRegions.length - 1
    moveRightButton.addEventListener('click', () => void this.moveEffect(host, index, index + 1))
    const removeButton = this.createControlButton('Remove', 'trash')
    removeButton.classList.add('effect-chain-remove')
    removeButton.addEventListener('click', () => void this.removeEffect(host, index))
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

  private async addEffect(host: EffectHost, metadata: EffectMetadata) {
    if (this.chainChangePending) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(host.effectRegions)
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
      await editorHistory.execute(new SetEffectsCommand(host, oldEffects, newEffects, `add ${metadata.name} effect`))
      if (viewVersion == this.viewVersion) {
        await this.showEffectsList(host)
        this.chainItem(host, instanceId)?.querySelector<HTMLElement>('.effect-chain-open')?.focus()
        announce(`Added ${metadata.name}`)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private async moveEffect(host: EffectHost, fromIndex: number, toIndex: number) {
    if (
      this.chainChangePending ||
      fromIndex == toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= host.effectRegions.length ||
      toIndex >= host.effectRegions.length
    ) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(host.effectRegions)
      const newEffects = cloneEffectData(oldEffects)
      const [effect] = newEffects.splice(fromIndex, 1)
      newEffects.splice(toIndex, 0, effect)
      await editorHistory.execute(
        new SetEffectsCommand(host, oldEffects, newEffects, `reorder ${chainOwner(host)} effects`),
      )
      if (viewVersion == this.viewVersion) {
        await this.showEffectsList(host)
        const item = this.chainItem(host, effect.instanceId)
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

  private async removeEffect(host: EffectHost, index: number) {
    if (this.chainChangePending || index < 0 || index >= host.effectRegions.length) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(host.effectRegions)
      const newEffects = cloneEffectData(oldEffects)
      const removed = oldEffects[index]
      const name = this.effectIndex.getEffectMetadataById(removed.id)?.name ?? removed.id
      const neighbourId = (oldEffects[index + 1] ?? oldEffects[index - 1])?.instanceId
      newEffects.splice(index, 1)
      await editorHistory.execute(
        new SetEffectsCommand(host, oldEffects, newEffects, `remove ${chainOwner(host)} effect`),
      )
      if (viewVersion == this.viewVersion) {
        await this.showEffectsList(host)
        const neighbour = neighbourId === undefined ? null : this.chainItem(host, neighbourId)
        if (neighbour) {
          neighbour.querySelector<HTMLElement>('.effect-chain-open')?.focus()
        } else {
          document.querySelector<HTMLElement>(`#top-panel-${panelTab(host)} .effect-chain-add`)?.focus()
        }
        announce(`Removed ${name}`)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private async setEffectBypassed(host: EffectHost, instanceId: string, bypassed: boolean) {
    const index = host.effectRegions.findIndex((effect) => effect.instanceId == instanceId)
    if (this.chainChangePending || index < 0) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(host.effectRegions)
      const newEffects = cloneEffectData(oldEffects)
      const effect = newEffects[index]
      const name = this.effectIndex.getEffectMetadataById(effect.id)?.name ?? effect.id
      if ((effect.bypassed ?? false) != bypassed) {
        effect.bypassed = bypassed
        await editorHistory.execute(
          new SetEffectsCommand(host, oldEffects, newEffects, `${bypassed ? 'bypass' : 'enable'} ${name} effect`),
        )
      }
      if (viewVersion == this.viewVersion) {
        await this.showEffectsList(host)
        this.chainItem(host, instanceId)?.querySelector<HTMLElement>('.effect-chain-bypass')?.focus()
        announce(`${bypassed ? 'Bypassed' : 'Enabled'} ${name}`)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private chainItem(host: EffectHost, instanceId: string) {
    return document.querySelector<HTMLElement>(
      `#top-panel-${panelTab(host)} [data-instance-id="${CSS.escape(instanceId)}"]`,
    )
  }

  private get trackListController() {
    return (window as any).trackListController as TrackListController
  }

  private get outputPanelController() {
    return (window as any).outputPanelController as OutputPanelController
  }

  private openAutomationView(host: EffectHost, effectData: EffectData, metadata: EffectMetadata) {
    const parameters = metadata.parameters.filter((parameter) => effectData.params[parameter.id])
    if (parameters.length == 0) {
      return
    }
    this.topPanelController.close(this)
    this.trackListController.enterAutomationMode(host, effectData.instanceId, parameters)
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

  private openSubview(title: string, subtitle: string, body: HTMLElement, host: EffectHost) {
    this.viewTab = panelTab(host)
    this.topPanelController.open({
      tab: this.viewTab,
      owner: this,
      title,
      subtitle,
      body,
      onBack: () => this.showEffectsList(host),
      onClose: () => this.handlePanelClose(),
    })
  }

  /** Gives a view left in the other tab back to that tab's own view; its session would be gone. */
  private closeViewInOtherTab(host: EffectHost) {
    if (this.viewTab !== null && this.viewTab != panelTab(host)) {
      this.topPanelController.close(this)
    }
  }

  private async handlePanelClose() {
    this.viewTab = null
    ++this.viewVersion
    await this.closeEffectView()
  }

  private showMessage(title: string, message: string, host: EffectHost) {
    const body = document.createElement('div')
    body.className = 'effect-panel-message'
    body.textContent = message
    announce(`${title}. ${message}`, 'assertive')
    this.openSubview(title, host.name, body, host)
  }

  private createEffectCatalogItem(host: EffectHost, metadata: EffectMetadata) {
    const listItemElement = document.createElement('article')
    listItemElement.className = 'effect-list-item effect-catalog-item'

    const addEffectButton = document.createElement('button')
    addEffectButton.type = 'button'
    addEffectButton.className = 'bordered clickable effect-catalog-add'
    addEffectButton.textContent = `Add to ${chainOwner(host)}`
    addEffectButton.addEventListener('click', () => {
      addEffectButton.disabled = true
      void this.addEffect(host, metadata).catch((error) => {
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
