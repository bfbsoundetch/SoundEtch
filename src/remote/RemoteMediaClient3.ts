import { Logger } from '../global/Logger'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { Peer, DataConnection, MediaConnection, ConnectionType, LogLevel } from 'peerjs'
import { PeerNetworkDelayEstimator, TimestampMessage } from './PeerNetworkDelayEstimator'

export type PeerMessage =
  | {
      type: 'self'
      username: string
      screenShareStreamId: string
      recordingActivity?: RecordingActivity
    }
  | {
      // Host -> newly admitted guest: open a connection to this existing member.
      type: 'otherPeer'
      peer: string
    }
  | {
      // Host -> existing members: accept the connection this newly admitted guest is about to open.
      type: 'peerAdmitted'
      peer: string
    }
  | {
      // Host -> waiting guest.
      type: 'admitted'
    }
  | {
      // Host (or a peer that is not hosting) -> guest asking to join.
      type: 'joinRejected'
      reason: string
    }
  | {
      type: 'meshConnectionFailed'
      failedPeer: string
    }
  | {
      // Host -> remaining members after removing a guest who could not connect directly to another member.
      type: 'directConnectionFailed'
      notice: string
    }
  | {
      type: 'kicked'
      reason: string
    }
  | {
      type: 'chat'
      message: string
    }
  | {
      type: 'iceCandidate'
      candidate: RTCIceCandidateInit
    }
  | {
      type: 'rtcSessionDescription'
      desc: RTCSessionDescription
    }
  | {
      type: 'recordingActivity'
      activity: RecordingActivity
    }
  | TimestampMessage

export type RecordingActivity =
  | {
      state: 'idle'
      countdownId: number | null
    }
  | {
      state: 'countdown'
      countdownId: number
      durationMs: number
    }
  | {
      state: 'recording'
      countdownId: number | null
    }

export interface Member {
  peerId: string
  username: string
  mediaStream: MediaStream
  error: string | null
  recordingActivity: RecordingActivity
}

export interface JoinRequest {
  peerId: string
  username: string
}

export interface State {
  members: Array<Member>
  /** Peer id of the host. Only the host admits guests, so the invite link always points here. */
  roomId: string | null
  isHost: boolean
  hostUsername: string | null
  /** A guest that has asked to join and is not yet admitted by the host. */
  waitingForHost: boolean
  /** Guests waiting for this client (the host) to admit or deny them. */
  joinRequests: Array<JoinRequest>
  screenShare: Member | 'self' | null
  error: string | null
}

/** The host plus three guests. */
export const MAX_GUESTS = 3

export type RemoteMediaClientMessage = {
  type: 'info'
  info: string
}

export type StateListener = (state: State) => void
export type MessageListener = (message: RemoteMediaClientMessage) => void

type HeldPeer = {
  messages: Array<{ dataConnection: DataConnection; message: PeerMessage }>
  timeout: number | null
}

class RemotePeerState {
  private pendingIceCandidates = new Array<RTCIceCandidateInit>()
  rtcPeerConnection: RTCPeerConnection | null = null
  remoteScreenShareStreamId: string | null = null
  peerNeworkDelayEstimator: PeerNetworkDelayEstimator | null = null
  iceDisconnectedCleanupTimeout: number | null = null
  meshConnectionTimeout: number | null = null
  introducedByPeerId: string | null = null
  joinedSequence: number | null = null
  meshFailureReported = false
  /** Which of this peer's ICE connections (data, media) are currently disconnected or failed. */
  readonly interruptedConnections = new Set<'data' | 'media'>()
  ignoreOffer = false
  private rtcOperationQueue: Promise<void> = Promise.resolve()

  enqueueRtcOperation(operation: () => Promise<void>): Promise<void> {
    const queuedOperation = this.rtcOperationQueue.then(operation, operation)
    this.rtcOperationQueue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }

  withRtcPeerConnection(callback: (peerConnection: RTCPeerConnection) => void) {
    if (this.rtcPeerConnection) {
      callback(this.rtcPeerConnection)
    }
  }

  async addOrQueueIceCandidate(candidate: RTCIceCandidateInit, rtcPeerConnection: RTCPeerConnection) {
    if (!rtcPeerConnection.remoteDescription) {
      this.pendingIceCandidates.push(candidate)
      return
    }

    await rtcPeerConnection.addIceCandidate(candidate)
  }

  async flushPendingIceCandidates(rtcPeerConnection: RTCPeerConnection) {
    for (const candidate of this.pendingIceCandidates) {
      await rtcPeerConnection.addIceCandidate(candidate)
    }
    this.pendingIceCandidates = []
  }
}

export class RemoteMediaClient3 {
  private readonly peer: Peer
  private readonly remotePeerStates = new Map<string, RemotePeerState>()
  private readonly state: State = {
    members: new Array<Member>(),
    roomId: null,
    isHost: true,
    hostUsername: null,
    waitingForHost: false,
    joinRequests: new Array<JoinRequest>(),
    screenShare: null,
    error: null,
  }
  private readonly stateListeners = new Array<StateListener>()
  private readonly messageListeners = new Array<MessageListener>()
  private readonly initializedDataConnections = new Set<string>()
  private readonly openedDataConnections = new Set<string>()
  /** Peers whose messages are processed: guests the host admitted, or for a guest, the host and members it vouched for. */
  private readonly admittedPeers = new Set<string>()
  /** Messages from peers that are not admitted yet, replayed once they are. */
  private readonly heldPeers = new Map<string, HeldPeer>()
  private destroyed = false
  private readonly logger = new Logger('RemoteMediaClient')
  private nextJoinedSequence = 0
  private currentRecordingActivity: RecordingActivity = { state: 'idle', countdownId: null }
  private currentCountdownStartedAtMs: number | null = null

