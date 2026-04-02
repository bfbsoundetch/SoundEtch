import { AudioInputs } from './audioinputs/AudioInputs.ts'
import { LocalMediaStreams } from './mediastreams/LocalMediaStreams.ts'
import { Project } from './project/Project.ts'
import { Track } from './project/Track.ts'
import { NetworkUtils } from './NetworkUtils.ts'
import { Clip } from './project/Clip.ts'
import { Player } from './playback/Player.ts'
import { Recorder } from './recording/Recorder.ts'
import { MeetingRoomController } from './ui/MeetingRoomController.ts'
import { TrackListController } from './ui/timeline/TrackListController.ts'
import { ClockController } from './ui/ClockController.ts'
import { AudioInputsController } from './ui/AudioInputsController.ts'
import { KeyPressController } from './ui/KeyPressController.ts'
import { AudioControl } from './audiocontext/AudioControl.ts'
import { NotificationsController } from './ui/NotificationsController.ts'
import { HeaderController } from './ui/HeaderController.ts'
import { Renderer } from './rendering/Renderer.ts'
import { ExportProjectController } from './ui/ExportProjectController.ts'
import { LogsModalController } from './ui/LogsModalController.ts'
import { ProcessingModalController } from './ui/ProcessingModalController.ts'
import { ClipManagerController } from './ui/ClipManagerController.ts'

window.AudioInputs = AudioInputs
window.LocalMediaStreams = LocalMediaStreams
window.Project = Project
window.Track = Track
window.NetworkUtils = NetworkUtils
window.Clip = Clip
window.Player = Player
window.Recorder = Recorder
window.MeetingRoomController = MeetingRoomController
window.TrackListController = TrackListController
window.ClockController = ClockController
window.AudioInputsController = AudioInputsController
window.KeyPressController = KeyPressController
window.AudioControl = AudioControl
window.NotificationsController = NotificationsController
window.HeaderController = HeaderController
window.Renderer = Renderer
window.ExportProjectController = ExportProjectController
window.LogsModalController = LogsModalController
window.ProcessingModalController = ProcessingModalController
window.ClipManagerController = ClipManagerController
