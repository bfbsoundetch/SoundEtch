import { SampleRateConverter } from '../rendering/SampleRateConverter'

export type TranscribedRange = {
  text: string
  startSample: number
  endSample: number
}

type TranscriptionResult = {
  text: string
  chunks: Array<{
    text: string
    timestamp: [number, number]
  }>
}

export class Transcriber {
  private static worker: Worker | null = null

  private activeTranscription: PromiseWithResolvers<TranscriptionResult> | null = null

  constructor(private readonly inputSampleRate: number) {}

  private transcriptions: Array<TranscriptionResult> = []

  // private async getWorker() {
  //   if (!Transcriber.worker) {
  //     Transcriber.worker = new Worker(new URL('./TranscriptionWorker.js', import.meta.url))
  //     Transcriber.worker.postMessage({ type: 'load', data: (await hasWebGPU()) ? 'webgpu' : 'wasm' })
  //   }
  //   Transcriber.worker.onmessage = (e) => {
  //     switch (e.data.status) {
  //       case 'loading':
  //         break
  //       case 'ready':
  //         console.log('Transcriber ready.')
  //         break
  //       case 'complete':
  //         this.activeTranscription!.resolve(e.data.result)
  //         break
  //       case 'error':
  //         this.activeTranscription!.reject(e)
  //         break
  //     }
  //   }
  //   return Transcriber.worker
  // }

  // async transcribe(audioChunk: Float32Array) {
  //   const audioTime = audioChunk.length / this.inputSampleRate

  //   const worker = await this.getWorker()

  //   const audio16k =
  //     this.inputSampleRate == 16_000
  //       ? audioChunk
  //       : (await SampleRateConverter.convert(audioChunk, this.inputSampleRate, 16_000)).getChannelData(1)

  //   try {
  //     await this.activeTranscription?.promise
  //   } catch (e) {}

  //   this.activeTranscription = Promise.withResolvers()

  //   worker.postMessage({ type: 'run', data: audio16k })

  //   const result = await this.activeTranscription.promise
  //   this.activeTranscription = null
  //   console.error(JSON.stringify(result))
  // }
}
