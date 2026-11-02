/**
 * BioSim Lab · engine/pipette.js
 * ---------------------------------------------------------------------------
 * Micropipettes with real ranges, a volume dial, tip tracking and the three
 * mistakes that actually ruin a bench session:
 *   1. dialling outside the pipette's range
 *   2. aspirating past the tip's capacity
 *   3. reusing a tip between samples (carry-over)
 *
 * The class is pure logic; pipette.js does not draw anything. lab-table.js
 * renders it from `view()`.
 */

export const PIPETTE_TYPES = {
  p10: {
    id: "p10",
    label: "P10",
    minUl: 0.5,
    maxUl: 10,
    accuracy: 0.012,
    tipColor: "#fde68a",
    tipLabel: "10 µL tip",
    color: "#38bdf8",
  },
  p200: {
    id: "p200",
    label: "P200",
    minUl: 20,
    maxUl: 200,
    accuracy: 0.008,
    tipColor: "#fef08a",
    tipLabel: "200 µL tip",
    color: "#2ee6c5",
  },
  p1000: {
    id: "p1000",
    label: "P1000",
    minUl: 100,
    maxUl: 1000,
    accuracy: 0.006,
    tipColor: "#bfdbfe",
    tipLabel: "1000 µL tip",
    color: "#a78bfa",
  },
};

export class Pipette {
  /** @param {"p10"|"p200"|"p1000"} type */
  constructor(type = "p200") {
    this.type = PIPETTE_TYPES[type] ? type : "p200";
    this.spec = PIPETTE_TYPES[this.type];
    this.volumeUl = Math.round(this.spec.maxUl / 2);
    this.tip = null;
    this.heldVolumeUl = 0;
    this.lastSample = null;
    this.errors = [];
    this.carryOver = false;
    this.aspiratedSample = null;
  }

  get label() {
    return this.spec.label;
  }

  get hasTip() {
    return this.tip !== null;
  }

  get minUl() {
    return this.spec.minUl;
  }

  get maxUl() {
    return this.spec.maxUl;
  }

  /** Set the dial. Returns false and records an error outside the range. */
  setVolume(volumeUl) {
    const value = Number(volumeUl);
    if (!Number.isFinite(value)) return false;
    if (value < this.spec.minUl - 1e-9 || value > this.spec.maxUl + 1e-9) {
      this._error(
        `${value} µL is outside the ${this.spec.label} range (${this.spec.minUl}–${this.spec.maxUl} µL)`,
        "range",
      );
      return false;
    }
    this.volumeUl = value;
    return true;
  }

  /** Attach a fresh tip. Re-using an unsterile tip is allowed but tracked. */
  attachTip({ sterile = true } = {}) {
    if (this.hasTip) this.ejectTip();
    this.tip = { sterile, usedFor: null, loads: 0 };
    return this.tip;
  }

  ejectTip({ waste = true } = {}) {
    const tip = this.tip;
    this.tip = null;
    this.heldVolumeUl = 0;
    this.aspiratedSample = null;
    if (waste) this.carryOver = false;
    return tip;
  }

