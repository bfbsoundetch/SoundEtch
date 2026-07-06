import { vi } from 'vitest'

const remoteTestFakes = vi.hoisted(() => {
  type Listener = (...args: Array<any>) => void
  type TrackKind = 'audio' | 'video'
  type ConnectionContext = {
    localPeerId: string
    remotePeerId: string
  }

  const connectionType = {
    Data: 'data',
    Media: 'media',
  } as const

  let peerCounter = 0
  let connectionCounter = 0
  let streamCounter = 0
  let trackCounter = 0
  let activeConnectionContext: ConnectionContext | null = null
  const peers = new Map<string, FakePeer>()
  const rtcPeerConnections = new Map<string, FakeRTCPeerConnection>()
  const blockedFutureDataConnectionPeers = new Set<string>()

  class FakeEventEmitter {
    private readonly listeners = new Map<string, Array<Listener>>()

    addListener(eventName: string, listener: Listener) {
      const listeners = this.listeners.get(eventName) ?? []
      listeners.push(listener)
      this.listeners.set(eventName, listeners)
      return this
    }

    removeListener(eventName: string, listener: Listener) {
      const listeners = this.listeners.get(eventName)
      if (!listeners) {
        return this
      }

      const index = listeners.indexOf(listener)
      if (index >= 0) {
        listeners.splice(index, 1)
      }
      return this
    }

    protected emit(eventName: string, ...args: Array<any>) {
      const listeners = [...(this.listeners.get(eventName) ?? [])]
      for (const listener of listeners) {
        listener(...args)
      }
    }
  }

  class FakeMediaStreamTrack {
    readonly id: string
    readonly kind: TrackKind
    enabled = true
    muted = false
    readyState: MediaStreamTrackState = 'live'
    onended: ((this: MediaStreamTrack, ev: Event) => any) | null = null

    constructor(kind: TrackKind = 'audio', id: string | null = null) {
      this.kind = kind
      this.id = id ?? `track-${++trackCounter}`
    }

    stop() {
      this.readyState = 'ended'
    }

    clone() {
      return new FakeMediaStreamTrack(this.kind)
    }

    getCapabilities() {
      return {}
    }

    getConstraints() {
      return {}
    }

    getSettings() {
      return {}
    }

    addEventListener() {}

    removeEventListener() {}
  }

  class FakeMediaStream {
    readonly id: string
    private readonly tracks = new Array<MediaStreamTrack>()
    private readonly listeners = new Map<string, Array<Listener>>()

    constructor(tracks: Array<MediaStreamTrack> = [], id: string | null = null) {
      this.id = id ?? `stream-${++streamCounter}`
      tracks.forEach((track) => this.addTrack(track))
    }

    getTracks() {
      return [...this.tracks]
    }

    getAudioTracks() {
      return this.tracks.filter((track) => track.kind === 'audio')
    }

    getVideoTracks() {
      return this.tracks.filter((track) => track.kind === 'video')
    }

    addTrack(track: MediaStreamTrack) {
      if (this.tracks.includes(track)) {
        return
      }

      this.tracks.push(track)
      this.dispatchTrackEvent('addtrack', track)
    }

    removeTrack(track: MediaStreamTrack) {
      const index = this.tracks.indexOf(track)
      if (index < 0) {
        return
      }

      this.tracks.splice(index, 1)
      this.dispatchTrackEvent('removetrack', track)
    }

    addEventListener(eventName: string, listener: Listener) {
      const listeners = this.listeners.get(eventName) ?? []
      listeners.push(listener)
      this.listeners.set(eventName, listeners)
    }

    removeEventListener(eventName: string, listener: Listener) {
      const listeners = this.listeners.get(eventName)
      if (!listeners) {
        return
      }

      const index = listeners.indexOf(listener)
      if (index >= 0) {
        listeners.splice(index, 1)
      }
    }

    dispatchEvent(event: Event) {
      for (const listener of this.listeners.get(event.type) ?? []) {
        listener(event)
      }
      return true
    }

    private dispatchTrackEvent(eventName: string, track: MediaStreamTrack) {
      const event = { type: eventName, target: this, track }
      for (const listener of this.listeners.get(eventName) ?? []) {
        listener(event)
      }
    }
  }

  class FakeMediaStreamTrackEvent extends Event {
    readonly track: MediaStreamTrack

    constructor(type: string, eventInitDict: MediaStreamTrackEventInit) {
      super(type)
      this.track = eventInitDict.track
    }
  }

  class FakeRTCSessionDescription {
    readonly type: RTCSdpType
    readonly sdp: string

    constructor(description: RTCSessionDescriptionInit) {
      this.type = description.type
      this.sdp = description.sdp ?? ''
    }

    toJSON() {
      return {
        type: this.type,
        sdp: this.sdp,
      }
    }
  }

  class FakeRTCIceCandidate {
    constructor(private readonly candidate: RTCIceCandidateInit) {}

    toJSON() {
      return this.candidate
    }
  }

  class FakeDataConnection extends FakeEventEmitter {
    readonly type = connectionType.Data
    readonly connectionId = `connection-${++connectionCounter}`
    counterpart: FakeDataConnection | null = null
    open = false
    private closed = false

    constructor(
      readonly ownerPeerId: string,
      readonly peer: string,
      readonly metadata: any,
    ) {
      super()
    }

    send(data: unknown) {
      const counterpart = this.counterpart
      if (!counterpart || this.closed) {
        return
      }

      queueMicrotask(() => {
        counterpart.emitWithConnectionContext('data', data)
      })
    }

    close(notifyCounterpart = true) {
      if (this.closed) {
        return
      }

      this.closed = true
      this.open = false
      this.emitWithConnectionContext('close')
      if (notifyCounterpart) {
        this.counterpart?.close(false)
      }
    }

    openConnection() {
      if (this.closed || this.open) {
        return
      }

      this.open = true
      this.emitWithConnectionContext('open')
    }

    emitError(error: Error) {
      this.emitWithConnectionContext('error', error)
    }

    private emitWithConnectionContext(eventName: string, ...args: Array<any>) {
      const previousContext = activeConnectionContext
      activeConnectionContext = {
        localPeerId: this.ownerPeerId,
        remotePeerId: this.peer,
      }
      try {
        this.emit(eventName, ...args)
      } finally {
        activeConnectionContext = previousContext
      }
    }
  }

  class FakePeer extends FakeEventEmitter {
    readonly _connections = new Map<string, Array<FakeDataConnection>>()
    readonly id: string
    open = false
    private destroyed = false

    constructor(idOrOptions?: string | Record<string, unknown>) {
      super()
      const requestedId = typeof idOrOptions === 'string' ? idOrOptions : null
      this.id = getAvailablePeerId(requestedId)
      peers.set(this.id, this)
      queueMicrotask(() => {
        if (this.destroyed) {
          return
        }

        this.open = true
        this.emit('open', this.id)
      })
    }

    connect(peerId: string, options: { metadata?: any } = {}) {
      const localConnection = new FakeDataConnection(this.id, peerId, options.metadata)
      const remotePeer = peers.get(peerId)
      if (!remotePeer) {
        queueMicrotask(() => localConnection.emitError(new Error(`Peer ${peerId} is unavailable`)))
        return localConnection
      }

      if (blockedFutureDataConnectionPeers.has(this.id) || blockedFutureDataConnectionPeers.has(peerId)) {
        this.addConnection(peerId, localConnection)
        return localConnection
      }

      const remoteConnection = new FakeDataConnection(peerId, this.id, options.metadata)
      localConnection.counterpart = remoteConnection
      remoteConnection.counterpart = localConnection
      this.addConnection(peerId, localConnection)
      remotePeer.addConnection(this.id, remoteConnection)

      queueMicrotask(() => {
        remotePeer.emit('connection', remoteConnection)
        localConnection.openConnection()
        remoteConnection.openConnection()
      })
      return localConnection
    }

    destroy() {
      if (this.destroyed) {
        return
      }

      this.destroyed = true
      this.open = false
      const connections = [...this._connections.values()].flat()
      connections.forEach((connection) => connection.close())
      peers.delete(this.id)
      this.emit('close')
    }

    private addConnection(peerId: string, connection: FakeDataConnection) {
      const connections = this._connections.get(peerId) ?? []
      connections.push(connection)
      this._connections.set(peerId, connections)
    }
  }

  type FakeSender = RTCRtpSender & {
    track: MediaStreamTrack
    stream: MediaStream
  }

  type DeliveredTrack = {
    remoteTrack: MediaStreamTrack
    remoteStream: FakeMediaStream
  }

  class FakeRTCPeerConnection {
    localDescription: RTCSessionDescription | null = null
    remoteDescription: RTCSessionDescription | null = null
    signalingState: RTCSignalingState = 'stable'
    iceConnectionState: RTCIceConnectionState = 'new'
    iceGatheringState: RTCIceGatheringState = 'new'
    onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => any) | null = null
    oniceconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => any) | null = null
    onicegatheringstatechange: ((this: RTCPeerConnection, ev: Event) => any) | null = null
    onicecandidateerror: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceErrorEvent) => any) | null = null
    onnegotiationneeded: ((this: RTCPeerConnection, ev: Event) => any) | null = null
    onsignalingstatechange: ((this: RTCPeerConnection, ev: Event) => any) | null = null
    ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => any) | null = null
    private readonly localPeerId: string
    private readonly remotePeerId: string
    private readonly senders = new Array<FakeSender>()
    private readonly deliveredTracks = new Map<FakeSender, DeliveredTrack>()
    private negotiationQueued = false
    private closed = false

    constructor() {
      this.localPeerId = activeConnectionContext?.localPeerId ?? `unknown-${++peerCounter}`
      this.remotePeerId = activeConnectionContext?.remotePeerId ?? `unknown-${++peerCounter}`
      rtcPeerConnections.set(rtcKey(this.localPeerId, this.remotePeerId), this)
      this.updateIceConnectionState('connected')
      this.deliverTracksForPair()
    }

    addTrack(track: MediaStreamTrack, stream: MediaStream) {
      const sender = { track, stream } as FakeSender
      this.senders.push(sender)
      this.queueNegotiationNeeded()
      this.deliverTracksForPair()
      return sender
    }

    removeTrack(sender: RTCRtpSender) {
      const fakeSender = sender as FakeSender
      const index = this.senders.indexOf(fakeSender)
      if (index < 0) {
        return
      }

      this.senders.splice(index, 1)
      const deliveredTrack = this.deliveredTracks.get(fakeSender)
      if (deliveredTrack) {
        deliveredTrack.remoteStream.removeTrack(deliveredTrack.remoteTrack)
        this.deliveredTracks.delete(fakeSender)
      }
      this.queueNegotiationNeeded()
    }

    getSenders() {
      return [...this.senders]
    }

    async createOffer() {
      return new FakeRTCSessionDescription({ type: 'offer', sdp: `${this.localPeerId}->${this.remotePeerId}:offer` })
    }

    async createAnswer() {
      return new FakeRTCSessionDescription({ type: 'answer', sdp: `${this.localPeerId}->${this.remotePeerId}:answer` })
    }

    async setLocalDescription(description: RTCSessionDescriptionInit) {
      if (description.type === 'rollback') {
        if (this.signalingState !== 'have-local-offer') {
          throw this.invalidStateError('set local rollback')
        }

        this.localDescription = null
        this.updateSignalingState('stable')
        return
      }

      if (description.type === 'offer' && this.signalingState !== 'stable') {
        throw this.invalidStateError('set local offer')
      }

      if (description.type === 'answer' && this.signalingState !== 'have-remote-offer') {
        throw this.invalidStateError('set local answer')
      }

      this.localDescription = new FakeRTCSessionDescription(description) as RTCSessionDescription
      this.updateSignalingState(description.type === 'offer' ? 'have-local-offer' : 'stable')
      this.deliverTracksForPair()
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit) {
      if (description.type === 'offer' && this.signalingState !== 'stable') {
        throw this.invalidStateError('set remote offer')
      }

      if (description.type === 'answer' && this.signalingState !== 'have-local-offer') {
        throw this.invalidStateError('set remote answer')
      }

      this.remoteDescription = new FakeRTCSessionDescription(description) as RTCSessionDescription
      this.updateSignalingState(description.type === 'offer' ? 'have-remote-offer' : 'stable')
      this.deliverTracksForPair()
    }

    async addIceCandidate() {}

    restartIce() {}

    close() {
      if (this.closed) {
        return
      }

      this.closed = true
      for (const deliveredTrack of this.deliveredTracks.values()) {
        deliveredTrack.remoteStream.removeTrack(deliveredTrack.remoteTrack)
      }
      this.deliveredTracks.clear()
      rtcPeerConnections.delete(rtcKey(this.localPeerId, this.remotePeerId))
      this.updateIceConnectionState('closed')
      this.updateSignalingState('closed')
    }

    private queueNegotiationNeeded() {
      if (this.negotiationQueued || this.closed) {
        return
      }

      this.negotiationQueued = true
      queueMicrotask(() => {
        this.negotiationQueued = false
        if (!this.closed) {
          this.onnegotiationneeded?.call(this as unknown as RTCPeerConnection, new Event('negotiationneeded'))
        }
      })
    }

    private deliverTracksForPair() {
      if (this.closed) {
        return
      }

      const remotePeerConnection = rtcPeerConnections.get(rtcKey(this.remotePeerId, this.localPeerId))
      if (!remotePeerConnection || remotePeerConnection.closed || !remotePeerConnection.ontrack) {
        return
      }

      for (const sender of this.senders) {
        if (this.deliveredTracks.has(sender)) {
          continue
        }

        const remoteTrack = cloneTrackForRemote(sender.track, this.localPeerId, this.remotePeerId)
        const remoteStream = new FakeMediaStream([remoteTrack], sender.stream.id)
        this.deliveredTracks.set(sender, { remoteTrack, remoteStream })
        const trackEvent = {
          track: remoteTrack,
          streams: [remoteStream as unknown as MediaStream],
          receiver: { track: remoteTrack },
          transceiver: {},
        } as unknown as RTCTrackEvent
        remotePeerConnection.ontrack.call(remotePeerConnection as unknown as RTCPeerConnection, trackEvent)
      }
    }

    private updateIceConnectionState(state: RTCIceConnectionState) {
      this.iceConnectionState = state
      queueMicrotask(() => {
        this.oniceconnectionstatechange?.call(
          this as unknown as RTCPeerConnection,
          new Event('iceconnectionstatechange'),
        )
      })
    }

    private updateSignalingState(state: RTCSignalingState) {
      this.signalingState = state
      queueMicrotask(() => {
        this.onsignalingstatechange?.call(this as unknown as RTCPeerConnection, new Event('signalingstatechange'))
      })
    }

    private invalidStateError(action: string) {
      return new Error(`Failed to ${action}: Called in wrong state: ${this.signalingState}`)
    }
  }

  function getAvailablePeerId(requestedId: string | null) {
    const baseId = requestedId ?? `peer-${++peerCounter}`
    if (!peers.has(baseId)) {
      return baseId
    }

    let suffix = 2
    while (peers.has(`${baseId}-${suffix}`)) {
      suffix++
    }
    return `${baseId}-${suffix}`
  }

  function rtcKey(localPeerId: string, remotePeerId: string) {
    return `${localPeerId}->${remotePeerId}`
  }

  function cloneTrackForRemote(track: MediaStreamTrack, localPeerId: string, remotePeerId: string) {
    return new FakeMediaStreamTrack(
      track.kind as TrackKind,
      `${track.id}:${localPeerId}->${remotePeerId}`,
    ) as unknown as MediaStreamTrack
  }

  async function getUserMedia(constraints: MediaStreamConstraints) {
    const mediaStream = new FakeMediaStream()
    if (constraints.audio) {
      mediaStream.addTrack(new FakeMediaStreamTrack('audio') as unknown as MediaStreamTrack)
    }
    if (constraints.video) {
      mediaStream.addTrack(new FakeMediaStreamTrack('video') as unknown as MediaStreamTrack)
    }
    return mediaStream as unknown as MediaStream
  }

  async function getDisplayMedia(constraints: DisplayMediaStreamOptions = {}) {
    const mediaStream = new FakeMediaStream()
    if (constraints.video !== false) {
      mediaStream.addTrack(new FakeMediaStreamTrack('video') as unknown as MediaStreamTrack)
    }
    if (constraints.audio) {
      mediaStream.addTrack(new FakeMediaStreamTrack('audio') as unknown as MediaStreamTrack)
    }
    return mediaStream as unknown as MediaStream
  }

  function resetRemoteTestFakes() {
    const existingPeers = [...peers.values()]
    existingPeers.forEach((peer) => peer.destroy())
    peers.clear()
    rtcPeerConnections.clear()
    blockedFutureDataConnectionPeers.clear()
    activeConnectionContext = null
    peerCounter = 0
    connectionCounter = 0
    streamCounter = 0
    trackCounter = 0
  }

  function blockFutureDataConnectionsWithPeer(peerId: string) {
    blockedFutureDataConnectionPeers.add(peerId)
  }

  return {
    blockFutureDataConnectionsWithPeer,
    connectionType,
    FakeDataConnection,
    FakeMediaStream,
    FakeMediaStreamTrackEvent,
    FakeMediaStreamTrack,
    FakePeer,
    FakeRTCIceCandidate,
    FakeRTCPeerConnection,
    FakeRTCSessionDescription,
    getDisplayMedia,
    getUserMedia,
    resetRemoteTestFakes,
  }
})

