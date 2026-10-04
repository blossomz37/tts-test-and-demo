import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, basename, sep } from 'node:path';
import { narrationMap } from './alignment.mjs';

export const hash = data => createHash('sha256').update(data).digest('hex');
export const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
export async function contained(root, relative) {
  if (typeof relative !== 'string') throw Error('Missing input path');
  const path = await realpath(resolve(root, relative));
  if (!path.startsWith(root + sep)) throw Error('Input path escapes its folder');
  return path;
}
export async function inspectInputs({ chapters: chapterDir, audioRun, title, bookId }) {
  chapterDir = await realpath(chapterDir); audioRun = await realpath(audioRun);
  const configPath = resolve(audioRun, 'render-config.json'), config = await readJSON(configPath);
  const found = (await readdir(chapterDir)).filter(f => /^ch\d+_Final_v1\.md$/.test(f)).map(file => ({ file, number: Number(/^ch(\d+)/.exec(file)[1]) })).sort((a, b) => a.number - b.number);
  if (!found.length || found.some((c, i) => c.number !== i + 1) || config.inputs.length !== found.length) throw Error('Chapter numbers must be contiguous and match render-config inputs');
  const chapters = [];
  for (const { file, number } of found) {
    const id = `chapter-${String(number).padStart(2, '0')}`;
    const sourcePath = await contained(chapterDir, file), sourceBytes = await readFile(sourcePath);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sourceBytes);
    if (hash(text) !== hash(sourceBytes)) throw Error(`Source is not lossless UTF-8: ${file}`);
    const receiptPath = await contained(audioRun, `receipts/${id}.json`), receipt = await readJSON(receiptPath);
    const input = config.inputs.find(c => c.chapter === number);
    const audioPath = await contained(audioRun, `mp3/${id}.mp3`), audioBytes = await readFile(audioPath);
    const narrationPath = await contained(audioRun, `prepared/${id}.txt`), narrationBytes = await readFile(narrationPath);
    const narration = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(narrationBytes);
    if (input?.file !== file || input.sha256 !== hash(sourceBytes) || receipt.source_sha256 !== input.sha256 || receipt.chapter !== number || receipt.status !== 'complete') throw Error(`Recorded source mismatch: ${id}`);
    if (input.prepared_sha256 !== hash(narrationBytes) || receipt.prepared_sha256 !== input.prepared_sha256 || receipt.mp3?.sha256 !== hash(audioBytes) || receipt.mp3.file !== `mp3/${id}.mp3`) throw Error(`Recorded narration/audio mismatch: ${id}`);
    if (JSON.stringify(input.exclusions) !== JSON.stringify(receipt.exclusions) || !Number.isFinite(receipt.duration_seconds) || receipt.duration_seconds <= 0) throw Error(`Invalid receipt: ${id}`);
    narrationMap(text, narration, input.exclusions);
    const chapter = { id, number, title: `Chapter ${number}`, sourcePath, narrationPath, audioPath, receiptPath,
      source: { id, file: basename(file), sha256: hash(sourceBytes), text }, narration,
      narrationSha256: hash(narrationBytes), audioSha256: hash(audioBytes), receiptSha256: hash(await readFile(receiptPath)),
      duration: receipt.duration_seconds, exclusions: input.exclusions, audio: `../mp3/${id}.mp3` };
    chapter.alignmentFile = `${id}-${hash(chapter.source.sha256 + chapter.audioSha256 + chapter.narrationSha256).slice(0, 24)}.json`;
    chapters.push(chapter);
  }
  return { schemaVersion: 1, bookId: bookId || hash(chapterDir).slice(0, 24), title: title || basename(chapterDir),
    chapterDir, audioRun, configSha256: hash(await readFile(configPath)), chapters };
}
