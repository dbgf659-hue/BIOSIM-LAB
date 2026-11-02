/**
 * BioSim Lab · engine/lab-log.js
 * ---------------------------------------------------------------------------
 * Timestamped record of every bench action. This is the audit trail shown in
 * the Event log tab, exported in the lab report, and used by the results
 * engine to reconstruct what the student actually did.
 *
 * DOM-free.
 */

export class LabLog {
  constructor({ limit = 500 } = {}) {
    this.limit = limit;
    this.entries = [];
    this._subs = new Set();
    this._start = null;
    this._nextId = 1;
  }

  /** Start the experiment clock (idempotent). */
  start(now = Date.now()) {
    if (this._start === null) this._start = now;
    return this;
  }

  get started() {
    return this._start !== null;
  }

  /** Seconds since the bench was started. */
  elapsed(now = Date.now()) {
    return this._start === null ? 0 : (now - this._start) / 1000;
  }

  /**
   * @param {string} message human sentence, e.g. "added 5 µL Taq to tube 1"
   * @param {{type?: "action"|"error"|"warn"|"info"|"success", meta?: object, at?: number}} options
   */
  add(message, { type = "action", meta = null, at = null } = {}) {
    if (this._start === null) this._start = at ?? Date.now();
    const entry = {
      id: this._nextId++,
      t: at ?? Date.now(),
      elapsed: this.elapsed(at ?? Date.now()),
      clock: LabLog.formatClock(this.elapsed(at ?? Date.now())),
      message: String(message),
      type,
      meta,
    };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    for (const fn of this._subs) fn(entry, this);
    return entry;
  }

  /** Mark a mistake: same record plus a flag the results engine can count. */
  mistake(message, meta = null) {
    return this.add(message, { type: "error", meta: { ...(meta || {}), mistake: true } });
  }

  clear() {
    this.entries.length = 0;
    this._start = null;
    this._nextId = 1;
    for (const fn of this._subs) fn(null, this);
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  count(type) {
    return this.entries.filter((entry) => entry.type === type).length;
  }

  get mistakes() {
    return this.entries.filter((entry) => entry.meta && entry.meta.mistake);
  }

  /** Plain text, one line per action — used by the report and CSV export. */
  toText() {
    return this.entries.map((entry) => `[${entry.clock}] ${entry.message}`).join("\n");
  }

  /** mm:ss (or h:mm:ss past an hour). */
  static formatClock(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
}

export default LabLog;
