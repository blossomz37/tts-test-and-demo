import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = false; // One same-origin service-worker cache owns offline assets.
env.backends.onnx.wasm.wasmPaths = '/vendor/ort/';
env.backends.onnx.wasm.numThreads = 1;
let epoch = 0;
let model, backend, chain = Promise.resolve();
async function initialize(device) {
  if (model) return;
  backend = device;
  const started = performance.now();
  const runtimePath = '/vendor/ort/ort-wasm-simd-threaded.jsep.wasm';
  let runtimeCache;
  try { runtimeCache = await caches.open('tts-kokoro-ort-1.22.0-dev.20250409-89f8206ba4'); } catch {}
  const cachedRuntime = await runtimeCache?.match(runtimePath);
  const runtime = cachedRuntime || await fetch(runtimePath);
  if (!runtime.ok) throw Error('ONNX runtime unavailable; load once while online.');
  const runtimeBytes = await runtime.arrayBuffer();
  if (runtimeCache && !cachedRuntime) {
    try { await runtimeCache.put(runtimePath, new Response(runtimeBytes, {headers:{'Content-Type':'application/wasm'}})); }
    catch (error) { postMessage({type:'offline-cache-warning',path:runtimePath,message:error.message}); }
  }
  env.backends.onnx.wasm.wasmBinary = new Uint8Array(runtimeBytes);
  model = await KokoroTTS.from_pretrained('kokoro', {
    device, dtype: device === 'webgpu' ? 'fp32' : 'q8',
    progress_callback: p => postMessage({ type: 'progress', file: p.file, status: p.status, progress: p.progress }),
  });
  const tokenizer = model.tokenizer;
  model.tokenizer = new Proxy(tokenizer, { apply(target, receiver, args) {
    args[1] = { ...args[1], truncation: false };
    const tokens = Reflect.apply(target, receiver, args);
    if (tokens.input_ids.dims.at(-1) > 512) throw Error('TOKEN_LIMIT');
    return tokens;
  } });
  postMessage({ type: 'initialized', backend, dtype: device === 'webgpu' ? 'fp32' : 'q8', initializationMs: performance.now() - started });
}
async function generate(text, voice, speed) {
  try { return (await model.generate(text, { voice, speed })).audio; }
  catch (error) {
    if (error.message !== 'TOKEN_LIMIT') throw error;
    let cut = text.lastIndexOf(' ', Math.floor(text.length / 2));
    if (cut <= 0) throw Error('A single token exceeds the model limit; shorten this section. No text was dropped.');
    const a = await generate(text.slice(0, cut), voice, speed);
    const b = await generate(text.slice(cut), voice, speed);
    const joined = new Float32Array(a.length + b.length); joined.set(a); joined.set(b, a.length); return joined;
  }
}
self.onmessage = ({ data }) => {
  if (data.type === 'cancel') { epoch = data.epoch; return; }
  epoch = Math.max(epoch, data.epoch);
  chain = chain.then(async () => {
    try {
      if (data.type === 'generate' && data.epoch !== epoch) throw Error('Canceled');
      await initialize(data.backend || 'wasm');
      if (data.type === 'initialize') { postMessage({ id: data.id, type: 'ready' }); return; }
      if (data.epoch !== epoch) throw Error('Canceled');
      const start = performance.now();
      const samples = await generate(data.text, data.voice, data.rate);
      postMessage({ id: data.id, type: 'audio', samples, sampleRate: 24000, synthesisMs: performance.now() - start, backend }, [samples.buffer]);
    } catch (error) { postMessage({ id: data.id, type: 'error', message: error.message }); }
  });
};
