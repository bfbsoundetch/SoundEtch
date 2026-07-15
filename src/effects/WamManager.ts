import { initializeWamHost, WebAudioModule } from '@webaudiomodules/sdk'

export class WamManager {
    
    private static COMMUNITY_WAM_URL = 'https://www.webaudiomodules.com/community/plugins/'
    private hostGroupId: string | null = null

    private async getHostGroupId(audioContext: AudioContext) {
        if (!this.hostGroupId) {
            const startTime = Date.now()
            this.hostGroupId = (await initializeWamHost(audioContext))[0]
            console.debug('Loaded WAM in ', Date.now() - startTime)
        }
        return this.hostGroupId
    }

    async loadPlugin(pluginPath: string, audioContext: AudioContext) {
        const { default: WAM } = await import(WamManager.COMMUNITY_WAM_URL + pluginPath) as { default: typeof WebAudioModule}
        return WAM.createInstance(await this.getHostGroupId(audioContext), audioContext)
    }
}