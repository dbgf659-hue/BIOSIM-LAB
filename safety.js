/**
 * BioSim Lab · engine/safety.js
 * ---------------------------------------------------------------------------
 * PPE checklist and hazard register. Skipping PPE is not a hard blocker — it
 * lowers the safety component of the score, exactly as a real induction would.
 *
 * DOM-free.
 */

export const PPE_ITEMS = [
  { id: "coat", label: "Lab coat", hint: "Cotton, buttoned, sleeves down" },
  { id: "gloves", label: "Nitrile gloves", hint: "Powder-free, correct size" },
  { id: "goggles", label: "Safety goggles", hint: "Sealed, not spectacles" },
  { id: "hair", label: "Hair tied back", hint: "Long hair away from flames and rotors" },
];

export const HAZARD_LEVELS = {
  low: { label: "Low", weight: 0, color: "#3ddc97" },
  moderate: { label: "Moderate", weight: 4, color: "#fbbf24" },
  high: { label: "High", weight: 9, color: "#fb7185" },
  extreme: { label: "Extreme", weight: 16, color: "#f472b6" },
};

export class Safety {
  /**
   * @param {{required?: string[], ppe?: typeof PPE_ITEMS}} options
   */
  constructor({ required = ["coat", "gloves", "goggles"], ppe = PPE_ITEMS } = {}) {
    this.ppe = ppe;
    this.required = required.filter((id) => ppe.some((item) => item.id === id));
    this.wornIds = new Set();
    this.hazards = [];
    this.acknowledged = false;
  }

  toggle(id) {
    if (this.wornIds.has(id)) this.wornIds.delete(id);
    else if (this.ppe.some((item) => item.id === id)) this.wornIds.add(id);
    return this.isWorn(id);
  }

  wear(id, on = true) {
    if (!this.ppe.some((item) => item.id === id)) return false;
    if (on) this.wornIds.add(id);
    else this.wornIds.delete(id);
    return this.isWorn(id);
  }

  isWorn(id) {
    return this.wornIds.has(id);
  }

  missing() {
    return this.required.filter((id) => !this.wornIds.has(id));
  }

  get compliant() {
    return this.missing().length === 0;
  }

  /** 0–100. Missing PPE costs 20 points each, capped. */
  score() {
    const missing = this.missing().length;
    const ppeScore = Math.max(0, 100 - missing * (100 / Math.max(1, this.required.length)));
    return Math.round(ppeScore);
  }

  /** Register a hazard that this protocol carries (EtBr, UV, centrifuge...). */
  addHazard({ id, label, level = "moderate", note = "" }) {
    if (this.hazards.some((hazard) => hazard.id === id)) return;
    this.hazards.push({ id, label, level, note, ...HAZARD_LEVELS[level] });
  }

  /** Total hazard exposure, used to weight the safety score. */
  hazardLoad() {
    return this.hazards.reduce((sum, hazard) => sum + (HAZARD_LEVELS[hazard.level]?.weight ?? 0), 0);
  }

  /**
   * @param {number} incidents number of logged safety mistakes (spill, UV without
   *   visor, open centrifuge, etc.)
   */
  summary(incidents = 0) {
    const missing = this.missing();
    const base = this.score();
    const penalty = Math.min(60, incidents * 12);
    const value = Math.max(0, base - penalty);
    return {
      score: value,
      missing,
      compliant: this.compliant,
      hazards: this.hazards,
      incidents,
      label:
        value >= 90 ? "Exemplary" : value >= 70 ? "Acceptable" : value >= 45 ? "Needs correction" : "Unsafe",
    };
  }

  toJSON() {
    return { worn: [...this.wornIds], hazards: this.hazards, acknowledged: this.acknowledged };
  }

  load(json) {
    if (!json) return this;
    this.wornIds = new Set(json.worn || []);
    this.hazards = json.hazards || [];
    this.acknowledged = Boolean(json.acknowledged);
    return this;
  }
}

export default Safety;
