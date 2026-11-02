/**
 * BioSim Lab · app.js
 * ---------------------------------------------------------------------------
 * Application shell, hash router, catalogue rendering, progress store, theme,
 * ambient canvas background and the Phase 1 bench preview.
 *
 * Everything is dependency-free and driven by js/data/experiments.js.
 */

import {
  EXPERIMENTS,
  CATEGORIES,
  CATEGORY_MAP,
  getExperiment,
  getCategory,
  getCategoryCount,
  getExperimentNumber,
  getSim,
} from "./data/experiments.js";
import { getModel, MODEL_COUNT } from "./data/models/index.js";
import { mountBench } from "./sims/bench.js";
import { Bench3D } from "./engine3d/bench3d.js";
import {
  icon,
  escapeHTML,
  toast,
  openModal,
  closeModal,
  confirmDialog,
  initTooltips,
  initRipples,
  sound,
} from "./ui.js";

/* ==========================================================================
   1. Constants and tiny helpers
   ========================================================================== */
const STORAGE_KEYS = {
  theme: "biosimlab.theme",
  progress: "biosimlab.progress.v1",
};

const TOTAL_EXPERIMENTS = EXPERIMENTS.length;
const QUIZ_TOTAL = EXPERIMENTS.reduce((sum, experiment) => sum + experiment.quiz.length, 0);
const DIFFICULTY_ORDER = { Beginner: 0, Intermediate: 1, Advanced: 2 };
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const scrollBehavior = () => (prefersReducedMotion.matches ? "auto" : "smooth");

