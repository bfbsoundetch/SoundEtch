import { expect, test } from 'vitest'
import { Clip } from '../project/Clip'
import { ClipView } from '../project/ClipView'
import { DEFAULT_OUTPUT_CAPTIONS, type OutputCaptionSettings } from '../project/OutputCaptions'
import { Project } from '../project/Project'
import { Track } from '../project/Track'
import type { TranscribedRange } from '../project/Transcription'
import { buildOutputCaptionCues, findOutputCaptionWord } from './OutputCaptionCues'
import { OutputCaptionSource } from './OutputCaptionSource'

// One centered 100 ms window covers exactly two real 256-sample summary buckets.
const RATE = 5120
const LOUD: OutputCaptionSettings = { ...DEFAULT_OUTPUT_CAPTIONS, followLoudest: true }

type AudioRegion = readonly [start: number, end: number, amplitude: number]

function audioClip(name: string, words: TranscribedRange[], regions: readonly AudioRegion[], length = 4096) {
  const clip = new Clip(name, 1)
  const samples = new Float32Array(length)
  for (const [start, end, amplitude] of regions) samples.fill(amplitude, start, end)
  clip.summary.summarizeInterleavedData(samples, samples.length)
  clip.transcription = words
  return clip
}

function addSpeaker(project: Project, name: string, words: TranscribedRange[], regions: readonly AudioRegion[], length = 4096) {
  const clip = audioClip(name, words, regions, length)
  const track = new Track(name, 1)
  track.addClipView(new ClipView(clip, 0, 0, length))
  project.addTrack(track)
  return { clip, track }
}

function word(text: string, startSample = 0, endSample = 4096): TranscribedRange {
  return { text, startSample, endSample }
}

function text(source: OutputCaptionSource, sample: number) {
  return source.getCue(sample)?.words.map((entry) => entry.text).join(' ') ?? null
}

test('separate speakers alternate at turns and the louder simultaneous speaker wins', () => {
  const project = new Project('speakers', RATE)
  addSpeaker(project, 'alpha', [word('alpha!', 0, 1536), word('again!', 3072, 4096)], [[0, 1536, 0.4], [3072, 4096, 0.4]])
  addSpeaker(project, 'beta', [word('beta!', 1024, 3072)], [[1024, 3072, 0.5]])
  const source = new OutputCaptionSource(project, LOUD)
  expect(source.hasCues).toBe(true)
  expect(text(source, 256)).toBe('Alpha!')
  expect(text(source, 1024)).toBe('Alpha!') // beta has only half a window of audio here
  expect(text(source, 1280)).toBe('Beta!')
  expect(text(source, 2048)).toBe('Beta!')
  expect(text(source, 3072)).toBe('again!')
  expect(text(source, 3328)).toBe('again!')
  expect(source.getCue(4096)).toBeNull()
})

test('the centered short-term window follows local audio rather than whole-clip loudness', () => {
  const project = new Project('local level', RATE)
  addSpeaker(project, 'alpha', [word('alpha!')], [[0, 2048, 0.8], [2048, 4096, 0.2]])
  addSpeaker(project, 'beta', [word('beta!')], [[0, 4096, 0.5]])
  const source = new OutputCaptionSource(project, LOUD)
  expect(text(source, 1792)).toBe('Alpha!')
  // Half 0.8² plus half 0.2² is still above 0.5².
  expect(text(source, 2048)).toBe('Alpha!')
  expect(text(source, 2304)).toBe('Beta!')
})

test('track gain is squared, and mute and solo determine eligible tracks', () => {
  const project = new Project('audibility', RATE)
  const alpha = addSpeaker(project, 'alpha', [word('alpha!')], [[0, 4096, 0.4]])
  const beta = addSpeaker(project, 'beta', [word('beta!')], [[0, 4096, 0.6]])
  alpha.track.setGain(2)
  expect(text(new OutputCaptionSource(project, LOUD), 1024)).toBe('Alpha!')
  project.setTrackMuted(alpha.track, true)
  expect(text(new OutputCaptionSource(project, LOUD), 1024)).toBe('Beta!')
  project.setTrackMuted(alpha.track, false)
  project.setTrackSoloed(beta.track, true)
  expect(text(new OutputCaptionSource(project, LOUD), 1024)).toBe('Beta!')
  project.setTrackMuted(beta.track, true)
  expect(new OutputCaptionSource(project, LOUD).hasCues).toBe(false)
  project.setTrackSoloed(beta.track, false)
  alpha.track.setGain(0)
  const zeroGain = new OutputCaptionSource(project, LOUD)
  expect(zeroGain.hasCues).toBe(true)
  expect(zeroGain.getCue(1024)).toBeNull()
})

