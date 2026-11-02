/**
 * BioSim Lab · engine/state-machine.js
 * ---------------------------------------------------------------------------
 * Procedure sequencing and mistake detection.
 *
 * A Procedure is an ordered graph of steps. Each step may declare:
 *   id        unique key
 *   title     short instruction
 *   hint      what to do (shown in Guided mode)
 *   requires  step ids that must already be complete (order enforcement)
 *   blockedBy optional predicate(state, ctx) -> string | null  (physical check)
 *   optional  if true, never blocks progress
 *
 * Any attempt to complete a step whose prerequisites are unmet is recorded as
 * a mistake with a human explanation and the fix, which the results engine
 * replays in the "What went wrong" review.
 *
 * DOM-free.
 */

export class MistakeBook {
  constructor() {
    this.items = [];
  }

  add({ stepId, action, why, fix, severity = "major" }) {
    this.items.push({ stepId, action, why, fix, severity, at: Date.now() });
    return this.items[this.items.length - 1];
  }

  get count() {
    return this.items.length;
  }

  critical() {
    return this.items.filter((item) => item.severity === "critical").length;
  }

  bySeverity() {
    return this.items.reduce((acc, item) => {
      acc[item.severity] = (acc[item.severity] || 0) + 1;
      return acc;
    }, {});
  }

  clear() {
    this.items.length = 0;
  }
}

export class Procedure {
  /**
   * @param {{id: string, title: string, steps: Array<object>}} definition
   */
  constructor({ id = "procedure", title = "Procedure", steps = [] } = {}) {
    this.id = id;
    this.title = title;
    this.steps = steps.map((step) => ({ optional: false, requires: [], ...step }));
    this.done = new Set();
    this.failed = new Set();
    this.mistakes = new MistakeBook();
    this.order = [];
  }

  get stepIds() {
    return this.steps.map((step) => step.id);
  }

  get(stepId) {
    return this.steps.find((step) => step.id === stepId) ?? null;
  }

  isDone(stepId) {
    return this.done.has(stepId);
  }

  /** First step that is neither done nor optional-blocked. */
  current() {
    return this.steps.find((step) => !this.done.has(step.id)) ?? null;
  }

  /** Steps whose prerequisites are met but which are not yet complete. */
  available() {
    return this.steps.filter(
      (step) => !this.done.has(step.id) && this._requiresMet(step),
    );
  }

  _requiresMet(step) {
    return (step.requires || []).every((required) => this.done.has(required));
  }

  /**
   * Check whether `stepId` may be performed right now, without performing it.
   * @returns {{allowed: boolean, reason: string|null, unmet: string[]}}
   */
  canPerform(stepId, state = null, ctx = {}) {
    const step = this.get(stepId);
    if (!step) return { allowed: false, reason: `Unknown step "${stepId}"`, unmet: [] };
    if (this.done.has(stepId)) {
      return { allowed: true, reason: "already complete", unmet: [] };
    }
    const unmet = (step.requires || []).filter((required) => !this.done.has(required));
    if (unmet.length) {
      return { allowed: false, reason: "out of order", unmet };
    }
    if (typeof step.blockedBy === "function") {
      const blocked = step.blockedBy(state, ctx);
      if (blocked) return { allowed: false, reason: blocked, unmet: [] };
    }
    return { allowed: true, reason: null, unmet: [] };
  }

  /**
   * Attempt to perform a step. Records a mistake instead of throwing when the
   * order is wrong, so a student can keep going and see the consequence.
   * @returns {{ok: boolean, reason?: string, mistake?: object}}
   */
  attempt(stepId, state = null, { ctx = {}, action = null, why = null, fix = null } = {}) {
    const step = this.get(stepId);
    const check = this.canPerform(stepId, state, ctx);
    if (check.allowed) {
      this.complete(stepId);
      return { ok: true };
    }

    const unmetTitles = check.unmet.map((id) => this.get(id)?.title ?? id).join(", ");
    const mistake = this.mistakes.add({
      stepId,
      action: action ?? (step ? step.title : stepId),
      why: why ?? (unmetTitles ? `Done before: ${unmetTitles}. ${check.reason}.` : check.reason),
      fix:
        fix ??
        (unmetTitles
          ? `Complete "${unmetTitles}" first, then repeat this step.`
          : "Correct the condition flagged above and try again."),
      severity: step?.severity ?? "major",
    });
    this.failed.add(stepId);
    return { ok: false, reason: check.reason, mistake };
  }

  complete(stepId) {
    if (!this.done.has(stepId)) {
      this.done.add(stepId);
      this.failed.delete(stepId);
      this.order.push(stepId);
    }
    return this;
  }

  /** Steps that must be complete for a valid result (ignores optional ones). */
  required() {
    return this.steps.filter((step) => !step.optional);
  }

  progress() {
    const required = this.required();
    const done = required.filter((step) => this.done.has(step.id)).length;
    return {
      done,
      total: required.length,
      percent: required.length ? Math.round((done / required.length) * 100) : 0,
      complete: done === required.length,
    };
  }

  reset() {
    this.done.clear();
    this.failed.clear();
    this.order.length = 0;
    this.mistakes.clear();
    return this;
  }

  toJSON() {
    return {
      done: [...this.done],
      failed: [...this.failed],
      order: [...this.order],
      mistakes: this.mistakes.items,
    };
  }

  load(json) {
    if (!json) return this;
    this.done = new Set(json.done || []);
    this.failed = new Set(json.failed || []);
    this.order = json.order || [];
    this.mistakes.items = json.mistakes || [];
    return this;
  }
}

/**
 * Convenience guard for ad-hoc checks that are not part of a procedure.
 * Returns true when the condition is satisfied and records a mistake otherwise.
 */
export function guard(condition, book, { action, why, fix, severity = "major" }) {
  if (condition) return true;
  book.add({ action, why, fix, severity });
  return false;
}

export default Procedure;
