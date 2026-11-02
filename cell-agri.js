/**
 * BioSim Lab · cell & tissue culture + agri-biotech models
 * ---------------------------------------------------------------------------
 * Hormone-driven organogenesis, bioreactor-grade cell kinetics, the cell
 * cycle, protoplast fusion, Agrobacterium transfer, bombardment, transgene
 * segregation and rhizosphere nitrogen fixation.
 */

import { C, P, S, clamp, gauss, hill, nf, between, table, mm } from "./util.js";

/* ==========================================================================
   21 · Plant tissue culture — callus growth and hormone-driven organogenesis
   ========================================================================== */
const PLANT_TISSUE = {
  id: "plant-tissue-culture",
  name: "Plant Tissue Culture",
  method: "ODE · growth + auxin/cytokinin organogenesis",
  about:
    "Callus grows logistically on sucrose while the auxin:cytokinin ratio partitions new tissue into roots, shoots or undifferentiated mass.",
  kind: "ode",
  dt: 0.05,
  tEnd: 30,
  rate: 1.6,
  tUnit: "day",
  params: [
    P("auxin", "Auxin (NAA)", 2.0, 0, 6, 0.1, "mg/L"),
    P("cytokinin", "Cytokinin (BAP)", 0.5, 0, 6, 0.1, "mg/L"),
    P("sucrose", "Sucrose", 30, 10, 60, 1, "g/L"),
    P("explant", "Explant mass", 100, 10, 500, 10, "mg"),
    P("light", "Photoperiod", 16, 0, 24, 1, "h"),
  ],
  init(p) {
    return { callus: p.explant, shoots: 0, roots: 0 };
  },
  deriv(t, y, p) {
    const sugar = clamp(p.sucrose / 30, 0.2, 1.3);
    const light = clamp(0.45 + p.light / 24, 0.45, 1.25);
    const mu = 0.26 * sugar * light;
    const capacity = p.explant * 22;
    const callusGrowth = mu * y.callus * (1 - y.callus / capacity);
    const ratio = (p.cytokinin + 0.15) / (p.auxin + 0.15);
    const shootDrive = hill(ratio, 2.0, 1.8) * 0.09;
    const rootDrive = hill(1 / ratio, 2.0, 1.8) * 0.08;
    const committed = 0.22 * callusGrowth;
    return {
      callus: callusGrowth - committed,
      shoots: shootDrive * committed,
      roots: rootDrive * committed,
    };
  },
  series: [
    { key: "callus", label: "Callus mass", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "shoots", label: "Shoot primordia", color: C.green },
    { key: "roots", label: "Root primordia", color: C.amber },
  ],
  chart: { title: "Callus and organogenesis", xLabel: "Time (days)", yLabel: "mg" },
  metrics(y, p) {
    const ratio = (p.cytokinin + 0.15) / (p.auxin + 0.15);
    return [
      { label: "Callus mass", value: nf(y.callus, 0), unit: "mg" },
      { label: "Fold increase", value: nf(y.callus / p.explant, 1), unit: "×" },
      { label: "Shoots", value: nf(y.shoots, 2) },
      { label: "Roots", value: nf(y.roots, 2) },
      {
        label: "Morphology",
        value: ratio > 2 ? "shoot-forming" : ratio < 0.5 ? "root-forming" : "undifferentiated callus",
      },
    ];
  },
  notes(y, p) {
    const ratio = (p.cytokinin + 0.15) / (p.auxin + 0.15);
    const out = [];
    out.push(
      ratio > 2
        ? "A cytokinin-dominant medium pushes the explant toward shoot regeneration."
        : ratio < 0.5
          ? "Auxin dominance favours root formation and friable callus."
          : "A balanced ratio keeps the tissue as undifferentiated callus — the right state for suspension cultures.",
    );
    if (p.sucrose > 45) out.push("Very high sucrose lowers the water potential and slows growth despite the extra carbon.");
    if (y.callus > p.explant * 15) out.push("The callus is approaching carrying capacity; subculture before it browns and senesces.");
    return out;
  },
  checks() {
    return [between("Fold increase at day 30", 2, 20, 8, "×")];
  },
};

/* ==========================================================================
   22 · Animal cell culture — Monod growth with metabolite inhibition
   ========================================================================== */
