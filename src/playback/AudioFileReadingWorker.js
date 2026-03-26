import { AudioFileReader } from './AudioFileReader.ts'

self.audioFileReaders = []

self.onmessage = async (e) => {
  //TODO: reading from the same clip won't work with this scheme. You need to reuse the files
  console.debug(`File reading worker got message ${JSON.stringify(e.data)}`)
  if (e.data.type == 'pause') {
    self.audioFileReaders.forEach((reader) => reader.pause())
    return
  }
  if (e.data.type == 'resume') {
    self.audioFileReaders.forEach((reader) => reader.resume())
    return
  }
  if (e.data.type == 'stop') {
    self.audioFileReaders.forEach((reader) => reader.stop())
    self.audioFileReaders = []
    return
  }
  if (e.data.type != 'start') {
    throw Error('Unrecognized message: ' + JSON.stringify(e.data))
  }
  self.audioFileReaders.forEach((reader) => reader.stop())
  self.audioFileReaders = e.data.playbackInfos.map(
    (playbackInfo) =>
      new AudioFileReader(
        e.data.projectName,
        e.data.position,
        playbackInfo.clipViews,
        e.data.sampleRate,
        playbackInfo.ringBufferArray,
      ),
  )
  const completionPromise = Promise.all(self.audioFileReaders.map((r) => r.runBufferFillingLoop()))
  const readyPromise = Promise.all(self.audioFileReaders.map((r) => r.readyPromise))
  await readyPromise
  postMessage({ state: 'reading' })
  await completionPromise
}
