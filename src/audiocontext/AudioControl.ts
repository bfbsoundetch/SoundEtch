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

export class AudioControl {
  static audioControlListeners = new Array<AudioControlListener>()
  static audioContext: EnhancedAudioContext | null = null
  static startPosition = 0
  static contextListener = (_: any) => {
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

  static isPaused() {
    return isPausedState(AudioControl.getState())
  }

  static async getOrCreateAudioContext(mode: ActiveAudioState | null = null): Promise<EnhancedAudioContext> {
    if (
      AudioControl.audioContext &&
      (!mode || mode == AudioControl.audioContext.mode) &&
      AudioControl.audioContext.state != 'closed'
    ) {
      return AudioControl.audioContext!
    }
    return AudioControl.createNewAudioContext(mode ?? AudioState.MONITORING)
  }

  static async createNewAudioContext(
    mode: ActiveAudioState,
    position = AudioControl.startPosition,
    loopEnd: number = 0,
  ): Promise<EnhancedAudioContext> {
    AudioControl.audioContext?.removeEventListener('statechange', this.contextListener)
    await AudioControl.closeAndRemoveAudioContext()
    AudioControl.audioContext = await EnhancedAudioContext.create(mode, position, loopEnd)
    await AudioControl.audioContext.suspend()
    AudioControl.audioContext.addEventListener('statechange', this.contextListener)
    return AudioControl.audioContext!
  }

  static async closeAndRemoveAudioContext() {
    if (AudioControl.audioContext && AudioControl.audioContext.state != 'closed') {
      await AudioControl.audioContext!.close()
    }
    AudioControl.audioContext = null
  }
}