vi.mock('peerjs', () => ({
  ConnectionType: remoteTestFakes.connectionType,
  DataConnection: remoteTestFakes.FakeDataConnection,
  LogLevel: { All: 4 },
  MediaConnection: class FakeMediaConnection {},
  Peer: remoteTestFakes.FakePeer,
  ServerMessageType: {
    Open: 'OPEN',
    Offer: 'OFFER',
  },
  util: {
    randomToken: () => 'testToken',
    supports: { data: true },
  },
}))

installGlobal('location', 'http://localhost/')
installGlobal('window', globalThis)
installGlobal('MediaStream', remoteTestFakes.FakeMediaStream)
installGlobal('MediaStreamTrack', remoteTestFakes.FakeMediaStreamTrack)
installGlobal('MediaStreamTrackEvent', remoteTestFakes.FakeMediaStreamTrackEvent)
installGlobal('RTCIceCandidate', remoteTestFakes.FakeRTCIceCandidate)
installGlobal('RTCPeerConnection', remoteTestFakes.FakeRTCPeerConnection)
installGlobal('RTCSessionDescription', remoteTestFakes.FakeRTCSessionDescription)
installGlobal('createMockServer', () => ({ close() {}, emit() {}, stop() {} }))
installGlobal('serverMessagePromise', Promise.resolve())
installGlobal('navigator', {
  mediaDevices: {
    getDisplayMedia: remoteTestFakes.getDisplayMedia,
    getSupportedConstraints: () => ({}),
    getUserMedia: remoteTestFakes.getUserMedia,
  },
})

function installGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  })
  Object.defineProperty(global, name, {
    configurable: true,
    value,
    writable: true,
  })
}

export const blockFutureDataConnectionsWithPeer = remoteTestFakes.blockFutureDataConnectionsWithPeer
export const resetRemoteTestFakes = remoteTestFakes.resetRemoteTestFakes
