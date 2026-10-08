# SoundEtch

Web audio recorder and editor

## Timeline display modes

Use each track's three-dots menu to switch between its waveform and a WebGPU-rendered spectrogram. The selected mode is session-only and resets to the waveform when a project is opened or the page is reloaded. If WebGPU is unavailable, the spectrogram view keeps its editing overlays on the selected color scheme's minimum-dB background; switching back to the waveform remains available.

Open **Settings** from the application menu to configure spectrogram rendering and analysis. Color schemes include Viridis (default), Magma, Inferno, and Grayscale. FFT size (default 2,048 samples), analysis window (Blackman, Blackman-Harris, or Hann), hop size (512 samples), mel-frequency bands (128), the color scheme, and the minimum-level slider (default -96 dB) are saved in the browser and apply to all spectrogram tracks. Analysis changes clear the in-memory spectrogram tile cache; changing only the color scheme redraws cached tiles without recomputing them. Audio and waveform rendering are unchanged.

## Transcription timeline overlays

Clips can store sparse, ordered transcription ranges in clip-source samples. Every placement projects the same ranges onto its timeline position, preserving alignment through moves, splits, trims, repeated placements, waveform mode, and spectrogram mode. Range labels and their real start/end boundaries are clipped to the visible placement without filling untranscribed gaps or creating boundaries at trim and viewport edges.

Transcription ranges persist with the clip in IndexedDB and project archives. Clips created by older versions load with an empty transcription.

To generate a transcript, select a region on one or more tracks, right-click the selection, and choose **Generate transcription**. Generation runs locally in the browser with the English-only IBM Granite Speech model and Silero VAD speech segmentation. Word boundaries come from transcript-conditioned CTC posterior medians refined by bounded Silero and energy evidence. The first run downloads about 313 MB: a 0.6 MB derived timing graph from the same origin, the pinned 312 MB model weights and support assets, and a 0.6 MB voice-activity model. Cache persistence is best-effort and never blocks model startup. Speech regions are detected with Silero VAD hysteresis and padded by 750 ms before and 300 ms after detected speech. ONNX Runtime's WebAssembly runtime is initialized with the Silero model before WebGPU setup, without a deadline; Granite WebGPU setup and warmup then have a 30-second deadline. A WebGPU error falls back to WASM in the same worker. A missed deadline restarts the transcription in a fresh WASM-only worker, and WebGPU stays disabled until the page is reloaded.

In cross-origin-isolated pages ONNX Runtime uses up to four WebAssembly threads: the transcription worker plus a pool of nested pthread workers. Emscripten ignores a pool worker that fails to load and would otherwise wait forever for it, so the transcription worker detects that failure and the transcription restarts in a fresh single-threaded worker. Later transcriptions stay single-threaded until the page is reloaded; WebGPU inference is unaffected.

Transcription logs timestamped `[Granite]` diagnostics to the browser console at the Info level: per-asset cache hits, downloads, and cache writes; ONNX Runtime WebAssembly compilation and pthread-worker startup; Granite session creation and warmup; and per-segment inference. Any stage running longer than 5 seconds logs a heartbeat every 5 seconds, listing unfinished cache writes.

Audio imports wait for browser-storage writer initialization before streaming decoded samples, so a first import in a fresh browser profile cannot complete as an empty clip.

Regeneration replaces every transcript word that intersects the selected clip-source interval, including a word that straddles a selection boundary, while preserving transcript ranges wholly outside it. Repeated placements of one clip share the same clip-owned transcript. Word boundaries are posterior medians on the 80 ms CTC frame grid, refined within bounded acoustic limits; they are estimates, not phoneme-accurate alignments.
