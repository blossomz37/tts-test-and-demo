import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
const portArg = process.argv.indexOf('--port');
const port = portArg === -1 ? 4182 : Number(process.argv[portArg + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Use --port followed by a port number (0 chooses a free port).');
const root = new URL('../', import.meta.url);
const allowed = new Set(['index.html', 'style.css', 'sw.js', 'src/app.mjs', 'src/icon-buttons.mjs', 'src/dictation.mjs', 'src/comments.mjs', 'src/comments-ui.mjs', 'src/reader.mjs', 'src/generated-reader.mjs', 'src/kokoro-engine.mjs', 'models/manifest.json']);
const types = { html:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',md:'text/plain',txt:'text/plain',json:'application/json',wasm:'application/wasm',onnx:'application/octet-stream',bin:'application/octet-stream',woff2:'font/woff2' };
const server = http.createServer(async (req,res) => {
  const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  const asset = /^(?:models\/kokoro|vendor|assets\/fonts)\/[a-zA-Z0-9_./-]+$/.test(path) && !path.split('/').includes('..');
  if (!['GET','HEAD'].includes(req.method) || (!allowed.has(path) && !asset)) { res.writeHead(404);res.end('Not found');return; }
  try {
    const file = new URL(path,root), info = await stat(file); if (!info.isFile()) throw Error('Not file');
    res.writeHead(200,{'Content-Type':`${types[path.split('.').pop()] || 'application/octet-stream'}`, 'Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
  } catch { res.writeHead(404);res.end('Not found'); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Stop the other server or use npm start -- --port 4183.` : error.message); process.exitCode = 1; });
server.listen(port,'127.0.0.1',()=>console.log(`Listen & take notes: http://127.0.0.1:${server.address().port} (${fileURLToPath(root)})`));
