import { AudioInputs } from './audioinputs/AudioInputs.ts'
import { LocalMediaStreams } from './mediastreams/LocalMediaStreams.ts'
import { Project } from './project/Project.ts'
import { Track } from './project/Track.ts'
import { Clip } from './project/Clip.ts'
import { TrackListController } from './ui/timeline/TrackListController.ts'
import { ClockController } from './ui/ClockController.ts'
import { AudioInputsController } from './ui/AudioInputsController.ts'
import { KeyPressController } from './ui/KeyPressController.ts'
import { AudioControl } from './audiocontext/AudioControl.ts'
import { NotificationsController } from './ui/NotificationsController.ts'
import { HeaderController } from './ui/HeaderController.ts'
import { LogsModalController } from './ui/LogsModalController.ts'
import { ProcessingModalController } from './ui/ProcessingModalController.ts'
import { ClipManagerController } from './ui/ClipManagerController.ts'
import { ProjectModalController } from './ui/ProjectModalController.ts'
import { MainMenuController } from './ui/MainMenuController.ts'
import { AddClipController } from './ui/AddClipController.ts'
import { WelcomePageController } from './ui/WelcomePageController.ts'
import { SettingsController } from './ui/SettingsController.ts'

// Last-resort surface for errors that escape local handling, e.g. a failed dynamic
// import inside an async event handler: such rejections are otherwise silent.
let reportingSurfacedError = false
function reportSurfacedError(error) {
  // showError touches the DOM; if it itself throws inside these listeners the new
  // uncaught error would re-enter this function and recurse until stack overflow.
  if (reportingSurfacedError) return
  reportingSurfacedError = true
  try {
    NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
  } finally {
    reportingSurfacedError = false
  }
}

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault()
  reportSurfacedError(event.reason)
})

// Resource-load failures do not bubble, so a non-capture listener only sees uncaught script errors.
window.addEventListener('error', (event) => {
  event.preventDefault()
  reportSurfacedError(event.error ?? new Error(event.message || 'Unknown error'))
})

window.AudioInputs = AudioInputs
window.LocalMediaStreams = LocalMediaStreams
window.Project = Project
window.Track = Track
window.Clip = Clip
window.TrackListController = TrackListController
window.ClockController = ClockController
window.AudioInputsController = AudioInputsController
window.KeyPressController = KeyPressController
window.AudioControl = AudioControl
window.NotificationsController = NotificationsController
window.HeaderController = HeaderController
window.LogsModalController = LogsModalController
window.ProcessingModalController = ProcessingModalController
window.ClipManagerController = ClipManagerController
window.ProjectModalController = ProjectModalController
window.MainMenuController = MainMenuController
window.AddClipController = AddClipController
window.WelcomePageController = WelcomePageController
window.SettingsController = SettingsController

// These interaction boundaries keep publishing, project transfer, recording, and conferencing out of the initial chunk.
let publishProjectControllerPromise
window.loadPublishProjectController = () =>
  (publishProjectControllerPromise ??= import('./ui/PublishProjectController.ts').then(
    ({ PublishProjectController }) => (window.publishProjectController ??= new PublishProjectController()),
  ))

let projectTransferControllerPromise
window.loadProjectTransferController = () =>
  (projectTransferControllerPromise ??= import('./ui/ProjectTransferController.ts').then(
    ({ ProjectTransferController }) => (window.projectTransferController ??= new ProjectTransferController()),
  ))

let recorderPromise
window.loadRecorder = () => (recorderPromise ??= import('./recording/Recorder.ts').then(({ Recorder }) => Recorder))

let meetingRoomControllerPromise
window.loadMeetingRoomController = () =>
  (meetingRoomControllerPromise ??= import('./ui/MeetingRoomController.ts').then(
    ({ MeetingRoomController }) => (window.meetingRoomController ??= new MeetingRoomController()),
  ))
