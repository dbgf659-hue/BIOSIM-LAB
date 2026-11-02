/**
 * BioSim Lab · industrial & environmental models
 * ---------------------------------------------------------------------------
 * Oxygen transfer in a fermenter, full Michaelis–Menten mechanism, column
 * dispersion, stray-light spectrophotometry, sedimentation, biodegradation
 * and activated-sludge nutrient removal.
 */

import { C, P, S, clamp, gauss, hill, mm, nf, between, table } from "./util.js";

/* ==========================================================================
   29 · Bioreactor — kLa oxygen transfer versus metabolic demand
   ========================================================================== */
const BIOREACTOR = {
  id: "bioreactor",
  name: "Fermenter / Bioreactor",
  method: "ODE · Monod growth + kLa oxygen balance",
  about:
    "Biomass, substrate and dissolved oxygen are integrated together. Oxygen transfer (kLa) and oxygen uptake (OUR) set whether the culture is oxygen-limited.",
  kind: "ode",
  dt: 0.02,
  tEnd: 24,
  rate: 1.8,
  tUnit: "h",
  params: [
    P("kla", "kLa", 200, 20, 800, 10, "/h"),
    P("feed", "Feed rate", 0, 0, 2, 0.05, "vol/day"),
    P("sFeed", "Feed glucose", 20, 5, 60, 1, "g/L"),
    P("temp", "Temperature", 37, 25, 42, 0.5, "°C"),
    P("strain", "Yield coefficient", 0.5, 0.2, 0.8, 0.01, "g/g"),
    P("x0", "Initial biomass", 0.5, 0.05, 5, 0.05, "g/L"),
  ],
  init(p) {
    return { X: p.x0, S: 15, DO: 100 };
  },
  deriv(t, y, p) {
    const mu = 0.42 * (y.S / (0.2 + y.S)) * (y.DO / (15 + y.DO)) * gauss(p.temp, 37, 3.2);
    const D = p.feed / 24;
    const our = mu * y.X * 18;
    return {
      X: mu * y.X - D * y.X,
      S: -mu * y.X / p.strain + D * (p.sFeed - y.S),
      DO: (p.kla / 60) * (100 - y.DO) - our,
    };
  },
  series: [
    { key: "X", label: "Biomass (g/L)", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "S", label: "Glucose (g/L)", color: C.amber },
    { key: "DO", label: "Dissolved O₂ (%)", color: C.sky },
  ],
  chart: { title: "Fed-batch fermentation", xLabel: "Time (h)", yLabel: "g L⁻¹ / %" },
  metrics(y, p) {
    const mu = 0.42 * (y.S / (0.2 + y.S)) * (y.DO / (15 + y.DO)) * gauss(p.temp, 37, 3.2);
    const our = mu * y.X * 18;
    const otr = (p.kla / 60) * (100 - y.DO);
    return [
      { label: "Biomass", value: nf(y.X, 2), unit: "g/L" },
      { label: "Specific rate µ", value: nf(mu, 3), unit: "/h" },
      { label: "OUR", value: nf(our, 1), unit: "mmol/L/h" },
      { label: "OTR", value: nf(otr, 1), unit: "mmol/L/h" },
      { label: "DO", value: nf(y.DO, 0), unit: "%", note: y.DO < 20 ? "O₂ limited" : "sufficient" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (y.DO < 20) out.push("Dissolved oxygen is below 20 %: growth has outrun kLa and the culture is oxygen-limited.");
    if (p.kla < 100) out.push("Low kLa caps the achievable biomass long before the carbon source runs out — raise agitation or aeration.");
    out.push("Scale-up keeps kLa constant rather than tip speed: a 10× vessel needs proportionally more power per unit volume to match oxygen transfer.");
    return out;
  },
  checks() {
    return [between("Biomass at 24 h", 5, 60, 25, "g/L")];
  },
};

/* ==========================================================================
   30 · Enzyme kinetics — the full mechanism, not just the steady-state formula
   ========================================================================== */
const ENZYME = {
  id: "enzyme-kinetics",
  name: "Enzyme Kinetics",
  method: "ODE · E + S ⇌ ES → E + P",
  about:
    "The complete two-step mechanism is integrated, so the pre-steady state is visible. Progress curves give v₀, K_M, kcat and the specificity constant; inhibition is explicit.",
  kind: "ode",
  dt: 0.01,
  tEnd: 300,
  rate: 60,
  tUnit: "s",
  params: [
    P("e0", "Enzyme", 0.05, 0.001, 0.5, 0.001, "µM"),
    P("kcat", "k_cat", 100, 1, 1000, 1, "/s"),
    P("km", "K_M", 50, 1, 500, 1, "µM"),
    P("s0", "Substrate", 200, 5, 2000, 5, "µM"),
    P("inhibitor", "Inhibitor", 0, 0, 500, 5, "µM"),
    S("inhibition", "Inhibition type", "none", [
      { value: "none", label: "None" },
      { value: "competitive", label: "Competitive" },
      { value: "noncompetitive", label: "Non-competitive" },
      { value: "uncompetitive", label: "Uncompetitive" },
    ]),
  ],
  init(p) {
    return { S: p.s0, ES: 0, P: 0, EI: 0, I: p.inhibitor };
  },
  deriv(t, y, p) {
    const km1 = p.kcat * 0.5;
    const k1 = (p.kcat + km1) / p.km;
    const freeE = Math.max(0, p.e0 - y.ES - y.EI);
    const freeI = Math.max(0, y.I);
    const ki = 3 * p.km;
    const bindI = p.inhibition === "competitive" || p.inhibition === "noncompetitive" ? k1 * 0.002 * freeE * freeI : 0;
    const bindIS = p.inhibition === "uncompetitive" ? k1 * 0.002 * y.ES * freeI : 0;
    const unbindI = 0.05 * y.EI;
    const v = k1 * freeE * y.S;
    return {
      S: -v + km1 * y.ES,
      ES: v - (p.kcat + km1) * y.ES - bindIS,
      P: p.kcat * y.ES,
      EI: bindI - unbindI,
      I: -bindI + unbindI - bindIS,
      ki,
    };
  },
  series: [
    { key: "P", label: "Product formed", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "S", label: "Substrate", color: C.amber },
    { key: "ES", label: "ES complex", color: C.violet },
  ],
  chart: { title: "Progress curves", xLabel: "Time (s)", yLabel: "µM" },
  metrics(y, p, history) {
    const first = history[1];
    const fifth = history[5];
    const v0 = first && fifth ? (fifth.P - first.P) / (fifth.t - first.t) : 0;
    const vmax = p.kcat * p.e0;
    const kmApp =
      p.inhibition === "competitive"
        ? p.km * (1 + p.inhibitor / (3 * p.km))
        : p.inhibition === "uncompetitive"
          ? p.km / (1 + p.inhibitor / (3 * p.km))
          : p.km;
    const vmaxApp = p.inhibition === "noncompetitive" ? vmax / (1 + p.inhibitor / (3 * p.km)) : vmax;
    return [
      { label: "v₀", value: nf(v0, 2), unit: "µM/s" },
      { label: "V_max", value: nf(vmaxApp, 2), unit: "µM/s" },
      { label: "K_M (app)", value: nf(kmApp, 1), unit: "µM" },
      { label: "k_cat/K_M", value: nf((p.kcat / kmApp) * 1e3, 2), unit: "mM⁻¹ s⁻¹" },
      { label: "Inhibition", value: nf(clamp(1 - v0 / Math.max(1e-9, mm(p.s0, vmax, p.km)), 0, 1) * 100, 1), unit: "%" },
    ];
  },
  notes(y, p) {
    const out = [];
    const specificity = p.kcat / p.km;
    out.push(
      `k_cat/K_M of ${nf(specificity * 1e3, 1)} mM⁻¹ s⁻¹ ${specificity > 1e6 ? "is close to the diffusion limit — a near-perfect enzyme" : "sits in the normal catalytic range"}.`,
    );
    if (p.inhibition === "competitive") out.push("A competitive inhibitor raises K_M without touching V_max: at high substrate the inhibition is overcome.");
    if (p.inhibition === "noncompetitive") out.push("Non-competitive inhibition lowers V_max at unchanged K_M — the inhibitor does not compete for the active site.");
    if (p.inhibition === "uncompetitive") out.push("Uncompetitive inhibition binds only ES, lowering both V_max and K_M by the same factor.");
    return out;
  },
  checks() {
    return [between("Specificity constant", 1e5, 1e8, 2e6, "M⁻¹ s⁻¹")];
  },
};

/* ==========================================================================
   31 · Chromatography — van Deemter plate height and resolution
   ========================================================================== */
const CHROMATOGRAPHY = {
  id: "chromatography",
  name: "Chromatography",
  method: "Analytic · plate theory / van Deemter",
  about:
    "Peak elution by plate theory: plate number from bead size and bed length, resolution from retention and peak width, shaped by an isocratic elution profile.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Elution profile", xLabel: "Time (min)", yLabel: "Absorbance (mAU)" },
  params: [
    P("flow", "Flow rate", 1.0, 0.1, 3, 0.05, "mL/min"),
    P("bead", "Particle size", 30, 3, 100, 1, "µm"),
    P("length", "Column length", 20, 5, 50, 1, "cm"),
    P("selectivity", "Selectivity α", 1.15, 1.02, 1.6, 0.01, ""),
    P("load", "Sample load", 20, 1, 100, 1, "µg"),
  ],
  compute(p) {
    const N = 2500 * (p.length / 20) * Math.pow(30 / p.bead, 1.25);
    const hetp = (p.length * 10) / N;
    const tR1 = 6 / p.flow;
    const tR2 = tR1 * p.selectivity;
    const sigma1 = tR1 / Math.sqrt(N);
    const sigma2 = tR2 / Math.sqrt(N);
    const resolution = (2 * (tR2 - tR1)) / (4 * (sigma1 + sigma2));
    const points = [];
    const second = [];
    for (let t = 0; t <= tR2 + 6 * sigma2; t += Math.max(0.002, (tR2 + 6 * sigma2) / 600)) {
      const a = (p.load / 60) * Math.exp(-((t - tR1) ** 2) / (2 * sigma1 * sigma1));
      const b = (p.load / 60) * Math.exp(-((t - tR2) ** 2) / (2 * sigma2 * sigma2));
      points.push({ x: t, y: (a + b) * 1000 });
      second.push({ x: t, y: b * 1000 });
    }
    return {
      datasets: [
        { key: "trace", label: "Chromatogram", color: C.teal, points, fill: "rgba(46,230,197,0.10)" },
        { key: "peak2", label: "Second component", color: C.violet, dash: [4, 4], points: second },
      ],
      metrics: [
        { label: "Plate number N", value: nf(N, 0) },
        { label: "HETP", value: nf(hetp, 3), unit: "mm" },
        { label: "Resolution R_s", value: nf(resolution, 2), note: resolution >= 1.5 ? "baseline resolved" : "overlapping" },
        { label: "Selectivity α", value: nf(p.selectivity, 2) },
        { label: "Peak width", value: nf(4 * sigma2 * 60, 0), unit: "s" },
      ],
      notes: [
        `Smaller particles raise the plate count: ${p.bead} µm beads give N = ${nf(N, 0)} over ${p.length} cm.`,
        resolution >= 1.5
          ? "R_s ≥ 1.5 means the peaks are baseline-resolved, the usual acceptance criterion for quantitation."
          : "R_s below 1.5: reduce particle size, lengthen the bed, or increase selectivity.",
        "Pushing flow higher shortens run time but widens peaks through the C-term of the van Deemter equation — there is an optimum velocity.",
      ],
      tables: [
        table(
          "Run conditions",
          ["Parameter", "Value"],
          [
            ["Linear velocity", `${nf((p.flow / (Math.PI * 0.21 * 0.21)) / 60, 3)} cm/s`],
            ["Bed volume", `${nf(Math.PI * 0.21 * 0.21 * p.length, 2)} mL`],
            ["Reduced plate height h", nf(hetp / (p.bead / 1000), 2)],
          ],
        ),
      ],
    };
  },
  checks() {
    return [between("Resolution", 0.5, 6, 1.6)];
  },
};

/* ==========================================================================
   32 · Spectrophotometer — Beer–Lambert with stray light
   ========================================================================== */
const SPECTRO = {
  id: "spectrophotometer",
  name: "Spectrophotometer & Beer-Lambert",
  method: "Analytic · stray-light absorbance",
  about:
    "Measured absorbance includes stray light, so A flattens above ~1.5 instead of rising linearly. The back-calculated concentration is compared with the truth.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Calibration and non-linearity", xLabel: "Concentration (mg/mL)", yLabel: "Absorbance" },
  params: [
    P("concentration", "Concentration", 0.5, 0.001, 5, 0.001, "mg/mL"),
    P("extinction", "Extinction coefficient", 1.5, 0.1, 5, 0.05, "mL mg⁻¹ cm⁻¹"),
    P("pathLength", "Path length", 1.0, 0.1, 5, 0.1, "cm"),
    P("stray", "Stray light", 0.1, 0, 2, 0.01, "%"),
    P("dilution", "Dilution factor", 1, 1, 20, 1, "×"),
  ],
  compute(p) {
    const conc = p.concentration;
    const slope = p.extinction * p.pathLength;
    const aTrue = slope * conc;
    const s = p.stray / 100;
    const aObs = -Math.log10((Math.pow(10, -aTrue) + s) / (1 + s));
    const backCalc = aObs / slope;
    const points = [];
    const ideal = [];
    for (let c = 0; c <= 5; c += 0.1) {
      points.push({ x: c, y: -Math.log10((Math.pow(10, -slope * c) + s) / (1 + s)) });
      ideal.push({ x: c, y: slope * c });
    }
    const error = Math.abs(backCalc - conc) / conc * 100;
    return {
      datasets: [
        { key: "measured", label: "Measured A", color: C.teal, points },
        { key: "ideal", label: "Beer–Lambert ideal", color: C.slate, dash: [5, 4], points: ideal },
      ],
      metrics: [
        { label: "Absorbance", value: nf(aObs, 3) },
        { label: "Ideal A", value: nf(aTrue, 3) },
        { label: "Back-calculated", value: nf(backCalc, 3), unit: "mg/mL" },
        { label: "Error", value: nf(error, 2), unit: "%", note: error < 2 ? "linear range" : "outside linearity" },
        { label: "Transmittance", value: nf(Math.pow(10, -aObs) * 100, 1), unit: "%" },
      ],
      notes: [
        aObs > 1.5
          ? "Above A ≈ 1.5 stray light dominates and the reading under-reports concentration — dilute and re-measure."
          : "The measurement sits in the linear window where A is proportional to concentration.",
        "A is logarithmic: each unit is a ten-fold attenuation, so precision degrades as the sample gets darker.",
        p.dilution > 1
          ? `Multiplying the reading by the ${p.dilution}× dilution recovers the stock concentration only while the diluted sample stays below A = 1.5.`
          : "No dilution applied; keep A between 0.1 and 1.0 for the best precision.",
      ],
      tables: [
        table(
          "Calibration standards",
          ["Standard (mg/mL)", "A measured", "A ideal"],
          [0.1, 0.25, 0.5, 1.0, 2.0, 3.0].map((c) => [
            nf(c, 2),
            nf(-Math.log10((Math.pow(10, -slope * c) + s) / (1 + s)), 3),
            nf(slope * c, 3),
          ]),
        ),
      ],
    };
  },
  checks() {
    return [between("Absorbance in linear range", 0.1, 1.5, 0.75)];
  },
};

