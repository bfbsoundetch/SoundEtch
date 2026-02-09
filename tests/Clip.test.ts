import { Clip } from '../src/project/Clip'

test('createClip_getChannelCountMatchesConstructorArg', async () => {
  const clip = new Clip('test', 1)

  expect(clip.getChannelCount()).toBe(1)
})

test('addData_lengthMatches', async () => {
  const clip = new Clip('test', 1)

  clip.addData([new Float32Array(new SharedArrayBuffer(4 * 7))])

  expect(clip.getLength()).toBe(7)
})

test('addData_inconsistentLength_throwsError', async () => {
  const clip = new Clip('test', 2)

  expect(() => {
    clip.addData([new Float32Array(new SharedArrayBuffer(4 * 7)), new Float32Array(new SharedArrayBuffer(4 * 8))])
  }).toThrow('Channels of input data had inconsistent length. Channel 0: 7; Channel 1: 8')
})

test('addData_wrongNumberOfChannels_throwsError', async () => {
  const clip = new Clip('test', 2)

  expect(() => {
    clip.addData([new Float32Array(new SharedArrayBuffer(4 * 7))])
  }).toThrow('Input data had 1 channels, but this clip has 2')
})

test('temporary_buffer_creation_perf_test', async () => {
  const data: any[] = []
  for (let i = 0; i < 10; ++i) {
    console.log(i)
    console.log(new Date())
    data.push(new SharedArrayBuffer(256 * 1024))
    console.log(new Date())
    data.push(new Float32Array(new SharedArrayBuffer(256 * 1024)))
    console.log(new Date())
    data.push(new Float32Array(new SharedArrayBuffer(32 * 1024)))
    console.log(new Date())
  }
})
