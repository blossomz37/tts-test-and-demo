import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('vendor/ort', { recursive: true });
await mkdir('results', { recursive: true });
const result = await build({
  entryPoints: ['src/kokoro-worker.mjs'], outfile: 'vendor/kokoro-worker.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true,
  plugins: [{ name: 'pinned-local-voices', setup(build) {
    build.onLoad({ filter: /kokoro-js\/dist\/kokoro\.js$/ }, async ({ path }) => {
      let contents = await readFile(path, 'utf8');
      const upstream = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/';
      if (contents.split(upstream).length !== 2) throw Error('kokoro-js changed; review local voice adapter');
      contents = contents.replace(upstream, '/models/kokoro/voices/');
      return { contents, loader: 'js' };
    });
  } }],
});
for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  await copyFile(`node_modules/onnxruntime-web/dist/${file}`, `vendor/ort/${file}`);
}
await writeFile('results/bundle-inputs.json', JSON.stringify(Object.keys(result.metafile.inputs), null, 2) + '\n');
console.log('Browser worker and local ONNX runtime built.');

const hash = createHash('sha256');
for (const file of ['vendor/kokoro-worker.js', 'src/app.mjs', 'src/icon-buttons.mjs', 'src/dictation.mjs', 'src/comments.mjs', 'src/comments-ui.mjs', 'src/reader.mjs', 'src/generated-reader.mjs', 'src/kokoro-engine.mjs', 'index.html', 'style.css', 'assets/fonts/hanken-grotesk-latin-wght-normal.woff2', 'assets/fonts/bricolage-grotesque-latin-wght-normal.woff2', 'assets/fonts/anton-latin-400-normal.woff2']) hash.update(await readFile(file));
const serviceWorker = (await readFile('sw.js', 'utf8')).replace(/const CACHE = '[^']+';/, `const CACHE = 'tts-lab-kokoro-${hash.digest('hex').slice(0, 12)}';`);
await writeFile('sw.js', serviceWorker);
