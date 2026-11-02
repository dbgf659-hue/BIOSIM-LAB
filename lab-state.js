/**
 * BioSim Lab · engine/lab-state.js
 * ---------------------------------------------------------------------------
 * The live state object every hands-on experiment mutates.
 *
 * Design rules
 *  • Plain data only (objects, arrays, numbers, strings, booleans) so a state
 *    can be snapshotted, diffed, saved to localStorage and restored verbatim.
 *  • Path addressing: set("tubeA.contents.0.volumeUl", 50).
 *  • Every mutation pushes an undo checkpoint and notifies subscribers, which is
 *    how the bench re-renders without any per-experiment render code.
 *  • No DOM access anywhere in this file: it is imported by headless tests.
 */

/** Structured deep clone with a JSON fallback for older runtimes. */
export function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to JSON */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/** "a.b.0.c" -> ["a","b",0,"c"] */
export function parsePath(path) {
  if (Array.isArray(path)) return path;
  if (typeof path !== "string" || path.length === 0) return [];
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((part) => part !== "")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function readPath(root, segments) {
  let node = root;
  for (const segment of segments) {
    if (node === null || node === undefined) return undefined;
    node = node[segment];
  }
  return node;
}

function writePath(root, segments, value) {
  if (segments.length === 0) return value;
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    if (node[key] === null || typeof node[key] !== "object") {
      node[key] = typeof segments[i + 1] === "number" ? [] : {};
    }
    node = node[key];
  }
  node[segments[segments.length - 1]] = value;
  return root;
}

export class LabState {
  /**
   * @param {object} initial starting state
   * @param {{historyLimit?: number}} options
   */
  constructor(initial = {}, { historyLimit = 60 } = {}) {
    this.data = clone(initial);
    this.historyLimit = historyLimit;
    this._past = [];
    this._future = [];
    this._subs = new Set();
    this._muted = false;
    this.revision = 0;
  }

  /* ------------------------------------------------------------- reading */
  get(path, fallback = undefined) {
    const value = readPath(this.data, parsePath(path));
    return value === undefined ? fallback : value;
  }

  has(path) {
    return readPath(this.data, parsePath(path)) !== undefined;
  }

  snapshot() {
    return clone(this.data);
  }

  keys() {
    return Object.keys(this.data);
  }

  /* ------------------------------------------------------------- writing */
  /**
   * Set a value at `path`. Returns the previous value.
   * Pass {silent:true} to skip undo + notifications (used while hydrating).
   */
  set(path, value, { silent = false } = {}) {
    const segments = parsePath(path);
    const previous = readPath(this.data, segments);
    if (!silent) this._checkpoint();
    this.data = writePath(this.data, segments, clone(value));
    if (!silent) this._emit(path, value, previous);
    return previous;
  }

  /** Apply a function to the current value at `path`. */
  update(path, updater, options) {
    const current = this.get(path);
    const next = updater(clone(current));
    this.set(path, next, options);
    return next;
  }

  /** Push to an array at `path`. */
  push(path, value, options) {
    const list = this.get(path, []);
    const next = Array.isArray(list) ? [...list, value] : [value];
    this.set(path, next, options);
    return next;
  }

  /** Increment a numeric field, clamped to [min, max]. */
  bump(path, delta, { min = -Infinity, max = Infinity } = {}) {
    const current = Number(this.get(path, 0)) || 0;
    const next = Math.min(max, Math.max(min, current + delta));
    this.set(path, next);
    return next;
  }

  /** Merge a shallow patch into an object at `path`. */
  merge(path, patch, options) {
    this.update(path, (current) => ({ ...(current || {}), ...patch }), options);
  }

  /** Replace the whole state (undoable unless silent). */
  replace(next, { silent = false } = {}) {
    if (!silent) this._checkpoint();
    this.data = clone(next);
    if (!silent) this._emit("*", this.data, null);
  }

  /* --------------------------------------------------------------- undo */
  _checkpoint() {
    if (this._muted) return;
    this._past.push(this.snapshot());
    if (this._past.length > this.historyLimit) this._past.shift();
    this._future.length = 0;
  }

  get canUndo() {
    return this._past.length > 0;
  }

  get canRedo() {
    return this._future.length > 0;
  }

  undo() {
    if (!this.canUndo) return false;
    this._future.push(this.snapshot());
    this.data = this._past.pop();
    this.revision++;
    this._emit("*", this.data, null);
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this._past.push(this.snapshot());
    this.data = this._future.pop();
    this.revision++;
    this._emit("*", this.data, null);
    return true;
  }

  /** Batch many mutations into a single undo entry. */
  transact(fn) {
    this._muted = false;
    const before = this.snapshot();
    this._muted = true;
    try {
      fn(this);
    } finally {
      this._muted = false;
    }
    this._past.push(before);
    if (this._past.length > this.historyLimit) this._past.shift();
    this._future.length = 0;
    this._emit("*", this.data, null);
  }

  /* ------------------------------------------------------ subscriptions */
  subscribe(listener) {
    this._subs.add(listener);
    return () => this._subs.delete(listener);
  }

  _emit(path, value, previous) {
    this.revision++;
    for (const listener of this._subs) {
      try {
        listener(this.data, { path, value, previous, revision: this.revision });
      } catch (error) {
        // A broken subscriber must never stop the simulation.
        if (typeof console !== "undefined") console.warn("[LabState] subscriber failed", error);
      }
    }
  }

  /* --------------------------------------------------------- persistence */
  toJSON() {
    return this.snapshot();
  }

  static fromJSON(json) {
    const data = typeof json === "string" ? JSON.parse(json) : clone(json);
    return new LabState(data);
  }

  save(key) {
    try {
      localStorage.setItem(key, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  load(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      this.replace(JSON.parse(raw), { silent: true });
      return true;
    } catch {
      return false;
    }
  }

  static hasSave(key) {
    try {
      return Boolean(localStorage.getItem(key));
    } catch {
      return false;
    }
  }
}

export default LabState;
