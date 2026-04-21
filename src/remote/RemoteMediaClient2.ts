import { Logger } from '../global/Logger'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { Peer, DataConnection, MediaConnection, ConnectionType } from 'peerjs'

type PeerMessage =
  | {
      type: 'self'
      username: string
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

export class RemoteMediaClient2 {
  private readonly peer: Peer
  private readonly state: State = { members: new Array<Member>(), roomId: null, screenShare: null, error: null }
  private readonly stateListeners = new Array<StateListener>()
  private readonly initializedDataConnections = new Set<string>()
  private readonly initializedMediaConnections = new Set<string>()
  private readonly openedDataConnections = new Set<string>()
  private readonly logger = new Logger('RemoteMediaClient')

  constructor(
    private readonly username: string,
    roomName: string | null = null,
  ) {
    LocalMediaStreams.registerAVDeviceListener((added, _) => {
      if (added) {
        this.connections.forEach((_, peerId) => {
          if (this.getOpenDataConnection(peerId)) {
            this.maybeStartMediaConnection(peerId, false)
          }
        })
      } else if (LocalMediaStreams.localAVDeviceMediaStream.getTracks().length == 0) {
        this.closeLocalMediaConnections(false)
      }
    })

    LocalMediaStreams.registerScreenListener((added, _) => {
      if (added && this.state.screenShare != 'self') {
        if (this.state.screenShare) {
          LocalMediaStreams.endScreenShare()
        } else {
          this.state.screenShare = 'self'
          this.connections.forEach((_, peerId) => {
            if (this.getOpenDataConnection(peerId)) {
              this.maybeStartMediaConnection(peerId, true)
            }
          })
        }
        this.notifyStateListeners()
      } else if (
        !added &&
        this.state.screenShare == 'self' &&
        LocalMediaStreams.localScreenMediaStream.getTracks().length == 0
      ) {
        this.state.screenShare = null
        this.closeLocalMediaConnections(true)
        this.notifyStateListeners()
      }
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

    this.peer.addListener('call', (mediaConnection) => {
      console.debug('received a call', JSON.stringify(mediaConnection.metadata))
      if (!mediaConnection.metadata.soundetch) {
        console.debug('call was not from SoundEtch, closing.')
        mediaConnection.close()
        return
      }
      mediaConnection.answer()
      this.setUpMediaConnection(mediaConnection)
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

  private getMediaConnections(peerId: string, isScreenShare: boolean): Array<MediaConnection> {
    return this.getPeerConnections(peerId).filter(
      (connection): connection is MediaConnection =>
        connection.type === ConnectionType.Media && !!connection.metadata?.isScreenShare === isScreenShare,
    )
  }

  private getOutgoingMediaConnection(peerId: string, isScreenShare: boolean): MediaConnection | null {
    return this.getMediaConnections(peerId, isScreenShare).find((connection) => !!connection.localStream) ?? null
  }

  private isScreenShareConnection(mediaConnection: MediaConnection, remoteStream?: MediaStream): boolean {
    if (mediaConnection.metadata?.isScreenShare !== undefined) {
      return !!mediaConnection.metadata.isScreenShare
    }

    return !!remoteStream?.getVideoTracks().find((track) => !!track.getCapabilities().displaySurface)
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

  private removePeerState(peerId: string) {
    this.deleteMember(peerId)
    if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == peerId) {
      this.state.screenShare = null
    }
    AudioInputs.removeRemoteAudioSource(peerId, false)
    AudioInputs.removeRemoteAudioSource(peerId, true)
  }

  private maybeStartMediaConnection(peerId: string, isScreenShare: boolean) {
    if (
      peerId == this.peer.id ||
      !this.getOpenDataConnection(peerId) ||
      this.getOutgoingMediaConnection(peerId, isScreenShare)
    ) {
      return
    }

    const localStream = isScreenShare
      ? LocalMediaStreams.localScreenMediaStream
      : LocalMediaStreams.localAVDeviceMediaStream

    if (localStream.getTracks().length == 0) {
      return
    }

    const mediaConnection = this.peer.call(peerId, localStream, {
      metadata: { isScreenShare: isScreenShare, soundetch: true },
    })
    if (mediaConnection) {
      this.setUpMediaConnection(mediaConnection)
    }
  }

  private closeLocalMediaConnections(isScreenShare: boolean) {
    this.connections.forEach((peerConnections) => {
      ;[...peerConnections].forEach((connection) => {
        if (connection.type !== ConnectionType.Media) {
          return
        }

        const mediaConnection = connection as MediaConnection
        if (!!mediaConnection.localStream && this.isScreenShareConnection(mediaConnection) == isScreenShare) {
          mediaConnection.close()
        }
      })
    })
  }

  private handleOpenedDataConnection(dataConnection: DataConnection) {
    if (this.openedDataConnections.has(dataConnection.connectionId)) {
      return
    }

    this.openedDataConnections.add(dataConnection.connectionId)
    dataConnection.send({ type: 'self', username: this.username })
    this.maybeStartMediaConnection(dataConnection.peer, false)
    this.maybeStartMediaConnection(dataConnection.peer, true)
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

  private handleDataMessage(self: DataConnection, data: unknown) {
    console.debug('received message', JSON.stringify(data))
    const peerMessage = data as PeerMessage
    switch (peerMessage.type) {
      case 'self':
        this.ensureMember(self.peer, peerMessage.username)
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
      case 'chat':
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
      this.logger.error(e.message)
    })

    if (dataConnection.open) {
      this.handleOpenedDataConnection(dataConnection)
    }
  }

  private setUpMediaConnection(mediaConnection: MediaConnection) {
    if (this.initializedMediaConnections.has(mediaConnection.connectionId)) {
      return
    }

    this.initializedMediaConnections.add(mediaConnection.connectionId)
    mediaConnection.addListener('stream', (remoteStream) => {
      console.debug('on stream')
      const isScreenShare = this.isScreenShareConnection(mediaConnection, remoteStream)
      const member = this.ensureMember(mediaConnection.peer)
      if (isScreenShare) {
        this.state.screenShare = member
      } else {
        member.mediaStream = remoteStream
      }

      if (remoteStream.getAudioTracks().length > 0) {
        AudioInputs.maybeAddRemoteAudioSource(mediaConnection.peer, isScreenShare, remoteStream.getAudioTracks()[0]!)
      }

      this.notifyStateListeners()
    })
    mediaConnection.addListener('close', () => {
      this.logger.log('Closed connection to "' + mediaConnection.peer + '"')
      const isScreenShare = this.isScreenShareConnection(mediaConnection)
      AudioInputs.removeRemoteAudioSource(mediaConnection.peer, isScreenShare)
      if (isScreenShare) {
        if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == mediaConnection.peer) {
          this.state.screenShare = null
        }
      } else {
        const member = this.getMember(mediaConnection.peer)
        if (member) {
          member.mediaStream = new MediaStream()
        }
      }
      this.notifyStateListeners()
    })
    mediaConnection.addListener('error', (error) => {
      this.logger.error('Lost connection to "' + mediaConnection.peer + '" due to: ' + error.message)
      const isScreenShare = this.isScreenShareConnection(mediaConnection)
      AudioInputs.removeRemoteAudioSource(mediaConnection.peer, isScreenShare)
      if (isScreenShare) {
        if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == mediaConnection.peer) {
          this.state.screenShare = null
        }
      } else {
        const member = this.getMember(mediaConnection.peer)
        if (member) {
          member.mediaStream = new MediaStream()
        }
      }
      this.notifyStateListeners()
    })
    console.debug('done setting up MediaConnection to', mediaConnection.peer)
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
