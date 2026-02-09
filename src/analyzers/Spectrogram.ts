import { rfft } from 'kissfft-wasm'
import { FFTWindowFunctions, WindowFunction } from './FFTWindowFunctions'
// import { curve } from 'cardinal-spline-js'

export class Spectrogram {
  private linearFreqBuckets: number
  private maxWidth: number
  private logIndexes: Array<number>

  constructor(
    private readonly audioBuffer: Float32Array,
    private readonly canvasId: string,
    private windowFunction = WindowFunction.BLACKMAN,
    private canvasWidth: number,
    private sampleRate = 48000,
    private numPoints = 128,
  ) {
    if (audioBuffer.buffer! instanceof SharedArrayBuffer) {
      throw new Error('audioBuffer must be backed by a SharedArrayBuffer')
    }
    const maxFreq = sampleRate / 2
    this.linearFreqBuckets = maxFreq / audioBuffer.length
    this.maxWidth = (audioBuffer.length / 2) * (1 + Math.log2(audioBuffer.length))
    const expIncrement = Math.log2(audioBuffer.length) / (numPoints - 1)
    this.logIndexes = []
    for (let i = 0; i < numPoints; ++i) {
      this.logIndexes.push(Math.floor(2 ** (i * expIncrement)))
    }
    console.log(this.logIndexes)
  }

  changeWindowFunction(windowFunction: WindowFunction) {
    console.log('!' + windowFunction)
    this.windowFunction = windowFunction
    console.log('!' + this.windowFunction)
  }

  draw() {
    const canvas = document.getElementById(this.canvasId) as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (context == null) {
      return
    }

    const audioData = this.calculateFft()
    context.clearRect(0, 0, canvas.width, canvas.height)

    const lineWidth = Math.max(Math.round(canvas.width / this.numPoints), 1)

    context.lineWidth = 1
    context.beginPath()
    context.moveTo(0, 0)
    // for (let x = Math.floor(lineWidth / 2); x < canvas.width; x += lineWidth) {
    for (let i = 0; i < this.numPoints; ++i) {
      // audioData[x]
      const x = Math.floor(lineWidth / 2) + lineWidth * i
      context.lineTo(x, Math.log10(audioData[this.logIndexes[i]]) * 100)
      context.stroke()
    }
    context.closePath()
    // curve(context, )
  }

  private calculateFft(): Float32Array {
    // console.log(this.windowFunction)
    const wf = FFTWindowFunctions.getWindowFunction(this.windowFunction)
    // console.log(wf)
    wf(this.audioBuffer)
    return rfft(this.audioBuffer)
  }
}
