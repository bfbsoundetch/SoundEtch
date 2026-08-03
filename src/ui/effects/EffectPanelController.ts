import { AudioControl } from '../../audiocontext/AudioControl'
import { TimeUtils } from '../../global/TimeUtils'
import { ProjectManager } from '../../project/ProjectManager'
import { Track } from '../../project/Track'
import { BottomPanelController } from '../BottomPanelController'
import { NotificationsController } from '../NotificationsController'
import { createArrowIcon, createSvgIcon } from '../SvgIcon'
import { editorHistory } from '../undo/EditorHistory'
import { cloneEffectData, SetTrackEffectsCommand } from './SetTrackEffectsCommand'
import { AutomationController } from '../../ui/timeline/AutomationController'
import { EffectData } from '../../effects/EffectData'
import { TrackListController } from 'ui/timeline/TrackListController'

type PluginViewSession = {
  track: Track
  effectInstanceId: string
  module: WebAudioModule
  gui: Element | null
  ownsModule: boolean
  abortController: AbortController
  saveQueue: Promise<void>
  closed: boolean
}

export class EffectPanelController {
  private static instance: EffectPanelController | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new EffectPanelController())
  }

  private readonly bottomPanelController = BottomPanelController.getInstance()
  private activePluginView: PluginViewSession | null = null
  private viewVersion = 0
  private chainChangePending = false

  private constructor() {}

  async showPluginForTrack(plugin: Wam2PluginDescriptor, track: Track, effectIndex?: number) {
    const viewVersion = ++this.viewVersion
    await this.closePluginView(true)
    if (viewVersion != this.viewVersion) {
      return
    }

    const resolvedIndex = effectIndex ?? track.effectRegions.findIndex((effect) => effect.id == plugin.identifier)
    const effectData = track.effectRegions[resolvedIndex]
    if (!effectData || effectData.id != plugin.identifier || !effectData.instanceId) {
      this.showMessage('Plugin unavailable', 'This effect is no longer on the track.', track)
      return
    }

    const loadingElement = document.createElement('div')
    loadingElement.className = 'effect-panel-message'
    loadingElement.textContent = `Loading ${plugin.name}...`
    this.openSubview(plugin.name, track.name, loadingElement, track)

    const pluginSession = await this.startPluginSession(track, plugin)

    try {
      pluginSession.gui = await pluginSession.module.createGui()
    } catch (error) {
      console.error(`Failed to open plugin ${plugin.identifier}`, error)
      if (module && pluginSession.ownsModule) {
        this.destroyModule(pluginSession.module)
      }
      if (viewVersion == this.viewVersion) {
        this.showMessage('Plugin failed to load', String(error), track)
      }
      return
    }

    const pluginBody = document.createElement('div')
    pluginBody.className = 'effect-plugin-body'
    pluginBody.style.userSelect = 'none'
    pluginBody.appendChild(pluginSession.gui)
    this.bottomPanelController.open({
      title: pluginSession.module.name || plugin.name,
      subtitle: track.name,
      body: pluginBody,
      onBack: () => this.showTrackEffectsList(track),
      onClose: () => this.handlePanelClose(),
    })
    pluginSession.gui.addEventListener(
      'pointerdown',
      () => {
        document.addEventListener('pointerup', () => this.queuePluginStateCapture(pluginSession), {
          once: true,
          signal: pluginSession.abortController.signal,
        })
      },
      { signal: pluginSession.abortController.signal },
    )
    pluginSession.gui.addEventListener('change', () => this.queuePluginStateCapture(pluginSession), {
      signal: pluginSession.abortController.signal,
    })
  }

  async showTrackEffectsList(track: Track) {
    const viewVersion = ++this.viewVersion
    await this.closePluginView(true)
    if (viewVersion != this.viewVersion) {
      return
    }

    const plugins = await Promise.all(
      track.effectRegions.map(async (effect) => {
        try {
          return await this.wamPluginIndex.getPluginById(effect.id)
        } catch (error) {
          console.error(`Failed to find plugin ${effect.id}`, error)
          return undefined
        }
      }),
    )
    if (viewVersion != this.viewVersion) {
      return
    }

    const bodyElement = document.createElement('div')
    bodyElement.className = 'effect-list-body'
    bodyElement.appendChild(this.createChainEndpoint('Track', track.name))

    plugins.forEach((plugin, index) => {
      bodyElement.appendChild(this.createChainArrow())
      bodyElement.appendChild(this.createPluginChainItem(track, index, plugin))
    })

    bodyElement.appendChild(this.createChainArrow())
    const addNewPluginElement = document.createElement('button')
    addNewPluginElement.type = 'button'
    addNewPluginElement.className = 'effect-list-item effect-chain-item effect-chain-add clickable'
    addNewPluginElement.append('Add New Effect', createSvgIcon('plus', { className: 'effect-chain-add-icon' }))
    addNewPluginElement.style.fontWeight = 'bold'
    addNewPluginElement.addEventListener('click', () => {
      void this.showAvailableEffectsList(track)
    })
    bodyElement.appendChild(addNewPluginElement)

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
    await this.closePluginView(true)
    if (viewVersion != this.viewVersion) {
      return
    }

    const loadingElement = document.createElement('div')
    loadingElement.className = 'effect-panel-message'
    loadingElement.textContent = 'Loading available effects...'
    this.openSubview('Add Effect', track.name, loadingElement, track)

    try {
      const plugins = await this.wamPluginIndex.getCommunityPluginsList()
      if (viewVersion != this.viewVersion) {
        return
      }

      const bodyElement = document.createElement('div')
      bodyElement.className = 'effect-list-body'
      for (const plugin of plugins) {
        const listItemElement = document.createElement('article')
        listItemElement.className = 'effect-list-item effect-catalog-item'

        const addPluginButton = document.createElement('button')
        addPluginButton.type = 'button'
        addPluginButton.className = 'clickable effect-catalog-add'
        addPluginButton.textContent = 'Add to track'
        addPluginButton.addEventListener('click', () => {
          addPluginButton.disabled = true
          void this.addEffect(track, plugin).catch((error) => {
            addPluginButton.disabled = false
            console.error('Failed to add effect', error)
          })
        })
        listItemElement.append(addPluginButton, this.getPluginDescriptionElement(plugin))
        bodyElement.appendChild(listItemElement)
      }
      this.openSubview('Add Effect', track.name, bodyElement, track)
    } catch (error) {
      console.error('Failed to load available effects', error)
      if (viewVersion == this.viewVersion) {
        this.showMessage('Effects unavailable', String(error), track)
      }
    }
  }

  private async startPluginSession(track: Track, plugin: Wam2PluginDescriptor) {
    const effectData = track.effectRegions.find(e => e.id == plugin.identifier)!
    let module = track.getEffectModuleById(plugin.identifier)
    const ownsModule = true

    if (!module) {
      const audioContext = await AudioControl.getOrCreateAudioContext()
      module = await WamManager.getInstance().loadPlugin(plugin.path, audioContext, effectData.state)
    }
    const session: PluginViewSession = {
      track,
      effectInstanceId: effectData.instanceId,
      module,
      gui: null,
      ownsModule,
      abortController: new AbortController(),
      saveQueue: Promise.resolve(),
      closed: false,
    }
    this.activePluginView = session
    return session
  }

  private createPluginChainItem(track: Track, index: number, effectData: EffectData) {
    const item = document.createElement('article')
    item.className = 'effect-list-item effect-chain-item effect-plugin-item'
    item.style.border = 'double'

    const openButton = document.createElement('button')
    openButton.type = 'button'
    openButton.className = 'clickable effect-chain-open'
    const typeElement = document.createElement('strong')
    typeElement.textContent = 'Effect'
    const nameElement = document.createElement('span')
    nameElement.textContent = plugin?.name ?? track.effectRegions[index].id
    openButton.append(typeElement, nameElement)
    openButton.disabled = !plugin
    if (plugin) {
      openButton.addEventListener('click', () => {
        void this.showPluginForTrack(plugin, track, index)
      })
    } else {
      openButton.title = 'Plugin metadata could not be loaded'
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
    automationButton.addEventListener('click', () => void this.openAutomationView(track, plugin!))
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

  private async addEffect(track: Track, plugin: Wam2PluginDescriptor) {
    if (this.chainChangePending) {
      return
    }
    this.chainChangePending = true
    const viewVersion = this.viewVersion
    try {
      const oldEffects = cloneEffectData(track.effectRegions)
      const newEffects = cloneEffectData(oldEffects)
      newEffects.push({
        wamPluginEffect: true,
        instanceId: this.createInstanceId(),
        id: plugin.identifier,
        state: undefined,
        values: [],
      })
      await editorHistory.execute(
        new SetTrackEffectsCommand(track, oldEffects, newEffects, `add ${plugin.name} effect`),
      )
      if (viewVersion == this.viewVersion) {
        await this.showTrackEffectsList(track)
      }
    } finally {
      this.chainChangePending = false
    }
  }

  private async moveEffect(track: Track, fromIndex: number, toIndex: number) {
    if (this.chainChangePending) {
      return
    }
    if (
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
    if (this.chainChangePending) {
      return
    }
    if (index < 0 || index >= track.effectRegions.length) {
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

  private async openAutomationView(track: Track, plugin: Wam2PluginDescriptor) {
    const session = await this.startPluginSession(track, plugin)
    const paramInfo = await session.module.audioNode.getParameterInfo()
    const trackListController = (window as any).trackListController as TrackListController
    const waveformSvg = trackListController.waveforms.find(w => w.track == track)?.topGroupElement
    if (!waveformSvg) {
      return
    }
    const firstParam = Object.keys(paramInfo).map(key => 
      paramInfo[key]).filter(info => info.type == 'float' || info.type == 'int').find(_ => true)
    if (!firstParam) {
      return
    }
    const paramData = await session.module.audioNode.getParameterValues(true, firstParam.id)
    const state = await session.module.audioNode.getState()
    console.error('pararam', JSON.stringify(paramData), JSON.stringify(state))
    const automationController = new AutomationController(trackListController, plugin.identifier, waveformSvg, track, firstParam, paramData[firstParam.id].value)
    automationController.draw()
  }

  private queuePluginStateCapture(session: PluginViewSession) {
    if (session.closed) {
      return session.saveQueue
    }
    let capturedState: unknown
    let hasCapturedState = false
    const statePromise = session.module.audioNode.getState().then((state) => {
      capturedState = structuredClone(state) as unknown
      hasCapturedState = true
      return capturedState
    })
    session.saveQueue = session.saveQueue
      .then(async () => {
        const state = await statePromise
        const effectIndex = session.track.effectRegions.findIndex(
          (effect) => effect.instanceId == session.effectInstanceId,
        )
        if (effectIndex < 0 || this.statesEqual(session.track.effectRegions[effectIndex].state, state)) {
          return
        }

        const oldEffects = cloneEffectData(session.track.effectRegions)
        const newEffects = cloneEffectData(oldEffects)
        newEffects[effectIndex].state = state
        await editorHistory.execute(
          new SetTrackEffectsCommand(session.track, oldEffects, newEffects, 'change effect settings'),
        )
      })
      .catch((error) => {
        if (hasCapturedState) {
          const effect = session.track.effectRegions.find(
            (item) => item.instanceId == session.effectInstanceId,
          )
          if (effect) {
            effect.state = capturedState
          }
        }
        console.error('Failed to save plugin state', error)
        NotificationsController.showErrorMessage('Could not persist the latest plugin settings.')
      })
    return session.saveQueue
  }

  private async closePluginView(saveState: boolean) {
    const session = this.activePluginView
    if (!session || session.closed) {
      return
    }
    this.activePluginView = null
    session.abortController.abort()
    if (saveState) {
      await this.queuePluginStateCapture(session)
    }
    session.closed = true
    await session.saveQueue
    try {
      if (session.gui) {
        session.module.destroyGui(session.gui)
      }
    } catch (error) {
      console.error('Failed to destroy plugin GUI', error)
    }
    if (session.ownsModule) {
      this.destroyModule(session.module)
    }
  }

  private destroyModule(module: WebAudioModule) {
    module.audioNode.disconnect()
    module.audioNode.destroy()
  }

  private createInstanceId() {
    return globalThis.crypto.randomUUID()
  }

  private statesEqual(first: unknown, second: unknown) {
    if (Object.is(first, second)) {
      return true
    }
    if (this.containsNonJsonState(first) || this.containsNonJsonState(second)) {
      return false
    }
    try {
      return JSON.stringify(first) == JSON.stringify(second)
    } catch {
      return false
    }
  }

  private containsNonJsonState(value: unknown, seen = new WeakSet<object>()): boolean {
    if (!value || typeof value != 'object') {
      return false
    }
    if (
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value) ||
      value instanceof Blob ||
      value instanceof Map ||
      value instanceof Set
    ) {
      return true
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype != Object.prototype && prototype != Array.prototype && !(value instanceof Date)) {
      return true
    }
    if (seen.has(value)) {
      return true
    }
    seen.add(value)
    return Object.values(value).some((child) => this.containsNonJsonState(child, seen))
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
    await this.closePluginView(true)
  }

  private showMessage(title: string, message: string, track: Track) {
    const body = document.createElement('div')
    body.className = 'effect-panel-message'
    body.textContent = message
    this.openSubview(title, track.name, body, track)
  }

  private getPluginDescriptionElement(plugin: Wam2PluginDescriptor) {
    const parentElement = document.createElement('div')
    parentElement.className = 'effect-plugin-description'

    const listItemLabelElement = document.createElement('p')
    listItemLabelElement.className = 'effect-plugin-name'
    listItemLabelElement.textContent = plugin.name
    parentElement.appendChild(listItemLabelElement)

    if (plugin.thumbnail) {
      const listItemThumbnailElement = document.createElement('img')
      listItemThumbnailElement.src = WamPluginIndex.COMMUNITY_WAM_URL + plugin.thumbnail
      listItemThumbnailElement.alt = ''
      parentElement.appendChild(listItemThumbnailElement)
    }

    const listItemCategoryElement = document.createElement('p')
    listItemCategoryElement.className = 'effect-plugin-category'
    listItemCategoryElement.textContent = plugin.category.join(', ')
    parentElement.appendChild(listItemCategoryElement)

    const listItemDescriptionElement = document.createElement('p')
    listItemDescriptionElement.textContent = plugin.description
    parentElement.appendChild(listItemDescriptionElement)

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
