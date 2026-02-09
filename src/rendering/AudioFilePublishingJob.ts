import { RingBuffer } from 'ringbuf.js'
import { ControllableWorkerJob } from '../audiocontext/ControllableWorkerJob'

export type AudioFilePublishingJobArgument = {
  length: number
  writableStream: WritableStream
  ringBufferArray: SharedArrayBuffer
}

export class AudioFilePublishingJob implements ControllableWorkerJob {
  private readonly ringBuffer: RingBuffer
  private readonly length: number
  private readonly writer: WritableStreamDefaultWriter
  private isStopped = false

  constructor(argument: AudioFilePublishingJobArgument) {
    this.length = argument.length
    this.writer = argument.writableStream.getWriter()
    this.ringBuffer = new RingBuffer(argument.ringBufferArray, Float32Array)
  }

  async start(): Promise<any> {
    let totalSamplesPopped = 0
    const popBuffer = new Float32Array(32 * 1024)
    try {
      while (!this.isStopped && totalSamplesPopped < this.length) {
        const poppedLength = this.ringBuffer.pop(popBuffer)
        await this.writer.write(popBuffer.slice(0, poppedLength))
        totalSamplesPopped += poppedLength
      }
    } finally {
      this.writer.close()
    }
  }
  pause(): void {}
  resume(): void {}
  stop(): void {
    this.isStopped = true
  }
}
