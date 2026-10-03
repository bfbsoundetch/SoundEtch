export type SpectrogramSourceCommand =
  | {
      type: 'load'
      requestId: number
      file: File
      clipLength: number
      sourceChannelCount: number
      hop: number
      fftSize: number
      firstColumn: number
      columnCount: number
    }
  | { type: 'continue'; requestId: number; reusableBuffer?: ArrayBuffer }
  | { type: 'cancel'; requestId: number }

export type SpectrogramSourceMessage =
  | {
      type: 'source-batch'
      requestId: number
      layout: 'interleaved' | 'packed-windows'
      data: ArrayBuffer
      firstFrame: number
      firstChannel: number
      batchChannelCount: number
      sourceFrameCount: number
    }
  | { type: 'complete'; requestId: number; sourceFrameCount: number }
  | { type: 'error'; requestId: number; message: string }
