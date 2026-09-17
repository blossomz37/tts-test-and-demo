export const SPLITTER_VERSION = 'sentence-v1';
export function normalize(text) {
  return text.replace(/^#{1,6}\s+/gm, '').replace(/\s+/gu, ' ').trim();
}
export function splitText(input, limit = 1000) {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Invalid chunk size');
  const text = normalize(input);
  if (!text) return [];
  const segments = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(s => s.segment);
  const chunks = [];
  let current = '';
  for (let segment of segments) {
    if (current && current.length + segment.length > limit) { chunks.push(current); current = ''; }
    while (segment.length > limit) {
      let cut = segment.lastIndexOf(' ', limit - 1) + 1;
      if (cut < limit / 2) cut = limit;
      if (/[\uD800-\uDBFF]/.test(segment[cut - 1])) cut--;
      chunks.push(segment.slice(0, cut));
      segment = segment.slice(cut);
    }
    current += segment;
  }
  if (current) chunks.push(current);
  return chunks;
}
export async function textHash(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export class Reader {
  constructor({ synth, makeUtterance, storage, emit = () => {}, now = () => performance.now() }) {
    Object.assign(this, { synth, makeUtterance, storage, emit, now });
    this.chunks = []; this.index = 0; this.state = 'idle'; this.generation = 0;
    this.voiceURI = ''; this.rate = 1; this.key = ''; this.error = ''; this.utterance = null;
  }
  event(type, extra = {}) { this.emit({ type, state: this.state, index: this.index, total: this.chunks.length, at: this.now(), ...extra }); }
  invalidate() {
    this.generation++; this.utterance = null;
    this.synth.cancel();
    // cancel() does not clear the synthesis paused flag.
    if (this.synth.paused) this.synth.resume();
  }
  save() {
    if (!this.key) return;
    try { this.storage?.setItem(this.key, JSON.stringify({ index: this.index })); }
    catch { this.event('storage-warning', { message: 'Progress could not be saved.' }); }
  }
  load(chunks, identity) {
    this.stop(); this.chunks = chunks; this.index = 0; this.key = `tts-lab:${identity}`; this.error = '';
    try {
      const saved = JSON.parse(this.storage?.getItem(this.key) ?? 'null');
      if (Number.isInteger(saved?.index) && saved.index >= 0 && saved.index <= chunks.length) this.index = saved.index;
    } catch { this.event('storage-warning', { message: 'Saved progress unavailable; starting at the beginning.' }); }
    this.state = chunks.length && this.index === chunks.length ? 'finished' : 'idle';
    this.event('loaded');
  }
  configure({ voiceURI = this.voiceURI, rate = this.rate }) {
    if (!Number.isFinite(rate) || rate < .5 || rate > 2) throw new Error('Invalid rate');
    this.voiceURI = voiceURI; this.rate = rate;
    this.event('settings', { voiceURI, rate, applies: 'next chunk' });
  }
  play() {
    if (['speaking', 'starting'].includes(this.state) || !this.chunks.length) return;
    if (this.state === 'paused') { this.synth.resume(); if (!this.utterance) { this.speak(); return; } this.state = 'speaking'; this.event('resume-request'); return; }
    if (this.state === 'finished' || this.index >= this.chunks.length) { this.state = 'finished'; this.event('finished'); return; }
    this.speak();
  }
  speak() {
    const voice = this.synth.getVoices().find(v => v.voiceURI === this.voiceURI && v.localService === true);
    if (!voice) { this.state = 'error'; this.error = 'Choose an available local voice. No default or online fallback was used.'; this.event('error', { message: this.error }); return; }
    const utterance = this.makeUtterance(this.chunks[this.index]);
    const generation = ++this.generation;
    const active = () => this.generation === generation && this.utterance === utterance;
    this.utterance = utterance; this.error = '';
    utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = this.rate;
    const requested = this.now();
    utterance.onstart = () => { if (active()) { this.state = 'speaking'; this.event('start', { startupEventMs: this.now() - requested, voice: voice.name, voiceURI: voice.voiceURI, rate: utterance.rate }); } };
    utterance.onpause = () => { if (active()) { this.state = 'paused'; this.event('pause-event'); } };
    utterance.onresume = () => { if (active()) { this.state = 'speaking'; this.event('resume-event'); } };
    utterance.onend = () => {
      if (!active()) return;
      this.utterance = null; this.index++; this.save(); this.event('end');
      if (this.index === this.chunks.length) { this.state = 'finished'; this.event('finished'); }
      else if (this.synth.paused) { this.state = 'paused'; this.event('paused-between-chunks'); }
      else this.speak();
    };
    utterance.onerror = event => {
      if (!active()) return;
      this.generation++; this.utterance = null; this.state = 'error';
      this.error = `Speech stopped (${event.error}). Play retries this section.`;
      this.event('error', { message: this.error });
    };
    this.state = 'starting'; this.event('speak-request', { characters: utterance.text.length, voice: voice.name, voiceURI: voice.voiceURI, rate: utterance.rate });
    try { this.synth.speak(utterance); }
    catch (error) { utterance.onerror({ error: error.message }); }
  }
  pause() {
    if (this.state !== 'speaking') return;
    this.synth.pause(); this.state = 'paused'; this.event('pause-request');
  }
  stop() { this.invalidate(); this.state = this.chunks.length && this.index === this.chunks.length ? 'finished' : 'idle'; this.save(); this.event('stop'); }
  seek(index) {
    this.invalidate(); this.index = Math.max(0, Math.min(this.chunks.length, index));
    this.state = this.chunks.length && this.index === this.chunks.length ? 'finished' : 'idle';
    this.error = ''; this.save(); this.event('seek');
  }
}