  constructor(
    private readonly username: string,
    roomName: string | null = null,
    createForTest = false,
    private readonly meshConnectionTimeoutMs = MESH_CONNECTION_TIMEOUT_MS,
  ) {
    LocalMediaStreams.registerAVDeviceListener((added, track) => {
      if (added) {
        this.remotePeerStates.forEach((remotePeerState, key) => {
          remotePeerState.withRtcPeerConnection((value) => {
            value.addTrack(track, LocalMediaStreams.localAVDeviceMediaStream)
          })
        })
      } else {
        this.remotePeerStates.forEach((remotePeerState) => {
          remotePeerState.withRtcPeerConnection((value) => {
            value.getSenders().forEach((sender) => {
              if (sender.track == track) {
                value.removeTrack(sender)
              }
            })
          })
        })
      }
      this.notifyStateListeners()
    })

    LocalMediaStreams.registerScreenListener((added, track) => {
      if (added && this.state.screenShare != 'self') {
        if (this.state.screenShare) {
          LocalMediaStreams.endScreenShare()
        } else {
          this.state.screenShare = 'self'
          this.remotePeerStates.forEach((remotePeerState) => {
            remotePeerState.withRtcPeerConnection((value) => {
              LocalMediaStreams.localScreenMediaStream.getTracks().forEach((t) => {
                value.addTrack(t, LocalMediaStreams.localScreenMediaStream)
              })
            })
          })
        }
      } else if (!added && this.state.screenShare == 'self') {
        this.state.screenShare = null
        this.remotePeerStates.forEach((remotePeerState) => {
          remotePeerState.withRtcPeerConnection((value) => {
            value.getSenders().forEach((sender) => {
              if (sender.track == track) {
                value.removeTrack(sender)
              }
            })
          })
        })
      }
      this.notifyStateListeners()
    })

    // Whoever creates the meeting hosts it; everyone else joins through the host's id and waits to be admitted.
    this.state.roomId = roomName
    this.state.isHost = roomName == null
    this.state.hostUsername = roomName == null ? username : null
    this.state.waitingForHost = roomName != null
    this.peer = createForTest
      ? new Peer('username', { config: rtcConfig, host: 'localhost', port: 8080, debug: 4 as any /*LogLevel.All*/ })
      : new Peer({ config: rtcConfig })

    this.peer.addListener('open', () => {
      console.debug('opened', this.peer.id)
      if (!this.state.roomId) {
        this.state.roomId = this.peer.id
        this.notifyStateListeners()
      }
    })

    this.peer.addListener('error', (error) => {
      switch (error.type) {
        case 'disconnected':
        case 'browser-incompatible':
        case 'invalid-id':
        case 'invalid-key':
        case 'network':
        case 'peer-unavailable':
        case 'ssl-unavailable':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed':
        case 'unavailable-id':
        case 'webrtc':
          if (this.state.members.length > 0) {
            this.notifyMessageListeners({
              type: 'info',
              info: 'Disconnected from server, but the meeting is still active.',
            })
          } else if (this.state.waitingForHost && error.type == 'peer-unavailable') {
            this.leaveWithError(HOST_UNREACHABLE_MESSAGE)
          } else {
            this.state.error = error.message
            this.notifyStateListeners()
          }
          break
      }
    })

    this.peer.addListener('connection', (dataConnection) => {
      console.debug('received a connection')
      if (!dataConnection.metadata?.soundetch) {
        console.debug('connection was not from SoundEtch.')
        dataConnection.close()
        return
      }
      if (dataConnection.metadata.joinRequest && !this.state.isHost) {
        // Only the host admits guests.
        this.rejectJoinRequestWhenOpen(
          dataConnection,
          'This invite link does not belong to the meeting host. Ask the host for their invite link.',
        )
        return
      }
      this.setUpDataConnection(dataConnection)
    })

    if (roomName) {
      this.join(roomName, true)
    }
  }

  get id(): string {
    return this.peer.id
  }

  get connections(): Map<string, Array<DataConnection | MediaConnection>> {
    return (this.peer as any)?._connections ?? new Map()
  }

  /** Host only: lets a guest who asked to join into the meeting. */
  admit(peerId: string) {
    const dataConnection = this.takeJoinRequest(peerId)
    if (!dataConnection) {
      this.notifyStateListeners()
      return
    }

    // Vouch for the new guest before introducing them, so existing members accept their connections.
    for (const memberPeerId of this.admittedPeers) {
      this.getOpenDataConnection(memberPeerId)?.send({ type: 'peerAdmitted', peer: peerId })
    }
    this.admitPeer(peerId)
    dataConnection.send({ type: 'admitted' })

    if (this.admittedPeers.size >= MAX_GUESTS) {
      for (const joinRequest of [...this.state.joinRequests]) {
        const waitingConnection = this.takeJoinRequest(joinRequest.peerId)
        if (waitingConnection) {
          this.rejectJoinRequest(waitingConnection, MEETING_FULL_MESSAGE)
          this.notifyMessageListeners({
            type: 'info',
            info: `${joinRequest.username} was turned away because the meeting is full.`,
          })
        }
      }
    }
    this.notifyStateListeners()
  }

