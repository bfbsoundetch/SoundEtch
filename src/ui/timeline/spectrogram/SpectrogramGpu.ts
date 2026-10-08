import type { SpectrogramSourceMessage } from './SpectrogramSourceProtocol'
import {
  createSpectrogramWindow,
  getSpectrogramMelPoints,
  HALO_COLUMNS,
  MAX_DB,
  SOURCE_BUFFER_BYTES,
  TILE_COLUMNS,
  SPECTROGRAM_COLORMAPS,
  SPECTROGRAM_COLORMAP_STOPS,
} from './SpectrogramTiling'
import type { SpectrogramSettings } from './SpectrogramSettings'

const TEXTURE_COLUMNS = TILE_COLUMNS + 2 * HALO_COLUMNS
const METADATA_BYTES = 32

const WINDOW_SHADER = /* wgsl */ `
struct Metadata {
  firstColumn: i32,
  hop: u32,
  sourceFirstFrame: i32,
  sourceStoredFrames: u32,
  sourceChannelCount: u32,
  selectedChannel: u32,
  sourceLayout: u32,
  packedChannel: u32,
}

@group(0) @binding(0) var<uniform> metadata: Metadata;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read> window: array<f32>;
@group(0) @binding(3) var<storage, read_write> realOutput: array<f32>;
@group(0) @binding(4) var<storage, read_write> imaginaryOutput: array<f32>;

override FFT_LENGTH: u32;
override COLUMN_COUNT: u32;
override FFT_BITS: u32;

@compute @workgroup_size(128)
fn windowInput(@builtin(global_invocation_id) invocation: vec3u) {
  let flatIndex = invocation.x;
  if (flatIndex >= COLUMN_COUNT * FFT_LENGTH) { return; }

  let column = flatIndex / FFT_LENGTH;
  let sampleOffset = flatIndex % FFT_LENGTH;
  var value = 0.0;
  if (metadata.sourceLayout == 0u) {
    let absoluteFrame =
      (metadata.firstColumn + i32(column)) * i32(metadata.hop) - i32(FFT_LENGTH / 2u) + i32(sampleOffset);
    let relativeFrame = absoluteFrame - metadata.sourceFirstFrame;
    if (relativeFrame >= 0 && u32(relativeFrame) < metadata.sourceStoredFrames) {
      let sourceIndex = u32(relativeFrame) * metadata.sourceChannelCount + metadata.selectedChannel;
      value = source[sourceIndex] * window[sampleOffset];
    }
  } else {
    let sourceIndex =
      (metadata.packedChannel * COLUMN_COUNT + column) * FFT_LENGTH + sampleOffset;
    value = source[sourceIndex] * window[sampleOffset];
  }

  var reversed = 0u;
  var remaining = sampleOffset;
  for (var bit = 0u; bit < FFT_BITS; bit++) {
    reversed = (reversed << 1u) | (remaining & 1u);
    remaining >>= 1u;
  }
  let outputIndex = column * FFT_LENGTH + reversed;
  realOutput[outputIndex] = value;
  imaginaryOutput[outputIndex] = 0.0;
}
`

const FFT_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> sourceReal: array<f32>;
@group(0) @binding(1) var<storage, read> sourceImaginary: array<f32>;
@group(0) @binding(2) var<storage, read_write> destinationReal: array<f32>;
@group(0) @binding(3) var<storage, read_write> destinationImaginary: array<f32>;

override FFT_LENGTH: u32;
override COLUMN_COUNT: u32;
override HALF_LENGTH: u32;

