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
import { InputsPanelController } from './ui/InputsPanelController.ts'
import { OutputPanelController } from './ui/OutputPanelController.ts'
import { closeOnBackdropClick } from './ui/BackdropDismiss.ts'
import { Logger } from './global/Logger.ts'

const logger = new Logger('TopLevel')

// Last-resort surface for errors that escape local handling, e.g. a failed dynamic
// import inside an async event handler: such rejections are otherwise silent.
const BENIGN_ERROR_PATTERNS = [
  // A ResizeObserver callback changed layout after notifications were delivered; the
  // observer re-runs next frame by spec. Chromium reports it as an uncaught error,
  // but it is not an application failure and must not alarm the user.
  /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)\.?$/,
  // Cross-origin scripts (including browser extensions) throw errors the page cannot
  // inspect ("Script error."). Nothing in them is actionable by the app or the user.
  /^Script error\.?$/,
]
function isBenignSurfacedError(error) {
  // User-initiated cancellations (file picker, clipboard, aborted requests) reject with
  // AbortError; call sites that handle them specially already filter them locally.
  if (error != null && error.name === 'AbortError') return true
  const message = error instanceof Error ? error.message : String(error)
  return BENIGN_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

let reportingSurfacedError = false
function reportSurfacedError(error) {
  // showError touches the DOM; if it itself throws inside these listeners the new
  // uncaught error would re-enter this function and recurse until stack overflow.
  if (reportingSurfacedError) return
  reportingSurfacedError = true
  try {
    logger.error(error instanceof Error ? error : new Error(String(error)))
  } finally {
    reportingSurfacedError = false
  }
}

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault()
  if (isBenignSurfacedError(event.reason)) return
  reportSurfacedError(event.reason)
})

// Resource-load failures do not bubble, so a non-capture listener only sees uncaught script errors.
window.addEventListener('error', (event) => {
  event.preventDefault()
  const error = event.error ?? new Error(event.message || 'Unknown error')
  if (isBenignSurfacedError(error)) return
  reportSurfacedError(error)
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
window.InputsPanelController = InputsPanelController
window.OutputPanelController = OutputPanelController
window.closeOnBackdropClick = closeOnBackdropClick

// These interaction boundaries keep publishing, project transfer, recording, and conferencing out of the initial chunk.
// A failed dynamic import (e.g. a missing chunk after a deploy) must not stay cached:
// the memo is cleared on rejection so the next call retries the load instead of
// returning the same stale rejection until a full page reload.
function lazyImport(load, create) {
  let promise
  let failures = 0
  let reloadHintShown = false
  return () =>
    (promise ??= load()
      .then(create)
      .then(
        (value) => {
          failures = 0
          return value
        },
        (error) => {
          promise = undefined
          failures += 1
          // Chromium keeps a failed dynamic import in its per-document module map, so an
          // in-page retry cannot re-fetch that URL; after a redeploy the only recovery is
          // a reload. Say so once instead of letting the user retry in vain.
          if (failures >= 2 && !reloadHintShown) {
            reloadHintShown = true
            NotificationsController.showErrorMessage(
              'Loading keeps failing. Reload the page to get the latest version.',
            )
          }
          throw error
        },
      ))
}

window.loadPublishProjectController = lazyImport(
  () => import('./ui/PublishProjectController.ts'),
  ({ PublishProjectController }) => (window.publishProjectController ??= new PublishProjectController()),
)

window.loadProjectTransferController = lazyImport(
  () => import('./ui/ProjectTransferController.ts'),
  ({ ProjectTransferController }) => (window.projectTransferController ??= new ProjectTransferController()),
)

window.loadRecorder = lazyImport(
  () => import('./recording/Recorder.ts'),
  ({ Recorder }) => Recorder,
)

window.loadMeetingRoomController = lazyImport(
  () => import('./ui/MeetingRoomController.ts'),
  ({ MeetingRoomController }) => (window.meetingRoomController ??= new MeetingRoomController()),
)
