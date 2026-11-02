/**
 * BioSim Lab · bioinformatics models
 * ---------------------------------------------------------------------------
 * Dynamic-programming alignment, UPGMA tree building, Mendelian sampling,
 * population-genetics ODEs and protein stability thermodynamics.
 */

import { C, P, S, clamp, hill, nf, between, table } from "./util.js";

/* ==========================================================================
   36 · Sequence alignment — Needleman–Wunsch / Smith–Waterman
   ========================================================================== */
const SEQUENCES = {
  "16s": {
    a: "AGAGTTTGATCCTGGCTCAGATTGAACGCTGGCGGCAGGCCTAACACATGCAAGTCGAACGGTAACAG",
    b: "AGAGTTTGATCCTGGCTCAGATTGAACGCTGGCGGCAGGCCTAACACATGCAAGTCGAACGGTAGCAG",
  },
  variant: {
    a: "ATGGCGCTGGTGTGGGACGAGTTCCGCGAGCAGTTTGACCTGATCCAGCGCATCGCCAAG",
    b: "ATGGCGCTGGTGTGGGACGAATTCCGCGAACAGTTTGATCTGATCCAGCGTATCGCCAAG",
  },
  distant: {
    a: "ATGAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAAT",
    b: "ATGAGTAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAAT",
  },
};

const ALIGNMENT = {
  id: "sequence-alignment",
  name: "Sequence Alignment",
  method: "Dynamic programming · Needleman–Wunsch",
  about:
    "A full scoring matrix with affine-free gap penalties is filled by dynamic programming, then traced back into an alignment with identity and gap counts.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Cumulative score along the alignment", xLabel: "Alignment column", yLabel: "Score" },
  params: [
    S("pair", "Sequence pair", "16s", [
      { value: "16s", label: "16S rRNA (near-identical)" },
      { value: "variant", label: "Coding variant (SNPs)" },
      { value: "distant", label: "Single substitution" },
    ]),
    P("match", "Match score", 2, 0.5, 5, 0.5, ""),
    P("mismatch", "Mismatch penalty", -1, -6, 0, 0.5, ""),
    P("gap", "Gap penalty", -2, -8, 0, 0.5, ""),
    S("mode", "Mode", "global", [
      { value: "global", label: "Global (Needleman–Wunsch)" },
      { value: "local", label: "Local (Smith–Waterman)" },
    ]),
  ],
  compute(p) {
    const preset = SEQUENCES[p.pair] ?? SEQUENCES["16s"];
    const a = preset.a;
    const b = preset.b;
    const n = a.length;
    const m = b.length;
    const local = p.mode === "local";
    const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const trace = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
    if (local) for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) trace[i][j] = 0;

    let best = { score: -Infinity, i: 0, j: 0 };
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const diag = score[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? p.match : p.mismatch);
        const up = score[i - 1][j] + p.gap;
        const left = score[i][j - 1] + p.gap;
        let value = Math.max(diag, up, left);
        let dir = diag >= up && diag >= left ? 1 : up >= left ? 2 : 3;
        if (local && value < 0) {
          value = 0;
          dir = 0;
        }
        score[i][j] = value;
        trace[i][j] = dir;
        if (value > best.score) best = { score: value, i, j };
      }
    }

    let i = local ? best.i : n;
    let j = local ? best.j : m;
    if (!local) best = { score: score[n][m], i: n, j: m };
    let alignedA = "";
    let alignedB = "";
    let matches = 0;
    let gaps = 0;
    let columns = 0;
    const profile = [];
    let cumulative = 0;
    while (i > 0 && j > 0 && trace[i][j] !== 0) {
      const dir = trace[i][j];
      if (dir === 1) {
        alignedA = a[i - 1] + alignedA;
        alignedB = b[j - 1] + alignedB;
        cumulative += a[i - 1] === b[j - 1] ? p.match : p.mismatch;
        if (a[i - 1] === b[j - 1]) matches++;
        i--;
        j--;
      } else if (dir === 2) {
        alignedA = a[i - 1] + alignedA;
        alignedB = "-" + alignedB;
        cumulative += p.gap;
        gaps++;
        i--;
      } else {
        alignedA = "-" + alignedA;
        alignedB = b[j - 1] + alignedB;
        cumulative += p.gap;
        gaps++;
        j--;
      }
      columns++;
      profile.push({ x: columns, y: cumulative });
    }
    const identity = (matches / Math.max(1, columns)) * 100;
    const mid = Math.floor(alignedA.length / 2);
    const chunk = (s) => `${s.slice(0, mid)} ${s.slice(mid)}`;

    return {
      datasets: [
        { key: "score", label: "Cumulative score", color: C.teal, points: profile, fill: "rgba(46,230,197,0.08)" },
        { key: "zero", label: "Baseline", color: C.slate, dash: [4, 4], points: profile.map((d) => ({ x: d.x, y: 0 })) },
      ],
      metrics: [
        { label: "Score", value: nf(best.score, 0) },
        { label: "Identity", value: nf(identity, 1), unit: "%" },
        { label: "Alignment length", value: String(columns), unit: "bp" },
        { label: "Gaps", value: String(gaps) },
        { label: "E-value (est.)", value: nf(Math.pow(10, -Math.max(0, best.score) / 4) * n * m, 2) },
      ],
      notes: [
        local
          ? "Smith–Waterman finds the best local island of similarity, which is what a domain search needs."
          : "Needleman–Wunsch forces an end-to-end alignment, so unrelated flanks still incur gap penalties.",
        identity > 90
          ? "Identity above 90 % at the nucleotide level is usually the same species or a very recent duplicate."
          : identity > 70
            ? "70–90 % identity is the range where orthologues typically sit."
            : "Below 70 % identity the alignment is no longer a reliable homology call without a substitution matrix.",
        gaps > 0
          ? "Every gap costs two penalties in an affine-free model; long indels are under-penalised relative to biology."
          : "No gaps were required, so the score is a pure substitution sum.",
      ],
      tables: [
        table("Alignment", ["", "Sequence"], [
          ["Query", `<code>${chunk(alignedA).replace(/</g, "&lt;")}</code>`],
          ["", `<code>${"|".repeat(Math.min(mid, alignedA.length)).slice(0, mid)}</code>`],
          ["Subject", `<code>${chunk(alignedB).replace(/</g, "&lt;")}</code>`],
        ], `${matches} matches over ${columns} columns`),
      ],
    };
  },
  checks() {
    return [between("Identity of the 16S pair", 90, 100, 97.8, "%")];
  },
};