@compute @workgroup_size(128)
fn fftPass(@builtin(global_invocation_id) invocation: vec3u) {
  let butterfliesPerColumn = FFT_LENGTH / 2u;
  let flatIndex = invocation.x;
  if (flatIndex >= COLUMN_COUNT * butterfliesPerColumn) { return; }

  let column = flatIndex / butterfliesPerColumn;
  let butterfly = flatIndex % butterfliesPerColumn;
  let group = butterfly / HALF_LENGTH;
  let offset = butterfly % HALF_LENGTH;
  let firstIndex = column * FFT_LENGTH + group * HALF_LENGTH * 2u + offset;
  let secondIndex = firstIndex + HALF_LENGTH;
  let twiddleStep = FFT_LENGTH / (HALF_LENGTH * 2u);
  let angle = -6.28318530717958647692 * f32(offset * twiddleStep) / f32(FFT_LENGTH);
  let twiddleReal = cos(angle);
  let twiddleImaginary = sin(angle);
  let firstReal = sourceReal[firstIndex];
  let firstImaginary = sourceImaginary[firstIndex];
  let secondReal = sourceReal[secondIndex];
  let secondImaginary = sourceImaginary[secondIndex];
  let productReal = secondReal * twiddleReal - secondImaginary * twiddleImaginary;
  let productImaginary = secondReal * twiddleImaginary + secondImaginary * twiddleReal;
  destinationReal[firstIndex] = firstReal + productReal;
  destinationImaginary[firstIndex] = firstImaginary + productImaginary;
  destinationReal[secondIndex] = firstReal - productReal;
  destinationImaginary[secondIndex] = firstImaginary - productImaginary;
}
`

const MAGNITUDE_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> fftReal: array<f32>;
@group(0) @binding(1) var<storage, read> fftImaginary: array<f32>;
@group(0) @binding(2) var<storage, read> melPoints: array<f32>;
@group(0) @binding(3) var<storage, read_write> packedOutput: array<u32>;

override FFT_LENGTH: u32;
override COLUMN_COUNT: u32;
override BAND_COUNT: u32;
override PACKED_COLUMN_COUNT: u32;
override OUTPUT_WORDS_PER_ROW: u32;
override POWER_SCALE: f32;
override MINIMUM_DB: f32;
override MAXIMUM_DB: f32;

fn triangleHeight(position: f32, start: f32, center: f32, end: f32) -> f32 {
  if (position <= start || position >= end) { return 0.0; }
  if (position <= center) {
    return clamp((position - start) / max(center - start, 1e-6), 0.0, 1.0);
  }
  return clamp((end - position) / max(end - center, 1e-6), 0.0, 1.0);
}

fn intensity(column: u32, band: u32) -> u32 {
  if (column >= COLUMN_COUNT) { return 0u; }
  let start = melPoints[band];
  let center = melPoints[band + 1u];
  let end = melPoints[band + 2u];
  let firstBin = u32(max(0.0, floor(start - 0.5)));
  let finalBin = min(FFT_LENGTH / 2u - 1u, u32(ceil(end + 0.5)));
  var weightedPower = 0.0;
  var weightSum = 0.0;
  for (var bin = firstBin; bin <= finalBin; bin++) {
    // Mean triangle height over the width-one bin cell, so a triangle narrower than one bin
    // still blends its neighboring bins instead of accumulating zero weight.
    var cellWeight = 0.0;
    for (var sample = 0u; sample < 8u; sample++) {
      let position = f32(bin) - 0.5 + (f32(sample) + 0.5) * 0.125;
      cellWeight += triangleHeight(position, start, center, end);
    }
    cellWeight = cellWeight * 0.125;
    let fftIndex = column * FFT_LENGTH + bin;
    let real = fftReal[fftIndex];
    let imaginary = fftImaginary[fftIndex];
    weightedPower += (real * real + imaginary * imaginary) * POWER_SCALE * cellWeight;
    weightSum += cellWeight;
  }
  let power = weightedPower / max(weightSum, 1e-12);
  let db = clamp(10.0 * log2(power + 1e-24) / log2(10.0), MINIMUM_DB, MAXIMUM_DB);
  let normalized = (db - MINIMUM_DB) / (MAXIMUM_DB - MINIMUM_DB);
  return u32(floor(normalized * 255.0 + 0.5));
}

@compute @workgroup_size(64)
fn packMagnitude(@builtin(global_invocation_id) invocation: vec3u) {
  let flatIndex = invocation.x;
  if (flatIndex >= PACKED_COLUMN_COUNT * BAND_COUNT) { return; }
  let band = flatIndex / PACKED_COLUMN_COUNT;
  let packedColumn = flatIndex % PACKED_COLUMN_COUNT;
  let firstColumn = packedColumn * 4u;
  let packed = intensity(firstColumn, band)
    | (intensity(firstColumn + 1u, band) << 8u)
    | (intensity(firstColumn + 2u, band) << 16u)
    | (intensity(firstColumn + 3u, band) << 24u);
  packedOutput[band * OUTPUT_WORDS_PER_ROW + packedColumn] = packed;
}
`

