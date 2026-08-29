import { RingBuffer, AudioReader, AudioWriter } from 'ringbuf.js'
import { DeepFilter } from './DeepFilter'

let frame_length
let deep_filter
let audio_reader
let audio_writer

function readFromQueue() {
  try {
    if (audio_reader.available_read() < frame_length) {
      return 0
    }
    const samples_read = audio_reader.dequeue(deep_filter.getInputBuffer())

    deep_filter.process()

    if (audio_writer.enqueue(deep_filter.getOutputBuffer()) !== frame_length) {
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
  console.log('denoiser handling: ' + e.data.type)
  switch (e.data.type) {
    case 'init': {
      deep_filter = await DeepFilter.create(e.data.parameters)
      frame_length = deep_filter.frameLength

      self.interval = setInterval(() => {}, 0)
      postMessage({ type: 'initialized' })
      break
    }
    case 'start': {
      clearInterval(self.interval)
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
    case 'configure': {
      deep_filter.setParameters(e.data.parameters)
      break
    }
    case 'resume': {
      clearInterval(self.interval)
      audio_reader = new AudioReader(new RingBuffer(e.data.rawSab, Float32Array))
      audio_writer = new AudioWriter(new RingBuffer(e.data.denoisedSab, Float32Array))
      self.interval = setInterval(readFromQueue, 0)
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
