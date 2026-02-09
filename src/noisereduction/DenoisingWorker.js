import { RingBuffer, AudioReader, AudioWriter } from 'ringbuf.js'
// import * as wasm from "./wasm/df_bg.wasm";
import * as wasm_bindgen from './wasm/df_bg.js'

let frame_length
let df_model
let audio_reader
let audio_writer
let inputPointer
let outputPointer
let input
let output

function readFromQueue() {
  try {
    if (audio_reader.available_read() < frame_length) {
      return 0
    }
    const samples_read = audio_reader.dequeue(input)

    wasm_bindgen.df_process_frame2(df_model, inputPointer, outputPointer)

    if (audio_writer.enqueue(output) !== frame_length) {
      console.log("worker underrun: the audioworklet doesn't dequeue fast enough!")
    }
    return samples_read
  } catch (e) {
    console.error(e)
    clearInterval(self.interval)
    return 0
  }
}

async function handleMessage(e) {
  console.log('handling: ' + e.data.type)
  switch (e.data.type) {
    case 'init': {
      const bytes = await Promise.all([
        getCachedOrFetch('../noisereduction/df_bg.wasm'),
        getCachedOrFetch('../noisereduction/DeepFilterNet3_onnx.tar.gz'),
      ])
      const wasm = (await WebAssembly.instantiate(bytes[0], { './df_bg.js': wasm_bindgen })).instance.exports

      wasm_bindgen.__wbg_set_wasm(wasm) // from df.js
      const uint8Array = new Uint8Array(bytes[1])
      console.error(uint8Array.length)
      df_model = wasm_bindgen.df_create(uint8Array, 100.0)

      frame_length = wasm_bindgen.df_get_frame_length(df_model)

      inputPointer = wasm_bindgen.df_create_frame_buffer(frame_length)
      outputPointer = wasm_bindgen.df_create_frame_buffer(frame_length)

      input = new Float32Array(wasm.memory.buffer).subarray(
        inputPointer / Float32Array.BYTES_PER_ELEMENT,
        inputPointer / Float32Array.BYTES_PER_ELEMENT + frame_length,
      )
      output = new Float32Array(wasm.memory.buffer).subarray(
        outputPointer / Float32Array.BYTES_PER_ELEMENT,
        outputPointer / Float32Array.BYTES_PER_ELEMENT + frame_length,
      )
      postMessage({ type: 'initialized' })
      break
    }
    case 'start': {
      audio_reader = new AudioReader(new RingBuffer(e.data.rawSab, Float32Array))

      audio_writer = new AudioWriter(new RingBuffer(e.data.denoisedSab, Float32Array))
      self.interval = setInterval(readFromQueue, 0)
      postMessage({ type: 'started' })
      break
    }
    case 'stop': {
      clearInterval(self.interval)
      break
    }
    case 'resume': {
      interval = setInterval(readFromQueue, 0)
      break
    }
  }
}

onmessage = async (e) => {
  try {
    await handleMessage(e)
  } catch (error) {
    console.error(error)
    postMessage({ type: 'error', during: e.data.type, error: error })
    close()
  }
}

async function getCachedOrFetch(url) {
  const cache = await caches.open('soundetch-cache')
  const cached = await cache.match(url)
  if (cached) {
    return cached.arrayBuffer()
  }
  const fetchResponse = await fetch(url)
  await cache.put(url, fetchResponse.clone())
  return fetchResponse.arrayBuffer()
}
