import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const revision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const model = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const files = ["config.json", "tokenizer.json", "tokenizer_config.json", "voices/af_heart.bin", "onnx/model.onnx"];
let previous;
try { previous = JSON.parse(await readFile(new URL('../models/manifest.json', import.meta.url), 'utf8')); } catch {}
if (previous && (previous.model !== model || previous.revision !== revision)) throw Error('Model revision changed; use a separate asset directory.');
for (const entry of previous?.files ?? []) if (!files.includes(entry.file)) files.push(entry.file);
const manifest = { model, revision, files: [] };
for (const file of files) {
  const path = new URL(`../models/kokoro/${file}`, import.meta.url);
  await mkdir(new URL('.', path), { recursive: true });
  let bytes;
  try { bytes = await readFile(path); } catch {
    console.log(`Downloading ${file}`);
    const response = await fetch(`https://huggingface.co/${model}/resolve/${revision}/${file}`);
    if (!response.ok) throw Error(`${file}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path, bytes);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expected = previous?.files.find(entry => entry.file === file)?.sha256;
  if (expected && expected !== sha256) throw Error(`Integrity mismatch: ${file}`);
  manifest.files.push({ file, bytes: bytes.length, sha256 });
}
const full = manifest.files.find(entry => entry.file === 'onnx/model.onnx');
if (full) {
  const bytes = await readFile(new URL('../models/kokoro/onnx/model.onnx', import.meta.url));
  const partSize = 64 * 1024 * 1024;
  full.parts = [];
  for (let offset = 0, i = 0; offset < bytes.length; offset += partSize, i++) {
    const file = `onnx/model.onnx.part${i}`;
    const part = bytes.subarray(offset, offset + partSize);
    await writeFile(new URL(`../models/kokoro/${file}`, import.meta.url), part);
    full.parts.push({ file, bytes: part.length, sha256: createHash('sha256').update(part).digest('hex') });
  }
}
await writeFile(new URL('../models/manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Ready: ${manifest.files.reduce((n, f) => n + f.bytes, 0).toLocaleString()} bytes; revision ${revision}`);
