# SoundEtch

Web audio recorder and editor

## Timeline display modes

Use each track's three-dots menu to switch between its waveform and a WebGPU-rendered Viridis spectrogram. The selected mode is session-only and resets to the waveform when a project is opened or the page is reloaded. If WebGPU is unavailable, the spectrogram view keeps its editing overlays on a minimum-dB background; switching back to the waveform remains available.

Open **Settings** from the application menu to configure spectrogram analysis. FFT size (default 2,048 samples), analysis window (Blackman, Blackman-Harris, or Hann), hop size (512 samples), mel-frequency bands (128), and the minimum-level slider (default -96 dB) are saved in the browser and apply to all spectrogram tracks. Applying a change clears the in-memory spectrogram tile cache and redraws active spectrograms; audio and waveform rendering are unchanged.
