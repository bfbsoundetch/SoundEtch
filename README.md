# SoundEtch

SoundEtch is an audio and podcast recorder/editor that runs completely inside your browser.

Record, upload, edit, and transcribe with no setup and no subscription.

Your media stays yours.

Try it at [soundetch.org](https://soundetch.org).

## Features

- Record your microphone, browser, or computer audio instantly.
- Invite guests to record with you.
- Remove noise, rearrange and find your sound with robust editing tools.
- Upload additional media. Dozens of supported formats.
- Fast, accurate speech-to-text.
- Text-based audio editing.
- Automatic saving; accidentally closing the page won't destroy your progress.

## Development

Detailed behavior, testing, and deployment documentation lives in [AGENTS.md](AGENTS.md).

## Acknowledgements

SoundEtch stands on the shoulders of many open-source projects. We are grateful to their authors and communities:

### Transcription

- [IBM Granite Speech 5.0 TurboCTC](https://huggingface.co/ibm-granite/granite-speech-5.0-470m-turboctc) — speech-to-text model
- [Silero VAD](https://github.com/snakers4/silero-vad) — voice activity detection
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) — runs the models in the browser
- [fft.js](https://github.com/indutny/fft.js) — fast Fourier transform

### Effects

- [AudioJS Dynamics](https://github.com/audiojs/dynamics) — the De-esser, Limiter, and Gate effects are adapted from it (MIT licensed, by Dmitry Iv)
- [WEQ8](https://github.com/teropa/weq8) — parametric equalizer
- [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) — noise reduction

### Media Import & Export

- [MediaBunny](https://mediabunny.dev/) — media processing, muxing, and encoding
- [web-demuxer](https://github.com/bilibili/web-demuxer) — demultiplexing of imported media files
- [LAME](https://lame.sourceforge.io/) — MP3 encoding (WebAssembly bridge from the MediaBunny project)
- [libFLAC](https://github.com/xiph/flac) — FLAC encoding
- [libopus](https://github.com/xiph/opus) and [libopusenc](https://github.com/xiph/libopusenc) — Opus encoding
- [wasm-audio-resampler](https://github.com/geekuillaume/wasm-audio-resampler) — sample-rate conversion, built on [SoXR](https://sourceforge.net/projects/soxr/)

### Audio Engine & Connectivity

- [@descript/web-audio-js](https://github.com/descriptinc/web-audio-js) — offline audio rendering
- [ringbuf.js](https://github.com/padenot/ringbuf.js) — real-time audio streaming between threads
- [PeerJS](https://peerjs.com/) — peer-to-peer connectivity

### Analysis

- [TF3RDL](https://ko-fi.com/tf3rdl) — spectrum analysis

WEQ8 and web-demuxer packages via patched forks. Full license texts: [Third-party notices](public/THIRD_PARTY_NOTICES.txt).
