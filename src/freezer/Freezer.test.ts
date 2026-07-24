import 'fake-indexeddb/auto'
import { afterEach, expect, test, vi } from 'vitest'
import { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import { Renderer } from '../rendering/Renderer'
import { Track } from '../project/Track'
import { Freezer } from './Freezer'

afterEach(() => vi.restoreAllMocks())

test('freezes the selected range into a new track', async () => {
  const project = new Project('Test', 48000)
  Object.defineProperty(project, 'id', { value: 1 })
  const monoTrack = new Track('Voice', 1)
  const stereoTrack = new Track('Music', 2)
  Object.defineProperty(monoTrack, 'id', { value: 2 })
  Object.defineProperty(stereoTrack, 'id', { value: 3 })
  const frozenTrack = new Track('Frozen', 2)
  let createdClip: any

  vi.spyOn(ProjectManager, 'getActiveProject').mockResolvedValue(project)
  vi.spyOn(ProjectManager, 'addNewClip').mockImplementation(async (clip) => {
    createdClip = clip
    Object.defineProperty(clip, 'id', { value: 4 })
  })
  const render = vi.spyOn(Renderer, 'renderToClip').mockImplementation(async (_project, clip, _start, length) => {
    clip.length = length
  })
  const saveClip = vi.spyOn(ProjectManager, 'saveClip').mockResolvedValue()
  const addTrack = vi.spyOn(ProjectManager, 'addExistingClipWithTrack').mockResolvedValue(frozenTrack)

  const result = await Freezer.freezeSelection({
    startSample: 100,
    endSample: 500,
    tracks: [monoTrack, stereoTrack],
  })

  expect(result).toBe(frozenTrack)
  expect(createdClip.name).toBe('Freeze: 2 tracks')
  expect(createdClip.getChannelCount()).toBe(2)
  expect(createdClip.importedMetadata).toEqual({
    source: 'Freeze',
    sourceTrackIds: [2, 3],
    startSample: 100,
    endSample: 500,
  })
  expect(render).toHaveBeenCalledWith(project, createdClip, 100, 400, monoTrack, stereoTrack)
  expect(saveClip).toHaveBeenCalledWith(createdClip)
  expect(addTrack).toHaveBeenCalledWith(createdClip, 100)
})

test('removes the provisional clip when rendering fails', async () => {
  const project = new Project('Test', 48000)
  const track = new Track('Voice', 1)
  const renderError = new Error('render failed')
  let createdClip: any

  vi.spyOn(ProjectManager, 'getActiveProject').mockResolvedValue(project)
  vi.spyOn(ProjectManager, 'addNewClip').mockImplementation(async (clip) => {
    createdClip = clip
  })
  vi.spyOn(Renderer, 'renderToClip').mockRejectedValue(renderError)
  const deleteClip = vi.spyOn(ProjectManager, 'deleteClip').mockResolvedValue()
  const addTrack = vi.spyOn(ProjectManager, 'addExistingClipWithTrack')

  await expect(Freezer.freezeSelection({ startSample: 0, endSample: 100, tracks: [track] })).rejects.toBe(renderError)

  expect(deleteClip).toHaveBeenCalledWith(createdClip)
  expect(addTrack).not.toHaveBeenCalled()
})
