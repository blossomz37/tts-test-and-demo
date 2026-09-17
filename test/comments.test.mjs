import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchor, matches, makeComment, sourceIdentity } from '../src/comments.mjs';
test('anchors distinguish repeated words and preserve punctuation and Unicode', async () => {
  const text = '“Useful.” 🪶 Useful.';
  const target = anchor(text, 13, 19);
  assert.equal(target.quote, 'Useful');
  const source = await sourceIdentity(text), c = makeComment(source, target, '  Clarify this.  ');
  assert.equal(c.body, 'Clarify this.'); assert.equal(c.sourceSha256.length, 64);
  assert.equal(source.text, text); assert.equal(c.anchor.start, 13);
});
test('changed passage and empty comments cannot be silently attached', async () => {
  const target = anchor('One two', 4, 7);
  assert.equal(matches('One six', target), false);
  assert.throws(() => makeComment({text:'One six'}, target, 'Fix it'));
  assert.throws(() => makeComment({text:'One two'}, target, ' '));
  assert.throws(() => anchor('abc', -1, 2));
});
test('revision preserves identity, creation time and anchor without mutating saved comment', async () => {
  const { reviseComment } = await import('../src/comments.mjs');
  const source = await sourceIdentity('One two');
  const saved = makeComment(source, anchor(source.text, 4, 7), 'Original');
  const updated = reviseComment(source, saved, ' Revised comment. ');
  assert.equal(saved.body, 'Original');
  assert.equal(updated.id, saved.id); assert.equal(updated.createdAt, saved.createdAt);
  assert.deepEqual(updated.anchor, saved.anchor); assert.equal(updated.body, 'Revised comment.');
  assert.ok(updated.updatedAt);
  assert.throws(() => reviseComment({...source,sha256:'changed'}, saved, 'Text'));
  assert.throws(() => reviseComment(source, saved, ' '));
});
test('selection snaps outward to whole words but not into punctuation or spaces', async () => {
  const { snapToWords } = await import('../src/comments.mjs');
  const text = 'The Apothecary sank, “bound” now.';
  assert.deepEqual(snapToWords(text, 6, 18), { start: 4, end: 19 }); // "Apothecary sank"
  assert.deepEqual(snapToWords(text, 4, 14), { start: 4, end: 14 }); // already whole
  assert.deepEqual(snapToWords(text, 23, 25), { start: 22, end: 27 }); // inside “bound”
  assert.deepEqual(snapToWords(text, 3, 4), { start: 3, end: 4 }); // a lone space stays as is
});
test('relative time reads like a human note', async () => {
  const { relativeTime } = await import('../src/comments.mjs');
  const now = Date.parse('2026-09-17T12:00:00Z');
  assert.equal(relativeTime('2026-09-17T11:59:50Z', now), 'just now');
  assert.equal(relativeTime('2026-09-17T11:57:00Z', now), '3 min ago');
  assert.equal(relativeTime('2026-09-17T09:00:00Z', now), '3 h ago');
  assert.match(relativeTime('2026-09-01T09:00:00Z', now), /Sep/);
});
