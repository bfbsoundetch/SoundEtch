import { Logger } from '../global/Logger'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { Peer, DataConnection, MediaConnection, ConnectionType } from 'peerjs'
import { PeerNetworkDelayEstimator, TimestampMessage } from './PeerNetworkDelayEstimator'

export type PeerMessage =
  | {
      type: 'self'
      username: string
      screenShareStreamId: string
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
  | TimestampMessage

export interface Member {
  peerId: string
  username: string
  mediaStream: MediaStream
  error: string | null
}

export interface State {
  members: Array<Member>
  roomId: string | null
  screenShare: Member | 'self' | null
  error: string | null
}

export type StateListener = (state: State) => void

class RemotePeerState {
  private pendingIceCandidates = new Array<RTCIceCandidateInit>()
  rtcPeerConnection: RTCPeerConnection | null = null
  remoteScreenShareStreamId: string | null = null
  peerNeworkDelayEstimator: PeerNetworkDelayEstimator | null = null

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
  private readonly initializedDataConnections = new Set<string>()
  private readonly openedDataConnections = new Set<string>()
  private readonly logger = new Logger('RemoteMediaClient')

  constructor(
    private readonly username: string,
    roomName: string | null = null,
  ) {
    LocalMediaStreams.registerAVDeviceListener((added, track) => {
      if (added) {
        this.remotePeerStates.forEach((remotePeerState, key) => {
          remotePeerState.withRtcPeerConnection((value) => {
            console.error('add track to ', key)
            value.addTrack(track, LocalMediaStreams.localAVDeviceMediaStream)
          })
        })
      } else {
        this.remotePeerStates.forEach((remotePeerState) => {
          remotePeerState.withRtcPeerConnection((value) => {
            value.getSenders().forEach(sender => {
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
              LocalMediaStreams.localScreenMediaStream.getTracks().forEach(
                t => {
                  value.addTrack(t, LocalMediaStreams.localScreenMediaStream)
                }
              )
            })
          })
        }
      } else if (
        !added &&
        this.state.screenShare == 'self'
      ) {
        this.state.screenShare = null
        this.remotePeerStates.forEach((remotePeerState) => {
          remotePeerState.withRtcPeerConnection((value) => {
            value.getSenders().forEach(sender => {
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
    this.peer = new Peer({ config: rtcConfig })

    this.peer.addListener('open', () => {
      console.debug('opened')
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
          this.state.error = error.message
          this.notifyStateListeners()
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
    this.peer.destroy()
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
        | DataConnection
        | undefined) ?? this.peer.connect(peerId, { metadata: { soundetch: true } })
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
    this.deleteMember(peerId)
    this.remotePeerStates.delete(peerId)
    if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == peerId) {
      this.state.screenShare = null
    }
    AudioInputs.removeRemoteAudioSource(peerId, false)
    AudioInputs.removeRemoteAudioSource(peerId, true)
  }

  private handleOpenedDataConnection(dataConnection: DataConnection) {
    if (this.openedDataConnections.has(dataConnection.connectionId)) {
      return
    }

    this.openedDataConnections.add(dataConnection.connectionId)
    dataConnection.send({ 
      type: 'self', 
      username: this.username, 
      screenShareStreamId: LocalMediaStreams.localScreenMediaStream.id 
    })

    this.getAndMaybeAddPeerConnection(dataConnection.peer)
    const peerNeworkDelayEstimator = new PeerNetworkDelayEstimator(dataConnection)
    this.getOrCreateRemotePeerState(dataConnection.peer).peerNeworkDelayEstimator = 
      peerNeworkDelayEstimator
    peerNeworkDelayEstimator.getNewEstimate().then(e => console.error(`your delay time is: ${e}`))
  }

  private handleClosedDataConnection(dataConnection: DataConnection) {
    this.openedDataConnections.delete(dataConnection.connectionId)
    if (this.getOpenDataConnection(dataConnection.peer)) {
      return
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
        this.getOrCreateRemotePeerState(self.peer).remoteScreenShareStreamId = peerMessage.screenShareStreamId
        this.shareKnownPeers(self)
        this.notifyStateListeners()
        break
      case 'otherPeer':
        if (peerMessage.peer != this.peer.id && !this.getOpenDataConnection(peerMessage.peer)) {
          this.join(peerMessage.peer)
        }
        break
      case 'peerDisconnected':
        if (this.getOpenDataConnection(peerMessage.peer)) {
          self.send({ type: 'otherPeer', peer: peerMessage.peer })
        }
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
            await this.getAndMaybeAddPeerConnection(self.peer).setRemoteDescription(peerMessage.desc)
            await this.getOrCreateRemotePeerState(self.peer).flushPendingIceCandidates(
              this.getAndMaybeAddPeerConnection(self.peer)
            )
            break
        }
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
    const rtcPeerConnection = this.getAndMaybeAddPeerConnection(remoteId)
    await this.getOrCreateRemotePeerState(remoteId).addOrQueueIceCandidate(candidate, rtcPeerConnection)
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
        }

        removed = true

        if (trackEvent.track.kind === 'audio') {
          AudioInputs.removeRemoteAudioSource(remoteId, isScreenShare)
        }
        this.notifyStateListeners()
      }

      if (isScreenShare && trackEvent.track.kind === 'video') {
        this.state.screenShare = {
          ...member,
          mediaStream: screenShareStream!,
        }
      } else if (!isScreenShare) {
        member.mediaStream.addTrack(trackEvent.track)
      }

      if (trackEvent.track.kind === 'audio') {
        await AudioInputs.maybeAddRemoteAudioSource(remoteId, isScreenShare, trackEvent.track)
      }
      trackEvent.track.onended = () => removeTrack()
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
        case 'closed':
        case 'failed':
        case 'disconnected':
          remotePeerState.rtcPeerConnection = null
          this.getAndMaybeAddPeerConnection(remoteId)
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
          this.getAndMaybeAddPeerConnection(remoteId)
          break
      }
    }
    newPeerConnection.onicecandidateerror = (event: RTCPeerConnectionIceErrorEvent) => {
      this.logger.errorMessage('ice candidate error ' + event.errorCode + ' ' + event.errorText)
      console.error(newPeerConnection.iceConnectionState, newPeerConnection.iceGatheringState)
    }
    newPeerConnection.onnegotiationneeded = () => this.negotiateRtc(newPeerConnection, remoteId)
    remotePeerState.rtcPeerConnection = newPeerConnection
    LocalMediaStreams.localAVDeviceMediaStream.getTracks().forEach(track => {
      newPeerConnection.addTrack(track, LocalMediaStreams.localAVDeviceMediaStream)
    })
    LocalMediaStreams.localScreenMediaStream.getTracks().forEach(track => {
      newPeerConnection.addTrack(track, LocalMediaStreams.localScreenMediaStream)
    })
    return newPeerConnection
  }

  async negotiateRtc(newPeerConnection: RTCPeerConnection, remoteId: string) {
    this.logger.log('negotiateRtc ' + remoteId)
    const offer = await newPeerConnection.createOffer()
    // If the connection hasn't yet achieved the "stable" state,
    // return to the caller. Another negotiationneeded event
    // will be fired when the state stabilizes.
    if (newPeerConnection.signalingState !== 'stable') {
      return
    }
    await newPeerConnection.setLocalDescription(offer)
    this.getDataConnection(remoteId).send({
      type: 'rtcSessionDescription',
      desc: newPeerConnection.localDescription!.toJSON(),
    })
  }

  async answerRemoteOffer(remoteId: string, sessionDescription: RTCSessionDescription) {
    const rtcPeerConnection = this.getAndMaybeAddPeerConnection(remoteId)
    if (rtcPeerConnection.signalingState != 'stable') {
      // Set the local and remove descriptions for rollback; don't proceed
      // until both return.
      this.logger.errorMessage('Peer connection was not stable ' + rtcPeerConnection.signalingState)
      await rtcPeerConnection.setLocalDescription({ type: 'rollback' })
    }

    await rtcPeerConnection.setRemoteDescription(sessionDescription)
    await this.getOrCreateRemotePeerState(remoteId).flushPendingIceCandidates(rtcPeerConnection)
    await rtcPeerConnection.setLocalDescription(await rtcPeerConnection.createAnswer())
    const answer = {
      type: 'rtcSessionDescription',
      desc: rtcPeerConnection.localDescription!.toJSON(),
    }
    this.getDataConnection(remoteId)!.send(answer)
  }
}

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
