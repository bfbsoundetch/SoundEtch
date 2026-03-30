import { Logger } from '../global/Logger'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { Peer, DataConnection, MediaConnection, PeerOptions, ConnectionType } from 'peerjs'

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
  roomName: string | null
  screenShare: Member | 'self' | null
  error: string | null
}

export type StateListener = (state: State) => {}

export class RemoteMediaClient2 {
  private readonly peer: Peer
  private readonly state: State = { members: new Array<Member>(), roomName: null, screenShare: null, error: null }
  private readonly stateListeners = new Array<StateListener>()
  private readonly logger = new Logger('RemoteMediaClient')

  constructor(
    private readonly username: string,
    roomName: string | null = null,
  ) {
    LocalMediaStreams.registerScreenListener((added, _) => {
      if (added && this.state.screenShare != 'self') {
        if (this.state.screenShare) {
          LocalMediaStreams.endScreenShare()
        } else {
          this.state.screenShare = 'self'
          this.connections.forEach((peerConnections) => {
            peerConnections.forEach(connection => {
              if (connection.type == ConnectionType.Media) {
                (connection as MediaConnection).addStream(LocalMediaStreams.localScreenMediaStream)
              }
            })
          })
        }
        this.notifyStateListeners()
      } else if (!added && this.state.screenShare == 'self') {
        this.state.screenShare = null
        this.notifyStateListeners()
      }
    })
    this.state.roomName = roomName
    this.peer = new Peer({ config: rtcConfig })

    this.peer.on('open', () => {
      if (!this.state.roomName) {
        this.state.roomName = this.peer.id
        this.notifyStateListeners()
      }
    })
    this.peer.on('error', (error) => {
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
    this.peer.on('connection', (dataConnection) => {
      if (!dataConnection.metadata.soundetch) {
        dataConnection.close()
        return
      }
      dataConnection.on('data', (data) => this.handleDataMessage(dataConnection, data))
      dataConnection.on('error', () => {
        if (this.connections.get(dataConnection.peer)?.find((c) => c.type === ConnectionType.Media)) {
          this.peer.connect(dataConnection.peer, { metadata: { soundetch: true } })
        }
      })
    })
    this.peer.on('call', (mediaConnection) => {
      if (!mediaConnection.metadata.soundetch) {
        mediaConnection.close()
        return
      }
      mediaConnection.answer(LocalMediaStreams.localAVDeviceMediaStream, {})
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
    return (this.peer as any)._connections
  }

  private getDataConnection(peerId: string): DataConnection {
    return (
      (this.connections.get(peerId)?.find((c) => c.type === ConnectionType.Data) as DataConnection | undefined) ??
      this.peer.connect(peerId, { metadata: { soundetch: true } })
    )
  }

  private getMediaConnection(peerId: string): MediaConnection | undefined {
    return this.connections
      .get(peerId)
      ?.find((c) => c.type === ConnectionType.Media) as
      | MediaConnection
      | undefined
  }

  joinRoom(roomName: string) {
    this.join(roomName)
  }

  disconnect() {
    this.peer.destroy()
  }

  addStateListener(listener: StateListener) {
    this.stateListeners.push(listener)
    listener(this.state)
  }

  async amInRoom() {
    return !!this.state.roomName && !this.state.error
  }

  private join(peer: string) {
    const mediaConnection = this.peer.call(peer, LocalMediaStreams.localAVDeviceMediaStream, {
      metadata: { isScreenShare: false, username: this.username, soundetch: true },
    })
    mediaConnection.on('stream', () => {
      this.peer.connect(peer, { metadata: { soundetch: true } })
    })
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
    const peerMessage = data as PeerMessage
    switch (peerMessage.type) {
      case 'self':
        this.getMember(self.peer)!.username = peerMessage.username
        this.notifyStateListeners()
        break
      case 'otherPeer':
        if (!this.connections.has(peerMessage.peer)) {
          this.join(peerMessage.peer)
        }
        break
      case 'peerDisconnected':
        if (this.connections.get(peerMessage.peer)?.find((c) => c?.open)) {
          // Two peers disconnected from each other, try to reconnect them.
          self.send({ type: 'otherPeer', peer: peerMessage.peer })
        }
        break
      case 'chat':
        break
    }
  }

  private setUpMediaConnection(mediaConnection: MediaConnection) {
    mediaConnection.on('stream', (remoteStream) => {
      const isScreenShare = !!remoteStream.getVideoTracks().find(track => !!track.getCapabilities().displaySurface)
      if (isScreenShare) {
        this.state.screenShare = this.getMember(mediaConnection.peer)
      } else {
        this.state.members.push({
          peerId: mediaConnection.peer,
          username: mediaConnection.metadata.username,
          mediaStream: remoteStream,
          error: null,
        })
      }
      AudioInputs.maybeAddRemoteAudioSource(
        mediaConnection.peer,
        isScreenShare,
        remoteStream.getAudioTracks()[0]!,
      )
      this.notifyStateListeners()
      this.connections.keys().forEach((key) => {
        if (key != mediaConnection.peer) {
          this.getDataConnection(mediaConnection.peer).send({
            type: 'otherPeer',
            peer: key,
          })
        }
      })
    })
    mediaConnection.on('close', () => {
      this.logger.log('Closed connection to "' + mediaConnection.peer + '"')
      this.deleteMember(mediaConnection.peer)
      if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == mediaConnection.peer) {
        this.state.screenShare = null
        AudioInputs.removeRemoteAudioSource(mediaConnection.peer, true)
      }
      this.notifyStateListeners()
      AudioInputs.removeRemoteAudioSource(mediaConnection.peer, false)
    })
    mediaConnection.on('error', (error) => {
      this.logger.error('Lost connection to "' + mediaConnection.peer + '" due to: ' + error.message)
      this.deleteMember(mediaConnection.peer)
      if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == mediaConnection.peer) {
        AudioInputs.removeRemoteAudioSource(mediaConnection.peer, true)
        this.state.screenShare = null
      }
      this.notifyStateListeners()
      AudioInputs.removeRemoteAudioSource(mediaConnection.peer, false)

      this.connections.keys().forEach((key) => {
        if (key != mediaConnection.peer) {
          this.getDataConnection(key).send({ type: 'peerDisconnected', peer: key })
        }
      })
    })
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
