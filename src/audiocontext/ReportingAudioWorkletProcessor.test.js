import { beforeAll, expect, test } from 'vitest'

let Reporter

beforeAll(async () => {
  // These globals exist only in the audio rendering thread; the processor module registers itself on load.
  globalThis.AudioWorkletProcessor = class {}
  globalThis.registerProcessor = (_, processor) => (Reporter = processor)
  await import('./ReportingAudioWorkletProcessor.js')
})

function advance(startPosition, loopEnd, quanta) {
  const position = new Uint32Array([startPosition])
  const reporter = new Reporter({ processorOptions: { position, loopEnd } })
  for (let i = 0; i < quanta; i++) reporter.process([[]], [[new Float32Array(128)]])
  return position[0]
}

test('without a loop the position keeps counting from a nonzero start', () => {
  // Recording from 6.5 s used to wrap back to 6.5 s every 6.5 s.
  expect(advance(312_000, 0, 5_000)).toBe(312_000 + 5_000 * 128)
})

test('a loop wraps the position back to its start', () => {
  expect(advance(1_000, 1_000 + 128 * 10, 13)).toBe(1_000 + 3 * 128)
})

test('an end at or before the start is not a loop', () => {
  expect(() => advance(5_000, 4_000, 20)).toThrow('Loop end 4000 is earlier than the start 5000')
})
