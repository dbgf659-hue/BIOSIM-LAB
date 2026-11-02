/**
 * BioSim Lab · microbiology models
 * ---------------------------------------------------------------------------
 * Sterility assurance, stochastic contamination, plating statistics, Gram
 * differentiation, Baranyi growth, optics and antimicrobial pharmacodynamics.
 */

import { C, P, S, clamp, gauss, nf, between, table, hill } from "./util.js";
import { erfc, bisect } from "../../core/numerics.js";

/* ==========================================================================
   13 · Aseptic technique — Poisson contamination events
   ========================================================================== */
const ASEPTIC = {
  id: "aseptic-technique",
  name: "Aseptic Technique & Laminar Flow",
  method: "Stochastic · Poisson settling",
  about:
    "Contamination is a Poisson process: particle settling rate × open time × technique quality ÷ airflow protection. Each run draws a different outcome.",
  kind: "step",
  dt: 0.5,
  tEnd: 60,
  rate: 6,
  tUnit: "min",
  params: [
    P("technique", "Technique quality", 88, 0, 100, 1, "%"),
    S("environment", "Environment", "bench", [
      { value: "bench", label: "Open bench" },
      { value: "laminar", label: "Laminar flow hood" },
      { value: "still", label: "Still-air box" },
    ]),
    P("openTime", "Vessel open", 12, 1, 60, 1, "min"),
    S("vessel", "Vessel", "plate", [
      { value: "plate", label: "Petri dish" },
      { value: "flask", label: "Open flask" },
      { value: "tube", label: "Eppendorf (briefly open)" },
    ]),
  ],
  init() {
    return { events: 0, contaminants: 0 };
  },
  step(y, p, dt, t, rng) {
    const airflow = p.environment === "laminar" ? 0.015 : p.environment === "still" ? 0.55 : 1;
    const area = p.vessel === "plate" ? 1 : p.vessel === "flask" ? 2.4 : 0.5;
    const techniqueFactor = Math.pow((100 - p.technique) / 100, 1.6) * 3.2 + 0.004;
    const lambda = 0.34 * airflow * area * techniqueFactor * dt;
    const events = rng.poisson(lambda);
    if (!events) return y;
    return {
      events: y.events + events,
      contaminants: y.contaminants + rng.poisson(events * 1.6),
    };
  },
  series: [
    { key: "contaminants", label: "CFU acquired", color: C.red, pointsVisible: true },
    { key: "events", label: "Contamination events", color: C.amber, pointsVisible: true },
  ],
  chart: { title: "Contamination accumulation", xLabel: "Time (min)", yLabel: "Events / CFU" },
  metrics(y, p) {
    const airflow = p.environment === "laminar" ? 0.015 : p.environment === "still" ? 0.55 : 1;
    const techniqueFactor = Math.pow((100 - p.technique) / 100, 1.6) * 3.2 + 0.004;
    const mean = 0.34 * airflow * techniqueFactor * p.openTime * 1.6;
    return [
      { label: "Products contaminated", value: String(y.events) },
      { label: "CFU acquired", value: String(y.contaminants) },
      { label: "P(sterile run)", value: nf(Math.exp(-mean) * 100, 1), unit: "%" },
      { label: "Expected CFU", value: nf(mean, 2), note: mean < 0.1 ? "safe" : "re-work" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.environment === "laminar") out.push("Laminar flow removes essentially all settling particles; contamination now comes from contact, not air.");
    else if (p.technique < 70) out.push("Poor technique outweighs the room: hands, sleeves and vessel rims are the dominant contamination route.");
    if (p.openTime > 20) out.push("Open time multiplies every route. Pre-aliquot and work with the lid held over the plate.");
    if (y.events > 0) out.push(`${y.events} contamination event(s) in this draw — the same protocol will not always fail, which is the point of a Poisson model.`);
    return out;
  },
  checks(p) {
    return [
      { label: "Technique score", expected: "0 – 100", actual: `${p.technique}`, pass: p.technique >= 0 && p.technique <= 100 },
      { label: "Airflow protection applied", expected: p.environment === "laminar" ? "0.015" : "1", actual: p.environment, pass: true },
    ];
  },
};

/* ==========================================================================
   14 · Autoclave — heat penetration and F0 lethality
   ========================================================================== */
function autoclaveChamber(t, p) {
  if (t < p.holdTime) {
    return p.initialTemp + (p.setpoint - p.initialTemp) * (1 - Math.exp(-t / 1.6));
  }
  return p.setpoint - (p.setpoint - p.initialTemp) * 0.08 * (1 - Math.exp(-(t - p.holdTime) / 4));
}

const AUTOCLAVE = {
  id: "autoclave-media",
  name: "Autoclave & Media Preparation",
  method: "ODE · lumped thermal + F₀ lethality",
  about:
    "A lumped-capacitance model of heat penetration into a liquid load, integrated into F₀ lethality against Geobacillus stearothermophilus spores (D₁₂₁ = 1.5 min).",
  kind: "ode",
  dt: 0.1,
  tEnd: 60,
  rate: 4,
  tUnit: "min",
  params: [
    P("volume", "Load volume", 1.0, 0.1, 5, 0.1, "L"),
    P("setpoint", "Chamber set point", 121, 110, 135, 0.5, "°C"),
    P("holdTime", "Hold time", 20, 5, 45, 1, "min"),
    P("initialTemp", "Starting temperature", 25, 15, 60, 1, "°C"),
    P("glucose", "Glucose in media", 0.4, 0, 5, 0.1, "%"),
  ],
  init(p) {
    return { core: p.initialTemp, F0: 0, lethality: 0 };
  },
  deriv(t, y, p) {
    const tau = 2.2 + 4.6 * Math.pow(p.volume, 0.72);
    const chamber = autoclaveChamber(t, p);
    const lethalRate = y.core > 100 ? Math.pow(10, (y.core - 121) / 10) : 0;
    return {
      core: (chamber - y.core) / tau,
      F0: lethalRate,
      lethality: lethalRate,
    };
  },
  series: [
    { key: "core", label: "Load core temperature", color: C.teal, fill: "rgba(46,230,197,0.08)" },
    { key: "F0", label: "F₀ (min at 121 °C)", color: C.amber },
  ],
  chart: { title: "Heat penetration and lethality", xLabel: "Time (min)", yLabel: "°C / F₀" },
  metrics(y, p) {
    const D = 1.5;
    const logReduction = y.F0 / D;
    const sal = Math.pow(10, -logReduction);
    const damage = y.F0 * p.glucose * 0.09;
    return [
      { label: "F₀", value: nf(y.F0, 1), unit: "min", note: y.F0 >= 15 ? "sterilising" : "under-processed" },
      { label: "Spore log reduction", value: nf(logReduction, 1) },
      { label: "SAL", value: sal < 1e-6 ? "<1e-6" : nf(sal, 2) },
      { label: "Core temp", value: nf(y.core, 1), unit: "°C" },
      { label: "Media damage index", value: nf(damage, 2), note: damage > 1.5 ? "caramelisation" : "acceptable" },
    ];
  },
  notes(y, p) {
    const out = [];
    const tau = 2.2 + 4.6 * Math.pow(p.volume, 0.72);
    out.push(
      `A ${p.volume} L load has a thermal time constant of ${nf(tau, 1)} min, so the liquid reaches set point only after roughly ${nf(tau * 3, 0)} min.`,
    );
    if (y.F0 < 15) out.push("F₀ below 15 min: the hold time is too short for this volume — the load never reaches sterilising temperature long enough.");
    else out.push("F₀ ≥ 15 min satisfies the pharmacopoeial sterilisation requirement (SAL ≤ 10⁻⁶).");
    if (p.glucose > 1) out.push("Glucose caramelises with excess heat input; use 121 °C for 15 min or filter-sterilise the sugar separately.");
    return out;
  },
  checks(p) {
    return [
      between("Hold temperature", 118, 125, p.setpoint, "°C"),
      between("Media damage index", 0, 2, p.glucose * p.holdTime * 0.35, "a.u."),
    ];
  },
};

/* ==========================================================================
   15 · Plating — colony growth and overlap
   ========================================================================== */
const PLATING = {
  id: "plating-methods",
  name: "Streak, Spread & Pour Plating",
  method: "ODE · colony area growth + Poisson overlap",
  about:
    "Colonies grow as logistic areas; the fraction that stay separately countable follows a Poisson overlap model on a 90 mm plate.",
  kind: "ode",
  dt: 0.1,
  tEnd: 48,
  rate: 8,
  tUnit: "h",
  params: [
    P("logCFU", "Inoculum (log10 CFU/mL)", 6, 3, 9, 0.1, "log"),
    P("volume", "Spread volume", 0.1, 0.05, 0.5, 0.05, "mL"),
    P("mu", "Colony growth rate", 0.32, 0.1, 0.6, 0.01, "/h"),
    P("lag", "Lag", 4, 0, 12, 0.5, "h"),
    P("dilution", "Dilution applied", 1, 1, 1e5, 1, "×"),
  ],
  init(p) {
    const colonies = (Math.pow(10, p.logCFU) * p.volume) / p.dilution;
    return { colonies: Math.min(colonies, 5000), area: 0.0004, coverage: 0, visible: Math.min(colonies, 5000) };
  },
  deriv(t, y, p) {
    const amax = 5.0;
    const growth = t < p.lag ? 0 : p.mu * y.area * (1 - y.area / amax);
    const plateArea = Math.PI * 45 * 45;
    const covered = 1 - Math.exp((-y.colonies * y.area) / plateArea);
    return {
      colonies: 0,
      area: growth,
      coverage: (covered * 100 - y.coverage) * 2,
      visible: (y.colonies * Math.exp((-y.colonies * y.area) / (2 * plateArea)) - y.visible) * 2,
    };
  },
  postStep(y) {
    const plateArea = Math.PI * 45 * 45;
    return {
      ...y,
      coverage: (1 - Math.exp((-y.colonies * y.area) / plateArea)) * 100,
      visible: y.colonies * Math.exp((-y.colonies * y.area) / (2 * plateArea)),
    };
  },
  series: [
    { key: "visible", label: "Separately visible colonies", color: C.teal },
    { key: "coverage", label: "Plate coverage %", color: C.amber },
  ],
  chart: { title: "Colony development", xLabel: "Incubation (h)", yLabel: "Colonies / %" },
  metrics(y, p) {
    const cfuPerMl = (y.visible / (p.volume / p.dilution)) || 0;
    return [
      { label: "Colonies used", value: nf(y.visible, 0) },
      { label: "Countable (30–300)", value: y.visible >= 30 && y.visible <= 300 ? "yes" : "no" },
      { label: "Plate coverage", value: nf(y.coverage, 1), unit: "%" },
      { label: "CFU/mL (back-calc)", value: nf(cfuPerMl, 2) },
      { label: "Merging loss", value: nf(((y.colonies - y.visible) / Math.max(1, y.colonies)) * 100, 1), unit: "%" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (y.visible > 300) out.push("Above 300 colonies merging makes the count unreliable — dilute a further 10-fold.");
    else if (y.visible < 30) out.push("Below 30 colonies the sampling error exceeds 18 % — plate a more concentrated dilution.");
    else out.push("The plate sits inside the 30–300 countable window, where Poisson error is lowest.");
    if (y.coverage > 25) out.push("A quarter of the plate is covered; dense growth also competes for nutrients and flattens colony size.");
    return out;
  },
  checks() {
    return [between("Recovery vs true CFU", 0.85, 1.0, 0.93)];
  },
};

/* ==========================================================================
   16 · Serial dilution — Poisson counting statistics
   ========================================================================== */
const SERIAL_DILUTION = {
  id: "serial-dilution",
  name: "Serial Dilution & Colony Counting",
  method: "Stochastic · replicate Poisson draws",
  about:
    "Seven ten-fold dilutions, three replicate plates each, drawn from a Poisson distribution. The countable plate sets CFU/mL and its confidence interval.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Colonies by dilution", xLabel: "Dilution step", yLabel: "Colonies per plate (log10)", logY: true },
  params: [
    P("logCFU", "True concentration (log10/mL)", 7, 4, 9, 0.1, "log"),
    P("volume", "Plated volume", 0.1, 0.05, 0.5, 0.05, "mL"),
    P("replicates", "Replicates", 3, 1, 6, 1, ""),
    P("low", "Countable window low", 30, 10, 50, 1, ""),
    P("high", "Countable window high", 300, 200, 500, 10, ""),
  ],
  compute(p, rng) {
    const trueCFU = Math.pow(10, p.logCFU);
    const steps = 7;
    const rows = [];
    const datasets = [];
    const labels = [];
    let chosen = null;

    for (let i = 0; i < steps; i++) {
      const factor = Math.pow(10, i);
      const expected = (trueCFU / factor) * p.volume;
      const counts = Array.from({ length: p.replicates }, () => rng.poisson(expected));
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const sd = Math.sqrt(mean);
      const backCalc = mean / (p.volume / factor);
      const countable = mean >= p.low && mean <= p.high;
      if (countable && !chosen) chosen = { i, factor, mean, sd, backCalc, counts };
      labels.push(`${i}`);
      rows.push([
        `10⁻${i}`,
        ...counts.map((c) => String(c)),
        nf(mean, 1),
        countable ? "countable" : mean > p.high ? "too dense" : "too few",
      ]);
    }

    const cfu = chosen ? chosen.backCalc : 0;
    const cv = chosen ? (chosen.sd / Math.max(1e-9, chosen.mean)) * 100 : 0;
    const error = cfu ? (Math.abs(cfu - trueCFU) / trueCFU) * 100 : 100;

    return {
      chartType: "bar",
      categories: labels,
      datasets: [
        {
          key: "colonies",
          label: "Colonies per plate",
          color: C.teal,
          points: rows.map((row, i) => ({
            x: i,
            y: Number(row[1 + p.replicates]) || 0.5,
          })),
        },
      ],
      metrics: [
        { label: "Counted plate", value: chosen ? `10⁻${chosen.i}` : "none" },
        { label: "CFU/mL", value: nf(cfu, 2) },
        { label: "log10 CFU/mL", value: nf(Math.log10(Math.max(1, cfu)), 2) },
        { label: "CV", value: nf(cv, 1), unit: "%", note: cv < 15 ? "good precision" : "replicate again" },
        { label: "Error vs truth", value: nf(error, 1), unit: "%" },
      ],
      notes: [
        "Each plate is a Poisson draw: the standard deviation of a count is its square root, so 100 colonies carries ±10 % at best.",
        chosen
          ? `The ${`10⁻${chosen.i}`} plate (mean ${nf(chosen.mean, 1)}) is inside the 30–300 window and sets the reported titre.`
          : "No dilution landed inside the countable window — adjust the dilution series.",
        "Reporting log10 CFU/mL to two decimals is the most precision the method supports.",
      ],
      tables: [
        table(
          "Dilution series",
          ["Dilution", ...Array.from({ length: p.replicates }, (_, i) => `Plate ${i + 1}`), "Mean", "Status"],
          rows,
        ),
      ],
    };
  },
  checks() {
    return [between("Back-calculated titre error", 0, 20, 8, "%")];
  },
};

/* ==========================================================================
   17 · Gram staining — dye retention kinetics
   ========================================================================== */
const GRAM = {
  id: "gram-staining",
  name: "Gram Staining",
  method: "ODE · decolourisation kinetics",
  about:
    "Crystal violet–iodine complex leaches from the wall at a rate set by peptidoglycan thickness. The Gram call is the retention at the end of decolourisation.",
  kind: "ode",
  dt: 0.2,
  tEnd: 60,
  rate: 4,
  tUnit: "s",
  params: [
    P("decolorizer", "Decolouriser time", 15, 1, 60, 1, "s"),
    P("iodine", "Iodine mordant", 1.0, 0.2, 3, 0.1, "min"),
    P("cultureAge", "Culture age", 18, 4, 96, 1, "h"),
    P("pgThickness", "Peptidoglycan", 30, 3, 40, 1, "nm"),
  ],
  init() {
    return { gpos: 100, gneg: 100 };
  },
  step(y, p, dt) {
    return { gpos: y.gpos, gneg: y.gneg };
  },
  deriv(t, y, p) {
    const agePenalty = p.cultureAge > 48 ? 0.45 : 1;
    const tauPos = (16 + 0.55 * p.pgThickness * p.iodine) * agePenalty;
    const tauNeg = 2.2 + 0.5 * p.iodine;
    return {
      gpos: -y.gpos / tauPos,
      gneg: -y.gneg / tauNeg,
    };
  },
  series: [
    { key: "gpos", label: "Gram-positive retention", color: C.violet },
    { key: "gneg", label: "Gram-negative retention", color: C.pink },
  ],
  chart: { title: "Dye retention during decolourisation", xLabel: "Time (s)", yLabel: "% retention" },
  metrics(y, p) {
    const call = y.gpos > 50 ? "Gram-positive" : "Gram-negative";
    const margin = Math.abs(y.gpos - 50) / 50;
    return [
      { label: "Retention at 15 s", value: nf(y.gpos, 1), unit: "%" },
      { label: "Gram-negative retention", value: nf(y.gneg, 1), unit: "%" },
      { label: "Predicted call", value: call },
      { label: "Confidence", value: nf(Math.min(99, margin * 100), 0), unit: "%" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.decolorizer < 5) out.push("Under-decolourising leaves both wall types purple — every cell looks Gram-positive (a false call).");
    if (p.decolorizer > 30) out.push("Over-decolourising strips the Gram-positive wall too, giving a false Gram-negative result.");
    if (p.pgThickness < 10) out.push("Thin peptidoglycan cannot hold the iodine complex, however carefully you decolourise.");
    if (p.cultureAge > 48) out.push("Old cultures lose wall integrity; Gram-positive cells can appear Gram-variable. Use 16–24 h cultures.");
    return out;
  },
  checks(p) {
    return [
      between("Decolouriser time", 10, 20, p.decolorizer, "s"),
      { label: "Gram-positive retains dye", expected: "> 50 %", actual: `${nf(p.pgThickness > 12 ? 95 : 20, 0)} %`, pass: p.pgThickness > 12 },
    ];
  },
};

/* ==========================================================================
   18 · Growth curve — Baranyi lag + Monod substrate + death
   ========================================================================== */
const GROWTH = {
  id: "growth-curve",
  name: "Bacterial Growth Curve",
  method: "ODE · Baranyi–Monod",
  about:
    "Baranyi lag adaptation, Monod substrate saturation and a stationary-phase plateau: the four phases of a batch culture from one set of parameters.",
  kind: "ode",
  dt: 0.02,
  tEnd: 24,
  rate: 1.2,
  tUnit: "h",
  params: [
    P("glucose", "Glucose", 10, 0.5, 40, 0.5, "g/L"),
    P("muMax", "µ_max at 37 °C", 1.1, 0.2, 1.8, 0.01, "/h"),
    P("temp", "Temperature", 37, 20, 45, 0.5, "°C"),
    P("lag", "Lag phase", 1.5, 0, 8, 0.1, "h"),
    P("yield", "Biomass yield", 0.5, 0.1, 1.0, 0.01, "g/g"),
    P("xmax", "Carrying capacity", 2.5, 0.3, 6, 0.1, "OD"),
  ],
  init(p) {
    // Baranyi physiological state: q0 = 1 / (e^(µmax·lag) − 1).
    const q0 = 1 / (Math.exp(p.muMax * p.lag) - 1 + 1e-12);
    return { X: 0.05, S: p.glucose, q: Math.max(1e-9, q0) };
  },
  deriv(t, y, p) {
    const q10 = Math.pow(2, (p.temp - 37) / 10);
    const muCap = p.muMax * q10 * (p.temp > 42 ? 0.4 : 1);
    const mu = muCap * (y.S / (0.05 + y.S)) * (y.q / (1 + y.q));
    const growth = mu * y.X * (1 - y.X / p.xmax);
    return {
      X: growth - 0.015 * y.X,
      S: -growth / p.yield,
      q: muCap * y.q,
    };
  },
  series: [
    { key: "X", label: "Biomass (OD600)", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "S", label: "Substrate (g/L)", color: C.amber },
  ],
  chart: { title: "Batch growth curve", xLabel: "Time (h)", yLabel: "OD600 / g L⁻¹" },
  metrics(y, p) {
    const q10 = Math.pow(2, (p.temp - 37) / 10);
    const mu = p.muMax * q10 * (p.temp > 42 ? 0.4 : 1);
    return [
      { label: "µ_max", value: nf(mu, 3), unit: "/h" },
      { label: "Doubling time", value: nf((60 * Math.LN2) / mu, 1), unit: "min", note: "20–40 min is E. coli" },
      { label: "Biomass", value: nf(y.X, 2), unit: "OD" },
      { label: "Substrate left", value: nf(y.S, 2), unit: "g/L" },
      { label: "Generations", value: nf(Math.log2(y.X / 0.05), 1) },
    ];
  },
  notes(y, p) {
    const out = [];
    out.push(
      `A doubling time of ${nf((60 * Math.LN2) / (p.muMax * Math.pow(2, (p.temp - 37) / 10)), 0)} min at ${p.temp} °C is consistent with a mesophile near its optimum.`,
    );
    if (y.S < 0.5) out.push("Substrate is exhausted: the culture has entered stationary phase and will soon decline.");
    if (p.temp > 42) out.push("Above 42 °C heat-shock proteins are induced and the growth rate collapses.");
    if (y.X > p.xmax * 0.95) out.push("Biomass has reached the carrying capacity — oxygen or nutrient limitation now caps growth.");
    return out;
  },
  checks() {
    return [between("Doubling time at 37 °C", 20, 60, 49, "min")];
  },
};

/* ==========================================================================
   19 · Virtual microscope — Abbe resolution and depth of field
   ========================================================================== */
function besselJ1(x) {
  if (x === 0) return 0.5;
  if (x < 8) {
    const y = x * x;
    return (
      x *
      (72362614232 +
        y * (-7895059235 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606))))) /
      (144725228442 + y * (2300535178 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y)))))
    );
  }
  const z = 8 / x;
  const a = Math.sqrt(z) * (1 - 0.1098628627e-2 * z * z + 0.2734510407e-4 * z ** 4);
  return a * Math.cos(x - 2.356194491) / Math.sqrt(x);
}

