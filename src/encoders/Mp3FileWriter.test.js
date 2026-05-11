import { Mp3FileWriter } from './Mp3FileWriter'
import { expect, test } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
// export type Mp3EncoderInfo = {
//   encoder: 'mp3'
//   sampleRate: number
//   channelCount: number
//   bitrate: number | undefined
//   vbrQuality: number | undefined
// }

test('vbr test', async () => {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'vbrTest.mp3')).createSyncAccessHandle()

  const encoderInfo = {
    encoder: 'mp3',
    sampleRate: 44100,
    channelCount: 1,
    vbrQuality: 9,
  }

  const mp3FileWriter = await Mp3FileWriter.create(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = mp3FileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    await mp3FileWriter.writeChunk(inputBuffer.length)
  }
  await mp3FileWriter.finish()
})

test('cbr test', async () => {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'cbrTest.mp3')).createSyncAccessHandle()
  const encoderInfo = {
    encoder: 'mp3',
    sampleRate: 44100,
    channelCount: 1,
    bitrate: 64000,
  }

  const mp3FileWriter = await Mp3FileWriter.create(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = mp3FileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    await mp3FileWriter.writeChunk(inputBuffer.length)
  }
  await mp3FileWriter.finish()
})

test('stereo test', async () => {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'stereoTest.mp3')).createSyncAccessHandle()

  const encoderInfo = {
    encoder: 'mp3',
    sampleRate: 44100,
    channelCount: 2,
    vbrQuality: 9,
  }

  const mp3FileWriter = await Mp3FileWriter.create(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = mp3FileWriter.getInputBuffer()
  const leftBuffer = inputBuffer.subarray(0, inputBuffer.length / 2)
  const rightBuffer = inputBuffer.subarray(inputBuffer.length / 2)
  for (let n = 0; n < 10; ++n) {
    fillBuffer(leftBuffer, n)
    fillBuffer(rightBuffer, n + 1)
    await mp3FileWriter.writeChunk(leftBuffer.length)
  }
  await mp3FileWriter.finish()
})

function fillBuffer(inputBuffer, n) {
  for (let i = 0; i < inputBuffer.length; ++i) {
    const angle = (440 * (i + n * inputBuffer.length) * (Math.PI * 2)) / 48000
    inputBuffer[i] = Math.sin(angle) * 0.8
  }
}
