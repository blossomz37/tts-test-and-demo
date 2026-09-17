const CACHE = 'tts-lab-kokoro-a30a3ef31cdf';
const MODEL_CACHE = 'tts-kokoro-model-1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const SHELL = ['/', '/index.html', '/style.css', '/assets/fonts/hanken-grotesk-latin-wght-normal.woff2', '/assets/fonts/bricolage-grotesque-latin-wght-normal.woff2', '/assets/fonts/anton-latin-400-normal.woff2', '/src/app.mjs', '/src/icon-buttons.mjs', '/src/dictation.mjs', '/src/comments.mjs', '/src/comments-ui.mjs', '/src/reader.mjs', '/src/generated-reader.mjs', '/src/kokoro-engine.mjs'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  const asset = url.pathname.startsWith('/models/') || url.pathname.startsWith('/vendor/');
  if (!asset && !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(url.pathname.startsWith('/models/') ? MODEL_CACHE : CACHE);
    if (url.pathname === '/models/kokoro/onnx/model.onnx') {
      const manifestUrl = '/models/manifest.json';
      let manifestResponse;
      try { manifestResponse = await fetch(manifestUrl); if (manifestResponse.ok) await cache.put(manifestUrl, manifestResponse.clone()); }
      catch { manifestResponse = await cache.match(manifestUrl); }
      if (!manifestResponse?.ok) throw Error('Model manifest unavailable; reconnect and load once.');
      const entry = (await manifestResponse.json()).files.find(file => file.file === 'onnx/model.onnx');
      if (!entry?.parts) throw Error('Run npm run setup:model -- --webgpu to prepare model parts.');
      let index = 0;
      const stream = new ReadableStream({ async pull(controller) {
        try {
          if (index === entry.parts.length) { controller.close(); return; }
          const part = entry.parts[index++], path = '/models/kokoro/' + part.file;
          let response = await cache.match(path);
          if (!response) {
            response = await fetch(path);
            if (!response.ok) throw Error('Model part unavailable: ' + path);
            const bytes = await response.arrayBuffer();
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
            if (hash !== part.sha256) throw Error('Model part integrity mismatch');
            try { await cache.put(path, new Response(bytes)); }
            catch (error) { for (const client of await self.clients.matchAll()) client.postMessage({type:'offline-cache-warning',path,message:error.message}); }
            controller.enqueue(new Uint8Array(bytes));
          } else controller.enqueue(new Uint8Array(await response.arrayBuffer()));
        } catch (error) { controller.error(error); }
      } });
      return new Response(stream, {headers:{'Content-Type':'application/octet-stream','Content-Length':String(entry.bytes)}});
    }
    if (asset) { const cached = await cache.match(event.request); if (cached) return cached; }
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(cache.put(event.request, copy).catch(async error => {
          for (const client of await self.clients.matchAll()) client.postMessage({ type: 'offline-cache-warning', path: url.pathname, message: error.message });
        }));
      }
      return response;
    } catch (error) { const cached = await cache.match(event.request); if (cached) return cached; throw error; }
  })());
});
