import { initializeWamHost, WebAudioModule } from '@webaudiomodules/sdk'

export class WamManager {
  private static instance: WamManager | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new WamManager())
  }

  private constructor() {}

  private readonly hostGroupIds = new WeakMap<AudioContext, Promise<string>>()

  private async getHostGroupId(audioContext: AudioContext) {
    let hostGroupId = this.hostGroupIds.get(audioContext)
    if (!hostGroupId) {
      const startTime = Date.now()
      hostGroupId = initializeWamHost(audioContext)
        .then(([groupId]) => {
          console.debug('Loaded WAM in ', Date.now() - startTime)
          return groupId
        })
        .catch((error) => {
          this.hostGroupIds.delete(audioContext)
          throw error
        })
      this.hostGroupIds.set(audioContext, hostGroupId)
    }
    return hostGroupId
  }

  async loadPlugin(pluginPath: string, audioContext: AudioContext, initialState?: unknown) {
    const { default: WAM } = (await import(pluginPath)) as { default: typeof WebAudioModule }
    const result = await WAM.createInstance(await this.getHostGroupId(audioContext), audioContext, initialState)
    // Some WAM SDK implementations ignore createInstance's initial state.
    if (initialState !== undefined) {
      await result.audioNode.setState(initialState)
    }
    return result
  }
}
