# SoundEtch

Web audio recorder and editor

## Timeline display modes

Use each track's three-dots menu to switch between its waveform and a WebGPU-rendered Viridis spectrogram. The selected mode is session-only and resets to the waveform when a project is opened or the page is reloaded. If WebGPU is unavailable, the spectrogram view keeps its editing overlays on a minimum-dB background; switching back to the waveform remains available.
