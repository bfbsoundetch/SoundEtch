import { BottomPanelController } from '../../ui/BottomPanelController'
import { TimeUtils } from '../../global/TimeUtils'
import { Track } from '../../project/Track'
import { WamPluginIndex } from '../../effects/WamPluginIndex'

export class EffectPanelController {

  private static instance: EffectPanelController | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new EffectPanelController())
  }

  private readonly wamPluginIndex = new WamPluginIndex()
  private readonly bottomPanelController = BottomPanelController.getInstance()

  private constructor() {}

  async showEffectsList() {
    const bodyElement = document.createElement('div')
    bodyElement.classList = 'effect-list-body'
    this.bottomPanelController.setBody(bodyElement)
    
    const plugins = await this.wamPluginIndex.getCommunityPluginsList()
    for (const plugin of plugins) {
      console.error(plugin.name)
      const listItemElement = document.createElement('div')
      listItemElement.classList = 'effect-list-item'
      const listItemLabelElement = document.createElement('title')
      listItemLabelElement.innerText = plugin.name
      if (plugin.thumbnail) {
        const listItemThumbnailElement = document.createElement('img')
        
        listItemThumbnailElement.src = WamPluginIndex.COMMUNITY_WAM_URL + plugin.thumbnail
        listItemThumbnailElement.alt = plugin.description
        listItemElement.appendChild(listItemThumbnailElement)
      }
      listItemElement.appendChild(listItemLabelElement)
      bodyElement.appendChild(listItemElement)
    }
    this.bottomPanelController.open({
      title: 'Effects',
      subtitle: '',
      body: bodyElement,
      onClose: () => {}
    })
  }

}

export function getPanelSubtitle(track: Track, sampleRate: number, startPosition: number, endPosition: number) {
  return `${track.name}: ` + 
    `${TimeUtils.positionToString(startPosition, sampleRate, false)}` +
    ` - ${TimeUtils.positionToString(endPosition, sampleRate, false)}`
}
