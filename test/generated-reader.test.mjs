import test from 'node:test';
import assert from 'node:assert/strict';
import { GeneratedReader } from '../src/generated-reader.mjs';
import { wavBlob } from '../src/kokoro-engine.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const jobs = [], audios = [], events = [], revoked = [];
  const engine = { generate(text,voice,rate) { return new Promise((resolve,reject) => jobs.push({text,voice,rate,resolve,reject})); } };
  const reader = new GeneratedReader({ engine, emit: e => events.push(e), makeAudio: () => {
    const audio = { plays:0, paused:false, async play() { this.plays++; this.paused=false; }, pause() { this.paused=true; }, removeAttribute() {}, load() {} }; audios.push(audio); return audio;
  }, urls: { createObjectURL: () => `blob:${audios.length}`, revokeObjectURL: u => revoked.push(u) } });
  reader.load(['One.', 'Two.', 'Three.'],'test');
  const finish = i => jobs[i].resolve({samples:new Float32Array(2400),sampleRate:24000,synthesisMs:5});
  return {reader,jobs,audios,events,revoked,finish};
}
test('generated reader prefetches only one section and completes in order',async()=>{
  const {reader,jobs,audios,finish}=harness();reader.play();reader.play();assert.equal(jobs.length,1);
  finish(0);await tick();assert.equal(audios.length,1);assert.equal(jobs.length,2);
  finish(1);await tick();assert.equal(jobs.length,2);audios[0].onended();await tick();assert.equal(jobs.length,3);
  finish(2);await tick();audios[1].onended();await tick();audios[2].onended();assert.equal(reader.state,'finished');assert.equal(reader.index,3);
});
test('stopping during synthesis drops stale audio',async()=>{
  const {reader,jobs,audios,finish}=harness();reader.play();reader.stop();finish(0);await tick();assert.equal(audios.length,0);assert.equal(reader.state,'idle');
});
test('seek invalidates late completion and revokes old audio',async()=>{
  const {reader,audios,finish,revoked}=harness();reader.play();finish(0);await tick();const end=audios[0].onended;reader.seek(2);end();finish(1);await tick();assert.equal(reader.index,2);assert.equal(reader.state,'idle');assert.equal(revoked.length,1);
});
test('pause and resume reuse current audio',async()=>{
  const {reader,audios,finish,jobs}=harness();reader.play();finish(0);await tick();reader.pause();assert.equal(reader.state,'paused');reader.play();await tick();assert.equal(audios[0].plays,2);assert.equal(jobs.length,2);
});
test('settings change invalidates prefetched audio',async()=>{
  const {reader,audios,jobs,finish}=harness();reader.play();finish(0);await tick();reader.configure({voiceURI:'af_bella',rate:1.25});finish(1);await tick();audios[0].onended();assert.equal(jobs.length,3);assert.equal(jobs[2].voice,'af_bella');assert.equal(jobs[2].rate,1.25);
});
test('generation failure is recoverable without advancing',async()=>{
  const {reader,jobs}=harness();reader.play();jobs[0].reject(Error('No model'));await tick();assert.equal(reader.state,'error');assert.equal(reader.index,0);reader.play();assert.equal(jobs.length,2);
});
test('WAV export has valid PCM header and sample length',async()=>{
 const blob=wavBlob(new Float32Array([0,-1,1]),24000), view=new DataView(await blob.arrayBuffer());assert.equal(blob.size,50);assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint16(22,true),1);assert.equal(view.getInt16(46,true),-32768);
});