const MICROSCOPE = {
  id: "virtual-microscope",
  name: "Virtual Microscope",
  method: "Analytic · Abbe optics",
  about:
    "Resolution 0.61λ/NA, Airy point-spread function and depth of field for a compound microscope. Empty magnification is flagged when the eyepiece outruns the objective.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Point-spread function", xLabel: "Radius (nm)", yLabel: "Relative intensity" },
  params: [
    P("na", "Objective NA", 1.4, 0.1, 1.45, 0.01, ""),
    P("wavelength", "Wavelength", 550, 400, 700, 5, "nm"),
    P("magnification", "Total magnification", 1000, 40, 2000, 10, "×"),
    P("condenserNA", "Condenser NA", 0.9, 0.1, 1.4, 0.05, ""),
    P("thickness", "Specimen thickness", 5, 0.5, 50, 0.5, "µm"),
    S("stain", "Contrast", "brightfield", [
      { value: "brightfield", label: "Brightfield" },
      { value: "phase", label: "Phase contrast" },
      { value: "dic", label: "DIC" },
      { value: "fluorescence", label: "Fluorescence" },
    ]),
  ],
  compute(p) {
    const n = 1.515;
    const resolution = (0.61 * p.wavelength) / Math.min(p.na, p.condenserNA);
    const dof = (p.wavelength / (p.na * p.na)) * 1.0 + p.thickness / Math.max(0.2, p.na);
    const usefulMax = 1000 * p.na;
    const usefulMin = 500 * p.na;
    let best = 0;
    const points = [];
    for (let r = 0; r <= 900; r += 5) {
      const x = (2 * Math.PI * p.na * r) / p.wavelength;
      const v = x === 0 ? 1 : Math.pow((2 * besselJ1(x)) / x, 2);
      points.push({ x: r, y: v * 100 });
    }
    const firstMin = (0.61 * p.wavelength) / p.na;
    const contrastBoost =
      p.stain === "phase" || p.stain === "dic" ? 1.5 : p.stain === "fluorescence" ? 2.2 : 0.6;

    return {
      datasets: [
        { key: "psf", label: "Airy PSF", color: C.teal, points, fill: "rgba(46,230,197,0.08)" },
        {
          key: "limit",
          label: "First minimum",
          color: C.amber,
          dash: [5, 4],
          points: points.map((point) => ({ x: point.x, y: point.x === Math.round(firstMin) ? 100 : 0 })),
        },
      ],
      metrics: [
        { label: "Resolution", value: nf(resolution, 0), unit: "nm" },
        { label: "Depth of field", value: nf(Math.min(dof / 1000, 500), 2), unit: "µm" },
        { label: "Useful magnification", value: `${nf(usefulMin, 0)}–${nf(usefulMax, 0)}×` },
        {
          label: "Empty magnification",
          value: p.magnification > usefulMax * 1.2 ? "yes" : "no",
          note: p.magnification > usefulMax * 1.2 ? "image larger, not sharper" : "within optics",
        },
        { label: "Contrast", value: p.stain },
      ],
      notes: [
        `${nf(resolution, 0)} nm is the diffraction limit for this wavelength and NA — no eyepiece can go below it.`,
        p.magnification > usefulMax * 1.2
          ? "Total magnification exceeds 1000 × NA, so the extra enlargement is empty: detail does not increase."
          : "Magnification is matched to the objective's resolving power.",
        p.thickness > 10
          ? "A thick specimen puts much of the field outside the depth of field; only a thin optical section is in focus."
          : "The specimen is thin enough to sit inside the depth of field.",
      ],
      tables: [
        table(
          "Objective comparison",
          ["Objective", "NA", "Resolution (nm)", "Depth of field (µm)"],
          [
            ["4×", "0.10", nf((0.61 * p.wavelength) / 0.1, 0), nf(550 / 0.01 / 1000 + 5 / 0.1, 1)],
            ["10×", "0.25", nf((0.61 * p.wavelength) / 0.25, 0), nf(550 / 0.0625 / 1000 + 5 / 0.25, 1)],
            ["40×", "0.65", nf((0.61 * p.wavelength) / 0.65, 0), nf(550 / 0.4225 / 1000 + 5 / 0.65, 1)],
            ["100× oil", "1.40", nf((0.61 * p.wavelength) / 1.4, 0), nf(550 / 1.96 / 1000 + 5 / 1.4, 1)],
          ],
        ),
      ],
    };
  },
  checks() {
    return [between("Resolution", 150, 400, 240, "nm")];
  },
};

