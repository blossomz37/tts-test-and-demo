# Developer guide

## Scope and commands

Two independent demos: the main browser TTS/STT/comment app at the root, and the recorded model comparison in `research/`. Keep them separate unless integration is requested. Use Node >=22.

```sh
npm ci
npm run setup:model
npm run build
npm test
npm start
```

The main server defaults to loopback port 4182; `npm start -- --port 0` chooses an available port for isolated checks. Follow the host machine's port policy and never stop an unknown process to free a port. The main app needs an HTTP origin; file:// is unsupported. The research viewer supports file:// and `node research/serve.mjs` with a free loopback port.

## Runtime map

- `src/app.mjs`: fixed passage, sentence DOM, voice warm-up, playback/dictation exclusion, general notes.
- `src/generated-reader.mjs`, `src/reader.mjs`: reader lifecycle, one-sentence lookahead, pause/resume, generation guards, Blob URL cleanup.
- `src/kokoro-engine.mjs`, `src/kokoro-worker.mjs`: worker bridge, local WebGPU synthesis, serial generation, WAV conversion.
- `src/dictation.mjs`: on-device English recognition, final-result deduplication, interim separation and cancellation.
- `src/comments.mjs`, `src/comments-ui.mjs`: exact source anchors, whole-word snapping, drafts, saved edits, underlines and sidecar export.
- `src/icon-buttons.mjs`: icons, accessible names, visible labels for less-obvious actions, hover/focus tooltips.
- `scripts/setup-model.mjs`: pinned, hash-checked fp32/Heart download and 64 MiB cache parts.
- `scripts/build.mjs`: pinned local-voice adapter, worker/runtime bundle and shell cache digest. Run from the project root.
- `scripts/serve.mjs`, `sw.js`: loopback static allowlist, same-origin shell/assets caching and model-part reconstruction.

The setup intentionally prepares only fp32 WebGPU and `af_heart`. Model revision and required hashes live in `models/manifest.json`; actual binaries are ignored. Do not remove the manifest as provenance: it is a reproducible setup input. Preserve package-lock.json and use npm ci. Earlier q8/other-voice code is not a supported prepared configuration.

The engine initializes and begins first-sentence synthesis on page load. “Voice ready” means model initialization completed, not necessarily that synthesis finished. Do not promise immediate first playback. In-flight GPU work cannot be interrupted; cancellation invalidates its result. Sentence highlights follow playback events, not estimated word timing.

## Persistence and safety contracts

General notes use `tts-demo:notes`. Comments/drafts use `tts-demo:sidecar:v1` (storage schema 1). Keep existing recovery behavior and do not silently reset unreadable or source-mismatched storage.

Export schema 2 includes the complete source with SHA-256, exact UTF-16 `[start,end)` selection anchors, saved comments (`type: selection`), and one unanchored general comment (`type: general`, `anchor: null`) for nonblank notes. Drafts and interim speech are excluded; general-note line breaks are preserved. No import or automatic manuscript editing is implemented.

Editing retains the comment ID, source hash, anchor and createdAt; Save adds updatedAt and replaces the saved body. Back retains the separate draft; exporting before Save uses the original saved body. Confirmed deletion removes the comment and associated draft; persistence failures roll back the mutation. Snapping partial-word selections must preserve exact original source offsets.

Browser storage is origin/profile-specific, not a backup or a multi-tab merge system. For larger projects, namespace storage and document IDs, handle migrations and stale targets, and define explicit acceptance/recovery. Do not calculate anchors from normalized spoken text.

Dictation explicitly requests processLocally with en-US and has no cloud fallback. Recognition may require Chrome's language pack and microphone permission. Test with controlled recognition events when verifying routing; do not capture ambient audio automatically or claim microphone accuracy from simulated events.

## Hosting and integration

Main-app workers, model paths and service worker are root-relative. Subpath, iframe, Electron or extension integration requires deliberate URL/cache/permission adaptation. Preserve the CSP's worker, WASM and Blob-audio permissions. Never install this root-scope worker over an unrelated app.

Cached model assets can be evicted. Offline use requires preparation and successful browser caching; no first-run-offline guarantee. Rebuild after source/style/font changes to refresh shell identity. The page assumes a full-page lifecycle; component reuse needs explicit event/worker/highlight cleanup.

Use the existing Electric Creative tokens: square controls, Hanken UI/body, Bricolage headings, Anton masthead, purple comment underlines, ember actions and visible focus. Keep active controls at least 44px tall. Ship font licenses with the fonts.

## Verification and repository boundary

Run npm test and npm run build after relevant app changes. Check real browser playback, progress, pause/resume/stop, draft recovery, comment edit/delete, mixed/general-only exports and narrow layouts when those flows change. Unit tests use fixtures/long.txt and fixtures/edge.txt; never reintroduce a private chapter dependency.

`research/` is the current shareable research source. Its bundled public request/billing/timing records support visible claims and playback; they are intentional example data. See research/AGENTS.md for its format and verification. Raw provider logs, account/workspace identifiers, original experiments, local environment files, screenshots, browser profiles, generated assets, and release packages are not contributor inputs and stay ignored.

Do not force-add ignored files to make a build/test pass. Verify a checkout containing only Git-visible files. Keep archived/local material local; do not restore it into the publish set without review.
