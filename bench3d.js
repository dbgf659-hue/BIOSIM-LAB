/**
 * BioSim Lab · engine3d/bench3d.js
 * ---------------------------------------------------------------------------
 * The public entry point for the 3D bench.
 *
 *   import { Bench3D } from "./js/engine3d/bench3d.js";
 *   const bench = Bench3D.init(container, config);
 *   bench.destroy();
 *
 * One bench can be mounted at a time. init() is deliberately idempotent: a
 * second call tears the previous bench down first, so a route change or a
 * double-click on "open experiment" cannot leave a WebGL context behind.
 *
 * Everything a Phase 3D-2 experiment needs is here: add/find/select/focus
 * objects, camera presets, quality rebuilds, live instrument displays, events
 * and a deterministic destroy().
 */

import { Raycaster, Vector2 } from "three";
import {
  QUALITY_PRESETS,
  deviceSummary,
  prefersReducedMotion,
  resolveQuality,
  saveQualityOverride,
  webglSupport,
} from "./quality.js";
import { MaterialLibrary } from "./materials.js";
import { CameraRig, DEFAULT_PRESETS } from "./camera-rig.js";
import { BenchScene } from "./scene.js";
import { BenchOverlay } from "./ui-overlay.js";
import { ResourcePool, createObject, createShadowRoot } from "./factory.js";

function qualityFromUrl() {
  try {
    const value = new URLSearchParams(window.location.search).get("quality");
    return QUALITY_PRESETS[value] ? value : null;
  } catch {
    return null;
  }
}

function presetList(presets) {
  const merged = { ...DEFAULT_PRESETS, ...(presets ?? {}) };
  return Object.entries(merged)
    .filter(([, preset]) => Array.isArray(preset?.position) && Array.isArray(preset?.target))
    .map(([id, preset]) => ({
      id,
      label: preset.label ?? id,
      hint: preset.hint ?? "",
    }));
}

function normaliseObjects(input, defaultIdPrefix = "prop") {
  if (!Array.isArray(input)) return [];
  return input
    .filter(Boolean)
    .map((entry, index) => {
      if (typeof entry === "string") return { type: entry, id: `${defaultIdPrefix}-${index + 1}` };
      const item = { ...entry };
      if (!item.id) item.id = `${item.type ?? defaultIdPrefix}-${index + 1}`;
      if (item.at && !item.position) {
        const at = item.at;
        item.position = Array.isArray(at)
          ? [Number(at[0]) || 0, Number(at[1]) || 0, Number(at[2]) || 0]
          : [Number(at.x) || 0, Number(at.y) || 0, Number(at.z) || 0];
      }
      delete item.at;
      return item;
    })
    .filter((entry) => typeof entry.type === "string" && entry.type);
}

/**
 * A mounted bench. Hold the return value of init() if you need the API; the
 * singleton getter exists for engine glue that only knows about Bench3D.
 */
export class BenchInstance {
  constructor(container, config = {}) {
    this.container = container;
    this.config = { ...config };
    this.scene = null;
    this.library = null;
    this.resources = null;
    this.overlay = null;
    this.shadowRoot = null;
    this.objects = [];
    this.pickables = [];
    this.qualityInfo = null;
    this.support = null;
    this.theme = config.theme === "light" || config.theme === "dark" ? config.theme : "auto";
    this.reducedMotion = config.reducedMotion ?? prefersReducedMotion();
    this._mounted = false;
    this._ready = false;
    this._destroyed = false;
    this._qualityChosen = false;
    this._lastStats = { fps: 0, idle: true };
    this._selected = null;
    this._pointer = null;
    this._readyRaf = 0;

    this._onPointerDown = (event) => {
      if (event.button !== 0) return;
      this._pointer = { x: event.clientX, y: event.clientY };
    };
    this._onPointerUp = (event) => {
      if (!this._pointer) return;
      const start = this._pointer;
      this._pointer = null;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
      this._pick(event);
    };
    this._onDblClick = (event) => {
      const object = this._pickAt(event.clientX, event.clientY);
      if (object) this.focus(object);
    };

    this._mount();
  }

