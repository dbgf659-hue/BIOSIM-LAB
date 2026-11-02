/**
 * BioSim Lab · engine/liquid.js
 * ---------------------------------------------------------------------------
 * A container's liquid: what is in it, how much, how warm and what colour it
 * looks. Everything here is physics-of-the-bench, not drawing:
 *   • volume add/remove with overflow handling
 *   • colour blending weighted by volume
 *   • Newton heating/cooling with an optional immersion heat source
 *   • pellet / precipitate layers and bubble state for rendering
 *
 * DOM-free.
 */

const NAMED_COLORS = {
  colourless: [235, 245, 245],
  water: [200, 232, 240],
  buffer: [180, 220, 235],
  tae: [186, 224, 236],
  tbe: [182, 220, 230],
  ethanol: [220, 236, 245],
  agarose: [226, 232, 226],
  "loading-dye": [34, 60, 140],
  dna: [180, 226, 246],
  "sybr-safe": [120, 220, 190],
  "etbr": [250, 170, 120],
  media: [196, 186, 120],
  lb: [206, 190, 128],
  blood: [150, 26, 34],
  lysate: [186, 158, 120],
  phenol: [226, 178, 120],
  chloroform: [238, 240, 244],
  isopropanol: [236, 242, 248],
  precipitate: [232, 236, 238],
  sample: [176, 214, 236],
};

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/**
 * Convert anything the experiments pass as a colour into [r,g,b].
 * Accepts "#2ee6c5", "2ee6c5", named reagents from NAMED_COLORS.
 */
