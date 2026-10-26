import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { expect, test } from 'vitest'
import { getPlayableFragmentedMp4Length } from './FragmentedMp4'

/** A 10 s fragmented MP4 of five 2 s fragments, with where each moof and mdat ends as reported by the muxer. */
async function createRecording() {
  const moofEnd = new Array<number>()
  const mdatEnd = new Array<number>()
  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({
      fastStart: 'fragmented',
      onMoof: (data, position) => moofEnd.push(position + data.byteLength),
      onMdat: (data, position) => mdatEnd.push(position + data.byteLength),
    }),
    target,
  })
  const source = new EncodedVideoPacketSource('vp9')
  output.addVideoTrack(source)
  await output.start()
  for (let i = 0; i < 300; i++) {
    const packet = new EncodedPacket(new Uint8Array(500), i % 60 == 0 ? 'key' : 'delta', i / 30, 1 / 30)
    await source.add(
      packet,
      i == 0 ? { decoderConfig: { codec: 'vp09.00.10.08', codedWidth: 64, codedHeight: 48 } } : undefined,
    )
  }
  await output.finalize()
  return { bytes: new Uint8Array(target.buffer!), moofEnd, mdatEnd }
}

const recording = await createRecording()

function getPlayableLength(size: number) {
  return getPlayableFragmentedMp4Length(size, (position, length) =>
    recording.bytes.subarray(position, Math.min(size, position + length)),
  )
}

test('a finished recording is playable through its closing mfra', () => {
  expect(getPlayableLength(recording.bytes.length)).toBe(recording.bytes.length)
})

test('a recording cut inside an mdat keeps the fragments before it, which read consistently', async () => {
  const length = getPlayableLength(recording.mdatEnd[2] - 100)
  expect(length).toBe(recording.mdatEnd[1])

  const input = new Input({ source: new BufferSource(recording.bytes.slice(0, length)), formats: ALL_FORMATS })
  try {
    const track = (await input.getVideoTracks())[0]
    expect(await track.computeDuration()).toBe(4)
    const sink = new EncodedPacketSink(track)
    let packets = 0
    for await (const unusedPacket of sink.packets()) packets++
    expect(packets).toBe(120)
    expect(await sink.getPacket(3.9)).not.toBeNull()
  } finally {
    input.dispose()
  }
})

test('a recording cut right after a moof drops that fragment', () => {
  expect(getPlayableLength(recording.moofEnd[2])).toBe(recording.mdatEnd[1])
})

test.each([
  ['inside the first mdat', () => recording.mdatEnd[0] - 1],
  ['inside the ftyp', () => 20],
])('a recording cut %s has nothing playable', (_, size) => {
  expect(getPlayableLength(size())).toBe(0)
})