test('an active word outranks a louder fragment pause; pauses remain visible without a highlight', () => {
  const project = new Project('word priority', RATE)
  addSpeaker(project, 'alpha', [word('alpha', 0, 512), word('again!', 1536, 2048)], [[0, 4096, 0.9]])
  addSpeaker(project, 'beta', [word('beta!', 768, 1280)], [[0, 4096, 0.1]])
  const source = new OutputCaptionSource(project, LOUD)
  expect(text(source, 1024)).toBe('Beta!')
  const paused = source.getCue(640)!
  expect(paused.words.map((entry) => entry.text)).toEqual(['Alpha', 'again!'])
  expect(findOutputCaptionWord(paused, 640)).toBe(-1)
  expect(text(source, 1536)).toBe('Alpha again!')
})

test('a silent active word cannot suppress a positive-level fragment pause', () => {
  const project = new Project('silent word', RATE)
  addSpeaker(project, 'alpha', [word('alpha', 0, 512), word('again!', 1536, 2048)], [[0, 4096, 0.4]])
  addSpeaker(project, 'beta', [word('beta!', 768, 1280)], [])
  expect(text(new OutputCaptionSource(project, LOUD), 1024)).toBe('Alpha again!')
})

test('untranscribed, trimmed-away and video-only words cannot steal captions', () => {
  const project = new Project('played words', RATE)
  addSpeaker(project, 'alpha', [word('alpha!')], [[0, 4096, 0.2]])
  addSpeaker(project, 'unknown', [{ ...word('', 0, 4096), kind: 'untranscribed' }], [[0, 4096, 1]])
  const trimmed = addSpeaker(project, 'trimmed', [word('removed!', 0, 512)], [[0, 4096, 1]])
  trimmed.track.clipViews.splice(0, 1, new ClipView(trimmed.clip, 512, 0, 3072))
  const video = addSpeaker(project, 'video', [word('video!')], [[0, 4096, 1]])
  video.clip.audioPresent = false
  // Even sharing a track with actual audio cannot make video-only words eligible.
  const extraVideo = audioClip('video on alpha', [word('wrong!')], [[0, 4096, 1]])
  extraVideo.audioPresent = false
  // Pushed directly: edits may not stack clips like this, but captions must cope with any layout.
  project.getTracks()[0].clipViews.push(new ClipView(extraVideo, 0, 0, 4096))
  expect(text(new OutputCaptionSource(project, LOUD), 1024)).toBe('Alpha!')
})

test('offsets, trims, repeated placements and overlapping placement windows use source PCM', () => {
  const project = new Project('placements', RATE)
  const clip = audioClip('source', [word('low!', 0, 1024), word('high!', 1024, 2048)], [[0, 1024, 0.2], [1024, 2048, 0.8]], 2048)
  const track = new Track('placed', 1)
  track.addClipView(new ClipView(clip, 1024, 512, 512))
  track.addClipView(new ClipView(clip, 0, 2048, 1024))
  track.addClipView(new ClipView(clip, 1024, 4096, 2048)) // clamped at the clip's end
  project.addTrack(track)
  addSpeaker(project, 'steady', [word('steady!', 0, 6144)], [[0, 6144, 0.5]], 6144)
  const source = new OutputCaptionSource(project, LOUD)
  expect(text(source, 256)).toBe('Steady!')
  expect(text(source, 512)).toBe('High!') // half a high window still beats steady
  expect(text(source, 768)).toBe('High!')
  expect(text(source, 1024)).toBe('Steady!')
  expect(text(source, 2304)).toBe('Steady!')
  expect(text(source, 4352)).toBe('high!')
  expect(text(source, 5120)).toBe('Steady!')
})

test('partial clip windows are weighted by played duration, not normalized independently', () => {
  const project = new Project('partial windows', RATE)
  const burst = audioClip('burst', [word('burst!', 0, 256)], [[0, 256, 0.8]], 256)
  const track = new Track('burst', 1)
  track.addClipView(new ClipView(burst, 0, 1024, 256))
  project.addTrack(track)
  addSpeaker(project, 'steady', [word('steady!')], [[0, 4096, 0.7]])
  expect(text(new OutputCaptionSource(project, LOUD), 1152)).toBe('Steady!')
})