function createRenderShader(): string {
  const colorFunctions = SPECTROGRAM_COLORMAPS.map((colormap, colormapIndex) => {
    const stops = SPECTROGRAM_COLORMAP_STOPS[colormap]
    const [initialRed, initialGreen, initialBlue] = stops[0]
    const gradientStops = stops
      .slice(1)
      .map((stop, stopIndex) => {
        const [red, green, blue] = stop
        const segmentStart = stopIndex / (stops.length - 1)
        const segmentEnd = (stopIndex + 1) / (stops.length - 1)
        return `  color = mix(color, vec3f(${red}, ${green}, ${blue}), segment(t, ${segmentStart}, ${segmentEnd}));`
      })
      .join('\n')
    return `fn colormap${colormapIndex}(value: f32) -> vec3f {
  let t = clamp(value, 0.0, 1.0);
  var color = vec3f(${initialRed}, ${initialGreen}, ${initialBlue});
${gradientStops}
  return color;
}`
  }).join('\n\n')
  const colorDispatch = SPECTROGRAM_COLORMAPS.map(
    (_, index) => `  ${index === 0 ? '' : 'else '}if (index == ${index}u) { return colormap${index}(value); }`,
  ).join('\n')
  return /* wgsl */ `
struct DrawUniform {
  canvasSize: vec2f,
  rectangleOrigin: vec2f,
  rectangleSize: vec2f,
  textureOrigin: vec2f,
  textureSize: vec2f,
  colormap: f32,
  padding: f32,
  fadePositions: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) textureCoordinate: vec2f,
  @location(1) deviceX: f32,
}

@group(0) @binding(0) var<uniform> draw: DrawUniform;
@group(0) @binding(1) var tileSampler: sampler;
@group(0) @binding(2) var tileTexture: texture_2d<f32>;

fn segment(value: f32, start: f32, end: f32) -> f32 {
  return clamp((value - start) / (end - start), 0.0, 1.0);
}

${colorFunctions}

fn colormapColor(value: f32, which: f32) -> vec3f {
  let index = u32(which + 0.5);
${colorDispatch}
  return vec3f(0.0, 0.0, 0.0);
}

@vertex
fn renderVertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let devicePosition = draw.rectangleOrigin + corner * draw.rectangleSize;
  var output: VertexOutput;
  output.position = vec4f(
    devicePosition.x / draw.canvasSize.x * 2.0 - 1.0,
    1.0 - devicePosition.y / draw.canvasSize.y * 2.0,
    0.0,
    1.0,
  );
  output.textureCoordinate = draw.textureOrigin + corner * draw.textureSize;
  output.deviceX = devicePosition.x;
  return output;
}

@fragment
fn renderFragment(input: VertexOutput) -> @location(0) vec4f {
  var alpha = 1.0;
  if (draw.fadePositions.y > draw.fadePositions.x && input.deviceX < draw.fadePositions.y) {
    let progress = clamp(
      (input.deviceX - draw.fadePositions.x) / (draw.fadePositions.y - draw.fadePositions.x),
      0.0,
      1.0,
    );
    alpha *= sin(progress * 1.5707963267948966);
  }
  if (draw.fadePositions.w > draw.fadePositions.z && input.deviceX > draw.fadePositions.z) {
    let progress = clamp(
      (input.deviceX - draw.fadePositions.z) / (draw.fadePositions.w - draw.fadePositions.z),
      0.0,
      1.0,
    );
    alpha *= cos(progress * 1.5707963267948966);
  }
  let color = colormapColor(textureSample(tileTexture, tileSampler, input.textureCoordinate).r, draw.colormap);
  return vec4f(color * alpha, alpha);
}
`
}

const RENDER_UNIFORM_FLOATS = 16
const RENDER_UNIFORM_BYTES = RENDER_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT

export interface SpectrogramGpuDraw {
  readonly rectangleX: number
  readonly rectangleY: number
  readonly rectangleWidth: number
  readonly rectangleHeight: number
  readonly textureStartX: number
  readonly textureEndX: number
  readonly fadeStartX: number
  readonly fadeInEndX: number
  readonly fadeOutStartX: number
  readonly fadeEndX: number
  readonly textureView: GPUTextureView | null
}

export interface SpectrogramGpuCanvas {
  readonly context: GPUCanvasContext
}

