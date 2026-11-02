/**
 * BioSim Lab · engine/hands-on.js
 * ---------------------------------------------------------------------------
 * The hands-on runner: everything that is identical between the forty
 * experiments, so each js/sims/<id>.js only has to describe
 *
 *   shelf / slots / procedure / controls / hazards   what the bench looks like
 *   tick(ctx, dt)                                    how the live state evolves
 *   refresh(ctx) -> {readouts, graph}                what the panel shows
 *   render(ctx) -> html                              the custom bench artwork
 *   finalize(ctx) -> {observations, series, ...}     how the run is scored
 *
 * It wires LabTable (bench shell) + LabState (undoable live state) +
 * Procedure/MistakeBook (ordering + mistake detection) + LabLog (audit trail)
 * + Safety (PPE) + ResultsEngine (observations, score, report) and adds the
 * parts every experiment needs: the live loop, instrument cards, the
 * five-question viva and the lab-report download.
 *
 * Every experiment registers itself in js/data/experiments.js with
 *   { sim: "./sims/<id>.js", simCss: "css/sim-<id>.css" }
 * and exports `mount(root, experiment, options)`.
 */

import { LabTable } from "./lab-table.js";
import { LabState, clone } from "./lab-state.js";
import { LabLog } from "./lab-log.js";
import { Procedure } from "./state-machine.js";
import { Safety } from "./safety.js";
import { ResultsEngine, drawSeries } from "./results-engine.js";
import { Instrument } from "./instruments.js";
import { rafLoop, escapeHTML, on, formatVolume } from "./util.js";
import { toast } from "../ui.js";

const PANEL_MS = 110;
const GRAPH_MS = 220;

/* ==========================================================================
   Procedure steps — spec wins, otherwise the registry's protocol steps
   ========================================================================== */
function buildSteps(experiment, spec) {
  if (Array.isArray(spec.procedure) && spec.procedure.length) {
    return spec.procedure.map((step, index) => ({
      id: step.id ?? `step-${index + 1}`,
      requires: [],
      optional: false,
      ...step,
    }));
  }
  return (experiment.steps ?? []).map((title, index) => ({
    id: `step-${index + 1}`,
    title,
    hint: title,
    requires: index === 0 ? [] : [`step-${index}`],
  }));
}

function buildInstruments(definition = {}) {
  const map = new Map();
  for (const [key, value] of Object.entries(definition)) {
    const type = typeof value === "string" ? value : value.type;
    const settings = typeof value === "string" ? {} : value.settings ?? {};
    map.set(key, new Instrument(type, { id: key, settings }));
  }
  return map;
}

/* ==========================================================================
   mountHandsOn
   ========================================================================== */
/**
 * @param {HTMLElement} root
 * @param {object} experiment registry entry (aim, principle, quiz, steps...)
 * @param {object} spec experiment definition — see file header
 * @param {{onExit?: Function, onQuizScore?: Function, onComplete?: Function,
 *          number?: number, categoryName?: string}} options
 */
