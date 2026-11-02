/**
 * BioSim Lab · engine/results-engine.js
 * ---------------------------------------------------------------------------
 * Turns the final bench state into a result: an observations table, a score
 * across four independent axes, a written conclusion, a mistake review and a
 * print-ready lab report.
 *
 * The engine never invents numbers. Every observation is computed by the
 * experiment from its own live state and handed in via `observe()`.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-3)) return value.toExponential(2);
  return Number(value.toFixed(digits)).toString();
}

/* ==========================================================================
   Plotting — used for the result graph (semi-log included)
   ========================================================================== */
export function drawSeries(canvas, { series = [], xLabel = "", yLabel = "", logY = false } = {}) {
  if (!canvas || typeof canvas.getContext !== "function") return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(240, rect.width || canvas.width);
  const height = Math.max(160, rect.height || canvas.height);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 54, right: 14, top: 12, bottom: 32 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const points = series.flatMap((entry) => entry.points || []);
  if (!points.length) return;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const point of points) {
    const y = logY ? Math.log10(Math.max(1e-12, point.y)) : point.y;
    if (!Number.isFinite(point.x) || !Number.isFinite(y)) continue;
    xMin = Math.min(xMin, point.x);
    xMax = Math.max(xMax, point.x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  if (!Number.isFinite(xMin)) return;
  if (xMax - xMin < 1e-9) xMax = xMin + 1;
  if (yMax - yMin < 1e-9) {
    yMin -= 0.5;
    yMax += 0.5;
  }
  const padY = (yMax - yMin) * 0.08;
  yMin -= padY;
  yMax += padY;

  const project = (x, y) => ({
    px: pad.left + ((x - xMin) / (xMax - xMin)) * plotW,
    py: pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH,
  });

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.fillStyle = "rgba(154,176,171,0.9)";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.lineWidth = 1;

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const value = yMin + ((yMax - yMin) * i) / yTicks;
    const { py } = project(xMin, value);
    ctx.beginPath();
    ctx.moveTo(pad.left, py);
    ctx.lineTo(pad.left + plotW, py);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(fmt(logY ? Math.pow(10, value) : value, 2), pad.left - 8, py);
  }

  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const value = xMin + ((xMax - xMin) * i) / xTicks;
    const { px } = project(value, yMin);
    ctx.beginPath();
    ctx.moveTo(px, pad.top);
    ctx.lineTo(px, pad.top + plotH);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(fmt(value, 2), px, pad.top + plotH + 6);
  }

  ctx.fillStyle = "rgba(154,176,171,0.9)";
  ctx.textAlign = "left";
  ctx.fillText(xLabel, pad.left, pad.top + plotH + 18);
  ctx.save();
  ctx.translate(12, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  for (const entry of series) {
    const valid = (entry.points || []).filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    );
    if (valid.length < 2) continue;
    ctx.beginPath();
    valid.forEach((point, index) => {
      const y = logY ? Math.log10(Math.max(1e-12, point.y)) : point.y;
      const { px, py } = project(point.x, y);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = entry.color || "#2ee6c5";
    ctx.lineWidth = entry.width || 2;
    ctx.setLineDash(entry.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (entry.pointsVisible) {
      for (const point of valid) {
        const y = logY ? Math.log10(Math.max(1e-12, point.y)) : point.y;
        const { px, py } = project(point.x, y);
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = entry.color || "#2ee6c5";
        ctx.fill();
      }
    }
  }
}

/* ==========================================================================
   ResultsEngine
   ========================================================================== */
export class ResultsEngine {
  /**
   * @param {{state?: object, log?: object, procedure?: object, safety?: object, experiment?: object}} deps
   */
  constructor({ state = null, log = null, procedure = null, safety = null, experiment = {} } = {}) {
    this.state = state;
    this.log = log;
    this.procedure = procedure;
    this.safety = safety;
    this.experiment = experiment;
    this.observationSpec = [];
  }

  /**
   * Register one measured value.
   * @param {{id: string, label: string, unit?: string, expected?: number|string,
   *          actual?: number|string, tolerance?: number, pass?: boolean,
   *          note?: string}} spec
   */
  observe(spec) {
    this.observationSpec.push(spec);
    return this;
  }

  observations() {
    return this.observationSpec.map((spec) => {
      const { expected, actual, tolerance } = spec;
      let pass = spec.pass;
      if (pass === undefined) {
        if (typeof expected === "number" && typeof actual === "number") {
          const tol = tolerance ?? Math.max(0.05 * Math.abs(expected), 1e-9);
          pass = Math.abs(actual - expected) <= tol;
        } else if (expected !== undefined && actual !== undefined) {
          pass = String(expected) === String(actual);
        } else {
          pass = true;
        }
      }
      return {
        id: spec.id,
        label: spec.label,
        unit: spec.unit ?? "",
        expected: expected === undefined ? "—" : expected,
        actual: actual === undefined ? "—" : actual,
        pass,
        note: spec.note ?? "",
      };
    });
  }

  /**
   * @param {{timeLimitSeconds?: number, durationSeconds?: number}} options
   */
  score({ timeLimitSeconds = null, durationSeconds = null } = {}) {
    const observations = this.observations();
    const passed = observations.filter((item) => item.pass).length;
    const accuracy = observations.length ? passed / observations.length : 0;

    const mistakes = this.procedure?.mistakes?.items?.length ?? 0;
    const criticals = this.procedure?.mistakes?.critical?.() ?? 0;
    const progress = this.procedure?.progress?.() ?? { percent: 0 };
    const technique = clamp(
      (progress.percent / 100) * 60 + Math.max(0, 40 - mistakes * 8 - criticals * 6),
      0,
      100,
    );

    const safetyReport = this.safety?.summary?.(0) ?? { score: 100 };
    const safetyScore = safetyReport.score;

    const used = durationSeconds ?? this.log?.elapsed?.() ?? 0;
    let timeScore = 100;
    if (timeLimitSeconds) {
      const ratio = used / timeLimitSeconds;
      timeScore = clamp(100 - Math.max(0, ratio - 0.6) * 140, 0, 100);
    }

    const total = Math.round(
      accuracy * 40 + technique * 0.3 + safetyScore * 0.15 + timeScore * 0.15,
    );

    return {
      total,
      accuracy: Math.round(accuracy * 100),
      technique: Math.round(technique),
      safety: Math.round(safetyScore),
      time: Math.round(timeScore),
      grade: total >= 90 ? "A" : total >= 80 ? "B" : total >= 70 ? "C" : total >= 60 ? "D" : "F",
      passed,
      observations: observations.length,
      mistakes,
      durationSeconds: Math.round(used),
      breakdown: [
        { label: "Accuracy", weight: 40, value: Math.round(accuracy * 100) },
        { label: "Technique", weight: 30, value: Math.round(technique) },
        { label: "Safety", weight: 15, value: Math.round(safetyScore) },
        { label: "Time", weight: 15, value: Math.round(timeScore) },
      ],
    };
  }

  /** Short written conclusion derived from the observations, not from prose. */
  conclusion() {
    const observations = this.observations();
    const failures = observations.filter((item) => !item.pass);
    const progress = this.procedure?.progress?.() ?? { complete: true, percent: 100 };

    if (!progress.complete) {
      return `The procedure was not finished (${progress.percent} % of required steps), so the result cannot be reported as a valid run. Complete the remaining steps and repeat.`;
    }
    if (failures.length === 0) {
      return `All ${observations.length} measured checks fall inside their expected ranges. The result is consistent with the intended protocol and can be reported.`;
    }
    return `${observations.length - failures.length} of ${observations.length} checks passed. The run deviates on: ${failures
      .map((item) => item.label)
      .join(", ")}. Those deviations are explained by the actions listed in the mistake review.`;
  }

  /** "What went wrong and why" — one row per recorded mistake. */
  mistakesReview() {
    const items = this.procedure?.mistakes?.items ?? [];
    if (!items.length) {
      return [
        {
          action: "No procedural mistakes recorded",
          why: "Every step was performed in an acceptable order.",
          fix: "Keep the same sequence when you repeat the protocol.",
          severity: "none",
        },
      ];
    }
    return items.map((item) => ({
      action: item.action,
      why: item.why,
      fix: item.fix,
      severity: item.severity,
    }));
  }

  /** Data for the auto-graph. Experiments supply the series. */
  graph(series = []) {
    return { series };
  }

  /**
   * Self-contained printable report. Styles are scoped to the report body so
   * the document can be opened standalone or sent to window.print().
   */
  reportHTML({ title = "Lab report", subtitle = "", series = [], extraSections = [] } = {}) {
    const score = this.score({ durationSeconds: this.log?.elapsed?.() ?? 0 });
    const observations = this.observations();
    const mistakes = this.mistakesReview();

    const obsRows = observations
      .map(
        (item) => `<tr class="${item.pass ? "ok" : "bad"}">
          <td>${esc(item.label)}</td>
          <td>${esc(item.expected)}</td>
          <td>${esc(item.actual)}${item.unit ? ` ${esc(item.unit)}` : ""}</td>
          <td>${item.pass ? "pass" : "deviation"}</td>
        </tr>`,
      )
      .join("");

    const mistakeRows = mistakes
      .map(
        (item) => `<tr>
          <td>${esc(item.action)}</td>
          <td>${esc(item.why)}</td>
          <td>${esc(item.fix)}</td>
        </tr>`,
      )
      .join("");

    const logLines = (this.log?.entries ?? [])
      .map((entry) => `<li><b>${esc(entry.clock)}</b> ${esc(entry.message)}</li>`)
      .join("");

    const seriesSummary = series
      .map((entry) => `<li>${esc(entry.label || entry.key || "series")}: ${(entry.points || []).length} points</li>`)
      .join("");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; margin: 32px; color: #122; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 26px 0 8px; text-transform: uppercase; letter-spacing: .06em; color: #466; }
  .sub { color: #567; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #dde; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #567; }
  tr.bad td { background: #fff1f2; }
  .score { display: flex; gap: 18px; flex-wrap: wrap; margin: 12px 0 4px; }
  .score div { border: 1px solid #dde; border-radius: 10px; padding: 10px 14px; min-width: 92px; }
  .score b { display: block; font-size: 20px; }
  .score span { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #567; }
  ul.log { list-style: none; padding: 0; font-size: 12.5px; }
  ul.log li { padding: 3px 0; border-bottom: 1px dotted #e2e8ec; }
  .conclusion { border-left: 3px solid #2ee6c5; padding: 8px 12px; background: #f4fbfa; }
  footer { margin-top: 28px; font-size: 11px; color: #789; }
  @media print { body { margin: 14mm; } h2 { break-after: avoid; } table { break-inside: auto; } }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(subtitle)}${subtitle ? " · " : ""}BioSim Lab · generated ${new Date().toLocaleString()}</p>

  <div class="score">
    <div><b>${score.total}</b><span>Total / 100</span></div>
    <div><b>${score.grade}</b><span>Grade</span></div>
    <div><b>${score.accuracy}%</b><span>Accuracy</span></div>
    <div><b>${score.technique}</b><span>Technique</span></div>
    <div><b>${score.safety}</b><span>Safety</span></div>
    <div><b>${LabClock(score.durationSeconds)}</b><span>Bench time</span></div>
  </div>

  <h2>Observations</h2>
  <table>
    <thead><tr><th>Measurement</th><th>Expected</th><th>Observed</th><th>Verdict</th></tr></thead>
    <tbody>${obsRows || '<tr><td colspan="4">No observations recorded.</td></tr>'}</tbody>
  </table>

  <h2>Conclusion</h2>
  <p class="conclusion">${esc(this.conclusion())}</p>

  <h2>What went wrong and why</h2>
  <table>
    <thead><tr><th>Action</th><th>Why it matters</th><th>Correction</th></tr></thead>
    <tbody>${mistakeRows}</tbody>
  </table>

  ${extraSections
    .map(
      (section) =>
        `<h2>${esc(section.title)}</h2>${section.html || `<p>${esc(section.text || "")}</p>`}`,
    )
    .join("")}

  ${seriesSummary ? `<h2>Recorded series</h2><ul>${seriesSummary}</ul>` : ""}

  <h2>Action log</h2>
  <ul class="log">${logLines || "<li>No actions logged.</li>"}</ul>

  <footer>Produced by BioSim Lab. Simulated values, not analytical measurements.</footer>
</body>
</html>`;
  }
}

function LabClock(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default ResultsEngine;