function safeRead(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayNumber(key) {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function normalise(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const state = {
  query: "",
  category: "all",
  sort: "default",
  route: null,
  labId: null,
  lastLabId: null,
  homeScroll: 0,
  enteredLabFromHome: false,
};

let background = null;

/* ==========================================================================
   2. Progress store — localStorage only
   ========================================================================== */
const Progress = {
  data: null,

  defaults() {
    return {
      version: 1,
      completed: {},
      quizzes: {},
      started: [],
      streak: { current: 0, best: 0, lastActive: null },
    };
  },

  load() {
    let raw = null;
    try {
      raw = JSON.parse(safeRead(STORAGE_KEYS.progress) ?? "null");
    } catch {
      raw = null;
    }
    this.data = this.normalise(raw);
    return this.data;
  },

  normalise(raw) {
    const data = this.defaults();
    if (!raw || typeof raw !== "object") return data;

    if (raw.completed && typeof raw.completed === "object") {
      for (const [id, entry] of Object.entries(raw.completed)) {
        if (!getExperiment(id)) continue;
        if (!entry || typeof entry !== "object") continue;
        data.completed[id] = {
          at: Number(entry.at) || Date.now(),
          quizBest: clamp(Number(entry.quizBest) || 0, 0, 5),
        };
      }
    }

    if (raw.quizzes && typeof raw.quizzes === "object") {
      for (const [id, entry] of Object.entries(raw.quizzes)) {
        if (!getExperiment(id) || !entry || typeof entry !== "object") continue;
        data.quizzes[id] = {
          best: clamp(Number(entry.best) || 0, 0, 5),
          attempts: Math.max(0, Number(entry.attempts) || 0),
          lastAt: Number(entry.lastAt) || Date.now(),
        };
      }
    }

    if (Array.isArray(raw.started)) {
      data.started = [...new Set(raw.started.filter((id) => Boolean(getExperiment(id))))];
    }

    const streak = raw.streak;
    if (streak && typeof streak === "object") {
      data.streak.current = Math.max(0, Number(streak.current) || 0);
      data.streak.best = Math.max(data.streak.current, Number(streak.best) || 0);
      data.streak.lastActive =
        typeof streak.lastActive === "string" && /^\d{4}-\d{2}-\d{2}$/.test(streak.lastActive)
          ? streak.lastActive
          : null;
    }

    return data;
  },

  save() {
    safeWrite(STORAGE_KEYS.progress, JSON.stringify(this.data));
  },

  get completedCount() {
    return Object.keys(this.data.completed).length;
  },

  isComplete(id) {
    return Boolean(this.data.completed[id]);
  },

  markStarted(id) {
    if (!getExperiment(id) || this.data.started.includes(id)) return;
    this.data.started.push(id);
    this.save();
  },

  markComplete(id) {
    if (!getExperiment(id)) return;
    const existing = this.data.completed[id];
    const quizBest = this.data.quizzes[id]?.best ?? existing?.quizBest ?? 0;
    this.data.completed[id] = { at: Date.now(), quizBest };
    if (!this.data.started.includes(id)) this.data.started.push(id);
    this.touchStreak();
    this.save();
  },

  recordQuiz(id, score) {
    if (!getExperiment(id)) return;
    const best = clamp(Math.round(Number(score) || 0), 0, 5);
    const existing = this.data.quizzes[id];
    this.data.quizzes[id] = {
      best: Math.max(best, existing?.best ?? 0),
      attempts: (existing?.attempts ?? 0) + 1,
      lastAt: Date.now(),
    };
    if (this.data.completed[id]) {
      this.data.completed[id].quizBest = Math.max(
        this.data.completed[id].quizBest ?? 0,
        this.data.quizzes[id].best,
      );
    }
    this.touchStreak();
    this.save();
  },

  touchStreak() {
    const today = todayKey();
    const streak = this.data.streak;
    if (streak.lastActive === today) return;

    const gap = streak.lastActive ? dayNumber(today) - dayNumber(streak.lastActive) : null;
    streak.current = gap === 1 ? streak.current + 1 : 1;
    streak.best = Math.max(streak.best, streak.current);
    streak.lastActive = today;
    this.save();
  },

  reset() {
    this.data = this.defaults();
    this.save();
  },

  stats() {
    const completed = this.completedCount;
    const quizzes = Object.values(this.data.quizzes);
    const quizPercent = quizzes.length
      ? Math.round(
          (quizzes.reduce((sum, entry) => sum + entry.best, 0) / (quizzes.length * 5)) * 100,
        )
      : 0;
    const categories = new Set(
      Object.keys(this.data.completed)
        .map((id) => getExperiment(id)?.category)
        .filter(Boolean),
    );

    return {
      completed,
      total: TOTAL_EXPERIMENTS,
      percent: Math.round((completed / TOTAL_EXPERIMENTS) * 100),
      quizzesTaken: quizzes.length,
      quizPercent,
      categories: categories.size,
      streak: this.data.streak.current,
      bestStreak: this.data.streak.best,
    };
  },
};

const BADGES = [
  {
    id: "first-light",
    name: "First Light",
    description: "Complete your first experiment",
    icon: "sparkles",
    earned: (stats) => stats.completed >= 1,
  },
  {
    id: "bench-explorer",
    name: "Bench Explorer",
    description: "Complete 5 experiments",
    icon: "flask",
    earned: (stats) => stats.completed >= 5,
  },
  {
    id: "lab-scientist",
    name: "Lab Scientist",
    description: "Complete 15 experiments",
    icon: "microscope",
    earned: (stats) => stats.completed >= 15,
  },
  {
    id: "lab-graduate",
    name: "Lab Graduate",
    description: "Complete all 40 experiments",
    icon: "trophy",
    earned: (stats) => stats.completed >= 40,
  },
  {
    id: "perfect-run",
    name: "Perfect Run",
    description: "Score 5/5 in any quiz",
    icon: "target",
    earned: (stats, data) => Object.values(data.quizzes).some((entry) => entry.best === 5),
  },
  {
    id: "on-a-roll",
    name: "On a Roll",
    description: "Reach a 3-day streak",
    icon: "flame",
    earned: (stats) => stats.bestStreak >= 3,
  },
  {
    id: "cross-disciplinary",
    name: "Cross-Disciplinary",
    description: "Complete experiments in 3 categories",
    icon: "layers",
    earned: (stats) => stats.categories >= 3,
  },
];

function levelFor(completed) {
  if (completed >= 40) return "Lab Graduate";
  if (completed >= 30) return "Senior Scientist";
  if (completed >= 15) return "Lab Scientist";
  if (completed >= 5) return "Research Assistant";
  if (completed >= 1) return "Trainee";
  return "Orientation";
}

/* ==========================================================================
   3. Theme and sound chrome
   ========================================================================== */
const Theme = {
  current: "dark",

  init() {
    const saved = safeRead(STORAGE_KEYS.theme);
    this.apply(saved === "light" ? "light" : "dark", { persist: false });
  },

  apply(theme, { persist = true } = {}) {
    const next = theme === "light" ? "light" : "dark";
    this.current = next;
    document.documentElement.dataset.theme = next;
    if (persist) safeWrite(STORAGE_KEYS.theme, next);

    const button = $("#theme-toggle");
    if (button) {
      button.setAttribute("aria-pressed", String(next === "light"));
      const label = next === "light" ? "Switch to dark mode" : "Switch to light mode";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    }

    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "light" ? "#eef6f2" : "#040a0b");

    background?.setTheme(next);
  },

  toggle() {
    this.apply(this.current === "dark" ? "light" : "dark");
    sound.play("toggle");
  },
};

function updateSoundButton() {
  const button = $("#sound-toggle");
  if (!button) return;
  const enabled = sound.enabled;
  button.innerHTML = icon(enabled ? "volume-on" : "volume-off");
  button.setAttribute("aria-pressed", String(enabled));
  const label = enabled ? "Mute interface sound" : "Enable interface sound";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
}

/* ==========================================================================
   4. Catalogue: chips, cards, search, sort
   ========================================================================== */
function chipMarkup(category, active) {
  const isAll = category === "all";
  const accent = isAll ? "" : ` data-category="${category.id}"`;
  const label = isAll ? "All experiments" : category.name;
  const count = getCategoryCount(isAll ? "all" : category.id);
  return `
    <button class="chip" type="button"${accent} data-filter="${isAll ? "all" : category.id}"
      aria-pressed="${active}" title="Show ${escapeHTML(label)}">
      <span class="chip__dot" aria-hidden="true"></span>
      <span>${escapeHTML(label)}</span>
      <span class="chip__count">${count}</span>
    </button>
  `;
}

function renderChips() {
  const container = $("#category-chips");
  if (!container) return;
  container.innerHTML = [
    chipMarkup("all", state.category === "all"),
    ...CATEGORIES.map((category) => chipMarkup(category, state.category === category.id)),
  ].join("");
}

function cardMarkup(experiment, index) {
  const category = getCategory(experiment.category);
  const complete = Progress.isComplete(experiment.id);
  const quiz = Progress.data.quizzes[experiment.id];
  const difficultyClass = `difficulty--${experiment.difficulty.toLowerCase()}`;
  const registryNumber = getExperimentNumber(experiment.id) ?? index + 1;
  const number = String(registryNumber).padStart(2, "0");

  return `
    <article class="card${complete ? " is-complete" : ""}" data-category="${experiment.category}" data-id="${experiment.id}">
      <a class="card__link" href="${experiment.route}" data-card-link="${experiment.id}"
        aria-label="Open the ${escapeHTML(experiment.title)} bench preview">
        <div class="card__top">
          <span class="card__icon" aria-hidden="true">${icon(experiment.icon)}</span>
          <span class="difficulty ${difficultyClass}">${escapeHTML(experiment.difficulty)}</span>
        </div>
        <div class="card__body">
          <p class="card__category">${escapeHTML(category?.name ?? "Biotechnology")}</p>
          <h3 class="card__title">${escapeHTML(experiment.title)}</h3>
          <p class="card__desc">${escapeHTML(experiment.summary)}</p>
        </div>
        <div class="card__meta">
          <span>${icon("clock")}${escapeHTML(experiment.duration)}</span>
          <span>${icon("target")}5-question viva</span>
          ${complete ? `<span class="card__done">${icon("check-circle")}Complete</span>` : ""}
          ${quiz ? `<span>${icon("trophy")}Best ${quiz.best}/5</span>` : ""}
        </div>
        <div class="card__footer">
          <span class="card__cta">Open bench ${icon("arrow-right")}</span>
          <span class="card__index">#${number}</span>
        </div>
      </a>
    </article>
  `;
}

function filteredExperiments() {
  const tokens = normalise(state.query).split(/\s+/).filter(Boolean);

  const matches = EXPERIMENTS.filter((experiment) => {
    if (state.category !== "all" && experiment.category !== state.category) return false;
    if (tokens.length === 0) return true;

    const category = getCategory(experiment.category);
    const haystack = normalise(
      [
        experiment.id.replaceAll("-", " "),
        experiment.title,
        experiment.summary,
        experiment.difficulty,
        category?.name ?? "",
        category?.fullName ?? "",
        ...(experiment.tags ?? []),
      ].join(" "),
    );
    return tokens.every((token) => haystack.includes(token));
  });

  const sorted = [...matches];
  switch (state.sort) {
    case "az":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "za":
      sorted.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case "time-asc":
      sorted.sort((a, b) => a.durationMin - b.durationMin);
      break;
    case "time-desc":
      sorted.sort((a, b) => b.durationMin - a.durationMin);
      break;
    case "difficulty":
      sorted.sort(
        (a, b) =>
          (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9),
      );
      break;
    default:
      break;
  }

  return sorted;
}

function renderLibrary() {
  const grid = $("#experiment-grid");
  const empty = $("#empty-state");
  const resultCount = $("#result-count");
  if (!grid) return;

  const experiments = filteredExperiments();
  grid.innerHTML = experiments.map((experiment, index) => cardMarkup(experiment, index)).join("");
  $$(".card", grid).forEach((card, index) => card.style.setProperty("--i", String(index)));

  const filtering = state.query.trim().length > 0 || state.category !== "all";
  if (resultCount) {
    resultCount.textContent = filtering
      ? `Showing ${experiments.length} of ${TOTAL_EXPERIMENTS} experiments`
      : `Showing all ${TOTAL_EXPERIMENTS} experiments`;
  }

  if (empty) {
    if (experiments.length === 0) {
      empty.hidden = false;
      empty.innerHTML = `
        <span class="empty-state__icon" aria-hidden="true">${icon("search")}</span>
        <h3>No bench matches that search</h3>
        <p class="empty-desc">Try a shorter term, a category such as “molecular”, or clear the filters to see all ${TOTAL_EXPERIMENTS} experiments.</p>
        <button class="btn btn--ghost btn--sm" type="button" id="empty-reset">${icon("reset")} Clear filters</button>
      `;
    } else {
      empty.hidden = true;
      empty.innerHTML = "";
    }
  }

  syncProgressUI();
}

function setSearchState(query) {
  state.query = query;
  const input = $("#experiment-search");
  if (input && input.value !== query) input.value = query;
  const clear = $("#search-clear");
  if (clear) clear.hidden = query.length === 0;
  const kbd = $("#search-kbd");
  if (kbd) kbd.hidden = query.length > 0;
  renderLibrary();
}

function clearFilters() {
  state.category = "all";
  state.sort = "default";
  const sort = $("#sort-select");
  if (sort) sort.value = "default";
  renderChips();
  setSearchState("");
}

function bindCatalogue() {
  const search = $("#experiment-search");
  const clear = $("#search-clear");
  const chips = $("#category-chips");
  const sort = $("#sort-select");
  const grid = $("#experiment-grid");
  const empty = $("#empty-state");

  search?.addEventListener("input", () => setSearchState(search.value));
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchState("");
      search.blur();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      $("#library")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    }
  });

  clear?.addEventListener("click", () => {
    setSearchState("");
    search?.focus();
  });

  chips?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.category = button.dataset.filter;
    renderChips();
    renderLibrary();
    sound.play("click");
  });

  sort?.addEventListener("change", () => {
    state.sort = sort.value;
    renderLibrary();
    sound.play("click");
  });

  empty?.addEventListener("click", (event) => {
    if (event.target.closest("#empty-reset")) clearFilters();
  });

  grid?.addEventListener("pointermove", (event) => {
    if (!finePointer.matches || prefersReducedMotion.matches) return;
    const card = event.target.closest(".card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const px = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const py = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    card.style.setProperty("--tilt-y", `${(px - 0.5) * 5}deg`);
    card.style.setProperty("--tilt-x", `${(0.5 - py) * 5}deg`);
    card.style.setProperty("--mx", `${px * 100}%`);
    card.style.setProperty("--my", `${py * 100}%`);
  });

  grid?.addEventListener("pointerout", (event) => {
    const card = event.target.closest(".card");
    if (!card || card.contains(event.relatedTarget)) return;
    card.style.setProperty("--tilt-y", "0deg");
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--mx", "50%");
    card.style.setProperty("--my", "0%");
  });
}

