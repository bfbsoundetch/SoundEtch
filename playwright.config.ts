import { defineConfig, devices } from '@playwright/test'

// Not Vite's default preview port, so a stale `yarn preview` of an older build is never mistaken for this one.
const PORT = 4180
const BASE_URL = `http://127.0.0.1:${PORT}/soundetch/`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Recording and playback run in real time; on small CI runners, parallel browsers would compete for the CPU.
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    permissions: ['microphone'],
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chromium's synthetic microphone (a periodic beep) in place of an OS device. Headless Chromium rejects
        // getUserMedia with NotSupportedError, even with the permission granted, unless the prompt is faked too.
        launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
      },
    },
  ],
  // Worklets and the rendering worker load from fixed ./assets/ paths that only a production build emits, so the tests
  // run against `vite build` output rather than the dev server. Preview reuses server.headers, keeping COOP/COEP.
  webServer: {
    command: `yarn vite build && yarn vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
