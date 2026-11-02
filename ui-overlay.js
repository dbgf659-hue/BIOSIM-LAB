/**
 * BioSim Lab · engine3d/ui-overlay.js
 * ---------------------------------------------------------------------------
 * Everything in front of the canvas: the HUD, camera preset toolbar, quality
 * selector, CSS2D object labels, selection card, diagnostics panel, loading
 * and WebGL fallback states.
 *
 * The overlay is plain DOM so it themes with CSS, works with a screen reader,
 * and never becomes part of the 3D scene graph except for CSS2DObject anchors.
 */

import { Box3, Vector3 } from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { QUALITY_PRESETS, QUALITY_TIERS } from "./quality.js";

const THEME_KEY = "biosimlab.bench3d.theme";

const ICONS = {
  labels: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12.2 11 4.7h7.4a1 1 0 0 1 1 1v7.4l-7.5 7.5a1 1 0 0 1-1.4 0l-7-7a1 1 0 0 1 0-1.4Z"/><circle cx="15.1" cy="8.9" r="1.35"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.5v2.1M12 19.4v2.1M2.5 12h2.1M19.4 12h2.1M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.6A8.4 8.4 0 0 1 9.4 4a8.5 8.5 0 1 0 10.6 10.6Z"/></svg>`,
  fullscreen: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  reset: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 9.2A8 8 0 1 1 4 12"/><path d="M4.8 4.4v4.8H0.6"/></svg>`,
  debug: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 7 5 5-5 5M12 17h7"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  focus: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6 21 20H3L12 3.6Z"/><path d="M12 9v5.2M12 17.3v.1"/></svg>`,
};

function prefersReducedMotion() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readTheme(options) {
  if (options.theme === "dark" || options.theme === "light") return options.theme;
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* private mode */
  }
  const page = document.documentElement?.dataset?.theme;
  if (page === "light" || page === "dark") return page;
  try {
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/**
 * @param {HTMLElement} container the Bench3D root
 * @param {{
 *   title?: string, subtitle?: string, quality?: object, qualitySource?: string,
 *   presets?: Array<{id: string, label: string, hint?: string}>, activePreset?: string,
 *   theme?: "auto"|"dark"|"light", reducedMotion?: boolean,
 *   fallbackHref?: string, onPreset?: Function, onQuality?: Function,
 *   onReset?: Function, onTheme?: Function, onFocusObject?: Function,
 *   onRetry?: Function,
 * }} options
 */
export class BenchOverlay {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.disposed = false;
    this.theme = readTheme(options);
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion();
    this.presets = Array.isArray(options.presets) ? options.presets : [];
    this.activePreset = options.activePreset ?? "overview";
    this.labelsVisible = true;
    this.debugOpen = false;
    this._labels = [];
    this._selected = null;
    this._announceTimer = 0;

    container.dataset.b3dTheme = this.theme;
    container.classList.add("b3d");

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "b3d-label-layer";
    this.labelRenderer.domElement.setAttribute("role", "group");
    this.labelRenderer.domElement.setAttribute("aria-label", "Objects on the bench");
    container.appendChild(this.labelRenderer.domElement);

    this.ui = document.createElement("div");
    this.ui.className = "b3d-ui";
    this.ui.dataset.b3dTheme = this.theme;
    this.ui.innerHTML = this._template();
    container.appendChild(this.ui);

    this.refs = {
      title: this.ui.querySelector('[data-role="title"]'),
      subtitle: this.ui.querySelector('[data-role="subtitle"]'),
      fps: this.ui.querySelector('[data-role="fps"]'),
      count: this.ui.querySelector('[data-role="count"]'),
      quality: this.ui.querySelector('[data-role="quality"]'),
      qualitySelect: this.ui.querySelector('[data-role="quality-select"]'),
      presets: this.ui.querySelector('[data-role="presets"]'),
      selection: this.ui.querySelector('[data-role="selection"]'),
      selectionName: this.ui.querySelector('[data-role="selection-name"]'),
      selectionMeta: this.ui.querySelector('[data-role="selection-meta"]'),
      selectionDot: this.ui.querySelector('[data-role="selection-dot"]'),
      focusButton: this.ui.querySelector('[data-action="focus-selection"]'),
      closeSelection: this.ui.querySelector('[data-action="close-selection"]'),
      debug: this.ui.querySelector('[data-role="debug"]'),
      debugList: this.ui.querySelector('[data-role="debug-list"]'),
      loading: this.ui.querySelector('[data-role="loading"]'),
      loadingText: this.ui.querySelector('[data-role="loading-text"]'),
      fallback: this.ui.querySelector('[data-role="fallback"]'),
      fallbackTitle: this.ui.querySelector('[data-role="fallback-title"]'),
      fallbackBody: this.ui.querySelector('[data-role="fallback-body"]'),
      fallbackDetails: this.ui.querySelector('[data-role="fallback-details"]'),
      fallbackRetry: this.ui.querySelector('[data-action="retry"]'),
      fallbackLink: this.ui.querySelector('[data-role="fallback-link"]'),
      live: this.ui.querySelector('[data-role="live"]'),
      themeButton: this.ui.querySelector('[data-action="theme"]'),
      labelsButton: this.ui.querySelector('[data-action="labels"]'),
      fullscreenButton: this.ui.querySelector('[data-action="fullscreen"]'),
      debugButton: this.ui.querySelector('[data-action="debug"]'),
      resetButton: this.ui.querySelector('[data-action="reset"]'),
    };

    this.refs.title.textContent = options.title ?? "The bench, in three dimensions";
    this.refs.subtitle.textContent = options.subtitle ?? "A procedural lab built entirely from geometry and light.";
    this.refs.fallbackLink.href = options.fallbackHref ?? "index.html";
    this.refs.fallbackLink.textContent = options.fallbackHrefLabel ?? "Open the 2D lab";

    this._buildPresetButtons();
    this._buildQualityOptions();
    this._bind();
    this._applyTheme();
    this.setQuality(options.quality?.tier ?? "high", options.qualitySource);
    this.setCount(options.objectCount ?? 0);
    this.setActivePreset(this.activePreset);
  }

  _template() {
    const qualityOptions = QUALITY_TIERS.map(
      (tier) => `<option value="${tier}">${QUALITY_PRESETS[tier].label}</option>`,
    ).join("");
    return `
      <header class="b3d-hud">
        <div class="b3d-identity">
          <span class="b3d-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48"><path d="M16 7c0 9.5 16 9.5 16 17S16 33 16 41M32 7c0 9.5-16 9.5-16 17s16 9 16 17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M14 14h20M14 34h20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".55"/></svg>
          </span>
          <div class="b3d-identity__copy">
            <p class="b3d-eyebrow">BioSim Lab <span>·</span> Engine 3D</p>
            <h2 class="b3d-heading" data-role="title"></h2>
            <p class="b3d-sub" data-role="subtitle"></p>
          </div>
        </div>
        <div class="b3d-chips" aria-label="Scene status">
          <span class="b3d-chip" data-role="fps" title="Rendered frames per second"><span class="b3d-chip__pulse" aria-hidden="true"></span><span data-role="fps-text">idle</span></span>
          <span class="b3d-chip" data-role="count">0 props</span>
          <span class="b3d-chip b3d-chip--quality" data-role="quality">High</span>
        </div>
      </header>

      <div class="b3d-toolbar" role="toolbar" aria-label="3D bench controls">
        <div class="b3d-presets" role="group" aria-label="Camera presets" data-role="presets">
          <span class="b3d-toolbar__label">Camera</span>
        </div>
        <div class="b3d-tools">
          <label class="b3d-select">
            <span class="sr-only">Render quality</span>
            <select data-role="quality-select" aria-label="Render quality">${qualityOptions}</select>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
          </label>
          <button class="b3d-icon-btn" type="button" data-action="labels" aria-pressed="true" title="Toggle object labels" aria-label="Toggle object labels">${ICONS.labels}</button>
          <button class="b3d-icon-btn" type="button" data-action="theme" title="Switch theme" aria-label="Switch theme">
            <span class="b3d-icon-sun">${ICONS.sun}</span><span class="b3d-icon-moon">${ICONS.moon}</span>
          </button>
          <button class="b3d-icon-btn" type="button" data-action="fullscreen" title="Full screen" aria-label="Toggle full screen">${ICONS.fullscreen}</button>
          <button class="b3d-icon-btn" type="button" data-action="reset" title="Reset camera (0)" aria-label="Reset camera">${ICONS.reset}</button>
          <button class="b3d-icon-btn" type="button" data-action="debug" title="Diagnostics (~)" aria-label="Toggle diagnostics" aria-pressed="false">${ICONS.debug}</button>
        </div>
      </div>

      <footer class="b3d-footer">
        <p class="b3d-hint">
          <span><b>Drag</b> to orbit</span>
          <span><b>Scroll</b> to zoom</span>
          <span><b>Two-finger</b> to pan</span>
          <span class="b3d-hint__keys"><kbd>1–5</kbd> views <kbd>~</kbd> diagnostics</span>
        </p>
        <aside class="b3d-selection" data-role="selection" hidden aria-label="Selected object">
          <span class="b3d-selection__dot" data-role="selection-dot" aria-hidden="true"></span>
          <div class="b3d-selection__copy">
            <p class="b3d-selection__name" data-role="selection-name"></p>
            <p class="b3d-selection__meta" data-role="selection-meta"></p>
          </div>
          <button class="b3d-selection__focus" type="button" data-action="focus-selection" title="Focus this object">${ICONS.focus}<span class="sr-only">Focus selected object</span></button>
          <button class="b3d-selection__close" type="button" data-action="close-selection" title="Clear selection">${ICONS.close}<span class="sr-only">Clear selection</span></button>
        </aside>
      </footer>

      <section class="b3d-debug" data-role="debug" hidden aria-label="3D diagnostics">
        <header class="b3d-debug__head">
          <div>
            <p class="b3d-debug__eyebrow">Live readout</p>
            <h2>Bench diagnostics</h2>
          </div>
          <button class="b3d-icon-btn b3d-icon-btn--small" type="button" data-action="close-debug" aria-label="Close diagnostics">${ICONS.close}</button>
        </header>
        <dl class="b3d-debug__grid" data-role="debug-list"></dl>
        <p class="b3d-debug__note">Renderer data updates while the bench is drawing. Idle scenes render on demand.</p>
      </section>

      <div class="b3d-loading" data-role="loading" role="status" aria-live="polite">
        <div class="b3d-loading__card">
          <div class="b3d-loading__orbit" aria-hidden="true"><span></span><span></span><span></span><i></i></div>
          <p class="b3d-loading__eyebrow">Engine 3D · Phase 3D-1</p>
          <p class="b3d-loading__title">Preparing the bench</p>
          <p class="b3d-loading__text" data-role="loading-text">Warming glass, metal and light…</p>
          <div class="b3d-loading__bar" aria-hidden="true"><span></span></div>
        </div>
      </div>

      <div class="b3d-fallback" data-role="fallback" hidden role="alertdialog" aria-labelledby="b3d-fallback-title">
        <div class="b3d-fallback__card">
          <span class="b3d-fallback__icon" aria-hidden="true">${ICONS.alert}</span>
          <p class="b3d-eyebrow">3D bench unavailable</p>
          <h2 id="b3d-fallback-title" data-role="fallback-title">This browser cannot open the 3D lab</h2>
          <p data-role="fallback-body">WebGL is required for the bench. The 2D experiments still work, and your progress is safe.</p>
          <ul class="b3d-fallback__details" data-role="fallback-details"></ul>
          <div class="b3d-fallback__actions">
            <button class="b3d-button b3d-button--primary" type="button" data-action="retry">Try again</button>
            <a class="b3d-button" data-role="fallback-link" href="index.html">Open the 2D lab</a>
          </div>
        </div>
      </div>

      <div class="b3d-live sr-only" data-role="live" aria-live="polite" aria-atomic="true"></div>
    `;
  }

  _buildPresetButtons() {
    const group = this.refs.presets;
    for (const preset of this.presets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "b3d-preset";
      button.dataset.preset = preset.id;
      button.textContent = preset.label;
      button.title = preset.hint ? `${preset.label} — ${preset.hint}` : `Go to ${preset.label}`;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        this.setActivePreset(preset.id);
        this.options.onPreset?.(preset.id, preset);
        this.announce(`Camera: ${preset.label}`);
      });
      group.appendChild(button);
    }
  }

  _buildQualityOptions() {
    const select = this.refs.qualitySelect;
    select.value = this.options.quality?.tier ?? "high";
    select.addEventListener("change", () => {
      const tier = select.value;
      if (!QUALITY_PRESETS[tier]) return;
      this.setLoading(true, `Rebuilding at ${QUALITY_PRESETS[tier].label.toLowerCase()} quality…`);
      this.options.onQuality?.(tier);
    });
  }

  _bind() {
    this._onKeyDown = (event) => this._handleKey(event);
    window.addEventListener("keydown", this._onKeyDown);

    this.refs.themeButton.addEventListener("click", () => {
      const next = this.theme === "light" ? "dark" : "light";
      this.setTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* private mode */
      }
      this.options.onTheme?.(next);
      this.announce(`${next === "light" ? "Light" : "Dark"} theme`);
    });

    this.refs.labelsButton.addEventListener("click", () => {
      this.setLabelsVisible(!this.labelsVisible);
      this.announce(`Labels ${this.labelsVisible ? "on" : "off"}`);
    });

    this.refs.resetButton.addEventListener("click", () => {
      this.setActivePreset("overview");
      this.clearSelection();
      this.options.onReset?.();
      this.announce("Camera reset");
    });

    this.refs.fullscreenButton.addEventListener("click", () => this._toggleFullscreen());
    this.refs.debugButton.addEventListener("click", () => this.toggleDebug());
    this.ui.querySelector('[data-action="close-debug"]').addEventListener("click", () => this.toggleDebug(false));

    this.refs.closeSelection.addEventListener("click", () => this.clearSelection());
    this.refs.focusButton.addEventListener("click", () => {
      if (this._selected) this.options.onFocusObject?.(this._selected);
    });

    this.refs.fallbackRetry.addEventListener("click", () => this.options.onRetry?.());
    this._onFullscreenChange = () => {
      const active = document.fullscreenElement === this.container;
      this.refs.fullscreenButton.setAttribute("aria-pressed", String(active));
      this.refs.fullscreenButton.title = active ? "Exit full screen" : "Full screen";
      this.labelRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
    };
    document.addEventListener("fullscreenchange", this._onFullscreenChange);
  }

  _handleKey(event) {
    if (this.disposed || event.defaultPrevented) return;
    const target = event.target;
    const tag = target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || target?.isContentEditable) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "~" || event.key === "`") {
      event.preventDefault();
      this.toggleDebug();
      return;
    }
    if (event.key === "0" || event.key.toLowerCase() === "r") {
      event.preventDefault();
      this.setActivePreset("overview");
      this.clearSelection();
      this.options.onReset?.();
      this.announce("Camera reset");
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const preset = this.presets[Number(event.key) - 1];
      if (!preset) return;
      event.preventDefault();
      this.setActivePreset(preset.id);
      this.options.onPreset?.(preset.id, preset);
      this.announce(`Camera: ${preset.label}`);
    }
  }

  _toggleFullscreen() {
    try {
      if (document.fullscreenElement === this.container) {
        document.exitFullscreen?.();
      } else {
        this.container.requestFullscreen?.();
      }
    } catch (error) {
      console.warn("[Bench3D] full screen unavailable", error);
      this.announce("Full screen is not available here");
    }
  }

  /* ---------------------------------------------------------------- labels */
  /**
   * Create a CSS2D label per interactive object. Labels are DOM buttons so
   * keyboard users can focus an item without orbiting to it first.
   * @param {Array<import("three").Object3D>} objects
   */
  setObjects(objects = []) {
    this.clearLabels();
    for (const object of objects) {
      if (!object?.isObject3D) continue;
      if (object.userData?.interactive === false) continue;
      if (object.userData?.labelVisible === false) continue;
      if (!object.userData?.label) continue;

      const element = document.createElement("button");
      element.type = "button";
      element.className = "b3d-label";
      element.dataset.objectId = object.userData.id ?? "";
      const dot = document.createElement("span");
      dot.className = "b3d-label__dot";
      const text = document.createElement("span");
      text.className = "b3d-label__text";
      text.textContent = object.userData.label;
      element.append(dot, text);
      element.title = `Focus ${object.userData.label}`;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._focusLabel(object);
      });
      element.addEventListener("focus", () => this._focusLabel(object));

      const anchor = this._labelAnchor(object);
      const label = new CSS2DObject(element);
      label.name = `label:${object.userData.id ?? object.name}`;
      label.position.copy(anchor);
      label.center.set(0.5, 1);
      object.add(label);
      this._labels.push({ object, label, element });
    }
    this.options.onLabelsReady?.(objects);
  }

  _labelAnchor(object) {
    const bounds = object.userData?.bounds;
    let world;
    if (bounds?.center && bounds?.max) {
      world = new Vector3(bounds.center[0], bounds.max[1] + 0.028, bounds.center[2]);
    } else {
      const box = new Box3().setFromObject(object);
      const center = box.getCenter(new Vector3());
      world = new Vector3(center.x, box.max.y + 0.028, center.z);
    }
    return object.worldToLocal(world);
  }

  _focusLabel(object) {
    this.setSelected(object);
    this.options.onFocusObject?.(object);
  }

  clearLabels() {
    for (const { label, element } of this._labels) {
      label.removeFromParent();
      element.remove();
    }
    this._labels = [];
  }

  setLabelsVisible(visible) {
    this.labelsVisible = Boolean(visible);
    const layer = this.labelRenderer.domElement;
    layer.classList.toggle("is-hidden", !this.labelsVisible);
    if (this.labelsVisible) layer.removeAttribute("aria-hidden");
    else layer.setAttribute("aria-hidden", "true");
    this.refs.labelsButton.setAttribute("aria-pressed", String(this.labelsVisible));
  }

  /* ------------------------------------------------------------- selection */
  setSelected(object) {
    this._selected = object ?? null;
    for (const { object: candidate, element } of this._labels) {
      element.classList.toggle("is-selected", candidate === object);
    }
    if (!object) {
      this.refs.selection.hidden = true;
      return;
    }
    const label = object.userData?.label ?? object.name ?? "Object";
    const type = object.userData?.objectType ?? "prop";
    const size = object.userData?.bounds?.size;
    const height = size ? Math.round(size[1] * 100) : null;
    this.refs.selectionName.textContent = label;
    this.refs.selectionMeta.textContent = `${type}${height ? ` · ${height} cm tall` : ""}`;
    this.refs.selectionDot.style.setProperty("--b3d-dot", object.userData?.accent ?? "var(--b3d-teal)");
    this.refs.selection.hidden = false;
  }

  clearSelection() {
    this.setSelected(null);
  }

  /* --------------------------------------------------------------- status */
  setQuality(tier, source = "auto") {
    const preset = QUALITY_PRESETS[tier] ?? QUALITY_PRESETS.high;
    this.refs.quality.textContent = preset.label;
    this.refs.quality.dataset.tier = preset.tier;
    const sourceLabel =
      source === "request" ? "Chosen for this view" : source === "saved" ? "Saved preference" : "Detected automatically";
    this.refs.quality.title = `${preset.label} quality · ${sourceLabel}`;
    if (this.refs.qualitySelect.value !== preset.tier) this.refs.qualitySelect.value = preset.tier;
  }

  setCount(count) {
    const total = Math.max(0, Number(count) || 0);
    this.refs.count.textContent = `${total} prop${total === 1 ? "" : "s"}`;
  }

  setFps(fps, idle = false) {
    const chip = this.refs.fps;
    const value = Number(fps) || 0;
    const text = idle || value === 0 ? "idle" : `${value} fps`;
    chip.querySelector('[data-role="fps-text"]').textContent = text;
    chip.classList.toggle("is-slow", !idle && value > 0 && value < 26);
    chip.title = idle || value === 0 ? "Idle: rendering on demand" : `${value} rendered frames per second`;
  }

  setActivePreset(id) {
    this.activePreset = id;
    for (const button of this.refs.presets.querySelectorAll("[data-preset]")) {
      button.setAttribute("aria-pressed", String(button.dataset.preset === id));
    }
  }

  setTheme(theme) {
    this.theme = theme === "light" ? "light" : "dark";
    this.container.dataset.b3dTheme = this.theme;
    this.ui.dataset.b3dTheme = this.theme;
    this._applyTheme();
  }

  _applyTheme() {
    const light = this.theme === "light";
    this.refs.themeButton.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
    this.refs.themeButton.title = light ? "Dark theme" : "Light theme";
    this.container.classList.toggle("b3d--light", light);
  }

  setReady() {
    this.setLoading(false);
    this.announce("3D bench ready. Drag to orbit, scroll to zoom.");
  }

  setLoading(loading, message) {
    if (message) this.refs.loadingText.textContent = message;
    this.refs.loading.hidden = !loading;
    this.refs.loading.classList.toggle("is-active", Boolean(loading));
    if (loading) {
      this.refs.fallback.hidden = true;
      this.ui.classList.remove("is-fallback");
    }
  }

  showFallback({ title, message, details, href, hrefLabel } = {}) {
    this.setLoading(false);
    this.refs.fallback.hidden = false;
    this.ui.classList.add("is-fallback");
    if (title) this.refs.fallbackTitle.textContent = title;
    if (message) this.refs.fallbackBody.textContent = message;
    if (href) this.refs.fallbackLink.href = href;
    if (hrefLabel) this.refs.fallbackLink.textContent = hrefLabel;
    this.refs.fallbackDetails.replaceChildren();
    for (const detail of details ?? []) {
      const item = document.createElement("li");
      item.textContent = detail;
      this.refs.fallbackDetails.appendChild(item);
    }
    this.refs.fallbackRetry.focus({ preventScroll: true });
  }

  hideFallback() {
    this.refs.fallback.hidden = true;
    this.ui.classList.remove("is-fallback");
  }

  announce(message) {
    if (!message || this.disposed) return;
    window.clearTimeout(this._announceTimer);
    this.refs.live.textContent = "";
    this._announceTimer = window.setTimeout(() => {
      if (!this.disposed) this.refs.live.textContent = message;
    }, 40);
  }

  /* ------------------------------------------------------------- diagnostics */
  toggleDebug(force) {
    this.debugOpen = typeof force === "boolean" ? force : !this.debugOpen;
    this.refs.debug.hidden = !this.debugOpen;
    this.refs.debugButton.setAttribute("aria-pressed", String(this.debugOpen));
    if (this.debugOpen) this.refs.debugButton.classList.add("is-active");
    else this.refs.debugButton.classList.remove("is-active");
  }

  setDebugData(data = {}) {
    if (!this.debugOpen) return;
    const rows = [
      ["Tier", data.tier ?? "—"],
      ["FPS", data.idle ? "idle" : `${data.fps ?? 0} fps`],
      ["Draw calls", data.drawCalls ?? "—"],
      ["Triangles", data.triangles ? Number(data.triangles).toLocaleString() : "—"],
      ["Geometries", data.geometries ?? "—"],
      ["Textures", data.textures ?? "—"],
      ["Programs", data.programs ?? "—"],
      ["Buffer", `${data.width ?? 0} × ${data.height ?? 0} @ ${data.pixelRatio ?? 1}×`],
      ["Shadows", data.shadow ? "on" : "off"],
      ["Bloom", data.bloom ? "on" : "off"],
      ["Environment", data.environment ? "on" : "off"],
      ["Objects", data.objects ?? "—"],
      ["Camera", Array.isArray(data.camera) ? data.camera.join(", ") : "—"],
      ["Target", Array.isArray(data.target) ? data.target.join(", ") : "—"],
    ];
    const fragment = document.createDocumentFragment();
    for (const [term, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = String(value);
      fragment.append(dt, dd);
    }
    this.refs.debugList.replaceChildren(fragment);
  }

  /* ------------------------------------------------------------------- draw */
  resize(width = this.container.clientWidth, height = this.container.clientHeight) {
    this.labelRenderer.setSize(Math.max(1, width), Math.max(1, height));
  }

  render(scene, camera) {
    if (this.disposed) return;
    this.labelRenderer.render(scene, camera);
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this._announceTimer);
    window.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("fullscreenchange", this._onFullscreenChange);
    this.clearLabels();
    this.labelRenderer.domElement.remove();
    this.ui.remove();
    this.container.classList.remove("b3d", "b3d--light");
    delete this.container.dataset.b3dTheme;
  }
}

export default BenchOverlay;
