import type { TranscribedRange } from '../../project/Transcription'
import { projectVisibleTranscribedRanges } from './TranscriptionOverlay'

function project(
  transcription: readonly TranscribedRange[],
  sourceStartSample: number,
  sourceEndSample: number,
  timelineStartSample: number,
  viewportStartSample: number,
  viewportEndSample: number,
) {
  return projectVisibleTranscribedRanges(
    transcription,
    sourceStartSample,
    sourceEndSample,
    timelineStartSample,
    viewportStartSample,
    viewportEndSample,
  )
}

test('empty transcription projects no ranges', () => {
  expect(project([], 0, 100, 1_000, 900, 1_200)).toEqual([])
})

test('sparse phrase ranges map through a moved placement', () => {
  const transcription = [
    { text: 'all terrain', startSample: 10, endSample: 20 },
    { text: 'keeps moving', startSample: 40, endSample: 55 },
  ]

  expect(project(transcription, 0, 100, 1_000, 900, 1_200)).toEqual([
    {
      text: 'all terrain',
      startSample: 1_010,
      endSample: 1_020,
      drawStartBoundary: true,
      drawEndBoundary: true,
    },
    {
      text: 'keeps moving',
      startSample: 1_040,
      endSample: 1_055,
      drawStartBoundary: true,
      drawEndBoundary: true,
    },
  ])
})

test('source trimming retains intersecting labels without synthetic trim boundaries', () => {
  const transcription = [
    { text: 'trimmed start', startSample: 0, endSample: 20 },
    { text: 'middle', startSample: 40, endSample: 60 },
    { text: 'trimmed end', startSample: 80, endSample: 100 },
  ]

  expect(project(transcription, 10, 90, 500, 0, 1_000)).toEqual([
    {
      text: 'trimmed start',
      startSample: 490,
      endSample: 510,
      drawStartBoundary: false,
      drawEndBoundary: true,
    },
    {
      text: 'middle',
      startSample: 530,
      endSample: 550,
      drawStartBoundary: true,
      drawEndBoundary: true,
    },
    {
      text: 'trimmed end',
      startSample: 570,
      endSample: 590,
      drawStartBoundary: true,
      drawEndBoundary: false,
    },
  ])
})

test('a range enclosing the viewport has no visible actual boundaries', () => {
  const transcription = [{ text: 'enclosing phrase', startSample: 0, endSample: 100 }]

  expect(project(transcription, 0, 100, 1_000, 1_025, 1_075)).toEqual([
    {
      text: 'enclosing phrase',
      startSample: 1_000,
      endSample: 1_100,
      drawStartBoundary: false,
      drawEndBoundary: false,
    },
  ])
})

test('half-open endpoints exclude ranges merely touching the viewport', () => {
  const transcription = [
    { text: 'ends at viewport', startSample: 0, endSample: 10 },
    { text: 'fills viewport', startSample: 10, endSample: 20 },
    { text: 'starts at viewport end', startSample: 20, endSample: 30 },
  ]

  expect(project(transcription, 0, 30, 0, 10, 20)).toEqual([
    {
      text: 'fills viewport',
      startSample: 10,
      endSample: 20,
      drawStartBoundary: true,
      drawEndBoundary: true,
    },
  ])
})

test('gaps and wholly offscreen ranges project no records', () => {
  const transcription = [
    { text: 'before gap', startSample: 0, endSample: 10 },
    { text: 'after gap', startSample: 30, endSample: 40 },
  ]

  expect(project(transcription, 0, 50, 0, 15, 25)).toEqual([])
  expect(project(transcription, 50, 60, 1_000, 900, 1_200)).toEqual([])
})
