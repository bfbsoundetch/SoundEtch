/** Moves a position to the next (direction 1) or previous (-1) multiple of `step` samples, never below 0. */
export function stepTimelinePosition(position: number, step: number, direction: 1 | -1): number {
  if (step <= 0) return position
  const next = direction > 0 ? (Math.floor(position / step) + 1) * step : (Math.ceil(position / step) - 1) * step
  return Math.max(0, next)
}
