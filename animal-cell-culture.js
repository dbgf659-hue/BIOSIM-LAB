/**
 * BioSim Lab · Animal Cell Culture — hands-on module
 * -------------------------------------------------------------------------
 * DMEM + FBS in a CO₂ incubator, trypsinisation timed by the user, a
 * hemocytometer count with trypan blue viability and a passage split. Leaving
 * trypsin on too long strips the receptors and kills the cells.
 */

import { mountHandsOn } from "../engine/hands-on.js";

const lv = (ctx) => {
  if (!ctx.helpers.live) ctx.helpers.live = { trypsinMin: 0, counted: false, alive: 2.4e6, dead: 0.2e6, alerted: {} };
  return ctx.helpers.live;
};

const spec = {
  mode: "guided",
  requiredPPE: ["coat", "gloves", "goggles"],
  shelf: [
    { id: "flask", label: "T25 flask with cells", type: "flask", group: "Biology", color: "#fda4af" },
    { id: "dmem", label: "DMEM + 10% FBS", type: "bottle", group: "Media", color: "#fca5a5" },
    { id: "pbs", label: "PBS", type: "bottle", group: "Reagents", color: "#bae0ec" },
    { id: "trypsin", label: "0.25% trypsin-EDTA", type: "bottle", group: "Reagents", color: "#fde68a" },
    { id: "trypan", label: "Trypan blue", type: "bottle", group: "Stains", color: "#3b82f6" },
    { id: "hemo", label: "Hemocytometer", type: "slide", group: "Equipment" },
  ],
  slots: [
    { id: "flask", label: "Culture flask", hint: "medium and cells" },
    { id: "hood", label: "Biosafety cabinet", hint: "trypsinise here" },
    { id: "incubator", label: "CO₂ incubator", hint: "37 °C, 5% CO₂" },
    { id: "count", label: "Hemocytometer", hint: "count four squares" },
  ],
  instruments: { incubator: { type: "incubator", settings: { setpointC: 37, co2Percent: 5 } } },
  initial: { media: false, cells: false, trypsin: false, resuspended: false, split: 5 },

  procedure: [
    { id: "media", title: "Add warm DMEM + 10% FBS", hint: "Complete medium into the flask.", requires: [] },
    { id: "cells", title: "Seed the cells", hint: "Thaw and add the cell suspension.", requires: ["media"] },
    { id: "trypsin", title: "Trypsinise for 3–5 min", hint: "Detach the monolayer, then stop with medium.", requires: ["cells"] },
    { id: "count", title: "Count with trypan blue", hint: "Four squares × 10⁴ × dilution.", requires: ["trypsin"] },
    { id: "passage", title: "Passage at the right split ratio", hint: "1:5 for a healthy, sub-confluent flask.", requires: ["count"] },
  ],

  onMount(ctx) {
    lv(ctx);
    ctx.table.setControls(
      [{ key: "split", label: "Split ratio", min: 2, max: 20, step: 1, value: 5, unit: ":1" }],
      (key, value) => {
        ctx.state.set("split", value);
        ctx.state.data.split = value;
      },
    );
  },

  tick(ctx, dt) {
    const s = ctx.state.data;
    const live = lv(ctx);
    if (s.trypsin && !s.resuspended) {
      live.trypsinMin += dt / 6;
      if (live.trypsinMin > 10 && !live.alerted.over) {
        live.alerted.over = true;
        live.alive *= 0.35;
        ctx.mistake("Over-trypsinised", "Prolonged trypsin digests membrane proteins and the cells die on re-plating.", "Detach for 3–5 min and quench with serum-containing medium.", "critical");
      }
      if (live.trypsinMin >= 4 && !ctx.procedure.isDone("trypsin")) ctx.perform("trypsin");
    }
  },

  refresh(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    const viability = (live.alive / (live.alive + live.dead)) * 100;
    return {
      readouts: [
        { label: "Medium", value: s.media ? "DMEM + FBS" : "none" },
        { label: "Trypsin", value: s.trypsin ? `${live.trypsinMin.toFixed(1)} min` : "not added", status: live.trypsinMin <= 10 ? "ok" : "bad" },
        { label: "Viability", value: `${viability.toFixed(0)} %`, status: viability >= 85 ? "ok" : "warn" },
        { label: "Cell count", value: `${(live.alive / 1e6).toFixed(2)} × 10⁶/mL` },
        { label: "Split", value: `1:${s.split}` },
        { label: "Incubator", value: "37 °C · 5% CO₂" },
      ],
      graph: {
        xLabel: "Hemocytometer square",
        yLabel: "Cells",
        series: [{ label: "Cells", color: "#2ee6c5", points: [1, 2, 3, 4].map((n) => ({ x: n, y: Math.round(live.alive / 4e4) })) }],
      },
    };
  },

  render(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    const cells = Math.min(60, Math.round(live.alive / 1e5));
    return `
      <div class="ac-cell-art">
        <div class="ac-flask ${s.media ? "has-media" : ""}">
          ${Array.from({ length: cells }, (_, i) => {
            const angle = (i / 60) * Math.PI * 2 * 3.2;
            return `<b style="left:${50 + Math.cos(angle) * (6 + (i % 7) * 5)}%;top:${50 + Math.sin(angle) * (6 + (i % 5) * 6)}%"></b>`;
          }).join("")}
        </div>
        <div class="ac-grid">
          ${Array.from({ length: 16 }, (_, i) => `<span>${live.counted && i % 4 === 0 ? Math.round(live.alive / 4e4) : ""}</span>`).join("")}
        </div>
        <div class="ac-cell-art__facts">
          <p><b>Viability</b><span>${((live.alive / (live.alive + live.dead)) * 100).toFixed(0)}%</span></p>
          <p><b>Trypsin</b><span>${live.trypsinMin.toFixed(1)} min</span></p>
          <p><b>Split</b><span>1:${s.split}</span></p>
        </div>
      </div>`;
  },

  onDrop(ctx, { slotId, item }) {
    const s = ctx.state.data;
    const live = lv(ctx);
    if (slotId === "flask") {
      if (item.id === "dmem") {
        s.media = true;
        return ctx.perform("media");
      }
      if (item.id === "flask") {
        s.cells = true;
        return ctx.perform("cells");
      }
      if (item.id === "trypsin") {
        if (!s.media) return ctx.mistake("Trypsin without medium", "There is nothing to quench the enzyme, so it keeps digesting.", "Add complete medium first.");
        s.trypsin = true;
        return ctx.notify("Trypsin added — watch the clock.", "info");
      }
      return;
    }
    if (slotId === "hood" && item.id === "pbs") return ctx.notify("Monolayer rinsed with PBS.", "info");
    if (slotId === "count") {
      if (!s.trypsin) return ctx.mistake("Counted an attached monolayer", "Cells must be detached before counting.", "Trypsinise first.");
      live.counted = true;
      return ctx.perform("count");
    }
    if (slotId === "incubator") {
      if (!s.cells) return ctx.mistake("Incubating an empty flask", "No cells to grow.", "Seed the flask first.");
      ctx.perform("passage");
      return ctx.notify("Flask in the CO₂ incubator.", "success");
    }
  },

  skip(ctx) {
    const live = lv(ctx);
    live.trypsinMin = Math.max(live.trypsinMin, 4);
    ctx.perform("trypsin");
  },

  finalize(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    const viability = (live.alive / (live.alive + live.dead)) * 100;
    return {
      headline: !s.cells
        ? "No cells were cultured."
        : live.trypsinMin > 10
          ? "Over-trypsinisation destroyed most of the cells."
          : `${(live.alive / 1e6).toFixed(2)} × 10⁶ cells/mL at ${viability.toFixed(0)}% viability; split 1:${s.split}.`,
      observations: [
        { label: "Medium", expected: "DMEM + 10% FBS", actual: s.media ? "yes" : "no", pass: s.media },
        { label: "Cells seeded", expected: "yes", actual: s.cells ? "yes" : "no", pass: s.cells },
        { label: "Trypsin time", expected: "3–5", actual: live.trypsinMin.toFixed(1), unit: "min", pass: live.trypsinMin >= 3 && live.trypsinMin <= 10 },
        { label: "Viability", expected: ">85", actual: viability.toFixed(0), unit: "%", pass: viability >= 85 },
        { label: "Cell count", expected: "1–5 ×10⁶", actual: (live.alive / 1e6).toFixed(2), unit: "×10⁶/mL", pass: live.alive >= 1e6 && live.alive <= 5e6 },
        { label: "Split ratio", expected: "1:5", actual: `1:${s.split}`, pass: s.split >= 4 && s.split <= 6 },
      ],
      series: [{ label: "Cells", color: "#2ee6c5", points: [1, 2, 3, 4].map((n) => ({ x: n, y: Math.round(live.alive / 4e4) })) }],
      xLabel: "Hemocytometer square",
      yLabel: "Cells",
    };
  },

  onReset(ctx) {
    ctx.helpers.live = { trypsinMin: 0, counted: false, alive: 2.4e6, dead: 0.2e6, alerted: {} };
  },
};

export function mount(root, experiment, options = {}) {
  return mountHandsOn(root, experiment, spec, options);
}

export default mount;
