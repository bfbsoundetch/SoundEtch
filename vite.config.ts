import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'
import { PluginOption } from 'vite'
import wasm from 'vite-plugin-wasm'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/soundetch',
  define: {
    global: {}, // Or global: 'window'
  },
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm'],
    alias: {
      assert: fileURLToPath(new URL('./src/global/EmptyNodeAssert.ts', import.meta.url)),
    },
  },
  esbuild: {
    target: 'es2022',
    supported: {
      'top-level-await': true,
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        about: fileURLToPath(new URL('./about.html', import.meta.url)),
        dropboxAuth: fileURLToPath(new URL('./dropbox-auth.html', import.meta.url)),
        playingAudioWorklet: fileURLToPath(
          new URL('./src/playback/FilePlayingAudioWorkletProcessor.js', import.meta.url),
        ),
        recordingAudioWorklet: fileURLToPath(
          new URL('./src/recording/DiskRecordingAudioWorkletProcessor.js', import.meta.url),
        ),
        ringBufferBackedWorklet: fileURLToPath(
          new URL('./src/noisereduction/RingBufferBackedAudioWorkletProcessor.js', import.meta.url),
        ),
        hqCaptureWorklet: fileURLToPath(new URL('./src/remote/HighQualityCaptureProcessor.js', import.meta.url)),
        renderingWorker: fileURLToPath(new URL('./src/rendering/RenderingJob.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (assetInfo) => {
          if (
            assetInfo.name == 'playingAudioWorklet' ||
            assetInfo.name == 'recordingAudioWorklet' ||
            assetInfo.name == 'renderingWorker' ||
            assetInfo.name == 'ringBufferBackedWorklet' ||
            assetInfo.name == 'hqCaptureWorklet' ||
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
  test: {
    environment: 'node',
    globals: true,
  },
})
