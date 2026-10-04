// Standalone loopback launcher, adapted from research/serve.mjs. No dependencies.
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const sha = data => createHash('sha256').update(data).digest('hex');
export function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, status: 200 };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) throw Error('Invalid range');
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) throw Error('Unsatisfiable range');
  return { start, end, status: 206 };
}
export async function createReaderServer(directory) {
  const root = await realpath(directory), run = dirname(root);
  const inputs = JSON.parse(await readFile(resolve(root, 'inputs.json'), 'utf8'));
  const chapters = new Map(inputs.chapters.map(c => [c.id, c]));
  const allowed = new Set(['index.html', 'style.css', 'app.js', 'data.js', 'verification.json']);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg' };
  const integrity = async c => {
    const [source, narration, audio, receipt] = await Promise.all([c.sourcePath, c.narrationPath, c.audioPath, c.receiptPath].map(p => readFile(p)));
    if (sha(source) !== c.source.sha256 || sha(narration) !== c.narrationSha256 || sha(audio) !== c.audioSha256 || sha(receipt) !== c.receiptSha256) throw Error('Source, narration, recording or receipt changed. Regenerate the reader before playing or annotating.');
    if (c.alignmentSha256 && sha(await readFile(resolve(root, 'alignments', c.alignmentFile))) !== c.alignmentSha256) throw Error('Word alignment changed. Regenerate the reader.');
    return { ok: true, sourceSha256: c.source.sha256, audioSha256: c.audioSha256, narrationSha256: c.narrationSha256, alignmentSha256: c.alignmentSha256 };
  };
  return http.createServer(async (req, res) => {
    try {
      // Reject DNS rebinding / cross-origin probes. No CORS and no write endpoints.
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return; }
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
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: 'string' }, dir: { type: 'string' } } });
  // A required stable port avoids quietly opening an origin with different saved notes.
  const port = Number(values.port);
  if (!values.port || !Number.isInteger(port) || port < 0 || port > 65535) throw Error('Use --port YOUR_ASSIGNED_PORT (or --port 0 for isolated tests only)');
  const server = await createReaderServer(values.dir || dirname(fileURLToPath(import.meta.url)));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Assigned port is occupied. Keep the stable port and check its owner; do not stop an unknown process.' : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Chapter reader: http://127.0.0.1:${server.address().port}/reader/`));
}
