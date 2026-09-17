# Agent guide — Voice study v0.1.0

## Scope

An independent static research viewer, not a live TTS client. Preserve this separation unless the user authorizes integration with another app. Vanilla HTML/CSS and classic JavaScript deliberately support both `file://` and subpath hosting. No build, npm dependencies, network API, microphone, service worker, or persistent state at runtime. Fonts are local with their original licenses.

`README.md` is user-facing. This file records how playback, evidence, and timing work.

## File map

- `index.html`, `style.css`: responsive Electric Creative interface; research notes and native details disclosure.
- `serve.mjs`: optional dependency-free Node static server, loopback-only, ephemeral port by default, GET/HEAD, MIME types, single byte ranges, path containment and symlink containment.
- `data.js`: `window.RESEARCH` with the exact passage and eight model records, including an embedded copy of each word alignment. Loaded as a classic script to avoid local-file fetch restrictions.
- `app.js`: one HTMLAudioElement, selection, transport, per-word highlighting, accessible icon controls and tooltips. Text renders through textContent, not user-supplied HTML.
- `samples/<model>/audio.mp3` or `audio.wav`: unchanged playable recordings from the controlled round. Gemini's WAV wraps the original PCM16 at 24 kHz mono; the raw PCM remains in the source research folder, outside this portable package.
- Each sample has `request.json` (exact posted bytes), `receipt.json` (public extract), `endpoints.json` (historical quote), `ffprobe.json`, and `alignment.json` (derived timestamps with hashes and tool versions).
- `tools/align.py`: optional authoring-only local alignment. Not loaded by the page. Uses stable-ts 2.19.1 and openai-whisper 20250625 with base.en on CPU, four threads, language en; needs ffmpeg and Python dependencies. The model is downloaded on first authoring use, not during playback.
- `tools/refresh-timings.py`: rebuild embedded word data from alignment files without network access.
- `tools/verify.py`: validate exact request bytes, recorded audio identity, alignment coverage/order/bounds, data parity, total cost, and bundled file references without paid calls.

## Playback and highlights

The sole media element prevents two embedded samples playing together. Model selection pauses and replaces the source, resets position and retains selected playback speed. An epoch guard prevents a rejected play promise for an old source from overwriting the new selection's status. Open-audio links pause the embedded player before opening a file in a new tab; independently opened tabs remain separate media contexts.

Updates use `audio.currentTime` via requestAnimationFrame while playing, plus timeupdate/seeked/loadedmetadata/durationchange. There is no duration-based interpolation or timer that drifts independently of playback. Pause freezes position; start-over resets to zero; natural end clears the current-word highlight. The seek control and actual audio clock also drive highlighting while paused. Speech gaps have no current word.

The supplied passage is preserved exactly, including curly quotes and whitespace. Timed words are mapped sequentially into that immutable text. A failed match suppresses highlighting and reports the mismatch rather than silently changing text. Stable-ts sometimes collapses short words such as “the” to zero duration; these share the following timed word's display window. Raw alignment files retain original zero durations. This is a documented display adjustment, not new measured evidence.

Alignments are machine estimates, not provider timestamps. They were generated using forced alignment to the known text, so they cannot detect omissions reliably or establish transcription completeness. Audio quality has not been human-rated. Replacing any audio/text requires new alignment, corresponding hashes, and browser verification. Never reuse timings merely because the passage matches.

## Evidence and billing

Source: `openrouter-samples/rounds/2026-09-17-controlled` in the original tts-methods workspace. The package includes the eight controlled recordings, not the ten earlier manual downloads. One paid/free POST per model, identical 285 Unicode characters / 293 UTF-8 bytes, no speed/style/provider override. All eight passed ffmpeg decoding; summed receipt total_cost = $0.053303 USD, excluding funding fees.

Receipt extracts retain generation ID, canonical model ID, actual provider, usage, billed cost, original request/response hashes and client timing. They intentionally omit workspace/account identifiers and unneeded headers. Request JSON includes no authorization. For Gemini the raw-response hash refers to PCM, while alignment's audio hash refers to the playable WAV; verify the WAV frame bytes against the former.

Do not confuse requested aliases with resolved, dated receipt IDs. Four aliases resolved to dated names. Both are shown. Do not invent zero output tokens when the receipt says null. Gemini's billed cost reconciles with 58 native input tokens and 539 audio output tokens; the general prompt field is 72. Other paid models' costs match character pricing. Endpoints snapshots use API field names whose units depend on the model.

Every receipt's generation_time is null. Client download_seconds measures start to complete response, not time to first sound or model-only generation. Latency is retained with its raw API value. Default routing chose Together for Kokoro and Orpheus; do not describe these samples as DeepInfra pricing tests.

## Update / integrate

No connection to the main starter has been added. Embed/link later only after the user decides. Relative paths support subdirectory hosting; namespace CSS, DOM IDs, window.RESEARCH, and tooltips if merging into another page. Preserve one active audio source, keyboard controls, timing provenance, and honest billing units.

To author new timings, use an isolated Python environment with the pinned dependencies above, then run `python tools/align.py`. Existing alignments are skipped. Keep a new versioned sample folder for replacement audio rather than overwriting original evidence. Run `python3 tools/refresh-timings.py` after alignment, then `python3 tools/verify.py`. New models also require their metadata in data.js and updated research copy. Do not silently repurpose historical billing or counts.

Serve with `node serve.mjs` (Node >=22), defaulting to a free loopback port, or `--port` with your host's assigned port. The browser test found that Python's basic http.server returned seekable [0,0] for some MP3s, so it is not the recommended launch path. Static hosts should support byte-range requests. Never stop an unknown process to free a port. Sharing the ZIP is a separate action from deploying publicly. This package has no API-generation runner, credentials, private manuscript files, or Python environment.

## Verification

Before sharing changes, check real browser playback, pause/resume, seeking, speed, source switching, end state, icon tooltips with Escape, local-file playback, mobile overflow, local resource loading, and exact text preservation. Do not claim auditory accuracy from automated UI checks.
