import './FakesForRemoteTests'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { resetRemoteTestFakes } from './FakesForRemoteTests'
import type { RecordingActivity, RemoteMediaClient3, State } from './RemoteMediaClient3'

type LocalMediaStreamsClass = typeof import('../mediastreams/LocalMediaStreams').LocalMediaStreams

type StateSnapshot = {
  roomId: string | null
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

test('connects peers and notifies state listeners with remote usernames', async () => {
  const alice = await createParticipant('Alice')
  const bob = await createParticipant('Bob', alice.client.id)

  await waitForMember(alice, 'Bob')
  await waitForMember(bob, 'Alice')

  expect(latest(alice).roomId).toBe(alice.client.id)
  expect(latest(bob).roomId).toBe(alice.client.id)
  expect(memberUsernames(alice)).toEqual(['Bob'])
  expect(memberUsernames(bob)).toEqual(['Alice'])
  expect(alice.states.length).toBeGreaterThan(1)
  expect(bob.states.length).toBeGreaterThan(1)
})

test('enables, disables, and re-enables a microphone on the remote side', async () => {
  const alice = await createParticipant('Alice')
  const bob = await createParticipant('Bob', alice.client.id)

  await waitForMember(alice, 'Bob')
  await waitForMember(bob, 'Alice')

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

  const bob = await createParticipant('Bob', alice.client.id)
  await waitForMemberTracks(bob, 'Alice', ['audio'])
  expect(memberTrackKinds(alice, 'Bob')).toEqual([])

  await bob.localMedia.startAudioDevice()
  await waitForMemberTracks(alice, 'Bob', ['audio'])
})

test('handles simultaneous microphone offers when both users join with microphones already enabled', async () => {
  const alice = await createParticipant('Alice', null, true)
  const bob = await createParticipant('Bob', alice.client.id, true)

  await waitForMemberTracks(alice, 'Bob', ['audio'])
  await waitForMemberTracks(bob, 'Alice', ['audio'])
})

test('connects three users into a mesh and each user hears the other speakers', async () => {
  const alice = await createParticipant('Alice')
  const bob = await createParticipant('Bob', alice.client.id)
  const cara = await createParticipant('Cara', alice.client.id)
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

test('broadcasts recording activity changes and notifies remote listeners', async () => {
  const alice = await createParticipant('Alice')
  const bob = await createParticipant('Bob', alice.client.id)

  await waitForMember(alice, 'Bob')
  await waitForMember(bob, 'Alice')

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
  const bob = await createParticipant('Bob', alice.client.id)
  const cara = await createParticipant('Cara', alice.client.id)
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

async function createParticipant(username: string, roomId: string | null = null, startMic = false) {
  const { LocalMediaStreams, RemoteMediaClient3 } = await importRemoteRuntime()
  if (startMic) {
    await LocalMediaStreams.startAudioDevice()
  }

  const client = new RemoteMediaClient3(username, roomId)
  const participant: TestParticipant = {
    client,
    localMedia: LocalMediaStreams,
    states: [],
    username,
  }
  client.addStateListener((state) => participant.states.push(snapshotState(state)))
  participants.push(participant)
  await waitFor(() => (client as any).peer.open === true, `${username} peer to open`)
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
