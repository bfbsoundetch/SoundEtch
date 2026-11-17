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

## Video import and preview

Use **Add clip → Local file** to import video, or the existing **Remote URL** option for a CORS-accessible media URL. Supported containers/codecs depend on the browser's decoders. Importing video opens the top panel's **Tracks** tab on the new track's **Video** view; the tab's **Track** selector previews any other track.

MP4/MOV imports match the selected media streams by container track ID, not by requiring both parsers to report the same stream count. Embedded cover artwork can appear as an extra FFmpeg video stream without blocking the actual movie. The preview retains the selected track even when a file contains multiple video tracks.

Embedded album artwork in MP3 and other audio-bitstream containers is not treated as timed video. These files use the audio import path without video sidecars or automatically opening the **Tracks** tab. Classification uses the parsed container, not the filename extension or caller-provided MIME type; actual unsupported video still produces an error rather than silently importing audio alone.

The picture follows playback, pause, timeline cursor dragging, and stopped selections. Video and its decoded audio share the same clip placement, so moving, trimming, splitting, or copying the clip retains the source timing. Gaps show black, metadata rotation is respected, and the picture fits without stretching. Sound comes only from the timeline mix, not a second video player.

A linked clip starts at the first presented sample of either stream. Samples the container excludes from presentation appear as negative timestamps and are dropped from both streams, for example AAC priming behind an MP4 edit list, or the frames a stream-copied trim keeps from the preceding key frame up to its cut. The clip therefore begins where other players begin playback, with audio and video still in sync. Audio that legitimately starts before or after the picture keeps that offset.

The preview keeps the footage open while its track's **Video** view is showing; minimizing the panel, switching tabs or views, or opening a view over the track releases it. Playback and forward scrubbing advance one running decoder instead of seeking for every position; a decoder restarts at the nearest key frame only when that skips meaningful work, such as a jump backward or far ahead. While scrubbing, the previous picture stays visible and frames appear as they decode instead of after the cursor stops. Resizing the panel redraws the current picture without decoding it again.

Tracks containing footage show a dedicated **Video** thumbnail lane above **Audio** (waveform or spectrogram). The shared clip header, trim handles, and context menu edit both channels together; double-click a thumbnail to select the linked clip. Their track header gains a **Video** button, below the track name, that opens the track's **Video** view in the top panel. Audio-only tracks keep their current layout, and silent footage is labeled **No audio**.

The filmstrip follows timeline scrolling and zooming. Footage gaps inside a clip show black; outside clips the lane stays transparent. Only visible thumbnail tiles on visible tracks are decoded, with a bounded image cache, and decoding continues while the timeline scrolls rather than restarting on every redraw. Each tile shows a key frame from its time span when the span contains one, which decodes without the rest of its group of pictures; otherwise it shows the frame at the span's midpoint. Removing footage or a track, or switching projects, releases the corresponding thumbnail resources. Video duration is exposed only after the original footage has finished copying, so thumbnails cannot open a partially written sidecar.

Original compressed footage is stored with the project and included in project archives. Video without audio keeps its full timeline duration without creating a PCM file. Import cancellation/failure removes the new media assets. Linked audio and video still edit together; Output scenes provide composition and MP4 footage export as described below.

**Manage Clips** shows the combined size of each clip's stored audio, waveform summary, and video files. Silent footage counts only its video files. This reflects project storage, not just the original import's compressed file size.

## Video recording

On the welcome page, choose **Record from microphone + camera** to enable both devices and start recording immediately.

**Record** captures every enabled video source along with the audio: the camera (**Enable Camera** in the header or the meeting room), screen/tab capture, and each meeting guest's camera and screen share. Each person or device records into one linked clip on its own new track, the same as the audio inputs: microphone with camera, a screen capture's audio with its picture, and each guest's audio with their video. A source without audio, such as a camera with the microphone off, records a video-only clip labeled **No audio**. The footage appears in the **Video** lane when recording stops, and the top panel's **Tracks** tab opens on its **Video** view.

