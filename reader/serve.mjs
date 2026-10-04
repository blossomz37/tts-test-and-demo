// Standalone loopback launcher, adapted from research/serve.mjs. No dependencies.
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ReaderDatabase } from './database.mjs';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const sha = data => createHash('sha256').update(data).digest('hex');
export function normalizeTailscaleOrigin(value) {
  if (value === undefined) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname) &&
        !url.username && !url.password && url.port !== '0' &&
        (value === url.origin || value === `${url.origin}/`)) return url.origin;
  } catch { /* Report the same configuration error for malformed URLs. */ }
  throw Error('Use --tailscale-origin https://DEVICE.TAILNET.ts.net[:PORT] with no path, credentials, query or fragment');
}
export function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, status: 200 };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) throw Error('Invalid range');
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) throw Error('Unsatisfiable range');
  return { start, end, status: 206 };
}
export async function createReaderServer(directory, { tailscaleOrigin } = {}) {
  const remoteOrigin = normalizeTailscaleOrigin(tailscaleOrigin);
  const remoteHost = remoteOrigin ? new URL(remoteOrigin).host : '';
  const root = await realpath(directory), run = dirname(root);
  const inputs = JSON.parse(await readFile(resolve(root, 'inputs.json'), 'utf8'));
  const chapters = new Map(inputs.chapters.map(c => [c.id, c]));
  const runtimeHash = sha(await readFile(fileURLToPath(import.meta.url)));
  const database = new ReaderDatabase(root, inputs), apiToken = randomUUID(), previews = new Map();
  const allowed = new Set(['index.html', 'style.css', 'app.js', 'data.js', 'verification.json', 'manifest.webmanifest', 'icon.svg']);
  const types = { '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg' };
  const integrity = async c => {
    const [source, narration, audio, receipt] = await Promise.all([c.sourcePath, c.narrationPath, c.audioPath, c.receiptPath].map(p => readFile(p)));
    if (sha(source) !== c.source.sha256 || sha(narration) !== c.narrationSha256 || sha(audio) !== c.audioSha256 || sha(receipt) !== c.receiptSha256) throw Error('Source, narration, recording or receipt changed. Regenerate the reader before playing or annotating.');
    if (c.alignmentSha256 && sha(await readFile(resolve(root, 'alignments', c.alignmentFile))) !== c.alignmentSha256) throw Error('Word alignment changed. Regenerate the reader.');
    return { ok: true, sourceSha256: c.source.sha256, audioSha256: c.audioSha256, narrationSha256: c.narrationSha256, alignmentSha256: c.alignmentSha256 };
  };
  const server = http.createServer(async (req, res) => {
    try {
      // Admit only the bound loopback authority and the explicitly configured Serve
      // authority. Forwarded headers never grant access; writes still need Origin/token.
      const localOrigin = `http://127.0.0.1:${server.address().port}`;
      const origin = req.headers.host === new URL(localOrigin).host ? localOrigin :
        remoteHost && req.headers.host === remoteHost ? remoteOrigin : '';
      if (!origin) { res.writeHead(403); res.end(); return; }
      if (req.url.startsWith('/reader/api/')) {
        const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
        try {
          if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Same-origin access required' });
          const route = req.url.slice('/reader/api/'.length);
          if (req.method === 'GET' && route === 'identity') return json(200, { application: 'local-chapter-reader', version: 2, fingerprint: sha(root + JSON.stringify(inputs) + runtimeHash + remoteOrigin) });
          if (req.method === 'GET' && route === 'session') return json(200, { ...database.read(), token: apiToken, databasePath: database.path });
          if (req.method === 'GET' && route === 'backup') return json(200, database.backup());
          if (req.method !== 'POST') return json(405, { error: 'Unsupported action' });
          if (req.headers.origin !== origin || req.headers['x-reader-token'] !== apiToken || req.headers['content-type'] !== 'application/json') return json(403, { error: 'Same-origin write token required' });
          let body = '', size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw Object.assign(Error('Backup is too large'), { status: 413 }); body += chunk; }
          const value = JSON.parse(body);
          if (route === 'save') return json(200, database.save(value.records, value.revision));
          if (route === 'preview') {
            const report = database.preview(value.backup), token = randomUUID();
            if (previews.size >= 10) previews.delete(previews.keys().next().value);
            previews.set(token, { backup: value.backup, revision: database.read().revision, expires: Date.now() + 300000 });
            return json(200, { ...report, token });
          }
          if (route === 'restore') {
            const preview = previews.get(value.token); previews.delete(value.token);
            if (!preview || preview.expires < Date.now()) throw Error('Restore preview expired. Preview the backup again.');
            for (const c of chapters.values()) await integrity(c);
            return json(200, database.save(preview.backup.records, preview.revision, { restore: true }));
          }
          return json(404, { error: 'Unknown action' });
        } catch (error) { return json(error.status || 400, { error: error.message }); }
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
      const url = new URL(req.url, 'http://127.0.0.1'), path = decodeURIComponent(url.pathname);
      if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (path.startsWith('/reader/integrity/')) {
        const c = chapters.get(path.slice('/reader/integrity/'.length)); if (!c) throw Error('Unknown chapter');
        try { const body = JSON.stringify(await integrity(c)); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? '' : body); }
        catch (error) { res.writeHead(409, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: false, error: error.message })); }
        return;
      }
      if (path === '/') { res.writeHead(302, { Location: '/reader/' }); res.end(); return; }
      let file, boundary = root;
      if (path.startsWith('/reader/')) {
        const relative = path.slice('/reader/'.length) || 'index.html';
        if (!allowed.has(relative) && !/^fonts\/[\w.-]+\.(woff2|txt)$/.test(relative) && ![...chapters.values()].some(c => relative === `alignments/${c.alignmentFile}`)) throw Error('Not public');
        file = await realpath(resolve(root, relative));
      } else {
        const c = [...chapters.values()].find(c => path === `/mp3/${c.id}.mp3`); if (!c) throw Error('Not public');
        // Check the exact recording on every media request, including seeks.
        file = await realpath(c.audioPath); boundary = run;
        if (sha(await readFile(file)) !== c.audioSha256) { res.writeHead(409); res.end('Recording changed; regenerate reader'); return; }
      }
      if (!file.startsWith(boundary + sep)) throw Error('Outside reader');
      const info = await stat(file); if (!info.isFile()) throw Error('Not a file');
      let range;
      try { range = byteRange(req.headers.range, info.size); } catch { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
      const { start, end, status } = range;
      const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Length': Math.max(0, end - start + 1) };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      res.writeHead(status, headers);
      if (req.method === 'HEAD' || !info.size) { res.end(); return; }
      const stream = createReadStream(file, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
  });
  server.on('close', () => database.close());
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: 'string' }, dir: { type: 'string' }, open: { type: 'boolean' }, 'tailscale-origin': { type: 'string' } } });
  const remoteOrigin = normalizeTailscaleOrigin(values['tailscale-origin']);
  // A required stable port avoids quietly opening an origin with different saved notes.
  const port = Number(values.port);
  if (!values.port || !Number.isInteger(port) || port < 0 || port > 65535) throw Error('Use --port YOUR_ASSIGNED_PORT (or --port 0 for isolated tests only)');
  const directory = values.dir || dirname(fileURLToPath(import.meta.url));
  const origin = `http://127.0.0.1:${port}`;
  const fingerprint = sha(await realpath(directory) + await readFile(resolve(directory, 'inputs.json'), 'utf8').then(s => JSON.stringify(JSON.parse(s))) + sha(await readFile(fileURLToPath(import.meta.url))) + remoteOrigin);
  const openBrowser = url => {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`Open ${url} in your browser.`)); child.unref();
  };
  if (port && values.open) {
    try {
      const response = await fetch(`${origin}/reader/api/identity`, { signal: AbortSignal.timeout(1500) });
      const existing = await response.json();
      if (existing.application === 'local-chapter-reader' && existing.version === 2 && existing.fingerprint === fingerprint) {
        console.log(`Reader already running: ${origin}/reader/`); openBrowser(`${origin}/reader/`); process.exit(0);
      }
    } catch { /* A free port is normal. Binding still refuses unrelated processes. */ }
  }
  const server = await createReaderServer(directory, { tailscaleOrigin: values['tailscale-origin'] });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Assigned port is occupied. Keep the stable port and check its owner; do not stop an unknown process.' : error.message); server.emit('close'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/reader/`;
    console.log(`Chapter reader: ${url}`);
    if (remoteOrigin) console.log(`Allowed Tailscale origin: ${remoteOrigin} (configure Tailscale Serve separately)`);
    if (values.open) openBrowser(url);
  });
}