  /* ------------------------------------------------------------------ mount */
  _mount({ restorePose = null } = {}) {
    if (this._destroyed) return;
    this._mounted = false;
    this._ready = false;
    this.support = webglSupport();
    const requested =
      (!this._qualityChosen ? qualityFromUrl() : null) ??
      (this.config.quality && this.config.quality !== "auto" ? this.config.quality : null);
    const resolved = resolveQuality({ quality: requested, support: this.support });
    this.qualityInfo = resolved;

    this.container.classList.add("b3d");
    this.container.dataset.b3dQuality = resolved.tier;
    if (this.theme === "auto") delete this.container.dataset.b3dTheme;
    else this.container.dataset.b3dTheme = this.theme;

    const presets = { ...DEFAULT_PRESETS, ...(this.config.cameraPresets ?? this.config.camera?.presets ?? {}) };
    this.overlay = new BenchOverlay(this.container, {
      title: this.config.title,
      subtitle: this.config.subtitle,
      quality: resolved.preset,
      qualitySource: resolved.source,
      presets: presetList(presets),
      activePreset: restorePose ? null : this.config.camera?.initial ?? "overview",
      theme: this.theme,
      reducedMotion: this.reducedMotion,
      fallbackHref: this.config.fallbackHref ?? "index.html",
      objectCount: normaliseObjects(this.config.objects).length,
      onPreset: (id) => this.goToPreset(id),
      onQuality: (tier) => this.setQuality(tier),
      onReset: () => this.resetView(),
      onFocusObject: (object) => this.focus(object),
      onTheme: (theme) => this._handleTheme(theme),
      onRetry: () => this.rebuild(),
    });
    this.overlay.resize(this.container.clientWidth, this.container.clientHeight);

    if (!this.support.supported) {
      this._mountFallback({
        title: "This browser cannot open the 3D lab",
        message: "WebGL is unavailable or disabled, so the bench cannot start. The 2D experiments are unaffected.",
        details: [
          "WebGL was not detected on this device.",
          "Enable hardware acceleration in the browser settings, then try again.",
          "Current browsers on desktop and recent phones usually support WebGL2.",
        ],
      });
      return;
    }

    try {
      this.scene = new BenchScene({
        container: this.container,
        quality: resolved.preset,
        reducedMotion: this.reducedMotion,
        cameraPresets: presets,
        initialPreset: this.config.camera?.initial ?? "overview",
        renderOnDemand: this.config.renderOnDemand !== false,
        onAfterRender: () => this.overlay?.render(this.scene.scene, this.scene.camera),
        onResize: ({ width, height }) => this.overlay?.resize(width, height),
        onStats: (stats) => this._handleStats(stats),
      });

      this.library = new MaterialLibrary({ quality: resolved.preset, renderer: this.scene.renderer });
      this.resources = new ResourcePool();
      this.shadowRoot = createShadowRoot();
      this.scene.scene.add(this.shadowRoot);

      const ctx = {
        quality: resolved.preset,
        library: this.library,
        resources: this.resources,
        shadowRoot: this.shadowRoot,
      };

      if (this.config.environment !== false) {
        const environmentOptions = typeof this.config.environment === "object" ? this.config.environment : {};
        const environment = createObject(
          "labEnvironment",
          {
            ...environmentOptions,
            id: "lab-environment",
            label: "Lab bench",
            role: "environment",
            interactive: false,
            labelVisible: false,
            contactShadow: false,
          },
          ctx,
        );
        this.scene.scene.add(environment);
        this.environment = environment;
      }

      this.objects = [];
      const objectConfigs = normaliseObjects(this.config.objects);
      for (const item of objectConfigs) {
        const { type, ...options } = item;
        const object = createObject(type, options, ctx);
        this.scene.scene.add(object);
        this.objects.push(object);
      }

      this.pickables = this.objects.filter((object) => object.userData?.interactive !== false);
      this.overlay.setObjects(this.objects);
      this.overlay.setCount(this.pickables.length);
      this.scene.invalidate();

      if (restorePose) {
        this.scene.rig.goTo(restorePose, { immediate: true });
        this.overlay.setActivePreset(null);
      }

      const canvas = this.scene.renderer.domElement;
      canvas.addEventListener("pointerdown", this._onPointerDown);
      canvas.addEventListener("pointerup", this._onPointerUp);
      canvas.addEventListener("dblclick", this._onDblClick);

      this._mounted = true;
      this._readyRaf = requestAnimationFrame(() => {
        this._readyRaf = requestAnimationFrame(() => this._finishReady());
      });
    } catch (error) {
      console.error("[Bench3D] failed to start", error);
      this._disposeInternals({ keepOverlay: true });
      this.overlay?.clearLabels();
      this._mountFallback({
        title: "The 3D bench could not start",
        message: "The scene failed while loading. This is usually a graphics driver or memory problem.",
        details: [String(error?.message ?? error), "Try a lower quality tier, or open the 2D lab."],
      });
    }
  }

  _finishReady() {
    if (!this._mounted || this._destroyed || !this.overlay) return;
    this._ready = true;
    this.overlay.setReady();
    this.container.dispatchEvent(
      new CustomEvent("bench3d:ready", { bubbles: true, detail: { instance: this, stats: this.getStats() } }),
    );
    this.config.onReady?.(this);
    this.overlay.announce(
      `${this.objects.length} objects on the bench. Camera views 1 to 5, diagnostics with the tilde key.`,
    );
  }

