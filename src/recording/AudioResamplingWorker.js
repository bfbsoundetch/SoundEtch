import SoxrResampler from 'wasm-audio-resampler/app/soxr_resampler.js'
import { SoxrDatatype, SoxrQuality } from 'wasm-audio-resampler/app/utils.js'
const soxrWasmUrl = new URL(`${import.meta.env.BASE_URL}/soxr_wasm.wasm`, globalThis.location.origin).href

self.onmessage = async (e) => {
  if (self.failed) return
  console.debug('Resampler got message ' + e.data.type)

  try {
    switch (e.data.type) {
      case 'init': {
        const input = e.data.input
        self.resampler = new SoxrResampler(
          input.channelCount,
          input.sourceSampleRate,
          input.targetSampleRate,
          SoxrDatatype.SOXR_FLOAT32,
          SoxrDatatype.SOXR_FLOAT32,
          SoxrQuality.SOXR_MQ,
        )
        const wasmResponse = await fetch(soxrWasmUrl)
        if (!wasmResponse.ok) {
          throw new Error(`Failed to load the audio resampler: ${wasmResponse.status}`)
        }
        await self.resampler.init(undefined, {
          wasmBinary: await wasmResponse.arrayBuffer(),
        })
        postMessage({ type: 'ready' })
        break
      }
      case 'audio': {
        const audio = self.resampler ? self.resampler.processChunk(new Uint8Array(e.data.audio)).buffer : e.data.audio
        postMessage({ type: 'audio', audio }, [audio])
        break
      }
      case 'stop': {
        if (self.resampler) {
          const audio = self.resampler.processChunk(null).buffer
          if (audio.byteLength > 0) {
            postMessage({ type: 'audio', audio }, [audio])
          }
        }
        postMessage({ type: 'finish' })
        break
      }
    }
  } catch (error) {
    self.failed = true
    postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

self.onerror = (e) => {
  console.error(e)
}

self.onmessageerror = (e) => {
  console.error(e)
}