/* ==========================================================================
   33 · Centrifugation — sedimentation velocity and k-factor
   ========================================================================== */
const CENTRIFUGATION = {
  id: "centrifugation",
  name: "Centrifugation",
  method: "ODE · sedimentation velocity",
  about:
    "Particles migrate at v = sω²r. Rotor geometry sets the relative centrifugal force and the k-factor, which predicts pelleting time directly.",
  kind: "ode",
  dt: 0.5,
  tEnd: 120,
  rate: 8,
  tUnit: "min",
  params: [
    P("rpm", "Speed", 40000, 2000, 100000, 500, "rpm"),
    P("rmin", "Rotor minimum radius", 3.0, 1, 6, 0.1, "cm"),
    P("rmax", "Rotor maximum radius", 8.0, 4, 12, 0.1, "cm"),
    P("sValue", "Particle", 100, 5, 2000, 5, "S"),
    P("viscosity", "Viscosity factor", 1.0, 0.5, 3, 0.05, "×"),
  ],
  init(p) {
    return { radius: p.rmin, pelleted: 0 };
  },
  deriv(t, y, p) {
    const omega = (p.rpm * 2 * Math.PI) / 60;
    const s = p.sValue * 1e-13;
    const rate = (s * omega * omega * y.radius * 60) / p.viscosity;
    return {
      radius: y.radius >= p.rmax ? 0 : rate,
      pelleted: y.radius >= p.rmax ? 0 : rate,
    };
  },
  postStep(y, p) {
    if (y.radius >= p.rmax) return { ...y, radius: p.rmax, pelleted: 100 };
    const fraction = clamp((y.radius - p.rmin) / (p.rmax - p.rmin), 0, 1);
    return { ...y, pelleted: fraction * 100 };
  },
  series: [
    { key: "radius", label: "Sedimentation front (cm)", color: C.teal },
    { key: "pelleted", label: "Fraction pelleted (%)", color: C.amber },
  ],
  chart: { title: "Sedimentation", xLabel: "Time (min)", yLabel: "cm / %" },
  metrics(y, p) {
    const omega = (p.rpm * 2 * Math.PI) / 60;
    const rcf = 1.118e-5 * p.rmax * p.rpm * p.rpm;
    const kFactor = (Math.log(p.rmax / p.rmin) / (omega * omega)) * 1e13 / 3600;
    const time = kFactor / p.sValue;
    return [
      { label: "RCF", value: nf(rcf / 1000, 1), unit: "×1000 g" },
      { label: "k-factor", value: nf(kFactor, 0) },
      { label: "Pelleting time", value: nf(time, 0), unit: "min", note: time < p.tEnd ? "complete" : "incomplete" },
      { label: "Pelleted", value: nf(y.pelleted, 0), unit: "%" },
    ];
  },
  notes(y, p) {
    const out = [];
    const omega = (p.rpm * 2 * Math.PI) / 60;
    const kFactor = (Math.log(p.rmax / p.rmin) / (omega * omega)) * 1e13 / 3600;
    out.push(`The k-factor of ${nf(kFactor, 0)} is the run time in hours for a 1000 S particle to pellet to the wall.`);
    if (p.sValue < 20) out.push("Particles below 20 S need ultracentrifugation: at these speeds soluble proteins stay in the supernatant.");
    if (p.rpm > 80000) out.push("Above 80 000 rpm rotor stress and heating become limiting — check the rotor rating.");
    return out;
  },
  checks() {
    return [between("RCF at the wall", 50000, 200000, 143000, "g")];
  },
};

