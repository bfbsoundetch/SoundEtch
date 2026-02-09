import { fileURLToPath } from 'url'
import { defineConfig, PluginOption } from 'vite'
import wasm from 'vite-plugin-wasm'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/soundetch',
  define: {
    global: {}, // Or global: 'window'
  },
  resolve: {
    alias: {
      assert: '/src/global/EmptyNodeAssert.ts',
    },
  },
  esbuild: {
    supported: {
      'top-level-await': true,
    },
  },
  build: {
    minify: false,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        playingAudioWorklet: fileURLToPath(
          new URL('./src/playback/FilePlayingAudioWorkletProcessor.js', import.meta.url),
        ),
        recordingAudioWorklet: fileURLToPath(
          new URL('./src/recording/DiskRecordingAudioWorkletProcessor.js', import.meta.url),
        ),
        ringBufferBackedWorklet: fileURLToPath(
          new URL('./src/noisereduction/RingBufferBackedAudioWorkletProcessor.js', import.meta.url),
        ),
        renderingWorker: fileURLToPath(new URL('./src/rendering/RenderingJob.ts', import.meta.url)),
        flacEncodingWorker: fileURLToPath(new URL('./src/encoders/FlacEncoderWorker.js', import.meta.url)),
      },
      output: {
        entryFileNames: (assetInfo) => {
          if (
            assetInfo.name == 'playingAudioWorklet' ||
            assetInfo.name == 'recordingAudioWorklet' ||
            assetInfo.name == 'renderingWorker' ||
            assetInfo.name == 'flacEncodingWorker' ||
            assetInfo.name == 'ringBufferBackedWorklet' ||
            0
          ) {
            return 'assets/[name].js'
          }
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
  worker: {
    plugins: () => [wasm() as PluginOption],
    format: 'es',
  },
})
