export const KOKORO_VOICES = [
  { voiceURI: 'af_heart', name: 'Heart', lang: 'en-US', localService: true },
  { voiceURI: 'af_bella', name: 'Bella', lang: 'en-US', localService: true },
  { voiceURI: 'am_michael', name: 'Michael', lang: 'en-US', localService: true },
  { voiceURI: 'bm_fable', name: 'Fable', lang: 'en-GB', localService: true },
];
export class KokoroEngine {
  constructor(emit = () => {}) { this.emit = emit; this.pending = new Map(); this.serial = 0; this.backend = 'wasm'; this.epoch = 0; }
  request(type, args = {}) {
    if (!this.worker) {
      this.worker = new Worker('/vendor/kokoro-worker.js', { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (!data.id) { this.emit(data); return; }
        const pending = this.pending.get(data.id); if (!pending) return;
        this.pending.delete(data.id);
        if (data.type === 'error') pending.reject(Error(data.message)); else pending.resolve(data);
      };
      this.worker.onerror = e => { const error = Error(e.message || 'Kokoro worker failed'); this.dispose(error); this.emit({ type: 'engine-error', message: error.message }); };
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, type }); this.worker.postMessage({ id, type, epoch: this.epoch, backend: this.backend, ...args }); });
  }
  initialize() { return this.request('initialize'); }
  generate(text, voice, rate) { return this.request('generate', { text, voice, rate }); }
  cancelGenerate() {
    this.epoch++; this.worker?.postMessage({ type: 'cancel', epoch: this.epoch });
    for (const [id, pending] of this.pending) if (pending.type === 'generate') { pending.reject(Error('Canceled')); this.pending.delete(id); }
  }
  dispose(error = Error('Model released')) {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
export function wavBlob(samples, sampleRate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const str = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767), true));
  return new Blob([bytes], { type: 'audio/wav' });
}
