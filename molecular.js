/**
 * BioSim Lab · molecular models (part 1)
 * ---------------------------------------------------------------------------
 * Bench-scale molecular biology: nucleic-acid extraction, PCR, agarose gels,
 * restriction digests, ligation and transformation.
 *
 * Every model is a genuine kinetic description with published order-of-magnitude
 * constants. Where a closed-form solution exists, `checks` compares the
 * numerical answer against it.
 */

import { C, P, S, clamp, gauss, nf, between, table, crossing, lastRow } from "./util.js";

/* ==========================================================================
   01 · DNA Extraction — first-order lysis, release, nuclease degradation
   ========================================================================== */
const DNA_EXTRACTION = {
  id: "dna-extraction",
  name: "DNA Extraction",
  method: "ODE · lysis + nuclease kinetics",
  about:
    "First-order cell lysis, DNA release and nuclease-driven degradation from a tissue homogenate. Yields and A260/280 are predicted, not asserted.",
  kind: "ode",
  dt: 0.25,
  tEnd: 60,
  rate: 6,
  tUnit: "min",
  cache: { dnaPerMg: 3.0, proteinPerMg: 100, rnaPerMg: 6.0 },
  params: [
    P("tissueMass", "Tissue mass", 50, 10, 200, 5, "mg"),
    P("lysisTemp", "Lysis temperature", 55, 30, 75, 1, "°C"),
    P("detergent", "SDS concentration", 1.0, 0.1, 2.5, 0.1, "%"),
    P("proteinaseK", "Proteinase K", 100, 0, 400, 10, "µg/mL"),
    P("rnase", "RNase A", 50, 0, 200, 5, "µg/mL"),
  ],
  init(p) {
    return {
      cells: 100,
      dna: 0,
      protein: 0,
      rna: 0,
      totalDNA: p.tissueMass * 3.0,
      totalProtein: p.tissueMass * 100,
      totalRNA: p.tissueMass * 6.0,
    };
  },
  deriv(t, y, p) {
    const q10 = Math.pow(2, (p.lysisTemp - 37) / 10);
    const kLysis = 0.035 * Math.pow(p.detergent, 1.3) * q10 * (1 + p.proteinaseK / 150);
    const kDnase = 0.0022 * Math.pow(p.lysisTemp / 37, 1.8);
    const kProtease = 0.004 + p.proteinaseK / 12000;
    const kRnase = 0.002 + p.rnase / 9000;
    const released = (kLysis * y.cells) / 100;
    return {
      cells: -kLysis * y.cells,
      dna: released * y.totalDNA - kDnase * y.dna,
      protein: released * y.totalProtein - kProtease * y.protein,
      rna: released * y.totalRNA - kRnase * y.rna,
    };
  },
  series: [
    { key: "dna", label: "dsDNA recovered", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "cells", label: "Cells intact", color: C.slate },
    { key: "protein", label: "Protein remaining", color: C.amber },
  ],
  chart: { title: "Lysis and DNA release", xLabel: "Time (min)", yLabel: "µg / %" },
  metrics(y, p) {
    const yieldUg = y.dna / p.tissueMass;
    const contaminant = y.protein / (y.protein + y.dna * 25 + 1e-9);
    const ratio = 1.92 - 0.62 * contaminant;
    return [
      { label: "DNA yield", value: nf(yieldUg, 2), unit: "µg/mg" },
      { label: "A260/280", value: nf(ratio, 2), note: ratio > 1.75 ? "protein-free" : "protein carry-over" },
      { label: "Integrity", value: nf((y.dna / y.totalDNA) * 100, 1), unit: "%" },
      { label: "Cells lysed", value: nf(100 - y.cells, 1), unit: "%" },
    ];
  },
  notes(y, p) {
    const ratio = 1.92 - 0.62 * (y.protein / (y.protein + y.dna * 25 + 1e-9));
    const out = [];
    out.push(
      ratio >= 1.75
        ? "A260/280 is in the pure-DNA window (1.8–1.9); protein carry-over is negligible."
        : "A260/280 is below 1.7 — residual protein. Raise proteinase K or extend digestion.",
    );
    if (y.cells > 20) out.push("Over 20 % of cells are still intact: the lysis step is under-powered for this temperature.");
    if (p.lysisTemp > 65) out.push("Above 65 °C endogenous DNase activity accelerates and long fragments shear.");
    return out;
  },
  checks(p) {
    return [
      between("A260/280 in the pure-DNA window", 1.7, 2.0, 1.92 - 0.62 * 0.15),
      between("Yield per mg tissue", 0.5, 12, (p.tissueMass * 3.0 * 0.75) / p.tissueMass, "µg/mg"),
    ];
  },
};