/* ==========================================================================
   34 · Bioremediation — Monod degradation with bioavailability
   ========================================================================== */
const BIOREMEDIATION = {
  id: "bioremediation",
  name: "Bioremediation & Pollutant Degradation",
  method: "ODE · Monod biodegradation",
  about:
    "Pollutant degradation follows Monod kinetics on the contaminant itself; temperature, oxygen and co-substrate set the biomass that can be sustained.",
  kind: "ode",
  dt: 0.05,
  tEnd: 60,
  rate: 1.6,
  tUnit: "day",
  params: [
    P("p0", "Initial pollutant", 100, 5, 500, 5, "mg/L"),
    P("biomass", "Inoculated biomass", 1e6, 1e3, 1e8, 1e5, "CFU/mL"),
    P("ks", "Half-saturation K_s", 15, 1, 100, 1, "mg/L"),
    P("muMax", "µ_max", 0.18, 0.02, 0.6, 0.01, "/h"),
    P("temp", "Temperature", 25, 8, 40, 0.5, "°C"),
    P("oxygen", "Oxygen", 60, 5, 100, 5, "%"),
    P("coSubstrate", "Co-substrate", 1.0, 0, 3, 0.1, "×"),
  ],
  init(p) {
    return { P: p.p0, X: p.biomass / 1e6, co: p.coSubstrate, mineralised: 0 };
  },
  deriv(t, y, p) {
    const tempFactor = gauss(p.temp, 28, 9);
    const oxy = p.oxygen / 100;
    const mu = p.muMax * (y.P / (p.ks + y.P)) * tempFactor * oxy * (0.4 + 0.6 * y.co);
    const growth = mu * y.X;
    const consumption = growth / 0.45;
    return {
      P: -consumption,
      X: growth - 0.006 * y.X,
      co: -growth * 0.12 + (p.coSubstrate - y.co) * 0.05,
      mineralised: consumption,
    };
  },
  series: [
    { key: "P", label: "Pollutant", color: C.red, fill: "rgba(251,113,133,0.08)" },
    { key: "X", label: "Degrader biomass", color: C.teal },
    { key: "mineralised", label: "Cumulative mineralised", color: C.green },
  ],
  chart: { title: "Degradation curve", xLabel: "Time (days)", yLabel: "mg/L" },
  metrics(y, p) {
    const halfLife = Math.log(2) / Math.max(1e-9, (p.muMax * p.tempFactorValue) / 0.45);
    return [
      { label: "Remaining", value: nf(y.P, 1), unit: "mg/L" },
      { label: "Degraded", value: nf(((p.p0 - y.P) / p.p0) * 100, 1), unit: "%" },
      { label: "Rate", value: nf((p.p0 - y.P) / 60, 2), unit: "mg/L/day" },
      { label: "Biomass", value: nf(Math.log10(Math.max(1, y.X * 1e6)), 1), unit: "log CFU/mL" },
      { label: "Half-life", value: nf(halfLife, 1), unit: "d" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (y.P > p.p0 * 0.7) out.push("Degradation has barely started: the biomass is still adapting or a nutrient is limiting.");
    if (p.oxygen < 20) out.push("Below 20 % oxygen the pathway shifts to anaerobic, which is orders of magnitude slower for most hydrocarbons.");
    if (p.coSubstrate < 0.5) out.push("Co-metabolism needs a growth substrate; without it the degrader population cannot be sustained.");
    out.push("First-order behaviour appears whenever the pollutant sits well below K_s — the rate then depends only on concentration.");
    return out;
  },
  checks() {
    return [between("Removal in 60 days", 40, 100, 85, "%")];
  },
};

/* ==========================================================================
   35 · Wastewater — activated sludge COD and nitrogen removal
   ========================================================================== */
const WASTEWATER = {
  id: "wastewater",
  name: "Wastewater Treatment (BOD/COD)",
  method: "ODE · activated-sludge (ASM1-lite)",
  about:
    "Aeration basin with biomass, COD, ammonium and nitrate. Hydraulic and solids retention times set effluent quality; nitrification and denitrification are explicit.",
  kind: "ode",
  dt: 0.05,
  tEnd: 72,
  rate: 4,
  tUnit: "h",
  params: [
    P("cod", "Influent COD", 400, 100, 1200, 10, "mg/L"),
    P("nh4", "Influent NH₄⁺", 40, 5, 120, 1, "mg/L"),
    P("hrt", "Hydraulic retention time", 8, 2, 24, 0.5, "h"),
    P("srt", "Solids retention time", 10, 2, 30, 0.5, "d"),
    P("kla", "Aeration kLa", 120, 20, 400, 5, "/h"),
    P("temp", "Temperature", 20, 10, 30, 0.5, "°C"),
  ],
  init() {
    return { COD: 60, X: 2000, NH4: 5, NO3: 5, DO: 60, TN: 0 };
  },
  deriv(t, y, p) {
    const D = 1 / p.hrt;
    const tempFactor = gauss(p.temp, 20, 10);
    const mu = 3.2 * (y.COD / (20 + y.COD)) * (y.DO / (2 + y.DO)) * tempFactor;
    const growth = mu * y.X * 0.001;
    const nitrifiers = 0.9 * (y.NH4 / (2 + y.NH4)) * (y.DO / (1.5 + y.DO)) * tempFactor;
    const washout = y.X / (p.srt * 24);
    return {
      COD: D * (p.cod - y.COD) - growth,
      X: growth - washout,
      NH4: D * (p.nh4 - y.NH4) - nitrifiers,
      NO3: nitrifiers - (1.6 * (1 - y.DO / 100)) * y.NO3 - D * y.NO3 * 0.1,
      DO: (p.kla / 60) * (100 - y.DO) - growth * 22 - nitrifiers * 8,
      TN: 0,
    };
  },
  series: [
    { key: "COD", label: "Effluent COD", color: C.amber },
    { key: "NH4", label: "Ammonium", color: C.teal, fill: "rgba(46,230,197,0.08)" },
    { key: "NO3", label: "Nitrate", color: C.violet },
    { key: "DO", label: "Dissolved O₂ (%)", color: C.sky },
  ],
  chart: { title: "Effluent stabilisation", xLabel: "Time (h)", yLabel: "mg L⁻¹ / %" },
  metrics(y, p) {
    const tn = y.NH4 + y.NO3;
    return [
      { label: "Effluent COD", value: nf(y.COD, 0), unit: "mg/L", note: y.COD < 80 ? "compliant" : "exceeds limit" },
      { label: "NH₄⁺", value: nf(y.NH4, 1), unit: "mg/L" },
      { label: "NO₃⁻", value: nf(y.NO3, 1), unit: "mg/L" },
      { label: "TN removal", value: nf(((p.nh4 - tn) / p.nh4) * 100, 0), unit: "%" },
      { label: "Biomass", value: nf(y.X, 0), unit: "mg/L" },
      { label: "DO", value: nf(y.DO, 0), unit: "%" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (y.COD > 80) out.push("Effluent COD above 80 mg/L: either the HRT is too short for the incoming load or the biomass has washed out.");
    if (p.srt < 4) out.push("SRT below 4 days washes out the slow-growing nitrifiers, so ammonia passes through untreated.");
    if (y.DO < 20) out.push("Low dissolved oxygen limits both carbon oxidation and nitrification; aeration is the usual bottleneck.");
    if (p.hrt < 4) out.push("A short HRT leaves no time for nitrification even when the biomass is healthy.");
    return out;
  },
  checks() {
    return [between("Effluent COD", 20, 90, 45, "mg/L")];
  },
};

export const INDUSTRIAL = [
  BIOREACTOR,
  ENZYME,
  CHROMATOGRAPHY,
  SPECTRO,
  CENTRIFUGATION,
  BIOREMEDIATION,
  WASTEWATER,
];
