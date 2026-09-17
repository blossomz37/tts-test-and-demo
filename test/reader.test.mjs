import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Reader, normalize, splitText } from '../src/reader.mjs';
const voice = { voiceURI: 'local', name: 'Test', lang: 'en-US', localService: true };
function harness(storage = new Map()) {
  const events = [], spoken = [];
  const synth = { paused: false, voices: [voice], getVoices() { return this.voices; }, cancel() {}, pause() { this.paused = true; }, resume() { this.paused = false; }, speak(u) { spoken.push(u); } };
  const reader = new Reader({ synth, makeUtterance: text => ({ text }), storage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, emit: e => events.push(e) });
  reader.configure({ voiceURI: 'local' });
  reader.load(['One. ', 'Two.'], 'chapter');
  return { reader, synth, spoken, events, storage };
}
for (const limit of [500, 1000, 1800]) {
  test(`chapter and edge text survive chunking at ${limit}`, () => {
    for (const text of [readFileSync('fixtures/long.txt', 'utf8'), readFileSync('fixtures/edge.txt', 'utf8'), 'x'.repeat(5000), '🏮'.repeat(2000), '“Wait!” she said. “Why?”\n\nYes… no.']) {
      const chunks = splitText(text, limit);
      assert.equal(chunks.join(''), normalize(text));
      assert.ok(chunks.every(c => c.length <= limit && c.isWellFormed()));
    }
  });
}
test('empty text never speaks or creates negative positions', () => {
  const {reader, spoken} = harness(); reader.load([], 'empty'); reader.seek(-1); reader.play(); assert.equal(reader.index, 0); assert.equal(spoken.length, 0);
});
test('repeated play and stale completion cannot overlap or skip', () => {
  const {reader, spoken} = harness(); reader.play(); reader.play(); assert.equal(spoken.length, 1);
  const old = spoken[0]; reader.seek(1); reader.play(); old.onend(); old.onerror({error: 'bad'}); old.onstart();
  assert.equal(reader.index, 1); assert.equal(spoken.length, 2); assert.equal(reader.state, 'starting');
});
test('local-only refuses remote and missing voices', () => {
  const {reader, synth, spoken} = harness(); synth.voices = [{...voice, localService: false}]; reader.play(); assert.equal(reader.state, 'error'); assert.equal(spoken.length, 0);
  synth.voices = []; reader.play(); assert.equal(spoken.length, 0);
});
test('pause stop play clears synthesis pause; old callback ignored', () => {
  const {reader, synth, spoken} = harness(); reader.play(); spoken[0].onstart(); reader.pause(); assert.equal(reader.state, 'paused'); reader.play(); assert.equal(spoken.length, 1);
  reader.pause(); reader.stop(); assert.equal(synth.paused, false); reader.play(); spoken[0].onend(); assert.equal(reader.index, 0); assert.equal(spoken.length, 2);
});
test('saved progress stays at unfinished chunk; completed chapter stays complete', () => {
  const {reader, spoken, storage} = harness(); reader.play(); spoken[0].onend(); assert.equal(reader.index, 1);
  const restored = harness(storage); assert.equal(restored.reader.index, 1);
  spoken[1].onend(); assert.equal(reader.state, 'finished'); reader.play(); assert.equal(spoken.length, 2);
  const completed = harness(storage); assert.equal(completed.reader.state, 'finished'); completed.reader.stop(); completed.reader.play(); assert.equal(completed.spoken.length, 0);
});
test('new chapter or hash identity starts at zero', () => {
  const {reader, spoken} = harness(); reader.play(); spoken[0].onend(); reader.load(['Changed.'], 'chapter:new-hash'); assert.equal(reader.index, 0); spoken[1].onend(); assert.equal(reader.index, 0);
});
test('malformed and denied storage do not block reading', () => {
  const {reader, spoken} = harness(new Map([['tts-lab:chapter', '{broken']])); reader.play(); assert.equal(spoken.length, 1);
  reader.storage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } }; reader.load(['OK'], 'denied'); reader.play(); spoken.at(-1).onend(); assert.equal(reader.state, 'finished');
});
test('voice/rate changes apply on next chunk and active errors are recoverable', () => {
  const {reader, spoken} = harness(); reader.play(); reader.configure({rate: 1.25}); assert.equal(spoken[0].rate, 1); spoken[0].onend(); assert.equal(spoken[1].rate, 1.25);
  spoken[1].onerror({error: 'interrupted'}); assert.equal(reader.state, 'error'); reader.play(); assert.equal(spoken.at(-1).text, 'Two.');
});
test('pause on a chunk boundary resumes the next chunk rather than hanging', () => {
  const {reader, spoken} = harness(); reader.play(); spoken[0].onstart(); reader.pause(); spoken[0].onend();
  assert.equal(reader.index, 1); assert.equal(reader.state, 'paused'); assert.equal(spoken.length, 1);
  reader.play(); assert.equal(spoken.length, 2); assert.equal(spoken[1].text, 'Two.');
});
