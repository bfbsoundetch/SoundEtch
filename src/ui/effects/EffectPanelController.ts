import { BottomPanelController } from '../../ui/BottomPanelController'
import { TimeUtils } from '../../global/TimeUtils'
import { Track } from '../../project/Track'
import { Wam2PluginDescriptor, WamPluginIndex } from '../../effects/WamPluginIndex'
import { WamManager } from 'effects/WamManager'

export class EffectPanelController {

  private static instance: EffectPanelController | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new EffectPanelController())
  }

  private readonly wamPluginIndex = new WamPluginIndex()
  private readonly bottomPanelController = BottomPanelController.getInstance()

  private constructor() {}

  async showTrackEffectsList(track: Track) {
    const bodyElement = document.createElement('div')
    bodyElement.classList = 'effect-list-body'

    const startElement = document.createElement('div')
    startElement.innerText = 'Track'
    startElement.classList = 'effect-list-item'
    bodyElement.appendChild(startElement)

    //<i class='bx bx-arrow-right'></i>
/*
          bx:shape="arrow 275 590 160 120 40 75 0 1@4ade829c"
*/
    const arrow = document.createElement('div')
    arrow.classList = 'bx bx-arrow-right effect-list-item'

    bodyElement.appendChild(arrow)

    for (const effectData of track.effectRegions) {
      console.error(JSON.stringify(effectData))
      const pluginData = this.wamPluginIndex.getPluginById(effectData.id)
      const pluginElement = this.getPluginDescriptionElement((await pluginData)!)
    }

    const endElement = document.createElement('div')
    endElement.innerText = 'Output'
    endElement.classList = 'effect-list-item'
    bodyElement.appendChild(endElement)
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
