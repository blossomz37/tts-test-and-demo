import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anchor } from '../src/comments.mjs';
import { narrationMap, mapAlignment, activeCues } from '../reader/alignment.mjs';
import { SidecarStore, readPosition, positionKey } from '../reader/state.mjs';
import { hash, inspectInputs } from '../reader/inputs.mjs';
import { byteRange, createReaderServer } from '../reader/serve.mjs';
import { sentenceCueAnchors, playbackAction, shouldFollowAudio, paragraphRanges } from '../reader/reading-state.mjs';

const source = { id: 'chapter-01', text: 'One 🪶 two.\n\n***\n\nOne more.', sha256: 'source-a' };
const chapter = { id: source.id, source, audioSha256: 'audio-a', narrationSha256: 'narration-a', duration: 10 };
test('paragraph references preserve UTF-16 source offsets across soft lines and scene breaks', () => {
  const text = ' \r\n\r\n  One 🪶 two.\r\nStill one paragraph.\r\n \t\r\n***\r\n\r\n“Second paragraph.”  \r\n\r\nThird.';
  const ranges = paragraphRanges(text);
  assert.deepEqual(ranges.map(p => p.number), [1, 2, 3]);
  assert.deepEqual(ranges.map(p => text.slice(p.start, p.end)), ['One 🪶 two.\r\nStill one paragraph.', '“Second paragraph.”', 'Third.']);
  assert.equal(ranges[1].start, text.indexOf('“Second'));
  assert.deepEqual(paragraphRanges('\n \t\n***\n\n* * *\n'), []);
  assert.deepEqual(paragraphRanges('One\nsoft line.\n\nTwo'), [{ number: 1, start: 0, end: 14 }, { number: 2, start: 16, end: 19 }]);
});
test('sentence marker groups exact UTF-16 cues without changing multiline source or timing', () => {
  const text = 'One 🪶 two.\n“Three four!” Fifth\nword.';
  const cues = [...text.matchAll(/One|🪶|two|Three|four|Fifth|word/gu)].map((m, i) => ({ from: m.index, to: m.index + m[0].length, start: i, displayEnd: i + .8 }));
  const original = structuredClone(cues), expected = [0, 0, 0, 3, 3, 5, 5];
  assert.deepEqual(sentenceCueAnchors(text, cues), expected);
  assert.deepEqual(sentenceCueAnchors(text, cues, null), expected);
  assert.deepEqual(cues, original);
  assert.equal(text.slice(cues[1].from, cues[1].to), '🪶');
  assert.deepEqual(sentenceCueAnchors('', [], null), []);
  const withUntimedHeading = 'Chapter\n\nOne two.';
  assert.deepEqual(sentenceCueAnchors(withUntimedHeading, [{ from: 9, to: 12 }, { from: 13, to: 17 }]), [0, 0]);
});
test('paused positions offer Resume and follow scrolling yields to editing and selection', () => {
  assert.equal(playbackAction(true, false, 0), 'Play');
  assert.equal(playbackAction(true, false, 3.5), 'Resume');
  assert.equal(playbackAction(false, false, 3.5), 'Pause');
  assert.equal(playbackAction(true, true, 10), 'Play');
  const state = { follow: true, activeIndex: 4, lastFollow: 3, selectionCollapsed: true, editing: false };
  assert.equal(shouldFollowAudio(state), true);
  for (const override of [{ editing: true }, { selectionCollapsed: false }, { follow: false }, { activeIndex: -1 }, { lastFollow: 4 }]) assert.equal(shouldFollowAudio({ ...state, ...override }), false);
});
class Storage {
  map = new Map(); fail = false;
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { if (this.fail) throw Error('Quota exceeded'); this.map.set(key, value); }
}
test('exact narration mapping skips only recorded scene markers and whitespace; preserves UTF-16', () => {
  const text = source.text, start = text.indexOf('***');
  const narration = 'One 🪶 two. One more.';
  const mapping = narrationMap(text, narration, [{ kind: 'scene_separator', start, end: start + 3, text: '***' }]);
  assert.equal(mapping[4], 4); assert.equal(mapping[5], 5);
  assert.equal(mapping[narration.indexOf('more')], text.indexOf('more'));
  assert.throws(() => narrationMap(text, narration), /mismatch/);
  assert.throws(() => narrationMap('One two.', 'One six.'), /mismatch/);
  assert.throws(() => narrationMap('One two.', 'One'), /full source/);
});
test('word cues reject stale audio, skipped words, bad order, and unmeasured final words', () => {
  const c = { ...chapter, source: { ...source, text: 'One two.' }, narration: 'One two.', exclusions: [] };
  const a = { source_sha256: source.sha256, audio_sha256: c.audioSha256, input_sha256: c.narrationSha256, words: [{ text: 'One', start: 0, end: 0 }, { text: ' two.', start: 0, end: 1 }] };
  const cues = mapAlignment(c, a);
  assert.equal(cues[0].displayEnd, 1); assert.equal(cues[0].end, 0);
  assert.equal(activeCues(cues, .5).length, 2); assert.deepEqual(activeCues(cues, 1), []); assert.deepEqual(activeCues(cues, .5, true), []);
  assert.throws(() => mapAlignment(c, { ...a, audio_sha256: 'replaced' }), /Stale/);
  assert.throws(() => mapAlignment(c, { ...a, words: [a.words[1]] }), /mismatch/);
  assert.throws(() => mapAlignment(c, { ...a, words: [{ ...a.words[0], start: -1 }] }), /bounds/);
  assert.throws(() => mapAlignment(c, { ...a, words: a.words.map(w => ({ ...w, start: 0, end: 0 })) }), /no measured/);
});
test('draft recovery, edit identity, original export before Save, notes and deletion', () => {
  const disk = new Storage(), s = new SidecarStore(disk, 'book', chapter), a = anchor(source.text, 7, 10);
  s.notes('Line one\nLine two\n'); s.draft({ anchor: a, body: 'Draft' });
  assert.equal(s.export().comments.length, 1); assert.equal(s.export().comments[0].body, 'Line one\nLine two\n');
  const restored = new SidecarStore(disk, 'book', chapter);
  assert.equal(restored.state.draft.body, 'Draft'); restored.saveComment();
  const saved = restored.state.comments[0];
  restored.draft({ commentId: saved.id, anchor: saved.anchor, body: 'Edited draft' });
  assert.equal(restored.export().comments[0].body, 'Draft');
  restored.saveComment(); const updated = restored.state.comments[0];
  assert.equal(updated.id, saved.id); assert.deepEqual(updated.anchor, a); assert.equal(updated.createdAt, saved.createdAt); assert.ok(updated.updatedAt);
  assert.equal(updated.body, 'Edited draft'); assert.equal(restored.export().schemaVersion, 3);
  restored.draft({ commentId: saved.id, anchor: a, body: 'Another edit' });
  restored.deleteComment(saved.id); assert.deepEqual(restored.state.comments, []); assert.equal(restored.state.draft, null);
  assert.equal(new SidecarStore(disk, 'different-book', chapter).state.notes, '');
});
test('unreadable, stale-source and cross-tab sidecars are preserved, never replaced', () => {
  const disk = new Storage(), s = new SidecarStore(disk, 'book', chapter); s.notes('Original');
  const original = disk.getItem(s.key);
  const stale = new SidecarStore(disk, 'book', { ...chapter, source: { ...source, sha256: 'changed' } });
  assert.equal(stale.blocked, true); assert.equal(stale.notes('Overwrite'), false); assert.equal(disk.getItem(s.key), original);
  disk.setItem(s.key, '{ broken'); const broken = new SidecarStore(disk, 'book', chapter);
  assert.equal(broken.blocked, true); assert.equal(broken.recovery().originalRaw, '{ broken');
  disk.setItem(s.key, original);
  const a = new SidecarStore(disk, 'book', chapter), b = new SidecarStore(disk, 'book', chapter);
  a.notes('Other tab'); assert.equal(b.notes('My pending note'), false); assert.equal(b.blocked, true);
  assert.equal(b.recovery().inMemory.notes, 'My pending note'); assert.equal(JSON.parse(disk.getItem(s.key)).notes, 'Other tab');
});
test('failed persistence retains typing, rolls back Save/Delete, and can recover', () => {
  const disk = new Storage(), s = new SidecarStore(disk, 'book', chapter);
  s.draft({ anchor: anchor(source.text, 0, 3), body: 'Saved' }); s.saveComment();
  const saved = s.state.comments[0];
  s.draft({ commentId: saved.id, anchor: saved.anchor, body: 'Edited' }); disk.fail = true;
  assert.equal(s.saveComment(), false); assert.equal(s.state.comments[0].body, 'Saved'); assert.equal(s.state.draft.body, 'Edited');
  assert.equal(s.deleteComment(saved.id), false); assert.equal(s.state.comments.length, 1);
  s.notes('Unsaved typing'); assert.equal(s.dirty, true); assert.equal(s.export().comments.at(-1).body, 'Unsaved typing');
  disk.fail = false; assert.equal(s.write(), true); assert.equal(s.dirty, false);
});
test('saved positions are bound to source and audio identity', () => {
  const raw = JSON.stringify({ sourceSha256: source.sha256, audioSha256: chapter.audioSha256, time: 4.5 });
  assert.equal(readPosition(raw, chapter), 4.5);
  assert.throws(() => readPosition(raw, { ...chapter, audioSha256: 'new recording' }), /different inputs/);
  assert.notEqual(positionKey('book', chapter), positionKey('book', { ...chapter, audioSha256: 'new recording' }));
  assert.throws(() => readPosition('{broken', chapter));
});
test('byte ranges support seeking, suffixes, HEAD bounds, and reject invalid ranges', () => {
  assert.deepEqual(byteRange('bytes=3-6', 10), { start: 3, end: 6, status: 206 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9, status: 206 });
  assert.deepEqual(byteRange('bytes=5-', 10), { start: 5, end: 9, status: 206 });
  for (const range of ['bytes=-0', 'bytes=10-', 'bytes=6-3', 'bytes=0-2,4-6', 'bad']) assert.throws(() => byteRange(range, 10));
});
test('14 numerical pairings, stale inputs, live identity and contained range server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chapter-reader-'));
  let server;
  try {
    const chapters = join(root, 'chapters'), audioRun = join(root, 'run');
    for (const d of [chapters, ...['mp3', 'prepared', 'receipts', 'reader'].map(d => join(audioRun, d))]) await mkdir(d, { recursive: true });
    const inputs = [];
    for (let n = 1; n <= 14; n++) {
      const id = `chapter-${String(n).padStart(2, '0')}`, file = `ch${n}_Final_v1.md`, text = `Chapter prose ${n}.`, bytes = Buffer.from('0123456789');
      await writeFile(join(chapters, file), text); await writeFile(join(audioRun, 'prepared', `${id}.txt`), text); await writeFile(join(audioRun, 'mp3', `${id}.mp3`), bytes);
      const input = { file, chapter: n, sha256: hash(text), prepared_sha256: hash(text), exclusions: [] }; inputs.push(input);
      await writeFile(join(audioRun, 'receipts', `${id}.json`), JSON.stringify({ status: 'complete', chapter: n, source_sha256: input.sha256, prepared_sha256: input.prepared_sha256, exclusions: [], duration_seconds: 5, mp3: { file: `mp3/${id}.mp3`, sha256: hash(bytes) } }));
    }
    await writeFile(join(audioRun, 'render-config.json'), JSON.stringify({ inputs }));
    const data = await inspectInputs({ chapters, audioRun, bookId: 'synthetic' });
    assert.deepEqual(data.chapters.map(c => c.number), Array.from({ length: 14 }, (_, i) => i + 1));
    await writeFile(join(audioRun, 'reader', 'inputs.json'), JSON.stringify(data));
    await writeFile(join(audioRun, 'reader', 'index.html'), '<!doctype html>test');
    server = await createReaderServer(join(audioRun, 'reader'));
    await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${origin}/mp3/chapter-01.mp3`, { headers: { Range: 'bytes=3-6' } });
    assert.equal(res.status, 206); assert.equal(await res.text(), '3456');
    assert.equal((await fetch(`${origin}/reader/inputs.json`)).status, 404);
    assert.equal((await fetch(`${origin}/reader/integrity/chapter-01`)).status, 200);
    await writeFile(join(chapters, 'ch1_Final_v1.md'), 'Changed');
    assert.equal((await fetch(`${origin}/reader/integrity/chapter-01`)).status, 409);
    await assert.rejects(inspectInputs({ chapters, audioRun }), /Recorded source mismatch/);
    await writeFile(join(audioRun, 'mp3/chapter-01.mp3'), 'changed audio');
    assert.equal((await fetch(`${origin}/mp3/chapter-01.mp3`)).status, 409);
  } finally { if (server) await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); }
});