export function toRgb(color) {
  if (Array.isArray(color)) return color.slice(0, 3);
  const key = String(color || "").toLowerCase().replace(/[\s_]/g, "-");
  if (NAMED_COLORS[key]) return NAMED_COLORS[key].slice();
  const match = HEX.exec(String(color || ""));
  if (match) {
    let hex = match[1];
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return [200, 220, 226];
}

export function toCss(color) {
  const [r, g, b] = toRgb(color);
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

/** Volume-weighted colour average. Empty liquid is water-clear. */
export function mixColors(contents) {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const item of contents || []) {
    const volume = Math.max(0, Number(item.volumeUl) || 0);
    if (volume <= 0) continue;
    const rgb = toRgb(item.color ?? item.reagent);
    r += rgb[0] * volume;
    g += rgb[1] * volume;
    b += rgb[2] * volume;
    total += volume;
  }
  if (total <= 0) return [200, 220, 226];
  return [r / total, g / total, b / total];
}

export class Liquid {
  /**
   * @param {{capacityUl?: number, temperatureC?: number, contents?: Array}} options
   */
  constructor({ capacityUl = 1500, temperatureC = 22, contents = [], ambientC = 22 } = {}) {
    this.capacityUl = capacityUl;
    this.temperatureC = temperatureC;
    this.ambientC = ambientC;
    this.contents = contents.map((item) => ({ ...item }));
    this.pellet = false;
    this.precipitate = false;
    this.bubbles = 0;
    this.boiledOver = false;
    this.spilledUl = 0;
  }

  get totalUl() {
    return this.contents.reduce((sum, item) => sum + (Number(item.volumeUl) || 0), 0);
  }

  get isEmpty() {
    return this.totalUl <= 1e-9;
  }

  get freeUl() {
    return Math.max(0, this.capacityUl - this.totalUl);
  }

  get level() {
    if (!(this.capacityUl > 0)) return 0;
    return Math.min(1, this.totalUl / this.capacityUl);
  }

  get color() {
    return mixColors(this.contents);
  }

  get colorCss() {
    const [r, g, b] = this.color;
    return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
  }

  /** Molarity of a reagent across the current total volume (µmol/L style maths). */
  concentrationOf(reagent) {
    const total = this.totalUl;
    if (total <= 0) return 0;
    const item = this.contents.find((entry) => entry.reagent === reagent);
    if (!item) return 0;
    return ((item.conc || 0) * (item.volumeUl || 0)) / total;
  }

  has(reagent) {
    return this.contents.some((item) => item.reagent === reagent && item.volumeUl > 0);
  }

  volumeOf(reagent) {
    return this.contents
      .filter((item) => item.reagent === reagent)
      .reduce((sum, item) => sum + item.volumeUl, 0);
  }

  /**
   * Add volume. Returns how much actually went in plus any overflow.
   * @param {string} reagent
   * @param {number} volumeUl
   * @param {{conc?: number, color?: string, temperatureC?: number}} options
   */
  add(reagent, volumeUl, { conc = 0, color = null, temperatureC = null } = {}) {
    const requested = Math.max(0, Number(volumeUl) || 0);
    const accepted = Math.min(requested, this.freeUl);
    const overflow = requested - accepted;
    if (overflow > 0) this.spilledUl += overflow;

    if (accepted > 0) {
      const existing = this.contents.find((item) => item.reagent === reagent && (item.conc || 0) === conc);
      if (existing) {
        // Mix concentrations by volume when the same reagent arrives again.
        const total = existing.volumeUl + accepted;
        existing.conc = ((existing.conc || 0) * existing.volumeUl + conc * accepted) / total;
        existing.volumeUl = total;
      } else {
        this.contents.push({
          reagent,
          volumeUl: accepted,
          conc,
          color: color ?? reagent,
          temperatureC: temperatureC ?? this.temperatureC,
        });
      }
      if (temperatureC !== null) this._blendTemperature(accepted, temperatureC);
    }
    return { accepted, overflow, total: this.totalUl };
  }

  /**
   * Remove volume. Draws proportionally from every component so the mixture
   * stays representative (as pipetting from a mixed tube does).
   */
  remove(volumeUl) {
    const requested = Math.max(0, Number(volumeUl) || 0);
    const available = this.totalUl;
    const removed = Math.min(requested, available);
    if (removed <= 0) return { removed: 0, shortfall: requested };

    if (removed >= available - 1e-9) {
      this.contents = [];
      this.pellet = false;
      this.precipitate = false;
      return { removed: available, shortfall: requested - available };
    }
    const factor = (available - removed) / available;
    for (const item of this.contents) item.volumeUl *= factor;
    this.contents = this.contents.filter((item) => item.volumeUl > 1e-9);
    return { removed, shortfall: requested - removed };
  }

  clear() {
    this.contents = [];
    this.pellet = false;
    this.precipitate = false;
    this.bubbles = 0;
    return this;
  }

  _blendTemperature(addedUl, addedTempC) {
    const total = this.totalUl;
    if (total <= 0) {
      this.temperatureC = addedTempC;
      return;
    }
    const before = total - addedUl;
    this.temperatureC = (before * this.temperatureC + addedUl * addedTempC) / total;
  }

  setTemperature(celsius) {
    this.temperatureC = Number(celsius) || 0;
    return this;
  }

  /**
   * Advance the thermal model.
   * @param {number} dtSeconds
   * @param {{powerW?: number, heating?: boolean, coolingK?: number, stirring?: boolean}} options
   */
  tick(dtSeconds, { powerW = 0, heating = false, coolingK = 0.004, stirring = false } = {}) {
    const dt = Math.max(0, dtSeconds);
    if (dt === 0) return this;

    // Water-equivalent mass: 1 µL ≈ 1 mg, c ≈ 4.186 J g⁻¹ K⁻¹.
    const massG = Math.max(0.05, this.totalUl / 1000);
    const heatCapacity = 4.186;

    if (heating && this.totalUl > 0) {
      const effectivePower = powerW * (stirring ? 1 : 0.65);
      this.temperatureC += (effectivePower * dt) / (massG * heatCapacity);
    }
    // Newton cooling toward ambient.
    this.temperatureC += (this.ambientC - this.temperatureC) * (1 - Math.exp(-coolingK * dt));

    if (this.temperatureC >= 100 && this.totalUl > 0) {
      this.bubbles = Math.min(1, this.bubbles + dt * 0.4);
      if (this.temperatureC > 104) {
        this.boiledOver = true;
        this.remove(this.totalUl * Math.min(0.5, dt * 0.05));
      }
    } else {
      this.bubbles = Math.max(0, this.bubbles - dt * 0.6);
    }
    this.temperatureC = Math.min(140, this.temperatureC);
    return this;
  }

  /** Time to reach a target temperature at a fixed power (seconds). */
  timeTo(celsius, powerW = 300, { stirring = true } = {}) {
    const massG = Math.max(0.05, this.totalUl / 1000);
    const effectivePower = powerW * (stirring ? 1 : 0.65);
    const delta = celsius - this.temperatureC;
    if (delta <= 0) return 0;
    return (delta * massG * 4.186) / Math.max(0.001, effectivePower);
  }

  /** Visual state for the bench renderer. */
  view() {
    return {
      level: this.level,
      color: this.colorCss,
      temperatureC: this.temperatureC,
      bubbles: this.bubbles,
      pellet: this.pellet,
      precipitate: this.precipitate,
      empty: this.isEmpty,
      totalUl: this.totalUl,
      contents: this.contents.map((item) => ({ ...item })),
    };
  }

  snapshot() {
    return {
      capacityUl: this.capacityUl,
      temperatureC: this.temperatureC,
      contents: this.contents.map((item) => ({ ...item })),
      pellet: this.pellet,
      precipitate: this.precipitate,
    };
  }

  static fromJSON(json) {
    const liquid = new Liquid({
      capacityUl: json.capacityUl ?? 1500,
      temperatureC: json.temperatureC ?? 22,
      contents: json.contents ?? [],
    });
    liquid.pellet = Boolean(json.pellet);
    liquid.precipitate = Boolean(json.precipitate);
    return liquid;
  }
}

export default Liquid;
