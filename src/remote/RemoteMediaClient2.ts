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
  isScreenShare: boolean
  isSelf: boolean
}

export interface State {
  members: Array<Member>
  amInRoom: boolean
}

export type StateListener = (state: State) => {}

export class RemoteMediaClient2 {
  private readonly peer: Peer
  private readonly state: State = { members: new Array<Member>(), amInRoom: false }
  private readonly stateListeners = new Array<StateListener>()
  private readonly roomNamePromise = Promise.withResolvers<string>()

  constructor(
    private readonly username: string,
    roomName: string | null = null,
  ) {
    if (roomName) {
      this.roomNamePromise.resolve(roomName)
    }

    LocalMediaStreams.localAVDeviceMediaStream.addEventListener('addtrack', (trackEvent: MediaStreamTrackEvent) => {
      console.log('new track!!')
      this.notifyStateListeners()
    })
    LocalMediaStreams.localScreenMediaStream.addEventListener('addtrack', (trackEvent: MediaStreamTrackEvent) => {
      console.log('new track!!')
      this.notifyStateListeners()
    })
    LocalMediaStreams.localAVDeviceMediaStream.addEventListener('removetrack', (trackEvent) => {
      console.error('no more track!!')
      this.notifyStateListeners()
    })
    LocalMediaStreams.localScreenMediaStream.addEventListener('removetrack', (trackEvent) => {
      this.notifyStateListeners()
    })
    console.error('here')

    this.peer = new Peer({ config: rtcConfig })

    LocalMediaStreams.registerScreenListener((added, mediaStreamTrack) => {
      if (added) {
        this.state.members.push({
          peerId: this.peer.id,
          username: this.username,
          mediaStream: LocalMediaStreams.localScreenMediaStream,
          isScreenShare: true,
          isSelf: true,
        })
      } else {
        this.deleteMember(this.peer.id, true)
      }
      this.notifyStateListeners()
    })
    this.state.members.push({
      peerId: this.peer.id,
      username: this.username,
      mediaStream: LocalMediaStreams.localAVDeviceMediaStream,
      isScreenShare: false,
      isSelf: true,
    })
    this.notifyStateListeners()

    this.peer.on('open', () => {
      this.roomNamePromise.resolve(this.peer.id) // might be set already
      this.state.members.forEach((member) => (member.peerId = member.peerId ?? this.peer.id))
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
      mediaConnection.on('stream', (remoteStream) => {
        AudioInputs.maybeAddRemoteAudioSource(
          mediaConnection.peer,
          mediaConnection.metadata.isScreenShare,
          remoteStream.getAudioTracks()[0]!,
        )
        this.state.members.push({
          peerId: mediaConnection.peer,
          username: mediaConnection.metadata.username,
          mediaStream: remoteStream,
          isScreenShare: mediaConnection.metadata.isScreenShare,
          isSelf: false,
        })
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
        this.deleteMember(mediaConnection.peer, mediaConnection.metadata.isScreenShare)
        this.notifyStateListeners()
        AudioInputs.removeRemoteAudioSource(mediaConnection.peer, mediaConnection.metadata.isScreenShare)
      })
      mediaConnection.on('error', () => {
        this.deleteMember(mediaConnection.peer, mediaConnection.metadata.isScreenShare)
        this.notifyStateListeners()
        AudioInputs.removeRemoteAudioSource(mediaConnection.peer, mediaConnection.metadata.isScreenShare)

        this.connections.keys().forEach((key) => {
          if (key != mediaConnection.peer) {
            this.getDataConnection(key).send({ type: 'peerDisconnected', peer: key })
          }
        })
      })
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

  private getMediaConnection(peerId: string, isScreenShare: boolean): MediaConnection | undefined {
    return this.connections
      .get(peerId)
      ?.find((c) => c.type === ConnectionType.Media && c.metadata.isScreenShare === isScreenShare) as
      | MediaConnection
      | undefined
  }

  createRoom() {}

  joinRoom(roomName: string) {
    this.join(roomName)
  }

  disconnect() {
    this.peer.destroy()
  }

  getRoomName(): Promise<string> {
    return this.roomNamePromise.promise
  }

  addStateListener(listener: StateListener) {
    this.stateListeners.push(listener)
    listener(this.state)
  }

  async amInRoom() {
    return (
      this.peer.id == (await this.roomNamePromise.promise) || this.connections.has(await this.roomNamePromise.promise)
    )
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

  private getMember(peerId: string, isScreenShare: boolean): Member | null {
    for (let i = 0; i < this.state.members.length; ++i) {
      if (this.state.members[i].isScreenShare === isScreenShare && this.state.members[i].peerId === peerId) {
        return this.state.members[i]
      }
    }
    return null
  }

  private deleteMember(peerId: string, isScreenShare: boolean) {
    for (let i = 0; i < this.state.members.length; ++i) {
      if (this.state.members[i].isScreenShare === isScreenShare && this.state.members[i].peerId === peerId) {
        this.state.members.splice(i, 1)
        break
      }
    }
  }

  private handleDataMessage(self: DataConnection, data: unknown) {
    const peerMessage = data as PeerMessage
    switch (peerMessage.type) {
      case 'self':
        this.getMember(self.peer, false)!.username = peerMessage.username
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
