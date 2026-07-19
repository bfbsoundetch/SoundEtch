import { initializeWamHost, WebAudioModule } from '@webaudiomodules/sdk'

export class WamManager {

    private static instance: WamManager | null = null

    static getInstance() {
        return this.instance ?? (this.instance = new WamManager())
    }

    private constructor() {}
    
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
        const result = await WAM.createInstance(await this.getHostGroupId(audioContext), audioContext)
        console.error('state: ', await result._audioNode.getState())
        result._audioNode.addEventListener('wam-info', (e) => console.error('i', JSON.stringify(e)))
        result._audioNode.addEventListener('wam-automation', (e) => console.error('a', JSON.stringify(e)))
        result._audioNode.addEventListener('wam-sysex', (e) => console.error('s', JSON.stringify(e)))
        result._audioNode.addEventListener('wam-transport', (e) => console.error('t', JSON.stringify(e)))
        result._audioNode.addEventListener('wam-mpe', (e) => console.error('m', JSON.stringify(e)))
        result._audioNode.addEventListener('wam-osc', (e) => console.error('o', JSON.stringify(e)))


        return result
    }
}