test('overlapping placed clips contribute energy and a long placement resumes after nested clips', () => {
  const project = new Project('overlaps', RATE)
  const track = new Track('layered', 1)
  const long = audioClip('long', [word('long!')], [[0, 4096, 0.4]])
  const short = audioClip('short', [word('short!', 0, 512)], [[0, 512, 0.4]], 512)
  // Pushed directly: splitting inside a crossfade can still leave nested clips like these.
  track.clipViews.push(
    new ClipView(long, 0, 0, 4096),
    new ClipView(short, 0, 512, 512),
    new ClipView(short, 0, 1536, 512),
    new ClipView(short, 0, 2560, 512),
  )
  project.addTrack(track)
  addSpeaker(project, 'steady', [word('steady!')], [[0, 4096, 0.5]])
  const source = new OutputCaptionSource(project, LOUD)
  expect(text(source, 768)).toBe('short!')
  expect(text(source, 1280)).toBe('Steady!')
  expect(text(source, 1792)).toBe('short!')
  expect(text(source, 2816)).toBe('short!')
  expect(text(source, 3328)).toBe('Steady!')
})

test('ties use project order, silent and unpopulated sources stay empty, and seeking is stateless', () => {
  const project = new Project('ties', RATE)
  addSpeaker(project, 'alpha', [word('alpha!', 0, 1024)], [[0, 1024, 0.5]])
  addSpeaker(project, 'beta', [word('beta!', 0, 2048)], [[0, 2048, 0.5]])
  addSpeaker(project, 'silent', [word('silent!')], [])
  const missing = new Clip('missing summary', 1, 4096)
  missing.transcription = [word('missing!')]
  const missingTrack = new Track('missing', 1)
  missingTrack.addClipView(new ClipView(missing, 0, 0, 4096))
  project.addTrack(missingTrack)
  const source = new OutputCaptionSource(project, LOUD)
  for (const sample of [256, 1536, 3072, 768, 1536, 256, 4096, 3072]) {
    expect(text(source, sample)).toBe(sample < 1024 ? 'Alpha!' : sample < 2048 ? 'Beta!' : null)
  }
  for (const sample of [NaN, Infinity, -Infinity, -1024]) expect(source.getCue(sample)).toBeNull()
  project.getTracks().reverse()
  expect(text(source, 256)).toBe('Alpha!')
  expect(text(new OutputCaptionSource(project, LOUD), 256)).toBe('Beta!')
})

test('snapshot text, gain, audibility, placements, order and audio presence survive subsequent edits', () => {
  const project = new Project('snapshot', RATE)
  const alpha = addSpeaker(project, 'alpha', [word('alpha!')], [[0, 4096, 0.6]])
  const beta = addSpeaker(project, 'beta', [word('beta!')], [[0, 4096, 0.5]])
  const settings = { ...LOUD }
  const source = new OutputCaptionSource(project, settings)
  const before = source.getCue(1024)
  settings.followLoudest = false
  settings.track = beta.track
  alpha.clip.transcription[0] = { ...alpha.clip.transcription[0], text: 'edited!' }
  alpha.clip.audioPresent = false
  alpha.track.setGain(0)
  project.setTrackMuted(alpha.track, true)
  project.setTrackSoloed(beta.track, true)
  alpha.track.clipViews.splice(0, 1, new ClipView(alpha.clip, 0, 8192, 4096))
  project.getTracks().reverse()
  expect(source.getCue(1024)).toBe(before)
  expect(text(source, 1024)).toBe('Alpha!')
  expect(text(new OutputCaptionSource(project, LOUD), 1024)).toBe('Beta!')
})