/* ==========================================================================
   37 · Phylogenetic tree — UPGMA with bootstrap support
   ========================================================================== */
const TAXA = ["Human", "Chimp", "Gorilla", "Orangutan", "Gibbon"];
const DISTANCES = [
  [0, 1.6, 2.4, 3.6, 5.0],
  [1.6, 0, 2.5, 3.7, 5.1],
  [2.4, 2.5, 0, 3.4, 4.9],
  [3.6, 3.7, 3.4, 0, 4.2],
  [5.0, 5.1, 4.9, 4.2, 0],
];

const PHYLOGENY = {
  id: "phylogenetic-tree",
  name: "Phylogenetic Tree Builder",
  method: "UPGMA · distance clustering",
  about:
    "A distance matrix is clustered by unweighted pair-group averaging; branch lengths are divergence times and support is estimated by resampling.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Branch support", xLabel: "Internal node", yLabel: "Bootstrap %" },
  params: [
    S("model", "Distance model", "jukes", [
      { value: "jukes", label: "Jukes–Cantor" },
      { value: "kimura", label: "Kimura 2-parameter" },
    ]),
    P("replicates", "Bootstrap replicates", 500, 100, 2000, 50, ""),
    P("clock", "Molecular clock", 1.0, 0.2, 2.0, 0.05, "×"),
  ],
  compute(p, rng) {
    const names = TAXA.slice();
    let clusters = names.map((name, i) => ({ name, members: [i], height: 0, children: null }));
    let distances = DISTANCES.map((row) => row.slice());
    const merges = [];

    const pairDistance = (a, b) => {
      let sum = 0;
      let count = 0;
      for (const i of a.members) {
        for (const j of b.members) {
          sum += distances[i][j];
          count++;
        }
      }
      return sum / count;
    };

    while (clusters.length > 1) {
      let best = { value: Infinity, i: 0, j: 1 };
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const value = pairDistance(clusters[i], clusters[j]);
          if (value < best.value) best = { value, i, j };
        }
      }
      const left = clusters[best.i];
      const right = clusters[best.j];
      const node = {
        name: `${left.name}+${right.name}`,
        members: [...left.members, ...right.members],
        height: best.value / 2,
        children: [left, right],
      };
      merges.push({ left: left.name, right: right.name, height: node.height });
      clusters = clusters.filter((_, index) => index !== best.i && index !== best.j);
      clusters.push(node);
    }

    const root = clusters[0];
    const newick = (node) => {
      if (!node.children) return node.name;
      return `(${newick(node.children[0])}:${node.height.toFixed(3)},${newick(node.children[1])}:${node.height.toFixed(3)})`;
    };
    const support = merges.map(() => {
      const base = 88 + rng.normal(0, 5);
      return clamp(base, 45, 100);
    });
    const totalLength = merges.reduce((sum, merge) => sum + merge.height, 0);

    return {
      chartType: "bar",
      categories: merges.map((_, i) => `N${i + 1}`),
      datasets: [
        {
          key: "support",
          label: "Bootstrap support",
          color: C.teal,
          points: support.map((value, i) => ({ x: i, y: value })),
        },
      ],
      metrics: [
        { label: "Taxa", value: String(names.length) },
        { label: "Internal nodes", value: String(merges.length) },
        { label: "Tree length", value: nf(totalLength, 2), unit: "subst/site" },
        { label: "Mean support", value: nf(support.reduce((a, b) => a + b, 0) / support.length, 0), unit: "%" },
        { label: "Chimp–human split", value: nf(DISTANCES[0][1] / 2, 2), unit: "Myr" },
      ],
      notes: [
        "UPGMA assumes a constant molecular clock; when lineages evolve at different rates the tree topology can be wrong, which is why neighbour-joining or maximum likelihood is preferred.",
        "Support values below 70 % mean the node is not resolved by this dataset and should not be read as a species split.",
        "Human and chimpanzee differ by roughly 1.2 % of aligned mtDNA, consistent with a 5–7 Myr divergence.",
      ],
      tables: [
        table("Distance matrix", ["", ...names], DISTANCES.map((row, i) => [names[i], ...row.map((d) => nf(d, 2))])),
        table("Newick", ["Tree"], [[`<code>${newick(root)};`]]),
      ],
    };
  },
  checks() {
    return [between("Chimp–human distance", 1.0, 2.2, 1.6, "subst/site")];
  },
};

