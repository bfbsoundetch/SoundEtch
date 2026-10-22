import { expect, test } from 'vitest'
import { VideoFrameClock } from './VideoFrameClock'

const FRAME = 1 / 30

test('main-thread jank delays arrival but not the frame placement', () => {
  const clock = new VideoFrameClock()
  const jank = [0, 0.004, 0.09, 0, 0.05, 0.002, 0.13, 0]
  const placed = jank.map((delay, n) => clock.map(500 + n * FRAME, n * FRAME + 0.005 + delay))
  for (let n = 0; n < placed.length; n++) expect(placed[n]).toBeCloseTo(n * FRAME + 0.005, 9)
})

test('a pause stops the timeline but not the capture clock; recording resumes without a gap', () => {
  const clock = new VideoFrameClock()
  for (let n = 0; n < 30; n++) clock.map(10 + n * FRAME, n * FRAME + 0.003)
  // Frames during the two-second pause are dropped before placement; the timeline stood still at one second.
  const resumed = clock.map(10 + 3, 1 + 0.003)
  expect(resumed).toBeCloseTo(1.003, 9)
  expect(clock.map(10 + 3 + FRAME, 1 + FRAME + 0.003)).toBeCloseTo(1 + FRAME + 0.003, 9)
})

test('a capture clock that jumps back re-anchors to arrival, then keeps the new capture spacing', () => {
  const clock = new VideoFrameClock()
  for (let n = 0; n < 10; n++) clock.map(100 + n * FRAME, n * FRAME + 0.01)
  expect(clock.map(5, 10 * FRAME + 0.01)).toBeCloseTo(10 * FRAME + 0.01, 9)
  expect(clock.map(5 + FRAME, 11 * FRAME + 0.01 + 0.06)).toBeCloseTo(11 * FRAME + 0.01, 9)
})

test('a stalled capture clock that resumes late re-anchors instead of placing frames a window early', () => {
  const clock = new VideoFrameClock()
  for (let n = 0; n < 10; n++) clock.map(20 + n * FRAME, n * FRAME + 0.01)
  // Ten seconds of arrival pass while capture timestamps advance one frame.
  expect(clock.map(20 + 10 * FRAME, 10 + 0.01)).toBeCloseTo(10.01, 9)
})

test('drift between the capture and audio clocks is followed within the trusted window', () => {
  const clock = new VideoFrameClock()
  let worst = 0
  // A 100 ppm faster audio clock moves frames 0.36 s per hour relative to their capture timestamps.
  for (let n = 0; n < 30 * 600; n++) {
    const capture = 7 + n * FRAME
    const arrival = n * FRAME * 1.0001 + 0.004
    const placed = clock.map(capture, arrival)
    expect(placed).toBeLessThanOrEqual(arrival + 1e-9)
    worst = Math.max(worst, arrival - placed)
  }
  expect(worst).toBeLessThan(0.002)
})

test('repeated or decreasing capture timestamps are placed at arrival', () => {
  const clock = new VideoFrameClock()
  expect(clock.map(1, 0.5)).toBe(0.5)
  expect(clock.map(1, 0.6)).toBe(0.6)
  expect(clock.map(0.9, 0.7)).toBe(0.7)
  expect(clock.map(NaN, 0.8)).toBe(0.8)
})

test('reset forgets the previous track clock', () => {
  const clock = new VideoFrameClock()
  clock.map(1000, 1)
  clock.reset()
  expect(clock.map(3, 2)).toBe(2)
  expect(clock.map(3 + FRAME, 2 + FRAME + 0.02)).toBeCloseTo(2 + FRAME, 9)
})
