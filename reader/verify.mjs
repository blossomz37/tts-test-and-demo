import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { inspectInputs, readJSON, hash } from './inputs.mjs';
import { mapAlignment } from './alignment.mjs';

const { values } = parseArgs({ options: { dir: { type: 'string' }, decode: { type: 'boolean' } } });
if (!values.dir) throw Error('Use --dir /absolute/path/to/generated/reader [--decode]');
const root = resolve(values.dir), saved = await readJSON(resolve(root, 'inputs.json'));
const fresh = await inspectInputs({ chapters: saved.chapterDir, audioRun: saved.audioRun, title: saved.title, bookId: saved.bookId });
const script = await readFile(resolve(root, 'data.js'), 'utf8');
const data = JSON.parse(script.replace(/^window\.CHAPTER_READER = /, '').replace(/;\s*$/, ''));
if (data.bookId !== fresh.bookId || data.chapters.length !== fresh.chapters.length || saved.configSha256 !== fresh.configSha256) throw Error('Book identity or input manifest differs');
let words = 0, collapsed = 0;
for (const [i, c] of fresh.chapters.entries()) {
  const shown = data.chapters[i], stored = saved.chapters[i];
  const alignment = await readJSON(resolve(root, 'alignments', c.alignmentFile));
  const cues = mapAlignment(c, alignment);
  const alignmentSha = hash(await readFile(resolve(root, 'alignments', c.alignmentFile)));
  if (JSON.stringify(shown.source) !== JSON.stringify(c.source) || shown.id !== c.id || shown.audio !== c.audio || shown.audioSha256 !== c.audioSha256 || shown.narrationSha256 !== c.narrationSha256 || JSON.stringify(shown.cues) !== JSON.stringify(cues) || shown.alignmentSha256 !== alignmentSha || stored.alignmentSha256 !== alignmentSha) throw Error(`Generated data differs: ${c.id}`);
  if (resolve(root, shown.audio) !== c.audioPath || dirname(root) !== fresh.audioRun) throw Error(`Broken audio reference: ${c.id}`);
  if (values.decode) await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', c.audioPath, '-f', 'null', '-']);
  const zeros = cues.filter(w => w.start === w.end).length;
  words += cues.length; collapsed += zeros;
  console.log(`PASS ${c.id}: ${cues.length} cues, ${zeros} collapsed, exact source/prose/audio/alignment hashes${values.decode ? ', full MP3 decode' : ''}`);
}
for (const file of ['index.html', 'app.js', 'style.css', 'serve.mjs', 'fonts/hanken-grotesk-latin-wght-normal.woff2', 'fonts/bricolage-grotesque-latin-wght-normal.woff2', 'fonts/anton-latin-400-normal.woff2', 'fonts/LICENSE-hanken-grotesk.txt', 'fonts/LICENSE-bricolage-grotesque.txt', 'fonts/LICENSE-anton.txt']) await access(resolve(root, file));
console.log(`PASS ${data.chapters.length} chapters, ${words} word cues, ${collapsed} collapsed display windows. Machine alignment does not prove narration completeness.`);
