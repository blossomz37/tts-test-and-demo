// Synchronous editing cache with serialized SQLite commits and an emergency browser copy.
// The UI distinguishes pending/recovery work from acknowledged database saves.
export class DatabaseStorage {
  constructor(browser, data, session) {
    this.browser = browser; this.data = data; this.records = session.records; this.revision = session.revision;
    this.token = session.token; this.databasePath = session.databasePath;
    this.recoveryKey = `chapter-reader:database-recovery:${encodeURIComponent(data.bookId)}`;
    this.pendingRecovery = browser.getItem(this.recoveryKey);
    this.dirty = false; this.blocked = false; this.error = ''; this.generation = 0;
    if (this.pendingRecovery) {
      try { const pending=JSON.parse(this.pendingRecovery); if(!pending.acknowledged && JSON.stringify(pending.records)!==JSON.stringify(this.records)) { this.blocked=true; this.error='Pending browser edits need review. Open Search & book tools → Backups & exports to recover them.'; } }
      catch { this.blocked=true; this.error='Unreadable browser recovery data was preserved. Export recovery before proceeding.'; }
    }
  }
  static async connect(browser, data) {
    const response = await fetch('./api/session', { cache: 'no-store' });
    if (!response.ok) throw Error('The reader database is unavailable. Restart the updated launcher.');
    return new DatabaseStorage(browser, data, await response.json());
  }
  notify() { window.dispatchEvent(new Event('reader-storage')); }
  getItem(key) { return this.records[key] ?? null; }
  setItem(key, value) {
    if (this.restoring) throw Error('Restore in progress');
    if (this.blocked) throw Error(this.error);
    if (this.records[key] === value) return;
    const next = { ...this.records, [key]: value };
    // If the browser is full, do not accept a synchronous edit without recovery.
    this.browser.setItem(this.recoveryKey, JSON.stringify({ revision: this.revision, records: next }));
    this.records = next; this.dirty = true; this.generation++; this.error = ''; this.notify();
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(() => {}), 350);
  }
  async request(route, value) {
    const response = await fetch(`./api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Token': this.token }, body: JSON.stringify(value) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error || 'Database save failed'), { status: response.status });
    return result;
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.flight) { await this.flight; return this.dirty ? this.flush() : undefined; }
    if (!this.dirty) return;
    if (this.blocked) throw Error(this.error);
    const generation = this.generation, records = { ...this.records };
    this.flight = this.request('save', { records, revision: this.revision }).then(result => {
      this.revision = result.revision;
      if (generation === this.generation) {
        this.dirty = false;
        // Keep an acknowledged recovery copy: clearing storage is never needed to save.
        this.browser.setItem(this.recoveryKey, JSON.stringify({ revision: this.revision, records: this.records, acknowledged: true }));
      } else this.browser.setItem(this.recoveryKey, JSON.stringify({ revision: this.revision, records: this.records }));
      this.error = '';
    }).catch(error => {
      this.error = error.message; this.blocked = error.status === 409 || error.status === 403;
      throw error;
    }).finally(() => { this.flight = null; this.notify(); });
    await this.flight;
    if (this.dirty) return this.flush();
  }
  accept(result) {
    if (result.token) this.token = result.token;
    this.records = result.records; this.revision = result.revision; this.dirty = false; this.error = ''; this.blocked = false;
    this.browser.setItem(this.recoveryKey, JSON.stringify({ ...result, acknowledged: true })); this.notify();
  }
}
