/**
 * BioSim Lab · Agrobacterium-mediated Transfer — hands-on module
 * -------------------------------------------------------------------------
 * Wound a leaf disc, co-cultivate with Agrobacterium carrying a Ti plasmid,
 * induce virulence with acetosyringone, select with kanamycin and regenerate.
 * No antibiotic in the co-cultivation medium lets the bacteria overgrow.
 */

import { mountHandsOn } from "../engine/hands-on.js";

const lv = (ctx) => {
  if (!ctx.helpers.live) ctx.helpers.live = { coMin: 0, transfer: 0, overgrown: false, regenerated: 0, alerted: {} };
  return ctx.helpers.live;
};

const spec = {
  mode: "guided",
  requiredPPE: ["coat", "gloves", "goggles"],
  shelf: [
    { id: "leaf", label: "Sterile leaf", type: "slide", group: "Biology", color: "#86efac" },
    { id: "culture", label: "Agrobacterium (Ti plasmid)", type: "tube", group: "Biology", color: "#fca5a5" },
    { id: "acetosyringone", label: "Acetosyringone 200 µM", type: "bottle", group: "Reagents", color: "#fde68a" },
    { id: "kanamycin", label: "Kanamycin 50 mg/L", type: "bottle", group: "Selection", color: "#93c5fd" },
    { id: "cefotaxime", label: "Cefotaxime (kill Agrobacterium)", type: "bottle", group: "Selection", color: "#c4b5fd" },
    { id: "media", label: "MS regeneration medium", type: "bottle", group: "Media", color: "#bbf7d0" },
    { id: "dish", label: "Co-cultivation dish", type: "plate", group: "Equipment" },
  ],
  slots: [
    { id: "dish", label: "Co-cultivation dish", hint: "leaf disc + bacteria" },
    { id: "selection", label: "Selection medium", hint: "kanamycin + cefotaxime" },
    { id: "regen", label: "Regeneration", hint: "shoots from transgenic cells" },
  ],
  instruments: { shaker: { type: "shaker", settings: { setpointC: 28, agitationRpm: 150 } } },
  initial: { wounded: false, bacteria: false, induced: false, selected: false },

  procedure: [
    { id: "wound", title: "Wound the leaf disc", hint: "Fresh cuts expose cells for T-DNA transfer.", requires: [] },
    { id: "bacteria", title: "Add Agrobacterium and acetosyringone", hint: "Acetosyringone induces the vir genes.", requires: ["wound"] },
    { id: "cocultivate", title: "Co-cultivate for 48 h", hint: "28 °C in the dark.", requires: ["bacteria"] },
    { id: "select", title: "Transfer to selection medium", hint: "Kanamycin selects transformants; cefotaxime kills the bacteria.", requires: ["cocultivate"] },
    { id: "regenerate", title: "Regenerate shoots", hint: "Cytokinin-rich medium, 4–6 weeks.", requires: ["select"] },
  ],

  onMount(ctx) {
    lv(ctx);
  },

  tick(ctx, dt) {
    const s = ctx.state.data;
    const live = lv(ctx);
    if (!s.bacteria) return;
    live.coMin += dt / 4;
    live.transfer = Math.min(100, (live.coMin / 48) * 100);
    if (live.coMin >= 48 && !ctx.procedure.isDone("cocultivate")) ctx.perform("cocultivate");
    if (live.coMin > 72 && !s.selected && !live.overgrown) {
      live.overgrown = true;
      ctx.mistake("Co-cultivated too long without selection", "Agrobacterium overgrows the explant and kills the plant tissue.", "Move to selection medium at 48 h.", "critical");
    }
  },

  refresh(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    return {
      readouts: [
        { label: "Wounded", value: s.wounded ? "yes" : "no", status: s.wounded ? "ok" : "warn" },
        { label: "Vir induction", value: s.induced ? "acetosyringone" : "none", status: s.induced ? "ok" : "warn" },
        { label: "Co-cultivation", value: `${live.coMin.toFixed(0)} h` },
        { label: "T-DNA transfer", value: `${live.transfer.toFixed(0)} %` },
        { label: "Selection", value: s.selected ? "kanamycin" : "none", status: s.selected ? "ok" : "warn" },
        { label: "Shoots", value: live.regenerated, status: live.regenerated > 0 ? "ok" : "warn" },
      ],
      graph: {
        xLabel: "Co-cultivation (h)",
        yLabel: "T-DNA transfer (%)",
        series: [{ label: "Transfer", color: "#2ee6c5", points: [{ x: 0, y: 0 }, { x: 12, y: 25 }, { x: 24, y: 70 }, { x: 48, y: 96 }] }],
      },
    };
  },

  render(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    return `
      <div class="ag-art">
        <div class="ag-disc ${live.overgrown ? "is-overgrown" : ""}">
          ${Array.from({ length: 26 }, (_, i) => `<b style="left:${8 + ((i * 13) % 84)}%;top:${8 + ((i * 29) % 80)}%"></b>`).join("")}
          ${s.wounded ? `<i></i>` : ""}
        </div>
        <div class="ag-art__facts">
          <p><b>T-DNA</b><span>${live.transfer.toFixed(0)}% transferred</span></p>
          <p><b>Vir genes</b><span>${s.induced ? "induced" : "off"}</span></p>
          <p><b>Selection</b><span>${s.selected ? "kanamycin + cefotaxime" : "none"}</span></p>
          <p><b>Regeneration</b><span>${live.regenerated} shoots</span></p>
        </div>
      </div>`;
  },

  onDrop(ctx, { slotId, item }) {
    const s = ctx.state.data;
    const live = lv(ctx);
    if (slotId === "dish") {
      if (item.id === "leaf") {
        s.wounded = true;
        return ctx.perform("wound");
      }
      if (item.id === "culture") {
        if (!s.wounded) return ctx.mistake("Bacteria on an unwounded leaf", "The cut surface is where T-DNA enters.", "Wound the leaf disc first.");
        s.bacteria = true;
        return ctx.perform("bacteria");
      }
      if (item.id === "acetosyringone") {
        s.induced = true;
        return ctx.notify("vir genes induced — T-DNA processing starts.", "success");
      }
    }
    if (slotId === "selection") {
      if (!s.bacteria) return ctx.mistake("Selected before co-cultivation", "There are no transformed cells yet.", "Co-cultivate first.");
      if (!s.induced) return ctx.mistake("No acetosyringone", "Without vir induction no T-DNA is transferred, so kanamycin kills every cell.", "Add acetosyringone during co-cultivation.", "critical");
      if (item.id === "cefotaxime") {
        s.selected = true;
        ctx.perform("select");
        return ctx.notify("Cefotaxime kills the Agrobacterium; kanamycin selects transformants.", "success");
      }
      s.selected = true;
      return ctx.perform("select");
    }
    if (slotId === "regen") {
      if (!s.selected) return ctx.mistake("Regeneration before selection", "Untransformed cells and bacteria take over.", "Select on kanamycin first.");
      if (item.id === "media") {
        live.regenerated = 14;
        ctx.perform("regenerate");
        return ctx.notify("Shoots regenerating from transgenic callus.", "success");
      }
    }
  },

  skip(ctx) {
    const live = lv(ctx);
    live.coMin = Math.max(live.coMin, 48);
    live.transfer = 96;
  },

  finalize(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    return {
      headline: live.overgrown
        ? "Agrobacterium overgrew the explant — no transgenic plants."
        : !s.selected
          ? "No selection was applied, so transformants cannot be identified."
          : `${live.regenerated} kanamycin-resistant shoots regenerated from T-DNA transformants.`,
      observations: [
        { label: "Leaf wounded", expected: "yes", actual: s.wounded ? "yes" : "no", pass: s.wounded },
        { label: "Acetosyringone", expected: "present", actual: s.induced ? "yes" : "no", pass: s.induced },
        { label: "Co-cultivation", expected: "48", actual: live.coMin.toFixed(0), unit: "h", pass: live.coMin >= 40 && live.coMin <= 60 },
        { label: "T-DNA transfer", expected: ">80", actual: live.transfer.toFixed(0), unit: "%", pass: live.transfer >= 80 },
        { label: "Selection", expected: "kanamycin", actual: s.selected ? "yes" : "no", pass: s.selected },
        { label: "Overgrowth", expected: "none", actual: live.overgrown ? "present" : "none", pass: !live.overgrown },
        { label: "Shoots", expected: ">0", actual: live.regenerated, pass: live.regenerated > 0 },
      ],
      series: [{ label: "Transfer", color: "#2ee6c5", points: [{ x: 0, y: 0 }, { x: 12, y: 25 }, { x: 24, y: 70 }, { x: 48, y: 96 }] }],
      xLabel: "Co-cultivation (h)",
      yLabel: "T-DNA transfer (%)",
    };
  },

  onReset(ctx) {
    ctx.helpers.live = { coMin: 0, transfer: 0, overgrown: false, regenerated: 0, alerted: {} };
  },
};

export function mount(root, experiment, options = {}) {
  return mountHandsOn(root, experiment, spec, options);
}

export default mount;
