import { validateSidecar, sidecarKey, positionKey, readPosition } from './state.mjs';
export const preferencesKey = bookId => `chapter-reader:v1:${encodeURIComponent(bookId)}:preferences`;
export const selectedKey = bookId => `chapter-reader:v1:${encodeURIComponent(bookId)}:selected`;
export const reviewKey = (bookId, chapter) => `chapter-reader:v1:${encodeURIComponent(bookId)}:${chapter.id}:review:${chapter.source.sha256}:${chapter.audioSha256}`;
export const categories = ['', 'wording', 'continuity', 'pacing', 'audio issue'];
export function validatePreferences(p) {
  if (!p || ![.75, 1, 1.25, 1.5, 2].includes(p.speed) || typeof p.follow !== 'boolean' || typeof p.focus !== 'boolean' || ![16, 19, 22, 25].includes(p.fontSize) || ![1.5, 1.8, 2.1].includes(p.lineHeight) || ![620, 760, 920].includes(p.width) || !['light', 'dark'].includes(p.theme)) throw Error('Invalid reading preferences');
}
export function validateRecords(data, records) {
  if (!records || Array.isArray(records) || typeof records !== 'object') throw Error('Invalid book records');
  const valid = new Map();
  valid.set(preferencesKey(data.bookId), validatePreferences);
  valid.set(selectedKey(data.bookId), p => { if (!data.chapters.some(c => c.id === p?.chapterId)) throw Error('Unknown selected chapter'); });
  for (const c of data.chapters) {
    valid.set(sidecarKey(data.bookId, c.id), p => validateSidecar(p, data.bookId, c));
    valid.set(positionKey(data.bookId, c), p => readPosition(JSON.stringify(p), c));
    valid.set(reviewKey(data.bookId, c), p => {
      if (!p || typeof p.reviewed !== 'boolean' || !Array.isArray(p.bookmarks)) throw Error('Invalid chapter review');
      const ids = new Set();
      for (const b of p.bookmarks) {
        if (typeof b.id !== 'string' || ids.has(b.id) || typeof b.label !== 'string' || !b.label.trim() || b.label.length > 200 || !Number.isFinite(b.time) || b.time < 0 || b.time > c.duration) throw Error('Invalid bookmark');
        ids.add(b.id);
      }
    });
  }
  for (const [key, raw] of Object.entries(records)) {
    if (!valid.has(key) || typeof raw !== 'string') throw Error(`Unknown or stale record: ${key}`);
    valid.get(key)(JSON.parse(raw));
  }
}
export function identity(data) {
  return data.chapters.map(c => ({ id: c.id, source: c.source, audioSha256: c.audioSha256, narrationSha256: c.narrationSha256 }));
}
export function validateBackup(data, backup) {
  if (backup?.format !== 'local-reader-backup' || backup.version !== 1 || backup.bookId !== data.bookId || JSON.stringify(backup.chapters) !== JSON.stringify(identity(data))) throw Error('Backup belongs to a different book, manuscript version or recording. Nothing was replaced.');
  validateRecords(data, backup.records);
}
export function summary(data, records) {
  let notes = 0, comments = 0, drafts = 0, bookmarks = 0, reviewed = 0;
  for (const c of data.chapters) {
    const s = JSON.parse(records[sidecarKey(data.bookId, c.id)] || 'null');
    if (s) { notes += !!s.notes.trim(); comments += s.comments.length; drafts += !!s.draft; }
    const r = JSON.parse(records[reviewKey(data.bookId, c)] || 'null');
    if (r) { bookmarks += r.bookmarks.length; reviewed += r.reviewed; }
  }
  return { notes, comments, drafts, bookmarks, reviewed, records: Object.keys(records).length };
}
export function markdownBrief(data, records) {
  const lines = [`# ${data.title} — revision notes`, '', 'Saved comments and chapter notes. Unfinished drafts are excluded.', ''];
  for (const c of data.chapters) {
    const s = JSON.parse(records[sidecarKey(data.bookId, c.id)] || 'null');
    if (!s || (!s.notes.trim() && !s.comments.length)) continue;
    lines.push(`## ${c.title}`, '', `Source SHA-256: ${c.source.sha256}`, '');
    if (s.notes.trim()) lines.push('### Chapter notes', '', s.notes, '');
    for (const comment of s.comments) {
      lines.push(`### ${comment.category || 'Comment'} · ${comment.resolved ? 'resolved' : 'open'}`, '', ...comment.anchor.quote.split('\n').map(l => `> ${l}`), '', comment.body, '', `Source offsets: ${comment.anchor.start}–${comment.anchor.end} (UTF-16). Comment: ${comment.id}`, '');
    }
  }
  return lines.join('\n');
}
