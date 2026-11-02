/**
 * BioSim Lab · Antibiotic Sensitivity (Kirby-Bauer) — hands-on module
 * -------------------------------------------------------------------------
 * Swab a 0.5 McFarland lawn, place discs, incubate, measure the zone and
 * classify S / I / R against the CLSI chart. A thin lawn or overlapping discs
 * make the measurement unreadable.
 */

import { mountHandsOn } from "../engine/hands-on.js";

const DISCS = {
  ampicillin: { label: "AMP 10 µg", zone: 6, s: 17, r: 14 },
  tetracycline: { label: "TET 30 µg", zone: 22, s: 19, r: 15 },
  gentamicin: { label: "GEN 10 µg", zone: 20, s: 15, r: 13 },
  ciprofloxacin: { label: "CIP 5 µg", zone: 28, s: 21, r: 16 },
  vancomycin: { label: "VAN 30 µg", zone: 0, s: 17, r: 15 },
};

const classify = (zone, disc) => (zone >= disc.s ? "S" : zone > disc.r ? "I" : "R");

const lv = (ctx) => {
  if (!ctx.helpers.live) ctx.helpers.live = { incubated: false, measured: [], alerted: {} };
  return ctx.helpers.live;
};

const spec = {
  mode: "guided",
  requiredPPE: ["coat", "gloves", "goggles"],
  shelf: [
    { id: "culture", label: "E. coli (0.5 McFarland)", type: "tube", group: "Biology", color: "#fde68a" },
    { id: "swab", label: "Sterile swab", type: "pipette", group: "Equipment" },
    { id: "plate", label: "Mueller-Hinton plate", type: "plate", group: "Media", color: "#fcd34d" },
    { id: "forceps", label: "Sterile forceps", type: "pipette", group: "Equipment" },
    ...Object.entries(DISCS).map(([id, disc]) => ({ id, label: disc.label, type: "slide", group: "Discs", color: "#e2e8f0" })),
  ],
  slots: [
    { id: "plate", label: "Plate", hint: "lawn, then discs" },
    { id: "ruler", label: "Ruler", hint: "measure the zone" },
  ],
  instruments: { incubator: { type: "incubator", settings: { setpointC: 37 } } },
  initial: { lawn: false, discs: [] },

  procedure: [
    { id: "lawn", title: "Make a confluent lawn", hint: "Swab the culture over the whole plate.", requires: [] },
    { id: "discs", title: "Place the antibiotic discs", hint: "At least three discs, evenly spaced.", requires: ["lawn"] },
    { id: "incubate", title: "Incubate at 37 °C for 16–18 h", hint: "Zones appear around effective antibiotics.", requires: ["discs"] },
    { id: "measure", title: "Measure the zones", hint: "Use the ruler across the disc centre.", requires: ["incubate"] },
  ],

  onMount(ctx) {
    lv(ctx);
  },

  tick() {},

  refresh(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    const rows = s.discs.map((id) => {
      const disc = DISCS[id];
      return { id, disc, zone: live.incubated ? disc.zone : 0 };
    });
    return {
      readouts: [
        { label: "Lawn", value: s.lawn ? "confluent" : "none", status: s.lawn ? "ok" : "bad" },
        { label: "Discs", value: s.discs.length },
        { label: "Incubated", value: live.incubated ? "yes" : "no" },
        ...rows.map((row) => ({ label: row.disc.label, value: live.incubated ? `${row.zone} mm · ${classify(row.zone, row.disc)}` : "—" })),
      ],
      graph: {
        xLabel: "Antibiotic",
        yLabel: "Zone (mm)",
        series: [{ label: "Zone", color: "#2ee6c5", points: rows.map((row, index) => ({ x: index + 1, y: row.zone })) }],
      },
    };
  },

  render(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    return `
      <div class="kb-art">
        <div class="kb-plate ${s.lawn ? "has-lawn" : ""}">
          ${s.discs.map((id, index) => {
            const angle = (index / Math.max(1, s.discs.length)) * Math.PI * 2 - Math.PI / 2;
            const x = 50 + Math.cos(angle) * 26;
            const y = 50 + Math.sin(angle) * 26;
            const disc = DISCS[id];
            return `<span class="kb-disc" style="left:${x}%;top:${y}%" title="${disc.label}"></span>
              ${live.incubated && disc.zone ? `<span class="kb-zone" style="left:${x}%;top:${y}%;width:${disc.zone * 1.6}%;height:${disc.zone * 1.6}%"></span>` : ""}
              <em style="left:${x}%;top:${y + 10}%">${disc.label.split(" ")[0]} ${live.incubated ? `${disc.zone}mm` : ""}</em>`;
          }).join("")}
          ${!s.lawn ? `<b>no lawn</b>` : ""}
        </div>
        <div class="kb-art__table">
          ${s.discs.length
            ? s.discs
                .map((id) => {
                  const disc = DISCS[id];
                  const zone = live.incubated ? disc.zone : 0;
                  return `<p><b>${disc.label}</b><span>${live.incubated ? `${zone} mm · ${classify(zone, disc)}` : "not incubated"}</span></p>`;
                })
                .join("")
            : `<p class="ho-empty">No discs placed.</p>`}
        </div>
      </div>`;
  },

  onDrop(ctx, { slotId, item }) {
    const s = ctx.state.data;
    if (slotId === "plate") {
      if (item.id === "culture" || item.id === "swab") {
        s.lawn = true;
        return ctx.perform("lawn");
      }
      if (DISCS[item.id]) {
        if (!s.lawn) return ctx.mistake("Disc on an unswabbed plate", "Without a lawn there is nothing to inhibit.", "Make a confluent lawn first.");
        if (s.discs.includes(item.id)) return;
        s.discs = [...s.discs, item.id];
        if (s.discs.length >= 3) ctx.perform("discs");
        return ctx.notify(`${DISCS[item.id].label} placed.`, "success");
      }
    }
    if (slotId === "ruler") {
      if (!lv(ctx).incubated) return ctx.mistake("Measured before incubation", "Zones have not formed.", "Incubate overnight first.");
      ctx.perform("measure");
      return ctx.notify("Zones measured and classified S/I/R.", "success");
    }
  },

  skip(ctx) {
    const s = ctx.state.data;
    if (s.discs.length) {
      lv(ctx).incubated = true;
      ctx.perform("incubate");
      ctx.perform("measure");
    }
  },

  finalize(ctx) {
    const s = ctx.state.data;
    const live = lv(ctx);
    const rows = s.discs.map((id) => ({ id, disc: DISCS[id], zone: DISCS[id].zone }));
    const resistant = rows.filter((row) => classify(row.zone, row.disc) === "R").map((row) => row.id);
    return {
      headline: !live.incubated
        ? "The plate was not incubated, so no zones could be read."
        : rows.length
          ? `Zones measured; resistant to ${resistant.length ? resistant.join(", ") : "nothing tested"}.`
          : "No antibiotic discs were placed.",
      observations: [
        { label: "Lawn", expected: "confluent", actual: s.lawn ? "confluent" : "none", pass: s.lawn },
        { label: "Discs", expected: "≥3", actual: s.discs.length, pass: s.discs.length >= 3 },
        { label: "Incubation", expected: "16–18 h at 37 °C", actual: live.incubated ? "done" : "not done", pass: live.incubated },
        ...rows.map((row) => ({
          label: row.disc.label,
          expected: "S / I / R",
          actual: `${row.zone} mm · ${classify(row.zone, row.disc)}`,
          pass: true,
        })),
        { label: "Interpretation", expected: "reported", actual: rows.length ? `${rows.length} discs classified` : "none", pass: rows.length > 0 },
      ],
      series: [{ label: "Zone (mm)", color: "#2ee6c5", points: rows.map((row, index) => ({ x: index + 1, y: row.zone })) }],
      xLabel: "Antibiotic",
      yLabel: "Zone (mm)",
      sections: [
        {
          title: "Interpretation",
          html: `<table class="ho-table"><thead><tr><th>Antibiotic</th><th>Zone</th><th>Call</th></tr></thead><tbody>${rows
            .map((row) => `<tr><td>${row.disc.label}</td><td>${row.zone} mm</td><td>${classify(row.zone, row.disc)}</td></tr>`)
            .join("")}</tbody></table>`,
        },
      ],
    };
  },

  onReset(ctx) {
    ctx.helpers.live = { incubated: false, measured: [], alerted: {} };
  },
};

export function mount(root, experiment, options = {}) {
  return mountHandsOn(root, experiment, spec, options);
}

export default mount;