  /**
   * Aspirate from a Liquid (or a plain {contents} object).
   * @returns {{ok: boolean, volumeUl: number, error?: string}}
   */
  aspirate(source, volumeUl = this.volumeUl) {
    if (!this.hasTip) {
      this._error("No tip attached — aspirating without a tip", "no-tip");
      return { ok: false, volumeUl: 0, error: "no-tip" };
    }
    if (!this.setVolume(volumeUl)) {
      return { ok: false, volumeUl: 0, error: "range" };
    }
    if (!source || typeof source.remove !== "function") {
      this._error("Aspiration target is not a liquid container", "no-source");
      return { ok: false, volumeUl: 0, error: "no-source" };
    }
    if (source.totalUl <= 0) {
      this._error("Nothing to aspirate — the tube is empty", "empty");
      return { ok: false, volumeUl: 0, error: "empty" };
    }

    // Carry-over: same tip used for a different sample.
    const sampleId = source.sampleId ?? source.id ?? null;
    if (this.tip.usedFor && sampleId && this.tip.usedFor !== sampleId) {
      this.carryOver = true;
      this._error(
        `Tip was used for ${this.tip.usedFor} and not changed before ${sampleId} — cross-contamination`,
        "carry-over",
      );
    }

    const { removed, shortfall } = source.remove(this.volumeUl);
    this.heldVolumeUl = removed;
    this.tip.loads += 1;
    this.tip.usedFor = sampleId ?? this.tip.usedFor;
    this.aspiratedSample = sampleId;
    if (shortfall > 1e-9) {
      this._error(`Aspirated ${removed.toFixed(1)} µL of ${this.volumeUl} µL requested`, "shortfall");
      return { ok: false, volumeUl: removed, error: "shortfall" };
    }
    return { ok: true, volumeUl: removed };
  }

  /**
   * Dispense into a Liquid.
   * @param {object} target container with .add(reagent, ul, opts)
   * @param {{reagent?: string, conc?: number, mix?: boolean, blowOut?: boolean}} options
   */
  dispense(target, { reagent = "sample", conc = 0, mix = false } = {}) {
    if (!this.hasTip) return { ok: false, volumeUl: 0, error: "no-tip" };
    if (this.heldVolumeUl <= 0) return { ok: false, volumeUl: 0, error: "nothing-held" };
    if (!target || typeof target.add !== "function") {
      return { ok: false, volumeUl: 0, error: "no-target" };
    }

    const volume = this.heldVolumeUl;
    const result = target.add(reagent, volume, { conc });
    this.heldVolumeUl = 0;
    if (mix && typeof target.mix === "function") target.mix();
    if (result.overflow > 1e-9) {
      this._error(`Overfilled the tube — ${result.overflow.toFixed(1)} µL overflowed`, "overflow");
      return { ok: false, volumeUl: result.accepted, error: "overflow" };
    }
    return { ok: true, volumeUl: result.accepted };
  }

  /** Discard the held volume. */
  blowOut() {
    const volume = this.heldVolumeUl;
    this.heldVolumeUl = 0;
    return volume;
  }

  _error(message, code) {
    this.errors.push({ message, code, at: Date.now() });
    return message;
  }

  /** Human-readable readout for the instrument panel. */
  view() {
    return {
      type: this.type,
      label: this.spec.label,
      volumeUl: this.volumeUl,
      heldVolumeUl: this.heldVolumeUl,
      hasTip: this.hasTip,
      tipColor: this.spec.tipColor,
      tipLabel: this.spec.tipLabel,
      color: this.spec.color,
      range: `${this.spec.minUl}–${this.spec.maxUl} µL`,
      carryOver: this.carryOver,
      errors: this.errors.slice(-4),
    };
  }

  snapshot() {
    return {
      type: this.type,
      volumeUl: this.volumeUl,
      tip: this.tip ? { ...this.tip } : null,
      heldVolumeUl: this.heldVolumeUl,
      carryOver: this.carryOver,
      errors: this.errors.slice(-10),
    };
  }

  static fromJSON(json) {
    const pipette = new Pipette(json.type);
    pipette.volumeUl = json.volumeUl ?? pipette.volumeUl;
    pipette.tip = json.tip ?? null;
    pipette.heldVolumeUl = json.heldVolumeUl ?? 0;
    pipette.carryOver = Boolean(json.carryOver);
    pipette.errors = json.errors ?? [];
    return pipette;
  }
}

/** Pick the smallest pipette whose range covers `volumeUl`. */
export function choosePipette(volumeUl) {
  const value = Number(volumeUl) || 0;
  if (value <= PIPETTE_TYPES.p10.maxUl) return "p10";
  if (value <= PIPETTE_TYPES.p200.maxUl) return "p200";
  return "p1000";
}

export default Pipette;
