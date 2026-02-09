export class FlacExportFormat {
  constructor(
    private readonly bitsPerSample: number,
    private readonly sampleRate: number,
    private readonly channelCount: number,
    private readonly compressionLevel: number,
    private readonly totalSamples: number,
  ) {}
}
