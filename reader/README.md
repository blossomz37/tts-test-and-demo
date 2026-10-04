# Local chapter reader

Generate a private reader beside an existing audio run. It combines the research
viewer's single-audio, audio-clock-driven word highlighting with the main demo's
exact comment anchors and on-device English dictation. Both original demos remain
independent. No narration is generated and no provider calls are made.

## Generate

Use Node >=22.13 and `npm ci`. The supported input is a local narration run with:

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
node /absolute/path/to/audio-run/reader/serve.mjs --port YOUR_ASSIGNED_PORT --open
```

Open `http://127.0.0.1:PORT/reader/` using the printed number. Keep the same
hostname and port on future visits. SQLite notes are shared across browser profiles; browser recovery copies remain profile-specific. The equivalent repository
command is:

```sh
npm run reader:serve -- --dir /absolute/path/to/audio-run/reader --port YOUR_ASSIGNED_PORT
```

Use a dedicated port separate from the main demo's root-scope service worker,
following the host port registry. An occupied port produces an error; the launcher
never stops another process or silently changes origins. `--port 0` is for isolated
tests only. The loopback server supports GET/HEAD and single byte ranges for reader assets and paired MP3s. Its notes API requires an exact local origin and a per-launch token for writes. Database files, snapshots and unrelated run files are never served. `--open` opens the browser and reuses an existing server only when its reader identity matches exactly.

Choose a chapter, then Play. Seeking, pause/resume, start over and speed changes
drive highlights through `audio.currentTime`. One audio element prevents overlap.
Chapter switching pauses playback and restores the selected chapter's position.
Follow audio scrolls when the active word moves out of view; turn it off to browse.
The display preserves source punctuation, whitespace, paragraphs and scene breaks.
Markdown is displayed as source text rather than interpreted HTML.

The Quiet Manuscript design uses warm neutral surfaces, green playback cues,
plum comment underlines, and blue selection. The sentence gutter marker retains
the listening location while paused. Under **Search & book tools → Reading
settings**, choose serif or sans-serif text, size, spacing, width, and light/dark
appearance. Existing saved appearance choices and older backups remain supported;
the new reading-font choice defaults to serif. A fresh reader follows the system
theme until an appearance choice is saved. See the [visual design brief](../docs/READER_VISUAL_DESIGN_BRIEF.md).

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

With the launcher, the authoritative reader state lives in **`reader/notes/reader.sqlite`**.
This is a dedicated SQLite database using Node's bundled `node:sqlite` (experimental
in the minimum supported Node release). It stores validated book records and a
revision number in transactions. It does not modify source manuscripts or audio.
No third-party database service, account or native npm extension is required.
The generated launcher bundles its own application modules.

The page retains an emergency browser copy while commits are pending. The save
status distinguishes pending work from confirmed database saves. An interrupted
save exposes **Recover pending edits**; it is never silently replayed. Old browser
keys remain intact and can be imported explicitly through **Search & book tools → Backups &
exports → Import browser notes**. Imported records must match the book, exact
source and recording. Conflicts are blocked rather than automatically merged.
A failed saved-comment mutation restores its earlier UI state and asks for recovery;
an uncertain network outcome requires reload to inspect the database.

A verified SQLite snapshot is made before the first write in a server session,
before later writes at least five minutes apart, and before every restore. These
snapshots remain under `notes/backups/`; no automatic deletion is performed.
Regeneration preserves the entire notes directory. Copy a completed snapshot for
an independent database backup; do not copy an active SQLite file without its WAL.

**Back up reader data** exports a portable version-1 JSON backup with all notes,
saved comments, unfinished drafts, bookmarks, review progress, reading preferences
and positions. The original audio is referenced by hash and is not embedded.
**Restore backup** validates every identity and anchor, previews current/incoming
counts, and requires explicit Apply. A preview expires after five minutes and is
invalidated by competing database writes. The previous database is snapshotted
before replacement. Manuscript/version mismatches are blocked and retained for
manual review; there is no automatic anchor relocation.

Direct-file mode retains the older browser-only behavior and does not offer
SQLite restore. Use the launcher for durable saves. **Export recovery data** includes
current in-memory work and the retained browser recovery copy. Browser and disk
storage errors must be resolved before leaving an unsaved page.

**Export chapter JSON** uses schema **3**, extending the main demo's schema 2 with
`application`, `bookId`, `chapterId` and audio/narration hashes. It retains complete
source SHA-256/text, exact UTF-16 `[start,end)` anchors, `type: selection` comments
and one `type: general`, `anchor: null` entry for nonblank chapter notes. Note line
breaks are preserved. Unfinished drafts and interim speech are excluded. Export
before saving an edit uses the original saved body. Manuscripts are never edited.

## Reading and revision workspace

The player provides previous/next chapter, ten-second skips, selection-based
**Listen from here**, speed-adjusted remaining time and remembered speed/Follow.
**Focus view** hides the notes rail. **Search & book tools** contains text size, line spacing,
reading width, appearance, book-wide text/comment search and review filters.
Comments have optional categories and open/resolved state. Click an underlined
word to reveal its comment; each comment offers Show passage and Listen.
Bookmarks and chapter-reviewed state are stored with source/audio identity.

**Export revision brief** produces readable Markdown with saved notes, quoted
passages, categories, resolution and source offsets; unfinished drafts are excluded.
Normal chapter JSON remains export schema 3. Full-book restore uses its separate
backup format, not chapter-export JSON.

Generated readers include a manifest and icon for browsers supporting standalone
installation. Installation has not been verified on every browser/OS. The launcher
must be running; no service worker or server-free offline cache is installed.
Custom keyboard shortcuts and headphone/system media controls are explicitly deferred.

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

`test/chapter-reader.browser.js` covers exact source and playback/highlights across every chapter of a disposable reader.
`test/reader-upgrade.browser.js` covers SQLite workflows in a disposable
`reader-verification` fixture only, including fresh browser profiles and conflicts.
Create the synthetic fixture with `node test/prepare-reader-fixture.mjs` (requires FFmpeg), then start its printed launcher with `--port 0`. Use a fresh fixture for each editing run.
Both are Playwright CLI `run-code` function for a
generated reader in a **dedicated test browser session**. Open the reader, take a
snapshot, then pass that file's text as the code argument. It verifies every
chapter, real media playback/seeking, clock-driven highlights, speed, Follow,
text preservation, comments, reload recovery, exports and narrow layouts.
Recognition events are controlled; the test never captures ambient audio.
Downloads/screenshots go to ignored `output/playwright/`. Real microphone accuracy
and full human listening review must be reported separately.

The restore preview identifies the chosen backup and its creation date, compares
current and backup counts, and emphasizes changed counts (including drafts).
Matching counts do not imply identical content. Cancel closes and clears the
preview; selecting another file invalidates the prior preview.

Comment editors report draft persistence separately from **Save comment**, which
updates the saved comment and revision exports. Search results for comments retain
a short excerpt of the anchored passage. Backup/export descriptions explain which
files support recovery; the database path is under Storage details.

On narrow screens, chapter navigation stays paired and a compact player appears
when the main player scrolls out of view. It hides during text entry and uses the
same audio element and playback controls. Focus view reduces header overhead; phone Focus keeps chapter, speed and Follow settings under Playback options.