/* ==========================================================================
   5. Progress UI and modals
   ========================================================================== */
function syncProgressUI() {
  const stats = Progress.stats();
  const ring = $(".progress-ring__value");
  ring?.style.setProperty("--ring-offset", String(85 * (1 - stats.percent / 100)));

  const value = $("#nav-progress-value");
  if (value) value.textContent = `${stats.percent}%`;

  const caption = $("#nav-progress-caption");
  if (caption) caption.textContent = `${stats.completed} / ${TOTAL_EXPERIMENTS} complete`;

  const button = $("#progress-btn");
  button?.setAttribute(
    "aria-label",
    `Open My Progress — ${stats.completed} of ${TOTAL_EXPERIMENTS} experiments complete, ${stats.percent} percent`,
  );
}

function categoryRowsMarkup() {
  return CATEGORIES.map((category) => {
    const total = getCategoryCount(category.id);
    const complete = EXPERIMENTS.filter(
      (experiment) => experiment.category === category.id && Progress.isComplete(experiment.id),
    ).length;
    const percent = total ? Math.round((complete / total) * 100) : 0;
    return `
      <div class="category-progress__row" data-category="${category.id}">
        <span class="category-progress__label">
          <span class="category-progress__dot" aria-hidden="true"></span>
          ${escapeHTML(category.name)}
        </span>
        <span class="category-progress__count">${complete} / ${total}</span>
        <span class="category-progress__track">
          <span class="category-progress__fill" data-fill="${percent}"></span>
        </span>
      </div>
    `;
  }).join("");
}

function badgesMarkup(stats) {
  return BADGES.map((badge) => {
    const earned = badge.earned(stats, Progress.data);
    return `
      <div class="badge-card${earned ? " is-earned" : ""}">
        <span class="badge-card__icon" aria-hidden="true">${icon(badge.icon)}</span>
        <span class="badge-card__text">
          <strong>${escapeHTML(badge.name)}</strong>
          <span>${escapeHTML(badge.description)}</span>
        </span>
      </div>
    `;
  }).join("");
}

function openProgressModal() {
  const stats = Progress.stats();
  const earned = BADGES.filter((badge) => badge.earned(stats, Progress.data)).length;
  const hasProgress =
    stats.completed > 0 || stats.quizzesTaken > 0 || stats.bestStreak > 0;
  const greeting =
    stats.completed === 0
      ? "Your bench log is empty. Open any experiment to begin."
      : stats.completed === TOTAL_EXPERIMENTS
        ? "Every experiment complete. The whole lab is yours."
        : `You have completed ${stats.completed} of ${TOTAL_EXPERIMENTS} experiments. Keep going.`;

  const body = `
    <div class="progress-hero">
      <div class="progress-dial" id="progress-dial">
        <svg viewBox="0 0 94 94" aria-hidden="true">
          <circle class="progress-dial__track" cx="47" cy="47" r="42"></circle>
          <circle class="progress-dial__value" id="progress-dial-value" cx="47" cy="47" r="42"></circle>
        </svg>
        <span class="progress-dial__center">
          <strong>${stats.percent}%</strong>
          <span>Complete</span>
        </span>
      </div>
      <div>
        <h3>${escapeHTML(levelFor(stats.completed))}</h3>
        <p>${escapeHTML(greeting)}</p>
        <span class="level-tag">${icon("sparkles")} ${stats.completed} / ${TOTAL_EXPERIMENTS} logged</span>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-card">
        <span class="stat-card__icon">${icon("check-circle")}</span>
        <span class="stat-card__text"><strong>${stats.completed}</strong><span>Completed</span></span>
      </div>
      <div class="stat-card">
        <span class="stat-card__icon">${icon("target")}</span>
        <span class="stat-card__text"><strong>${stats.quizzesTaken ? `${stats.quizPercent}%` : "—"}</strong><span>Quiz average</span></span>
      </div>
      <div class="stat-card">
        <span class="stat-card__icon">${icon("flame")}</span>
        <span class="stat-card__text"><strong>${stats.streak} d</strong><span>Current streak</span></span>
      </div>
    </div>

    <section class="progress-section" aria-labelledby="progress-categories">
      <div class="progress-section__head">
        <h4 id="progress-categories">Category progress</h4>
        <span>${stats.categories} / ${CATEGORIES.length} touched</span>
      </div>
      <div class="category-progress">${categoryRowsMarkup()}</div>
    </section>

    <section class="progress-section" aria-labelledby="progress-badges">
      <div class="progress-section__head">
        <h4 id="progress-badges">Badges</h4>
        <span>${earned} / ${BADGES.length} earned</span>
      </div>
      <div class="badge-grid">${badgesMarkup(stats)}</div>
    </section>

    ${hasProgress ? "" : '<p class="progress-empty">No progress yet. Complete an experiment and pass its viva to fill this log.</p>'}

    <div class="progress-actions">
      <p>Saved only in this browser · no account needed</p>
      <button class="btn btn--danger btn--sm" type="button" id="progress-reset"${hasProgress ? "" : " disabled"}>
        ${icon("reset")} Reset progress
      </button>
    </div>
  `;

  const modal = openModal({
    title: "My Progress",
    eyebrow: "Bench log",
    body,
    wide: true,
  });
  if (!modal) return;

  const dial = $("#progress-dial-value", modal.element);
  const fills = $$(".category-progress__fill", modal.element);
  if (dial) {
    dial.style.setProperty("--dial-offset", String(264 * (1 - stats.percent / 100)));
  }
  fills.forEach((fill) => {
    fill.style.setProperty("--p", `${fill.dataset.fill ?? 0}%`);
  });

  $("#progress-reset", modal.element)?.addEventListener("click", async () => {
    closeModal({ immediate: true });
    const confirmed = await confirmDialog({
      title: "Reset all progress?",
      message:
        "This clears completed experiments, quiz bests, badges and your streak from this browser. It cannot be undone.",
      confirmLabel: "Reset everything",
      cancelLabel: "Keep my progress",
      danger: true,
    });
    if (confirmed) {
      Progress.reset();
      renderLibrary();
      toast({
        title: "Progress reset",
        message: "Your bench log is empty again.",
        type: "success",
      });
      sound.play("success");
    }
    openProgressModal();
  });
}

