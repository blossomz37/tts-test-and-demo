import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateRecords, validateBackup, identity, summary } from './book-records.mjs';

export class ReaderDatabase {
  constructor(root, data) {
    this.data = data; this.directory = resolve(realpathSync(root), 'notes');
    mkdirSync(this.directory, { recursive: true });
    if (realpathSync(this.directory) !== this.directory) throw Error('Notes directory must not be a symlink');
    this.path = join(this.directory, 'reader.sqlite');
    this.db = new DatabaseSync(this.path);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw Error('Reader database is newer than this app; use the newer app.'); }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS records (book_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(book_id,key)) STRICT;
      PRAGMA user_version=1;`);
    this.db.prepare('INSERT OR IGNORE INTO books(id) VALUES (?)').run(data.bookId);
    this.lastSnapshot = 0;
  }
  read() {
    return { revision: this.db.prepare('SELECT revision FROM books WHERE id=?').get(this.data.bookId).revision,
      records: Object.fromEntries(this.db.prepare('SELECT key,value FROM records WHERE book_id=? ORDER BY key').all(this.data.bookId).map(r => [r.key, r.value])) };
  }
  backup() { return { format: 'local-reader-backup', version: 1, createdAt: new Date().toISOString(), bookId: this.data.bookId, title: this.data.title, chapters: identity(this.data), records: this.read().records }; }
  snapshot() {
    const folder = join(this.directory, 'backups'); mkdirSync(folder, { recursive: true });
    if (realpathSync(folder) !== folder) throw Error('Backup directory must not be a symlink');
    const path = join(folder, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`);
    this.db.prepare('VACUUM INTO ?').run(path);
    const check = new DatabaseSync(path, { readOnly: true });
    try { if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Snapshot verification failed'); } finally { check.close(); }
    this.lastSnapshot = Date.now(); return path;
  }
  save(records, revision, { restore = false } = {}) {
    validateRecords(this.data, records);
    if (!Number.isSafeInteger(revision) || revision !== this.read().revision) throw Object.assign(Error('Another window changed this book. Export recovery, then reload.'), { status: 409 });
    if (restore || Date.now() - this.lastSnapshot > 300000) this.snapshot();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const update = this.db.prepare('UPDATE books SET revision=revision+1 WHERE id=? AND revision=?').run(this.data.bookId, revision);
      if (update.changes !== 1) throw Object.assign(Error('Book changed; reload before saving.'), { status: 409 });
      // Replace only this book, atomically. Sources and recordings are never written.
      this.db.prepare('DELETE FROM records WHERE book_id=?').run(this.data.bookId);
      const insert = this.db.prepare('INSERT INTO records(book_id,key,value) VALUES (?,?,?)');
      for (const [key, value] of Object.entries(records)) insert.run(this.data.bookId, key, value);
      this.db.exec('COMMIT'); return this.read();
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  preview(backup) { validateBackup(this.data, backup); return { current: summary(this.data, this.read().records), incoming: summary(this.data, backup.records) }; }
  close() { this.db.close(); }
}
