/** 16-bit mono PCM: the format tests import, and the default the app publishes WAV in. */
export interface Pcm16 {
  sampleRate: number
  channelCount: number
  samples: Int16Array
}

export function sineTone(seconds: number, frequency: number, amplitude: number, sampleRate = 48_000): Int16Array {
  const samples = new Int16Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude * 32767)
  }
  return samples
}

export function encodeWav(samples: Int16Array, sampleRate = 48_000): Buffer {
  const dataBytes = samples.length * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataBytes, 40)
  Buffer.from(samples.buffer, samples.byteOffset, dataBytes).copy(wav, 44)
  return wav
}

/** Walks the RIFF chunks: published files carry an `id3 ` tag chunk between `fmt ` and `data`. */
export function decodeWav(wav: Buffer): Pcm16 {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file')
  }
  let format: { sampleRate: number; channelCount: number } | null = null
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      const encoding = wav.readUInt16LE(body)
      const bitsPerSample = wav.readUInt16LE(body + 14)
      if (encoding !== 1 || bitsPerSample !== 16) {
        throw new Error(`Expected 16-bit PCM, got format ${encoding} with ${bitsPerSample} bits`)
      }
      format = { channelCount: wav.readUInt16LE(body + 2), sampleRate: wav.readUInt32LE(body + 4) }
    } else if (id === 'data') {
      if (!format) throw new Error('data chunk precedes fmt chunk')
      // Copied: Int16Array needs an even byte offset, which the chunk inside `wav` need not have.
      const data = new Uint8Array(wav.subarray(body, body + size))
      return { ...format, samples: new Int16Array(data.buffer, 0, size / 2) }
    }
    offset = body + size + (size & 1)
  }
  throw new Error('No data chunk')
}
