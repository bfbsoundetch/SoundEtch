# SoundEtch

Web audio recorder and editor

## Private feedback

**Send Feedback…** in the application menu opens a separate, no-login feedback page. The action is disabled until the editor is built with an absolute HTTPS `VITE_FEEDBACK_URL` (HTTP localhost is allowed only in development). The separate page keeps third-party verification out of the editor's cross-origin-isolated audio environment.

Production feedback is live at [soundetch-feedback.bfb-e2a.workers.dev](https://soundetch-feedback.bfb-e2a.workers.dev/). `.env.production` sets that URL for production editor builds. The editor remains on the existing assets-only Worker `damp-block-3bec`, serving `soundetch.org` and `www.soundetch.org` with its original cross-origin isolation headers.

The optional log attachment controls on the feedback page explain how to open **Logs**, choose **Download .txt**, and select the export. File selection only reads the text locally. Review/redact the preview and check **Include these logs** before sending. Messages are limited to 4,000 characters and UTF-8 logs to 64 KiB; filenames, project/audio files, names, and email addresses are not requested or attached automatically. Feedback is private to the operator, not anonymous from Cloudflare.

`feedback-worker/` serves the form and `/api/feedback` from one Worker origin. Every accepted report requires server-side Turnstile verification bound to that hostname and the `feedback` action. One atomic D1 INSERT enforces 3 accepted reports per IP per rolling hour and 100 per UTC day, including concurrent requests. Only a keyed IP hash is stored. A daily 03:17 UTC job removes reports older than 30 days (up to approximately 31 days live); deleted data can remain in D1's 7-day recovery history.

### Feedback deployment

Use **Workers Free**, **D1 Free**, and **Turnstile Free**; do not enable a paid plan. Free quota exhaustion makes intake unavailable rather than authorizing additional spending. Rejected requests still consume the shared Workers account request allowance, so this does not guarantee availability during an attack. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [D1 quotas](https://developers.cloudflare.com/d1/platform/pricing/) · [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)

Node 22+ and the installed Wrangler dependency are required. `.yarnclean` must not remove `assets` directories: Miniflare needs its packaged runtime assets.

The production Worker and the private D1 database, both named `soundetch-feedback`, are already provisioned. Routine feedback-service updates use `yarn feedback:deploy`; editor builds use `yarn build --base /` and the committed production URL. The steps below are for provisioning a new environment, not recreating the existing production resources.

1. Authenticate with Cloudflare, verify the account is on Workers Free, and confirm available D1/Cron capacity. Create the database with `yarn wrangler d1 create soundetch-feedback`; put its returned UUID in the `d1_databases[0].database_id` field in `feedback-worker/wrangler.jsonc`. Do not reuse unrelated resources with the same name.
2. Apply `yarn wrangler d1 migrations apply DB --remote --config feedback-worker/wrangler.jsonc`, then run `yarn feedback:deploy` to obtain the actual `workers.dev` hostname. The form remains unavailable until its verification configuration is supplied.
3. Create a Free **Managed** Turnstile widget allowing exactly that hostname, with pre-clearance disabled. Set `TURNSTILE_SITE_KEY` in the Worker config's public `vars`; keep `TURNSTILE_ACTION` as `feedback`. Store its matching secret and a separate random IP-hashing secret:

   ```sh
   yarn wrangler secret put TURNSTILE_SECRET_KEY --config feedback-worker/wrangler.jsonc
   openssl rand -hex 32
   yarn wrangler secret put IP_HASH_SECRET --config feedback-worker/wrangler.jsonc
   yarn feedback:deploy
   ```

   Use the generated 64-character value for `IP_HASH_SECRET`. Neither secret belongs in a `VITE_*` variable, browser bundle, committed file, or report.
4. Verify a real submission and private D1 retrieval, then build the editor with the real feedback origin: `VITE_FEEDBACK_URL="https://YOUR-FEEDBACK-HOST/" yarn build --base /`. Publish through the editor's existing static deployment. Do not enable the link before the service works.

Read reports through the authenticated D1 dashboard, not a public endpoint:

```sql
SELECT id, datetime(created_at, 'unixepoch') AS received_at, message
FROM feedback ORDER BY created_at DESC LIMIT 50;
SELECT message, logs FROM feedback WHERE id = '<selected-uuid>';
```

### Feedback development and verification

Put a real development widget's `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_ACTION="feedback"`, and a nonproduction `IP_HASH_SECRET` in ignored `feedback-worker/.dev.vars`. Allow the development hostname on that widget. Run `yarn wrangler d1 migrations apply DB --local --config feedback-worker/wrangler.jsonc`, then `yarn feedback:dev`. For the editor entry point, use `VITE_FEEDBACK_URL=http://localhost:8787/ yarn dev`.

`yarn test feedback-worker/index.test.js` uses the real Worker, assets, migrations, and isolated D1 through Wrangler's test harness; only outbound Siteverify responses are simulated. It covers admission caps/concurrency, input and wire-size boundaries, verification failures and replay, private storage, and retention.

Cloudflare's public dummy keys are not a valid end-to-end substitute for the required hostname/action binding: the observed dummy Siteverify response reported `example.com` and omitted `action`. Keep the production checks intact. Browser-flow verification can isolate external verification in a temporary test harness, but live end-to-end acceptance requires a genuine configured widget. No test bypass is included in the Worker.

## Video export

Choose **Video - MP4 Visualizer** in Publish Settings to export a 1920×1080 YouTube or 1080×1920 TikTok video at 60 fps. Both layouts show one oscilloscope trace from the final rendered mix, including track gain, pan, mute/solo, and effects.

Each frame plots every signed PCM sample in its approximately 16.67 ms window. Windows remain contiguous across render chunks, selected-region exports start at the selected sample, and the last window contains only the remaining samples. The fixed ±1 full-scale grid preserves level changes; silence is flat. Stereo uses the mono fold-down `(L + R) / 2`, so opposite-phase channels cancel in the trace while the exported audio remains stereo.

Only track names and amplitude-axis ticks are labeled; no mix or timing text appears below the oscilloscope. Export progress advances after each encoded video frame, even within a large audio-render chunk, and reaches 100% only after MP4 finalization.

The trace uses pre-AAC PCM. MP4 audio still uses the browser's AAC encoder or the existing AAC fallback; encoder priming/padding can introduce playback delay and a padded audio tail.

## Export loudness

**Loudness** in Publish Settings sets the integrated loudness (ITU-R BS.1770-4 / EBU R128) of WAV, FLAC, MP3, Opus and MP4 exports: Off (the mix level, default), −14 LUFS (music streaming), −16 LUFS (podcasts) or −23 LUFS (broadcast). The mix renders once into a temporary file in browser storage while its gated loudness is measured ("Measuring loudness..."), then streams back with gain `target − measured` through a 4×-oversampled true-peak lookahead limiter with a −1 dBTP ceiling. Mono exports are measured as one channel. Project audio, track gain and Freeze are unchanged.

The gain is computed before limiting. When limited peaks carry much of the program's energy, the result lands below the target. The limiter detects true peaks with a 145-tap Kaiser-windowed interpolator, so exports hold the −1 dBTP ceiling to within 0.1 dB as measured by ffmpeg's `ebur128`, including on full-band noise.

## Timeline display modes

Use each track's options menu (three dots) to switch between its waveform and a WebGPU-rendered spectrogram, rename the track, show or hide its transcript, or change its height. The selected mode is session-only and resets to the waveform when a project is opened or the page is reloaded. If WebGPU is unavailable, the spectrogram view keeps its editing overlays on the selected color scheme's minimum-dB background; switching back to the waveform remains available.

Open **Settings** from the application menu to configure spectrogram rendering and analysis. Settings are grouped into collapsed, expandable sections. Color schemes include Viridis (default), Magma, Inferno, and Grayscale. FFT size (default 2,048 samples), analysis window (Blackman, Blackman-Harris, or Hann), hop size (512 samples), mel-frequency bands (128), the color scheme, and the minimum-level slider (default -96 dB) are saved in the browser and apply to all spectrogram tracks. Analysis changes clear the in-memory spectrogram tile cache; changing only the color scheme redraws cached tiles without recomputing them. Audio and waveform rendering are unchanged.

Static `index.html` presentation and timeline styling live in `index.css`, including the reusable SVG icon sprite. Visibility uses semantic attributes and state selectors; controllers retain runtime geometry and bind dynamic colors through CSS custom properties. The favicon's embedded SVG keeps its own styles because it is a separate document. The ruler's `--timeline-label-font-size` also drives its tick-spacing and keyboard-step calculations.

The **Downloaded models** settings section reports the persistent browser-cache footprint of DeepFilterNet, Granite, and Silero VAD separately. **Unload** removes that model's cached files, including stale Granite or VAD revision caches, without interrupting a model runtime already in use. The browser downloads those files again when a later runtime needs them.

DeepFilterNet's `df_bg.wasm` and `DeepFilterNet3_onnx.tar.gz` are served from `noisereduction/` under Vite's deployment base (`import.meta.env.BASE_URL`). The configured default is `/soundetch`; for an origin-root deployment such as `https://soundetch.org/`, build with `yarn build --base /`. Resource paths resolve relative to that base, preserving subpaths without turning a root base into a protocol-relative hostname.

`df_bg.wasm` is built by the DeepFilterNet fork's `scripts/build_wasm_package.sh`. The fork patches `tract-linalg` with WebAssembly SIMD matrix kernels, which run the noise remover more than twice as fast as tract's generic kernels with bit-identical output. Its URL carries a build version (`?v=…`); fetching a new build deletes previously cached builds of the file.

## Effects

A track's **Effects** panel shows its chain from left to right. Each effect's controls are stacked below its name: **Bypass**, **Automate**, **Move left**, **Move right**, and **Remove**. **Bypass** is a toggle; a bypassed effect is labeled _Bypassed_, keeps its settings and automation, and stays in the chain. Bypassing is undoable and saved with the project.

During playback, toggling bypass takes effect immediately. Each effect sits between two unity-gain junctions; bypass disconnects both junctions from the effect and routes the signal straight to the next effect, so the effect's own nodes are never torn down. The output junction is disconnected before the input, so the effect is never pulled without input. This matters because Chrome permanently stops an AudioWorklet whose `process()` returns `false`, and the noise remover's worklet does that when its input is empty. Exports skip bypassed effects.

Exports and Freeze hand rendered audio to the encoder, and so advance their progress, at least every 100 ms, even while a slow effect such as the noise remover takes seconds per render chunk.

## Meetings

Whoever creates a meeting hosts it. The invite link always carries the host's id, including the copy each guest sees. Opening the link asks the host to let you in: the guest sees **Waiting for host _name_ to let you in…** until the host chooses **Admit** or **Deny** in the meeting room. Each request also raises a notification, so the host notices it outside the meeting room, and an admitted guest gets one too. A meeting holds the host and up to three guests; once it is full, remaining and later requests are turned away and the host is told.

Every member connects directly to every other member. If a newly admitted guest cannot reach someone, the host removes that guest and everyone is notified. Closing the meeting tab leaves the meeting immediately, like **Disconnect**. Everyone is notified when their connection to a member is interrupted, and again once it is restored; a member (or waiting guest) whose connection stays interrupted for 5 seconds is removed, which also covers crashes and lost networks. If the host leaves, the others stay connected and are told that no one new can join.

## Keyboard and assistive technology

Each track has a focusable timeline control. Left/Right move the cursor by one ruler tick, Page Up/Page Down by one labelled interval, and Home/End go to the start and end. Hold Shift to select; Alt+Shift+Up/Down adds the neighbouring track to the selection, Ctrl/⌘+A selects the whole track, Delete cuts the selection, Escape clears it, and +/− zoom around the cursor. Shift+F10 or the Menu key opens the menu a right-click opens there: selection actions, clip actions (split, move or trim by entering a time, move to a new track, select, info, delete), or paste and go-to-time on an empty stretch. The zoom, scroll, and **Go to time…** buttons above the track headers work with a single click.

In a track's options menu, Up/Down move through the visible actions, Home/End go to the first/last action, and Escape closes the menu. **Show transcript** is available only when the track has a placed transcript; it becomes **Hide transcript** while that track's panel is open.

Ctrl/⌘+X cuts the timeline selection. Timeline copy, cut, paste, and undo shortcuts are ignored while focus is in a text field, a select, or an open dialog, and Ctrl/⌘+C copies selected text normally.

In the **Transcript** panel, the arrow keys, Home, and End move between words, Shift extends the timeline selection word by word, and Enter or Space moves the cursor to the focused word. F2 edits the selected text or focused word; Ctrl/⌘+Enter applies the edit, and Escape cancels it.

Screen readers hear status changes: transport state, recording countdowns, edits such as cut, paste, undo, and redo, notifications, processing progress in 10% steps, and meeting joins and departures. Error notifications stay until dismissed with their close button or Escape; other notifications pause while hovered or focused. Escape also hides an open tooltip.

## Transcription timeline overlays

Tracks with transcription show a dedicated lane below the waveform or spectrogram, keeping labels clear of the audio display. Every placement projects the clip's sparse, ordered source-sample ranges onto its timeline position, preserving alignment through moves, splits, trims, repeated placements, and display-mode changes. Range labels and their real start/end boundaries are clipped to the visible placement without filling unlabeled stretches or creating boundaries at trim and viewport edges. Silence and untranscribed ranges carry muted italic labels such as `[silence 1.2s]`, measured over the visible placement.

Transcription ranges persist with the clip in IndexedDB and project archives. Clips created by older versions load with an empty transcription.

Click a transcript interval in the timeline lane to open the **Transcript** panel and select that specific placed occurrence, scrolling it toward the vertical center of the panel. When stopped or monitoring, this also selects its trim-clamped timeline interval. The panel lists every placed occurrence in timeline order, including repeated and offscreen placements; trims clamp each atom's interactive timing. Persisted multiword phrases remain one timed atom.

While stopped or monitoring, select text in the panel and choose **Edit text**, centered on the selection, to correct it. Applying changed text replaces the selected source interval with one timed chunk, including any pauses between its selected words, without changing audio or rerunning alignment. Unchanged fields keep their original word timing; an empty replacement removes the selected text without cutting audio. Edits save with the project and support undo/redo. Repeated placements share their clip's correction, and editing a trim-clipped word preserves its full source timing. Selections spanning separate clips or disjoint source intervals show one field per source range, applied together as one undoable edit. Line breaks stay within the replacement chunk.

Closing the edit dialog restores the transcript selection: Apply selects the replacement chunk, while Cancel and Escape restore the original selected atoms. The timeline selection stays unchanged.

Drag the shared bottom panel's top bar or centered grip to switch between half-screen height and full height below the main header. An upward drag of at least 24px selects full height; a downward drag of at least 24px selects half height, without needing to cross the midpoint. Smaller gestures keep the current size. The panel follows the pointer, then eases into its chosen size over 100ms on release while the timeline boundary moves with it; no intermediate height is retained. Full height has no panel shadow. Reduced-motion preferences disable the animation. Viewport/header changes update the bounds without cancelling an active drag, and tracking continues outside the moving header or after pointer-capture loss until release. A cancelled gesture or window focus loss restores the previously chosen size.

Dragging downward stops at half height; only the close button dismisses the panel. The chosen half/full size is retained across view changes and reopening while the app stays open. With the grip focused, Up or End selects full height, and Down or Home selects half height. The size button beside the close button switches between the two heights with one click.

VAD-detected speech regions appear as separate paragraphs, including pauses whose inference padding overlaps. The 20-second inference chunks do not introduce paragraph breaks. Each word retains its source-region onset, preserving paragraph membership through trims, splits, repeated placements, persistence, and undo/redo. Previously generated transcripts without this metadata remain one paragraph until regenerated.

Generation also records the audio that has no recognized word, so the transcript accounts for pauses and sounds as well as words. **Silence** is a run of at least 500 ms of 32 ms frames in which Silero is below its 0.35 speech-end threshold and the frame RMS is below the larger of 0.003 and a tenth of the interval's loudest frame; frames touching a word or untranscribed range never count. It covers quiet audio between VAD regions and pauses inside them. **Untranscribed** sound lies inside the padded VAD segments where no word explains it: a hesitation, a word Granite dropped, or noise Silero takes for speech. Its speech-mask frames, bridged over dropouts of up to two frames and kept clear of the 250 ms before each word, are trimmed to their first and last energy-supported frames and must then last 300 ms with 300 ms of consecutive Silero support. The trim keeps Silero's few hundred milliseconds of lag after speech stops from reading as sound; those lagging frames, and loud non-speech that Silero ignores, stay unlabeled rather than becoming silence. When a selection yields no words, a notification reports either no speech or speech without recognized words.

The panel shows these ranges inline as `[silence 1.2s]` and `[untranscribed 0.4s]` atoms (from a minute, whole seconds such as `[silence 2m 5s]`). They click, select, navigate by keyboard, and highlight during playback like words, so a native or keyboard selection can cover exactly a pause or an unrecognized sound. Untranscribed sound joins the paragraph of its nearest VAD region; silence ends the paragraph it follows, or opens the transcript when it comes first. Pause commas and paragraph punctuation are computed from the words alone.

The panel formats each paragraph for reading at display time; stored transcript text stays raw, so earlier transcripts pick up the formatting and timeline-lane labels keep the raw words. A bare `O` reads as `oh`, `i` and a curated list of proper nouns and acronyms are capitalized (multiword names such as `new york city` match longest first), and the first word is capitalized. A pause of 350 ms or more between words adds a comma, except inside a matched name. A paragraph that opens with an auxiliary verb followed by a subject (`is it`, `can we`, `do you`) ends with `?`; `do` and `have` count only before a personal pronoun, so `do it now` stays a statement. Every other paragraph ends with `.`. Words that already end in punctuation get no extra mark. Punctuation sits outside the word, so highlights, focus, and selections cover only timed words. Contractions are not restored.

During playback, the panel highlights the current timed atom, including silence and untranscribed atoms, in green and scrolls newly active occurrences into view without changing the native text selection. Unlabeled stretches between atoms clear the playback highlight, pausing retains it, and stopping clears it. Repeated and trimmed occurrences follow their placed timings; a persisted multiword phrase remains one timed atom.

Click a panel atom to reveal its occurrence and move the cursor to its start when stopped or monitoring. During playback, recording, or their paused states, clicks only reveal the occurrence without changing transport, cursor, or the timeline selection. Drag native text selection to select complete timed atoms on that track; keyboard text selection also updates the timeline range. While stopped or monitoring, panel drags enter pointer selection mode, and selecting a time range clears the position marker just like a timeline drag. Release, blur, closing the panel, or replacing its transcript data ends the panel gesture. Timeline selections appear in the panel as one continuous native text range from the first to the last intersecting atom, including intervening spaces, without snapping timeline boundaries to words. The panel follows committed edits and undo/redo, and closes when its track or project is removed.

To generate a transcript, select a region on one or more tracks, right-click the selection, and choose **Generate transcription**. Generation runs locally in the browser with the English-only IBM Granite Speech model and Silero VAD speech segmentation. Word boundaries come from transcript-conditioned CTC posterior medians refined by bounded Silero and energy evidence. The first run downloads about 313 MB: the derived timing graph, model weights, and matching frontend/vocabulary assets from one public, commit-pinned Hugging Face model repository, plus a separate 0.6 MB pinned Silero voice-activity model. Cache persistence is best-effort and never blocks model startup. Speech regions are detected with Silero VAD hysteresis and padded by 750 ms before and 300 ms after detected speech. Padded speech longer than 20 seconds is split into inference chunks of at most 20 seconds. Granite transcribes a word cut by a chunk boundary in both chunks, often together with its neighbors, so each cut falls in the middle of the longest pause (Silero probability below 0.35) within the 5 seconds before the chunk's 20-second limit, or, when speech never pauses there, in the least speech-like 32 ms frame. ONNX Runtime's WebAssembly runtime is initialized with the Silero model before WebGPU setup, without a deadline; Granite WebGPU setup and warmup then have a 30-second deadline. A WebGPU error falls back to WASM in the same worker. A missed deadline restarts the transcription in a fresh WASM-only worker, and WebGPU stays disabled until the page is reloaded.

The processing dialog shows **Finding speech segments (VAD)…** while Silero scans each selected source interval, with a percentage based on the audio frames processed. It then switches to **Generating transcription** and resumes the overall transcription percentage. VAD progress starts again for each selected interval.

In cross-origin-isolated pages ONNX Runtime uses up to four WebAssembly threads: the transcription worker plus a pool of nested pthread workers. Emscripten ignores a pool worker that fails to load and would otherwise wait forever for it, so the transcription worker detects that failure and the transcription restarts in a fresh single-threaded worker. Later transcriptions stay single-threaded until the page is reloaded; WebGPU inference is unaffected.

ONNX Runtime 1.26.0's JavaScript glue remains packaged with the application, so its pthread workers load from the same origin. Its matching WASM binary is fetched over HTTPS from [assets.soundetch.org](https://assets.soundetch.org/onnxruntime-web/1.26.0/ort-wasm-simd-threaded.jsep.wasm?sha256=411b39a77bb006ce0cf17b30c978c66a130ebb2ba39c8dfdbdc9c1c5a251ae76), keeping the oversized binary out of the Cloudflare Workers static-asset upload. The fixed `sha256` query identifies the verified binary and provides a stable CDN cache key; it is not a random per-request cache buster or a browser integrity check. The host must return `Content-Type: application/wasm` and allow cross-origin GET/HEAD requests. Preserve the application's COOP/COEP headers for threaded inference. Publish a new versioned asset and update the package version and hosted URL/checksum together when upgrading ORT; do not overwrite runtime files used by released clients.

The built application was verified with a successful hosted-WASM request, four-thread ORT initialization, all three local pthread workers, and timed JFK transcription. No ORT WASM binary was emitted into `dist/`; all 54 deployable files were below the 25 MiB per-file limit (largest: 7,983,136 bytes). If CORS settings change after the CDN has cached an asset, purge the relevant [Origin-aware cache keys](https://developers.cloudflare.com/cache/how-to/cache-keys/) rather than relying on a browser refresh.

Transcription logs timestamped `[Granite]` diagnostics to the browser console at the Info level: per-asset cache hits, downloads, and cache writes; ONNX Runtime WebAssembly compilation and pthread-worker startup; Granite session creation and warmup; and per-segment inference. Any stage running longer than 5 seconds logs a heartbeat every 5 seconds, listing unfinished cache writes.

Audio imports wait for browser-storage writer initialization before streaming decoded samples, so a first import in a fresh browser profile cannot complete as an empty clip.

Regeneration replaces every transcript word that intersects the selected clip-source interval, including a word that straddles a selection boundary, while preserving transcript ranges wholly outside it. Silence and untranscribed ranges that cross the interval keep their parts outside it, and silence touching regenerated silence merges into one range. Repeated placements of one clip share the same clip-owned transcript. Granite emits one sharp CTC spike per word, usually near its onset, so word timing combines that spike with speech activity (the speech mask plus energy relative to nearby speech). A word starts at its spike, or 64 ms before speech resumes when its spike sits in a pause; it ends where its speech stops, bridging quiet stretches of up to 96 ms (stop closures) or up to 192 ms while the word is still shorter than its letters suggest (quiet fricatives such as the /st/ of "states"). Granite emits a word once it has identified it, so a word of six or more letters can spike well after it begins, such as on the "-lation" of "legislation". The derived timing graph therefore also exports Granite's non-blank vocabulary distribution: when the word's own prefix pieces ("legisl", "ag" for "agriculture") hold at least 40% of it, and more than the previous word's pieces, at least three 80 ms frames before the spike (and from the second frame after the previous word's spike), the word starts in the middle of the first such frame. An end never passes the next word's start or a length cap of 90 ms per letter (at least 300 ms). Granite can also emit a segment's first word in the silence at the segment's start (the 750 ms VAD pre-roll or a 20-second chunk's leading pause); such a word starts at the nearest supported speech before the next word, or, when the next word's spike already sits where speech begins, at that speech. Boundaries are estimates on 32 ms acoustic frames, not phoneme-accurate alignments.

## Granite model-bundle publication

`yarn prepare:timing` always derives the timing graph from IBM Space revision `245e1e52c6fc01ba065c35b4af884d89cdca60de` and atomically stages it at `tmp/granite-publish/onnx-ctc/granite_timing_v2_q4f16.onnx`. It preserves upstream metadata/notices and appends SoundEtch's modification notice. It does not read a local source graph or write into `public/granite/`; publication staging is separate from runtime hosting.

The complete bundle is published at [soundetch/soundetch-granite-speech-5.0-470m-turboctc-onnx](https://huggingface.co/soundetch/soundetch-granite-speech-5.0-470m-turboctc-onnx). The application pins all six Granite runtime files to commit [`ececda74536f9576a87a5d3e4371f4bb4fe83c98`](https://huggingface.co/soundetch/soundetch-granite-speech-5.0-470m-turboctc-onnx/tree/ececda74536f9576a87a5d3e4371f4bb4fe83c98), with revision-scoped Cache Storage. The former app-hosted graph has been removed; Granite model downloads require neither GitHub nor application-owned model hosting. Silero VAD keeps its separate pinned HF source. The ORT binary uses the runtime host described above; its JavaScript glue and SOXR remain packaged with the application.

### Licensing confirmation

IBM Granite maintainer [gsaon confirmed that all selected ONNX export and support files have an Apache 2.0 license](https://huggingface.co/spaces/ibm-granite/granite-speech-streaming-webgpu/discussions/2#6acd6c17d02d2f46a7b4ae77). The release includes the complete Apache `LICENSE`, SoundEtch-authored `NOTICE`, and a model card documenting provenance and modifications. Publisher authentication remains separate from licensing.

The reproduced graph size/hash have been explicitly approved. Structural verification passes at 1,691 nodes, the exact modification notice matches, and the inference graph is unchanged from the prior timing export apart from the added notice. The release check below enforces the approved values without padding the file or changing the notice.

### Stage and verify

From the project root, install the official publishing CLI into an isolated environment:

```sh
python3 -m venv tmp/hf-publish-venv
tmp/hf-publish-venv/bin/python -m pip install --upgrade huggingface_hub
export PATH="$PWD/tmp/hf-publish-venv/bin:$PATH"
yarn prepare:timing
hf download ibm-granite/granite-speech-streaming-webgpu \
  onnx-ctc/ctc_conformer_q4f16.onnx.data \
  onnx-ctc/frontend_config.json onnx-ctc/mel_filters.bin \
  onnx-ctc/stft_window.bin onnx-ctc/vocab.json \
  --repo-type space \
  --revision 245e1e52c6fc01ba065c35b4af884d89cdca60de \
  --local-dir tmp/granite-publish
node scripts/prepare-granite-timing.mjs --verify \
  tmp/granite-publish/onnx-ctc/granite_timing_v2_q4f16.onnx
wc -c tmp/granite-publish/onnx-ctc/*
shasum -a 256 tmp/granite-publish/onnx-ctc/*
```

The staging directory includes the six runtime files and complete root `LICENSE`, `NOTICE`, and `README.md` model card. The model card records the approved sizes/hashes, frontend/vocabulary requirements, four outputs, external-weight basename, provenance, and confirmed licensing. `--verify` checks graph structure and the exact modification notice, not the release hash; run the following release check too. It validates all six files against the approved size/hash manifest and rejects unexpected upload files. Abort publication on any mismatch.

```sh
tmp/hf-publish-venv/bin/python - <<'PY'
import hashlib
from pathlib import Path

stage = Path('tmp/granite-publish')
expected = {
    'granite_timing_v2_q4f16.onnx': (575061, '051cfe5a5fc10ae37f1ebea08dc5db428e89d9ceef88610faf5ebb8abfedea0b'),
    'ctc_conformer_q4f16.onnx.data': (311533568, 'bee3e56bee49991233ca64e755438d1dfbd90600d90af16b9e0388cca7294dbc'),
    'frontend_config.json': (303, '34b6d5aace683c15c8d74f6c1be6194bcd61347540ed3a0e45bbd171ba8df2a3'),
    'mel_filters.bin': (82240, '3e5145f681dd30339bb9ea60b366d78ff971de6aa0d210b45b4adcf859bb177d'),
    'stft_window.bin': (2048, 'b318e8ace5febc3997eb190be755063577693ed06da87629172c9b6913448e41'),
    'vocab.json': (177439, '738b24db3fb10d903b969273f206600917222001f3f161dbe2bbe7eb7dce1268'),
}
release_files = {'LICENSE', 'NOTICE', 'README.md'} | {f'onnx-ctc/{name}' for name in expected}
actual_files = {
    path.relative_to(stage).as_posix() for path in stage.rglob('*')
    if path.is_file() and not path.relative_to(stage).as_posix().startswith('.cache/huggingface/')
}
assert actual_files == release_files, actual_files ^ release_files
for name, (size, digest) in expected.items():
    path = stage / 'onnx-ctc' / name
    assert path.stat().st_size == size, f'Size mismatch: {name}'
    with path.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == digest, f'Hash mismatch: {name}'
    print(f'Approved release manifest matches: onnx-ctc/{name}')
print('Artifact checks passed; they do not establish redistribution permission.')
PY
```

Only `tmp/granite-publish/`, `tmp/hf-publish-venv/`, and `tmp/granite-verify/` are newly ignored; other `tmp/` content is not blanket-ignored. Before upload, require exactly the six files under `onnx-ctc/`, the three root release files, and CLI-generated `.cache/huggingface/` metadata. The CLI automatically excludes its download cache from uploads. Never include the virtual environment, publishing credentials, original graph, Space UI/application, punctuator, ONNX Runtime binaries, or Silero VAD.

### Publish only after licensing and artifact checks pass

Preserve applicable upstream notices and the licensing confirmation in the release model card/NOTICE. Verify the final inventory/hashes before every upload.

Authenticate only on the publishing machine (`hf auth login` if necessary), then run `hf auth whoami`. Default to that account's personal namespace; use an organization only when expressly selected and writable. Never put a publisher token in browser code or a `VITE_` variable.

For the currently authenticated personal account:

```sh
export HF_NAMESPACE=soundetch
export HF_REPO="$HF_NAMESPACE/soundetch-granite-speech-5.0-470m-turboctc-onnx"
hf repos create "$HF_REPO" --repo-type model --public
hf upload "$HF_REPO" tmp/granite-publish . --repo-type model \
  --commit-message "Publish SoundEtch Granite timing v2 q4f16"
hf models info "$HF_REPO" --json
```

Keep the repository public and ungated. If it already exists, verify that it is the intended model and already has the required visibility before reusing it. Do not expose a private repository or delete unrelated remote content. For an unrelated-name collision, append `-soundetch-timing-v2`; if that also collides, append the lowest unused integer suffix starting at `-2`. Permission errors do not justify changing ownership.

Record the full 40-character upload commit SHA from the upload result and model metadata, confirm it identifies that upload commit, and export it as `PUBLISHED_SHA`. Do not use floating `main` or a placeholder SHA. For a verified existing model repository, omit `hf repos create` and preserve all revisions used by released clients.

### Anonymous release proof

After a real upload, run this from the project root with `HF_REPO` and `PUBLISHED_SHA` exported. Explicit anonymous access and forced downloads prevent uploader authentication or a preexisting download cache from substituting for public accessibility:

```sh
tmp/hf-publish-venv/bin/python - <<'PY'
import filecmp
import os
import re
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_download

repo = os.environ['HF_REPO']
sha = os.environ['PUBLISHED_SHA']
assert re.fullmatch(r'[0-9a-f]{40}', sha), sha
info = HfApi(token=False).model_info(repo, revision=sha, files_metadata=True)
assert info.private is False and info.gated is False
assert info.sha == sha
stage = Path('tmp/granite-publish/onnx-ctc')
remote = {item.rfilename: item for item in info.siblings}
for name in ('granite_timing_v2_q4f16.onnx', 'ctc_conformer_q4f16.onnx.data',
             'frontend_config.json', 'mel_filters.bin', 'stft_window.bin', 'vocab.json'):
    source = stage / name
    path = f'onnx-ctc/{name}'
    assert remote[path].size == source.stat().st_size, path
    downloaded = hf_hub_download(repo_id=repo, filename=path, revision=sha,
                                token=False, force_download=True,
                                local_dir='tmp/granite-verify')
    assert filecmp.cmp(source, downloaded, shallow=False), path
    print(f'Public pinned download matches staging: {path}')
PY
node scripts/prepare-granite-timing.mjs --verify \
  tmp/granite-verify/onnx-ctc/granite_timing_v2_q4f16.onnx
```

For a subsequent release, pass this anonymous proof before updating the application repository ID, full SHA/cache revision, or expected artifact sizes. Preserve the pinned IBM generator provenance, exact external-weight basename, Cache Storage behavior, and separate VAD/runtime sources.

The current release was verified in a fresh, cross-origin-isolated Chromium profile using the selected WebGPU backend (Apple Metal-3). The JFK speech fixture produced the recognizable transcript in speech order, with timed lane boundaries and Transcript-panel playback highlighting. All six initial Granite downloads used the pinned HF model repository without authorization or CORS/COEP failures; no app-origin or GitHub Granite requests occurred. After cache-write-finished diagnostics, Settings reported Granite at 297.9 MiB on disk. Reloading destroyed the worker; a new transcription logged six persistent Granite cache hits and made no remote model requests. Granite-only Unload left VAD cached and the loaded runtime intact; another reload/transcription downloaded all six Granite files again while VAD remained a cache hit. The five existing model-cache/transcription test files passed (47 tests), and the production build passed.

Use the official [CLI](https://huggingface.co/docs/huggingface_hub/guides/cli), [upload](https://huggingface.co/docs/huggingface_hub/guides/upload), and [model-card](https://huggingface.co/docs/hub/model-cards) documentation. Public storage is [best-effort](https://huggingface.co/docs/hub/storage-limits), with anonymous-download [rate limits](https://huggingface.co/docs/hub/rate-limits). Preserve revisions used by released clients; later releases need a complete compatible bundle and an intentional SHA/cache-revision update.
