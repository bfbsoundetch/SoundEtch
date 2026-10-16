import './FakesForRemoteTests'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import {
  blockFutureDataConnectionsWithPeer,
  isPeerOpen,
  resetRemoteTestFakes,
  setIceConnectionState,
} from './FakesForRemoteTests'
import type { JoinRequest, RecordingActivity, RemoteMediaClient3, State } from './RemoteMediaClient3'

type LocalMediaStreamsClass = typeof import('../mediastreams/LocalMediaStreams').LocalMediaStreams

type StateSnapshot = {
  roomId: string | null
  isHost: boolean
  hostUsername: string | null
  waitingForHost: boolean
  joinRequests: Array<JoinRequest>
  error: string | null
  members: Array<MemberSnapshot>
  screenShare: 'self' | { peerId: string; username: string; trackKinds: Array<string> } | null
}

type MemberSnapshot = {
  peerId: string
  username: string
  error: string | null
  trackKinds: Array<string>
  recordingActivity: RecordingActivity
}

type TestParticipant = {
  username: string
  client: RemoteMediaClient3
  localMedia: LocalMediaStreamsClass
  messages: Array<string>
  states: Array<StateSnapshot>
}

const participants = new Array<TestParticipant>()

beforeAll(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

beforeEach(() => {
  vi.useRealTimers()
  participants.length = 0
  resetRemoteTestFakes()
})

afterEach(() => {
  for (const participant of participants) {
    participant.localMedia.endAudioDeviceStream()
    participant.localMedia.endScreenShare()
  }
  for (const participant of [...participants].reverse()) {
    participant.client.disconnect()
  }
  resetRemoteTestFakes()
})

afterAll(async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  vi.restoreAllMocks()
})

test('the meeting creator hosts, and a guest waits for the host to admit them', async () => {
  const alice = await createParticipant('Alice')
  const bob = await createParticipant('Bob', alice.client.id)

  await waitForJoinRequest(alice, 'Bob')
  await waitFor(() => latest(bob).hostUsername === 'Alice', 'Bob to learn the host name')
  expect(latest(alice)).toMatchObject({ isHost: true, hostUsername: 'Alice', waitingForHost: false, members: [] })
  expect(latest(bob)).toMatchObject({ isHost: false, waitingForHost: true, roomId: alice.client.id, members: [] })
  expect(messagesAbout(alice, 'Bob')).toHaveLength(1)

  await admit(alice, 'Bob')
  await waitForMember(alice, 'Bob')
  await waitForMember(bob, 'Alice')

  expect(latest(alice).roomId).toBe(alice.client.id)
  expect(latest(alice).joinRequests).toEqual([])
  expect(latest(bob)).toMatchObject({ waitingForHost: false, hostUsername: 'Alice', roomId: alice.client.id })
  expect(memberUsernames(alice)).toEqual(['Bob'])
  expect(memberUsernames(bob)).toEqual(['Alice'])
  expect(messagesAbout(bob, 'Alice')).toHaveLength(1)
})

test('the host can turn a guest away', async () => {
  const alice = await createParticipant('Alice')
  const bob = await createParticipant('Bob', alice.client.id)

  const request = await waitForJoinRequest(alice, 'Bob')
  alice.client.deny(request.peerId)

  await waitFor(() => latest(bob).error != null, 'Bob to be turned away')
  expect(latest(alice).joinRequests).toEqual([])
  expect(latest(alice).members).toEqual([])
})

test('the host admits at most three guests', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')
  const cara = await joinAndAdmit(alice, 'Cara')
  const dan = await createParticipant('Dan', alice.client.id)
  const eve = await createParticipant('Eve', alice.client.id)
  await waitForJoinRequest(alice, 'Eve')

  // Admitting the third guest turns away everyone still waiting.
  await admit(alice, 'Dan')
  await waitFor(() => latest(eve).error != null, 'Eve to be turned away')
  expect(latest(alice).joinRequests).toEqual([])
  // One notice for the request, one for turning Eve away.
  expect(messagesAbout(alice, 'Eve')).toHaveLength(2)

  // Nobody else can ask to join a full meeting.
  const frank = await createParticipant('Frank', alice.client.id)
  await waitFor(() => latest(frank).error != null, 'Frank to be turned away')
  expect(messagesAbout(alice, 'Frank')).toHaveLength(1)
  expect(latest(alice).joinRequests).toEqual([])

  const everyone = [alice, bob, cara, dan]
  await waitFor(() => everyone.every((participant) => latest(participant).members.length === 3), 'four-user mesh')
  expect(memberUsernames(alice)).toEqual(['Bob', 'Cara', 'Dan'])
})

test('only the host can let guests in', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')
  const frank = await createParticipant('Frank', bob.client.id)

  await waitFor(() => latest(frank).error != null, 'Frank to be turned away by Bob')
  expect(latest(bob).joinRequests).toEqual([])
  expect(memberUsernames(bob)).toEqual(['Alice'])
})