Desktop Firefox can record microphone audio and screen/window video. Firefox [does not currently provide tab or system audio through screen sharing](https://bugzilla.mozilla.org/show_bug.cgi?id=1541425), so a screen share without audio remains recordable as video-only. SoundEtch shows a notice when no audio was shared, and the **Inputs** card labels it **No shared audio**. Enable the microphone separately for narration; to capture a tab's own sound, use a browser that supports tab audio sharing, such as Chrome or Edge, and enable audio in its share dialog. Microphone setup does not require the optional `MediaStreamTrack.getCapabilities()` API, which older Firefox versions lack.

Monitoring startup is serialized with audio-context replacement and shutdown, so Firefox finishes a pending `resume()` before recording closes that monitoring context. Active inputs return to monitoring after recording or playback stops; a monitoring request cannot replace or resume a paused recording/playback context.

Guests' video is recorded on the recording machine as it arrives over the meeting connection, like their audio, so its quality follows that connection. Guest streams are encoded at least 720 lines high, because they start small while the connection ramps up. The camera opens at up to 1280×720 and 30 fps. Footage is encoded to MP4 (H.264, or VP9/AV1 where H.264 encoding is unavailable), at most 1080 lines high with a key frame every 2 seconds, and later frames of a different size are fitted into the first frame's box.

Frames are placed by the recording's audio sample clock, so they follow the clip's audio through pauses and do not drift from it. Their capture timestamps remove delivery and main-thread delays. A first frame arriving within half a second is shown from the start of the recording. When a camera is turned off or a guest's video drops out mid-recording, the clip shows black until the source returns, which continues the same clip. Guests who join after recording starts are not recorded, as for audio.

Footage is written as a fragmented MP4, one fragment per key-frame interval, and each fragment is flushed to browser storage as soon as it is muxed. If the tab closes or crashes mid-recording, the next load of the project trims the file back to its last complete fragment and keeps that footage in the clip, so up to about 2 seconds before the close are lost; a linked clip's audio still runs to the close. A video-only clip with no complete fragment is removed with its track if that leaves the track empty. A recording finished normally also keeps the fragment index at the end of the file.

If browser storage fills during recording, the entire recording stops and a persistent error notification explains that space must be freed before recording again. Enabled inputs remain available for monitoring. Saved audio and complete video fragments are kept; the unwritten end is lost. Missing waveform-summary data is regenerated from the saved audio on reload. If storage also prevents saving recovered video's metadata, its recovery marker stays set so the next project load can recover the file after space is freed.

To exercise this in Chrome, open DevTools → **Application** → **Storage**, enable **Simulate custom storage quota**, and set a quota just above current usage. Record until the next write exceeds it, then check that Record/Play return, the error stays visible until dismissed, and the saved clip still plays after reload. Remove the quota override (or free space) and check that a new recording works.

Exporting or importing a project archive, and opening, creating, or deleting a project, first stop the recording and wait until its audio file is written and every clip's video is saved, so an archive never contains a recording still in progress. A new recording started right after Stop begins once the previous recording's audio is written.

## Video export

Choose **Video - MP4 Output Scenes** in Publish Settings to export the composed Output video with the rendered audio mix. **Landscape - YouTube 1920x1080** matches the 16:9 preview at 60 fps. **Portrait - TikTok 1080x1920** centers the same composition with black bars above and below it, rather than changing its framing.

Export follows scene boundaries, Single video or Side by side layouts, source choices, Fit/Crop framing, each video's crop position and scale, corner radius, margins, and the transitions between scenes. Linked clip timing and trims, source rotation, and display aspect ratio are preserved. Footage gaps remain black; missing or undecodable media stops the export with an error instead of silently substituting black. In portrait exports, transitions stay inside the centered 16:9 composition.

The audio uses the existing final mix, including track gain, mute/solo, effects, automation, and stereo pan when exporting stereo tracks, followed by the Output effect chain and its automation. A selected region exports that time range and mixes its selected tracks; video source choices remain those configured in Output. Frame timing follows the project sample clock across render chunks and selection offsets. Silent footage exports without requiring a source PCM file.

Source audio uses shared read-only access, so tracks and crossfades can reuse a clip during publishing, including while playback is reading it.

MP4 uses H.264 when available, with the existing MP4-compatible video codec fallbacks, and native or fallback AAC encoding. Browser video decoding/encoding and AAC decoding support are required. A short encoder timing probe measures AAC priming; MP4 presentation edits exclude that delay and trailing padding so the audio stays aligned with the pictures.

Export streams encoded data to the chosen file and bounds queued audio while video frames are rendered. Progress advances after each encoded picture and reaches 100% only after finalization and file commit. Canceling or encountering an error releases the decoders and audio worker and aborts the file transaction, preserving any existing output file.

## Publish tags

In Publish Settings, expand **Tags** below **Advanced** to edit **Title**, **Artist**, and **Album**, or choose **Add tag** for custom key/value pairs. Tags are collapsed by default and available for WAV, FLAC, MP3, Opus, and MP4. Title starts with the project name; empty values are omitted. Edits survive format changes and reopening the dialog, but reset when switching projects or reloading the page.

Values support Unicode. Tag names must be unique ignoring case and use printable ASCII other than `=` or `~`, matching the Vorbis comment restrictions shared by FLAC and Opus. WAV and MP3 use ID3v2.4 text frames (custom fields use TXXX); FLAC and Opus use Vorbis comments; MP4 uses keyed `mdta` metadata. Players may display only the common fields even when custom tags are embedded.

With `ffmpeg` and `ffprobe` installed, run `yarn vitest run src/encoders/MetadataFileWriters.test.ts src/encoders/NativeAudioTags.test.ts` for independent metadata/audio round-trip regressions. These integration tests skip when either system tool is unavailable.

## Export loudness

**Loudness** in Publish Settings sets the integrated loudness (ITU-R BS.1770-4 / EBU R128) of WAV, FLAC, MP3, Opus and MP4 exports: Off (the mix level, default), −14 LUFS (music streaming), −16 LUFS (podcasts) or −23 LUFS (broadcast). The mix, including the Output effect chain, renders once into a temporary file in browser storage while its gated loudness is measured ("Measuring loudness..."), then streams back with gain `target − measured` through a 4×-oversampled true-peak lookahead limiter with a −1 dBTP ceiling. Mono exports are measured as one channel. Project audio, track gain and Freeze are unchanged.

The gain is computed before limiting. When limited peaks carry much of the program's energy, the result lands below the target. The limiter detects true peaks with a 145-tap Kaiser-windowed interpolator, so exports hold the −1 dBTP ceiling to within 0.1 dB as measured by ffmpeg's `ebur128`, including on full-band noise.

## Dropbox backup

**Import / Export** can back up the current project to the user's Dropbox App Folder and restore any backup there as a new project. The section appears only in builds with `VITE_DROPBOX_APP_KEY` set to the app key of a Dropbox app registered with:

- Scoped access to an **App folder**, with the permissions `files.metadata.read`, `files.content.read`, and `files.content.write` checked and submitted on the **Permissions** tab. A token keeps the scopes the app had when the user connected, so after changing permissions, disconnect and connect again; SoundEtch names any missing permission when connecting or backing up.
- **Allow public clients (Implicit Grant & PKCE)** on.
- Redirect URIs for each deployment's `dropbox-auth.html`, e.g. `http://localhost:4173/soundetch/dropbox-auth.html` for `yarn preview` and `https://soundetch.org/dropbox-auth.html`.

The key is public under PKCE. **Connect Dropbox** opens Dropbox's authorization in a new tab, so the editor, and any recording in it, never navigates away. The editor keeps only a short-lived access token (about 4 hours, no refresh token) in its own IndexedDB database `soundetch-dropbox`; after it expires, **Reconnect Dropbox** continues where the backup stopped.

A backup is one folder per project and time, holding the project manifest, one file per stored project file, and a `backup.json` index written last; a folder without the index is incomplete and is not listed. Only 48 kHz projects without unrecovered video recordings can be backed up. Each upload is verified against its Dropbox content hash. Large files upload in 8 MiB chunks through upload sessions, and progress is saved after every acknowledged request: after a reload, a lost connection, an expired authorization, or a full Dropbox, **Resume Backup** sends only what Dropbox has not acknowledged. If a project file changes during the backup, the backup fails and its partial folder is removed. **Cancel Backup** also removes the partial folder.

Restoring checks free browser storage first, then verifies every file's size and content hash as it streams in. A failed restore leaves no project behind; a restore or archive import interrupted by closing the tab is hidden from the project list and deleted the next time the list loads while no import is running. Backups are managed, renamed, or deleted in Dropbox itself.

## Importing media

Drag one local media file onto the timeline, or onto the welcome area in an empty project, to use the same importer as **Add Clip → Local file**. The drop area gets a dashed outline while it can accept the file. Audio is placed on a new track at the current cursor position, not at the pointer's drop position, with the same import progress, cancellation, metadata, and error handling as the file picker.

File drops are available while stopped or monitoring, not during playback, recording, or another local-file import. Drop one file at a time; text and link drags are left alone.

## Selecting on the timeline

Click a track's timeline to place the cursor, then **Shift-click** another point to select the time range and every track between the two points, including both endpoint tracks. Shift-click also extends an existing selection; further Shift-clicks move its endpoint while keeping the original anchor. Shift-click the ruler to adjust the time range without changing the selected tracks.

**Cut** in the selection menu, Ctrl/⌘+X, and Delete copy the selection to the clipboard and remove it from the selected tracks. By default the rest of each track stays in place, leaving a gap. Set **Settings › Editing › Cut** to **Shifts the rest of the track left** to close the gap instead: on each cut track, everything after the selection moves back by its length, with a 30 ms crossfade where the cut goes through audio on both sides. A gap-closing cut clears the selection and leaves the cursor at the cut. Automation and scenes stay where they are, and dragging a selection always leaves a gap where the audio was.

**Settings › Editing › Other tracks** decides what a cut does to tracks outside the selection, for example to keep a conversation recorded on separate tracks in sync. **Stay as they are** (the default) leaves them untouched. **Are cut too** cuts the same time range from every track, leaving a gap or closing it as the **Cut** setting says. **Only shift with the cut**, available when cuts shift the rest of the track, moves each other track's audio that starts after the cut back by the cut's length without removing anything; if a track has audio playing across the end of the cut, or its moved audio would break the clip overlap rule, nothing is cut and a notification names the track. Either way only the selected tracks' audio goes to the clipboard, and undo restores every track at once. Both settings are saved in this browser, and **Reset to defaults** restores them.

## Moving clips

Drag a clip's header to move it along the timeline or onto another track. Drag toward the top or bottom edge of the visible track list, above the pinned Output row, to scroll vertically, even while the pointer then stays still. A header already near an edge does not start scrolling just from being grabbed: horizontal moves and small vertical pointer jitter leave the track list still, including with the top panel open. Scrolling speeds up toward the edge and stops when the pointer returns to the middle or the drag ends. To move the clip onto a new track, keep dragging down until the **+ new track** drop area appears below the last track, then release over it.

A clip may partly overlap one other clip on its track, and playback crossfades between them over the overlap. No edit — dragging or trimming a clip, moving it by time, pasting, or dragging a selection — may make three clips play at once, or leave a clip playing entirely within another or covering one entirely, since playback would crossfade into the inner clip and then cut straight back to the outer one. A clip drag or trim that would break this snaps back; the time dialogs and paste say why in a notification. Undo still restores any earlier layout exactly.

While you drag a clip or one of its trim handles, its crossfades with the neighboring clips follow it, growing, shrinking, or disappearing with the overlap the drop would leave, and crossfades between other clips stay as they are. After trimming, the displayed crossfade matches the remaining overlap. Moving the clips apart clears it without leaving stale crossfade graphics.

Drag inside a timeline selection to move the selected audio, on every selected track at once, along the timeline and up or down the track list; each track keeps its distance from the others, and the selection can't go before the start or past the first or last track. A dashed outline shows where the audio will land, turning red where it can't. Dropping does what cutting the selection and pasting it there would do, as one undoable edit: the original range is left empty, clips at the selection edges are split, and the moved audio may crossfade with one clip it partly overlaps. A drop that would break the overlap rule above, or land on a track with a different channel count, moves nothing, and a notification says why. The selection moves with the audio. A click inside the selection without dragging leaves everything as it was; the clipboard is untouched.

## Timeline output

The timeline's **Output** row stays pinned to the bottom of the track viewport: its header and scene lane remain visible while inputs, tracks, and the **+ new track** drop area scroll above it. The normal row is a compact 2.5rem high, with its title and **Effects** button side by side. Editing Output automation expands it to 12rem for the curve and automation controls; leaving automation restores the compact row. Track automation leaves Output compact, dimmed, and pinned. Its scene blocks share the tracks' zoom and horizontal pan: pinch/Ctrl+wheel zooms, and a horizontal wheel gesture pans. Click or drag away from the scene dividers to move the position marker and open the top panel's **Output** tab. The lane also supports keyboard cursor movement by ruler ticks, Home/End, Page Up/Down, and +/− zoom; Enter opens Output.

Opening Output from its lane, including keyboard activation, selects **Video** and keeps the pinned lane visible throughout the panel's resize animation. If the panel was last full-height, lane activation opens it at half height so the timeline stays visible.

Like tracks, Output pairs a header in the information column with a lane in the shared timeline surface. The header's **Effects** button, which counts the Output effects, opens the Output panel's **Audio** view. The position marker is clipped to that surface, so panning it off the left edge never paints over the headers. Hovering the marker shows the resize cursor; mouse and touch drags use the shared pointer manager.

Covered track resize handles do not show hover highlights or intercept clicks through the pinned Output row. Exposed handles still resize the paired information and waveform rows.

Drag a divider between scenes to move their boundary without moving the position marker or the source clips. The preview updates during the drag; releasing records one undoable edit, and Escape cancels. Boundaries stop at neighboring edges and snap together to avoid invisible slivers. Collapse a scene to zero length to remove it, along with the transition into it: drag onto its other boundary, or onto the project start/end for the first/last scene. The remaining scene keeps its layout, framing, and transition; a scene that becomes the first one loses its transition. A focused divider supports arrow keys and Page Up/Down; Home/End collapses the adjacent scene.

The Output panel's **Video** view edits the scene at the position marker. Choose **Single video** or **Side by side**, then **Fit (contain)** to preserve the whole picture with black bars or **Crop (cover)** to fill each area without stretching. Each area can use a chosen video track; **Automatic** uses the first video track for the left/single area and the second for the right. The 16:9 preview follows the marker and playback, uses the tracks' linked clip timing, and shows black in footage gaps. It decodes only while **Video** is visible; switching to **Audio** releases the video resources.

The options are grouped into independently collapsible **Layout**, **Video sources**, **Frame style**, **Transition**, and **Captions** sections. Layout starts expanded; the others start collapsed. Click a section heading, or focus it and press Enter or Space, to toggle it. Expansion choices are retained when switching views or scenes, without changing scene settings. Transition is hidden for the first scene. The scene label and **Split at position marker** button stay outside the collapsible sections.

In **Crop** mode, drag each video inside its preview box to adjust its framing with a mouse or touch. Movement stops at the image edges so the box stays filled. The **Scale −/+** buttons zoom each video from 1× to 4× in 0.1× steps, preserving the current framing center where the image edges allow it. Resizing the preview, including during the panel-opening animation, preserves an in-progress drag at its current position. A focused video also supports the arrow keys (Shift moves faster); Escape cancels an active drag. Positions and scales are independent for each video and scene, and switching to **Fit** and back remembers both.

The **Corner radius** and **Margin** sliders show titles without numeric readouts and update the preview while you drag. Radius rounds the visible video in either framing mode; margin masks each frame's edges without resizing or repositioning the video, leaving black space around it and between side-by-side videos. Releasing a slider records one undoable change; Escape cancels an uncommitted adjustment. Both settings apply to all frames in the current scene, use pixels on a 1920×1080 canvas, and scale with the preview. Existing scenes start with zero radius and margin.

**Transition from previous scene** sets how the scene at the position marker replaces the one before it: **Cut** (the default), **Fade through black** (out to black, then in from black), **Crossfade**, **Slide** (the new scene moves in over the old one), **Push** (the new scene pushes the old one out), or **Zoom** (the old scene grows past while the new one grows into place and fades in). Slide and Push follow a **Direction**: Left, Right, Up, or Down. Every transition has a **Duration** from 0.25 to 2 seconds and plays centered on the scene boundary, while the footage of both scenes keeps running. It shortens to half of a shorter neighboring scene, so consecutive transitions never overlap. The first scene starts the video and has no transition. Each change records one undoable edit. The Output lane hatches where each transition plays, and the preview shows transitions at the marker and during playback with the same motion and fades as MP4 exports. Dragging or arrow-key panning a crop is unavailable while the marker is inside a transition.

**Split at position marker** starts a new scene with the current scene's layout, framing, sources, crop positions and scales, and frame styling; the new boundary starts as a cut. Splits cannot create empty scenes at zero, the project end, or an existing boundary. A boundary belongs to the scene on its right, and the last scene follows the project duration. Scene edits and splits support undo/redo, survive reloads, and travel in project archives. Scenes affect both the preview and MP4 video exports. Output audio effects are described under [Effects](#effects).

In **Captions**, enable **Show transcript captions** to turn a track's transcript into horizontally centered text over the video. **Position** chooses **Bottom** (the default), **Middle**, or **Top**. Top and bottom keep a safe inset from the video edges; middle centers the entire caption block, including both lines when wrapped. Existing projects without a saved position retain their bottom placement. Transcribe a track first in **Tracks → Transcript**, then choose its **Transcript track**. **Automatic** uses the first audible track with played transcript words; choosing a track explicitly uses that transcript even if the track is muted. Captions are off in existing projects until enabled. Deleting an explicitly chosen track disables captions instead of silently switching to another speaker.

New projects select **Loudest speaking track** by default. Existing saved caption source choices are preserved; **Automatic** remains available in the source menu.

Choose **Loudest speaking track** to switch captions between separate speaker tracks as their turns come up, showing one fragment at a time. It compares approximately 100 ms of source waveform peak levels around the current timeline position, including track gain and respecting mute/solo. If speakers overlap, the louder captioned speaker wins; an active transcript word takes priority over another fragment's short pause. Equal levels use track order, and silence shows no caption. Gain, mute, and solo changes update the preview immediately. The estimate is before track effects, not a post-effects loudness meter. Playback, seeking, and MP4 export use the same timeline-aligned selection rule; the mode saves with the other caption settings and supports undo/redo.

Captions show short sentence fragments of up to seven words or about 42 characters, wrapping to at most two lines. The spoken word uses **Spoken word color**, and the rest use **Text color**. **Font** and **Font size** change their appearance; size is in pixels on the 1920×1080 composition. **Shadow size** controls a centered halo around the words, combining a dense inner shadow with layered, extra-wide soft glows for contrast over light, dark, and busy footage. The slider runs from **0%** (off) to **200%**; **100%** is the default large halo. Existing saved shadow on/off choices become 100%/0%. **Shadow color** sets the halo color, which defaults to black. The halo scales with the text without changing normal letter spacing or wrapping. Sizes and colors preview live; Escape cancels an uncommitted adjustment. Settings apply across scenes, support undo/redo, and survive reloads and project archives. The shadow is the same in preview and MP4 export.

Text and highlighting follow the stored transcript timing through playback, pause, seeking, trims, moves, repeated clips, and transcript/audio edits. Removed audio and untranscribed gaps are omitted. Short pauses inside a fragment leave no highlighted word; long gaps clear the text. If a text edit puts several words inside one timed transcript atom, they share that atom's interval equally because finer alignment is unavailable. Captions are burned into MP4 exports with the same font, colors, layout, and project-time timing, including selected-region offsets. They stay fixed over scene transitions and inside the centered 16:9 picture in portrait exports; audio-only projects can show captions over black.

## Timeline display modes

Use each track's options menu (three dots) to switch between its waveform and a WebGPU-rendered spectrogram, rename the track, show or hide its transcript, or change its height. The selected mode is session-only and resets to the waveform when a project is opened or the page is reloaded. If WebGPU is unavailable, the spectrogram view keeps its editing overlays on the selected color scheme's minimum-dB background; switching back to the waveform remains available.

Track options are measured while hidden and positioned before opening, including the above-trigger placement used near the bottom of the window. Mouse and keyboard openings use the same positioning path.

Open **Settings** from the application menu to choose whether a cut closes its gap (see [Selecting on the timeline](#selecting-on-the-timeline)) and to configure spectrogram rendering and analysis. Settings are grouped into collapsed, expandable sections. Color schemes include Viridis (default), Magma, Inferno, and Grayscale. FFT size (default 2,048 samples), analysis window (Blackman, Blackman-Harris, or Hann), hop size (512 samples), mel-frequency bands (128), the color scheme, and the minimum-level slider (default -96 dB) are saved in the browser and apply to all spectrogram tracks. Analysis changes clear the in-memory spectrogram tile cache; changing only the color scheme redraws cached tiles without recomputing them. Audio and waveform rendering are unchanged.

Static `index.html` presentation and timeline styling live in `index.css`, including the reusable SVG icon sprite. Visibility uses semantic attributes and state selectors; controllers retain runtime geometry and bind dynamic colors through CSS custom properties. The favicon's embedded SVG keeps its own styles because it is a separate document. The ruler's `--timeline-label-font-size` also drives its tick-spacing and keyboard-step calculations.

The main menu has a soft drop shadow to separate it from the page beneath it in both color schemes.

Waveform clip fills follow the system color scheme: light mode keeps the pastel palette, while dark mode uses muted coral, amber, sage, teal, periwinkle, and mauve with contrast against the black waveform trace. Both palettes use `--waveform-0` through `--waveform-5` in `index.css`.

Surfaces are layered in both color schemes. The page, header, timeline, and track controls use the main `--bg-color` and `--alt-background`. Modal dialogs and the top panel's contents re-declare those two tokens from `--raised-bg-color` and `--raised-alt-background`: the raised palette is lighter than the main one in light mode and darker in dark mode, matching the white and black menus. The panel's bottom toolbar instead shares the project header's background and text colors, so the panel chrome blends into the header in both color schemes. Modal backdrops also dim the page. Outlined buttons fill with `--button-bg`, a 12% tint of the text color, so they stand apart from whichever surface holds them.

The top panel uses a thin, muted bottom divider rather than a contrasting border or drop shadow to separate it from the timeline below. Open tabs sit flush against the panel contents, without a separating border or gap. When minimized, the toolbar has a thin top seam separating it from the main header, without adding height. Its tabs and paired up/down chevrons stay entirely within the bottom toolbar, with no lips or overhang. The toolbar is at least 2.5rem high (40px at the default font size) and grows when its controls wrap. Hidden panel contents remain inert.

The position marker and its time label are anchored to the timeline viewport, not the application header. Panel resizing updates the marker against the current timeline viewport height.

Project-header tooltips stay above the docked panel at every panel height, whether shown by mouse hover or keyboard focus.

The **Downloaded models** settings section reports the persistent browser-cache footprint of DeepFilterNet, Granite, and Silero VAD separately. **Unload** removes that model's cached files, including stale Granite or VAD revision caches, without interrupting a model runtime already in use. The browser downloads those files again when a later runtime needs them.

DeepFilterNet's `df_bg.wasm` and `DeepFilterNet3_onnx.tar.gz` are served from `noisereduction/` under Vite's deployment base (`import.meta.env.BASE_URL`). The configured default is `/soundetch`; for an origin-root deployment such as `https://soundetch.org/`, build with `yarn build --base /`. Resource paths resolve relative to that base, preserving subpaths without turning a root base into a protocol-relative hostname.

`df_bg.wasm` is built by the DeepFilterNet fork's `scripts/build_wasm_package.sh`. The fork patches `tract-linalg` with WebAssembly SIMD matrix kernels, which run the noise remover more than twice as fast as tract's generic kernels with bit-identical output. Its URL carries a build version (`?v=…`); fetching a new build deletes previously cached builds of the file.

## Top panel

The panel, including its bottom toolbar, is hidden while the welcome screen is showing. Returning to the editor preserves the selected tab and panel height.

The top panel stays docked immediately below the main header, above the timeline, and starts minimized to one bottom toolbar containing **Inputs**, **Tracks**, **Output**, and the height controls. There is no separate top bar: the open panel's contents sit directly above the toolbar. On wide screens, the tabs sit on the left and the paired height buttons on the right; narrow screens wrap the controls within the bottom toolbar. Clicking a tab opens the panel at its last open height; Left/Right, Home, and End move between tabs. The active tab uses a filled, inverted-color pressed treatment like the header's microphone, camera, and screen-capture buttons, with a contrasting keyboard-focus outline.

The two chevron buttons stay side by side. The left, upward-pointing chevron decreases the panel height one step; the right, downward-pointing chevron increases it one step. The steps are minimized, half height, and full height below the main header. Decrease is disabled at minimum height, and Increase is disabled at full height; both are enabled at half height. Their directions never change.

Enabling the camera with the project header's **Enable Camera** button opens **Inputs** at the panel's last open height so the live picture is visible. Disabling the camera leaves the current tab and panel height unchanged.

- **Inputs** centers a card for each of this machine's enabled inputs: the microphone with the camera, and screen/tab capture. Each has its live picture (the camera mirrored, like the meeting room's self view) in a 16:9 box filling the card's height, and a peak meter beside it that widens the card rather than narrowing the picture. Meeting guests are not listed. Pictures and meters run only while the tab is showing.
- **Tracks** shows one track, chosen with the **Track** selector above its vertical **Effects**, **Video**, and **Transcript** tabs (Up/Down, Home, and End move between them). Opening Tracks from the toolbar selects the track at the center of the currently scrolled timeline viewport, before the panel changes height; if the center falls outside the track rows, it uses the nearest track. Explicit track actions keep their requested track, and the selector stays on a manual choice while Tracks remains open. **Effects** is the effect chain, **Video** the track's picture at the timeline cursor, and **Transcript** its transcript, or a **Transcribe track** button when it has none. A track's **Effects** button opens the **Effects** view. The effect catalog, effect editors, and automation points open over the tab, and their back button returns to it. The chain follows undo and redo.
- **Output** has vertical **Audio** and **Video** tabs, with the same Up/Down, Home, and End navigation as Tracks. **Audio** is the Output effect chain. **Video** shows the composed preview on the left and the scene's layout, Fit/Crop framing, sources, transition, and split controls on the right; narrow screens stack the preview above the controls. Output's effect catalog, effect editors, and automation points open over the tab, and their back button returns to it.

Drag an enabled chevron or unused space in the panel's bottom toolbar to resize it: down expands, up shrinks. The tab buttons are not draggable. Release snaps to minimized, half height, or full height: the one nearest the release, but at least one step in the drag's direction once the drag covers 24px. Smaller drags keep the current size and do not also click a chevron. The panel follows the pointer, then eases into its chosen size over 100ms on release while the timeline boundary moves with it; no intermediate height is retained. Reduced-motion preferences disable the animation. Viewport/header changes update the bounds without cancelling an active drag, and tracking continues outside the drag surface or after pointer-capture loss until release. A cancelled gesture or window focus loss restores the previously chosen size. Both chevrons are native buttons with 96×32px targets, visible keyboard focus, accessible action labels, disabled boundary states, and resize instructions. Enter or Space activates the focused chevron; Down expands one step, Up shrinks one step, Home minimizes, and End selects full height. If a focused button becomes disabled, focus moves to the other button.

The panel shell lives in `src/ui/TopPanelController.ts`; its DOM IDs and CSS classes use the `top-panel` prefix.

## Effects

A track's **Effects** button opens the top panel's **Tracks** tab on that track's **Effects** view, whose chain runs from left to right. Each effect's controls are stacked below its name: **Bypass**, **Automate**, **Move left**, **Move right**, and **Remove**. **Bypass** is a toggle; a bypassed effect is labeled _Bypassed_, keeps its settings and automation, and stays in the chain. Bypassing is undoable and saved with the project.

During playback, toggling bypass takes effect immediately. Each effect sits between two unity-gain junctions; bypass disconnects both junctions from the effect and routes the signal straight to the next effect, so the effect's own nodes are never torn down. The output junction is disconnected before the input, so the effect is never pulled without input. This matters because Chrome permanently stops an AudioWorklet whose `process()` returns `false`, and the noise remover's worklet does that when its input is empty. Exports skip bypassed effects.

Exports and Freeze hand rendered audio to the encoder, and so advance their progress, at least every 100 ms, even while a slow effect such as the noise remover takes seconds per render chunk.

Choose **Automate** on a track or Output effect to edit its timeline points. Each point's row in the top panel has a **Delete** button; deleting the last point leaves the parameter's initial value unchanged. Automation edits are saved with the project and support **Ctrl/⌘+Z** to undo and **Ctrl/⌘+Shift+Z** to redo without leaving automation, including when point fields or the parameter selector have focus. The Edit menu offers the same actions. Undoing the addition of the effect being automated exits automation safely. **Back** in either the point editor or the timeline header exits automation, clears the timeline overlay, and restores the normal timeline controls.

### Output effects

The Output effect chain processes the mix of all tracks, after each track's own effects, gain, mute/solo, and pan, during playback and in every audio and MP4 export. Open it with the Output header's **Effects** button or the Output panel's **Audio** view. It runs from **All tracks** to **Final mix** with the same catalog and controls as a track's chain: effect editors, **Bypass** (immediate during playback), reordering, removal, undo/redo, and live parameter changes while playing. The chain is saved with the project, travels in project archives, and starts empty in projects created before it existed. Freeze renders only its tracks' chains: the frozen track still plays through the Output chain, which would otherwise apply twice.

**Automate** on an Output effect draws its automation over the Output lane, which grows to make room while the header shows the automated parameter and a **Back** button. The tracks dim and stay inactive meanwhile; the scene dividers are hidden, and the lane's clicks and keys no longer move the marker or open **Video**. Points are added, dragged, and edited exactly as on a track, with the point editor in the Output tab. Automating a track effect dims the Output row in the same way. For tracks and Output alike, opening the point editor keeps the automated lane visible: a full-height panel returns to half height and the lane scrolls into view.

## Meetings

Whoever creates a meeting hosts it. The invite link always carries the host's id, including the copy each guest sees. Opening the link asks the host to let you in: the guest sees **Waiting for host _name_ to let you in…** until the host chooses **Admit** or **Deny** in the meeting room. Each request also raises a notification, so the host notices it outside the meeting room, and an admitted guest gets one too. A meeting holds the host and up to three guests; once it is full, remaining and later requests are turned away and the host is told.

Every member connects directly to every other member. If a newly admitted guest cannot reach someone, the host removes that guest and everyone is notified. Closing the meeting tab leaves the meeting immediately, like **Disconnect**. Everyone is notified when their connection to a member is interrupted, and again once it is restored; a member (or waiting guest) whose connection stays interrupted for 5 seconds is removed, which also covers crashes and lost networks. If the host leaves, the others stay connected and are told that no one new can join.

## Keyboard and assistive technology

Each track has a focusable timeline control. Left/Right move the cursor by one ruler tick, Page Up/Page Down by one labelled interval, and Home/End go to the start and end. Hold Shift to select; Alt+Shift+Up/Down adds the neighbouring track to the selection, Ctrl/⌘+A selects the whole track, Delete cuts the selection, Escape clears it, and +/− zoom around the cursor. Shift+F10 or the Menu key opens the menu a right-click opens there: selection actions, clip actions (split, move or trim by entering a time, move to a new track, select, info, delete), or paste and go-to-time on an empty stretch. The zoom, scroll, and **Go to time…** buttons above the track headers work with a single click.

In a track's options menu, Up/Down move through the visible actions, Home/End go to the first/last action, and Escape closes the menu. **Show transcript**, available only when the track has a placed transcript, opens its **Transcript** view in the **Tracks** tab.

Ctrl/⌘+X cuts the timeline selection. Timeline copy, cut, paste, and undo shortcuts are ignored while focus is in a text field, a select, or an open dialog, and Ctrl/⌘+C copies selected text normally.

In the **Transcript** view, the arrow keys, Home, and End move between words, Shift extends the timeline selection word by word, and Enter or Space moves the cursor to the focused word. F2 edits the selected text or focused word; Ctrl/⌘+Enter applies the edit, and Escape cancels it. Backspace or Delete removes the selected or focused words' audio, or restores it when only struck-through words are selected.

Screen readers hear status changes: transport state, recording countdowns, edits such as cut, paste, undo, and redo, notifications, processing progress in 10% steps, and meeting joins and departures. Error notifications stay until dismissed with their close button or Escape; other notifications pause while hovered or focused. Escape also hides an open tooltip.

## Transcription timeline overlays

Tracks with transcription show a dedicated lane below the waveform or spectrogram, keeping labels clear of the audio display. Every placement projects the clip's sparse, ordered source-sample ranges onto its timeline position, preserving alignment through moves, splits, trims, repeated placements, and display-mode changes. Range labels and their real start/end boundaries are clipped to the visible placement without filling unlabeled stretches or creating boundaries at trim and viewport edges. Silence and untranscribed ranges carry muted italic labels such as `[silence 1.2s]`, measured over the visible placement.

The zoom threshold allows clipped words: a label remains text when its full timed interval can show at least 75% of one word. Viewport and trim edges only clip the label; they never recenter it or trigger a placeholder. Intervals below the zoom threshold use muted horizontal markers instead of text and per-word boundary lines. Markers separated by at most one CSS pixel merge, while wider unlabeled gaps remain clear. Dense views batch these markers into one SVG path without creating a text element for every word; zooming in restores labels and their real boundaries. Clicking a marker still opens the corresponding transcript occurrence.

Transcription ranges persist with the clip in IndexedDB and project archives. Clips created by older versions load with an empty transcription.

Click a transcript interval in the timeline lane to open its **Transcript** view in the **Tracks** tab and select that specific placed occurrence, scrolling it toward the vertical center of the panel. When stopped or monitoring, this also selects its trim-clamped timeline interval. The panel lists every placed occurrence in timeline order, including repeated and offscreen placements; trims clamp each atom's interactive timing. Persisted multiword phrases remain one timed atom.

While stopped or monitoring, drag a boundary line in the lane to retime the transcript without changing its audio or text. Edges that meet, or lie within 3 pixels of each other, move together, closing any sliver between them; an edge beside unlabeled audio moves alone. The lane previews the drag with the moved boundary drawn thicker; releasing records one undoable edit that saves with the project, and Escape cancels. A drag clears the timeline selection but leaves the cursor in place. Boundaries stop at neighboring edges and the placement's trimmed audio, snapping onto these limits within 3 pixels. Words keep at least 3 pixels of played audio, while dragging across a whole silence or untranscribed range removes it, and silences left touching merge. Repeated placements share the change. Zoom in to reach boundaries hidden below the zoom threshold.

Each drawn boundary is also a keyboard slider, reached with Tab in timeline order and named after the words or gaps it separates. The arrow keys move it by a ruler tick, Page Up/Down by a major tick, and Home/End to its limits, each as one undoable edit with the same limits and snapping as a drag; +/− zoom around it to change the step. Focus follows the moved boundary, and the timeline pans to keep it visible. During playback, recording, or automation editing the sliders leave the tab order and ignore these keys.

While stopped or monitoring, select text in the panel and choose **Edit text**, centered on the selection, to correct it. Applying changed text replaces the selected source interval with one timed chunk, including any pauses between its selected words, without changing audio or rerunning alignment. Unchanged fields keep their original word timing; an empty replacement removes the selected text without cutting audio. Edits save with the project and support undo/redo. Repeated placements share their clip's correction, and editing a trim-clipped word preserves its full source timing. Selections spanning separate clips or disjoint source intervals show one field per source range, applied together as one undoable edit. Line breaks stay within the replacement chunk.

Closing the edit dialog restores the transcript selection: Apply selects the replacement chunk, while Cancel and Escape restore the original selected atoms. The timeline selection stays unchanged.

To remove audio, select text in the panel and choose **Delete audio** beside **Edit text**, or press Backspace or Delete; with nothing selected, the keys act on the keyboard-focused atom. The track's audio from the first to the last selected atom is cut out and everything after it on that track moves back to close the gap (a ripple edit). Where the cut goes through audio on both sides, the two sides overlap by up to 15 ms each way, a 30 ms equal-power crossfade centred on the join, shrunk as needed to stay within the clip's source and clear of other crossfades. The cursor moves to the join, the timeline selection clears, and automation and scenes stay where they are. The transcript's own track always closes its gap; the other tracks follow **Settings › Editing › Other tracks** (see [Selecting on the timeline](#selecting-on-the-timeline)): they stay as they are, are cut the same way with their gaps closed too, or only shift with the cut, and a delete that a track can't follow in sync is refused with a notification.

Removed words and gaps stay in the panel at their join, struck through in their original paragraph; they no longer play, highlight, or select timeline audio. After a delete they are selected, so pressing Backspace again — or choosing **Restore audio** — puts them back and pushes the later audio out again, selecting the restored words in the panel and on the timeline. Restoring only some struck atoms brings back just that source span and leaves the rest removed. Struck text appears wherever two consecutive placements of one clip meet (or crossfade) and skip ahead in its source, so it survives saving, undo/redo, and later edits; audio cut between different clips can be brought back only with undo. Deletes and restores are single undoable edits that save with the project. Across any crossfade between placements, each side's transcript stops at the middle of the overlap, so the panel and output captions never show the crossfaded fragment of a removed word.

Restoring follows the same setting at the time of the restore. Tracks cut too take back their own audio removed at the same join, the same part of it as the transcript's track, or, where they removed nothing there, have their later audio pushed back out with silence in between; tracks that only shift push their audio from the join on later. A track that can't follow in sync, such as one whose audio plays straight across the join, stops the restore with a notification; undo still restores it.

VAD-detected speech regions appear as separate paragraphs, including pauses whose inference padding overlaps. The 20-second inference chunks do not introduce paragraph breaks. Each word retains its source-region onset, preserving paragraph membership through trims, splits, ripple deletes, repeated placements, persistence, and undo/redo. Previously generated transcripts without this metadata remain one paragraph until regenerated.

Generation also records the audio that has no recognized word, so the transcript accounts for pauses and sounds as well as words. **Silence** is a run of at least 500 ms of 32 ms frames in which Silero is below its 0.35 speech-end threshold and the frame RMS, measured at the clip's own level before loudness normalization, is below the larger of 0.003 and a tenth of the interval's loudest frame; frames touching a word or untranscribed range never count. It covers quiet audio between VAD regions and pauses inside them. **Untranscribed** sound lies inside the padded VAD segments where no word explains it: a hesitation, a word Granite dropped, or noise Silero takes for speech. Its speech-mask frames, bridged over dropouts of up to two frames and kept clear of the 250 ms before each word, are trimmed to their first and last energy-supported frames and must then last 300 ms with 300 ms of consecutive Silero support. The trim keeps Silero's few hundred milliseconds of lag after speech stops from reading as sound; those lagging frames, and loud non-speech that Silero ignores, stay unlabeled rather than becoming silence. When a selection yields no words, a notification reports either no speech or speech without recognized words.

The panel shows these ranges inline as `[silence 1.2s]` and `[untranscribed 0.4s]` atoms (from a minute, whole seconds such as `[silence 2m 5s]`). They click, select, navigate by keyboard, and highlight during playback like words, so a native or keyboard selection can cover exactly a pause or an unrecognized sound. Untranscribed sound joins the paragraph of its nearest VAD region; silence ends the paragraph it follows, or opens the transcript when it comes first. Pause commas and paragraph punctuation are computed from the words alone.

The panel formats each paragraph for reading at display time; stored transcript text stays raw, so earlier transcripts pick up the formatting and timeline-lane labels keep the raw words. A bare `O` reads as `oh`, `i` and a curated list of proper nouns and acronyms are capitalized (multiword names such as `new york city` match longest first), and the first word is capitalized. A pause of 350 ms or more between words adds a comma, except inside a matched name. A paragraph that opens with an auxiliary verb followed by a subject (`is it`, `can we`, `do you`) ends with `?`; `do` and `have` count only before a personal pronoun, so `do it now` stays a statement. Every other paragraph ends with `.`. Words that already end in punctuation get no extra mark. Punctuation sits outside the word, so highlights, focus, and selections cover only timed words. Contractions are not restored.

During playback, the panel highlights the current timed atom, including silence and untranscribed atoms, in green and scrolls newly active occurrences into view without changing the native text selection. Unlabeled stretches between atoms clear the playback highlight, pausing retains it, and stopping clears it. Repeated and trimmed occurrences follow their placed timings; a persisted multiword phrase remains one timed atom.

Click a panel atom to reveal its occurrence and move the cursor to its start when stopped or monitoring. During playback, recording, or their paused states, clicks only reveal the occurrence without changing transport, cursor, or the timeline selection. Drag native text selection to select complete timed atoms on that track; keyboard text selection also updates the timeline range. While stopped or monitoring, panel drags enter pointer selection mode, and selecting a time range clears the position marker just like a timeline drag. Release, blur, closing the panel, or replacing its transcript data ends the panel gesture. Timeline selections appear in the panel as one continuous native text range from the first to the last intersecting atom, including intervening spaces, without snapping timeline boundaries to words. The panel follows committed edits and undo/redo, and closes when its track or project is removed.

To generate a transcript, select a region on one or more tracks, right-click the selection, and choose **Generate transcription**. Generation runs locally in the browser with the English-only IBM Granite Speech model and Silero VAD speech segmentation. Word boundaries come from transcript-conditioned CTC posterior medians refined by bounded Silero and energy evidence. The first run downloads about 313 MB: the derived timing graph, model weights, and matching frontend/vocabulary assets from one public, commit-pinned Hugging Face model repository, plus a separate 0.6 MB pinned Silero voice-activity model. Cache persistence is best-effort and never blocks model startup. Speech regions are detected with Silero VAD hysteresis and padded by 750 ms before and 300 ms after detected speech. Padded speech longer than 20 seconds is split into inference chunks of at most 20 seconds. Granite transcribes a word cut by a chunk boundary in both chunks, often together with its neighbors, so each cut falls in the middle of the longest pause (Silero probability below 0.35) within the 5 seconds before the chunk's 20-second limit, or, when speech never pauses there, in the least speech-like 32 ms frame. ONNX Runtime's WebAssembly runtime is initialized with the Silero model before WebGPU setup, without a deadline; Granite WebGPU setup and warmup then have a 30-second deadline. A WebGPU error falls back to WASM in the same worker. A missed deadline restarts the transcription in a fresh WASM-only worker, and WebGPU stays disabled until the page is reloaded.

A track without a transcript shows **Transcribe track** in its **Transcript** view, which runs the same generation over the whole track. Like **Generate transcription**, it works only while stopped or monitoring.

Each selected interval is downmixed to mono, resampled to 16 kHz, and scaled to −16 LUFS integrated loudness (ITU-R BS.1770-4) before Silero runs, boosting by at most 40 dB; the export limiter then holds sample peaks at −1 dBFS. Silero's speech probability falls with input level, so quiet recordings otherwise lost speech from the VAD regions and Granite never transcribed it. Silero and Granite both receive the normalized audio; the energy thresholds for silence and word timing keep the clip's own level, so a quiet room-tone selection still reads as silence.

The processing dialog shows **Finding speech segments (VAD)…** while Silero scans each selected source interval, with a percentage based on the audio frames processed. It then switches to **Generating transcription** and resumes the overall transcription percentage. VAD progress starts again for each selected interval.

In cross-origin-isolated pages ONNX Runtime uses up to four WebAssembly threads: the transcription worker plus a pool of nested pthread workers. Emscripten ignores a pool worker that fails to load and would otherwise wait forever for it, so the transcription worker detects that failure and the transcription restarts in a fresh single-threaded worker. Later transcriptions stay single-threaded until the page is reloaded; WebGPU inference is unaffected.

ONNX Runtime 1.26.0's JavaScript glue remains packaged with the application, so its pthread workers load from the same origin. Its matching WASM binary is fetched over HTTPS from [assets.soundetch.org](https://assets.soundetch.org/onnxruntime-web/1.26.0/ort-wasm-simd-threaded.jsep.wasm?sha256=411b39a77bb006ce0cf17b30c978c66a130ebb2ba39c8dfdbdc9c1c5a251ae76), keeping the oversized binary out of the Cloudflare Workers static-asset upload. The fixed `sha256` query identifies the verified binary and provides a stable CDN cache key; it is not a random per-request cache buster or a browser integrity check. The host must return `Content-Type: application/wasm` and allow cross-origin GET/HEAD requests. Preserve the application's COOP/COEP headers for threaded inference. Publish a new versioned asset and update the package version and hosted URL/checksum together when upgrading ORT; do not overwrite runtime files used by released clients.

The built application was verified with a successful hosted-WASM request, four-thread ORT initialization, all three local pthread workers, and timed JFK transcription. No ORT WASM binary was emitted into `dist/`; all 54 deployable files were below the 25 MiB per-file limit (largest: 7,983,136 bytes). If CORS settings change after the CDN has cached an asset, purge the relevant [Origin-aware cache keys](https://developers.cloudflare.com/cache/how-to/cache-keys/) rather than relying on a browser refresh.

Transcription logs timestamped `[Granite]` diagnostics to the browser console at the Info level: per-asset cache hits, downloads, and cache writes; ONNX Runtime WebAssembly compilation and pthread-worker startup; Granite session creation and warmup; each interval's measured loudness and normalization gain; and per-segment inference. Any stage running longer than 5 seconds logs a heartbeat every 5 seconds, listing unfinished cache writes.

Audio imports wait for browser-storage writer initialization before streaming decoded samples, so a first import in a fresh browser profile cannot complete as an empty clip.

Regeneration replaces every transcript word that intersects the selected clip-source interval, including a word that straddles a selection boundary, while preserving transcript ranges wholly outside it. Silence and untranscribed ranges that cross the interval keep their parts outside it, and silence touching regenerated silence merges into one range. Repeated placements of one clip share the same clip-owned transcript. Granite emits one sharp CTC spike per word, usually near its onset, so word timing combines that spike with speech activity (the speech mask plus energy relative to nearby speech). Granite predicts a short word from the audio after it but needs much of a long word to identify it, so its spike leads short words and lags long ones; each spike start therefore moves 65 ms later minus 11 ms per letter, by at most 80 ms either way. A word starts there, or 64 ms before speech resumes when its spike sits in a pause; it ends where its sound stops, bridging quiet stretches of up to 96 ms (stop closures) or up to 192 ms while the word is still shorter than its letters suggest (quiet fricatives such as the /st/ of "states"). An end follows both speech activity and quieter sound at least 12 dB above the local noise floor (the 10th percentile of 32 ms frame energies within 10 seconds of the segment), so quiet word-final consonants such as the /s/ of "distance" stay in their word. Granite emits a word once it has identified it, so a word of six or more letters can spike well after it begins, such as on the "-lation" of "legislation". The derived timing graph therefore also exports Granite's non-blank vocabulary distribution: when the word's own prefix pieces ("legisl", "ag" for "agriculture") hold at least 10% of it, and more than the previous word's pieces, at least two 80 ms frames before the spike (and from the second frame after the previous word's spike, or after a relocated first word's evidence), the word starts in the middle of the first such frame. An end never passes the next word's start or a length cap of 120 ms per letter (at least 400 ms). Granite also emits a segment's first word on the segment's first frame wherever the word is spoken, whether after the 750 ms VAD pre-roll, a 20-second chunk's leading pause, or seconds of music that Silero accepted as speech. The distribution still shows where such a word is heard: the middle of the first frame of the last run before its next token in which its prefix pieces hold at least 40% and more than the next word's pieces (a run touching the first frame means the word is spoken from the segment start). Energy still places a first word's onset: in leading silence it starts at the nearest supported speech before the next word, or, when the next word's spike already sits where speech begins, at that speech. When that onset lands more than 200 ms from Granite's evidence, energy has settled on other sound, such as an intro song, and the word starts at the evidence instead. Boundaries are estimates on 32 ms acoustic frames, not phoneme-accurate alignments.

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
