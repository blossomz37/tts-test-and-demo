# Reader upgrade plan

Approved 2026-10-04 in the reader chat. Keep the two existing demos independent.

1. **Storage and recovery:** dedicated local SQLite database behind the loopback launcher; automatic snapshots, whole-book portable backup, previewed restore and Markdown revision briefs. Retain legacy browser data and expose explicit migration/recovery. Manuscripts/audio remain external authoritative inputs; notes never edit them.
2. **Reading and review:** ten-second seeks, chapter navigation, listen from a selection, speed-adjusted remaining time, saved preferences, focus view, reading settings, linked passage/comments, categories and resolution, book-wide search/review, bookmarks and chapter review progress.
3. **Launcher:** open/reuse the exact reader safely, app identity and installable window metadata. Installation does not promise playback with a stopped local server. Server-free offline caching remains a separately designed extension.

Explicitly deferred: custom keyboard shortcuts, headphone controls and system Media Session integration.

## Storage choice

Use Node's bundled SQLite (Node >=22.13). Arcwright already uses local SQLite, but its novel-planning schema is unrelated; no existing project database is modified. A read-only inspection of the target book workspace found no standalone database. Nearby AuthorOS has general notes/continuity records, but no reader annotation or audio-position schema; linking exports there can remain a later integration. Keep the new database in the generated reader's private `notes/` folder, excluded from generation overwrites and HTTP serving. Use transactions and optimistic revisions; never merge competing writes silently. Preserve browser recovery copies and offer explicit import of older browser-only notes. Use SQLite snapshots and portable validated JSON backups; normal chapter JSON exports continue excluding drafts.

## Acceptance

Fresh-profile recovery of every chapter note, exact comment anchor, draft, position and preference; rejected stale/foreign restores; rollback on failed persistence; competing-client protection; live browser playback, search/review and responsive layouts; controlled dictation only. Run tests/build and verify a Git-visible-only checkout. Private manuscripts, databases, snapshots and browser evidence stay outside the publish set.

## Completion evidence

Implemented the approved reader scope with SQLite notes, snapshots and previewed
backup restore; reading/review tools; app manifest/icon; and exact-reader launcher
reuse. Existing browser data remains intact and can be imported explicitly.

- 43 Node tests pass, including persistence restart, exact-source backup validation,
  transactional rollback, competing writes, preview invalidation, API origin/token
  checks and preservation of pending browser recovery.
- Browser acceptance passes on a generated synthetic fixture: real audio playback,
  forward/backward highlighting, seeking, controlled local dictation, comments,
  categories/resolution/drafts, bookmarks, focus/settings, search, Markdown/backup
  export, stale-preview rejection, restore, fresh-profile recovery, conflict
  handling and a 390px layout. Loading the saved database retains browser recovery.
- All 14 chapters of the private reader retain exact source/audio/alignment hashes.
  Its earlier browser listening position was previewed and imported into SQLite.
- Build, research verification (8 samples) and a Git-visible-only checkout's
  offline dependency install, all 43 tests and build pass.

Limits: real microphone accuracy, full human listening review, assistive-technology
review and installation across browser/OS combinations remain untested. No
server-free offline cache is implemented. The explicitly deferred keyboard and
headphone/system controls remain deferred. The minimum Node version's bundled
SQLite API is experimental; no additional native database dependency was added.