test('a waiting guest is told when the host leaves before admitting them', async () => {
  const alice = await createParticipant('Alice')
  const bob = await createParticipant('Bob', alice.client.id)
  await waitForJoinRequest(alice, 'Bob')

  alice.client.disconnect()

  await waitFor(() => latest(bob).error != null, 'Bob to learn the host left')
})

test('the meeting continues after the host leaves and everyone is told', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')
  const cara = await joinAndAdmit(alice, 'Cara')
  await waitFor(() => [alice, bob, cara].every((participant) => latest(participant).members.length === 2), 'mesh')

  alice.client.disconnect()

  await waitFor(
    () => memberUsernames(bob).join() === 'Cara' && memberUsernames(cara).join() === 'Bob',
    'Bob and Cara to stay connected without Alice',
  )
  expect(messagesAbout(bob, 'Alice').length).toBeGreaterThan(1)
  expect(messagesAbout(cara, 'Alice').length).toBeGreaterThan(1)
})

test('enables, disables, and re-enables a microphone on the remote side', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')

  await alice.localMedia.startAudioDevice()
  await waitForMemberTracks(bob, 'Alice', ['audio'])
  expect(memberTrackKinds(alice, 'Bob')).toEqual([])

  alice.localMedia.endAudioDeviceStream()
  await waitForMemberTracks(bob, 'Alice', [])

  await alice.localMedia.startAudioDevice()
  await waitForMemberTracks(bob, 'Alice', ['audio'])
  expect(bob.states.some((state) => getMember(state, 'Alice')?.trackKinds.length === 0)).toBe(true)
  expect(bob.states.some((state) => getMember(state, 'Alice')?.trackKinds.includes('audio'))).toBe(true)
})

test('sends an already-enabled microphone to a user that joins later', async () => {
  const alice = await createParticipant('Alice')
  await alice.localMedia.startAudioDevice()

  const bob = await joinAndAdmit(alice, 'Bob')
  await waitForMemberTracks(bob, 'Alice', ['audio'])
  expect(memberTrackKinds(alice, 'Bob')).toEqual([])

  await bob.localMedia.startAudioDevice()
  await waitForMemberTracks(alice, 'Bob', ['audio'])
})

test('handles simultaneous microphone offers when both users join with microphones already enabled', async () => {
  const alice = await createParticipant('Alice', null, true)
  const bob = await joinAndAdmit(alice, 'Bob', true)

  await waitForMemberTracks(alice, 'Bob', ['audio'])
  await waitForMemberTracks(bob, 'Alice', ['audio'])
})

test('connects three users into a mesh and each user hears the other speakers', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')
  const cara = await joinAndAdmit(alice, 'Cara')
  const everyone = [alice, bob, cara]

  await waitFor(() => everyone.every((participant) => latest(participant).members.length === 2), 'three-user mesh')

  await alice.localMedia.startAudioDevice()
  await bob.localMedia.startAudioDevice()
  await cara.localMedia.startAudioDevice()

  await waitFor(
    () =>
      everyone.every((participant) =>
        latest(participant).members.every((member) => sameMembers(member.trackKinds, ['audio'])),
      ),
    'every remote member to have audio',
  )

  expect(memberUsernames(alice)).toEqual(['Bob', 'Cara'])
  expect(memberUsernames(bob)).toEqual(['Alice', 'Cara'])
  expect(memberUsernames(cara)).toEqual(['Alice', 'Bob'])
})

test('kicks the later peer when an introduced mesh connection cannot open and tells everyone', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')

  blockFutureDataConnectionsWithPeer(bob.client.id)
  const cara = await createParticipant('Cara', alice.client.id, false, 5)
  await admit(alice, 'Cara')

  await waitFor(() => latest(cara).error?.includes('removed from the meeting') === true, 'Cara to be kicked')
  await waitFor(() => !memberUsernames(alice).includes('Cara'), 'Alice to remove Cara')
  await waitFor(() => messagesAbout(bob, 'Cara').length > 0, 'Bob to be told about Cara')

  expect(memberUsernames(alice)).toEqual(['Bob'])
  expect(memberUsernames(bob)).toEqual(['Alice'])
  for (const participant of [alice, bob]) {
    expect(messagesAbout(participant, 'Cara').some((message) => message.includes('Bob'))).toBe(true)
  }
  expect(latest(cara).error).toContain('Bob')
})