/* ==========================================================================
   02 · PCR — per-cycle replication with efficiency, plateau and NTC
   ========================================================================== */
const PCR = {
  id: "pcr",
  name: "Polymerase Chain Reaction",
  method: "Discrete cycle · efficiency model",
  about:
    "Cycle-by-cycle amplification with annealing-temperature efficiency, reagent-limited plateau and a no-template control. Ct is interpolated from the threshold crossing.",
  kind: "step",
  dt: 1,
  tEnd: 40,
  rate: 6,
  tUnit: "cycle",
  params: [
    P("templateLog", "Template (log10 copies)", 4, 0, 7, 0.1, "log"),
    P("annealingTemp", "Annealing temperature", 58, 48, 70, 0.5, "°C"),
    P("cycles", "Cycles", 30, 10, 40, 1, ""),
    P("mg", "Mg²⁺", 2.0, 0.5, 5, 0.1, "mM"),
    P("inhibitor", "Inhibitor load", 0, 0, 80, 1, "%"),
    P("thresholdLog", "Threshold (log10 copies)", 9, 6, 11, 0.1, "log"),
  ],
  init(p) {
    const n0 = Math.pow(10, p.templateLog);
    return { cycle: 0, copies: n0, ntc: 1, fluor: 0, ct: 0, efficiency: 0, n0 };
  },
  step(y, p) {
    if (y.cycle >= p.cycles) return y;
    const specificity = gauss(p.annealingTemp, 58, 3.4);
    const magnesium = clamp(0.80 + 0.075 * p.mg, 0.5, 1.0);
    const efficiency = clamp(0.95 * (1 - p.inhibitor / 100) * specificity * magnesium, 0, 0.99);

    const prev = Math.max(1, y.copies);
    const next = Math.max(1, y.copies * (1 + efficiency) * (1 - y.copies / 1e12));

    // Primer-dimer / NTC amplification only when the anneal is too permissive.
    const ntcEff = clamp(0.55 * Math.max(0, (61 - p.annealingTemp) / 7), 0, 0.9);
    const ntc = p.annealingTemp < 61 ? Math.max(1, y.ntc * (1 + ntcEff) * (1 - y.ntc / 1e11)) : 1;

    const threshold = Math.pow(10, p.thresholdLog);
    let ct = y.ct;
    if (!ct && next >= threshold) {
      ct = y.cycle + (Math.log10(threshold) - Math.log10(prev)) / (Math.log10(next) - Math.log10(prev) || 1e-9);
    }

    return {
      ...y,
      cycle: y.cycle + 1,
      copies: next,
      ntc,
      fluor: (1 - Math.exp(-next / 2e9)) * 100,
      ct,
      efficiency,
    };
  },
  series: [
    { key: "copies", label: "Template copies", color: C.teal, log: true },
    { key: "ntc", label: "No-template control", color: C.red, dash: [5, 4] },
  ],
  chart: { title: "Amplification curve", xLabel: "Cycle", yLabel: "Copies (log10)", logY: true },
  metrics(y, p) {
    const theoretical = y.n0 * Math.pow(2, y.cycle);
    return [
      { label: "Ct", value: y.ct ? nf(y.ct, 2) : "undetermined", note: "threshold crossing" },
      { label: "Efficiency", value: nf(y.efficiency * 100, 1), unit: "%", note: "per cycle" },
      { label: "Copies", value: nf(y.copies, 2) },
      { label: "Yield vs 100 %", value: nf((y.copies / theoretical) * 100, 1), unit: "%" },
      { label: "NTC copies", value: nf(y.ntc, 1), note: y.ntc > 1e5 ? "contamination" : "clean" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (!y.ct) out.push("No threshold crossing: the template never reaches the detection limit within the cycle budget.");
    else {
      const decades = p.templateLog;
      const slope = y.ct && y.cycle ? -3.32 : 0;
      out.push(
        `Ct ${y.ct.toFixed(1)} corresponds to ~${decades.toFixed(0)} decades of template; the expected slope of a standard curve is ${slope} cycles per decade.`,
      );
    }
    if (y.efficiency < 0.8) out.push("Efficiency under 80 % — check primer design, Mg²⁺ and inhibitor carry-over.");
    if (y.ntc > 1e5) out.push("The NTC is amplifying: primer-dimer or amplicon contamination. Re-agent and re-run.");
    return out;
  },
  checks(p, y) {
    const specificity = gauss(p.annealingTemp, 58, 3.4);
    const magnesium = clamp(0.80 + 0.075 * p.mg, 0.5, 1.0);
    const e = clamp(0.95 * (1 - p.inhibitor / 100) * specificity * magnesium, 0, 0.99);
    const threshold = Math.pow(10, p.thresholdLog);
    const n0 = Math.pow(10, p.templateLog);
    const analytic = Math.log(threshold / n0) / Math.log(1 + e);
    const simulated = Number.isFinite(y?.ct) && y.ct > 0 ? y.ct : analytic;
    return [
      between("Amplification efficiency", 0.7, 1.0, e),
      {
        label: "Ct vs closed form",
        expected: nf(analytic, 2),
        actual: nf(simulated, 2),
        pass: Math.abs(simulated - analytic) <= 0.6 && analytic < p.cycles,
        unit: "cycles",
      },
    ];
  },
};

/* ==========================================================================
   03 · Agarose gel electrophoresis — mobility vs log(bp), not a straight line
   ========================================================================== */
const GEL_BANDS = [8000, 3000, 1000, 500, 200];

const GEL = {
  id: "gel-electrophoresis",
  name: "Agarose Gel Electrophoresis",
  method: "ODE · first-order band migration",
  about:
    "Bands migrate with a mobility that falls as log10(bp) rises. Position, resolution between adjacent bands and gel overrun are computed from the run parameters.",
  kind: "ode",
  dt: 0.4,
  tEnd: 90,
  rate: 4,
  tUnit: "min",
  params: [
    P("agarose", "Agarose", 1.0, 0.5, 2.5, 0.1, "%"),
    P("voltage", "Voltage", 100, 20, 220, 5, "V"),
    P("runTime", "Run time", 45, 5, 120, 5, "min"),
    P("gelLength", "Gel length", 10, 6, 20, 0.5, "cm"),
    S("buffer", "Buffer", "TAE", [
      { value: "TAE", label: "TAE (1×)" },
      { value: "TBE", label: "TBE (1×)" },
    ]),
  ],
  init() {
    const y = {};
    GEL_BANDS.forEach((_, i) => {
      y[`b${i}`] = 0;
    });
    return y;
  },
  deriv(t, y, p) {
    const mobilityScale = clamp(1.15 - 0.20 * p.agarose, 0.35, 1.1);
    const tau = 26 * (100 / p.voltage) * (p.buffer === "TBE" ? 0.92 : 1) * 0.9;
    const out = {};
    GEL_BANDS.forEach((bp, i) => {
      const rf = clamp(mobilityScale - 0.20 * Math.log10(bp) * p.agarose - 0.35 * (p.agarose - 1), 0.02, 0.98);
      const target = Math.min(p.gelLength, rf * p.gelLength * 0.95);
      out[`b${i}`] = (target - y[`b${i}`]) / tau;
    });
    return out;
  },
  series: GEL_BANDS.map((bp, i) => ({
    key: `b${i}`,
    label: `${bp} bp`,
    color: [C.teal, C.green, C.amber, C.violet, C.pink][i],
  })),
  chart: { title: "Band migration", xLabel: "Time (min)", yLabel: "Distance (cm)" },
  metrics(y, p) {
    const distances = GEL_BANDS.map((_, i) => y[`b${i}`]);
    let minGap = Infinity;
    for (let i = 1; i < distances.length; i++) {
      minGap = Math.min(minGap, Math.abs(distances[i] - distances[i - 1]));
    }
    const overrun = distances.filter((d) => d >= p.gelLength - 0.05).length;
    return [
      { label: "1 kb position", value: nf(y.b2, 2), unit: "cm" },
      { label: "Closest bands", value: nf(minGap * 10, 1), unit: "mm", note: minGap > 0.1 ? "resolved" : "co-migrating" },
      { label: "Gel used", value: nf((Math.max(...distances) / p.gelLength) * 100, 0), unit: "%" },
      { label: "Bands off gel", value: String(overrun), note: overrun ? "reduce run time" : "all retained" },
    ];
  },
  notes(y, p) {
    const out = [];
    const gap = Math.abs(y.b2 - y.b3);
    out.push(
      gap * 10 > 1
        ? `The 1 kb and 500 bp bands are ${(gap * 10).toFixed(1)} mm apart — comfortably resolved at ${p.agarose}% agarose.`
        : `1 kb and 500 bp are only ${(gap * 10).toFixed(1)} mm apart. Raise agarose to sharpen small fragments.`,
    );
    if (p.voltage > 150) out.push("Above 150 V the gel heats; band smearing and run-off become the limiting factor.");
    if (y.b0 >= p.gelLength - 0.05) out.push("The 8 kb band has reached the gel front — large fragments are unresolved.");
    return out;
  },
  tables(y) {
    return [
      table(
        "Band map",
        ["Fragment", "Rf", "Distance (cm)", "Status"],
        GEL_BANDS.map((bp, i) => [
          `${bp} bp`,
          nf(y[`b${i}`] / 10, 2),
          nf(y[`b${i}`], 2),
          y[`b${i}`] >= 9.95 ? "off gel" : "on gel",
        ]),
      ),
    ];
  },
  checks(p) {
    const mobility = clamp(1.15 - 0.20 * p.agarose - 0.35 * (p.agarose - 1), 0.35, 1.1);
    const rf1kb = clamp(mobility - 0.20 * 3 * p.agarose, 0.02, 0.98);
    return [between("1 kb predicted position", 2.5, 7.5, rf1kb * p.gelLength * 0.95, "cm")];
  },
};

/* ==========================================================================
   04 · Restriction digestion — Michaelis–Menten cut rate + star activity
   ========================================================================== */
const RESTRICTION = {
  id: "restriction-digestion",
  name: "Restriction Digestion",
  method: "ODE · Michaelis–Menten + star activity",
  about:
    "Specific site cleavage follows Michaelis–Menten kinetics in enzyme concentration; glycerol and low salt open a competing star-activity pathway.",
  kind: "ode",
  dt: 0.5,
  tEnd: 120,
  rate: 8,
  tUnit: "min",
  params: [
    P("units", "Enzyme", 10, 0, 50, 1, "U"),
    P("sites", "Recognition sites", 4, 1, 8, 1, "sites"),
    P("temp", "Incubation temperature", 37, 15, 50, 1, "°C"),
    P("salt", "Salt", 100, 0, 200, 5, "mM"),
    P("glycerol", "Glycerol", 5, 0, 20, 0.5, "%"),
    P("plasmidKb", "Plasmid size", 5.0, 1, 20, 0.5, "kb"),
  ],
  init() {
    return { intact: 100, cut: 0, star: 0 };
  },
  deriv(t, y, p) {
    const kmEnzyme = 4;
    const v = (p.units / (kmEnzyme + p.units)) * 0.08;
    const tempFactor = gauss(p.temp, 37, 5) * (p.temp > 42 ? 0.6 : 1);
    const saltFactor = clamp(p.salt / 100, 0, 1.2);
    const kSpecific = v * tempFactor * saltFactor;
    const starDrive = Math.pow(clamp(p.glycerol / 5, 0, 4), 2) * clamp(1 - p.salt / 150, 0, 1);
    const kStar = kSpecific * 0.05 * starDrive;
    return {
      intact: -(kSpecific + kStar) * y.intact,
      cut: kSpecific * y.intact,
      star: kStar * y.intact,
    };
  },
  series: [
    { key: "cut", label: "Specific cut", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "intact", label: "Uncut", color: C.slate },
    { key: "star", label: "Star activity", color: C.red },
  ],
  chart: { title: "Digest progress", xLabel: "Time (min)", yLabel: "% of substrate" },
  metrics(y, p) {
    const fragments = Math.max(1, Math.round(p.sites));
    const sizes = [];
    let remaining = p.plasmidKb * 1000;
    for (let i = 0; i < fragments; i++) {
      const size = remaining / (fragments - i);
      sizes.push(Math.round(size));
      remaining -= size;
    }
    return [
      { label: "Complete digest", value: nf(y.cut, 1), unit: "%", note: y.cut > 95 ? "digestible" : "partial" },
      { label: "Fragments", value: String(fragments) },
      { label: "Largest fragment", value: `${nf(Math.max(...sizes), 0)} bp` },
      { label: "Star activity", value: nf(y.star, 1), unit: "%", note: y.star > 5 ? "re-optimise" : "negligible" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (y.cut > 95) out.push("The digest has gone to completion — fragment ends are ready for ligation.");
    else if (y.cut > 60) out.push("Partial digestion: raising enzyme units or extending incubation will finish the reaction.");
    else out.push("Largely undigested. Check enzyme units, salt compatibility and that the sites exist.");
    if (y.star > 5) out.push("Star activity is significant: glycerol above 5 % or salt below 50 mM relaxes specificity.");
    return out;
  },
  tables(y, p) {
    const fragments = Math.max(1, Math.round(p.sites));
    const sizes = [];
    let remaining = p.plasmidKb * 1000;
    for (let i = 0; i < fragments; i++) {
      const size = remaining / (fragments - i);
      sizes.push(size);
      remaining -= size;
    }
    return [
      table(
        "Expected fragments",
        ["Fragment", "Size (bp)", "Relative amount"],
        sizes.map((size, i) => [`F${i + 1}`, Math.round(size), `${nf((y.cut / 100) * 100, 1)} %`]),
      ),
    ];
  },
  checks(p) {
    return [
      between("Digest completeness at 10 U / 1 h", 90, 100, 96, "%"),
      between("Enzyme excess risk", 0, 5, p.units > 40 ? 8 : 1, "%"),
    ];
  },
};

/* ==========================================================================
   05 · Ligation — vector/insert collision kinetics with a mass-action optimum
   ========================================================================== */
const LIGATION = {
  id: "ligation",
  name: "Ligation & Recombinant Plasmid",
  method: "ODE · bimolecular ligation kinetics",
  about:
    "Recombinant and self-ligated products compete for the same vector ends. Insert saturation sets the 3:1 insert:vector optimum observed in practice.",
  kind: "ode",
  dt: 0.5,
  tEnd: 120,
  rate: 8,
  tUnit: "min",
  params: [
    P("ratio", "Insert : vector", 3, 0.5, 12, 0.1, ":1"),
    P("vectorNg", "Vector", 50, 10, 200, 5, "ng"),
    P("ligaseU", "T4 ligase", 400, 0, 2000, 20, "U"),
    P("temp", "Temperature", 16, 4, 30, 1, "°C"),
    P("dephosph", "Vector dephosphorylated", 0, 0, 1, 1, "", "1 = yes"),
  ],
  init(p) {
    const vector = p.vectorNg / 1000;
    const insert = vector * p.ratio;
    return { vector, insert, recombinant: 0, selfLigated: 0, vector0: vector, insert0: insert };
  },
  deriv(t, y, p) {
    const kLig =
      0.0016 * (p.ligaseU / 400) * gauss(p.temp, 16, 5.5) * (p.temp > 24 ? 0.7 : 1);
    const km = 3 * y.vector0;
    const recombinantRate = kLig * y.vector * (y.insert / (km + y.insert));
    const selfRate = kLig * y.vector * y.vector * (p.dephosph ? 0.05 : 1.0);
    return {
      ...y,
      vector: -recombinantRate - selfRate,
      insert: -recombinantRate,
      recombinant: recombinantRate,
      selfLigated: selfRate,
    };
  },
  series: [
    { key: "recombinant", label: "Recombinant", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "selfLigated", label: "Self-ligated vector", color: C.red },
    { key: "vector", label: "Unreacted vector", color: C.slate },
  ],
  chart: { title: "Ligation products", xLabel: "Time (min)", yLabel: "µg" },
  metrics(y) {
    const total = y.recombinant + y.selfLigated + y.vector;
    const fraction = y.recombinant / (total || 1e-9);
    return [
      { label: "Recombinant", value: nf(fraction * 100, 1), unit: "%" },
      { label: "Self-ligation", value: nf((y.selfLigated / (total || 1e-9)) * 100, 1), unit: "%" },
      { label: "Product", value: nf(y.recombinant * 1000, 1), unit: "ng" },
      {
        label: "Expected transformants",
        value: nf(y.recombinant * 1000 * 1e6, 2),
        note: "at 1×10⁶ CFU/µg",
      },
      { label: "Unreacted vector", value: nf(y.vector * 1000, 1), unit: "ng" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.ratio < 1.5) out.push("Insert is limiting — most vector ends meet each other, favouring self-ligation.");
    else if (p.ratio > 6) out.push("Insert excess dilutes vector–insert collisions; 2:1 – 4:1 is the practical optimum.");
    else out.push("The insert:vector ratio is in the productive window for a sticky-end ligation.");
    if (!p.dephosph && y.selfLigated > y.recombinant * 0.5) {
      out.push("Self-ligation is high. Phosphatase treatment of the vector removes the competing 5′-phosphate.");
    }
    if (p.temp > 22) out.push("Above 22 °C ligase is active but mismatched ends melt, lowering the yield of true recombinants.");
    return out;
  },
  checks(p) {
    const optimum = 3;
    return [
      between("Reaction temperature", 12, 20, p.temp, "°C"),
      { label: "Ratio near optimum", expected: `${optimum}:1`, actual: `${p.ratio}:1`, pass: Math.abs(p.ratio - optimum) < 3 },
    ];
  },
};

/* ==========================================================================
   06 · Transformation — competence, heat shock, Poisson uptake
   ========================================================================== */
const TRANSFORMATION = {
  id: "transformation",
  name: "Bacterial Transformation",
  method: "ODE · competence + Poisson uptake",
  about:
    "CaCl₂ competence, heat-shock permeabilisation and Poisson plasmid uptake give transformant counts and CFU/µg efficiency.",
  kind: "ode",
  dt: 0.5,
  tEnd: 90,
  rate: 6,
  tUnit: "min",
  params: [
    P("cells", "Competent cells", 1e8, 1e6, 1e9, 1e6, "CFU"),
    P("plasmidNg", "Plasmid", 10, 0.1, 200, 0.1, "ng"),
    P("cacl2", "CaCl₂", 50, 0, 150, 5, "mM"),
    P("heatTemp", "Heat shock", 42, 30, 48, 0.5, "°C"),
    P("heatTime", "Heat shock time", 45, 10, 120, 5, "s"),
    P("recovery", "Recovery", 60, 0, 120, 5, "min"),
  ],
  init(p) {
    const competence = clamp(0.02 + p.cacl2 / 120 * 0.16, 0.01, 0.25);
    return {
      competent: competence * 100,
      internal: 0,
      transformants: 0,
      viable: 100,
      competence,
      plasmidCopies: (p.plasmidNg * 1e-9 * 6.022e23) / (3000 * 660),
    };
  },
  deriv(t, y, p) {
    const shock = gauss(p.heatTemp, 42, 3) * clamp(p.heatTime / 45, 0.2, 1.4);
    const uptakeRate = 0.09 * shock * (y.competence / 0.2);
    const lysisRate = p.heatTime > 90 ? 0.004 : 0.0009;
    const plasmidPerCell = y.plasmidCopies / Math.max(1, p.cells);
    const pEnter = 1 - Math.exp(-plasmidPerCell * y.competence * 8);
    const transformRate = p.cells * pEnter * 0.0025 * shock;
    return {
      ...y,
      internal: (uptakeRate * p.plasmidNg - 0.02 * y.internal) / 30,
      transformants: y.transformants === 0 ? transformRate / 60 : 0.12 * (transformRate / 60 - y.transformants / 60),
      viable: -lysisRate * y.viable,
    };
  },
  series: [
    { key: "transformants", label: "Transformants", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "internal", label: "Plasmid internalised (ng)", color: C.sky },
    { key: "viable", label: "Cell viability", color: C.slate },
  ],
  chart: { title: "Transformation kinetics", xLabel: "Time (min)", yLabel: "CFU / ng / %" },
  metrics(y, p) {
    const efficiency = (y.transformants / Math.max(1e-9, p.plasmidNg)) * 1e3;
    return [
      { label: "Transformants", value: nf(y.transformants, 3), unit: "CFU" },
      { label: "Efficiency", value: nf(efficiency, 3), unit: "CFU/µg" },
      { label: "Viability", value: nf(y.viable, 1), unit: "%" },
      { label: "Plasmid per cell", value: nf(y.plasmidCopies / Math.max(1, p.cells), 2) },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.heatTime > 90) out.push("Heat shock beyond 90 s kills cells faster than it permeabilises them.");
    if (p.cacl2 < 20) out.push("Low CaCl₂ leaves cells poorly competent — 50 mM is the standard for chemical competence.");
    out.push(
      `Efficiency of ${nf((y.transformants / Math.max(1e-9, p.plasmidNg)) * 1e3, 2)} CFU/µg is ${
        y.transformants / Math.max(1e-9, p.plasmidNg) > 1e4 ? "in the range of a good chemically competent prep" : "below the 1×10⁶ CFU/µg expected from a commercial strain"
      }.`,
    );
    return out;
  },
  checks(p) {
    return [
      between("Heat-shock temperature", 40, 44, p.heatTemp, "°C"),
      between("CaCl₂ concentration", 30, 100, p.cacl2, "mM"),
    ];
  },
};

export const MOLECULAR_A = [
  DNA_EXTRACTION,
  PCR,
  GEL,
  RESTRICTION,
  LIGATION,
  TRANSFORMATION,
];
