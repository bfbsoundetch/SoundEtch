import { decodeStream } from 'audio-decode'
// @ts-expect-error
import audioType from 'audio-type'
import SoxrResampler, {SoxrDatatype, SoxrQuality} from 'wasm-audio-resampler'
import { Track } from '../project/Track'
import { Project } from '../project/Project'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'

export class AudioImporter2 {

    static async importFile(file: File, activeProject: Project, track: Track, decoderConfig: AudioDecoderConfig) {
        const realStart = Date.now()
        const format = audioType((await file.slice(0, 128).bytes()).buffer)

        const resampler = decoderConfig.sampleRate != activeProject.sampleRate
            ? new SoxrResampler(
                decoderConfig.numberOfChannels,
                decoderConfig.sampleRate,
                activeProject.sampleRate,
                SoxrDatatype.SOXR_FLOAT32,
                SoxrDatatype.SOXR_FLOAT32,
                SoxrQuality.SOXR_HQ
            )
            : null
        resampler?.init()

        const channelCount = decoderConfig.numberOfChannels

        const clipView = track.clipViews[0]!
        const clip = clipView.clip
        const summary = clip.summary
        const dirname = `${activeProject.id}`
        const filename = clip.filename
        const fileHandle = await FileSystemUtils.getFileHandle(dirname, filename)
        const writable = await fileHandle.createWritable()
        try {

            for await (const chunk of decodeStream(file.stream(), format)) {
                console.error(chunk.channelData[0].length)
                const startTime = Date.now()
                let interleaved = new Float32Array(chunk.channelData[0].length * channelCount)
                for (let i = 0; i < chunk.channelData[0].length; ++i) {
                    for (let channel = 0; channel < channelCount; ++channel) {
                        interleaved[i * channelCount + channel] = chunk.channelData[channel][i]
                    }
                }
                const interleavedTime = Date.now()
                console.error('interleaved time was', interleavedTime - startTime)
                if (resampler) {
                  interleaved = new Float32Array(resampler.processChunk(new Uint8Array(interleaved.buffer)).buffer as ArrayBuffer)
                }
                const resampledTime = Date.now()
                console.error('resampled time was', resampledTime - startTime)
                
                writable.write(interleaved)
                summary.summarizeInterleavedData(interleaved, interleaved.length)
                console.error('summary time was', Date.now() - resampledTime)
                console.error(Date.now() - startTime, 'for', chunk.channelData[0].length)
            }
        } finally {
            writable.close()
        }

        console.error('real end', Date.now() - realStart)
        return {metadata: {}, length: summary.length}
    }

}