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
import { PublishProjectController } from './ui/PublishProjectController.ts'
import { LogsModalController } from './ui/LogsModalController.ts'
import { ProcessingModalController } from './ui/ProcessingModalController.ts'
import { ClipManagerController } from './ui/ClipManagerController.ts'
import { ProjectModalController } from './ui/ProjectModalController.ts'
import { ProjectTransferController } from './ui/ProjectTransferController.ts'
import { MainMenuController } from './ui/MainMenuController.ts'
import { AddClipController } from './ui/AddClipController.ts'

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
window.PublishProjectController = PublishProjectController
window.LogsModalController = LogsModalController
window.ProcessingModalController = ProcessingModalController
window.ClipManagerController = ClipManagerController
window.ProjectModalController = ProjectModalController
window.ProjectTransferController = ProjectTransferController
window.MainMenuController = MainMenuController
window.AddClipController = AddClipController

// These interaction boundaries keep recording, importing, and conferencing out of the initial timeline chunk.
let recorderPromise
window.loadRecorder = () => (recorderPromise ??= import('./recording/Recorder.ts').then(({ Recorder }) => Recorder))

let meetingRoomControllerPromise
window.loadMeetingRoomController = () =>
  (meetingRoomControllerPromise ??= import('./ui/MeetingRoomController.ts').then(
    ({ MeetingRoomController }) => (window.meetingRoomController ??= new MeetingRoomController()),
  ))