interface GpuResources {
  device: GPUDevice
  sourceBuffer: GPUBuffer
  windowBuffer: GPUBuffer
  metadataBuffer: GPUBuffer
  melBuffer: GPUBuffer
  realA: GPUBuffer
  imaginaryA: GPUBuffer
  realB: GPUBuffer
  imaginaryB: GPUBuffer
  stagingBuffer: GPUBuffer
  windowPipeline: GPUComputePipeline
  fftPipelines: GPUComputePipeline[]
  magnitudePipeline: GPUComputePipeline
  windowBindGroup: GPUBindGroup
  fftBindGroups: readonly [GPUBindGroup, GPUBindGroup]
  magnitudeBindGroups: readonly [GPUBindGroup, GPUBindGroup]
  settings: SpectrogramSettings
  packedColumnCount: number
  stagingBytesPerRow: number
  sampleRate: number
  renderPipeline: GPURenderPipeline
  renderBindGroupLayout: GPUBindGroupLayout
  renderSampler: GPUSampler
  fallbackTexture: GPUTexture
  fallbackTextureView: GPUTextureView
  renderUniformBuffer: GPUBuffer
  renderUniformCapacity: number
  renderBindGroups: WeakMap<GPUTextureView, GPUBindGroup>
}

export interface SpectrogramGpuTile {
  readonly texture: GPUTexture
  readonly channelViews: readonly GPUTextureView[]
  readonly channelCount: number
}

export class SpectrogramGpu {
  private resources: GpuResources | null = null
  private initialization: Promise<GpuResources> | null = null
  private permanentlyUnavailable = false
  private recovering = false
  private recoveryUsed = false

  constructor(
    private readonly onDeviceLost: (message: string) => void,
    private settings: SpectrogramSettings,
  ) {}

  async ensureAvailable(sampleRate: number): Promise<void> {
    if (this.permanentlyUnavailable) throw new Error('WebGPU spectrogram is unavailable for this session')
    if (this.resources !== null) {
      if (this.resources.sampleRate !== sampleRate) this.updateMelPoints(this.resources, sampleRate)
      return
    }
    if (this.initialization === null) {
      if (this.recovering) this.recoveryUsed = true
      this.initialization = this.initialize(sampleRate, this.settings)
    }

    const initialization = this.initialization
    try {
      const resources = await initialization
      if (this.initialization !== initialization) {
        this.destroyResourcesAfterWork(resources)
        await this.ensureAvailable(sampleRate)
        return
      }
      this.resources = resources
    } catch (error) {
      if (this.initialization !== initialization) {
        await this.ensureAvailable(sampleRate)
        return
      }
      this.initialization = null
      this.permanentlyUnavailable = true
      throw error
    }
  }

  updateSettings(settings: SpectrogramSettings): void {
    const analysisChanged =
      settings.fftSize !== this.settings.fftSize ||
      settings.hopSize !== this.settings.hopSize ||
      settings.frequencyBands !== this.settings.frequencyBands ||
      settings.windowFunction !== this.settings.windowFunction ||
      settings.minDb !== this.settings.minDb
    this.settings = settings
    if (analysisChanged) this.clearDeviceResources()
  }

  updateSampleRateIfInitialized(sampleRate: number): void {
    if (this.resources !== null && this.resources.sampleRate !== sampleRate) {
      this.updateMelPoints(this.resources, sampleRate)
    }
  }

  async prepareCanvas(canvas: HTMLCanvasElement, sampleRate: number): Promise<SpectrogramGpuCanvas> {
    await this.ensureAvailable(sampleRate)
    const resources = this.requireResources()
    const context = canvas.getContext('webgpu')
    if (context === null) throw new Error('Unable to create a WebGPU canvas context')
    context.configure({
      device: resources.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    })
    return { context }
  }

