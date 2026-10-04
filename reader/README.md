# Local chapter reader

Generate a private reader beside an existing audio run. It combines the research
viewer's single-audio, audio-clock-driven word highlighting with the main demo's
exact comment anchors and on-device English dictation. Both original demos remain
independent. No narration is generated and no provider calls are made.

## Generate

Use Node >=22 and `npm ci`. The supported input is a local narration run with:

- `render-config.json`: `inputs` with chapter numbers, source filenames,
  source/prepared SHA-256 and explicit scene-marker exclusions.
- `receipts/chapter-NN.json`: matching identities, duration and MP3 hash.
- `prepared/chapter-NN.txt` and `mp3/chapter-NN.mp3`.
- Manuscripts named `ch1_Final_v1.md`, `ch2_Final_v1.md`, etc. Pairing is numerical;
  the contiguous chapter sequence and recorded inputs must match completely.

From this repository:

```sh
npm run reader:generate -- \
  --chapters /absolute/path/to/chapters \
  --audio-run /absolute/path/to/audio-run \
  --title "Book title" --book-id my-book \
  --align --python /path/to/isolated/environment/bin/python \
  --model /path/to/cache/base.en.pt
```

Output is `AUDIO_RUN/reader/`. Output inside this source repository is refused.
MP3s are linked as `../mp3/chapter-NN.mp3`, never copied or regenerated. Manuscripts,
narration records and recordings are read-only. Use a distinct stable `--book-id`
per book. If omitted, the canonical chapter-directory path determines it; provide
the same explicit ID when moving a book.

Inspect existing environments and caches first. Alignment uses **stable-ts
2.19.1**, **openai-whisper 20250625**, PyTorch and FFmpeg. Prepare an isolated Python
environment and official Whisper `base.en.pt` outside Git only if missing. The
tool checks the model against Whisper's official SHA-256 and disables network
connections during alignment. It never installs or downloads implicitly.

For inspection only, add `--prepare-only` instead of `--align`. This validates all
inputs and writes `reader/alignment-inputs.json`. To align separately:

```sh
/path/to/python reader/align.py \
  --inputs /absolute/path/to/audio-run/reader/alignment-inputs.json \
  --model /path/to/cache/base.en.pt
```

Re-run the generator without `--align`, `--python` or `--model` to reuse verified
timings. Playback needs no model. Previous reader files are backed up under
`reader/history/` before regeneration. Failed validation retains the last
published reader. Stop and restart the launcher after regeneration so its input
manifest refreshes.

## Open and listen

Open generated **reader/index.html** directly for file-based reading and playback
where allowed by your browser. A classic script bundle avoids local-file module
restrictions. File-origin storage and recognition vary by browser; live input
changes cannot be checked in this mode.

For stable notes, live identity checks, dictation and reliable MP3 seeking, use the
included launcher with a dedicated assigned port:

```sh
node /absolute/path/to/audio-run/reader/serve.mjs --port YOUR_ASSIGNED_PORT
```

Open `http://127.0.0.1:PORT/reader/` using the printed number. Keep the same
hostname, port and browser profile on future visits. The equivalent repository
command is:

```sh
npm run reader:serve -- --dir /absolute/path/to/audio-run/reader --port YOUR_ASSIGNED_PORT
```

Use a dedicated port separate from the main demo's root-scope service worker,
following the host port registry. An occupied port produces an error; the launcher
never stops another process or silently changes origins. `--port 0` is for isolated
tests only. The loopback server supports GET/HEAD and single byte ranges, exposing
only reader assets and paired MP3s. Other run files and browser notes are not served.

Choose a chapter, then Play. Seeking, pause/resume, start over and speed changes
drive highlights through `audio.currentTime`. One audio element prevents overlap.
Chapter switching pauses playback and restores the selected chapter's position.
Follow audio scrolls when the active word moves out of view; turn it off to browse.
The display preserves source punctuation, whitespace, paragraphs and scene breaks.
Markdown is displayed as source text rather than interpreted HTML.

## Alignment provenance

