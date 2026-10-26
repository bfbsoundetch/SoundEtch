import type { VideoFileWritingRequest, VideoFileWritingResponse } from './VideoFileWritingWorker'

type Pending = { resolve(size: number): void; reject(error: Error): void }

/** Writes a recording's video file from a worker that flushes every write, so a closed tab keeps what was written. */
export class VideoFileWriter {
  /** The worker answers requests in order. */
  private readonly pending = new Array<Pending>()
  private failure: Error | null = null
  private closed = false

  private constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (event: MessageEvent<VideoFileWritingResponse>) => {
      const response = event.data
      const entry = this.pending.shift()
      if (response.type == 'done') {
        entry?.resolve(response.size)
      } else {
        entry?.reject(new DOMException(response.message, response.name))
      }
    })
    worker.addEventListener('error', (event) => {
      this.failure = new Error(event.message || 'The video file worker failed')
      for (const entry of this.pending.splice(0)) entry.reject(this.failure)
    })
  }

  /** Creates or empties the file and holds it open until `close`. */
  static async open(directory: string, filename: string): Promise<VideoFileWriter> {
    const writer = new VideoFileWriter(createWorker())
    try {
      await writer.send({ type: 'open', directory, filename })
    } catch (error) {
      writer.worker.terminate()
      throw error
    }
    return writer
  }

  /**
   * Cuts a fragmented MP4 whose recording was interrupted back to its playable prefix; returns that prefix's size, 0
   * when nothing is playable. Rejects with NoModificationAllowedError while another tab still writes the file.
   */
  static async trimInterruptedFile(directory: string, filename: string): Promise<number> {
    const writer = new VideoFileWriter(createWorker())
    try {
      return await writer.send({ type: 'trim', directory, filename })
    } finally {
      writer.worker.terminate()
    }
  }

  async write(data: Uint8Array<ArrayBuffer>, position: number): Promise<void> {
    if (this.closed) throw new Error('Cannot write to a closed file')
    await this.send({ type: 'write', data, position })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await this.send({ type: 'close' })
    } finally {
      this.worker.terminate()
    }
  }

  private send(request: VideoFileWritingRequest): Promise<number> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      // Mediabunny reads a chunk after handing it over, so it is cloned, not transferred.
      this.worker.postMessage(request)
    })
  }
}

function createWorker() {
  return new Worker(new URL('./VideoFileWritingWorker.ts', import.meta.url), { type: 'module' })
}
