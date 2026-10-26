import { EnhancedAudioContext } from './EnhancedAudioContext'

export enum AudioState {
  PLAYING = 'playing',
  RECORDING = 'recording',
  MONITORING = 'monitoring',
  PLAYING_PAUSED = 'playingPaused',
  RECORDING_PAUSED = 'recordingPaused',
  MONITORING_PAUSED = 'monitoringPaused',
  STOPPED = 'stopped',
}

export type ActiveAudioState = AudioState.PLAYING | AudioState.RECORDING | AudioState.MONITORING

export type AudioControlListener = (_: AudioState) => any

export function isPausedState(state: AudioState) {
  return state == AudioState.PLAYING_PAUSED || state == AudioState.RECORDING_PAUSED
}

export function isRecordingState(state: AudioState) {
  return state == AudioState.RECORDING || state == AudioState.RECORDING_PAUSED
}

export function isActiveTimelineState(state: AudioState) {
  return state == AudioState.PLAYING || state == AudioState.RECORDING
}

export function isStoppedOrMonitoring() {}

export class AudioControl {
  static audioControlListeners = new Array<AudioControlListener>()
  static audioContext: EnhancedAudioContext | null = null
  static startPosition = 0
  private static contextOperationQueue: Promise<unknown> = Promise.resolve()
  private static contextListener = (_: any) => {
    const state = this.getState()
    this.audioControlListeners.forEach((l) => l(state))
  }

  static addAudioControlListener(listener: AudioControlListener) {
    this.audioControlListeners.push(listener)
    listener(AudioControl.getState())
  }

  static async pause() {
    await AudioControl.audioContext?.suspend()
  }

  static async unpause() {
    await AudioControl.audioContext?.resume()
  }

  static async stop() {
    await AudioControl.closeAndRemoveAudioContext()
  }

  static getState(): AudioState {
    if (!AudioControl.audioContext) {
      return AudioState.STOPPED
    }
    switch (AudioControl.audioContext.state) {
      case 'closed':
        return AudioState.STOPPED
      case 'running':
        return AudioControl.audioContext.mode
      case 'suspended':
      case 'interrupted':
        switch (AudioControl.audioContext.mode) {
          case AudioState.PLAYING:
            return AudioState.PLAYING_PAUSED
          case AudioState.RECORDING:
            return AudioState.RECORDING_PAUSED
          case AudioState.MONITORING:
            return AudioState.MONITORING_PAUSED
        }
    }
  }

  static isTimelineActive() {
    return isActiveTimelineState(AudioControl.getState())
  }

  static isPlaying() {
    return AudioControl.getState() == AudioState.PLAYING || AudioControl.getState() == AudioState.PLAYING_PAUSED
  }

  static isPaused() {
    return isPausedState(AudioControl.getState())
  }

  static async getOrCreateAudioContext(mode: ActiveAudioState | null = null): Promise<EnhancedAudioContext> {
    return AudioControl.runContextOperation(async () => {
      if (
        AudioControl.audioContext &&
        (!mode || mode == AudioControl.audioContext.mode) &&
        AudioControl.audioContext.state != 'closed'
      ) {
        return AudioControl.audioContext
      }
      return AudioControl.replaceAudioContext(mode ?? AudioState.MONITORING)
    })
  }

  /** Starts input monitoring without replacing a recording or playback context, even when it is paused. */
  static async startMonitoring(): Promise<EnhancedAudioContext | null> {
    return AudioControl.runContextOperation(async () => {
      let context = AudioControl.audioContext
      if (context && context.state != 'closed' && context.mode != AudioState.MONITORING) {
        return null
      }
      if (!context || context.state == 'closed') {
        context = await AudioControl.replaceAudioContext(AudioState.MONITORING)
      }
      // Firefox rejects a pending resume if the context closes. Finish it before a queued replacement or stop.
      if (context.state != 'running') {
        await context.resume()
      }
      return context
    })
  }

  static async createNewAudioContext(
    mode: ActiveAudioState,
    position = AudioControl.startPosition,
    loopEnd: number = 0,
  ): Promise<EnhancedAudioContext> {
    return AudioControl.runContextOperation(() => AudioControl.replaceAudioContext(mode, position, loopEnd))
  }

  static async closeAndRemoveAudioContext() {
    await AudioControl.runContextOperation(() => AudioControl.closeCurrentAudioContext())
  }

  private static async closeCurrentAudioContext() {
    const audioContext = AudioControl.audioContext
    AudioControl.audioContext = null
    if (audioContext && audioContext.state != 'closed') {
      await audioContext.close()
    }
  }

  private static async replaceAudioContext(
    mode: ActiveAudioState,
    position = AudioControl.startPosition,
    loopEnd: number = 0,
  ) {
    AudioControl.audioContext?.removeEventListener('statechange', this.contextListener)
    await AudioControl.closeCurrentAudioContext()
    const audioContext = await EnhancedAudioContext.create(mode, position, loopEnd)
    await audioContext.suspend()
    audioContext.addEventListener('statechange', this.contextListener)
    AudioControl.audioContext = audioContext
    return audioContext
  }

  private static runContextOperation<T>(operation: () => Promise<T>) {
    const result = AudioControl.contextOperationQueue.then(operation)
    AudioControl.contextOperationQueue = result
    return result
  }
}
