import SoxrResampler from 'wasm-audio-resampler/app/soxr_resampler.js'
import { SoxrDatatype, SoxrQuality } from 'wasm-audio-resampler/app/utils.js'
import soxrWasmUrl from 'wasm-audio-resampler/app/soxr_wasm.wasm?url'

self.onmessage = async (e) => {
  console.debug('Resampler got message ' + e.data.type)

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
      await self.resampler.init(undefined, {
        locateFile: () => soxrWasmUrl,
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
}

self.onerror = (e) => {
  console.error(e)
}

self.onmessageerror = (e) => {
  console.error(e)
}