test('notifies when a connection is interrupted and again once every part of it is restored', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')
  await waitFor(() => latest(bob).members.length === 1, 'Bob to see Alice')
  const noticesBefore = messagesAbout(alice, 'Bob').length

  setIceConnectionState(alice.client.id, bob.client.id, 'data', 'disconnected')
  setIceConnectionState(alice.client.id, bob.client.id, 'media', 'disconnected')
  await waitFor(() => messagesAbout(alice, 'Bob').length === noticesBefore + 1, 'interruption notice')

  setIceConnectionState(alice.client.id, bob.client.id, 'data', 'connected')
  await Promise.resolve()
  expect(messagesAbout(alice, 'Bob')).toHaveLength(noticesBefore + 1)

  setIceConnectionState(alice.client.id, bob.client.id, 'media', 'connected')
  await waitFor(() => messagesAbout(alice, 'Bob').length === noticesBefore + 2, 'restoration notice')

  const [interrupted, restored] = messagesAbout(alice, 'Bob').slice(noticesBefore)
  expect(interrupted).not.toEqual(restored)
  expect(memberUsernames(alice)).toEqual(['Bob'])
})

// A closed tab sends no close event: its connections just stay ICE-disconnected. Fake time stands in for the wait.
test('removes a member whose data connection stays down, even without media', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')

  vi.useFakeTimers()
  setIceConnectionState(alice.client.id, bob.client.id, 'data', 'disconnected')
  setIceConnectionState(alice.client.id, bob.client.id, 'media', 'disconnected')
  // Media recovering must not keep a member whose data connection is still down.
  setIceConnectionState(alice.client.id, bob.client.id, 'media', 'connected')
  await vi.advanceTimersByTimeAsync(60_000)
  vi.useRealTimers()

  await waitFor(() => memberUsernames(alice).length === 0, 'Alice to remove Bob')
})

test('keeps a member whose connection recovers quickly', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')

  vi.useFakeTimers()
  setIceConnectionState(alice.client.id, bob.client.id, 'data', 'disconnected')
  await vi.advanceTimersByTimeAsync(1_000)
  setIceConnectionState(alice.client.id, bob.client.id, 'data', 'connected')
  await vi.advanceTimersByTimeAsync(60_000)
  vi.useRealTimers()

  expect(memberUsernames(alice)).toEqual(['Bob'])
})

test('drops the join request of a waiting guest whose connection stays down', async () => {
  const alice = await createParticipant('Alice')
  const bob = await createParticipant('Bob', alice.client.id)
  await waitForJoinRequest(alice, 'Bob')

  vi.useFakeTimers()
  setIceConnectionState(alice.client.id, bob.client.id, 'data', 'disconnected')
  await vi.advanceTimersByTimeAsync(60_000)
  vi.useRealTimers()

  await waitFor(() => latest(alice).joinRequests.length === 0, 'Alice to drop Bob’s request')
})

test('losing a member that the host introduced does not get the newer guest removed', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')
  const cara = await joinAndAdmit(alice, 'Cara')
  await waitFor(() => [alice, bob, cara].every((participant) => latest(participant).members.length === 2), 'mesh')

  // Cara's connection to Bob, made at Alice's introduction, drops after having worked.
  vi.useFakeTimers()
  setIceConnectionState(cara.client.id, bob.client.id, 'data', 'disconnected')
  await vi.advanceTimersByTimeAsync(60_000)
  vi.useRealTimers()

  await waitFor(() => !memberUsernames(cara).includes('Bob'), 'Cara to remove Bob')
  expect(latest(cara).error).toBeNull()
  expect(memberUsernames(alice)).toEqual(['Bob', 'Cara'])
})

test('broadcasts recording activity changes and notifies remote listeners', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')

  const bobStateCount = bob.states.length
  alice.client.setRecordingActivity({ state: 'recording', countdownId: null })
  await waitFor(
    () => getMember(latest(bob), 'Alice')?.recordingActivity.state === 'recording',
    'Alice recording activity on Bob',
  )
  expect(bob.states.length).toBeGreaterThan(bobStateCount)

  const aliceStateCount = alice.states.length
  bob.client.setRecordingActivity({ state: 'countdown', countdownId: 7, durationMs: 5000 })
  await waitFor(
    () => getMember(latest(alice), 'Bob')?.recordingActivity.state === 'countdown',
    'Bob countdown activity on Alice',
  )

  const bobActivity = getMember(latest(alice), 'Bob')!.recordingActivity
  expect(bobActivity).toMatchObject({ state: 'countdown', countdownId: 7 })
  expect(bobActivity.state === 'countdown' ? bobActivity.durationMs : 0).toBeGreaterThan(0)
  expect(bobActivity.state === 'countdown' ? bobActivity.durationMs : Infinity).toBeLessThanOrEqual(5000)
  expect(alice.states.length).toBeGreaterThan(aliceStateCount)
})