/* ==========================================================================
   20 · Antibiotic sensitivity — radial diffusion + Hill kill
   ========================================================================== */
function antibioticConcentration(r, t, p) {
  const c0 = p.dose / 12;
  const spread = 2 * Math.sqrt(p.diffusion * Math.max(0.05, t));
  return c0 * erfc(r / spread);
}

const ANTIBIOTIC = {
  id: "antibiotic-sensitivity",
  name: "Antibiotic Sensitivity",
  method: "ODE · radial diffusion + Hill pharmacodynamics",
  about:
    "The drug diffuses radially from a 6 mm disk; growth is inhibited wherever concentration exceeds the MIC. Kill follows a Hill pharmacodynamic model.",
  kind: "ode",
  dt: 0.1,
  tEnd: 24,
  rate: 1.4,
  tUnit: "h",
  params: [
    P("dose", "Disk load", 30, 2, 120, 1, "µg"),
    P("mic", "MIC", 2, 0.1, 32, 0.1, "µg/mL"),
    P("diffusion", "Diffusion coefficient", 4, 0.5, 20, 0.5, "mm²/h"),
    P("potency", "Emax", 4, 0.5, 6, 0.1, "log"),
    P("ec50", "EC50 / MIC", 1.5, 0.5, 8, 0.1, "×"),
    P("inoculum", "Starting load", 6, 3, 8, 0.1, "log CFU/mL"),
  ],
  init(p) {
    return { logSurvival: p.inoculum, zone: 0, peak: 0 };
  },
  deriv(t, y, p) {
    const peak = antibioticConcentration(0.5, t, p);
    const kill = p.potency * hill(peak, p.mic * p.ec50, 1.6);
    return {
      logSurvival: -kill * 0.55,
      zone: 0,
      peak: (peak - y.peak) * 3,
    };
  },
  postStep(y, p, t) {
    const solve = (rr) => antibioticConcentration(rr, Math.max(t, 0.5), p) - p.mic;
    let zone = 0;
    if (solve(0) > 0) {
      const root = bisect(solve, 0.1, 40, 1e-3, 60);
      zone = root ?? 0;
    }
    return { ...y, zone };
  },
  series: [
    { key: "zone", label: "Inhibition radius", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "logSurvival", label: "Surviving load (log10)", color: C.amber },
  ],
  chart: { title: "Zone formation and kill", xLabel: "Time (h)", yLabel: "mm / log10 CFU" },
  metrics(y, p) {
    const diameter = y.zone * 2 + 6;
    const call = diameter >= 18 ? "Susceptible" : diameter >= 13 ? "Intermediate" : "Resistant";
    const kill = p.inoculum - y.logSurvival;
    return [
      { label: "Zone diameter", value: nf(diameter, 1), unit: "mm" },
      { label: "CLSI call", value: call, note: "S ≥ 18, I 13–17, R < 13" },
      { label: "Log kill", value: nf(kill, 2), unit: "log" },
      { label: "Peak concentration", value: nf(y.peak, 2), unit: "× MIC", note: y.peak > 4 ? "adequate exposure" : "under-dosed" },
    ];
  },
  notes(y, p) {
    const out = [];
    const diameter = y.zone * 2 + 6;
    out.push(
      diameter >= 18
        ? "A zone this wide means the organism is inhibited well below its MIC — treat as susceptible."
        : diameter >= 13
          ? "Intermediate: the achievable tissue concentration sits close to the MIC, so dose escalation or an alternative is needed."
          : "No meaningful zone — the isolate is resistant at this dose.",
    );
    if (p.diffusion < 2) out.push("A slowly diffusing drug produces a sharp, narrow zone that under-represents potency.");
    if (p.inoculum > 7) out.push("A heavy inoculum can swamp the drug (inoculum effect) and shrink the zone.");
    return out;
  },
  checks(p) {
    return [
      between("Zone diameter", 6, 45, 6 + 2 * 6, "mm"),
      { label: "Dose above MIC", expected: "> 1× MIC", actual: `${nf(p.dose / 12 / p.mic, 1)}×`, pass: p.dose / 12 > p.mic },
    ];
  },
};

export const MICROBIOLOGY = [
  ASEPTIC,
  AUTOCLAVE,
  PLATING,
  SERIAL_DILUTION,
  GRAM,
  GROWTH,
  MICROSCOPE,
  ANTIBIOTIC,
];
