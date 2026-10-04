import { matches, makeComment, reviseComment } from '../src/comments.mjs';

export const sidecarKey = (bookId, chapterId) => `chapter-reader:v1:${encodeURIComponent(bookId)}:${chapterId}:sidecar`;
export const positionKey = (bookId, chapter) => `chapter-reader:v1:${encodeURIComponent(bookId)}:${chapter.id}:position:${chapter.source.sha256}:${chapter.audioSha256}`;

export function validateSidecar(saved, bookId, chapter) {
  if (saved?.schemaVersion !== 1 || saved.bookId !== bookId || saved.source?.id !== chapter.id || saved.source.sha256 !== chapter.source.sha256 || saved.source.text !== chapter.source.text || typeof saved.notes !== 'string' || !Array.isArray(saved.comments)) throw Error('Saved notes belong to another source or cannot be read. Existing data is preserved.');
  const ids = new Set();
  for (const c of saved.comments) {
    if (typeof c.id !== 'string' || ids.has(c.id) || c.sourceSha256 !== chapter.source.sha256 || !matches(chapter.source.text, c.anchor) || typeof c.body !== 'string' || typeof c.createdAt !== 'string') throw Error('Unreadable saved comment. Existing data is preserved.');
    ids.add(c.id);
  }
  const d = saved.draft;
  if (d !== null && (!d || !matches(chapter.source.text, d.anchor) || typeof d.body !== 'string' || (d.commentId && !ids.has(d.commentId)))) throw Error('Unreadable draft. Existing data is preserved.');
  if (d?.commentId && JSON.stringify(d.anchor) !== JSON.stringify(saved.comments.find(c => c.id === d.commentId).anchor)) throw Error('Draft anchor differs from its saved comment. Existing data is preserved.');
}

export class SidecarStore {
  constructor(storage, bookId, chapter) {
    Object.assign(this, { storage, bookId, chapter, key: sidecarKey(bookId, chapter.id), raw: null, blocked: false, dirty: false, error: '' });
    this.state = { schemaVersion: 1, bookId, source: chapter.source, offsetUnit: 'UTF-16 code units', notes: '', comments: [], draft: null };
    try {
      this.raw = storage.getItem(this.key);
      if (this.raw !== null) {
        const saved = JSON.parse(this.raw); validateSidecar(saved, bookId, chapter); this.state = saved;
      }
    } catch (error) { this.blocked = true; this.error = error.message + ' Export recovery data before changing storage.'; }
  }
  write(next = this.state, retain = false) {
    if (this.blocked) return false;
    try {
      if (this.storage.getItem(this.key) !== this.raw) {
        this.blocked = true;
        throw Error('Another tab changed these notes. Export recovery data, then reload to read the other tab’s version.');
      }
      validateSidecar(next, this.bookId, this.chapter);
      const raw = JSON.stringify(next); this.storage.setItem(this.key, raw);
      this.raw = raw; this.state = next; this.dirty = false; this.error = ''; return true;
    } catch (error) {
      if (retain) { this.state = next; this.dirty = true; }
      this.error = `${error.message} Changes may only be in this open page; export recovery data.`;
      return false;
    }
  }
  notes(text) { return this.write({ ...this.state, notes: text }, true); }
  draft(draft) { return this.write({ ...this.state, draft }, true); }
  saveComment() {
    const draft = this.state.draft;
    if (!draft) throw Error('No comment draft to save');
    const original = draft.commentId && this.state.comments.find(c => c.id === draft.commentId);
    const comment = original ? reviseComment(this.chapter.source, original, draft.body) : makeComment(this.chapter.source, draft.anchor, draft.body);
    const comments = original ? this.state.comments.map(c => c.id === original.id ? comment : c) : [...this.state.comments, comment];
    return this.write({ ...this.state, comments, draft: null });
  }
  deleteComment(id) {
    return this.write({ ...this.state, comments: this.state.comments.filter(c => c.id !== id), draft: this.state.draft?.commentId === id ? null : this.state.draft });
  }
  export() {
    return { schemaVersion: 3, application: 'local-chapter-reader', bookId: this.bookId, chapterId: this.chapter.id,
      source: this.chapter.source, audio: { sha256: this.chapter.audioSha256, narrationSha256: this.chapter.narrationSha256 },
      offsetUnit: 'UTF-16 code units', comments: [
        ...this.state.comments.map(c => ({ ...c, type: 'selection' })),
        ...(this.state.notes.trim() ? [{ id: 'general-notes', type: 'general', sourceSha256: this.chapter.source.sha256, anchor: null, body: this.state.notes }] : [])
      ] };
  }
  recovery() {
    let currentRaw;
    try { currentRaw = this.storage.getItem(this.key); } catch { currentRaw = null; }
    return { key: this.key, originalRaw: this.raw, currentRaw, inMemory: this.state, error: this.error };
  }
}

export function readPosition(raw, chapter) {
  if (raw === null) return 0;
  const p = JSON.parse(raw);
  if (p?.sourceSha256 !== chapter.source.sha256 || p.audioSha256 !== chapter.audioSha256 || !Number.isFinite(p.time) || p.time < 0 || p.time > chapter.duration + 1) throw Error('Saved position is invalid or belongs to different inputs; it has been preserved.');
  return Math.min(p.time, chapter.duration);
}