  /** Host only: turns away a guest who asked to join. */
  deny(peerId: string) {
    const dataConnection = this.takeJoinRequest(peerId)
    if (dataConnection) {
      this.rejectJoinRequest(dataConnection, `${this.username} did not let you into the meeting.`)
    }
    this.notifyStateListeners()
  }

  disconnect() {
    this.destroyed = true
    this.heldPeers.forEach((heldPeer) => {
      if (heldPeer.timeout != null) {
        window.clearTimeout(heldPeer.timeout)
      }
    })
    this.remotePeerStates.forEach((remotePeerState) => {
      this.clearIceDisconnectedCleanupTimeout(remotePeerState)
      this.clearMeshConnectionTimeout(remotePeerState)
    })
    this.peer.destroy()
  }

  setRecordingActivity(recordingActivity: RecordingActivity) {
    this.currentRecordingActivity = recordingActivity
    this.currentCountdownStartedAtMs = recordingActivity.state === 'countdown' ? performance.now() : null
    this.sendRecordingActivity(this.getCurrentRecordingActivityForMessage())
  }

  addMessageListener(listener: MessageListener) {
    this.messageListeners.push(listener)
  }

  addStateListener(listener: StateListener) {
    this.stateListeners.push(listener)
    listener(this.state)
  }

  async amInRoom() {
    return !!this.state.roomId && !this.state.error
  }

  private getPeerConnections(peerId: string): Array<DataConnection | MediaConnection> {
    return this.connections.get(peerId) ?? []
  }

  private getDataConnection(peerId: string, joinRequest = false): DataConnection {
    return (
      (this.getPeerConnections(peerId).find((connection) => connection.type === ConnectionType.Data) as
        DataConnection | undefined) ?? this.peer.connect(peerId, { metadata: { soundetch: true, joinRequest } })
    )
  }

  private getOpenDataConnection(peerId: string): DataConnection | null {
    return (
      this.getPeerConnections(peerId).find(
        (connection): connection is DataConnection => connection.type === ConnectionType.Data && connection.open,
      ) ?? null
    )
  }

  private ensureMember(peerId: string, username: string = peerId): Member {
    const member = this.getMember(peerId)
    if (member) {
      if (member.username == member.peerId || !member.username) {
        member.username = username
      }
      return member
    }

    const newMember = {
      peerId: peerId,
      username: username,
      mediaStream: new MediaStream(),
      error: null,
      recordingActivity: { state: 'idle', countdownId: null } as RecordingActivity,
    }
    this.state.members.push(newMember)
    return newMember
  }

  private getOrCreateRemotePeerState(peerId: string): RemotePeerState {
    const existing = this.remotePeerStates.get(peerId)
    if (existing) {
      return existing
    }

    const remotePeerState = new RemotePeerState()
    this.remotePeerStates.set(peerId, remotePeerState)
    return remotePeerState
  }

