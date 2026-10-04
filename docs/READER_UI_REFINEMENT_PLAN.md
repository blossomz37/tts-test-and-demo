# Reader UI refinement plan

Approved in the reader chat on 2026-10-04: plan and fix the screenshot-review findings, verify the changes, and repeat independent blind reviews.

## Bounded implementation

1. **Restore clarity:** replace raw counts with a Current / Backup comparison, named backup and creation date, textual changed-count warnings, and adjacent replacement/recovery explanation. Clear preview instructions on cancel; invalidate a previous preview when selecting another backup.
2. **Draft clarity:** label unfinished edits separately from their locally saved recovery state. Retain explicit Save comment acceptance. Keep database errors truthful and visible.
3. **Reading controls:** keep Previous/Next together, group time skips around Play, retain compact playback access while reading on narrow screens, and prevent the compact player from obstructing text entry. Reduce Focus view header/player spacing.
4. **Review context:** make search discoverable in the existing tools trigger and show source excerpts in passage-comment results.
5. **Export comprehension:** explain recovery backups, revision briefs, and chapter exports; disclose technical storage paths secondarily.

Use existing tokens and controls. Do not change manuscript/audio, backup identity/version validation, persistence semantics, comment acceptance, or the separate demos. Keyboard shortcuts, headphone/system controls, installation work and server-free offline mode remain deferred.

## Acceptance and delivery

- Targeted browser checks: restore counts/differences, backup identity, canceled/invalid previews, draft status and export-before-Save, search excerpts, narrow grouped controls, compact playback and focus/typing behavior.
- Existing Node tests and build; repeat the disposable reader workflow for playback, controlled dictation, drafts, restore, conflicts and profile recovery. Verify a checkout containing only Git-visible inputs.
- Regenerate the user's reader with existing verified alignments, preserve notes and generation history, restart only its known launcher, and confirm source/audio/alignment identity.
- Capture current desktop, dark/focus, annotation/search, restore and narrow states in an isolated sample database. Give only a neutral packet and new screenshots to three fresh-context reviewers.
- Consolidate their findings and distinguish fixed issues from residual hypotheses. Keep screenshots/private book data ignored. Commit and push the completed logical unit.

## Status

Complete. Implemented restore comparison and cancellation cleanup, explicit draft state, grouped chapter controls, compact mobile playback and Focus options, quoted review results, and explained export formats.

- 43 Node tests and build pass in the working tree and a Git-visible-only checkout; offline npm ci also passes.
- The extended disposable browser suite passes, including restore/cancel/invalid/stale previews, draft acceptance, compact playback, phone Focus options, fresh-profile saves and competing-write recovery. Dictation events were controlled.
- The live generated reader was regenerated and its known launcher restarted. All 14 chapter identities and MP3 decodes passed; saved reader records were preserved. Served files match the reviewed runtime.
- Three fresh blind screenshot reviewers found no visible delivery blocker. Their feedback prompted a tighter phone Focus layout and clearer backup scope. Two further fresh blind reviewers checked those final surfaces and found no visible blocker.
- Remaining optional work: content-level restore comparison and minor search/navigation/backup wording refinements. Physical-phone and assistive-technology audits remain separate.

Private screenshots, review packets, and detailed verification live in ignored output/playwright/ui-review-2026-10-04-round2/ and output/playwright/ui-review-2026-10-04-final/. No private book or reader database is included in Git.
