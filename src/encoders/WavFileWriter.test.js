import { WavFileWriter } from './WavFileWriter'
import { expect, onTestFinished, test } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'

// export type WavEncoderInfo = {
//   encoder: 'wav'
//   sampleRate: number
//   channelCount: number
//   sampleFormat: WavSampleFormat
//   sampleCount: number
// }

test('float32 test', async () => {
  const fileHandle = await createFileHandle('float32Test.wav')

  const encoderInfo = {
    encoder: 'wav',
    sampleRate: 48000,
    channelCount: 1,
    sampleFormat: 'float32',
    sampleCount: 10 * WavFileWriter.INPUT_BUFFER_SIZE,
  }

  const wavFileWriter = new WavFileWriter(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = wavFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    await wavFileWriter.writeChunk(inputBuffer.length)
  }
  await wavFileWriter.finish()
})

test('int24 test', async () => {
  const fileHandle = await createFileHandle('int24Test.wav')

  const encoderInfo = {
    encoder: 'wav',
    sampleRate: 48000,
    channelCount: 1,
    sampleFormat: 'int24',
    sampleCount: 10 * WavFileWriter.INPUT_BUFFER_SIZE,
  }

  const wavFileWriter = new WavFileWriter(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = wavFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    await wavFileWriter.writeChunk(inputBuffer.length)
  }
  await wavFileWriter.finish()
})

test('int16 test', async () => {
  const fileHandle = await createFileHandle('int16Test.wav')

  const encoderInfo = {
    encoder: 'wav',
    sampleRate: 48000,
    channelCount: 1,
    sampleFormat: 'int16',
    sampleCount: 10 * WavFileWriter.INPUT_BUFFER_SIZE,
  }

  const wavFileWriter = new WavFileWriter(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = wavFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    await wavFileWriter.writeChunk(inputBuffer.length)
  }
  await wavFileWriter.finish()
})

test('int8 test', async () => {
  const fileHandle = await createFileHandle('int8Test.wav')

  const encoderInfo = {
    encoder: 'wav',
    sampleRate: 48000,
    channelCount: 1,
    sampleFormat: 'int8',
    sampleCount: 10 * WavFileWriter.INPUT_BUFFER_SIZE,
  }

  const wavFileWriter = new WavFileWriter(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = wavFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    await wavFileWriter.writeChunk(inputBuffer.length)
  }
  await wavFileWriter.finish()
})

test('stereo test', async () => {
  const fileHandle = await createFileHandle('stereoTest.wav')

  const encoderInfo = {
    encoder: 'wav',
    sampleRate: 48000,
    channelCount: 2,
    sampleFormat: 'int8',
    sampleCount: 10 * WavFileWriter.INPUT_BUFFER_SIZE,
  }

  const wavFileWriter = new WavFileWriter(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = wavFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    for (let i = 0; i < inputBuffer.length / 2; ++i) {
      const angle1 = (440 * (i + (n * inputBuffer.length) / 2) * (Math.PI * 2)) / 48000
      inputBuffer[2 * i] = Math.sin(angle1) * 0.8
      const angle2 = (440 * (i + ((n + 1) * inputBuffer.length) / 2) * (Math.PI * 2)) / 48000
      inputBuffer[2 * i + 1] = Math.sin(angle2) * 0.8
    }
    await wavFileWriter.writeChunk(inputBuffer.length)
  }
  await wavFileWriter.finish()
})

async function createFileHandle(fileName) {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', fileName)).createSyncAccessHandle()
  onTestFinished(() => {
    fileHandle.close()
    return FileSystemUtils.deleteFile('.', fileName)
  })
  return fileHandle
}

function fillBuffer(inputBuffer, n) {
  for (let i = 0; i < inputBuffer.length; ++i) {
    const angle = (440 * (i + n * inputBuffer.length) * (Math.PI * 2)) / 48000
    inputBuffer[i] = Math.sin(angle) * 0.8
  }
}