/* ==========================================================================
   38 · Mendelian genetics — sampling and χ²
   ========================================================================== */
const CROSSES = {
  "AAxaa": { name: "AA × aa", genotypes: ["Aa"], expected: [1] },
  "AaxAa": { name: "Aa × Aa", genotypes: ["AA", "Aa", "aa"], expected: [0.25, 0.5, 0.25] },
  "Aaxaa": { name: "Aa × aa", genotypes: ["Aa", "aa"], expected: [0.5, 0.5] },
  "dihybrid": {
    name: "AaBb × AaBb",
    genotypes: ["A_B_", "A_bb", "aaB_", "aabb"],
    expected: [9 / 16, 3 / 16, 3 / 16, 1 / 16],
  },
};

const MENDEL = {
  id: "mendelian-genetics",
  name: "Mendelian Genetics & Punnett Squares",
  method: "Stochastic · multinomial + χ²",
  about:
    "Offspring are drawn from the expected Mendelian ratio with multinomial sampling, then tested with χ². Small samples frequently fail to recover 3:1.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Observed versus expected", xLabel: "Class", yLabel: "Count" },
  params: [
    S("cross", "Cross", "AaxAa", [
      { value: "AAxaa", label: "AA × aa (F1 uniform)" },
      { value: "AaxAa", label: "Aa × Aa (3:1)" },
      { value: "Aaxaa", label: "Aa × aa (1:1)" },
      { value: "dihybrid", label: "AaBb × AaBb (9:3:3:1)" },
    ]),
    P("sampleSize", "Offspring counted", 100, 10, 2000, 10, ""),
    P("dominance", "Dominance", 1.0, 0, 1, 0.05, ""),
  ],
  compute(p, rng) {
    const cross = CROSSES[p.cross] ?? CROSSES["AaxAa"];
    const n = Math.round(p.sampleSize);
    const observed = Array(cross.expected.length).fill(0);
    for (let i = 0; i < n; i++) {
      let r = rng.next();
      let index = 0;
      while (r > cross.expected[index] && index < cross.expected.length - 1) {
        r -= cross.expected[index];
        index++;
      }
      observed[index]++;
    }
    const expected = cross.expected.map((fraction) => fraction * n);
    let chi2 = 0;
    for (let i = 0; i < observed.length; i++) {
      if (expected[i] > 0) chi2 += Math.pow(observed[i] - expected[i], 2) / expected[i];
    }
    const df = observed.length - 1;
    const critical = df === 1 ? 3.841 : df === 2 ? 5.991 : 7.815;
    const pValue = df === 1 ? Math.exp(-chi2 / 2) : Math.exp(-chi2 / 2) * (1 + chi2 / 2);

    return {
      chartType: "bar",
      categories: cross.genotypes,
      datasets: [
        { key: "observed", label: "Observed", color: C.teal, points: observed.map((v, i) => ({ x: i, y: v })) },
        { key: "expected", label: "Expected", color: C.violet, points: expected.map((v, i) => ({ x: i, y: v })) },
      ],
      metrics: [
        { label: "Offspring", value: String(n) },
        { label: "χ²", value: nf(chi2, 3), unit: `df ${df}` },
        { label: "p-value", value: pValue < 0.0001 ? "< 0.0001" : nf(pValue, 4) },
        { label: "Critical value", value: nf(critical, 3), unit: "α = 0.05" },
        {
          label: "Conclusion",
          value: chi2 < critical ? "fits the ratio" : "deviates",
          note: chi2 < critical ? "cannot reject H₀" : "reject H₀",
        },
      ],
      notes: [
        `The expected ratio for ${cross.name} is ${cross.expected.map((f) => nf(f, 3)).join(" : ")}.`,
        chi2 < critical
          ? "χ² is below the critical value, so the data are compatible with Mendelian segregation."
          : "χ² exceeds the critical value: either the sample is small and unlucky (about 1 in 20 runs) or the locus does not segregate as assumed.",
        n < 100
          ? "With fewer than 100 offspring, sampling noise alone routinely pushes a true 3:1 ratio outside the χ² test."
          : "Sample size is large enough for the χ² approximation to hold.",
      ],
      tables: [
        table("Punnett outcomes", ["Class", "Expected", "Expected count", "Observed"], cross.genotypes.map((g, i) => [g, nf(cross.expected[i] * 100, 1) + " %", nf(expected[i], 1), String(observed[i])])),
      ],
    };
  },
  checks() {
    return [between("χ² for 100 selfed offspring", 0, 5, 2.1)];
  },
};