  _mountFallback({ title, message, details }) {
    this._mounted = false;
    this._ready = false;
    this.container.classList.add("b3d--fallback");
    this.overlay?.showFallback({
      title,
      message,
      details: [...details, deviceSummary(this.support ?? webglSupport())],
      href: this.config.fallbackHref ?? "index.html",
    });
    this.container.dispatchEvent(
      new CustomEvent("bench3d:fallback", { bubbles: true, detail: { support: this.support } }),
    );
    this.config.onFallback?.(this.support);
  }

  /* ------------------------------------------------------------------ events */
  _handleStats(stats) {
    this._lastStats = stats;
    this.overlay?.setFps(stats.fps, stats.idle);
    if (this.overlay?.debugOpen) this.overlay.setDebugData(this.getDebugData(stats));
  }

  _handleTheme(theme) {
    this.theme = theme;
    this.container.dataset.b3dTheme = theme;
    this.container.dispatchEvent(
      new CustomEvent("bench3d:theme", { bubbles: true, detail: { theme, instance: this } }),
    );
    this.config.onTheme?.(theme, this);
  }

  _pickAt(clientX, clientY) {
    if (!this.scene) return null;
    const canvas = this.scene.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const pointer = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, this.scene.camera);
    const hits = raycaster.intersectObjects(this.pickables, true);
    for (const hit of hits) {
      if (hit.object?.name === "contact-shadow" || hit.object?.userData?.ignoreBounds) continue;
      let node = hit.object;
      while (node) {
        if (node.userData?.kind === "bench-object" && node.userData?.interactive !== false) return node;
        node = node.parent;
      }
    }
    return null;
  }

  _pick(event) {
    const object = this._pickAt(event.clientX, event.clientY);
    if (object) this.select(object);
    else this.select(null);
  }

  /* ------------------------------------------------------------------- API */
  get ready() {
    return this._ready;
  }

  get quality() {
    return this.qualityInfo?.tier ?? "low";
  }

  get stats() {
    return this.getStats();
  }

  setQuality(tier) {
    if (!QUALITY_PRESETS[tier]) return false;
    if (tier === this.quality && this.scene) return true;
    this._qualityChosen = true;
    saveQualityOverride(tier);
    this.rebuild({ quality: tier });
    return true;
  }

  /** Recreate the scene, keeping camera pose and theme. Used by quality changes. */
  rebuild(overrides = {}) {
    if (this._destroyed) return this;
    const pose = this.scene?.rig.getPose() ?? null;
    const restore = pose ? { position: pose.position.toArray(), target: pose.target.toArray() } : null;
    const theme = this.theme === "auto" ? undefined : this.theme;
    const config = {
      ...this.config,
      ...overrides,
      theme,
      camera: { ...(this.config.camera ?? {}), ...(overrides.camera ?? {}) },
    };
    this.config = config;
    this._disposeInternals();
    this._qualityChosen = Boolean(overrides.quality);
    this._mount({ restorePose: restore });
    if (this._mounted) {
      const preset = this.quality;
      this.container.dispatchEvent(
        new CustomEvent("bench3d:quality", { bubbles: true, detail: { tier: preset, instance: this } }),
      );
      this.overlay?.setQuality(preset, this.qualityInfo?.source);
    }
    return this;
  }

  goToPreset(name) {
    if (!this.scene) return false;
    const moved = this.scene.rig.goTo(name);
    if (moved) {
      this.overlay?.setActivePreset(this.scene.rig.activePreset);
      this.overlay?.clearSelection();
    }
    return moved;
  }

  resetView() {
    this.select(null);
    this.scene?.rig.goTo("overview");
    this.overlay?.setActivePreset("overview");
  }

  focus(objectOrId) {
    const object = typeof objectOrId === "string" ? this.getObject(objectOrId) : objectOrId;
    if (!object || !this.scene) return false;
    this.select(object);
    this.scene.rig.focusObject(object);
    this.overlay?.setActivePreset(null);
    this.overlay?.announce(`Focus: ${object.userData?.label ?? object.name}`);
    return true;
  }

  select(objectOrId) {
    const object = typeof objectOrId === "string" ? this.getObject(objectOrId) : objectOrId;
    this._selected = object ?? null;
    if (object) this.overlay?.setSelected(object);
    else this.overlay?.clearSelection();
    this.scene?.invalidate();
    this.container.dispatchEvent(
      new CustomEvent("bench3d:select", {
        bubbles: true,
        detail: object
          ? { object, id: object.userData?.id, type: object.userData?.objectType, label: object.userData?.label }
          : { object: null },
      }),
    );
    this.config.onSelect?.(object, this);
    return object ?? null;
  }

  get selected() {
    return this._selected;
  }

  getObject(id) {
    if (!id) return null;
    if (this.environment?.userData?.id === id) return this.environment;
    return this.objects.find((object) => object.userData?.id === id) ?? null;
  }

  /**
   * Update a live instrument screen.
   * @param {string} id object id
   * @param {object} model LCD model passed to the builder's setDisplay
   */
  setDisplay(id, model) {
    const object = this.getObject(id);
    if (!object?.userData?.setDisplay) return false;
    object.userData.setDisplay(model);
    this.scene?.invalidate();
    return true;
  }

  setRunning(id, running) {
    const object = this.getObject(id);
    if (!object?.userData?.setRunning) return false;
    object.userData.setRunning(Boolean(running));
    this.scene?.invalidate();
    return true;
  }

  setTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    this.theme = next;
    this.overlay?.setTheme(next);
    this._handleTheme(next);
    return next;
  }

  invalidate() {
    this.scene?.invalidate();
  }

  resize() {
    this.scene?.resize();
  }

  toggleDebug(force) {
    this.overlay?.toggleDebug(force);
    if (this.overlay?.debugOpen) this.overlay.setDebugData(this.getDebugData());
  }

  getStats() {
    const sceneStats = this.scene?.getStats() ?? {};
    const resourceStats = this.resources?.stats() ?? {};
    return {
      ...sceneStats,
      ...this._lastStats,
      objects: resourceStats.objects ?? this.objects.length,
      meshes: resourceStats.meshes ?? 0,
      geometryPool: resourceStats.geometries ?? 0,
      materialPool: resourceStats.materials ?? 0,
      quality: this.quality,
      ready: this._ready,
      support: this.support,
      theme: this.theme,
    };
  }

  getDebugData(stats = null) {
    const sceneStats = stats ?? this.scene?.getStats() ?? {};
    const resourceStats = this.resources?.stats() ?? {};
    return {
      ...sceneStats,
      ...this._lastStats,
      objects: resourceStats.objects ?? this.objects.length,
      geometries: sceneStats.geometries ?? 0,
      textures: sceneStats.textures ?? 0,
      tier: this.quality,
      idle: this._lastStats.idle,
    };
  }

  /* --------------------------------------------------------------- teardown */
  _disposeInternals({ keepOverlay = false } = {}) {
    cancelAnimationFrame(this._readyRaf);
    this._readyRaf = 0;
    this._mounted = false;
    this._ready = false;

    if (this.scene) {
      this.scene.setPaused(true);
      const canvas = this.scene.renderer?.domElement;
      canvas?.removeEventListener("pointerdown", this._onPointerDown);
      canvas?.removeEventListener("pointerup", this._onPointerUp);
      canvas?.removeEventListener("dblclick", this._onDblClick);
    }

    if (!keepOverlay) {
      this.overlay?.destroy();
      this.overlay = null;
    }

    this.resources?.dispose();
    this.resources = null;
    this.library?.dispose();
    this.library = null;

    this.scene?.dispose();
    this.scene = null;
    this.shadowRoot = null;
    this.environment = null;
    this.objects = [];
    this.pickables = [];
    this._selected = null;
    this._pointer = null;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._disposeInternals();
    this.container.classList.remove("b3d", "b3d--light", "b3d--fallback");
    delete this.container.dataset.b3dTheme;
    delete this.container.dataset.b3dQuality;
    Bench3D._release(this);
  }
}