  private removePeerState(peerId: string) {
    const departingHost = !this.state.isHost && peerId == this.state.roomId ? this.getMember(peerId) : null
    const remotePeerState = this.remotePeerStates.get(peerId)
    if (remotePeerState) {
      this.clearIceDisconnectedCleanupTimeout(remotePeerState)
      this.clearMeshConnectionTimeout(remotePeerState)
    }
    this.deleteMember(peerId)
    this.remotePeerStates.delete(peerId)
    if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == peerId) {
      this.state.screenShare = null
    }
    this.admittedPeers.delete(peerId)
    this.releaseHeldPeer(peerId)
    const joinRequestIndex = this.state.joinRequests.findIndex((joinRequest) => joinRequest.peerId == peerId)
    if (joinRequestIndex >= 0) {
      this.state.joinRequests.splice(joinRequestIndex, 1)
    }
    if (departingHost) {
      this.notifyMessageListeners({
        type: 'info',
        info: `The host, ${departingHost.username}, left the meeting. No one new can join.`,
      })
    }
  }

  private handleOpenedDataConnection(dataConnection: DataConnection) {
    if (this.openedDataConnections.has(dataConnection.connectionId)) {
      return
    }

    this.openedDataConnections.add(dataConnection.connectionId)
    const remotePeerState = this.getOrCreateRemotePeerState(dataConnection.peer)
    this.clearMeshConnectionTimeout(remotePeerState)
    // The direct connection works, so losing it later means the peer left, not that it cannot connect directly.
    remotePeerState.introducedByPeerId = null
    dataConnection.send({
      type: 'self',
      username: this.username,
      screenShareStreamId: LocalMediaStreams.localScreenMediaStream.id,
      recordingActivity: this.getCurrentRecordingActivityForMessage(),
    })
  }

  private handleClosedDataConnection(dataConnection: DataConnection) {
    const wasOpen = this.openedDataConnections.has(dataConnection.connectionId)
    this.openedDataConnections.delete(dataConnection.connectionId)
    if (this.getOpenDataConnection(dataConnection.peer)) {
      return
    }

    if (!wasOpen) {
      this.reportMeshConnectionFailedIfIntroduced(dataConnection.peer)
    }

    ;[...this.getPeerConnections(dataConnection.peer)].forEach((connection) => {
      if (connection.type === ConnectionType.Media) {
        ;(connection as MediaConnection).close()
      }
    })
    this.removePeerState(dataConnection.peer)
    if (this.state.waitingForHost && dataConnection.peer == this.state.roomId) {
      this.leaveWithError(wasOpen ? 'The host left before letting you in.' : HOST_UNREACHABLE_MESSAGE)
      return
    }
    this.notifyStateListeners()
  }

  /** Host only: introduces a newly admitted guest to every other member. */
  private shareKnownPeers(dataConnection: DataConnection) {
    for (const peerId of this.admittedPeers) {
      if (peerId != dataConnection.peer && this.getOpenDataConnection(peerId)) {
        dataConnection.send({ type: 'otherPeer', peer: peerId })
      }
    }
  }

  private addJoinRequest(dataConnection: DataConnection, username: string) {
    const peerId = dataConnection.peer
    if (this.state.joinRequests.some((joinRequest) => joinRequest.peerId == peerId)) {
      return
    }

    if (this.admittedPeers.size >= MAX_GUESTS) {
      this.rejectJoinRequest(dataConnection, MEETING_FULL_MESSAGE)
      this.notifyMessageListeners({ type: 'info', info: `${username} tried to join, but the meeting is full.` })
      return
    }

    this.state.joinRequests.push({ peerId, username })
    this.notifyMessageListeners({ type: 'info', info: `${username} is asking to join the meeting.` })
    this.notifyStateListeners()
  }

  private takeJoinRequest(peerId: string): DataConnection | null {
    const index = this.state.joinRequests.findIndex((joinRequest) => joinRequest.peerId == peerId)
    if (index < 0) {
      return null
    }

    this.state.joinRequests.splice(index, 1)
    return this.getOpenDataConnection(peerId)
  }

  private rejectJoinRequest(dataConnection: DataConnection, reason: string) {
    dataConnection.send({ type: 'joinRejected', reason })
    // Flushing delivers the rejection before the connection closes.
    dataConnection.close({ flush: true })
  }

  private rejectJoinRequestWhenOpen(dataConnection: DataConnection, reason: string) {
    if (dataConnection.open) {
      this.rejectJoinRequest(dataConnection, reason)
    } else {
      dataConnection.addListener('open', () => this.rejectJoinRequest(dataConnection, reason))
    }
  }

  private handleAdmitted(hostConnection: DataConnection) {
    if (!this.state.waitingForHost) {
      return
    }

    this.state.waitingForHost = false
    this.admitPeer(hostConnection.peer)
    // The host treated our first 'self' message as the join request, so announce ourselves again as a member.
    hostConnection.send({
      type: 'self',
      username: this.username,
      screenShareStreamId: LocalMediaStreams.localScreenMediaStream.id,
      recordingActivity: this.getCurrentRecordingActivityForMessage(),
    })
    this.notifyMessageListeners({
      type: 'info',
      info: `${this.state.hostUsername ?? 'The host'} let you into the meeting.`,
    })
    this.notifyStateListeners()
  }

  private admitPeer(peerId: string) {
    this.admittedPeers.add(peerId)
    const heldPeer = this.heldPeers.get(peerId)
    if (!heldPeer) {
      return
    }

    this.releaseHeldPeer(peerId)
    for (const { dataConnection, message } of heldPeer.messages) {
      this.handleDataMessage(dataConnection, message)
    }
  }

  private holdMessage(dataConnection: DataConnection, message: PeerMessage) {
    const peerId = dataConnection.peer
    let heldPeer = this.heldPeers.get(peerId)
    if (!heldPeer) {
      heldPeer = { messages: [], timeout: null }
      // The host vouches for a new member before introducing them, so a connection it never vouches for is dropped.
      // Waiting for the host's own decision has no time limit.
      if (peerId != this.state.roomId) {
        heldPeer.timeout = window.setTimeout(() => {
          this.heldPeers.delete(peerId)
          this.logger.log(`Closing connection from ${peerId}, which the host did not admit.`)
          ;[...this.getPeerConnections(peerId)].forEach((connection) => connection.close())
        }, this.meshConnectionTimeoutMs)
      }
      this.heldPeers.set(peerId, heldPeer)
    }
    heldPeer.messages.push({ dataConnection, message })
  }

  private releaseHeldPeer(peerId: string) {
    const heldPeer = this.heldPeers.get(peerId)
    if (heldPeer?.timeout != null) {
      window.clearTimeout(heldPeer.timeout)
    }
    this.heldPeers.delete(peerId)
  }

  private leaveWithError(reason: string) {
    if (this.destroyed) {
      return
    }

    this.state.error = reason
    this.notifyStateListeners()
    this.disconnect()
  }

  private clearMeshConnectionTimeout(remotePeerState: RemotePeerState) {
    if (remotePeerState.meshConnectionTimeout == null) {
      return
    }

    window.clearTimeout(remotePeerState.meshConnectionTimeout)
    remotePeerState.meshConnectionTimeout = null
  }

  private expectMeshConnection(remoteId: string, introducedByPeerId: string) {
    if (this.getOpenDataConnection(remoteId)) {
      return
    }

    const remotePeerState = this.getOrCreateRemotePeerState(remoteId)
    remotePeerState.introducedByPeerId = introducedByPeerId
    remotePeerState.meshFailureReported = false
    this.clearMeshConnectionTimeout(remotePeerState)
    remotePeerState.meshConnectionTimeout = window.setTimeout(() => {
      remotePeerState.meshConnectionTimeout = null
      if (this.getOpenDataConnection(remoteId)) {
        return
      }

      this.reportMeshConnectionFailedIfIntroduced(remoteId)
    }, this.meshConnectionTimeoutMs)
  }

  private reportMeshConnectionFailedIfIntroduced(remoteId: string) {
    const remotePeerState = this.remotePeerStates.get(remoteId)
    const introducedByPeerId = remotePeerState?.introducedByPeerId
    if (!remotePeerState || !introducedByPeerId || remotePeerState.meshFailureReported) {
      return
    }

    const introducerDataConnection = this.getOpenDataConnection(introducedByPeerId)
    if (!introducerDataConnection) {
      return
    }

    remotePeerState.meshFailureReported = true
    introducerDataConnection.send({ type: 'meshConnectionFailed', failedPeer: remoteId })
  }

  private clearIceDisconnectedCleanupTimeout(remotePeerState: RemotePeerState) {
    if (remotePeerState.iceDisconnectedCleanupTimeout == null) {
      return
    }

    window.clearTimeout(remotePeerState.iceDisconnectedCleanupTimeout)
    remotePeerState.iceDisconnectedCleanupTimeout = null
  }

  /**
   * A closed tab, crash, or lost network often leaves no close event behind: ICE just stays disconnected (Chrome
   * never moves on to 'failed', and the data channel stays 'open'). Remove the peer if any of its connections stays
   * interrupted for too long.
   */
  private scheduleIceDisconnectedCleanup(remoteId: string, remotePeerState: RemotePeerState) {
    if (remotePeerState.iceDisconnectedCleanupTimeout != null) {
      return
    }

    remotePeerState.iceDisconnectedCleanupTimeout = window.setTimeout(() => {
      remotePeerState.iceDisconnectedCleanupTimeout = null
      if (this.remotePeerStates.get(remoteId) != remotePeerState || remotePeerState.interruptedConnections.size == 0) {
        return
      }

      this.logger.log(`Removing ${remoteId} after its ${[...remotePeerState.interruptedConnections]} ICE stayed down`)
      this.reportMeshConnectionFailedIfIntroduced(remoteId)
      remotePeerState.rtcPeerConnection?.close()
      ;[...this.getPeerConnections(remoteId)].forEach((connection) => connection.close())
      this.removePeerState(remoteId)
      this.notifyStateListeners()
    }, ICE_DISCONNECTED_CLEANUP_TIMEOUT_MS)
  }

  private sendRecordingActivity(recordingActivity: RecordingActivity) {
    for (const peerId of this.admittedPeers) {
      this.getOpenDataConnection(peerId)?.send({ type: 'recordingActivity', activity: recordingActivity })
    }
  }

  private getCurrentRecordingActivityForMessage(): RecordingActivity {
    if (this.currentRecordingActivity.state != 'countdown') {
      return this.currentRecordingActivity
    }

    const elapsedMs =
      this.currentCountdownStartedAtMs == null ? 0 : performance.now() - this.currentCountdownStartedAtMs
    return {
      ...this.currentRecordingActivity,
      durationMs: Math.max(0, this.currentRecordingActivity.durationMs - elapsedMs),
    }
  }

  private async getRemoteRecordingActivity(peerId: string, recordingActivity: RecordingActivity) {
    if (recordingActivity.state != 'countdown') {
      return recordingActivity
    }

    const delayEstimate =
      (await this.getOrCreateRemotePeerState(peerId).peerNeworkDelayEstimator?.getExistingEstimate()) ?? 999999
    const delayEstimateIsUsable = delayEstimate >= 0 && delayEstimate != 999999
    return {
      ...recordingActivity,
      durationMs: Math.max(0, recordingActivity.durationMs - (delayEstimateIsUsable ? delayEstimate : 0)),
    }
  }

  private async setRemoteRecordingActivity(
    peerId: string,
    recordingActivity: RecordingActivity,
    notifyListeners: boolean = true,
  ) {
    this.ensureMember(peerId).recordingActivity = await this.getRemoteRecordingActivity(peerId, recordingActivity)
    if (notifyListeners) {
      this.notifyStateListeners()
    }
  }

  /** Host only: a newly admitted guest reported that it could not connect directly to another member. */
  private handleMeshConnectionFailed(reportingPeerId: string, failedPeerId: string) {
    if (!this.state.isHost) {
      return
    }

    const reportingPeerState = this.remotePeerStates.get(reportingPeerId)
    const failedPeerState = this.remotePeerStates.get(failedPeerId)
    if (!reportingPeerState || !failedPeerState) {
      return
    }

    const reportingPeerSequence = reportingPeerState.joinedSequence
    const failedPeerSequence = failedPeerState.joinedSequence
    if (reportingPeerSequence == null || failedPeerSequence == null) {
      return
    }

    const kickedPeerId = reportingPeerSequence > failedPeerSequence ? reportingPeerId : failedPeerId
    const otherPeerId = kickedPeerId == reportingPeerId ? failedPeerId : reportingPeerId
    const kickedUsername = this.getMember(kickedPeerId)?.username ?? kickedPeerId
    const otherUsername = this.getMember(otherPeerId)?.username ?? otherPeerId
    const notice = `${kickedUsername} was removed from the meeting because ${kickedUsername} could not connect directly to ${otherUsername}. Everyone in the meeting must be able to connect directly.`
    const kickedMessage = `You were removed from the meeting because your browser could not connect directly to ${otherUsername}. Everyone in the meeting must be able to connect directly.`

    this.notifyMessageListeners({ type: 'info', info: notice })
    for (const peerId of this.admittedPeers) {
      if (peerId != kickedPeerId) {
        this.getOpenDataConnection(peerId)?.send({ type: 'directConnectionFailed', notice })
      }
    }
    this.getOpenDataConnection(kickedPeerId)?.send({ type: 'kicked', reason: kickedMessage })
  }

  private async join(peerId: string, joinRequest = false) {
    if (peerId == this.peer.id || this.getOpenDataConnection(peerId)) {
      return
    }

    const connectToPeer = () => {
      const dataConnection = this.getDataConnection(peerId, joinRequest)
      this.setUpDataConnection(dataConnection)
      if (dataConnection.open) {
        this.handleOpenedDataConnection(dataConnection)
      }
    }

    if (this.peer.open) {
      connectToPeer()
      return
    }

    const onOpen = () => {
      this.peer.removeListener('open', onOpen)
      connectToPeer()
    }
    this.peer.addListener('open', onOpen)
  }

  private notifyMessageListeners(message: RemoteMediaClientMessage) {
    if (this.destroyed) {
      return
    }
    for (let i = 0; i < this.messageListeners.length; ++i) {
      this.messageListeners[i](message)
    }
  }

  private notifyStateListeners() {
    for (let i = 0; i < this.stateListeners.length; ++i) {
      this.stateListeners[i](this.state)
    }
  }

  private getMember(peerId: string): Member | null {
    for (let i = 0; i < this.state.members.length; ++i) {
      if (this.state.members[i].peerId === peerId) {
        return this.state.members[i]
      }
    }
    return null
  }

  private deleteMember(peerId: string) {
    for (let i = 0; i < this.state.members.length; ++i) {
      if (this.state.members[i].peerId === peerId) {
        this.state.members.splice(i, 1)
        break
      }
    }
  }

  private async handleDataMessage(self: DataConnection, data: unknown) {
    console.debug('received message', JSON.stringify(data))
    const peerMessage = data as PeerMessage
    if (peerMessage.type == 'timestamp') {
      // Handled by the PeerNetworkDelayEstimator's own listener.
      return
    }
    if (!this.admittedPeers.has(self.peer)) {
      this.handleMessageFromUnadmittedPeer(self, peerMessage)
      return
    }

    const fromHost = self.peer == this.state.roomId
    switch (peerMessage.type) {
      case 'self':
        this.ensureMember(self.peer, peerMessage.username)
        const remotePeerState = this.getOrCreateRemotePeerState(self.peer)
        remotePeerState.remoteScreenShareStreamId = peerMessage.screenShareStreamId
        if (remotePeerState.joinedSequence == null) {
          remotePeerState.joinedSequence = ++this.nextJoinedSequence
        }
        this.getAndMaybeAddPeerConnection(self.peer)
        if (peerMessage.recordingActivity) {
          await this.setRemoteRecordingActivity(self.peer, peerMessage.recordingActivity, false)
        }
        if (this.state.isHost) {
          this.shareKnownPeers(self)
        }

        const peerNeworkDelayEstimator = new PeerNetworkDelayEstimator(self)
        this.getOrCreateRemotePeerState(self.peer).peerNeworkDelayEstimator = peerNeworkDelayEstimator
        peerNeworkDelayEstimator.getNewEstimate().then((e) => console.debug(`your delay time is: ${e}`))
        this.notifyStateListeners()
        break
      case 'otherPeer':
        if (fromHost && peerMessage.peer != this.peer.id) {
          this.admitPeer(peerMessage.peer)
          if (!this.getOpenDataConnection(peerMessage.peer)) {
            this.expectMeshConnection(peerMessage.peer, self.peer)
            this.join(peerMessage.peer)
          }
        }
        break
      case 'peerAdmitted':
        if (fromHost && peerMessage.peer != this.peer.id) {
          this.admitPeer(peerMessage.peer)
        }
        break
      case 'meshConnectionFailed':
        this.handleMeshConnectionFailed(self.peer, peerMessage.failedPeer)
        break
      case 'directConnectionFailed':
        if (fromHost) {
          this.notifyMessageListeners({ type: 'info', info: peerMessage.notice })
        }
        break
      case 'kicked':
        if (fromHost) {
          this.leaveWithError(peerMessage.reason)
        }
        break
      case 'admitted':
      case 'joinRejected':
        // Only meaningful while waiting for the host.
        break
      case 'iceCandidate':
        await this.addOrQueueIceCandidate(self.peer, peerMessage.candidate)
        break
      case 'rtcSessionDescription':
        switch (peerMessage.desc.type) {
          case 'offer':
            await this.answerRemoteOffer(self.peer, new RTCSessionDescription(peerMessage.desc))
            break
          case 'answer':
            await this.acceptRemoteAnswer(self.peer, new RTCSessionDescription(peerMessage.desc))
            break
        }
        break
      case 'recordingActivity':
        await this.setRemoteRecordingActivity(self.peer, peerMessage.activity)
        break
      case 'chat':
        break
      default:
        this.logger.errorMessage('unrecognized message ' + JSON.stringify(peerMessage))
        break
    }
  }

  private handleMessageFromUnadmittedPeer(dataConnection: DataConnection, message: PeerMessage) {
    if (this.state.isHost) {
      // A guest's first 'self' message is its request to join. Nothing else from it is processed until the host
      // admits it, after which it announces itself again.
      if (message.type == 'self' && dataConnection.metadata?.joinRequest) {
        this.addJoinRequest(dataConnection, message.username)
      }
      return
    }

    if (dataConnection.peer == this.state.roomId) {
      switch (message.type) {
        case 'admitted':
          this.handleAdmitted(dataConnection)
          return
        case 'joinRejected':
          this.leaveWithError(message.reason)
          return
        case 'self':
          this.state.hostUsername = message.username
          this.notifyStateListeners()
          break
      }
    }
    this.holdMessage(dataConnection, message)
  }

  private updateConnectionInterruption(
    remoteId: string,
    connection: 'data' | 'media',
    iceConnectionState: RTCIceConnectionState,
  ) {
    const remotePeerState = this.remotePeerStates.get(remoteId)
    if (!remotePeerState) {
      return
    }

    const wasInterrupted = remotePeerState.interruptedConnections.size > 0
    switch (iceConnectionState) {
      case 'disconnected':
      case 'failed':
        remotePeerState.interruptedConnections.add(connection)
        break
      case 'connected':
      case 'completed':
        remotePeerState.interruptedConnections.delete(connection)
        break
      default:
        return
    }

    const isInterrupted = remotePeerState.interruptedConnections.size > 0
    if (isInterrupted == wasInterrupted) {
      return
    }

    if (isInterrupted) {
      this.scheduleIceDisconnectedCleanup(remoteId, remotePeerState)
    } else {
      this.clearIceDisconnectedCleanupTimeout(remotePeerState)
    }
    // A guest still waiting for the host has no tile, so only members get a notification.
    const member = this.getMember(remoteId)
    if (member) {
      this.notifyMessageListeners({
        type: 'info',
        info: `Connection to ${member.username} was ${isInterrupted ? 'interrupted' : 'restored'}.`,
      })
    }
  }

  private setUpDataConnection(dataConnection: DataConnection) {
    if (this.initializedDataConnections.has(dataConnection.connectionId)) {
      return
    }

    this.initializedDataConnections.add(dataConnection.connectionId)
    dataConnection.addListener('open', () => {
      this.handleOpenedDataConnection(dataConnection)
    })
    dataConnection.addListener('close', () => {
      this.handleClosedDataConnection(dataConnection)
    })
    dataConnection.addListener('data', (data) => this.handleDataMessage(dataConnection, data))
    dataConnection.addListener('iceStateChanged', (iceConnectionState) =>
      this.updateConnectionInterruption(dataConnection.peer, 'data', iceConnectionState),
    )
    dataConnection.addListener('error', (e) => {
      this.handleClosedDataConnection(dataConnection)
      this.logger.errorMessage(e.message)
    })

    if (dataConnection.open) {
      this.handleOpenedDataConnection(dataConnection)
    }
  }

  private async addOrQueueIceCandidate(remoteId: string, candidate: RTCIceCandidateInit) {
    const remotePeerState = this.getOrCreateRemotePeerState(remoteId)
    if (remotePeerState.ignoreOffer) {
      return
    }

    const rtcPeerConnection = this.getAndMaybeAddPeerConnection(remoteId)
    await remotePeerState.addOrQueueIceCandidate(candidate, rtcPeerConnection)
  }

  getAndMaybeAddPeerConnection(remoteId: string): RTCPeerConnection {
    const remotePeerState = this.getOrCreateRemotePeerState(remoteId)
    const existing = remotePeerState.rtcPeerConnection
    if (existing) {
      return existing
    }
    const newPeerConnection = new RTCPeerConnection(rtcConfig)
    newPeerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      this.logger.log('onicecandidate')
      if (event.candidate == null) {
        return
      }
      const iceCandidateMessage = {
        type: 'iceCandidate',
        candidate: event.candidate.toJSON(),
      }
      this.getDataConnection(remoteId).send(iceCandidateMessage)
    }
    newPeerConnection.ontrack = async (trackEvent) => {
      console.error('we are on track')
      const screenShareStreamId = remotePeerState.remoteScreenShareStreamId
      const screenShareStream = trackEvent.streams.find((stream) => stream.id === screenShareStreamId) ?? null
      const isScreenShare = screenShareStream != null
      const member = this.ensureMember(remoteId)
      let removed = false
      const removeTrack = () => {
        if (removed) {
          return
        }

        if (isScreenShare) {
          if (
            trackEvent.track.kind === 'video' &&
            this.state.screenShare != 'self' &&
            this.state.screenShare?.peerId == remoteId
          ) {
            this.state.screenShare = null
          }
        } else {
          member.mediaStream.removeTrack(trackEvent.track)
          member.mediaStream.dispatchEvent(new MediaStreamTrackEvent('removetrack', { track: trackEvent.track }))
        }

        removed = true
        this.notifyStateListeners()
      }

      if (isScreenShare && trackEvent.track.kind === 'video') {
        this.state.screenShare = {
          ...member,
          mediaStream: screenShareStream!,
        }
      } else if (!isScreenShare) {
        member.mediaStream.addTrack(trackEvent.track)
        member.mediaStream.dispatchEvent(new MediaStreamTrackEvent('addtrack', { track: trackEvent.track }))
      }
      trackEvent.track.onended = () => removeTrack()
      trackEvent.track.onmute = () => removeTrack()
      trackEvent.streams.forEach((stream) => {
        stream.addEventListener('removetrack', (event) => {
          if (event.track == trackEvent.track) {
            removeTrack()
          }
        })
      })

      this.notifyStateListeners()
    }

    newPeerConnection.oniceconnectionstatechange = () => {
      this.logger.log('New ice connecting state ' + newPeerConnection.iceConnectionState)
      this.updateConnectionInterruption(remoteId, 'media', newPeerConnection.iceConnectionState)
      switch (newPeerConnection.iceConnectionState) {
        case 'failed':
          newPeerConnection.restartIce()
          break
        case 'closed':
          remotePeerState.rtcPeerConnection = null
          break
      }
    }
    newPeerConnection.onicegatheringstatechange = () => {
      this.logger.log('New ice gathering state' + newPeerConnection.iceGatheringState)
    }
    newPeerConnection.onsignalingstatechange = (ev) => {
      this.logger.log('New signaling state' + newPeerConnection.signalingState)
      switch (newPeerConnection.signalingState) {
        case 'closed':
          remotePeerState.rtcPeerConnection = null
          break
      }
    }
    newPeerConnection.onicecandidateerror = (event: RTCPeerConnectionIceErrorEvent) => {
      this.logger.errorMessage('ice candidate error ' + event.errorCode + ' ' + event.errorText)
      console.error(newPeerConnection.iceConnectionState, newPeerConnection.iceGatheringState)
    }
    newPeerConnection.onnegotiationneeded = () => {
      this.negotiateRtc(newPeerConnection, remoteId).catch((error: unknown) => {
        this.logger.error(error instanceof Error ? error : new Error(String(error)))
      })
    }
    remotePeerState.rtcPeerConnection = newPeerConnection
    LocalMediaStreams.localAVDeviceMediaStream.getTracks().forEach((track) => {
      newPeerConnection.addTrack(track, LocalMediaStreams.localAVDeviceMediaStream)
    })
    LocalMediaStreams.localScreenMediaStream.getTracks().forEach((track) => {
      newPeerConnection.addTrack(track, LocalMediaStreams.localScreenMediaStream)
    })
    return newPeerConnection
  }

  async negotiateRtc(newPeerConnection: RTCPeerConnection, remoteId: string) {
    const remotePeerState = this.getOrCreateRemotePeerState(remoteId)
    await remotePeerState.enqueueRtcOperation(async () => {
      if (remotePeerState.rtcPeerConnection != newPeerConnection || newPeerConnection.signalingState !== 'stable') {
        return
      }

      this.logger.log('negotiateRtc ' + remoteId)
      const offer = await newPeerConnection.createOffer()
      await newPeerConnection.setLocalDescription(offer)
      this.getDataConnection(remoteId).send({
        type: 'rtcSessionDescription',
        desc: newPeerConnection.localDescription!.toJSON(),
      })
    })
  }

  async answerRemoteOffer(remoteId: string, sessionDescription: RTCSessionDescription) {
    const remotePeerState = this.getOrCreateRemotePeerState(remoteId)
    await remotePeerState.enqueueRtcOperation(async () => {
      const rtcPeerConnection = this.getAndMaybeAddPeerConnection(remoteId)
      const offerCollision = rtcPeerConnection.signalingState !== 'stable'
      remotePeerState.ignoreOffer = offerCollision && !this.isPolitePeer(remoteId)
      if (remotePeerState.ignoreOffer) {
        this.logger.log('Ignoring colliding offer from ' + remoteId)
        return
      }

      if (offerCollision) {
        if (rtcPeerConnection.signalingState !== 'have-local-offer') {
          this.logger.log('Ignoring offer from ' + remoteId + ' in state ' + rtcPeerConnection.signalingState)
          return
        }

        this.logger.log('Rolling back local offer for ' + remoteId)
        await rtcPeerConnection.setLocalDescription({ type: 'rollback' })
      }

      remotePeerState.ignoreOffer = false
      await rtcPeerConnection.setRemoteDescription(sessionDescription)
      await remotePeerState.flushPendingIceCandidates(rtcPeerConnection)
      await rtcPeerConnection.setLocalDescription(await rtcPeerConnection.createAnswer())
      const answer = {
        type: 'rtcSessionDescription',
        desc: rtcPeerConnection.localDescription!.toJSON(),
      }
      this.getDataConnection(remoteId).send(answer)
    })
  }

  private async acceptRemoteAnswer(remoteId: string, sessionDescription: RTCSessionDescription) {
    const remotePeerState = this.getOrCreateRemotePeerState(remoteId)
    await remotePeerState.enqueueRtcOperation(async () => {
      const rtcPeerConnection = this.getAndMaybeAddPeerConnection(remoteId)
      if (rtcPeerConnection.signalingState !== 'have-local-offer') {
        this.logger.log('Ignoring answer from ' + remoteId + ' in state ' + rtcPeerConnection.signalingState)
        return
      }

      remotePeerState.ignoreOffer = false
      await rtcPeerConnection.setRemoteDescription(sessionDescription)
      await remotePeerState.flushPendingIceCandidates(rtcPeerConnection)
    })
  }

  private isPolitePeer(remoteId: string) {
    return this.peer.id < remoteId
  }
}

const ICE_DISCONNECTED_CLEANUP_TIMEOUT_MS = 5000
const MESH_CONNECTION_TIMEOUT_MS = 10000
const MEETING_FULL_MESSAGE = `The meeting is full. A meeting can have up to ${MAX_GUESTS + 1} people.`
const HOST_UNREACHABLE_MESSAGE =
  'Could not reach the meeting host. The host may have left, or the invite link is wrong.'

const rtcConfig = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
        'stun:stun01.sipphone.com',
        'stun:stun.ekiga.net',
        'stun:stun.fwdnet.net',
        'stun:stun.ideasip.com',
        'stun:stun.iptel.org',
        'stun:stun.rixtelecom.se',
        'stun:stun.schlund.de',
        'stun:stunserver.org',
        'stun:stun.softjoys.com',
        'stun:stun.voiparound.com',
        'stun:stun.voipbuster.com',
        'stun:stun.voipstunt.com',
        'stun:stun.voxgratia.org',
        'stun:stun.xten.com',
      ],
    },
  ],
}