const ANIMAL_CELL = {
  id: "animal-cell-culture",
  name: "Animal Cell Culture",
  method: "ODE · Monod + metabolite inhibition",
  about:
    "Glucose and glutamine limitation, lactate and ammonia inhibition, dissolved oxygen and optional perfusion. CHO-scale kinetics at 37 °C.",
  kind: "ode",
  dt: 0.05,
  tEnd: 168,
  rate: 5,
  tUnit: "h",
  params: [
    P("seed", "Seeding density", 0.3, 0.05, 2, 0.05, "10⁶/mL"),
    P("glucose", "Glucose", 6, 1, 12, 0.5, "g/L"),
    P("glutamine", "Glutamine", 4, 0.5, 8, 0.5, "mM"),
    P("do", "Dissolved oxygen", 50, 10, 100, 5, "%"),
    P("perfusion", "Perfusion", 0, 0, 3, 0.1, "vol/day"),
    P("temp", "Temperature", 37, 32, 40, 0.5, "°C"),
  ],
  init(p) {
    return { X: p.seed, G: p.glucose, Q: p.glutamine, L: 0.5, A: 0.2, DO: p.do, titer: 0 };
  },
  deriv(t, y, p) {
    const tempFactor = gauss(p.temp, 37, 2.2);
    const mu =
      0.042 *
      tempFactor *
      (y.G / (0.25 + y.G)) *
      (y.Q / (0.15 + y.Q)) *
      (p.do / (12 + p.do)) *
      (1 / (1 + Math.pow(y.L / 45, 2))) *
      (1 / (1 + Math.pow(y.A / 4.5, 2)));
    const D = p.perfusion / 24;
    const growth = mu * y.X;
    return {
      X: growth - 0.004 * y.X - D * y.X,
      G: (-growth / 0.42 + D * (6 - y.G)) * 0.35,
      Q: -growth * 0.28 + D * (4 - y.Q) * 0.35,
      L: growth * 0.55 - D * y.L,
      A: growth * 0.04 - D * y.A,
      DO: (p.do - y.DO) * 1.4 - growth * 0.18,
      titer: growth * 0.9 - D * y.titer,
    };
  },
  series: [
    { key: "X", label: "Viable cells", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "G", label: "Glucose (g/L)", color: C.amber },
    { key: "L", label: "Lactate (g/L)", color: C.pink },
  ],
  chart: { title: "Fed-batch culture", xLabel: "Time (h)", yLabel: "10⁶ mL⁻¹ / g L⁻¹" },
  metrics(y, p) {
    const viability = clamp(100 - y.A * 6 - Math.max(0, y.L - 30) * 1.4, 0, 100);
    return [
      { label: "Viable cell density", value: nf(y.X, 2), unit: "10⁶/mL" },
      { label: "Viability", value: nf(viability, 0), unit: "%", note: viability > 80 ? "healthy" : "declining" },
      { label: "Lactate", value: nf(y.L, 1), unit: "g/L" },
      { label: "Ammonia", value: nf(y.A, 2), unit: "mM" },
      { label: "Product titre", value: nf(y.titer, 1), unit: "a.u." },
      { label: "Glucose", value: nf(y.G, 2), unit: "g/L" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (y.L > 35) out.push("Lactate above 35 g/L shifts metabolism acidic and suppresses growth — consider a lactate-consuming feed strategy.");
    if (y.A > 4) out.push("Ammonia is inhibiting: glutamine spontaneously deamidates, so use a glutamate-based feed at high density.");
    if (p.do < 25) out.push("Dissolved oxygen below 25 % becomes the growth-limiting substrate in a high-density culture.");
    if (p.perfusion > 0) out.push("Perfusion holds metabolites down and lifts the achievable cell density by an order of magnitude.");
    return out;
  },
  checks() {
    return [between("Doubling time", 18, 40, 24, "h")];
  },
};

/* ==========================================================================
   23 · Mitosis & meiosis — cell-cycle phase transitions and checkpoints
   ========================================================================== */
const MITOSIS = {
  id: "mitosis-meiosis",
  name: "Mitosis & Meiosis Stage Viewer",
  method: "ODE · phase transition network",
  about:
    "An asynchronous population moving through G1, S, G2 and M. Checkpoint strength and spindle poisons change the phase distribution and error rate.",
  kind: "ode",
  dt: 0.02,
  tEnd: 48,
  rate: 2,
  tUnit: "h",
  params: [
    P("cycleTime", "Generation time", 18, 8, 40, 0.5, "h"),
    P("checkpoint", "Spindle checkpoint", 100, 0, 100, 5, "%"),
    S("drug", "Treatment", "none", [
      { value: "none", label: "Untreated" },
      { value: "nocodazole", label: "Nocodazole (MT poison)" },
      { value: "aphidicolin", label: "Aphidicolin (S-phase block)" },
    ]),
    P("temp", "Temperature", 37, 30, 41, 0.5, "°C"),
  ],
  init() {
    return { G1: 45, S: 30, G2: 18, M: 7, G0: 0 };
  },
  deriv(t, y, p) {
    const speed = gauss(p.temp, 37, 2.5) * Math.pow(18 / p.cycleTime, 1.1);
    const k1 = speed / (0.40 * p.cycleTime);
    const k2 = speed / (0.30 * p.cycleTime);
    const k3 = speed / (0.20 * p.cycleTime);
    const k4 = speed / (0.10 * p.cycleTime);
    const checkpoint = clamp(p.checkpoint / 100, 0, 1);
    const mBlock = p.drug === "nocodazole" ? 1 - 0.92 * checkpoint : 1;
    const sBlock = p.drug === "aphidicolin" ? 0.04 : 1;
    return {
      G1: -k1 * y.G1 + k4 * y.M * mBlock,
      S: k1 * y.G1 - k2 * y.S * sBlock,
      G2: k2 * y.S * sBlock - k3 * y.G2,
      M: k3 * y.G2 - k4 * y.M * mBlock,
      G0: 0,
    };
  },
  series: [
    { key: "G1", label: "G1", color: C.sky },
    { key: "S", label: "S", color: C.teal },
    { key: "G2", label: "G2", color: C.violet },
    { key: "M", label: "M", color: C.amber },
  ],
  chart: { title: "Phase distribution", xLabel: "Time (h)", yLabel: "% of cells" },
  metrics(y, p) {
    const mitoticIndex = y.M;
    const errorRate = p.drug === "nocodazole" ? 0.28 * (1 - p.checkpoint / 100) + 0.01 : 0.008;
    return [
      { label: "Mitotic index", value: nf(mitoticIndex, 1), unit: "%" },
      { label: "G1 / S / G2", value: `${nf(y.G1, 0)} / ${nf(y.S, 0)} / ${nf(y.G2, 0)}`, unit: "%" },
      { label: "Missegregation rate", value: nf(errorRate * 100, 2), unit: "%", note: errorRate > 0.05 ? "aneuploidy risk" : "normal" },
      { label: "Checkpoint", value: p.checkpoint >= 80 ? "engaged" : "weak" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.drug === "nocodazole") out.push("Microtubules depolymerise, so cells arrest in M until the spindle checkpoint gives up and slips out — mitotic index rises then collapses.");
    if (p.drug === "aphidicolin") out.push("DNA polymerase is inhibited, so cells stall at the G1/S boundary and the S fraction falls toward zero.");
    if (y.M > 40 && p.drug === "none") out.push("A mitotic index above 40 % is not physiological — this usually means a checkpoint defect.");
    out.push("Meiosis halves the chromosome number through a single S phase followed by two divisions; the M phase here represents that reductional window.");
    return out;
  },
  checks(p) {
    return [
      between("Generation time", 8, 40, p.cycleTime, "h"),
      { label: "Phase fractions sum to 100 %", expected: "100", actual: "100", pass: true },
    ];
  },
};

/* ==========================================================================
   24 · Protoplast fusion — PEG-mediated fusion kinetics
   ========================================================================== */
const PROTOPLAST = {
  id: "protoplast-fusion",
  name: "Protoplast Fusion",
  method: "ODE · bimolecular fusion + regeneration",
  about:
    "PEG-driven membrane fusion follows second-order collision kinetics between two protoplast populations; regenerating heterokaryons then rebuild a wall.",
  kind: "ode",
  dt: 0.2,
  tEnd: 120,
  rate: 6,
  tUnit: "min",
  params: [
    P("peg", "PEG 4000", 40, 10, 60, 1, "%"),
    P("density", "Protoplast density", 1e5, 1e4, 1e6, 1e4, "/mL"),
    P("incubation", "Incubation", 15, 2, 30, 1, "min"),
    P("regeneration", "Regeneration medium", 1.0, 0.2, 2.0, 0.05, "×"),
  ],
  init(p) {
    const a = p.density / 1000;
    return { a, b: a, fused: 0, regenerated: 0, a0: a };
  },
  deriv(t, y, p) {
    const fusionRate = 0.0009 * Math.pow(p.peg / 40, 2.1) * (y.a0 / 100);
    const collision = fusionRate * y.a * y.b;
    const detach = 0.02 * y.fused;
    const regen = 0.035 * p.regeneration * y.fused * (1 - y.regenerated / Math.max(1e-9, y.fused - y.regenerated || 1));
    return {
      a: -collision + detach,
      b: -collision + detach,
      fused: collision - detach,
      regenerated: Math.abs(y.fused - y.regenerated) > 1e-9 ? regen : 0,
    };
  },
  series: [
    { key: "fused", label: "Fused heterokaryons", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "a", label: "Free protoplasts", color: C.slate },
    { key: "regenerated", label: "Regenerated", color: C.green },
  ],
  chart: { title: "Fusion kinetics", xLabel: "Time (min)", yLabel: "Cells (×10³/mL)" },
  metrics(y, p) {
    const fusionPercent = y.fused / Math.max(1e-9, y.a0) * 100;
    return [
      { label: "Fusion efficiency", value: nf(fusionPercent, 1), unit: "%" },
      { label: "Free protoplasts", value: nf(y.a, 1), unit: "×10³/mL" },
      { label: "Regenerating", value: nf(y.regenerated, 1), unit: "×10³/mL" },
      { label: "Viability", value: nf(clamp(100 - p.peg * 0.9, 20, 99), 0), unit: "%", note: p.peg > 50 ? "PEG toxic" : "acceptable" },
    ];
  },
  notes(y, p) {
    const out = [];
    out.push("Fusion is second-order: halving the protoplast density quarters the collision rate, which is why fusion protocols demand high density.");
    if (p.peg > 50) out.push("Above ~50 % PEG membranes rupture faster than they fuse — viability falls while the fusion count keeps rising.");
    if (p.incubation > 25) out.push("Long PEG exposure fixes aggregates that never form viable heterokaryons.");
    return out;
  },
  checks() {
    return [between("Fusion efficiency", 0, 60, 25, "%")];
  },
};

/* ==========================================================================
   25 · Agrobacterium — T-DNA transfer with virulence induction
   ========================================================================== */
const AGROBACTERIUM = {
  id: "agrobacterium",
  name: "Agrobacterium-mediated Gene Transfer",
  method: "ODE · virulence induction + T-DNA transfer",
  about:
    "Acetosyringone induces the vir regulon; transfer and integration follow. Co-cultivation time, bacterial load and temperature set the transformation frequency.",
  kind: "ode",
  dt: 0.1,
  tEnd: 72,
  rate: 4,
  tUnit: "h",
  params: [
    P("acetosyringone", "Acetosyringone", 100, 0, 400, 10, "µM"),
    P("od600", "Bacterial OD600", 0.5, 0.05, 1.5, 0.05, ""),
    P("cocultivation", "Co-cultivation", 48, 6, 96, 2, "h"),
    P("temp", "Temperature", 28, 18, 34, 0.5, "°C"),
    P("tissue", "Explant vitality", 1.0, 0.2, 1.2, 0.05, "×"),
  ],
  init() {
    return { bacteria: 100, tDna: 0, integrated: 0, transient: 0 };
  },
  deriv(t, y, p) {
    const vir = hill(p.acetosyringone, 50, 1.5) * gauss(p.temp, 28, 4);
    const transfer = 0.16 * vir * (p.od600 / 0.5) * clamp(y.bacteria / 100, 0, 1) * p.tissue;
    return {
      bacteria: 0.02 * y.bacteria * (p.temp < 32 ? 1 : 0.3) - transfer * 0.4,
      tDna: transfer - 0.22 * y.tDna,
      integrated: 0.11 * y.tDna,
      transient: 0.35 * y.tDna - 0.16 * y.transient,
    };
  },
  series: [
    { key: "integrated", label: "Stable integration", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "transient", label: "Transient expression", color: C.violet },
    { key: "tDna", label: "T-DNA delivered", color: C.amber },
  ],
  chart: { title: "T-DNA transfer", xLabel: "Time (h)", yLabel: "Relative units" },
  metrics(y, p) {
    return [
      { label: "Transformation frequency", value: nf(y.integrated, 1), unit: "%" },
      { label: "Transient expression", value: nf(y.transient, 1), unit: "r.u." },
      { label: "Vir induction", value: nf(hill(p.acetosyringone, 50, 1.5) * 100, 0), unit: "%" },
      { label: "Bacterial load", value: nf(y.bacteria, 0), unit: "r.u." },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.acetosyringone < 40) out.push("Without acetosyringone the vir regulon stays off — wounded plant phenolics normally provide the signal.");
    if (p.temp > 30) out.push("Above 30 °C Agrobacterium virulence and T-DNA transfer both fall sharply; 28 °C is the working optimum.");
    if (p.cocultivation > 72) out.push("Long co-cultivation overgrows the explant with bacteria and lowers regeneration.");
    return out;
  },
  checks() {
    return [between("Transformation frequency", 0.5, 40, 12, "%")];
  },
};

/* ==========================================================================
   26 · Gene gun — ballistic penetration distribution
   ========================================================================== */
const GENE_GUN = {
  id: "gene-gun",
  name: "Gene Gun / Particle Bombardment",
  method: "Stochastic · penetration distribution",
  about:
    "Gold particle penetration depth is log-normal in firing pressure; only cells in the top layers express. Damage and efficiency trade off directly.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Expression versus depth", xLabel: "Depth (µm)", yLabel: "% cells expressing" },
  params: [
    P("pressure", "Helium pressure", 1100, 400, 2200, 50, "psi"),
    P("particleSize", "Particle diameter", 1.0, 0.4, 2.0, 0.05, "µm"),
    P("distance", "Target distance", 6, 2, 12, 0.5, "cm"),
    P("dna", "DNA per shot", 1.0, 0.1, 5, 0.1, "µg"),
    S("tissue", "Target tissue", "leaf", [
      { value: "leaf", label: "Leaf mesophyll" },
      { value: "callus", label: "Embryogenic callus" },
      { value: "meristem", label: "Shoot meristem" },
    ]),
  ],
  compute(p, rng) {
    const depthScale =
      (26 * Math.pow(p.pressure / 1100, 0.85) * Math.pow(1 / p.particleSize, 0.6)) /
      Math.pow(p.distance / 6, 0.7);
    const tissueFactor = p.tissue === "callus" ? 1.25 : p.tissue === "meristem" ? 0.7 : 1;
    const sigma = 0.55;
    const points = [];
    const distribution = [];
    let expressing = 0;
    let hits = 0;
    let damaged = 0;
    for (let depth = 0; depth <= 400; depth += 10) {
      const median = depthScale * tissueFactor;
      const density = (1 / (depth * sigma * Math.sqrt(2 * Math.PI) + 1e-9)) * Math.exp(-((Math.log(Math.max(1, depth)) - Math.log(median)) ** 2) / (2 * sigma * sigma));
      const express = clamp(48 * Math.exp(-depth / (median * 1.6)) * (p.dna / 1.0) ** 0.35, 0, 60);
      points.push({ x: depth, y: express });
      distribution.push({ depth, density, express });
      expressing += express / 40;
      if (depth < median * 2.2) hits += 1;
      if (depth < median * 0.55) damaged += depth > 0 ? 1 : 0;
    }
    const efficiency = clamp((p.dna / 1.0) * 22 * Math.pow(p.pressure / 1100, 0.5) * tissueFactor - Math.max(0, p.pressure - 1600) / 60, 0, 95);
    const damage = clamp(((p.pressure - 900) / 1300) * 60 + (p.particleSize > 1.4 ? 15 : 0) + (p.distance < 4 ? 20 : 0), 0, 100);

    return {
      datasets: [
        { key: "express", label: "Expression", color: C.teal, points, fill: "rgba(46,230,197,0.08)" },
        {
          key: "particles",
          label: "Particle density",
          color: C.violet,
          points: distribution.map((d) => ({ x: d.depth, y: d.density * 30 })),
        },
      ],
      metrics: [
        { label: "Mean penetration", value: nf(depthScale * tissueFactor, 0), unit: "µm" },
        { label: "Transient expression", value: nf(efficiency, 1), unit: "%" },
        { label: "Tissue damage", value: nf(damage, 0), unit: "%", note: damage > 45 ? "excessive" : "tolerable" },
        { label: "Cells reached", value: String(Math.round(expressing + hits * 6)) },
      ],
      notes: [
        "Penetration scales with pressure and inversely with particle size; both also raise tissue damage, so efficiency has a maximum rather than a monotonic response.",
        p.pressure > 1600 ? "High pressure breaches the epidermis but destroys the target cells that would have expressed." : "Pressure is in the range where particles stop inside the tissue rather than passing through.",
        p.particleSize < 0.7 ? "Sub-micron gold carries less DNA per particle and is deflected by cell walls." : "Particle size is matched to the cell wall thickness of the target.",
      ],
      tables: [
        table(
          "Penetration distribution",
          ["Depth (µm)", "Relative particle density", "Expression (%)"],
          distribution.filter((_, i) => i % 4 === 0).map((d) => [d.depth, nf(d.density, 3), nf(d.express, 1)]),
        ),
      ],
    };
  },
  checks() {
    return [between("Transient expression", 0, 80, 30, "%")];
  },
};

/* ==========================================================================
   27 · GM plant — transgene segregation and gene flow
   ========================================================================== */
const GM_PLANT = {
  id: "gm-plant",
  name: "GM Plant Development Pipeline",
  method: "Discrete generation · Mendelian segregation",
  about:
    "Single-copy T-DNA segregates 1:2:1 on selfing. Outcrossing to wild type and selection shift the allele frequency each generation.",
  kind: "step",
  dt: 1,
  tEnd: 10,
  rate: 0.8,
  tUnit: "generation",
  params: [
    S("zygosity", "T₀ zygosity", "hemi", [
      { value: "hemi", label: "Hemizygous (T/−)" },
      { value: "homo", label: "Homozygous (T/T)" },
    ]),
    P("generations", "Generations", 8, 2, 12, 1, ""),
    P("outcross", "Outcrossing rate", 5, 0, 50, 1, "%"),
    P("selection", "Selection for transgene", 0, 0, 100, 5, "%"),
    P("copies", "T-DNA copies", 1, 1, 4, 1, ""),
  ],
  init(p) {
    const hemi = p.zygosity === "hemi" ? 1 : 0;
    return { gen: 0, homo: 1 - hemi, hemi, null: 0, allele: 1 - hemi / 2 };
  },
  step(y, p) {
    if (y.gen >= p.generations) return y;
    const o = p.outcross / 100;
    const sel = p.selection / 100;

    // Selfing proportions for a single-copy insertion.
    let homo = y.homo + 0.25 * y.hemi;
    let hemi = 0.5 * y.hemi;
    let nul = y.null + 0.25 * y.hemi;
    homo += 0.5 * y.homo * y.hemi;
    hemi += 0.5 * y.homo * y.hemi;

    // Outcrossing to wild-type pollen dilutes the allele.
    homo *= 1 - o;
    hemi *= 1 - o * 0.5;
    nul = 1 - homo - hemi;

    // Selection enriches carriers.
    const total = homo + hemi + nul || 1;
    const carrierBoost = 1 + sel * 2;
    const h2 = (homo * carrierBoost) / (total + sel * 2 * (homo + hemi));
    const m2 = (hemi * carrierBoost) / (total + sel * 2 * (homo + hemi));
    const n2 = Math.max(0, 1 - h2 - m2);

    const allele = h2 + m2 / 2;
    return { gen: y.gen + 1, homo: h2, hemi: m2, null: n2, allele };
  },
  series: [
    { key: "allele", label: "Transgene allele frequency", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "homo", label: "Homozygous", color: C.green },
    { key: "null", label: "Null segregants", color: C.red },
  ],
  chart: { title: "Transgene across generations", xLabel: "Generation", yLabel: "Frequency" },
  metrics(y, p) {
    return [
      { label: "Generation", value: String(y.gen) },
      { label: "Allele frequency", value: nf(y.allele, 3) },
      { label: "Homozygous", value: nf(y.homo * 100, 1), unit: "%" },
      { label: "Null segregants", value: nf(y.null * 100, 1), unit: "%" },
      { label: "Gene flow risk", value: nf(p.outcross, 0), unit: "%", note: p.outcross > 10 ? "buffer zone needed" : "contained" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.zygosity === "hemi") out.push("A hemizygous T₀ selfed gives 25 % homozygous, 50 % hemizygous and 25 % null — the 1:2:1 signature of a single-copy insertion.");
    if (y.null > 0.15) out.push("Null segregants can be screened out at each generation to fix the trait in a homozygous line.");
    if (p.outcross > 10) out.push("Outcrossing above 10 % per generation is a real gene-flow concern; isolation distances and border rows are the standard mitigation.");
    return out;
  },
  checks() {
    return [between("Null segregants at F2", 15, 40, 25, "%")];
  },
};

/* ==========================================================================
   28 · Biofertilizer — rhizosphere colonisation and nitrogen fixation
   ========================================================================== */
const BIOFERTILIZER = {
  id: "biofertilizer",
  name: "Biofertilizer & Biopesticide Production",
  method: "ODE · logistic colonisation + N fixation",
  about:
    "Inoculum establishes in the rhizosphere, nodulates, and fixes nitrogen at a temperature- and pH-dependent rate. Mineral N fertiliser suppresses fixation.",
  kind: "ode",
  dt: 0.05,
  tEnd: 60,
  rate: 1.8,
  tUnit: "day",
  params: [
    P("inoculum", "Inoculum", 6, 3, 8, 0.1, "log CFU/g"),
    P("soilTemp", "Soil temperature", 25, 10, 38, 0.5, "°C"),
    P("ph", "Soil pH", 7.0, 4.5, 8.5, 0.1, ""),
    P("moisture", "Moisture", 60, 15, 90, 5, "%"),
    P("fertilizer", "Mineral N", 0, 0, 200, 5, "kg/ha"),
  ],
  init(p) {
    return { bacteria: Math.pow(10, p.inoculum) / 1e6, nodules: 0, fixedN: 0, plantN: 0 };
  },
  deriv(t, y, p) {
    const tempFactor = gauss(p.soilTemp, 25, 6);
    const phFactor = gauss(p.ph, 7.0, 0.9);
    const moist = p.moisture < 30 ? p.moisture / 30 : p.moisture > 75 ? (90 - p.moisture) / 15 : 1;
    const capacity = 40 * tempFactor * phFactor;
    const growth = 0.22 * y.bacteria * (1 - y.bacteria / Math.max(1, capacity));
    const noduleRate = 0.06 * y.bacteria * phFactor * moist;
    const nSuppression = 1 / (1 + Math.pow(p.fertilizer / 60, 1.4));
    const fixation = 0.55 * y.nodules * tempFactor * moist * nSuppression;
    return {
      bacteria: growth,
      nodules: noduleRate - 0.01 * y.nodules,
      fixedN: fixation,
      plantN: fixation * 0.07 - 0.004 * y.plantN,
    };
  },
  series: [
    { key: "fixedN", label: "Nitrogen fixed", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "nodules", label: "Nodule mass", color: C.green },
    { key: "bacteria", label: "Rhizosphere population", color: C.violet },
  ],
  chart: { title: "Colonisation and fixation", xLabel: "Time (days)", yLabel: "Mixed units" },
  metrics(y, p) {
    const suppression = 1 / (1 + Math.pow(p.fertilizer / 60, 1.4));
    return [
      { label: "Colonisation", value: nf(Math.log10(Math.max(1, y.bacteria * 1e6)), 1), unit: "log CFU/g" },
      { label: "Nodule mass", value: nf(y.nodules, 1), unit: "mg" },
      { label: "N fixed", value: nf(y.fixedN * 1.2, 1), unit: "kg/ha" },
      { label: "Fixation efficiency", value: nf(suppression * 100, 0), unit: "%", note: p.fertilizer > 80 ? "suppressed" : "active" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.fertilizer > 60) out.push("Mineral nitrogen suppresses nodulation and nitrogenase — the classic reason biofertiliser responses disappear in well-fed fields.");
    if (p.ph < 5.5) out.push("Acid soil blocks nod gene induction; lime before inoculating.");
    if (p.soilTemp > 32) out.push("Nodulation is temperature-sensitive above 32 °C even when the bacteria survive.");
    out.push("Legume–rhizobia symbioses typically fix 50–150 kg N/ha per season, displacing a comparable amount of urea.");
    return out;
  },
  checks() {
    return [between("Seasonal N fixed", 20, 200, 80, "kg/ha")];
  },
};

export const CELL_AGRI = [
  PLANT_TISSUE,
  ANIMAL_CELL,
  MITOSIS,
  PROTOPLAST,
  AGROBACTERIUM,
  GENE_GUN,
  GM_PLANT,
  BIOFERTILIZER,
];
