declare global {
  function getOrCreateAudioContext(): Promise<AudioContext>
  function createNewAudioContext(): Promise<AudioContext>
  function closeAndRemoveAudioContext(): any

  var audioContext: AudioContext | null
}

export async function getOrCreateAudioContext(): Promise<AudioContext> {
  if (globalThis.audioContext) {
    return globalThis.audioContext!
  }
  return createNewAudioContext()
}

export async function createNewAudioContext(): Promise<AudioContext> {
  await closeAndRemoveAudioContext()
  globalThis.audioContext = new AudioContext({ sampleRate: 48000 })
  await globalThis.audioContext.suspend()
  return globalThis.audioContext!
}

export async function closeAndRemoveAudioContext() {
  if (globalThis.audioContext) {
    await globalThis.audioContext!.close()
    globalThis.audioContext = null
  }
}

globalThis.getOrCreateAudioContext = getOrCreateAudioContext
globalThis.createNewAudioContext = createNewAudioContext
globalThis.closeAndRemoveAudioContext = closeAndRemoveAudioContext