  render(
    canvas: SpectrogramGpuCanvas,
    width: number,
    height: number,
    draws: readonly SpectrogramGpuDraw[],
  ): Promise<void> {
    const resources = this.requireResources()
    const uniformStride =
      Math.ceil(RENDER_UNIFORM_BYTES / resources.device.limits.minUniformBufferOffsetAlignment) *
      resources.device.limits.minUniformBufferOffsetAlignment
    const requiredUniformBytes = Math.max(uniformStride, draws.length * uniformStride)
    if (resources.renderUniformCapacity < requiredUniformBytes) {
      let newCapacity = resources.renderUniformCapacity
      while (newCapacity < requiredUniformBytes) newCapacity *= 2
      const previousBuffer = resources.renderUniformBuffer
      resources.renderUniformBuffer = resources.device.createBuffer({
        label: 'spectrogram render uniforms',
        size: newCapacity,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      resources.renderUniformCapacity = newCapacity
      resources.renderBindGroups = new WeakMap<GPUTextureView, GPUBindGroup>()
      void resources.device.queue.onSubmittedWorkDone().then(() => previousBuffer.destroy())
    }

    if (draws.length > 0) {
      const upload = new Float32Array(requiredUniformBytes / Float32Array.BYTES_PER_ELEMENT)
      const strideFloats = uniformStride / Float32Array.BYTES_PER_ELEMENT
      const frequencyBands = resources.settings.frequencyBands
      const textureTop = (frequencyBands - 0.5) / frequencyBands
      const textureBottom = 0.5 / frequencyBands
      for (let index = 0; index < draws.length; index++) {
        const draw = draws[index]
        const offset = index * strideFloats
        upload[offset] = width
        upload[offset + 1] = height
        upload[offset + 2] = draw.rectangleX
        upload[offset + 3] = draw.rectangleY
        upload[offset + 4] = draw.rectangleWidth
        upload[offset + 5] = draw.rectangleHeight
        upload[offset + 6] = draw.textureView === null ? 0.5 : draw.textureStartX
        upload[offset + 7] = textureTop
        upload[offset + 8] = draw.textureView === null ? 0 : draw.textureEndX - draw.textureStartX
        upload[offset + 9] = textureBottom - textureTop
        upload[offset + 10] = SPECTROGRAM_COLORMAPS.indexOf(this.settings.colormap)
        upload[offset + 12] = draw.fadeStartX
        upload[offset + 13] = draw.fadeInEndX
        upload[offset + 14] = draw.fadeOutStartX
        upload[offset + 15] = draw.fadeEndX
      }
      resources.device.queue.writeBuffer(resources.renderUniformBuffer, 0, upload)
    }

    const commandEncoder = resources.device.createCommandEncoder({ label: 'spectrogram render' })
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvas.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    renderPass.setPipeline(resources.renderPipeline)
    for (let index = 0; index < draws.length; index++) {
      const draw = draws[index]
      const textureView = draw.textureView ?? resources.fallbackTextureView
      let bindGroup = resources.renderBindGroups.get(textureView)
      if (bindGroup === undefined) {
        bindGroup = resources.device.createBindGroup({
          layout: resources.renderBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: resources.renderUniformBuffer, size: RENDER_UNIFORM_BYTES } },
            { binding: 1, resource: resources.renderSampler },
            { binding: 2, resource: textureView },
          ],
        })
        resources.renderBindGroups.set(textureView, bindGroup)
      }
      renderPass.setBindGroup(0, bindGroup, [index * uniformStride])
      renderPass.draw(6)
    }
    renderPass.end()
    resources.device.queue.submit([commandEncoder.finish()])
    return resources.device.queue.onSubmittedWorkDone()
  }

  createTile(channelCount: number): SpectrogramGpuTile {
    const resources = this.requireResources()
    const texture = resources.device.createTexture({
      label: 'spectrogram tile',
      size: {
        width: TEXTURE_COLUMNS,
        height: resources.settings.frequencyBands,
        depthOrArrayLayers: channelCount,
      },
      format: 'r8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    })
    const channelViews = Array.from({ length: channelCount }, (_, channel) =>
      texture.createView({
        dimension: '2d',
        baseArrayLayer: channel,
        arrayLayerCount: 1,
      }),
    )
    return { texture, channelViews, channelCount }
  }

  processSourceBatch(
    tile: SpectrogramGpuTile,
    message: Extract<SpectrogramSourceMessage, { type: 'source-batch' }>,
    firstColumn: number,
    hop: number,
  ): void {
    const resources = this.requireResources()
    if (message.data.byteLength > SOURCE_BUFFER_BYTES) {
      throw new Error(`Spectrogram source batch exceeds ${SOURCE_BUFFER_BYTES} bytes`)
    }

    resources.device.queue.writeBuffer(resources.sourceBuffer, 0, message.data)
    const storedFrameCount =
      message.layout === 'interleaved'
        ? message.data.byteLength / Float32Array.BYTES_PER_ELEMENT / message.batchChannelCount
        : 0

    for (let channelOffset = 0; channelOffset < message.batchChannelCount; channelOffset++) {
      const metadata = new ArrayBuffer(METADATA_BYTES)
      const metadataSigned = new Int32Array(metadata)
      const metadataUnsigned = new Uint32Array(metadata)
      metadataSigned[0] = firstColumn
      metadataUnsigned[1] = hop
      metadataSigned[2] = message.firstFrame
      metadataUnsigned[3] = storedFrameCount
      metadataUnsigned[4] = message.batchChannelCount
      metadataUnsigned[5] = message.firstChannel + channelOffset
      metadataUnsigned[6] = message.layout === 'interleaved' ? 0 : 1
      metadataUnsigned[7] = channelOffset
      resources.device.queue.writeBuffer(resources.metadataBuffer, 0, metadata)

      const commandEncoder = resources.device.createCommandEncoder({ label: 'spectrogram tile channel' })
      const computePass = commandEncoder.beginComputePass()
      computePass.setPipeline(resources.windowPipeline)
      computePass.setBindGroup(0, resources.windowBindGroup)
      computePass.dispatchWorkgroups(Math.ceil((TEXTURE_COLUMNS * resources.settings.fftSize) / 128))

      let pingPongIndex = 0
      for (const pipeline of resources.fftPipelines) {
        computePass.setPipeline(pipeline)
        computePass.setBindGroup(0, resources.fftBindGroups[pingPongIndex])
        computePass.dispatchWorkgroups(Math.ceil((TEXTURE_COLUMNS * (resources.settings.fftSize / 2)) / 128))
        pingPongIndex = 1 - pingPongIndex
      }
      computePass.setPipeline(resources.magnitudePipeline)
      computePass.setBindGroup(0, resources.magnitudeBindGroups[pingPongIndex])
      computePass.dispatchWorkgroups(Math.ceil((resources.packedColumnCount * resources.settings.frequencyBands) / 64))
      computePass.end()

      commandEncoder.copyBufferToTexture(
        {
          buffer: resources.stagingBuffer,
          bytesPerRow: resources.stagingBytesPerRow,
          rowsPerImage: resources.settings.frequencyBands,
        },
        { texture: tile.texture, origin: { x: 0, y: 0, z: message.firstChannel + channelOffset } },
        { width: TEXTURE_COLUMNS, height: resources.settings.frequencyBands, depthOrArrayLayers: 1 },
      )
      resources.device.queue.submit([commandEncoder.finish()])
    }
  }

  async submittedWorkDone(): Promise<void> {
    await this.requireResources().device.queue.onSubmittedWorkDone()
  }

  destroyTile(tile: SpectrogramGpuTile): void {
    tile.texture.destroy()
  }

  clearDeviceResources(): void {
    const resources = this.resources
    this.resources = null
    this.initialization = null
    if (resources !== null) this.destroyResourcesAfterWork(resources)
  }

  private async initialize(sampleRate: number, settings: SpectrogramSettings): Promise<GpuResources> {
    if (navigator.gpu === undefined) throw new Error('navigator.gpu is unavailable')
    const adapter = await navigator.gpu.requestAdapter()
    if (adapter === null) throw new Error('No WebGPU adapter is available')
    const fftComponentBytes = TEXTURE_COLUMNS * settings.fftSize * Float32Array.BYTES_PER_ELEMENT
    const requiredStorageSize = Math.max(fftComponentBytes, SOURCE_BUFFER_BYTES)
    if (
      adapter.limits.maxStorageBufferBindingSize < requiredStorageSize ||
      adapter.limits.maxBufferSize < requiredStorageSize
    ) {
      throw new Error(`WebGPU storage-buffer limit is below ${requiredStorageSize} bytes`)
    }

    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: requiredStorageSize,
        maxBufferSize: requiredStorageSize,
      },
    })
    const resources = await this.createResources(device, sampleRate, settings)
    void device.lost.then((info) => {
      if (this.resources?.device !== device) return
      this.resources = null
      this.initialization = null
      if (this.recoveryUsed) {
        this.permanentlyUnavailable = true
      } else {
        this.recovering = true
      }
      this.onDeviceLost(info.message || 'WebGPU device lost')
    })
    this.recovering = false
    return resources
  }

  private async createResources(
    device: GPUDevice,
    sampleRate: number,
    settings: SpectrogramSettings,
  ): Promise<GpuResources> {
    const analysisWindow = createSpectrogramWindow(settings.fftSize, settings.windowFunction)
    const fftComponentBytes = TEXTURE_COLUMNS * settings.fftSize * Float32Array.BYTES_PER_ELEMENT
    const packedColumnCount = Math.ceil(TEXTURE_COLUMNS / 4)
    const stagingBytesPerRow = Math.ceil(TEXTURE_COLUMNS / 256) * 256
    const stagingBufferBytes = stagingBytesPerRow * settings.frequencyBands
    const sourceBuffer = device.createBuffer({
      label: 'spectrogram source',
      size: SOURCE_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const windowBuffer = device.createBuffer({
      label: 'spectrogram analysis window',
      size: analysisWindow.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const metadataBuffer = device.createBuffer({
      label: 'spectrogram metadata',
      size: METADATA_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const melBuffer = device.createBuffer({
      label: 'spectrogram mel filters',
      size: (settings.frequencyBands + 2) * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const scratchUsage = GPUBufferUsage.STORAGE
    const realA = device.createBuffer({
      label: 'spectrogram FFT real A',
      size: fftComponentBytes,
      usage: scratchUsage,
    })
    const imaginaryA = device.createBuffer({
      label: 'spectrogram FFT imaginary A',
      size: fftComponentBytes,
      usage: scratchUsage,
    })
    const realB = device.createBuffer({
      label: 'spectrogram FFT real B',
      size: fftComponentBytes,
      usage: scratchUsage,
    })
    const imaginaryB = device.createBuffer({
      label: 'spectrogram FFT imaginary B',
      size: fftComponentBytes,
      usage: scratchUsage,
    })
    const stagingBuffer = device.createBuffer({
      label: 'spectrogram packed tile staging',
      size: stagingBufferBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    const initialRenderUniformCapacity = Math.max(256, device.limits.minUniformBufferOffsetAlignment)
    const renderUniformBuffer = device.createBuffer({
      label: 'spectrogram render uniforms',
      size: initialRenderUniformCapacity,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const fallbackTexture = device.createTexture({
      label: 'spectrogram minimum-dB fallback',
      size: { width: 1, height: 1 },
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture: fallbackTexture }, new Uint8Array([0]), {}, { width: 1, height: 1 })
    const fallbackTextureView = fallbackTexture.createView()
    const renderSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    const renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: RENDER_UNIFORM_BYTES },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
      ],
    })

    device.queue.writeBuffer(windowBuffer, 0, analysisWindow)

    const readOnlyStorage = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'read-only-storage' },
    })
    const storage = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    })
    const windowLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        readOnlyStorage(1),
        readOnlyStorage(2),
        storage(3),
        storage(4),
      ],
    })
    const fftLayout = device.createBindGroupLayout({
      entries: [readOnlyStorage(0), readOnlyStorage(1), storage(2), storage(3)],
    })
    const magnitudeLayout = device.createBindGroupLayout({
      entries: [readOnlyStorage(0), readOnlyStorage(1), readOnlyStorage(2), storage(3)],
    })

    const windowModule = device.createShaderModule({ label: 'spectrogram window shader', code: WINDOW_SHADER })
    const fftModule = device.createShaderModule({ label: 'spectrogram FFT shader', code: FFT_SHADER })
    const magnitudeModule = device.createShaderModule({ label: 'spectrogram magnitude shader', code: MAGNITUDE_SHADER })
    const renderModule = device.createShaderModule({
      label: 'spectrogram render shader',
      code: createRenderShader(),
    })
    for (const module of [windowModule, fftModule, magnitudeModule, renderModule]) {
      const compilationInfo = await module.getCompilationInfo()
      const errors = compilationInfo.messages.filter((message) => message.type === 'error')
      if (errors.length > 0) {
        throw new Error(
          `${module.label} failed to compile:\n${errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n')}`,
        )
      }
    }
    const renderPipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: { module: renderModule, entryPoint: 'renderVertex' },
      fragment: {
        module: renderModule,
        entryPoint: 'renderFragment',
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    })

    const commonConstants = {
      FFT_LENGTH: settings.fftSize,
      COLUMN_COUNT: TEXTURE_COLUMNS,
    }
    const windowPipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [windowLayout] }),
      compute: {
        module: windowModule,
        entryPoint: 'windowInput',
        constants: { ...commonConstants, FFT_BITS: Math.log2(settings.fftSize) },
      },
    })
    const fftPipelines = new Array<GPUComputePipeline>()
    for (let halfLength = 1; halfLength < settings.fftSize; halfLength *= 2) {
      fftPipelines.push(
        await device.createComputePipelineAsync({
          layout: device.createPipelineLayout({ bindGroupLayouts: [fftLayout] }),
          compute: {
            module: fftModule,
            entryPoint: 'fftPass',
            constants: { ...commonConstants, HALF_LENGTH: halfLength },
          },
        }),
      )
    }
    const windowSum = analysisWindow.reduce((sum, value) => sum + value, 0)
    const magnitudePipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [magnitudeLayout] }),
      compute: {
        module: magnitudeModule,
        entryPoint: 'packMagnitude',
        constants: {
          ...commonConstants,
          BAND_COUNT: settings.frequencyBands,
          PACKED_COLUMN_COUNT: packedColumnCount,
          OUTPUT_WORDS_PER_ROW: stagingBytesPerRow / Uint32Array.BYTES_PER_ELEMENT,
          POWER_SCALE: (2 / windowSum) ** 2,
          MINIMUM_DB: settings.minDb,
          MAXIMUM_DB: MAX_DB,
        },
      },
    })

    const bind = (layout: GPUBindGroupLayout, buffers: readonly GPUBuffer[]): GPUBindGroup =>
      device.createBindGroup({
        layout,
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      })
    const windowBindGroup = bind(windowLayout, [metadataBuffer, sourceBuffer, windowBuffer, realA, imaginaryA])
    const fftBindGroups = [
      bind(fftLayout, [realA, imaginaryA, realB, imaginaryB]),
      bind(fftLayout, [realB, imaginaryB, realA, imaginaryA]),
    ] as const
    const magnitudeBindGroups = [
      bind(magnitudeLayout, [realA, imaginaryA, melBuffer, stagingBuffer]),
      bind(magnitudeLayout, [realB, imaginaryB, melBuffer, stagingBuffer]),
    ] as const

    const resources: GpuResources = {
      device,
      sourceBuffer,
      windowBuffer,
      metadataBuffer,
      melBuffer,
      realA,
      imaginaryA,
      realB,
      imaginaryB,
      stagingBuffer,
      windowPipeline,
      fftPipelines,
      magnitudePipeline,
      windowBindGroup,
      fftBindGroups,
      magnitudeBindGroups,
      settings,
      packedColumnCount,
      stagingBytesPerRow,
      sampleRate,
      renderPipeline,
      renderBindGroupLayout,
      renderSampler,
      fallbackTexture,
      fallbackTextureView,
      renderUniformBuffer,
      renderUniformCapacity: initialRenderUniformCapacity,
      renderBindGroups: new WeakMap<GPUTextureView, GPUBindGroup>(),
    }
    this.updateMelPoints(resources, sampleRate)
    return resources
  }

  private updateMelPoints(resources: GpuResources, sampleRate: number): void {
    const points = getSpectrogramMelPoints(resources.settings.frequencyBands, resources.settings.fftSize, sampleRate)
    resources.device.queue.writeBuffer(resources.melBuffer, 0, points)
    resources.sampleRate = sampleRate
  }

  private requireResources(): GpuResources {
    if (this.resources === null) throw new Error('WebGPU spectrogram resources are not initialized')
    return this.resources
  }

  private destroyResourcesAfterWork(resources: GpuResources): void {
    const destroy = (): void => this.destroyResources(resources)
    void resources.device.queue.onSubmittedWorkDone().then(destroy, destroy)
  }

  private destroyResources(resources: GpuResources): void {
    resources.sourceBuffer.destroy()
    resources.windowBuffer.destroy()
    resources.metadataBuffer.destroy()
    resources.melBuffer.destroy()
    resources.realA.destroy()
    resources.imaginaryA.destroy()
    resources.realB.destroy()
    resources.imaginaryB.destroy()
    resources.stagingBuffer.destroy()
    resources.renderUniformBuffer.destroy()
    resources.fallbackTexture.destroy()
  }
}

export const SPECTROGRAM_TEXTURE_COLUMNS = TEXTURE_COLUMNS
export function getSpectrogramTileBytesPerChannel(settings: SpectrogramSettings): number {
  return TEXTURE_COLUMNS * settings.frequencyBands
}
