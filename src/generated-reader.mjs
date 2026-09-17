import { Reader } from './reader.mjs';
import { wavBlob } from './kokoro-engine.mjs';
export class GeneratedReader extends Reader {
  constructor({ engine, storage, emit, makeAudio = () => new Audio(), urls = URL }) {
    super({ synth: { cancel() {}, paused: false }, storage, emit });
    Object.assign(this, { engine, makeAudio, urls });
    this.voiceURI = 'af_heart'; this.cached = null; this.lastBlob = null;
  }
  invalidate() {
    this.generation++; this.cached = null; this.engine?.cancelGenerate?.();
    if (this.audio) { this.audio.onended = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = null; }
    if (this.url) { this.urls.revokeObjectURL(this.url); this.url = null; }
  }
  load(chunks, identity) { this.lastBlob = null; super.load(chunks, identity); }
  configure(settings) {
    super.configure(settings); this.cached = null;
  }
  play() {
    if (!this.chunks.length || ['speaking','starting','finished'].includes(this.state)) return;
    if (this.state === 'paused' && this.audio) {
      const generation = this.generation; this.state = 'speaking'; this.audio.play().catch(e => { if (generation === this.generation) this.fail(e); }); this.event('resume-request'); return;
    }
    if (this.index >= this.chunks.length) { this.state = 'finished'; this.event('finished'); return; }
    this.speak();
  }
  fail(error) { this.invalidate(); this.error = `${error.message}. Play retries this section.`; this.state = 'error'; this.event('error', { message: this.error }); }
  prepare(index) {
    const key = `${index}:${this.voiceURI}:${this.rate}`;
    if (this.cached?.key === key) return this.cached.promise;
    const voice = this.voiceURI, rate = this.rate, generation = this.generation;
    const promise = this.engine.generate(this.chunks[index], voice, rate).then(result => {
      if (generation === this.generation) this.event('synthesized', { section: index, voice, rate, synthesisMs: result.synthesisMs, audioSeconds: result.samples.length / result.sampleRate, realTimeFactor: result.synthesisMs / 1000 / (result.samples.length / result.sampleRate) });
      if (this.cached?.key === key) this.cached.ready = true;
      return result;
    });
    // Speculative failures are observed here; playback still receives the rejection.
    promise.catch(() => {});
    this.cached = { key, promise, ready: false }; return promise;
  }
  async speak() {
    const generation = this.generation, index = this.index, requested = this.now();
    if (index > 0 && !this.cached?.ready) this.event('buffer-wait', { section: index });
    this.state = 'starting'; this.error = ''; this.event('speak-request', { characters: this.chunks[index].length, voice: this.voiceURI, rate: this.rate });
    try {
      const result = await this.prepare(index);
      if (generation !== this.generation) return;
      this.cached = null;
      this.lastBlob = wavBlob(result.samples, result.sampleRate);
      if (this.url) this.urls.revokeObjectURL(this.url);
      this.url = this.urls.createObjectURL(this.lastBlob);
      const audio = this.makeAudio(); this.audio = audio; audio.src = this.url;
      audio.onended = () => {
        if (generation !== this.generation) return;
        this.index++; this.save(); this.event('end');
        if (this.index === this.chunks.length) { this.state = 'finished'; this.event('finished'); }
        else this.speak();
      };
      audio.onerror = () => { if (generation === this.generation) this.fail(Error('Audio playback failed')); };
      await audio.play();
      if (generation !== this.generation) { audio.pause(); return; }
      this.state = 'speaking'; this.event('start', { startupEventMs: this.now() - requested });
      // At most the next section is synthesized while the current section plays.
      if (index + 1 < this.chunks.length) this.prepare(index + 1);
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }
  pause() {
    if (this.state !== 'speaking') return;
    this.audio.pause(); this.state = 'paused'; this.event('pause-request');
  }
}