function openHowItWorks() {
  const body = `
    <div class="how-list">
      <div class="how-step">
        <span class="how-step__num">01</span>
        <div>
          <h4>Choose a bench</h4>
          <p>Search by skill, technique or tag, or filter the 40 experiments by discipline. Every card is generated from the same registry that powers routing.</p>
        </div>
      </div>
      <div class="how-step">
        <span class="how-step__num">02</span>
        <div>
          <h4>Read the protocol</h4>
          <p>Each bench opens with its aim, principle, materials and numbered steps — the same scientific values used by the interactive simulation.</p>
        </div>
      </div>
      <div class="how-step">
        <span class="how-step__num">03</span>
        <div>
          <h4>Run it, then defend it</h4>
          <p>Phase 2 adds the live bench: adjustable controls, readings, event log, stepper, results and a scored five-question viva.</p>
        </div>
      </div>
      <div class="how-step">
        <span class="how-step__num">04</span>
        <div>
          <h4>Build a bench log</h4>
          <p>Completed experiments, quiz bests, badges and streaks are stored in this browser only. No account, no server, no tracking.</p>
        </div>
      </div>
    </div>
    <p class="modal-note">${icon("info")} Keyboard shortcuts: <strong>/</strong> focuses search, <strong>?</strong> opens this guide, and <strong>Esc</strong> closes a dialog or returns from a bench.</p>
  `;
  openModal({ title: "How BioSim Lab works", eyebrow: "Quick start", body });
}

function bindChrome() {
  $$("[data-icon]").forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
  });

  updateSoundButton();
  syncProgressUI();

  $("#theme-toggle")?.addEventListener("click", () => Theme.toggle());
  $("#sound-toggle")?.addEventListener("click", () => {
    const enabled = sound.toggle();
    updateSoundButton();
    toast({
      title: enabled ? "Sound on" : "Sound off",
      message: enabled
        ? "Synthesised interface cues are now enabled."
        : "Interface cues are muted.",
      type: "info",
      duration: 2600,
    });
  });
  $("#progress-btn")?.addEventListener("click", openProgressModal);
  $("#how-it-works")?.addEventListener("click", openHowItWorks);

  const topbar = $("#topbar");
  const onScroll = () => topbar?.setAttribute("data-elevated", String(window.scrollY > 8));
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ==========================================================================
   6. Hero: DNA model, tilt and count-up statistics
   ========================================================================== */
function buildHeroHelix() {
  const helix = $("#hero-dna");
  if (!helix || helix.childElementCount > 0) return;

  const steps = 24;
  const height = 314;
  const radius = 51;
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < steps; index += 1) {
    const t = index / (steps - 1);
    const angle = t * Math.PI * 3.4;
    const y = (t - 0.5) * height;

    for (const strand of [1, -1]) {
      const node = document.createElement("span");
      node.className = `dna3d__node${strand < 0 ? " is-violet" : ""}`;
      node.style.setProperty("--tx", `${Math.sin(angle) * radius * strand}px`);
      node.style.setProperty("--ty", `${y}px`);
      node.style.setProperty("--tz", `${Math.cos(angle) * radius * strand}px`);
      fragment.append(node);
    }

    if (index < steps - 1) {
      const rung = document.createElement("span");
      rung.className = "dna3d__rung";
      rung.style.setProperty("--ty", `${y}px`);
      rung.style.setProperty("--rot", `${Math.PI / 2 - angle}rad`);
      fragment.append(rung);
    }
  }

  helix.append(fragment);
}

function initSpecimenTilt() {
  const visual = $(".hero__visual");
  const specimen = $("#specimen");
  if (!visual || !specimen || !finePointer.matches || prefersReducedMotion.matches) return;

  const reset = () => {
    specimen.style.setProperty("--specimen-rx", "0deg");
    specimen.style.setProperty("--specimen-ry", "0deg");
  };

  visual.addEventListener("pointermove", (event) => {
    const rect = specimen.getBoundingClientRect();
    const px = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const py = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    specimen.style.setProperty("--specimen-ry", `${(px - 0.5) * 9}deg`);
    specimen.style.setProperty("--specimen-rx", `${(0.5 - py) * 7}deg`);
  });
  visual.addEventListener("pointerleave", reset);
}

function initCountUps() {
  const counters = $$("[data-count-to]");
  if (!counters.length) return;

  const finalise = (element) => {
    element.textContent = String(element.dataset.countTo);
  };

  if (prefersReducedMotion.matches || !("IntersectionObserver" in window)) {
    counters.forEach(finalise);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const element = entry.target;
        observer.unobserve(element);
        const target = Number(element.dataset.countTo) || 0;
        const start = performance.now();
        const duration = 1100;
        element.textContent = "0";

        const tick = (now) => {
          const progress = clamp((now - start) / duration, 0, 1);
          element.textContent = String(Math.round(target * easeOutCubic(progress)));
          if (progress < 1) window.requestAnimationFrame(tick);
        };
        window.requestAnimationFrame(tick);
      });
    },
    { threshold: 0.4 },
  );

  counters.forEach((counter) => observer.observe(counter));
}