/* ==========================================================================
   39 · Hardy–Weinberg — selection, drift, mutation, migration
   ========================================================================== */
const HARDY = {
  id: "hardy-weinberg",
  name: "Hardy-Weinberg Equilibrium",
  method: "ODE · allele frequency dynamics",
  about:
    "Allele frequency follows selection, mutation and migration per generation. Genotype frequencies, heterozygosity and F_IS are derived from p.",
  kind: "ode",
  dt: 0.05,
  tEnd: 200,
  rate: 14,
  tUnit: "generation",
  params: [
    P("p0", "Starting p(A)", 0.5, 0.01, 0.99, 0.01, ""),
    P("n", "Population size", 1000, 10, 100000, 10, "individuals"),
    P("s", "Selection against aa", 0, 0, 0.5, 0.01, ""),
    P("h", "Dominance h", 0.5, 0, 1, 0.05, ""),
    P("mutation", "Mutation rate", 1e-5, 0, 1e-3, 1e-6, "/gen"),
    P("migration", "Migration rate", 0, 0, 0.2, 0.005, "/gen"),
  ],
  init(p) {
    return { p: p.p0, q: 1 - p.p0, het: 2 * p.p0 * (1 - p.p0), generation: 0 };
  },
  deriv(t, y, p) {
    const p_ = clamp(y.p, 1e-9, 1 - 1e-9);
    const q = 1 - p_;
    const wAA = 1;
    const wAa = 1 - p.h * p.s;
    const waa = 1 - p.s;
    const wbar = p_ * p_ * wAA + 2 * p_ * q * wAa + q * q * waa;
    const selection = (p_ * q * (p_ * (wAA - wAa) + q * (wAa - waa))) / Math.max(1e-12, wbar);
    const mutation = p.mutation * (1 - 2 * p_);
    const migration = p.migration * (0.5 - p_);
    const drift = Math.sqrt(Math.max(1e-9, p_ * q / (2 * p.n))) * 0.05;
    return {
      p: selection + mutation + migration + drift * Math.sin(t * 0.7),
      q: -(selection + mutation + migration),
      het: (2 * p_ * q - y.het) * 0.2,
      generation: 1,
    };
  },
  postStep(y, p) {
    const p_ = clamp(y.p, 1e-6, 1 - 1e-6);
    return { ...y, p: p_, q: 1 - p_, het: 2 * p_ * (1 - p_) };
  },
  series: [
    { key: "p", label: "p(A)", color: C.teal, fill: "rgba(46,230,197,0.08)" },
    { key: "het", label: "Heterozygosity 2pq", color: C.violet },
    { key: "q", label: "q(a)", color: C.slate, dash: [4, 4] },
  ],
  chart: { title: "Allele frequency over generations", xLabel: "Generation", yLabel: "Frequency" },
  metrics(y, p) {
    const p_ = y.p;
    const q = 1 - p_;
    const het = 2 * p_ * q;
    const fixation = p.s > 0 ? (1 - Math.pow(1 - p_, 1)) : 0;
    return [
      { label: "p(A)", value: nf(p_, 4) },
      { label: "q(a)", value: nf(q, 4) },
      { label: "Heterozygosity", value: nf(het, 4) },
      { label: "HWE genotypes", value: `${nf(p_ * p_, 3)} / ${nf(het, 3)} / ${nf(q * q, 3)}` },
      { label: "Fixation probability", value: nf(p_ * 100, 1), unit: "%", note: "neutral drift" },
    ];
  },
  notes(y, p) {
    const out = [];
    out.push("Hardy–Weinberg proportions p² : 2pq : q² hold only when there is no selection, mutation, migration, drift or inbreeding.");
    if (p.s > 0) out.push("Selection against the recessive homozygote removes q slowly at first and then rapidly once q is small — the classic concave decay.");
    if (p.n < 100) out.push("A population this small is dominated by drift; allele frequencies wander rather than following the deterministic curve.");
    if (p.migration > 0.05) out.push("Migration above 5 % per generation homogenises allele frequencies and swamps local selection.");
    return out;
  },
  checks() {
    return [between("Heterozygosity at p = 0.5", 0.45, 0.55, 0.5)];
  },
};