test('removes disconnected peers from state and notifies remaining clients', async () => {
  const alice = await createParticipant('Alice')
  const bob = await joinAndAdmit(alice, 'Bob')
  const cara = await joinAndAdmit(alice, 'Cara')
  const everyone = [alice, bob, cara]

  await waitFor(() => everyone.every((participant) => latest(participant).members.length === 2), 'three-user mesh')

  const aliceStateCount = alice.states.length
  const caraStateCount = cara.states.length
  bob.client.disconnect()

  await waitFor(
    () => !memberUsernames(alice).includes('Bob') && !memberUsernames(cara).includes('Bob'),
    'Bob to be removed from remaining clients',
  )
  expect(alice.states.length).toBeGreaterThan(aliceStateCount)
  expect(cara.states.length).toBeGreaterThan(caraStateCount)
})

async function createParticipant(
  username: string,
  roomId: string | null = null,
  startMic = false,
  meshConnectionTimeoutMs = 10000,
) {
  const { LocalMediaStreams, RemoteMediaClient3 } = await importRemoteRuntime()
  if (startMic) {
    await LocalMediaStreams.startAudioDevice()
  }

  const client = new RemoteMediaClient3(username, roomId, false, meshConnectionTimeoutMs)
  const participant: TestParticipant = {
    client,
    localMedia: LocalMediaStreams,
    messages: [],
    states: [],
    username,
  }
  client.addStateListener((state) => participant.states.push(snapshotState(state)))
  client.addMessageListener((message) => participant.messages.push(message.info))
  participants.push(participant)
  // A guest can be turned away, and its peer destroyed, before the first poll sees it open.
  await waitFor(() => isPeerOpen(client.id) || latest(participant).error != null, `${username} peer to open`)
  return participant
}

async function importRemoteRuntime() {
  vi.resetModules()
  const remoteModule = await import('./RemoteMediaClient3')
  const localMediaModule = await import('../mediastreams/LocalMediaStreams')
  return {
    LocalMediaStreams: localMediaModule.LocalMediaStreams,
    RemoteMediaClient3: remoteModule.RemoteMediaClient3,
  }
}

function snapshotState(state: State): StateSnapshot {
  return {
    error: state.error,
    hostUsername: state.hostUsername,
    isHost: state.isHost,
    joinRequests: state.joinRequests.map((joinRequest) => ({ ...joinRequest })),
    members: state.members.map((member) => ({
      error: member.error,
      peerId: member.peerId,
      recordingActivity: { ...member.recordingActivity },
      trackKinds: member.mediaStream
        .getTracks()
        .map((track) => track.kind)
        .sort(),
      username: member.username,
    })),
    roomId: state.roomId,
    waitingForHost: state.waitingForHost,
    screenShare:
      state.screenShare === 'self'
        ? 'self'
        : state.screenShare
          ? {
              peerId: state.screenShare.peerId,
              trackKinds: state.screenShare.mediaStream
                .getTracks()
                .map((track) => track.kind)
                .sort(),
              username: state.screenShare.username,
            }
          : null,
  }
}

async function joinAndAdmit(host: TestParticipant, username: string, startMic = false) {
  const guest = await createParticipant(username, host.client.id, startMic)
  await admit(host, username)
  await waitForMember(host, username)
  await waitForMember(guest, host.username)
  return guest
}

async function admit(host: TestParticipant, username: string) {
  host.client.admit((await waitForJoinRequest(host, username)).peerId)
}

async function waitForJoinRequest(host: TestParticipant, username: string) {
  const findRequest = () => latest(host).joinRequests.find((joinRequest) => joinRequest.username === username)
  await waitFor(() => findRequest() != null, `${host.username} to see ${username} ask to join`)
  return findRequest()!
}

function messagesAbout(participant: TestParticipant, name: string) {
  return participant.messages.filter((message) => message.includes(name))
}

async function waitForMember(participant: TestParticipant, username: string) {
  await waitFor(() => getMember(latest(participant), username) != null, `${participant.username} to know ${username}`)
}

async function waitForMemberTracks(participant: TestParticipant, username: string, trackKinds: Array<string>) {
  await waitFor(
    () => sameMembers(getMember(latest(participant), username)?.trackKinds ?? [], trackKinds),
    `${participant.username} to see ${username} tracks ${trackKinds.join(',')}`,
  )
}

function latest(participant: TestParticipant) {
  return participant.states[participant.states.length - 1]
}

function getMember(state: StateSnapshot, username: string) {
  return state.members.find((member) => member.username === username)
}

function memberTrackKinds(participant: TestParticipant, username: string) {
  return getMember(latest(participant), username)?.trackKinds ?? []
}

function memberUsernames(participant: TestParticipant) {
  return latest(participant)
    .members.map((member) => member.username)
    .sort()
}

function sameMembers(actual: Array<string>, expected: Array<string>) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
}

async function waitFor(condition: () => boolean, description: string, timeoutMs = 1000) {
  const startTime = Date.now()
  while (!condition()) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}`)
    }
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
