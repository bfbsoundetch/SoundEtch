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
      type: 'otherPeer'
      peer: string
    }
  | {
      type: 'peerDisconnected'
      peer: string
    }
  | {
      type: 'meshConnectionFailed'
      failedPeer: string
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

export interface State {
  members: Array<Member>
  roomId: string | null
  screenShare: Member | 'self' | null
  error: string | null
}

export type RemoteMediaClientMessage = {
  type: 'info'
  info: string
}

export type StateListener = (state: State) => void
export type MessageListener = (message: RemoteMediaClientMessage) => void

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
  private readonly state: State = { members: new Array<Member>(), roomId: null, screenShare: null, error: null }
  private readonly stateListeners = new Array<StateListener>()
  private readonly messageListeners = new Array<MessageListener>()
  private readonly initializedDataConnections = new Set<string>()
  private readonly openedDataConnections = new Set<string>()
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

    this.state.roomId = roomName
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
          if (this.connections.size > 0) {
            this.notifyMessageListeners({
              type: 'info',
              info: 'Disconnected from server, but the meeting is still active.',
            })
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
      this.setUpDataConnection(dataConnection)
    })

    if (roomName) {
      this.joinRoom(roomName)
    }
  }

  get id(): string {
    return this.peer.id
  }

  get connections(): Map<string, Array<DataConnection | MediaConnection>> {
    return (this.peer as any)?._connections ?? new Map()
  }

  joinRoom(roomId: string) {
    this.join(roomId)
  }

  disconnect() {
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

  private getDataConnection(peerId: string): DataConnection {
    return (
      (this.getPeerConnections(peerId).find((connection) => connection.type === ConnectionType.Data) as
        DataConnection | undefined) ?? this.peer.connect(peerId, { metadata: { soundetch: true } })
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
  }

  private handleOpenedDataConnection(dataConnection: DataConnection) {
    if (this.openedDataConnections.has(dataConnection.connectionId)) {
      return
    }

    this.openedDataConnections.add(dataConnection.connectionId)
    this.clearMeshConnectionTimeout(this.getOrCreateRemotePeerState(dataConnection.peer))
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
    this.notifyStateListeners()
  }

  private shareKnownPeers(dataConnection: DataConnection) {
    for (const peerId of this.connections.keys()) {
      if (peerId != dataConnection.peer && this.getOpenDataConnection(peerId)) {
        dataConnection.send({ type: 'otherPeer', peer: peerId })
      }
    }
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

  private scheduleIceDisconnectedCleanup(
    remoteId: string,
    remotePeerState: RemotePeerState,
    rtcPeerConnection: RTCPeerConnection,
  ) {
    if (remotePeerState.iceDisconnectedCleanupTimeout != null) {
      return
    }

    remotePeerState.iceDisconnectedCleanupTimeout = window.setTimeout(() => {
      remotePeerState.iceDisconnectedCleanupTimeout = null
      if (remotePeerState.rtcPeerConnection != rtcPeerConnection) {
        return
      }

      switch (rtcPeerConnection.iceConnectionState) {
        case 'connected':
        case 'completed':
        case 'closed':
          return
      }

      this.logger.log(`Removing ${remoteId} after ICE ${rtcPeerConnection.iceConnectionState}`)
      this.reportMeshConnectionFailedIfIntroduced(remoteId)
      rtcPeerConnection.close()
      ;[...this.getPeerConnections(remoteId)].forEach((connection) => connection.close())
      this.removePeerState(remoteId)
      this.notifyStateListeners()
    }, ICE_DISCONNECTED_CLEANUP_TIMEOUT_MS)
  }

  private sendRecordingActivity(recordingActivity: RecordingActivity) {
    for (const peerId of this.connections.keys()) {
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

  private handleMeshConnectionFailed(reportingPeerId: string, failedPeerId: string) {
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
    const middleMessage = `Removed ${kickedUsername} from the meeting because ${kickedUsername} could not connect directly to ${otherUsername}. Everyone in the meeting must be able to connect directly.`
    const kickedMessage = `You were removed from the meeting because your browser could not connect directly to ${otherUsername}. Everyone in the meeting must be able to connect directly.`

    this.notifyMessageListeners({ type: 'info', info: middleMessage })
    this.getOpenDataConnection(kickedPeerId)?.send({ type: 'kicked', reason: kickedMessage })
  }

  private handleKicked(reason: string) {
    this.state.error = reason
    this.notifyStateListeners()
    this.disconnect()
  }

  private async join(peerId: string) {
    if (peerId == this.peer.id || this.getOpenDataConnection(peerId)) {
      return
    }

    const connectToPeer = () => {
      const dataConnection = this.getDataConnection(peerId)
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
        this.shareKnownPeers(self)

        const peerNeworkDelayEstimator = new PeerNetworkDelayEstimator(self)
        this.getOrCreateRemotePeerState(self.peer).peerNeworkDelayEstimator = peerNeworkDelayEstimator
        peerNeworkDelayEstimator.getNewEstimate().then((e) => console.debug(`your delay time is: ${e}`))
        this.notifyStateListeners()
        break
      case 'otherPeer':
        if (peerMessage.peer != this.peer.id && !this.getOpenDataConnection(peerMessage.peer)) {
          this.expectMeshConnection(peerMessage.peer, self.peer)
          this.join(peerMessage.peer)
        }
        break
      case 'peerDisconnected':
        if (this.getOpenDataConnection(peerMessage.peer)) {
          self.send({ type: 'otherPeer', peer: peerMessage.peer })
        }
        break
      case 'meshConnectionFailed':
        this.handleMeshConnectionFailed(self.peer, peerMessage.failedPeer)
        break
      case 'kicked':
        this.handleKicked(peerMessage.reason)
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
      case 'timestamp':
        break
      default:
        this.logger.errorMessage('unrecognized message ' + JSON.stringify(peerMessage))
        break
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
      switch (newPeerConnection.iceConnectionState) {
        case 'connected':
        case 'completed':
          this.clearIceDisconnectedCleanupTimeout(remotePeerState)
          break
        case 'disconnected':
          this.scheduleIceDisconnectedCleanup(remoteId, remotePeerState, newPeerConnection)
          break
        case 'failed':
          newPeerConnection.restartIce()
          this.scheduleIceDisconnectedCleanup(remoteId, remotePeerState, newPeerConnection)
          break
        case 'closed':
          this.clearIceDisconnectedCleanupTimeout(remotePeerState)
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
