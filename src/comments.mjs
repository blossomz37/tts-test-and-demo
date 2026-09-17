export function anchor(source, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > source.length || start >= end || !source.slice(start, end).trim()) throw Error('Select text within the passage.');
  return { start, end, quote: source.slice(start, end), prefix: source.slice(Math.max(0, start - 32), start), suffix: source.slice(end, end + 32) };
}
export function matches(source, target) {
  try { return anchor(source, target.start, target.end).quote === target.quote; } catch { return false; }
}
export async function sourceIdentity(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return { id: 'apothecary-demo', sha256: Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''), text };
}
export function makeComment(source, target, body) {
  if (!matches(source.text, target)) throw Error('The selected text has changed. Select it again.');
  if (!body.trim()) throw Error('Type or dictate a comment first.');
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceSha256: source.sha256, anchor: target, body: body.trim() };
}
export function reviseComment(source, comment, body) {
  if (comment.sourceSha256 !== source.sha256 || !matches(source.text, comment.anchor)) throw Error('The original passage has changed. This comment cannot be updated.');
  if (!body.trim()) throw Error('Type or dictate a comment first.');
  return { ...comment, body:body.trim(), updatedAt:new Date().toISOString() };
}
// Expand a selection outward to whole words so a drag that stops mid-word still quotes the full word.
export function snapToWords(source, start, end) {
  const words = [...new Intl.Segmenter('en', { granularity: 'word' }).segment(source)];
  const at = i => words.find(w => i >= w.index && i < w.index + w.segment.length);
  const first = at(start), last = at(end - 1);
  if (first?.isWordLike) start = first.index;
  if (last?.isWordLike) end = last.index + last.segment.length;
  return { start, end };
}
export function relativeTime(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
