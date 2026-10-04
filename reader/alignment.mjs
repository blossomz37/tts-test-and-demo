// Exact UTF-16 mappings. Whitespace may differ; prose and punctuation may not.
export function narrationMap(source, narration, exclusions = []) {
  const omitted = new Uint8Array(source.length);
  let previousEnd = 0;
  for (const e of exclusions) {
    if (e.kind !== 'scene_separator' || !Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < previousEnd || e.end <= e.start || source.slice(e.start, e.end) !== e.text || !/^\*{3}$/.test(e.text)) throw Error('Invalid recorded source exclusion');
    omitted.fill(1, e.start, e.end); previousEnd = e.end;
  }
  const indices = [];
  for (let i = 0; i < source.length; i++) if (!omitted[i] && !/\s/u.test(source[i])) indices.push(i);
  const mapping = new Array(narration.length).fill(null);
  let cursor = 0;
  for (let i = 0; i < narration.length; i++) {
    if (/\s/u.test(narration[i])) continue;
    if (source[indices[cursor]] !== narration[i]) throw Error(`Narration/source mismatch at UTF-16 offset ${i}`);
    mapping[i] = indices[cursor++];
  }
  if (cursor !== indices.length) throw Error('Narration does not cover the full source prose');
  return mapping;
}

export function mapAlignment(chapter, alignment) {
  if (alignment.audio_sha256 !== chapter.audioSha256 || alignment.input_sha256 !== chapter.narrationSha256 || alignment.source_sha256 !== chapter.source.sha256) throw Error('Stale alignment: audio, narration or source hash differs');
  const map = narrationMap(chapter.source.text, chapter.narration, chapter.exclusions);
  let cursor = 0, lastEnd = 0;
  if (!Array.isArray(alignment.words) || !alignment.words.length) throw Error('Missing word alignment');
  const cues = alignment.words.map(w => {
    if (typeof w.text !== 'string' || !w.text.trim() || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < lastEnd - 0.001 || w.end < w.start || w.end > chapter.duration + 0.1) throw Error('Invalid word timing order or bounds');
    lastEnd = w.end;
    const offsets = [];
    for (const unit of w.text.split('')) {
      if (/\s/u.test(unit)) continue;
      while (cursor < map.length && map[cursor] === null) cursor++;
      if (chapter.narration[cursor] !== unit) throw Error(`Word alignment text mismatch at UTF-16 offset ${cursor}`);
      offsets.push(map[cursor++]);
    }
    if (!offsets.length) throw Error('Empty aligned word');
    return { start: w.start, end: w.end, from: offsets[0], to: offsets.at(-1) + 1 };
  });
  if (chapter.narration.slice(cursor).trim()) throw Error('Word alignment misses trailing narration');
  // As in the research viewer, collapsed words share the next measured window.
  // Keep the raw times unchanged; the display extension is explicit.
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    cue.displayEnd = cue.end > cue.start ? cue.end : (cues.slice(i + 1).find(c => c.end > cue.start)?.end ?? cue.end);
    if (cue.displayEnd <= cue.start) throw Error('Trailing word has no measured display window');
  }
  return cues;
}

export function activeCues(cues, time, ended = false) {
  if (ended) return [];
  return cues.filter(c => time >= c.start && time < c.displayEnd);
}