export const Bench3D = {
  _active: null,

  /**
   * Mount the bench into `container`.
   * @param {HTMLElement} container
   * @param {{
   *  title?: string, subtitle?: string,
   *  quality?: "auto"|"high"|"medium"|"low",
   *  theme?: "auto"|"dark"|"light",
   *  reducedMotion?: boolean,
   *  environment?: boolean|object,
   *  objects?: Array<object|string>,
   *  camera?: {initial?: string, presets?: object},
   *  cameraPresets?: object,
   *  renderOnDemand?: boolean,
   *  fallbackHref?: string,
   *  onReady?: Function, onSelect?: Function, onTheme?: Function,
   *  onFallback?: Function
   * }} config
   * @returns {BenchInstance}
   */
  init(container, config = {}) {
    if (!container || typeof container.appendChild !== "function") {
      throw new Error("Bench3D.init(container, config): a container element is required");
    }
    if (Bench3D._active) Bench3D._active.destroy();
    const instance = new BenchInstance(container, config);
    Bench3D._active = instance;
    return instance;
  },

  get instance() {
    return Bench3D._active;
  },

  get ready() {
    return Boolean(Bench3D._active?.ready);
  },

  destroy() {
    Bench3D._active?.destroy();
  },

  _release(instance) {
    if (Bench3D._active === instance) Bench3D._active = null;
  },
};

export { CameraRig };
export default Bench3D;
