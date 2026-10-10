import { stepTimelinePosition } from './TimelineKeyboardSteps'

test.each<[number, number, 1 | -1, number]>([
  [0, 100, 1, 100],
  [150, 100, 1, 200],
  [200, 100, 1, 300],
  [150, 100, -1, 100],
  [200, 100, -1, 100],
  [50, 100, -1, 0],
  [0, 100, -1, 0],
  [70, 0, 1, 70],
])('stepTimelinePosition(%p, %p, %p)', async (position, step, direction, expected) => {
  expect(stepTimelinePosition(position, step, direction)).toBe(expected)
})