function initReveal() {
  const items = $$(".reveal");
  if (!items.length) return;

  if (prefersReducedMotion.matches || !("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );
  items.forEach((item) => observer.observe(item));
}

/* ==========================================================================
   7. Ambient canvas background
   ========================================================================== */
class BioBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.width = 0;
    this.height = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.raf = null;
    this.last = 0;
    this.time = 0;
    this.manualPaused = false;
    this.hidden = document.hidden;
    this.reduced = prefersReducedMotion.matches;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.palette = null;
    this.scene = { dust: [], cells: [], molecules: [], helices: [] };

    this.onResize = this.resize.bind(this);
    this.onPointer = this.handlePointer.bind(this);
    this.onVisibility = this.handleVisibility.bind(this);
    this.onMotionChange = this.handleMotionChange.bind(this);
    this.loop = this.loop.bind(this);

    this.setTheme(Theme.current);
    this.resize();
    this.buildScene();

    window.addEventListener("resize", this.onResize, { passive: true });
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    prefersReducedMotion.addEventListener?.("change", this.onMotionChange);

    if (this.reduced) this.drawFrame(1);
    else this.start();
  }

  setTheme(theme) {
    this.palette =
      theme === "light"
        ? {
            teal: [7, 141, 120],
            violet: [109, 75, 209],
            green: [77, 139, 31],
            blue: [8, 120, 168],
            dust: [62, 95, 88],
            line: [62, 95, 88],
          }
        : {
            teal: [46, 230, 197],
            violet: [167, 139, 250],
            green: [163, 230, 53],
            blue: [56, 189, 248],
            dust: [166, 194, 190],
            line: [110, 139, 135],
          };
    if (this.reduced && this.width) this.drawFrame(1);
  }

  rgba(color, alpha) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.buildScene();
    if (this.reduced) this.drawFrame(1);
  }

  buildScene() {
    const { width, height } = this;
    const area = width * height;
    const random = (min, max) => min + Math.random() * (max - min);

    const dustCount = clamp(Math.round(area / 36_000), 16, 52);
    this.scene.dust = Array.from({ length: dustCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: random(0.5, 1.9),
      speed: random(0.004, 0.022),
      drift: random(-0.01, 0.01),
      alpha: random(0.12, 0.42),
      phase: Math.random() * Math.PI * 2,
    }));

    const cellCount = clamp(Math.round(width / 240), 3, 7);
    this.scene.cells = Array.from({ length: cellCount }, (_, index) => ({
      x: random(width * 0.05, width * 0.95),
      y: random(height * 0.08, height * 0.9),
      radius: random(22, 58) * clamp(width / 1200, 0.65, 1.15),
      depth: random(0.2, 0.8),
      speed: random(0.00008, 0.00022) * (index % 2 ? 1 : -1),
      phase: Math.random() * Math.PI * 2,
      hue: index % 3 === 0 ? "violet" : index % 3 === 1 ? "teal" : "blue",
      nucleus: random(0.22, 0.38),
    }));

    const moleculeCount = clamp(Math.round(width / 360), 2, 5);
    this.scene.molecules = Array.from({ length: moleculeCount }, () => {
      const nodes = clamp(Math.round(random(3, 6)), 3, 5);
      return {
        x: random(width * 0.08, width * 0.92),
        y: random(height * 0.1, height * 0.9),
        size: random(20, 42),
        depth: random(0.35, 1),
        rotation: Math.random() * Math.PI * 2,
        spin: random(-0.00016, 0.00016),
        phase: Math.random() * Math.PI * 2,
        nodes,
        hue: Math.random() > 0.5 ? "teal" : "violet",
      };
    });

    const helixCount = width < 760 ? 1 : 2;
    this.scene.helices = Array.from({ length: helixCount }, (_, index) => ({
      x: width * (index === 0 ? 0.13 : 0.87),
      y: height * (index === 0 ? 0.44 : 0.62),
      height: height * (index === 0 ? 0.62 : 0.48),
      radius: clamp(width * 0.035, 26, 62),
      phase: index * Math.PI,
      speed: index === 0 ? 0.00022 : -0.00018,
      depth: index === 0 ? 0.72 : 0.5,
    }));
  }

  handlePointer(event) {
    if (!finePointer.matches) return;
    this.pointer.tx = (event.clientX / window.innerWidth - 0.5) * 2;
    this.pointer.ty = (event.clientY / window.innerHeight - 0.5) * 2;
  }

  handleVisibility() {
    this.hidden = document.hidden;
    if (this.hidden) this.stop();
    else if (!this.manualPaused && !this.reduced) this.start();
  }

  handleMotionChange(event) {
    this.reduced = event.matches;
    if (this.reduced) {
      this.stop();
      this.drawFrame(1);
    } else if (!this.manualPaused && !this.hidden) {
      this.start();
    }
  }

  start() {
    if (this.raf !== null || this.reduced || this.hidden || this.manualPaused) return;
    this.last = performance.now();
    this.raf = window.requestAnimationFrame(this.loop);
  }

  stop() {
    if (this.raf !== null) window.cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  pause() {
    this.manualPaused = true;
    this.stop();
  }

  resume() {
    this.manualPaused = false;
    if (!this.reduced && !this.hidden) this.start();
  }

  loop(now) {
    this.raf = null;
    if (this.reduced || this.hidden || this.manualPaused) return;
    const delta = clamp(now - this.last, 0, 50);
    this.last = now;
    this.time += delta;
    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.035;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.035;
    this.drawFrame(delta);
    this.raf = window.requestAnimationFrame(this.loop);
  }

  drawFrame(delta) {
    const ctx = this.context;
    const { width, height } = this;
    ctx.clearRect(0, 0, width, height);
    if (!this.palette) return;

    this.drawDust(ctx);
    this.drawCells(ctx, delta);
    this.drawMolecules(ctx, delta);
    this.drawHelices(ctx);
  }

  drawDust(ctx) {
    const { width, height } = this;
    const { dust } = this.palette;
    for (const particle of this.scene.dust) {
      if (!this.reduced) {
        particle.y -= particle.speed * 16;
        particle.x += particle.drift * 16;
        if (particle.y < -4) particle.y = height + 4;
        if (particle.x < -4) particle.x = width + 4;
        if (particle.x > width + 4) particle.x = -4;
      }
      const twinkle = 0.55 + 0.45 * Math.sin(this.time * 0.0012 + particle.phase);
      ctx.beginPath();
      ctx.arc(
        particle.x + this.pointer.x * 6,
        particle.y + this.pointer.y * 4,
        particle.size,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = this.rgba(dust, particle.alpha * twinkle);
      ctx.fill();
    }
  }

  drawCells(ctx, delta) {
    const { width, height } = this;
    for (const cell of this.scene.cells) {
      if (!this.reduced) {
        cell.x += Math.cos(this.time * cell.speed + cell.phase) * 0.08;
        cell.y += Math.sin(this.time * cell.speed * 0.8 + cell.phase) * 0.06;
        if (cell.x < -cell.radius) cell.x = width + cell.radius;
        if (cell.x > width + cell.radius) cell.x = -cell.radius;
        if (cell.y < -cell.radius) cell.y = height + cell.radius;
        if (cell.y > height + cell.radius) cell.y = -cell.radius;
      }

      const color = this.palette[cell.hue] ?? this.palette.teal;
      const x = cell.x + this.pointer.x * 18 * cell.depth;
      const y = cell.y + this.pointer.y * 14 * cell.depth;
      const gradient = ctx.createRadialGradient(
        x - cell.radius * 0.28,
        y - cell.radius * 0.3,
        cell.radius * 0.08,
        x,
        y,
        cell.radius,
      );
      gradient.addColorStop(0, this.rgba(color, 0.1));
      gradient.addColorStop(0.68, this.rgba(color, 0.035));
      gradient.addColorStop(1, this.rgba(color, 0));
      ctx.beginPath();
      ctx.arc(x, y, cell.radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, cell.radius * 0.94, 0, Math.PI * 2);
      ctx.strokeStyle = this.rgba(color, 0.16);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(
        x + Math.sin(cell.phase) * cell.radius * 0.12,
        y + Math.cos(cell.phase) * cell.radius * 0.1,
        cell.radius * cell.nucleus,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = this.rgba(color, 0.08);
      ctx.fill();
    }
  }

  drawMolecules(ctx, delta) {
    for (const molecule of this.scene.molecules) {
      if (!this.reduced) molecule.rotation += molecule.spin * 16;
      const color = this.palette[molecule.hue] ?? this.palette.teal;
      const floatX = Math.sin(this.time * 0.0003 + molecule.phase) * 12;
      const floatY = Math.cos(this.time * 0.00024 + molecule.phase) * 10;
      const cx = molecule.x + floatX + this.pointer.x * 26 * molecule.depth;
      const cy = molecule.y + floatY + this.pointer.y * 20 * molecule.depth;
      const nodes = [];

      for (let index = 0; index < molecule.nodes; index += 1) {
        const angle = molecule.rotation + (index / molecule.nodes) * Math.PI * 2;
        const radius = molecule.size * (index % 2 === 0 ? 1 : 0.58);
        nodes.push({
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius * 0.62,
          size: 1.8 + (index % 3),
        });
      }

      ctx.strokeStyle = this.rgba(color, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (index === 0) ctx.moveTo(node.x, node.y);
        else ctx.lineTo(node.x, node.y);
      }
      ctx.closePath();
      ctx.stroke();

      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
        ctx.fillStyle = this.rgba(color, 0.35);
        ctx.fill();
      }
    }
  }

  drawHelices(ctx) {
    for (const helix of this.scene.helices) {
      const { width } = this;
      const cx = helix.x + this.pointer.x * 34 * helix.depth;
      const cy = helix.y + this.pointer.y * 22 * helix.depth;
      const radius = helix.radius * clamp(width / 1200, 0.7, 1.1);
      const steps = 19;
      const points = [];

      for (let index = 0; index < steps; index += 1) {
        const t = index / (steps - 1);
        const angle = this.time * helix.speed + t * Math.PI * 3.1 + helix.phase;
        const y = cy - helix.height / 2 + t * helix.height;
        const depthA = Math.cos(angle);
        const depthB = -depthA;
        const scaleA = 1 / (1 + depthA * 0.42);
        const scaleB = 1 / (1 + depthB * 0.42);
        points.push({
          ax: cx + Math.sin(angle) * radius * scaleA,
          ay: y,
          az: depthA,
          bx: cx - Math.sin(angle) * radius * scaleB,
          by: y,
          bz: depthB,
          as: scaleA,
          bs: scaleB,
        });
      }

      for (const point of points) {
        const front = (point.az + point.bz) / 2;
        const alpha = 0.06 + (1 - front) * 0.055;
        ctx.beginPath();
        ctx.moveTo(point.ax, point.ay);
        ctx.lineTo(point.bx, point.by);
        ctx.strokeStyle = this.rgba(this.palette.line, alpha);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      for (const point of points) {
        const nodes = [
          { x: point.ax, y: point.ay, z: point.az, scale: point.as, color: this.palette.teal },
          { x: point.bx, y: point.by, z: point.bz, scale: point.bs, color: this.palette.violet },
        ].sort((a, b) => b.z - a.z);

        for (const node of nodes) {
          const alpha = 0.14 + (1 - node.z) * 0.16;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 1.7 * node.scale, 0, Math.PI * 2);
          ctx.fillStyle = this.rgba(node.color, alpha);
          ctx.fill();
        }
      }
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    prefersReducedMotion.removeEventListener?.("change", this.onMotionChange);
  }
}

/* ==========================================================================
   8. Bench preview and router
   ========================================================================== */

// Live bench runtime
let activeBench = null;
let benchRequest = 0;

/** Lazily attach an experiment stylesheet (css/sim-<id>.css) once. */
function loadSimStylesheet(href) {
  if (!href || document.querySelector(`link[data-sim-css="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.simCss = href;
  document.head.appendChild(link);
}

/**
 * Open the bench for one experiment. Hands-on modules (js/sims/<id>.js)
 * registered in experiments.js win; everything else keeps the numerical bench.
 */
async function startBench(experiment) {
  const root = $("#lab-root");
  if (!root) return;
  const request = ++benchRequest;
  const sim = getSim(experiment.id);
  const category = getCategory(experiment.category);
  activeBench?.destroy?.();
  activeBench = null;

  if (sim) {
    try {
      const module = await import(sim.module);
      if (request !== benchRequest) return;
      loadSimStylesheet(sim.css);
      const mount = module.mount ?? module.init ?? module.default?.mount;
      if (typeof mount !== "function") throw new Error("module exports no mount()");
      activeBench = mount(root, experiment, {
        number: getExperimentNumber(experiment.id),
        categoryName: category?.name ?? "Biotechnology",
        onExit: () => goHome(),
        onComplete: (id) => {
          Progress.markComplete(id);
          syncProgressUI();
        },
        onQuizScore: (id, score) => {
          Progress.recordQuiz(id, score);
          syncProgressUI();
        },
      });
      Progress.markStarted(experiment.id);
      Progress.touchStreak();
      syncProgressUI();
      document.title = `${experiment.title} — BioSim Lab`;
      root.scrollTop = 0;
      return;
    } catch (error) {
      if (request !== benchRequest) return;
      console.warn(`[BioSim] hands-on module failed for ${experiment.id}`, error);
      toast({
        title: "Hands-on bench unavailable",
        message: `${experiment.title} fell back to the numerical bench: ${error.message}`,
        type: "warning",
      });
    }
  }

  const model = getModel(experiment.id);
  if (!model) {
    toast({
      title: "Model not registered",
      message: `${experiment.title} has no simulation model in this build.`,
      type: "warning",
    });
    return;
  }

  activeBench = mountBench(
    root,
    {
      id: experiment.id,
      title: experiment.title,
      summary: experiment.summary,
      number: getExperimentNumber(experiment.id),
      categoryName: category?.name ?? "Biotechnology",
    },
    model,
    { onExit: () => goHome() },
  );

  Progress.markStarted(experiment.id);
  Progress.touchStreak();
  syncProgressUI();
  document.title = `${experiment.title} — BioSim Lab`;
  root.scrollTop = 0;
}

function destroyBench() {
  benchRequest += 1;
  activeBench?.destroy?.();
  activeBench = null;
}

function labTopbar({ category, title, phaseLabel = "Live simulation" }) {
  return `
    <header class="lab-preview__top">
      <div class="container lab-preview__top-inner">
        <button class="lab-back" type="button" id="lab-back" aria-label="Back to the experiment library">
          ${icon("arrow-left")} Back to library
        </button>
        <div class="lab-preview__crumb">
          <span>Bench</span><span class="sep">/</span>
          <span>${escapeHTML(category)}</span><span class="sep">/</span>
          <strong>${escapeHTML(title)}</strong>
        </div>
        <div class="lab-preview__top-actions">
          <span class="status-pill"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHTML(phaseLabel)}</span>
          <button class="icon-btn" type="button" id="lab-help" aria-label="How BioSim Lab works" title="How it works" data-tip="How it works">
            ${icon("help")}
          </button>
        </div>
      </div>
    </header>
  `;
}

function renderLabPreview(experiment) {
  const root = $("#lab-root");
  if (!root) return;
  const category = getCategory(experiment.category);
  const number = getExperimentNumber(experiment.id) ?? 1;
  const viva = experiment.quiz[0];
  const categoryName = category?.name ?? "Biotechnology";

  root.innerHTML = `
    <div class="lab-preview is-entering">
      ${labTopbar({ category: categoryName, title: experiment.title })}
      <div class="container lab-preview__layout">
        <div class="lab-preview__main">
          <div class="lab-preview__head">
            <span class="lab-preview__icon" aria-hidden="true">${icon(experiment.icon)}</span>
            <div>
              <p class="eyebrow">Experiment ${String(number).padStart(2, "0")} · ${escapeHTML(categoryName)}</p>
              <h1 class="lab-preview__title" tabindex="-1" id="lab-title">${escapeHTML(experiment.title)}</h1>
            </div>
          </div>

          <p class="lab-preview__summary">${escapeHTML(experiment.summary)}</p>

          <div class="meta-pills">
            <span class="meta-pill">${icon("chart")}${escapeHTML(experiment.difficulty)}</span>
            <span class="meta-pill">${icon("clock")}${escapeHTML(experiment.duration)}</span>
            <span class="meta-pill">${icon("target")}5-question viva</span>
            <span class="meta-pill" data-tip="Standard undergraduate teaching lab · no human or animal material">${icon("shield")}BSL-1</span>
          </div>

          <div class="preview-callout">
            ${icon("sparkles")}
            <div>
              <strong>A live numerical bench is ready</strong>
              <p>The model integrates in real time: move any control while it runs and the curves respond without a reset. Every bench validates itself against analytic or literature values.</p>
            </div>
          </div>

          <div class="preview-grid">
            <section class="preview-panel preview-panel--wide" aria-labelledby="aim-title">
              <h2 id="aim-title">Aim</h2>
              <p>${escapeHTML(experiment.aim)}</p>
            </section>

            <section class="preview-panel preview-panel--wide" aria-labelledby="principle-title">
              <h2 id="principle-title">Principle</h2>
              <p>${escapeHTML(experiment.principle)}</p>
            </section>

            <section class="preview-panel" aria-labelledby="materials-title">
              <h2 id="materials-title">Materials</h2>
              <ul>${experiment.materials.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>
            </section>

            <section class="preview-panel" aria-labelledby="steps-title">
              <h2 id="steps-title">Protocol steps</h2>
              <ol class="preview-steps">${experiment.steps.map((step) => `<li>${escapeHTML(step)}</li>`).join("")}</ol>
            </section>
          </div>

          <div class="preview-actions">
            <button class="btn btn--primary" type="button" id="start-simulation" data-tip="Launch the interactive simulation">
              ${icon("play")} Open live bench
            </button>
            <button class="btn btn--ghost" type="button" id="lab-library-link">
              ${icon("arrow-left")} Back to library
            </button>
          </div>
        </div>

        <aside class="lab-preview__aside" aria-label="Bench status and quick viva">
          <section class="stage-locked" aria-labelledby="stage-title">
            <div class="stage-locked__visual" aria-hidden="true">
              <span class="stage-locked__ring"></span>
              <span class="stage-locked__ring stage-locked__ring--b"></span>
              <span class="stage-locked__ring stage-locked__ring--c"></span>
              <span class="stage-locked__scan"></span>
              <span class="stage-locked__icon">${icon(experiment.icon)}</span>
            </div>
            <p class="stage-locked__kicker">Bench stage · standby</p>
            <h2 id="stage-title">Stage ready</h2>
            <p>${MODEL_COUNT} models are registered. Each one integrates a real dynamical system, streams telemetry and validates its own output.</p>
            <div class="stage-locked__progress">
              <span>Model coverage</span>
              <span>100%</span>
            </div>
            <div class="progress-track" role="progressbar" aria-label="Model coverage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
              <span class="progress-track__fill" id="stage-fill"></span>
            </div>
          </section>

          <section class="preview-viva" aria-labelledby="viva-title">
            <div class="preview-viva__head">
              <h2 id="viva-title">Quick viva</h2>
              <span>Question 1 of 5</span>
            </div>
            <p class="preview-viva__question">${escapeHTML(viva.question)}</p>
            <div class="viva-options" id="viva-options" role="group" aria-labelledby="viva-title">
              ${viva.options
                .map(
                  (option, index) => `
                    <button class="viva-option" type="button" data-answer="${index}">
                      <span class="viva-option__key">${String.fromCharCode(65 + index)}</span>
                      <span>${escapeHTML(option)}</span>
                    </button>
                  `,
                )
                .join("")}
            </div>
            <div class="viva-explain" id="viva-explain" aria-live="polite" hidden></div>
            <p class="preview-viva__note">This taster is unscored. The full five-question viva is recorded in My Progress when the simulation ships.</p>
          </section>
        </aside>
      </div>
    </div>
  `;

  const fill = $("#stage-fill", root);
  if (fill) {
    void fill.getBoundingClientRect();
    fill.style.setProperty("--fill", "100%");
  }

  $("#lab-back", root)?.addEventListener("click", () => goHome());
  $("#lab-library-link", root)?.addEventListener("click", () => goHome());
  $("#lab-help", root)?.addEventListener("click", openHowItWorks);
  $("#start-simulation", root)?.addEventListener("click", () => {
    sound.play("success");
    startBench(experiment);
  });
  $("#viva-options", root)?.addEventListener("click", (event) => {
    const button = event.target.closest(".viva-option");
    if (!button || button.disabled) return;
    const chosen = Number(button.dataset.answer);
    const correct = chosen === viva.answer;
    const buttons = $$(".viva-option", root);
    buttons.forEach((option) => {
      option.disabled = true;
      if (Number(option.dataset.answer) === viva.answer) option.classList.add("is-correct");
    });
    if (!correct) button.classList.add("is-wrong");

    const explain = $("#viva-explain", root);
    if (explain) {
      explain.hidden = false;
      explain.textContent = `${correct ? "Correct. " : "Not quite. "}${viva.explanation}`;
    }

    if (correct) {
      sound.play("success");
      toast({
        title: "Correct — nice bench instinct",
        message: "The full quiz is waiting in Phase 2.",
        type: "success",
      });
    } else {
      sound.play("error");
    }
  });

  Progress.markStarted(experiment.id);
  Progress.touchStreak();
  syncProgressUI();

  window.requestAnimationFrame(() => {
    $("#lab-title", root)?.focus({ preventScroll: true });
  });
}

function renderNotFound(hash) {
  const root = $("#lab-root");
  if (!root) return;
  root.innerHTML = `
    <div class="lab-preview is-entering">
      ${labTopbar({ category: "Unknown route", title: hash || "Not found", phaseLabel: "Route missing" })}
      <div class="container lab-notfound">
        <div class="empty-state">
          <span class="empty-state__icon" aria-hidden="true">${icon("alert")}</span>
          <h1>That bench does not exist</h1>
          <p>The route <span class="mono">${escapeHTML(hash)}</span> is not in the experiment registry. It may have moved, or the link may be incomplete.</p>
          <button class="btn btn--primary" type="button" id="notfound-home">${icon("arrow-left")} Return to the library</button>
        </div>
      </div>
    </div>
  `;
  $("#lab-back", root)?.addEventListener("click", () => goHome());
  $("#notfound-home", root)?.addEventListener("click", () => goHome());
  $("#lab-help", root)?.addEventListener("click", openHowItWorks);
  window.requestAnimationFrame(() => $("#notfound-home", root)?.focus({ preventScroll: true }));
}

function openLabShell() {
  const labRoot = $("#lab-root");
  const topbar = $("#topbar");
  const main = $("#main-content");
  if (!labRoot) return;

  if (!document.body.classList.contains("lab-open")) {
    state.homeScroll = window.scrollY;
    document.body.classList.add("lab-open");
    topbar?.setAttribute("inert", "");
    main?.setAttribute("inert", "");
    topbar?.setAttribute("aria-hidden", "true");
    main?.setAttribute("aria-hidden", "true");
  }

  labRoot.hidden = false;
  labRoot.scrollTop = 0;
  background?.pause();
}

function closeLabShell() {
  const labRoot = $("#lab-root");
  const topbar = $("#topbar");
  const main = $("#main-content");
  if (!labRoot) return;

  // Destroy any active bench
  destroyBench();

  labRoot.hidden = true;
  labRoot.innerHTML = "";
  document.body.classList.remove("lab-open");
  topbar?.removeAttribute("inert");
  main?.removeAttribute("inert");
  topbar?.removeAttribute("aria-hidden");
  main?.removeAttribute("aria-hidden");
  background?.resume();

  window.scrollTo(0, state.homeScroll);
  const cardLink = state.lastLabId
    ? $(`[data-card-link="${state.lastLabId}"]`)
    : null;
  cardLink?.focus({ preventScroll: true });
}

function goHome() {
  if (state.enteredLabFromHome) {
    window.history.back();
    return;
  }
  window.history.replaceState(null, "", "#/");
  handleRoute();
}

function handleRoute() {
  const hash = window.location.hash;
  const previousRoute = state.route;

  if (hash === "" || hash === "#" || hash === "#/" || !hash.startsWith("#/")) {
    const anchor = hash.startsWith("#") && hash.length > 1 ? hash.slice(1) : "";
    if (previousRoute === "lab" || previousRoute === "notfound") {
      closeLabShell();
      if (previousRoute === "lab" && state.lastLabId) {
        // The card link is focused by closeLabShell after the home view is back.
      }
    }
    state.route = "home";
    state.labId = null;
    state.enteredLabFromHome = false;
    document.title = "BioSim Lab — Interactive Biotechnology Simulations";
    if (anchor) {
      const target = document.getElementById(anchor);
      if (target) {
        window.requestAnimationFrame(() =>
          target.scrollIntoView({ behavior: scrollBehavior(), block: "start" }),
        );
      }
    }
    return;
  }

  const match = hash.match(/^#\/(?:lab\/)?([a-z0-9-]+)\/?$/);
  if (!match) {
    state.route = "notfound";
    state.enteredLabFromHome = previousRoute === "home";
    openLabShell();
    renderNotFound(hash);
    document.title = "Route not found — BioSim Lab";
    return;
  }

  const experiment = getExperiment(match[1]);
  if (!experiment) {
    state.route = "notfound";
    state.enteredLabFromHome = previousRoute === "home";
    openLabShell();
    renderNotFound(hash);
    document.title = "Route not found — BioSim Lab";
    return;
  }

  if (previousRoute === "home") state.enteredLabFromHome = true;
  state.route = "lab";
  state.labId = experiment.id;
  state.lastLabId = experiment.id;
  openLabShell();
  renderLabPreview(experiment);
  document.title = `${experiment.title} — BioSim Lab`;
}

function bindRouter() {
  window.addEventListener("hashchange", handleRoute);
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.matches("input, textarea, select") || target.isContentEditable);

    if (event.key === "Escape" && !document.body.classList.contains("modal-open")) {
      if (state.route === "lab" || state.route === "notfound") {
        event.preventDefault();
        goHome();
      }
      return;
    }

    if (typing) return;
    if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      $("#experiment-search")?.focus();
    }
    if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!document.body.classList.contains("modal-open")) {
        event.preventDefault();
        openHowItWorks();
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#experiment-search")?.focus();
    }
  });
}

/* ==========================================================================
   9. Boot
   ========================================================================== */
function boot() {
  Theme.init();
  Progress.load();
  bindChrome();
  buildHeroHelix();
  renderChips();
  renderLibrary();
  bindCatalogue();
  initSpecimenTilt();
  initCountUps();
  initReveal();
  initTooltips();
  initRipples();
  bindRouter();

  const canvas = $("#bg-canvas");
  if (canvas) background = new BioBackground(canvas);

  handleRoute();
}

try {
  boot();
} catch (error) {
  console.error("[BioSim Lab] Boot failed:", error);
  const stack = $("#toast-stack");
  if (stack) {
    const fallback = document.createElement("div");
    fallback.className = "toast toast--error";
    fallback.setAttribute("role", "alert");
    fallback.innerHTML = `
      <span class="toast__icon">${icon("alert")}</span>
      <div class="toast__body">
        <p class="toast__title">BioSim Lab could not start</p>
        <p class="toast__message">Reload the page. If you opened index.html directly, serve the folder over HTTP so ES modules can load.</p>
      </div>
    `;
    stack.append(fallback);
  }
}
