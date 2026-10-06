# SoundEtch

Web audio recorder and editor

## Timeline display modes

Use each track's three-dots menu to switch between its waveform and a WebGPU-rendered spectrogram. The selected mode is session-only and resets to the waveform when a project is opened or the page is reloaded. If WebGPU is unavailable, the spectrogram view keeps its editing overlays on the selected color scheme's minimum-dB background; switching back to the waveform remains available.

Open **Settings** from the application menu to configure spectrogram rendering and analysis. Color schemes include Viridis (default), Magma, Inferno, and Grayscale. FFT size (default 2,048 samples), analysis window (Blackman, Blackman-Harris, or Hann), hop size (512 samples), mel-frequency bands (128), the color scheme, and the minimum-level slider (default -96 dB) are saved in the browser and apply to all spectrogram tracks. Analysis changes clear the in-memory spectrogram tile cache; changing only the color scheme redraws cached tiles without recomputing them. Audio and waveform rendering are unchanged.

## Transcription timeline overlays

Clips can store sparse, ordered transcription ranges in clip-source samples. Every placement projects the same ranges onto its timeline position, preserving alignment through moves, splits, trims, repeated placements, waveform mode, and spectrogram mode. Range labels and their real start/end boundaries are clipped to the visible placement without filling untranscribed gaps or creating boundaries at trim and viewport edges.

Transcription ranges persist with the clip in IndexedDB and project archives. Clips created by older versions load with an empty transcription. This release provides a read-only timeline display and data model; it does not include transcript generation or editing controls.
