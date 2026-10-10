import { TimeUtils } from './TimeUtils'

test.each([
  [0, '0 seconds'],
  [1000, '1 second'],
  [1500, '1.5 seconds'],
  [61250, '1 minute 1.25 seconds'],
  [3600000, '1 hour'],
  [7260000, '2 hours 1 minute'],
  [59999.6, '1 minute'],
])('toSpokenString(%p)', async (ms, expected) => {
  expect(TimeUtils.toSpokenString(ms)).toBe(expected)
})
