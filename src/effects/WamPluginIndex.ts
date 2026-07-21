export interface Wam2PluginDescriptor {
  identifier: string
  name: string
  vendor: string
  website?: string
  description: string
  keywords: string[]
  category: string[]
  thumbnail?: string
  thumbnailDimensions?: {
    width: number
    height: number
  }
  path: string // path to index.js on webaudiomodules.com
}

export class WamPluginIndex {
  static COMMUNITY_WAM_URL = 'https://www.webaudiomodules.com/community/plugins/'

  private communityPluginMap = new Map<string, Wam2PluginDescriptor>()
  private communityPluginMapInitialization: Promise<void> | null = null

  async getCommunityPluginsList() {
    await this.initCommunityPluginMap()
    return [...this.communityPluginMap.values()]
  }

  async getPluginById(id: string) {
    await this.initCommunityPluginMap()
    return this.communityPluginMap.get(id)
  }

  private async initCommunityPluginMap() {
    if (this.communityPluginMap.size > 0) {
      return
    }
    if (!this.communityPluginMapInitialization) {
      this.communityPluginMapInitialization = this.loadCommunityPluginMap().catch((error) => {
        this.communityPluginMapInitialization = null
        throw error
      })
    }
    await this.communityPluginMapInitialization
  }

  private async loadCommunityPluginMap() {
    const response = await fetch(new URL('./plugins.json', import.meta.url))
    const pluginList: Array<Wam2PluginDescriptor> = await response.json()
    for (const plugin of pluginList) {
      plugin.path = WamPluginIndex.COMMUNITY_WAM_URL + plugin.path
      this.communityPluginMap.set(plugin.identifier, plugin)
    }
  }
}