The aligner follows [stable-ts forced alignment](https://github.com/jianfch/stable-ts#alignment)
and `research/tools/align.py`, using the existing recording and exact prepared
text. Timing files record source/audio/narration hashes, package versions, model
hash, FFmpeg version and tool hash. Source mapping allows whitespace changes and
only the recorded `***` exclusions. Words and punctuation must match completely.

Timings are approximate machine estimates. Forced alignment does **not** prove
that every word was spoken or pronounced correctly. Collapsed words share the
next measured display window, as in the research viewer; raw timestamps remain
unchanged. A wholly collapsed segment can be retried against its MP3 crop located
using recorded synthesis sample boundaries. This runs another word alignment; it
does not interpolate word times. Initial warnings, original timings and repair
provenance are retained. Whitespace-only tokens are retained separately.
Unresolved warnings are shown in the reader. A final word without a measured
window, missing text, invalid bounds or stale hashes blocks generation.

`reader/verification.json` reports hashes, exact prose coverage, cue counts,
collapsed-cue counts and timing bounds for every chapter. The launcher rechecks
source, narration, receipt, audio and alignment on chapter selection, and the audio
hash on media requests. Changed inputs block playback/annotation until regenerated.
The displayed source snapshot never changes silently. Direct-file mode cannot
recheck linked MP3 bytes; regenerate after replacing inputs.

## Notes, dictation and recovery

Type chapter notes, or select text and choose **Comment on selection**. Partial
words expand to whole words. Edit retains a comment's ID, anchor and creation
time. Back keeps the separate draft. Delete and Discard require confirmation.
Deleting a saved comment also removes its edit draft.

Dictate notes/comment explicitly starts on-device `en-US` recognition. Chrome may
need its English language pack and microphone permission. No cloud fallback is
used. Dictation pauses playback without resetting it; playback cancels dictation.
Final results append once to the intended field while interim speech stays
separate. Chapter switching and leaving a draft invalidate late callbacks.
Typing remains available when recognition is unsupported.

Storage key `chapter-reader:v1:BOOK_ID:CHAPTER_ID:sidecar` holds schema 1: exact
source, saved comments, a separate draft and notes. Position keys also include
source/audio hashes; changed inputs cannot inherit old positions. Old position
keys remain available and selected chapter is saved separately.

Storage belongs to a browser profile/origin, not a backup or multi-tab merge
system. Keep one writing tab per chapter. Mismatched sources, unreadable records
and conflicting writes block replacement and expose **Export recovery data**.
Recovery includes untouched raw storage and in-memory work, including drafts.
Quota failures retain typed text in the open page; Save/Delete roll back their
saved-comment mutation. Export recovery before leaving. To deliberately start
over after recovery, remove only the reported key in browser storage tools and
reload. There is no automatic reset or import.

**Export chapter notes** uses schema **3**, extending the main demo's schema 2 with
`application`, `bookId`, `chapterId` and audio/narration hashes. It retains complete
source SHA-256/text, exact UTF-16 `[start,end)` anchors, `type: selection` comments
and one `type: general`, `anchor: null` entry for nonblank chapter notes. Note line
breaks are preserved. Unfinished drafts and interim speech are excluded. Export
before saving an edit uses the original saved body. Manuscripts are never edited.

## Verification

```sh
npm test
npm run build
python3 research/tools/verify.py
node reader/verify.mjs --dir /absolute/path/to/audio-run/reader --decode
```

Tests use synthetic inputs for 14 numerical pairings, Unicode offsets, stale
inputs, range serving, drafts, edits/deletes, exports, failed writes and conflicting
tabs. A Git-visible-only checkout needs no private book or local alignment assets.

`test/chapter-reader.browser.js` is a Playwright CLI `run-code` function for a
generated reader in a **dedicated test browser session**. Open the reader, take a
snapshot, then pass that file's text as the code argument. It verifies every
chapter, real media playback/seeking, clock-driven highlights, speed, Follow,
text preservation, comments, reload recovery, exports and narrow layouts.
Recognition events are controlled; the test never captures ambient audio.
Downloads/screenshots go to ignored `output/playwright/`. Real microphone accuracy
and full human listening review must be reported separately.
