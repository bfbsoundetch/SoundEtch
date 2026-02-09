import { TrackPosition } from './TrackPosition'

test('createAtBeginning', async () => {
  const trackPosition = TrackPosition.createAtBeginning(3)

  expect(trackPosition.toMilliseconds()).toBe(0)
})

test('createAtPosition', async () => {
  const trackPosition = TrackPosition.createAtPosition(3, 1500)

  expect(trackPosition.toMilliseconds()).toBe(1333)
})

test('toString long', async () => {
  const trackPosition = TrackPosition.createAtPosition(3, 24 * 60 * 60 * 1000 + 60 * 60 * 1000 + 60 * 1000 + 1500)

  expect(trackPosition.toString()).toBe('1D 1H 1M 1.333S')
})

test('toString short', async () => {
  const trackPosition = TrackPosition.createAtPosition(4, 654321)

  expect(trackPosition.toString()).toBe('10M 54.250S')
})

test('toString zero', async () => {
  const trackPosition = TrackPosition.createAtBeginning(4)

  expect(trackPosition.toString()).toBe('0.000S')
})
