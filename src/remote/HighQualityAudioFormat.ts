/** The format of meeting members' high-quality audio, as sent to a recorder and stored in the cloud. */
export const HQ_SAMPLE_RATE = 48000
/** 100 ms of mono 16-bit PCM per frame. */
export const HQ_FRAME_SAMPLES = 4800
export const HQ_FRAME_BYTES = HQ_FRAME_SAMPLES * Int16Array.BYTES_PER_ELEMENT
/** 24 hours of frames. */
export const HQ_MAX_FRAME_SEQ = 864000

/** Frames per cloud audio chunk: 30 s. */
export const HQ_AUDIO_CHUNK_FRAMES = 300
/** `'SEHQ'`, u16 version 1, u16 0, u32 first seq, u32 frame count, little-endian; the int16 frames follow. */
export const HQ_AUDIO_CHUNK_HEADER_BYTES = 16
export const HQ_VIDEO_CHUNK_BYTES = 8 * 1024 * 1024
/** The cloud folder that holds every recorder's meeting media; backups skip it, as it has no backup index. */
export const HQ_CLOUD_ROOT = '/Meeting media'
/** A guest's local OPFS directory of chunks waiting to be uploaded. */
export const HQ_UPLOAD_SPOOL_DIRECTORY = 'meeting-hq-upload'

/** Samples the capture worklet writes per record: one render quantum. */
export const HQ_CAPTURE_QUANTUM = 128
/** Two int16 words holding the quantum's index since the capture started (low, then high 16 bits), then its samples. */
export const HQ_CAPTURE_RECORD_LENGTH = HQ_CAPTURE_QUANTUM + 2
/** 8 s of records in the capture ring. */
export const HQ_CAPTURE_RING_RECORDS = 3000
