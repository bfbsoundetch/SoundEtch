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
        const pluginList: Array<Wam2PluginDescriptor> = await (await fetch(new URL('./plugins.json', import.meta.url))).json()
        for (const plugin of pluginList) {
            plugin.path = WamPluginIndex.COMMUNITY_WAM_URL + plugin.path
            this.communityPluginMap.set(plugin.identifier, plugin)
        }
    }

}