test('automatic and manual sources retain fixed-track behavior without audio-level gating', () => {
  const project = new Project('legacy modes', RATE)
  const alpha = addSpeaker(project, 'alpha', [word('alpha!', 0, 512)], [])
  const beta = addSpeaker(project, 'beta', [word('beta!', 0, 2048)], [[0, 4096, 0.9]])
  // Both false and absent flags retain the old first-audible-track selection.
  const automatic = new OutputCaptionSource(project, { ...DEFAULT_OUTPUT_CAPTIONS, followLoudest: false })
  const { followLoudest: _unused, ...legacySettings } = DEFAULT_OUTPUT_CAPTIONS
  const legacy = new OutputCaptionSource(project, legacySettings)
  expect(automatic.hasCues).toBe(true)
  expect(text(automatic, 256)).toBe('Alpha!')
  expect(text(legacy, 256)).toBe('Alpha!')
  expect(automatic.getCue(1024)).toBeNull()
  project.setTrackMuted(beta.track, true)
  const manual = new OutputCaptionSource(project, { ...DEFAULT_OUTPUT_CAPTIONS, followLoudest: false, track: beta.track })
  expect(text(manual, 1024)).toBe('Beta!')
  alpha.clip.transcription = [word('changed!')]
  alpha.track.clipViews.length = 0
  expect(text(automatic, 256)).toBe('Alpha!')
  const expected = buildOutputCaptionCues(beta.track, RATE)
  expect(manual.getCue(1024)).toEqual(expected[0])
})

test('empty sources have no cues even when caption display is enabled', () => {
  const project = new Project('empty', RATE)
  for (const followLoudest of [false, true]) {
    const source = new OutputCaptionSource(project, { ...DEFAULT_OUTPUT_CAPTIONS, followLoudest, enabled: true })
    expect(source.hasCues).toBe(false)
    expect(source.getCue(0)).toBeNull()
  }
})

test('an active word in an earlier overlapping fragment outranks another track’s louder pause', () => {
  const project = new Project('overlapping fragment priority', RATE)
  const track = new Track('layered', 1)
  const outer = audioClip('outer', [word('outer!')], [[0, 4096, 0.2]])
  const inner = audioClip('inner', [word('inner', 0, 256), word('later!', 1024, 1280)], [[0, 1280, 0.2]], 1280)
  track.clipViews.push(new ClipView(outer, 0, 0, 4096), new ClipView(inner, 0, 512, 1280))
  project.addTrack(track)
  addSpeaker(project, 'loud pause', [word('louder', 0, 512), word('again!', 1536, 2048)], [[0, 4096, 0.8]])
  const source = new OutputCaptionSource(project, LOUD)
  expect(text(source, 1024)).toBe('Outer!')
  expect(findOutputCaptionWord(source.getCue(1024)!, 1024)).toBe(0)
})

test('a video tail does not stretch the represented audio when weighting the window', () => {
  const project = new Project('short audio', RATE)
  const clip = audioClip('short audio', [word('short!')], [[0, 256, 0.8]], 256)
  clip.videoLength = 4096
  const track = new Track('short audio', 1)
  track.addClipView(new ClipView(clip, 0, 0, 4096))
  project.addTrack(track)
  addSpeaker(project, 'steady', [word('steady!')], [[0, 4096, 0.7]])
  const source = new OutputCaptionSource(project, LOUD)
  expect(text(source, 384)).toBe('Steady!')
  expect(text(source, 1024)).toBe('Steady!')
})

test('live level refresh follows gain, mute, solo and removal without rebuilding caption text', () => {
  const project = new Project('live levels', RATE)
  const alpha = addSpeaker(project, 'alpha', [word('alpha!')], [[0, 4096, 0.4]])
  const beta = addSpeaker(project, 'beta', [word('beta!')], [[0, 4096, 0.6]])
  project.setTrackMuted(beta.track, true)
  const source = new OutputCaptionSource(project, LOUD)
  expect(text(source, 1024)).toBe('Alpha!')
  project.setTrackMuted(beta.track, false)
  expect(source.updateLevels(project)).toBe(true)
  expect(text(source, 1024)).toBe('Beta!')
  alpha.track.setGain(2)
  alpha.clip.transcription = [word('new transcript!')]
  source.updateLevels(project)
  expect(text(source, 1024)).toBe('Alpha!')
  project.setTrackSoloed(beta.track, true)
  source.updateLevels(project)
  expect(text(source, 1024)).toBe('Beta!')
  project.setTrackMuted(beta.track, true)
  source.updateLevels(project)
  expect(source.hasCues).toBe(false)
  expect(source.getCue(1024)).toBeNull()
  project.deleteTrack(beta.track)
  source.updateLevels(project)
  expect(source.hasCues).toBe(true)
  expect(text(source, 1024)).toBe('Alpha!')
  expect(source.updateLevels(project)).toBe(false)
})