export function mountHandsOn(root, experiment, spec = {}, options = {}) {
  const steps = buildSteps(experiment, spec);
  const procedure = new Procedure({ id: experiment.id, title: experiment.title, steps });
  const state = new LabState(clone(spec.initial ?? {}), { historyLimit: 80 });
  const log = new LabLog({ limit: 400 });
  const safety = new Safety({ required: spec.requiredPPE ?? ["coat", "gloves", "goggles"] });
  for (const hazard of spec.hazards ?? []) safety.addHazard(hazard);
  const results = new ResultsEngine({ state, log, procedure, safety, experiment });
  const instruments = buildInstruments(spec.instruments);
  const initial = clone(spec.initial ?? {});

  const table = new LabTable(root, {
    title: experiment.title,
    eyebrow:
      spec.eyebrow ??
      `Experiment ${String(options.number ?? 1).padStart(2, "0")}${
        options.categoryName ? ` · ${options.categoryName}` : ""
      }`,
    aim: experiment.aim,
    principle: experiment.principle,
    procedure: steps.map((step) => ({ title: step.title, hint: step.hint ?? "" })),
    shelf: spec.shelf ?? [],
    slots: spec.slots ?? [],
    mode: spec.mode ?? "guided",
  }).mount();

  /* ------------------------------------------------------------- context */
  let lastHtml = null;
  let completed = false;
  let quizScore = null;
  let stopping = false;
  let stopLoop = null;
  let lastPanel = 0;
  let lastGraph = 0;
  let lastHintId = null;
  const cleanups = [];

  const ctx = {
    experiment,
    spec,
    table,
    state,
    log,
    procedure,
    safety,
    results,
    instruments,
    visual: null,
    helpers: {},
  };

  /* --------------------------------------------------------------- extras */
  // Custom artwork area under the slots.
  const benchEl = table.els.root.querySelector(".labtable__bench");
  benchEl.insertAdjacentHTML(
    "beforeend",
    `<div class="ho-visual" data-visual hidden></div>`,
  );
  ctx.visual = benchEl.querySelector("[data-visual]");

  // PPE checklist + instrument cards live in the instrument panel.
  const panelBench = table.els.root.querySelector('[data-panel="bench"]');
  panelBench.insertAdjacentHTML(
    "afterbegin",
    `<div class="ho-ppe" data-ppe>
       <h3>Safety · PPE</h3>
       <div class="ho-ppe__list" data-ppe-list></div>
     </div>
     <div class="ho-instruments" data-instruments></div>`,
  );
  const ppeList = panelBench.querySelector("[data-ppe-list]");
  const instrumentPanel = panelBench.querySelector("[data-instruments]");

  // Viva tab.
  table.els.root
    .querySelector(".labtable__tabs")
    .insertAdjacentHTML(
      "beforeend",
      `<button type="button" role="tab" data-tab="quiz">Viva</button>`,
    );
  table.els.root
    .querySelector(".labtable__panel-body")
    .insertAdjacentHTML("beforeend", `<section data-panel="quiz" hidden data-quiz></section>`);
  const quizPanel = table.els.root.querySelector("[data-quiz]");

  const quiz = { index: 0, answers: [], done: false };

  /* --------------------------------------------------------------- notify */
  function notify(message, type = "info") {
    toast({ title: experiment.title, message, type });
    log.add(message, { type: type === "error" ? "error" : type === "success" ? "success" : "info" });
  }

  /* ---------------------------------------------------------- checkpoints */
  // The experiments mutate plain state, keep live values in ctx.helpers and
  // place items into slots, so undo has to restore all three (plus the
  // procedure book and instrument settings) rather than state alone.
  let checkpoints = [];
  let restoring = false;

  function benchSnapshot() {
    return {
      state: state.snapshot(),
      procedure: procedure.toJSON(),
      safety: [...safety.wornIds],
      helpers: clone(ctx.helpers),
      slots: [...table.placed.entries()].map(([slotId, entry]) => ({
        slotId,
        item: clone(entry.item),
        view: clone(entry.view ?? {}),
      })),
      instruments: [...instruments.values()].map((instrument) => ({
        id: instrument.id,
        settings: { ...instrument.settings },
        elapsed: instrument.elapsed,
      })),
    };
  }

  function pushCheckpoint() {
    if (restoring) return;
    checkpoints.push(benchSnapshot());
    if (checkpoints.length > 60) checkpoints.shift();
  }

  function restoreSnapshot(snapshot) {
    restoring = true;
    try {
      state.replace(clone(snapshot.state), { silent: true });
      procedure.load(clone(snapshot.procedure));
      safety.wornIds.clear();
      for (const id of snapshot.safety) safety.wornIds.add(id);
      for (const key of Object.keys(ctx.helpers)) delete ctx.helpers[key];
      Object.assign(ctx.helpers, clone(snapshot.helpers));
      table.clearAll();
      for (const slot of snapshot.slots) table.placeInSlot(slot.slotId, clone(slot.item), clone(slot.view));
      for (const saved of snapshot.instruments) {
        const instrument = instruments.get(saved.id);
        if (!instrument) continue;
        Object.assign(instrument.settings, saved.settings);
        instrument.elapsed = saved.elapsed ?? 0;
      }
      lastHtml = null;
    } finally {
      restoring = false;
    }
  }

  function undoLast() {
    const snapshot = checkpoints.pop();
    if (!snapshot) {
      notify("Nothing left to undo.", "info");
      return false;
    }
    restoreSnapshot(snapshot);
    completed = procedure.progress().complete;
    renderPPE();
    renderQuiz();
    refresh({ graph: true, force: true });
    log.add("Undid the last action", { type: "warn" });
    notify("Undid the last action.", "info");
    return true;
  }

  /* --------------------------------------------------------------- timer */
  let timerId = null;
  let timerStart = 0;

  function startTimer() {
    if (timerId !== null) stopTimer();
    timerStart = Date.now() - (ctx.helpers.live?.seconds * 1000 ?? 0);
    timerId = setInterval(() => {
      ctx.helpers.live.seconds = Math.floor((Date.now() - timerStart) / 1000);
      refresh({ force: true });
    }, 1000);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function skipTimer(seconds) {
    ctx.helpers.live.seconds = (ctx.helpers.live.seconds ?? 0) + seconds;
    refresh({ force: true });
  }

  /* --------------------------------------------------------------- actions */
  function perform(stepId, { action = null, why = null, fix = null } = {}) {
    pushCheckpoint();
    const step = procedure.get(stepId);
    const outcome = procedure.attempt(stepId, state, {
      action: action ?? step?.title ?? stepId,
      why,
      fix,
    });
    if (outcome.ok) {
      log.add(`${step?.title ?? stepId} — done`, { type: "success" });
      if (step) lastHintId = null;
      if (procedure.progress().complete && !completed) {
        completed = true;
        options.onComplete?.(experiment.id);
        notify("Procedure complete — open Results to read your run.", "success");
      }
    } else {
      log.mistake(`${step?.title ?? stepId} — ${outcome.mistake.why}`, {
        stepId,
        why: outcome.mistake.why,
        fix: outcome.mistake.fix,
      });
      notify(outcome.mistake.why, "error");
    }
    return outcome.ok;
  }

  function mistake(action, why, fix, severity = "major") {
    procedure.mistakes.add({ stepId: "ad-hoc", action, why, fix, severity });
    log.mistake(`${action} — ${why}`, { why, fix });
    notify(why, "error");
    return false;
  }

  function guard(condition, action, why, fix, severity = "major") {
    if (condition) return true;
    return mistake(action, why, fix, severity);
  }

  function tick(seconds) {
    const step = 0.5;
    for (let elapsed = 0; elapsed < seconds; elapsed += step) tickOnce(step);
  }

  function tickOnce(dt) {
    for (const instrument of instruments.values()) {
      instrument.tick(dt, spec.instrumentContext?.(ctx) ?? {});
    }
    spec.tick?.(ctx, dt);
  }

  /* ------------------------------------------------------------- PPE view */
  function renderPPE() {
    ppeList.innerHTML = safety.ppe
      .map(
        (item) => `
        <label class="ho-ppe__item ${safety.isWorn(item.id) ? "is-on" : ""}">
          <input type="checkbox" data-act="ppe" data-id="${escapeHTML(item.id)}"
            ${safety.isWorn(item.id) ? "checked" : ""} />
          <span><b>${escapeHTML(item.label)}</b><small>${escapeHTML(item.hint)}</small></span>
        </label>`,
      )
      .join("");
  }

  /* -------------------------------------------------- instrument cards view */
  function renderInstruments() {
    if (!instruments.size) {
      instrumentPanel.hidden = true;
      return;
    }
    instrumentPanel.hidden = false;
    instrumentPanel.innerHTML = [...instruments.values()]
      .map((instrument) => {
        const view = instrument.view();
        const hasRun = "running" in instrument.settings || "on" in instrument.settings;
        const display = Object.entries(view.display)
          .filter(([, value]) => typeof value === "number" || typeof value === "string" || typeof value === "boolean")
          .slice(0, 6)
          .map(
            ([key, value]) =>
              `<span class="ho-instr__d"><i>${escapeHTML(key)}</i><b>${escapeHTML(
                typeof value === "number" ? String(Math.round(value * 100) / 100) : String(value),
              )}</b></span>`,
          )
          .join("");
        return `<div class="ho-instr ${view.running ? "is-running" : ""}">
          <header>
            <span>${escapeHTML(view.label)}</span>
            ${hasRun ? `<button type="button" data-act="instr" data-key="${escapeHTML(view.id)}" data-op="${
              view.running ? "stop" : "start"
            }">${view.running ? "Stop" : "Start"}</button>` : ""}
          </header>
          ${display ? `<div class="ho-instr__display">${display}</div>` : ""}
          ${view.alerts.length ? `<p class="ho-instr__alert">${escapeHTML(view.alerts.join(" · "))}</p>` : ""}
          ${view.controls
            .map(
              (control) => `<label class="lab-control ho-instr__c">
                <span class="lab-control__top"><span>${escapeHTML(control.label)}</span>
                <b data-instr-value="${escapeHTML(view.id)}:${escapeHTML(control.key)}">${control.value}${
                  control.unit ? ` ${escapeHTML(control.unit)}` : ""
                }</b></span>
                <input type="range" data-instr-control="${escapeHTML(view.id)}" data-key="${escapeHTML(
                  control.key,
                )}" min="${control.min}" max="${control.max}" step="${control.step}" value="${control.value}" />
              </label>`,
            )
            .join("")}
        </div>`;
      })
      .join("");
  }

  /* ------------------------------------------------------------- quiz view */
  function renderQuiz() {
    const items = experiment.quiz ?? [];
    if (!items.length) {
      quizPanel.innerHTML = `<p class="ho-empty">No viva registered.</p>`;
      return;
    }
    if (quiz.done) {
      const score = quiz.answers.reduce(
        (sum, answer, index) => sum + (answer === items[index].answer ? 1 : 0),
        0,
      );
      quizPanel.innerHTML = `
        <div class="ho-quiz__score">
          <b>${score} / ${items.length}</b>
          <span>${score === items.length ? "Viva passed" : score >= items.length * 0.6 ? "Pass — review the misses" : "Below the pass mark"}</span>
          <button type="button" data-act="quiz-retry" class="ho-btn">Retry viva</button>
        </div>
        ${items
          .map(
            (item, index) => `<div class="ho-quiz__review ${quiz.answers[index] === item.answer ? "is-ok" : "is-bad"}">
              <p>${index + 1}. ${escapeHTML(item.question)}</p>
              <p><b>Your answer:</b> ${escapeHTML(item.options[quiz.answers[index]] ?? "—")} ·
                 <b>Correct:</b> ${escapeHTML(item.options[item.answer])}</p>
              <p class="ho-quiz__why">${escapeHTML(item.explanation)}</p>
            </div>`,
          )
          .join("")}`;
      return;
    }

    const item = items[quiz.index];
    const answered = quiz.answers[quiz.index] !== undefined;
    quizPanel.innerHTML = `
      <p class="ho-quiz__count">Question ${quiz.index + 1} of ${items.length}</p>
      <p class="ho-quiz__q">${escapeHTML(item.question)}</p>
      <div class="ho-quiz__options">
        ${item.options
          .map((option, index) => {
            let cls = "";
            if (answered) {
              if (index === item.answer) cls = "is-correct";
              else if (index === quiz.answers[quiz.index]) cls = "is-wrong";
            }
            return `<button type="button" class="ho-option ${cls}" data-act="quiz" data-q="${quiz.index}" data-a="${index}" ${
              answered ? "disabled" : ""
            }><span>${String.fromCharCode(65 + index)}</span>${escapeHTML(option)}</button>`;
          })
          .join("")}
      </div>
      ${
        answered
          ? `<p class="ho-quiz__why">${escapeHTML(
              (quiz.answers[quiz.index] === item.answer ? "Correct. " : "Not quite. ") + item.explanation,
            )}</p>
             <button type="button" class="ho-btn" data-act="quiz-next">${
               quiz.index + 1 < items.length ? "Next question" : "See score"
             }</button>`
          : ""
      }`;
  }

  function answerQuiz(index, answer) {
    if (quiz.answers[index] !== undefined) return;
    quiz.answers[index] = answer;
    renderQuiz();
    if (quiz.answers.filter((value) => value !== undefined).length === (experiment.quiz ?? []).length) {
      const items = experiment.quiz ?? [];
      quizScore = quiz.answers.reduce(
        (sum, value, i) => sum + (value === items[i].answer ? 1 : 0),
        0,
      );
      quiz.done = true;
      renderQuiz();
      log.add(`Viva scored ${quizScore}/${items.length}`, { type: "success" });
      options.onQuizScore?.(experiment.id, quizScore);
      notify(`Viva: ${quizScore}/${items.length}`, quizScore >= items.length * 0.6 ? "success" : "error");
    }
  }

  /* --------------------------------------------------- context helpers API */
  Object.assign(ctx, {
    /** Attempt a procedure step: order + physical checks, mistake book, log. */
    perform,
    /** Record a mistake directly: mistake(action, why, fix, severity). */
    mistake,
    /** guard(condition, action, why, fix, severity) -> boolean */
    guard,
    /** Advance the live model by N simulated seconds. */
    advance: tick,
    /** One live step (instruments + experiment tick). */
    step: tickOnce,
    notify,
    refreshNow: () => refresh({ graph: true, force: true }),
    showResults: () => computeResults(),
    downloadReport,
    /** Free-form scratch space for the experiment. */
    helpers: {},
  });
  // Live viva score (null until the five questions are answered).
  Object.defineProperty(ctx, "quizScore", { get: () => quizScore, enumerable: true });

  /* --------------------------------------------------------------- results */
  function buildSeries() {
    const view = spec.refresh?.(ctx);
    return view?.graph?.series ?? [];
  }

  function computeResults() {
    const out = spec.finalize?.(ctx) ?? {};
    results.observationSpec.length = 0;
    for (const observation of out.observations ?? []) results.observe(observation);

    const score = results.score({ durationSeconds: log.elapsed() });
    const series = out.series ?? buildSeries();
    const observations = results.observations();
    const mistakes = results.mistakesReview();
    const progress = procedure.progress();

    table.setResults(`
      <div class="ho-results">
        <div class="ho-score">
          ${score.breakdown
            .map(
              (row) => `<div class="ho-score__cell"><b>${row.value}</b><span>${escapeHTML(
                row.label,
              )}<i>${row.weight}%</i></span></div>`,
            )
            .join("")}
          <div class="ho-score__cell ho-score__cell--total"><b>${score.total}</b><span>Grade ${score.grade}</span></div>
        </div>

        <p class="ho-results__meta">${progress.done}/${progress.total} required steps · ${
          score.observations ? `${score.passed}/${score.observations} checks passed` : "no checks"
        } · ${score.mistakes} mistake${score.mistakes === 1 ? "" : "s"} · bench time ${
          Math.round(log.elapsed()) || 0
        } s${quizScore !== null ? ` · viva ${quizScore}/${(experiment.quiz ?? []).length}` : ""}</p>

        ${out.headline ? `<p class="ho-results__headline">${escapeHTML(out.headline)}</p>` : ""}

        <h3>Result graph</h3>
        <div class="ho-results__graph"><canvas data-results-graph></canvas>${
          series.length ? "" : `<p class="ho-empty">No series recorded for this run.</p>`
        }</div>

        <h3>Observation table</h3>
        <table class="ho-table">
          <thead><tr><th>Measurement</th><th>Expected</th><th>Observed</th><th>Verdict</th></tr></thead>
          <tbody>
            ${
              observations.length
                ? observations
                    .map(
                      (row) => `<tr class="${row.pass ? "is-ok" : "is-bad"}">
                <td>${escapeHTML(row.label)}</td>
                <td>${escapeHTML(String(row.expected))}</td>
                <td>${escapeHTML(String(row.actual))}${row.unit ? ` ${escapeHTML(row.unit)}` : ""}</td>
                <td>${row.pass ? "pass" : "deviation"}</td>
              </tr>`,
                    )
                    .join("")
                : `<tr><td colspan="4">No measurements recorded.</td></tr>`
            }
          </tbody>
        </table>

        <h3>Conclusion</h3>
        <p class="ho-results__conclusion">${escapeHTML(results.conclusion())}</p>

        <h3>What went wrong and why</h3>
        <table class="ho-table">
          <thead><tr><th>Action</th><th>Why it matters</th><th>Correction</th></tr></thead>
          <tbody>
            ${mistakes
              .map(
                (row) => `<tr><td>${escapeHTML(row.action)}</td><td>${escapeHTML(row.why)}</td><td>${escapeHTML(
                  row.fix,
                )}</td></tr>`,
              )
              .join("")}
          </tbody>
        </table>

        ${
          (out.sections ?? []).length
            ? (out.sections ?? [])
                .map(
                  (section) =>
                    `<h3>${escapeHTML(section.title)}</h3><div class="ho-results__section">${
                      section.html || `<p>${escapeHTML(section.text ?? "")}</p>`
                    }</div>`,
                )
                .join("")
            : ""
        }

        <div class="ho-results__actions">
          <button type="button" class="ho-btn ho-btn--primary" data-act="download-report">
            Download lab report (HTML)
          </button>
          <button type="button" class="ho-btn" data-act="open-quiz">Take the 5-question viva</button>
        </div>
      </div>`);

    const canvas = table.els.root.querySelector("[data-results-graph]");
    if (canvas && series.length) {
      requestAnimationFrame(() =>
        drawSeries(canvas, {
          series,
          xLabel: out.xLabel ?? "",
          yLabel: out.yLabel ?? "",
          logY: Boolean(out.logY),
        }),
      );
    }
    return { score, series, out };
  }

  function downloadReport() {
    const out = spec.finalize?.(ctx) ?? {};
    results.observationSpec.length = 0;
    for (const observation of out.observations ?? []) results.observe(observation);
    const series = out.series ?? buildSeries();
    const html = results.reportHTML({
      title: experiment.title,
      subtitle: `${experiment.aim ?? ""}`,
      series,
      extraSections: [
        {
          title: "Protocol",
          html: `<ol>${(experiment.steps ?? []).map((step) => `<li>${escapeHTML(step)}</li>`).join("")}</ol>`,
        },
        ...(out.sections ?? []).map((section) => ({
          title: section.title,
          html: section.html || `<p>${escapeHTML(section.text ?? "")}</p>`,
        })),
        ...(quizScore !== null
          ? [
              {
                title: "Viva",
                html: `<p>${quizScore} / ${(experiment.quiz ?? []).length} correct.</p>`,
              },
            ]
          : []),
      ],
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${experiment.id}-lab-report.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    log.add("Lab report downloaded", { type: "success" });
    notify("Lab report downloaded.", "success");
  }

  /* -------------------------------------------------------------- refresh */
  function refresh({ graph = false, force = false } = {}) {
    const view = spec.refresh?.(ctx) ?? {};
    if (view.readouts) table.setReadouts(view.readouts);
    if (graph && view.graph) table.setGraph(view.graph);

    if (spec.render && ctx.visual) {
      if (spec.renderUpdate) spec.renderUpdate(ctx);
      else {
        const html = spec.render(ctx);
        if (html !== lastHtml) {
          ctx.visual.innerHTML = html;
          ctx.visual.hidden = !html;
          lastHtml = html;
        }
      }
    }

    renderInstruments();

    // Keep the guided banner, the Hint drawer and the Procedure checklist in
    // sync on every refresh (not just when the step changes), so the drawers
    // are correct after the user opens them at any point in the run.
    const current = procedure.current();
    table.setHint(current, current ? current.hint ?? current.title : null);
    lastHintId = current?.id ?? null;

    if (force) renderPPE();
  }

  /* ---------------------------------------------------------------- events */
  cleanups.push(
    on(table.els.root, "click", (event) => {
      const target = event.target.closest("[data-act]");
      if (!target) return;
      const act = target.dataset.act;
      const data = target.dataset;

      if (act === "ppe") {
        const id = data.id;
        const now = !safety.isWorn(id);
        pushCheckpoint();
        safety.wear(id, now);
        if (!now && safety.required.includes(id)) {
          log.mistake(`Removed ${id} — PPE incomplete`, {
            why: "Working without required PPE lowers the safety score of the run.",
            fix: `Put the ${id} back on before continuing.`,
          });
          notify(`${id} removed — safety score will drop.`, "error");
        } else {
          log.add(`${id} ${now ? "on" : "off"}`, { type: "info" });
        }
        renderPPE();
        refresh();
        return;
      }

      if (act === "instr") {
        const instrument = instruments.get(data.key);
        if (!instrument) return;
        pushCheckpoint();
        if (data.op === "start") {
          instrument.start();
          log.add(`${instrument.label} started`, { type: "action" });
        } else {
          instrument.stop();
          log.add(`${instrument.label} stopped`, { type: "action" });
        }
        spec.onAction?.(ctx, act, data, event);
        refresh({ force: true });
        return;
      }

      if (act === "quiz") {
        answerQuiz(Number(data.q), Number(data.a));
        return;
      }
      if (act === "quiz-next") {
        quiz.index = Math.min((experiment.quiz ?? []).length - 1, quiz.index + 1);
        renderQuiz();
        return;
      }
      if (act === "quiz-retry") {
        quiz.index = 0;
        quiz.answers = [];
        quiz.done = false;
        quizScore = null;
        renderQuiz();
        return;
      }
      if (act === "download-report") {
        downloadReport();
        return;
      }
      if (act === "open-quiz") {
        table.setTab("quiz");
        renderQuiz();
        return;
      }

      pushCheckpoint();
      spec.onAction?.(ctx, act, data, event);
      refresh();
    }),
  );

  cleanups.push(
    on(table.els.root, "input", (event) => {
      const input = event.target;
      if (input.dataset?.instrControl) {
        const instrument = instruments.get(input.dataset.instrControl);
        if (!instrument) return;
        instrument.set(input.dataset.key, Number(input.value));
        const readout = table.els.root.querySelector(
          `[data-instr-value="${CSS.escape(input.dataset.instrControl)}:${CSS.escape(input.dataset.key)}"]`,
        );
        const control = instrument.definition.controls.find((c) => c.key === input.dataset.key);
        if (readout) {
          readout.textContent = `${input.value}${control?.unit ? ` ${control.unit}` : ""}`;
        }
        spec.onControl?.(ctx, `${input.dataset.instrControl}.${input.dataset.key}`, Number(input.value));
        return;
      }
      if (input.closest("[data-visual]")) {
        pushCheckpoint();
        spec.onInput?.(ctx, event);
      }
    }),
  );

  cleanups.push(
    table.on("slotDrop", (detail) => {
      pushCheckpoint();
      spec.onDrop?.(ctx, detail);
      refresh();
    }),
  );
  cleanups.push(
    table.on("moveItem", (detail) => {
      pushCheckpoint();
      spec.onMove?.(ctx, detail);
      refresh();
    }),
  );
  cleanups.push(
    table.on("control", ({ key, value }) => {
      pushCheckpoint();
      spec.onControl?.(ctx, key, value);
      refresh({ graph: true });
    }),
  );
  cleanups.push(
    table.on("tab", (tab) => {
      if (tab === "results") computeResults();
      if (tab === "quiz") renderQuiz();
      if (tab === "bench") refresh({ graph: true, force: true });
    }),
  );
  cleanups.push(table.on("undo", () => undoLast()));
  cleanups.push(
    table.on("save", () => {
      const ok = state.save(`biosimlab.bench.${experiment.id}`);
      notify(ok ? "Bench saved to this browser." : "Could not save the bench.", ok ? "success" : "error");
    }),
  );
  cleanups.push(
    table.on("reset", () => {
      checkpoints = [];
      state.replace(clone(initial), { silent: true });
      procedure.reset();
      for (const instrument of instruments.values()) instrument.reset();
      safety.wornIds.clear();
      table.clearAll();
      for (const key of Object.keys(ctx.helpers)) delete ctx.helpers[key];
      completed = false;
      quizScore = null;
      quiz.index = 0;
      quiz.answers = [];
      quiz.done = false;
      lastHintId = null;
      lastHtml = null;
      if (ctx.visual) {
        ctx.visual.innerHTML = "";
        ctx.visual.hidden = true;
      }
      log.add("Bench reset", { type: "warn" });
      if (spec.onReset) spec.onReset(ctx);
      else spec.onMount?.(ctx);
  // Phase 3D-2 timer: start tracking elapsed experiment time
  startTimer();
      renderPPE();
      renderQuiz();
      refresh({ graph: true, force: true });
      notify("Bench reset.", "info");
    }),
  );
  cleanups.push(
    table.on("skip", () => {
      if (spec.skip) spec.skip(ctx);
      else tick(60);
      log.add("Advanced the clock by 60 s", { type: "info" });
      refresh({ graph: true, force: true });
    }),
  );
  cleanups.push(table.on("exit", () => options.onExit?.()));
  cleanups.push(table.on("mode", () => refresh()));

  /* ----------------------------------------------------------- live loop */
  renderPPE();
  renderQuiz();
  spec.onMount?.(ctx);
  // Phase 3D-2 timer: start tracking elapsed experiment time
  startTimer();
  refresh({ force: true });

  stopLoop = rafLoop((dt) => {
    if (stopping) return;
    const scaled = Math.min(0.5, dt) * (table.speed || 1);
    if (scaled > 0) tickOnce(scaled);
    const now = performance.now();
    if (now - lastPanel >= PANEL_MS) {
      lastPanel = now;
      refresh();
    }
    if (now - lastGraph >= GRAPH_MS) {
      lastGraph = now;
      refresh({ graph: true });
    }
    if (procedure.progress().complete && !completed) {
      completed = true;
      options.onComplete?.(experiment.id);
    }
  });

  /* -------------------------------------------------------------- teardown */
  return {
    table,
    ctx,
    refresh: () => refresh({ graph: true, force: true }),
    results: computeResults,
    destroy() {
      stopping = true;
      stopTimer();
      stopLoop?.();
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      table.destroy();
      root.innerHTML = "";
    },
  };
}

export default mountHandsOn;
export { formatVolume };
