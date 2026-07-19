import { BottomPanelController } from '../../ui/BottomPanelController'
import { TimeUtils } from '../../global/TimeUtils'
import { Track } from '../../project/Track'
import { Wam2PluginDescriptor, WamPluginIndex } from '../../effects/WamPluginIndex'
import { createArrowIcon } from '../SvgIcon'
import { WamManager } from '../../effects/WamManager'
import { AudioControl } from '../../audiocontext/AudioControl'

export class EffectPanelController {

  private static instance: EffectPanelController | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new EffectPanelController())
  }

  private readonly wamPluginIndex = new WamPluginIndex()
  private readonly bottomPanelController = BottomPanelController.getInstance()

  private constructor() {}


  async showPluginForTrack(desc: Wam2PluginDescriptor, track: Track) {
    let module = track.getEffectModuleById(desc.identifier)
    if (!module) {
      const audioContext = await AudioControl.getOrCreateAudioContext()
      module = await WamManager.getInstance().loadPlugin(desc.path, audioContext)
    }

    const element = await module.createGui() as HTMLElement
    element.addEventListener('mousedown', () => {
      document.addEventListener('mouseup', async () => {
        console.error('new state: ', await module.audioNode.getState())
      }, { once: true } )
    })

    this.bottomPanelController.open({
      title: module.name,
      subtitle: '',
      body: element,
      onClose: async () => {
      }
    })
  }

  async showTrackEffectsList(track: Track) {
    const bodyElement = document.createElement('div')
    bodyElement.className = 'effect-list-body'

    const appendArrow = () => {
      const arrow = document.createElement('div')
      arrow.className = 'effect-list-arrow'
      arrow.appendChild(createArrowIcon())
      bodyElement.appendChild(arrow)
    }

    const startElement = document.createElement('div')
    const startElementTitle = document.createElement('p')
    startElementTitle.innerText = 'Track'
    startElementTitle.style.fontWeight = 'bolder'
    startElement.appendChild(startElementTitle)
    startElement.className = 'effect-list-item effect-chain-item'
    const startElementName = document.createElement('p')
    startElementName.innerText = track.name
    startElement.appendChild(startElementName)
    bodyElement.appendChild(startElement)

    for (const effectData of track.effectRegions) {
      appendArrow()
      const plugin = await this.wamPluginIndex.getPluginById(effectData.id)
      if (!plugin) {
        console.error('Plugin', effectData.id, 'not found!')
        continue
      }
      const pluginElement = document.createElement('div')
      const pluginElementTitle = document.createElement('p')
      pluginElementTitle.innerText = 'Effect'
      pluginElementTitle.style.fontWeight = 'bolder'
      pluginElement.appendChild(pluginElementTitle)
      pluginElement.className = 'effect-list-item effect-chain-item'
      const pluginElementName = document.createElement('p')
      pluginElementName.innerText = plugin.name
      pluginElement.appendChild(pluginElementName)

      pluginElement.addEventListener('click', () => {
        this.showPluginForTrack(plugin, track)
      })

      bodyElement.appendChild(pluginElement)
    }

    appendArrow()
    const addNewPluginElement = document.createElement('button')
    addNewPluginElement.innerText = 'Add New Effect'
    addNewPluginElement.style.fontWeight = 'bolder'
    addNewPluginElement.style.border = 'dashed'
    addNewPluginElement.className = 'effect-list-item effect-chain-item clickable'
    addNewPluginElement.addEventListener('click', async () => {
      await this.showAvailableEffectsList(track)
    })

    const addIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    addIcon.setAttribute('viewBox', '0 0 500 500')
    addIcon.setAttribute('aria-hidden', 'true')
    addIcon.style.width = '25%'
    const addUse = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    addUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#plus')
    addIcon.appendChild(addUse)
    addNewPluginElement.appendChild(addIcon)
    bodyElement.appendChild(addNewPluginElement)

    appendArrow()
    const pluginElement = document.createElement('div')
    pluginElement.innerText = 'Output'
    pluginElement.style.fontWeight = 'bolder'
    pluginElement.className = 'effect-list-item effect-chain-item'
    bodyElement.appendChild(pluginElement)
    this.bottomPanelController.open({
      title: 'Effects',
      subtitle: '',
      body: bodyElement,
      onClose: () => {}
    })
  }

  async showAvailableEffectsList(track: Track) {
    const bodyElement = document.createElement('div')
    bodyElement.classList = 'effect-list-body'
    this.bottomPanelController.setBody(bodyElement)
    
    const plugins = await this.wamPluginIndex.getCommunityPluginsList()
    for (const plugin of plugins) {
      const listItemElement = document.createElement('div')
      listItemElement.classList = 'effect-list-item'

      const addPluginButton = document.createElement('button')
      addPluginButton.classList = 'clickable'
      addPluginButton.innerText = 'Add to track'
      addPluginButton.addEventListener('click', () => {
        track.effectRegions.push(
          {
            id: plugin.identifier,
            state: undefined,
            automation: []
          }
        )
      })
      listItemElement.appendChild(addPluginButton)
      listItemElement.appendChild(this.getPluginDescriptionElement(plugin))
      bodyElement.appendChild(listItemElement)
    }
    this.bottomPanelController.open({
      title: 'Add Effect',
      subtitle: '',
      body: bodyElement,
      onClose: () => {}
    })
  }

  private getPluginDescriptionElement(plugin: Wam2PluginDescriptor) {
    const parentElement = document.createElement('div')

    const listItemLabelElement = document.createElement('p')
    listItemLabelElement.innerText = plugin.name
    listItemLabelElement.style.textAlign = 'center'
    parentElement.appendChild(listItemLabelElement)

    if (plugin.thumbnail) {
      const listItemThumbnailElement = document.createElement('img')

      listItemThumbnailElement.src = WamPluginIndex.COMMUNITY_WAM_URL + plugin.thumbnail
      listItemThumbnailElement.alt = plugin.description
      parentElement.appendChild(listItemThumbnailElement)
    }

    const listItemCategoryElement = document.createElement('p')
    listItemCategoryElement.innerText = plugin.category.join(', ')
    parentElement.appendChild(listItemCategoryElement)

    const listItemDescriptionElement = document.createElement('p')
    listItemDescriptionElement.innerText = plugin.description
    parentElement.appendChild(listItemDescriptionElement)

    return parentElement
  }
}

export function getPanelSubtitle(track: Track, sampleRate: number, startPosition: number, endPosition: number) {
  return `${track.name}: ` + 
    `${TimeUtils.positionToString(startPosition, sampleRate, false)}` +
    ` - ${TimeUtils.positionToString(endPosition, sampleRate, false)}`
}
