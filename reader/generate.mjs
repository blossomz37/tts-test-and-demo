import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, cp, access, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { inspectInputs, hash, readJSON } from './inputs.mjs';
import { mapAlignment } from './alignment.mjs';

const { values } = parseArgs({ options: {
  chapters: { type: 'string' }, 'audio-run': { type: 'string' }, title: { type: 'string' }, 'book-id': { type: 'string' },
  align: { type: 'boolean' }, python: { type: 'string' }, model: { type: 'string' }, 'prepare-only': { type: 'boolean' }
}});
if (!values.chapters || !values['audio-run']) throw Error('Use --chapters PATH --audio-run PATH [--title TITLE] [--book-id ID] [--align --python PATH --model PATH]');
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const inputs = await inspectInputs({ chapters: values.chapters, audioRun: values['audio-run'], title: values.title, bookId: values['book-id'] });
const out = resolve(inputs.audioRun, 'reader');
if (out.startsWith(repo + '/') || out === repo) throw Error('Book output must be outside the source repository');
await mkdir(out, { recursive: true });
if (await realpath(out) !== out) throw Error('Reader output must be a real directory, not a symlink');
const existingIndex = await access(resolve(out, 'index.html')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
if (existingIndex) {
  const existing = await readJSON(resolve(out, 'inputs.json'));
  if (existing.schemaVersion !== 1 || existing.audioRun !== inputs.audioRun) throw Error('Existing reader folder has an unknown owner; preserve it and choose another audio-run folder');
}
// All source paths and book data remain beside the original audio, outside Git.
await writeFile(resolve(out, 'alignment-inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
console.log(`Verified ${inputs.chapters.length} chapter/source/audio pairings.`);
if (values['prepare-only']) process.exit(0);
if (values.align) {
  if (!values.python || !values.model) throw Error('--align requires --python and --model pointing to local prepared assets');
  await new Promise((accept, reject) => {
    const child = spawn(values.python, [resolve(here, 'align.py'), '--inputs', resolve(out, 'alignment-inputs.json'), '--model', resolve(values.model)], { stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? accept() : reject(Error(`Alignment exited ${code}`)));
  });
}
// Recheck live inputs after potentially long alignment work.
const fresh = await inspectInputs({ chapters: values.chapters, audioRun: values['audio-run'], title: inputs.title, bookId: inputs.bookId });
if (JSON.stringify(fresh) !== JSON.stringify(inputs)) throw Error('Inputs changed during generation; existing reader retained');
const chapters = [], report = [];
for (const c of inputs.chapters) {
  const alignmentPath = resolve(out, 'alignments', c.alignmentFile);
  let alignment;
  try { alignment = await readJSON(alignmentPath); } catch { throw Error(`Missing alignment for ${c.id}; run with --align --python PATH --model PATH`); }
  const cues = mapAlignment(c, alignment);
  c.alignmentSha256 = hash(await readFile(alignmentPath));
  chapters.push({ id: c.id, number: c.number, title: c.title, source: c.source, audio: c.audio, audioSha256: c.audioSha256,
    narrationSha256: c.narrationSha256, duration: c.duration, cues, alignment: `alignments/${c.alignmentFile}`, alignmentSha256: c.alignmentSha256,
    alignmentWarnings: alignment.warnings || [] });
  report.push({ chapter: c.number, sourceSha256: c.source.sha256, audioSha256: c.audioSha256, narrationSha256: c.narrationSha256,
    alignmentSha256: c.alignmentSha256, warnings: alignment.warnings || [], cues: cues.length, collapsedCues: cues.filter(w => w.end === w.start).length,
    exactProseCoverage: true, sourcePreserved: true, firstWord: cues[0].start, lastWord: cues.at(-1).end, duration: c.duration });
}
const data = { schemaVersion: 1, bookId: inputs.bookId, title: inputs.title, chapters };
const { build } = await import('esbuild');
const bundled = await build({ entryPoints: [resolve(here, 'app.mjs')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' });
// Preserve the previous generated runtime before refreshing it; alignments are immutable.
try {
  await access(resolve(out, 'data.js'));
  const backup = resolve(out, 'history', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(backup, { recursive: true });
  for (const file of ['data.js', 'app.js', 'index.html', 'style.css', 'verification.json', 'inputs.json']) await cp(resolve(out, file), resolve(backup, file));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await cp(resolve(repo, 'assets/fonts'), resolve(out, 'fonts'), { recursive: true });
for (const file of ['index.html', 'style.css', 'icon.svg']) await cp(resolve(here, file), resolve(out, file));
const serverBundle = await build({ entryPoints: [resolve(here, 'serve.mjs')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22.13' });
await writeFile(resolve(out, 'serve.mjs'), serverBundle.outputFiles[0].contents);
await writeFile(resolve(out, 'app.js'), bundled.outputFiles[0].contents);
await writeFile(resolve(out, 'data.js'), `window.CHAPTER_READER = ${JSON.stringify(data).replaceAll('<', '\\u003c')};\n`);
await writeFile(resolve(out, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
await writeFile(resolve(out, 'verification.json'), JSON.stringify({ schemaVersion: 1, chapters: report, notes: 'Approximate forced alignment; coverage of supplied text does not prove narration completeness.' }, null, 2) + '\n');
await writeFile(resolve(out, 'manifest.webmanifest'), JSON.stringify({ id: './', name: inputs.title + ' · Chapter reader', short_name: 'Chapter reader', start_url: './', scope: './', display: 'standalone', background_color: '#F4F1EA', theme_color: '#F4F1EA', icons: [{src:'icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}] }, null, 2));
await writeFile(resolve(out, 'README.txt'), 'Open index.html for local-file reading/playback. For stable saved notes, audio identity checks and dictation, run: node serve.mjs --port YOUR_ASSIGNED_PORT\nUse the same 127.0.0.1 hostname and port each time. Export notes before moving origins. No microphone starts automatically.\nGenerated with TTS Methods reader/generate.mjs. See the reusable reader README for regeneration and recovery.\n');
console.log(`Reader ready: ${resolve(out, 'index.html')}`);
