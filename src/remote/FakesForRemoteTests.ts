const globals = {
    MediaStream: class MediaStream {},
    MediaStreamTrack: class MediaStreamTrack {},
}
Object.assign(globalThis, globals)
Object.assign(global, globals)
