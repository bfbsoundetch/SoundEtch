export class AudioWorkletProcessor {
  constructor() {
    this.port = {
      postMessage: (message) => {
        console.log(message)
        if (!!this.onmessage) {
          this.onmessage(message)
        }
      },
    }
  }
}
export function registerProcessor(a, b) {}

global.AudioWorkletProcessor = AudioWorkletProcessor
global.registerProcessor = registerProcessor
global.sampleRate = 48000
global.currentFrame = 0
