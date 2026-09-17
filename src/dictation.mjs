// Append only finalized recognition results. Interim words never enter the saved note.
export function appendTranscript(current, text) {
  const spoken = text.trim(); if (!spoken) return current;
  return current + (current && !/\s$/.test(current) ? ' ' : '') + spoken;
}
export class Dictation {
  constructor({ Recognition, append, emit = () => {} }) {
    Object.assign(this, { Recognition, append, emit }); this.state = 'idle'; this.generation = 0;
  }
  update(state, message = '') { this.state = state; this.emit({ state, message }); }
  async start() {
    if (this.state !== 'idle') return;
    const C = this.Recognition, generation = ++this.generation;
    if (!C || !('processLocally' in C.prototype) || !C.available) {
      this.update('idle', 'On-device dictation is unavailable in this browser. You can still type your notes.'); return;
    }
    this.update('preparing', 'Preparing on-device dictation…');
    try {
      let availability = await C.available({ langs: ['en-US'], processLocally: true });
      if (generation !== this.generation) return;
      if (availability === 'downloadable' || availability === 'downloading') {
        this.update('preparing', 'Downloading English dictation for first use…');
        if (!C.install || !await C.install({ langs: ['en-US'], processLocally: true })) throw Error('English dictation could not be downloaded. Try again while online.');
        availability = await C.available({ langs: ['en-US'], processLocally: true });
      }
      if (generation !== this.generation) return;
      if (availability !== 'available') throw Error('On-device English dictation is unavailable in this browser. You can still type.');
      const recognition = new C(); this.recognition = recognition;
      recognition.lang = 'en-US'; recognition.processLocally = true; recognition.continuous = true; recognition.interimResults = true;
      const seen = new Set();
      recognition.onstart = () => { if (generation === this.generation) this.update('listening', 'Listening… Dictated words are added to the end of your notes.'); };
      recognition.onresult = event => {
        if (generation !== this.generation) return;
        let interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) { if (!seen.has(i)) { seen.add(i); this.append(result[0].transcript); } }
          else interim += result[0].transcript + ' ';
        }
        this.emit({ state: this.state, interim: interim.trim() });
      };
      recognition.onerror = event => {
        if (generation !== this.generation) return;
        const messages = { 'not-allowed':'Microphone access is blocked. Allow it in the browser, then try again.', 'audio-capture':'No microphone is available. Connect one or type your notes.', 'no-speech':'No speech detected. Click Dictate to try again.', 'network':'Dictation could not start. Your typed notes are safe.', 'language-not-supported':'English dictation is not installed. Click Dictate to retry setup.' };
        const message = messages[event.error] || `Dictation stopped (${event.error}). Your notes are safe.`;
        this.cancel(); this.update('idle', message);
      };
      recognition.onend = () => {
        if (generation !== this.generation) return;
        this.recognition = null; this.emit({ state:'idle', interim:'' }); this.update('idle', 'Notes saved on this device.');
      };
      this.update('starting', 'Allow microphone access if prompted…'); recognition.start();
    } catch (error) { if (generation === this.generation) { this.cancel(); this.update('idle', error.message); } }
  }
  stop() {
    if (this.recognition) { this.update('stopping', 'Finishing dictation…'); this.recognition.stop(); }
    else this.cancel();
  }
  cancel() {
    this.generation++; const recognition = this.recognition; this.recognition = null;
    recognition?.abort(); this.emit({ state:'idle', interim:'' }); this.update('idle');
  }
}
