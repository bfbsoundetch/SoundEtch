import { initializeWamHost, WebAudioModule } from '@webaudiomodules/sdk'
import { WamPluginIndex } from './WamPluginIndex'

export class WamManager {
    
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
        const { default: WAM } = await import(pluginPath) as { default: typeof WebAudioModule}
        return WAM.createInstance(await this.getHostGroupId(audioContext), audioContext)
    }
}