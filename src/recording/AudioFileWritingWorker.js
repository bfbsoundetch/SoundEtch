import { BatchAudioFileWriter } from './BatchAudioFileWriter.ts'
import { Summary } from '../project/Summary.ts'

self.onmessage = async (e) => {
  console.debug('Writer got message ' + e.data.type)

  switch (e.data.type) {
    case 'batch':
      const summary = new Summary(e.data.summary.channelCount)
      Object.keys(e.data.summary).forEach((key) => {
        summary[key] = e.data.summary[key]
      })
      await BatchAudioFileWriter.writeAudioArray(e.data.dirname, e.data.filename, e.data.audioArray, summary)
      postMessage({ type: 'finished', length: summary.length })
      break
  }
}

self.onerror = (e) => {
  console.error(e)
}

self.onmessageerror = (e) => {
  console.error(e)
}
