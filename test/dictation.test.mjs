import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dictation, appendTranscript } from '../src/dictation.mjs';
function setup() {
  class Recognition {
    static available = async () => 'available';
    start() { this.onstart(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  Recognition.prototype.processLocally = false;
  let notes = 'Typed note.';
  const events = [];
  const d = new Dictation({ Recognition, append: text => { notes = appendTranscript(notes, text); }, emit: e => events.push(e) });
  return { d, Recognition, events, notes: () => notes, type: text => { notes += text; } };
}
const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });
test('final words append once to current typed notes; interim words stay separate', async () => {
  const s = setup(); await s.d.start();
  s.d.recognition.onresult({ results: [result('unfinished', false)] });
  assert.equal(s.notes(), 'Typed note.');
  s.type(' More typing.');
  const results = [result('Spoken note.', true), result('pending', false)];
  s.d.recognition.onresult({ results }); s.d.recognition.onresult({ results });
  assert.equal(s.notes(), 'Typed note. More typing. Spoken note.');
  assert.equal(s.events.at(-1).interim, 'pending');
  assert.equal(s.d.recognition.processLocally, true);
});
test('stop accepts final result before ending', async () => {
  const s = setup(); await s.d.start(); const r = s.d.recognition;
  s.d.stop(); assert.equal(r.stopped, true);
  r.onresult({ results: [result('Last words.', true)] }); r.onend();
  assert.equal(s.notes(), 'Typed note. Last words.'); assert.equal(s.d.state, 'idle');
});
test('cancelled setup never starts a microphone later', async () => {
  const s = setup(); let resolve;
  s.Recognition.available = () => new Promise(r => { resolve = r; });
  const pending = s.d.start(); s.d.cancel(); resolve('available'); await pending;
  assert.equal(s.d.recognition, null); assert.equal(s.d.state, 'idle');
});
test('denied microphone preserves notes and ignores late results', async () => {
  const s = setup(); await s.d.start(); const r = s.d.recognition;
  r.onerror({ error: 'not-allowed' }); r.onresult({ results: [result('late', true)] });
  assert.equal(s.notes(), 'Typed note.'); assert.match(s.events.at(-1).message, /blocked/);
});
test('unsupported local recognition leaves typing available', async () => {
  const events = []; const d = new Dictation({ emit: e => events.push(e) }); await d.start();
  assert.equal(d.state, 'idle'); assert.match(events.at(-1).message, /still type/);
});
test('append preserves line breaks and ignores empty recognition', () => {
  assert.equal(appendTranscript('Note\n', ' next '), 'Note\nnext');
  assert.equal(appendTranscript('Note', ' '), 'Note');
});