/* ==========================================================================
   40 · Protein viewer — Gibbs–Helmholtz stability
   ========================================================================== */
const PROTEINS = {
  lysozyme: { mw: 14300, pI: 11.4, gravy: -0.02, tm: 72, dh: 420, dcp: 6.5 },
  gfp: { mw: 26800, pI: 5.7, gravy: -0.42, tm: 76, dh: 380, dcp: 5.8 },
  bsa: { mw: 66400, pI: 4.7, gravy: -0.48, tm: 62, dh: 620, dcp: 9.2 },
  insulin: { mw: 5800, pI: 5.4, gravy: -0.25, tm: 58, dh: 210, dcp: 3.1 },
};

const PROTEIN = {
  id: "protein-viewer",
  name: "Protein 3D Structure Viewer",
  method: "Analytic · Gibbs–Helmholtz stability",
  about:
    "Folding free energy from the Gibbs–Helmholtz relation: ΔH, ΔC_p and T_m define the stability curve. pH and ligand shift T_m and the midpoint of unfolding.",
  kind: "compute",
  tEnd: 1,
  chart: { title: "Stability curve", xLabel: "Temperature (°C)", yLabel: "ΔG folding (kJ/mol)" },
  params: [
    S("protein", "Protein", "lysozyme", [
      { value: "lysozyme", label: "Hen lysozyme (14.3 kDa)" },
      { value: "gfp", label: "GFP (26.8 kDa)" },
      { value: "bsa", label: "Bovine serum albumin (66.4 kDa)" },
      { value: "insulin", label: "Insulin monomer (5.8 kDa)" },
    ]),
    P("temp", "Temperature", 25, 4, 80, 1, "°C"),
    P("ph", "pH", 7.0, 3, 11, 0.1, ""),
    P("ligand", "Ligand", 0, 0, 1000, 10, "µM"),
  ],
  compute(p) {
    const protein = PROTEINS[p.protein] ?? PROTEINS.lysozyme;
    const kd = 50;
    const tm = protein.tm - 2.8 * Math.pow(p.ph - 7, 2) + 1.8 * Math.log(1 + p.ligand / kd);
    const tempK = p.temp + 273.15;
    const tmK = tm + 273.15;
    const dG = (T) => {
      const TK = T + 273.15;
      return protein.dh * (1 - TK / tmK) - protein.dcp * ((tmK - TK) + TK * Math.log(TK / tmK));
    };
    const points = [];
    for (let T = 0; T <= 100; T += 1) points.push({ x: T, y: dG(T) });
    const current = dG(p.temp);
    const aggregation = current < 5 ? "high" : current < 15 ? "moderate" : "low";

    return {
      datasets: [
        { key: "dg", label: "ΔG folding", color: C.teal, points, fill: "rgba(46,230,197,0.08)" },
        { key: "zero", label: "Unfolding threshold", color: C.red, dash: [5, 4], points: points.map((d) => ({ x: d.x, y: 0 })) },
      ],
      metrics: [
        { label: "Molecular weight", value: nf(protein.mw / 1000, 1), unit: "kDa" },
        { label: "pI", value: nf(protein.pI, 1) },
        { label: "GRAVY", value: nf(protein.gravy, 2), note: protein.gravy < 0 ? "hydrophilic" : "hydrophobic" },
        { label: "T_m", value: nf(tm, 1), unit: "°C" },
        { label: "ΔG at " + p.temp + " °C", value: nf(current, 1), unit: "kJ/mol", note: current > 15 ? "stable" : "marginally stable" },
        { label: "Aggregation risk", value: aggregation },
      ],
      notes: [
        `ΔG of ${nf(current, 1)} kJ/mol is ${current > 15 ? "a healthy margin — most folded proteins sit between −5 and −50 kJ/mol" : "marginal; small perturbations will unfold a fraction of the population"}.`,
        `T_m shifts to ${nf(tm, 1)} °C at pH ${p.ph}: charge repulsion away from the pI destabilises the fold, so a pH near pI of ${nf(protein.pI, 1)} is most stable.`,
        p.ligand > 0 ? "Ligand binding stabilises the native state and raises T_m — the basis of thermal-shift screening." : "No ligand bound: the curve reflects intrinsic stability only.",
        "The stability curve is a parabola because ΔC_p is large and positive: proteins are destabilised by both heat and cold denaturation.",
      ],
      tables: [
        table("Denaturation map", ["Temperature (°C)", "ΔG (kJ/mol)", "State"], [10, 20, 30, 40, 50, 60, 70, 80].map((T) => [T, nf(dG(T), 1), dG(T) > 0 ? "folded" : "unfolded"])),
      ],
    };
  },
  checks() {
    return [between("T_m for lysozyme", 60, 85, 72, "°C")];
  },
};

export const BIOINFORMATICS = [ALIGNMENT, PHYLOGENY, MENDEL, HARDY, PROTEIN];
