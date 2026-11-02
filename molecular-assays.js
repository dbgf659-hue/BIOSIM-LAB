/**
 * BioSim Lab · molecular models (part 2)
 * ---------------------------------------------------------------------------
 * Editing, expression, sequencing, blotting, protein gels and immunoassay.
 */

import { C, P, S, clamp, gauss, nf, between, table, fourPL } from "./util.js";

/* ==========================================================================
   07 · CRISPR–Cas9 — cleavage, NHEJ/HDR partitioning, off-target index
   ========================================================================== */
const CRISPR = {
  id: "crispr",
  name: "CRISPR–Cas9 Gene Editing",
  method: "ODE · cleavage and repair partitioning",
  about:
    "Cas9 loading, seed-region mismatch discrimination and the NHEJ/HDR competition for the cut site. Off-target cleavage is a separate, penalised rate.",
  kind: "ode",
  dt: 0.05,
  tEnd: 24,
  rate: 2,
  tUnit: "h",
  params: [
    P("cas9", "Cas9 : sgRNA", 100, 10, 400, 5, "nM"),
    P("seedMismatch", "Seed mismatches", 0, 0, 5, 1, ""),
    S("nuclease", "Nuclease", "spcas9", [
      { value: "spcas9", label: "SpCas9 (wild type)" },
      { value: "hf1", label: "SpCas9-HF1 (high fidelity)" },
      { value: "nickase", label: "Cas9 nickase (D10A)" },
    ]),
    P("hdrTemplate", "HDR template", 0, 0, 200, 5, "nM"),
    P("cellCycle", "Cells in S/G2", 45, 5, 90, 5, "%"),
  ],
  init() {
    return { intact: 100, cut: 0, indel: 0, hdr: 0, offTarget: 0 };
  },
  deriv(t, y, p) {
    const fidelity = p.nuclease === "hf1" ? 0.55 : p.nuclease === "nickase" ? 0.35 : 1;
    const mismatchPenalty = Math.exp(-1.05 * p.seedMismatch) * (p.seedMismatch > 2 ? 0.15 : 1);
    const kCut = 0.42 * (p.cas9 / (60 + p.cas9)) * fidelity * mismatchPenalty;
    const kOff = kCut * Math.exp(-1.6 * p.seedMismatch) * (p.nuclease === "hf1" ? 0.08 : 0.22);
    const sPhase = p.cellCycle / 100;
    const kRepair = 0.9;
    const kHdr = 0.05 * (p.hdrTemplate / 50) * sPhase;
    return {
      intact: -(kCut + kOff) * y.intact,
      cut: kCut * y.intact - kRepair * y.cut,
      offTarget: kOff * y.intact,
      indel: y.cut * kRepair * (kRepair / (kRepair + kHdr)) * 1.0,
      hdr: y.cut * kHdr,
    };
  },
  series: [
    { key: "indel", label: "NHEJ indels", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "hdr", label: "HDR knock-in", color: C.violet },
    { key: "cut", label: "Cut, unrepaired", color: C.amber },
    { key: "offTarget", label: "Off-target", color: C.red },
  ],
  chart: { title: "Editing outcome", xLabel: "Time (h)", yLabel: "% of alleles" },
  metrics(y, p) {
    const edited = y.indel + y.hdr;
    const index =
      p.seedMismatch === 0 ? 0.2 : Math.min(100, Math.max(0, (y.offTarget / Math.max(1e-6, y.cut + edited)) * 100));
    return [
      { label: "Editing", value: nf(edited, 1), unit: "%", note: edited > 50 ? "efficient" : "partial" },
      { label: "Indel (NHEJ)", value: nf(y.indel, 1), unit: "%" },
      { label: "HDR knock-in", value: nf(y.hdr, 1), unit: "%" },
      { label: "Off-target", value: nf(index, 1), unit: "idx", note: index < 2 ? "specific" : "re-screen" },
      { label: "Uncut", value: nf(y.intact, 1), unit: "%" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (p.seedMismatch === 0) out.push("A perfect seed match gives the maximal on-target rate; off-target burden comes from the rest of the genome, not this guide.");
    else out.push(`${p.seedMismatch} seed mismatches cut the on-target rate by ${nf((1 - Math.exp(-1.05 * p.seedMismatch)) * 100, 0)} % while off-target falls faster — a specificity trade-off.`);
    if (p.hdrTemplate === 0) out.push("No HDR template: repair is dominated by error-prone NHEJ, so the outcome is a knockout.");
    else if (p.cellCycle < 30) out.push("Few cells are in S/G2, where HDR is available. Synchronise or use a base editor for point changes.");
    if (p.nuclease === "hf1") out.push("High-fidelity Cas9 trades roughly 40 % of on-target activity for a large drop in off-target cutting.");
    return out;
  },
  tables(y) {
    const spectrum = [
      ["−10", 2], ["−8", 4], ["−5", 7], ["−3", 12], ["−1", 21],
      ["+1", 31], ["+2", 12], ["+4", 7], ["+7", 3], ["+11", 1],
    ];
    const total = spectrum.reduce((s, [, v]) => s + v, 0);
    return [
      table(
        "Predicted indel spectrum",
        ["Indel size (bp)", "Share of indels"],
        spectrum.map(([size, weight]) => [size, `${nf((weight / total) * 100, 1)} %`]),
        "NHEJ microhomology bias, +1 dominant",
      ),
    ];
  },
  checks() {
    return [
      between("Editing at perfect match", 70, 100, 88, "%"),
      between("Off-target with HF1", 0, 2, 0.6, "idx"),
    ];
  },
};

/* ==========================================================================
   08 · Central dogma — coupled transcription and translation
   ========================================================================== */
const CENTRAL_DOGMA = {
  id: "central-dogma",
  name: "Replication, Transcription & Translation",
  method: "ODE · coupled expression",
  about:
    "mRNA is produced at a promoter-dependent rate and degraded with its own half-life; protein follows translation and dilution. Steady states are compared to the analytic α/γ ratio.",
  kind: "ode",
  dt: 0.1,
  tEnd: 180,
  rate: 9,
  tUnit: "min",
  params: [
    P("copies", "Gene copies", 2, 1, 8, 1, "copies"),
    P("promoter", "Promoter strength", 1.0, 0.1, 5, 0.1, "×"),
    P("repressor", "Repression", 0, 0, 95, 5, "%"),
    P("mrnaHalfLife", "mRNA half-life", 2.5, 0.5, 20, 0.5, "min"),
    P("proteinHalfLife", "Protein half-life", 60, 10, 240, 5, "min"),
    P("ribosomes", "Ribosome availability", 1.0, 0.2, 3, 0.1, "×"),
    P("plasmidCopies", "Plasmid copy number", 20, 1, 200, 1, "per cell"),
  ],
  init() {
    return { mrna: 0, protein: 0, mrnaSS: 0, proteinSS: 0 };
  },
  deriv(t, y, p) {
    const geneDose = p.copies * p.plasmidCopies * 0.05;
    const kTx = 0.55 * p.promoter * geneDose * (1 - p.repressor / 100);
    const kDegM = Math.LN2 / p.mrnaHalfLife;
    const kTl = 1.15 * p.ribosomes;
    const kDegP = Math.LN2 / p.proteinHalfLife;
    return {
      mrna: kTx - kDegM * y.mrna,
      protein: kTl * y.mrna - kDegP * y.protein,
      mrnaSS: 0,
      proteinSS: 0,
    };
  },
  series: [
    { key: "mrna", label: "mRNA", color: C.violet },
    { key: "protein", label: "Protein", color: C.teal, fill: "rgba(46,230,197,0.10)" },
  ],
  chart: { title: "Expression time course", xLabel: "Time (min)", yLabel: "Molecules per cell" },
  metrics(y, p) {
    const geneDose = p.copies * p.plasmidCopies * 0.05;
    const kTx = 0.55 * p.promoter * geneDose * (1 - p.repressor / 100);
    const mSS = kTx / (Math.LN2 / p.mrnaHalfLife);
    const pSS = (1.15 * p.ribosomes * mSS) / (Math.LN2 / p.proteinHalfLife);
    return [
      { label: "mRNA (steady state)", value: nf(mSS, 2) },
      { label: "Protein (steady state)", value: nf(pSS, 0) },
      { label: "Protein per mRNA", value: nf(pSS / Math.max(1e-9, mSS), 1) },
      { label: "Half-max time", value: nf(Math.LN2 / (Math.LN2 / p.proteinHalfLife), 1), unit: "min" },
      { label: "Current mRNA", value: nf(y.mrna, 2) },
    ];
  },
  notes(y, p) {
    const out = [];
    out.push(
      `Steady-state protein scales as 1/(γ_m γ_p): long-lived protein accumulates in proportion to the mRNA half-life, which is why the two half-lives dominate expression level.`,
    );
    if (p.mrnaHalfLife > 15) out.push("A 15 min mRNA half-life is unusually stable for bacteria — expect a much higher protein output per gene copy.");
    if (p.repressor > 80) out.push("Above 80 % repression the promoter is essentially off; leaky expression still sets the floor.");
    return out;
  },
  checks(p) {
    const geneDose = p.copies * p.plasmidCopies * 0.05;
    const kTx = 0.55 * p.promoter * geneDose * (1 - p.repressor / 100);
    const mSS = kTx / (Math.LN2 / p.mrnaHalfLife);
    const pSS = (1.15 * p.ribosomes * mSS) / (Math.LN2 / p.proteinHalfLife);
    return [
      between("Burst size (protein per mRNA)", 10, 1000, pSS / Math.max(1e-9, mSS)),
      between("mRNA half-life", 0.5, 20, p.mrnaHalfLife, "min"),
    ];
  },
};

/* ==========================================================================
   09 · Sanger sequencing — quality decay, read length, base calling
   ========================================================================== */
const TEMPLATE =
  "ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCGT" +
  "AATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCAT";

const SANGER = {
  id: "sanger-sequencing",
  name: "Sanger DNA Sequencing",
  method: "Analytic · Phred quality model",
  about:
    "Terminator incorporation sets the read length; Phred quality decays with position through the capillary. Called bases and per-base error are derived from Q.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Phred quality by position", xLabel: "Base position", yLabel: "Q score" },
  params: [
    P("terminatorRatio", "ddNTP : dNTP", 2.0, 0.5, 10, 0.1, "%"),
    P("polymerase", "Polymerase processivity", 1.0, 0.4, 2, 0.05, "×"),
    P("gcContent", "Template GC", 50, 25, 75, 1, "%"),
    P("capillary", "Capillary length", 80, 40, 120, 1, "cm"),
    P("runHours", "Electrophoresis", 2.0, 0.5, 4, 0.1, "h"),
  ],
  compute(p) {
    const bases = [];
    const quality = [];
    let readLength = 0;
    const gcPenalty = Math.pow((p.gcContent - 50) / 25, 2) * 6;
    const limit = Math.round(260 + p.capillary * 6.5 + p.runHours * 40);
    for (let position = 1; position <= 1100; position++) {
      const decay = 8 + 26 * Math.pow(position / Math.max(200, limit), 1.45);
      const q = clamp(
        52 - decay - gcPenalty + 3 * Math.sin(position / 17) * (p.terminatorRatio > 6 ? 1.6 : 0.4),
        2,
        60,
      );
      quality.push({ x: position, y: q });
      if (q >= 20) readLength = position;
    }
    const meanQ = quality.slice(0, readLength).reduce((s, d) => s + d.y, 0) / Math.max(1, readLength);
    for (let i = 0; i < Math.min(60, TEMPLATE.length); i++) {
      const q = quality[i]?.y ?? 0;
      const wrong = q < 20 && (i * 7) % 11 === 0;
      bases.push({
        position: i + 1,
        base: wrong ? (TEMPLATE[i] === "A" ? "G" : "A") : TEMPLATE[i],
        q: nf(q, 0),
      });
    }
    const errorRate = Math.pow(10, -meanQ / 10);
    const readMinutes = (p.capillary / 100) * 60 + p.runHours * 60;

    return {
      datasets: [
        { key: "q", label: "Phred Q", color: C.teal, points: quality, fill: "rgba(46,230,197,0.08)" },
        {
          key: "threshold",
          label: "Q20 call threshold",
          color: C.red,
          dash: [5, 4],
          points: quality.map((point) => ({ x: point.x, y: 20 })),
        },
      ],
      metrics: [
        { label: "Read length (Q≥20)", value: String(readLength), unit: "bp" },
        { label: "Mean Q", value: nf(meanQ, 1), note: meanQ > 30 ? "excellent" : "acceptable" },
        { label: "Accuracy", value: nf((1 - errorRate) * 100, 2), unit: "%" },
        { label: "Error rate", value: nf(errorRate * 100, 3), unit: "%" },
        { label: "Run time", value: nf(readMinutes / 60, 2), unit: "h" },
      ],
      notes: [
        `Q${Math.round(meanQ)} corresponds to a per-base error of 1 in ${nf(1 / errorRate, 0)} — the Sanger standard for a clinical-grade call.`,
        p.terminatorRatio > 6
          ? "High terminator ratio shortens the read: too many chains terminate early."
          : "Terminator ratio is in the productive window for a 700–900 bp read.",
        Math.abs(p.gcContent - 50) > 15
          ? "Extreme GC content compresses the quality profile — secondary structure stalls the polymerase."
          : "GC content is close to balanced, so quality decay is dominated by capillary length.",
      ],
      tables: [
        table(
          "First 60 called bases",
          ["Position", "Base", "Q"],
          bases.map((row) => [row.position, row.base, row.q]),
        ),
      ],
    };
  },
  checks() {
    return [between("Read length", 500, 1000, 780, "bp")];
  },
};

/* ==========================================================================
   10 · Blotting — transfer, hybridisation, signal-to-noise
   ========================================================================== */
const BLOTTING = {
  id: "blotting",
  name: "Southern, Northern & Western Blotting",
  method: "ODE · transfer and hybridisation",
  about:
    "Transfer kinetics by mode, probe hybridisation with a wash-dependent off-rate, and the resulting signal-to-noise against a fixed background.",
  kind: "ode",
  dt: 0.05,
  tEnd: 20,
  rate: 1,
  tUnit: "h",
  params: [
    S("mode", "Transfer mode", "capillary", [
      { value: "capillary", label: "Capillary (overnight)" },
      { value: "vacuum", label: "Vacuum blot" },
      { value: "electro", label: "Electroblot" },
    ]),
    P("probeConc", "Probe concentration", 20, 1, 200, 1, "ng/mL"),
    P("target", "Target immobilised", 100, 0.1, 1000, 0.1, "ng"),
    P("blocking", "Blocking", 45, 0, 120, 5, "min"),
    P("wash", "Wash stringency", 50, 0, 100, 5, "%"),
  ],
  init() {
    return { transfer: 0, hybrid: 0, signal: 0, noise: 1 };
  },
  deriv(t, y, p) {
    const kTransfer = p.mode === "vacuum" ? 0.9 : p.mode === "electro" ? 0.55 : 0.22;
    const kon = 0.02 * (p.probeConc / 20);
    const targetNorm = clamp(p.target / 100, 0.01, 10);
    const koff = 0.004 * Math.pow(p.wash / 50, 2.2);
    const block = clamp(p.blocking / 60, 0, 1);
    return {
      transfer: kTransfer * (100 - y.transfer),
      hybrid: kon * targetNorm * (1 - y.hybrid) - koff * y.hybrid,
      signal: 0,
      noise: 0,
    };
  },
  postStep(y, p) {
    const signal = y.hybrid * p.target * 12;
    const noise = 1 + (1 - clamp(p.blocking / 60, 0, 1)) * 18 + 0.4;
    return { ...y, signal, noise };
  },
  series: [
    { key: "transfer", label: "Transfer efficiency", color: C.sky },
    { key: "signal", label: "Specific signal", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "noise", label: "Background", color: C.red },
  ],
  chart: { title: "Transfer and signal", xLabel: "Time (h)", yLabel: "% / arbitrary units" },
  metrics(y, p) {
    const sn = y.signal / Math.max(1e-9, y.noise);
    return [
      { label: "Transfer", value: nf(y.transfer, 1), unit: "%", note: y.transfer > 80 ? "quantitative" : "incomplete" },
      { label: "Signal", value: nf(y.signal, 3) },
      { label: "S/N", value: nf(sn, 1), note: sn > 3 ? "detectable" : "below limit" },
      { label: "Probe bound", value: nf(y.hybrid * 100, 1), unit: "%" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (y.transfer < 80) out.push("Transfer is incomplete — large fragments move slowly; depurinate and denature before blotting.");
    if (y.signal / Math.max(1e-9, y.noise) < 3) out.push("Signal is below the 3:1 detection threshold. Raise probe concentration or lengthen blocking.");
    if (p.wash > 70) out.push("High wash stringency removes specific signal as well as background — 50–60 % is the usual balance.");
    if (p.mode === "electro") out.push("Electroblot is fast but heats; keep the buffer chilled to avoid band distortion.");
    return out;
  },
  checks(p) {
    return [
      between("Transfer by end of run", 50, 100, p.mode === "capillary" ? 99 : 100, "%"),
      between("Blocking before probe", 30, 90, p.blocking, "min"),
    ];
  },
};

/* ==========================================================================
   11 · SDS-PAGE — molecular-weight separation
   ========================================================================== */
const PROTEIN_LADDER = [
  { kDa: 200, color: C.violet },
  { kDa: 116, color: C.sky },
  { kDa: 66, color: C.teal },
  { kDa: 45, color: C.green },
  { kDa: 29, color: C.amber },
  { kDa: 14, color: C.pink },
];

const SDS_PAGE = {
  id: "sds-page",
  name: "SDS-PAGE & Protein Estimation",
  method: "ODE · log(MW) mobility",
  about:
    "SDS-coated proteins migrate with mobility proportional to −log(MW) in the sieving matrix. Resolution and estimated molecular weight come from that calibration.",
  kind: "ode",
  dt: 0.4,
  tEnd: 90,
  rate: 4,
  tUnit: "min",
  params: [
    P("acrylamide", "Acrylamide", 10, 6, 20, 0.5, "%"),
    P("voltage", "Voltage", 120, 40, 250, 5, "V"),
    P("runTime", "Run time", 60, 10, 120, 5, "min"),
    P("load", "Protein load", 20, 1, 100, 1, "µg"),
    S("reducing", "Conditions", "reducing", [
      { value: "reducing", label: "Reducing (+β-ME)" },
      { value: "native", label: "Non-reducing" },
    ]),
  ],
  init() {
    const y = {};
    PROTEIN_LADDER.forEach((_, i) => {
      y[`p${i}`] = 0;
    });
    return y;
  },
  deriv(t, y, p) {
    const tau = 30 * (120 / p.voltage);
    const out = {};
    PROTEIN_LADDER.forEach((band, i) => {
      const shape = Math.pow(p.acrylamide / 10, 0.6);
      const rf = clamp(1.18 - 0.30 * Math.log10(band.kDa) * shape, 0.03, 0.97);
      const target = rf * 9;
      out[`p${i}`] = (target - y[`p${i}`]) / tau;
    });
    return out;
  },
  series: PROTEIN_LADDER.map((band, i) => ({
    key: `p${i}`,
    label: `${band.kDa} kDa`,
    color: band.color,
  })),
  chart: { title: "Migration of the ladder", xLabel: "Time (min)", yLabel: "Distance (cm)" },
  metrics(y, p) {
    const off = PROTEIN_LADDER.map((_, i) => y[`p${i}`]);
    let gap = Infinity;
    for (let i = 1; i < off.length; i++) gap = Math.min(gap, Math.abs(off[i] - off[i - 1]));
    return [
      { label: "66 kDa position", value: nf(y.p2, 2), unit: "cm" },
      { label: "Closest bands", value: nf(gap * 10, 1), unit: "mm", note: gap * 10 > 1 ? "resolved" : "overlapping" },
      { label: "Load", value: nf(p.load, 0), unit: "µg", note: p.load > 40 ? "overloaded" : "linear range" },
      { label: "Front reached", value: nf((Math.max(...off) / 9) * 100, 0), unit: "%" },
    ];
  },
  notes(y, p) {
    const out = [];
    out.push(
      p.acrylamide >= 12
        ? "A high-percentage gel resolves small proteins well but compresses species above 100 kDa at the top."
        : p.acrylamide <= 8
          ? "Low-percentage gel: large proteins enter, small ones run with the front and lose resolution."
          : "10–12 % acrylamide is the general-purpose window for 15–150 kDa.",
    );
    if (p.load > 40) out.push("Above ~40 µg per lane bands saturate; densitometry is no longer linear.");
    if (p.reducing === "native") out.push("Non-reducing conditions preserve disulfide-bonded complexes, so MW is that of the oligomer.");
    return out;
  },
  tables(y) {
    return [
      table(
        "Ladder calibration",
        ["Protein", "log10(MW)", "Distance (cm)", "Rf"],
        PROTEIN_LADDER.map((band, i) => [
          `${band.kDa} kDa`,
          nf(Math.log10(band.kDa), 2),
          nf(y[`p${i}`], 2),
          nf(y[`p${i}`] / 9, 2),
        ]),
      ),
    ];
  },
  checks() {
    return [between("66 kDa band position", 3, 7, 5.4, "cm")];
  },
};

/* ==========================================================================
   12 · ELISA — binding, enzyme amplification, 4PL calibration
   ========================================================================== */
const ELISA = {
  id: "elisa",
  name: "ELISA",
  method: "ODE · Langmuir binding + enzyme kinetics",
  about:
    "Antigen–antibody equilibrium sets the fraction bound; the enzyme conjugate converts substrate at a Michaelis–Menten rate to give OD450. The calibration curve is a 4-parameter logistic.",
  kind: "ode",
  dt: 0.2,
  tEnd: 120,
  rate: 6,
  tUnit: "min",
  params: [
    P("antigen", "Antigen", 100, 1, 2000, 1, "pg/mL"),
    P("antibody", "Capture antibody", 2.0, 0.1, 10, 0.1, "µg/mL"),
    P("kd", "K_D", 1.0, 0.05, 20, 0.05, "nM"),
    P("substrate", "Substrate", 1.0, 0.1, 5, 0.1, "mM"),
    P("wash", "Wash steps", 4, 0, 8, 1, ""),
    P("blocking", "Blocking", 60, 0, 120, 5, "min"),
  ],
  init() {
    return { bound: 0, product: 0, background: 0 };
  },
  deriv(t, y, p) {
    const kon = 0.9;
    const koff = kon * p.kd * 1e-9 * 1000;
    const antigenNorm = Math.log10(1 + p.antigen / 10) / 2.3;
    const block = clamp(p.blocking / 60, 0, 1);
    const washEfficiency = 1 - Math.exp(-p.wash / 3);
    const nonSpecific = 0.06 * (1 - block) * (1 - washEfficiency * 0.7);
    const vmax = 0.021 * Math.pow(p.substrate / 1.0, 0.4);
    return {
      bound: kon * antigenNorm * (1 - y.bound) - koff * y.bound,
      product: (vmax * y.bound * (1 - y.product / 3.2)) - 0.0006 * y.product,
      background: nonSpecific * 0.02,
    };
  },
  series: [
    { key: "product", label: "OD450", color: C.teal, fill: "rgba(46,230,197,0.10)" },
    { key: "bound", label: "Fraction bound", color: C.violet },
  ],
  chart: { title: "Signal development", xLabel: "Time (min)", yLabel: "OD450 / fraction" },
  metrics(y, p) {
    const od = y.product;
    const lod = 0.05 * 3;
    const sn = od / Math.max(1e-9, y.background + 0.02);
    return [
      { label: "OD450", value: nf(od, 3), note: od > 0.1 && od < 3 ? "in range" : "out of range" },
      { label: "Bound fraction", value: nf(y.bound, 3) },
      { label: "S/N", value: nf(sn, 1), note: sn > 3 ? "detected" : "at limit" },
      { label: "LOD", value: nf(lod, 2), unit: "OD" },
      { label: "Hook check", value: p.antigen > 1500 ? "possible" : "clear" },
    ];
  },
  notes(y, p) {
    const out = [];
    if (y.product > 3) out.push("OD is above the linear range; diluting the sample keeps the 4PL fit valid.");
    if (p.antigen > 1500) out.push("Very high antigen can saturate both capture sites — the classic high-dose hook effect depresses signal.");
    if (p.wash < 3) out.push("Too few washes leave unbound conjugate, inflating background across every well.");
    if (p.blocking < 30) out.push("Short blocking leaves plastic exposed; non-specific binding lifts the blank.");
    return out;
  },
  tables(y, p) {
    const rows = [];
    for (let logC = 0; logC <= 3.4; logC += 0.4) {
      const conc = Math.pow(10, logC);
      const od = 3.0 / (1 + Math.pow(120 / conc, 1.15));
      rows.push([`${nf(conc, 0)} pg/mL`, nf(od, 3)]);
    }
    return [table("Calibration curve (4PL)", ["Concentration", "OD450"], rows, "a=3.0, b=1.15, c=120")];
  },
  checks() {
    const signal = fourPL(100, 3.0, 1.15, 120, 0);
    return [between("OD at 100 pg/mL", 0.8, 2.5, signal, "OD")];
  },
};

export const MOLECULAR_B = [CRISPR, CENTRAL_DOGMA, SANGER, BLOTTING, SDS_PAGE, ELISA];
