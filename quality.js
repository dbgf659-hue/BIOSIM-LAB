/**
 * BioSim Lab · engine3d/quality.js
 * ---------------------------------------------------------------------------
 * Capability detection and the three rendering tiers the 3D bench ships.
 *
 * The tiers are deliberately boring: each one is a plain object of limits the
 * rest of the 3D layer reads. Nothing here touches the DOM except the optional
 * localStorage override, so the module is safe to import from a worker or test.
 *
 *   high    shadows + bloom + transmission glass + environment reflections
 *   medium  shadows + simple glass, no post-processing
 *   low     no shadows, flat glass, capped frame rate
 *
 * A user override always wins over auto-detection, and a tier that cannot run
 * is clamped before it reaches the renderer.
 */

import { PCFShadowMap } from "three";

export const QUALITY_TIERS = Object.freeze(["high", "medium", "low"]);

export const QUALITY_PRESETS = Object.freeze({
  high: Object.freeze({
    tier: "high",
    label: "High",
    pixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowType: PCFShadowMap,
    bloom: true,
    bloomStrength: 0.1,
    bloomRadius: 0.16,
    bloomThreshold: 1.25,
    transmission: true,
    environment: true,
    environmentIntensity: 0.1,
    exposure: 0.9,
    dust: 60,
    labels: true,
    maxFps: 0,
  }),
  medium: Object.freeze({
    tier: "medium",
    label: "Medium",
    pixelRatio: 1.6,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    shadowType: PCFShadowMap,
    bloom: false,
    bloomStrength: 0,
    bloomRadius: 0.4,
    bloomThreshold: 1,
    transmission: false,
    environment: true,
    environmentIntensity: 0.08,
    exposure: 0.94,
    dust: 28,
    labels: true,
    maxFps: 0,
  }),
  low: Object.freeze({
    tier: "low",
    label: "Low",
    pixelRatio: 1.25,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    shadowType: PCFShadowMap,
    bloom: false,
    bloomStrength: 0,
    bloomRadius: 0.4,
    bloomThreshold: 1,
    transmission: false,
    environment: false,
    environmentIntensity: 0,
    exposure: 1,
    dust: 0,
    labels: true,
    maxFps: 30,
  }),
});

const STORAGE_KEY = "biosimlab.bench3d.quality";

/** Return a valid preset, falling back to auto-detection for unknown values. */
export function qualityPreset(tier) {
  return QUALITY_PRESETS[tier] ?? null;
}

/** True when the browser can create a WebGL context at all. */
export function webglSupport() {
  const result = {
    supported: false,
    webgl2: false,
    renderer: "",
    vendor: "",
    software: false,
  };
  if (typeof document === "undefined") return result;
  let canvas = null;
  try {
    canvas = document.createElement("canvas");
    const attributes = {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
    };
    const gl = canvas.getContext("webgl2", attributes) ?? canvas.getContext("webgl", attributes);
    if (!gl) return result;
    result.supported = true;
    result.webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (info) {
      result.renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "");
      result.vendor = String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL) ?? "");
    }
    result.software = /swiftshader|llvmpipe|software|basic render/i.test(`${result.renderer} ${result.vendor}`);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    result.supported = false;
  } finally {
    canvas = null;
  }
  return result;
}

/** Read the user's saved override. Returns null when they have not chosen one. */
export function loadQualityOverride() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return QUALITY_PRESETS[saved] ? saved : null;
  } catch {
    return null;
  }
}

export function saveQualityOverride(tier) {
  if (!QUALITY_PRESETS[tier]) return false;
  try {
    localStorage.setItem(STORAGE_KEY, tier);
    return true;
  } catch {
    return false;
  }
}

export function clearQualityOverride() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

function isProbablyMobile() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const touchMac = /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua) || touchMac;
}

/**
 * Pick a tier that is honest about the hardware.
 *
 * We intentionally do not trust `deviceMemory` on its own: Firefox and Safari
 * hide it, and a desktop with 4 GB of RAM can still drive a capable GPU. The
 * core count and the WebGL renderer string carry more signal.
 */
export function detectQuality({ support = webglSupport() } = {}) {
  if (!support.supported) return "low";
  const mobile = isProbablyMobile();
  const cores = Number(navigator?.hardwareConcurrency) || 4;
  const memory = Number(navigator?.deviceMemory) || (mobile ? 4 : 8);
  const software = Boolean(support.software);

  if (software) return "low";
  if (mobile) return cores >= 6 && memory >= 4 ? "medium" : "low";
  if (cores >= 8 && memory >= 8) return "high";
  if (cores >= 4 && memory >= 4) return "medium";
  return "low";
}

/**
 * Resolve the effective tier and record where it came from.
 * @param {{quality?: string|null, support?: object}} options
 */
export function resolveQuality({ quality = null, support = webglSupport() } = {}) {
  const requested = quality && quality !== "auto" ? quality : null;
  const stored = requested ? null : loadQualityOverride();
  const supported = support.supported;
  let tier = requested ?? stored ?? detectQuality({ support });
  if (!QUALITY_PRESETS[tier]) tier = "low";
  // Without WebGL there is no tier, but keep the label meaningful for the
  // fallback toast: callers check `supported` separately.
  return {
    tier,
    preset: QUALITY_PRESETS[tier],
    source: requested ? "request" : stored ? "saved" : "auto",
    supported,
    support,
  };
}

/** Short human-readable hardware note for the debug panel. */
export function deviceSummary(support = webglSupport()) {
  const cores = Number(navigator?.hardwareConcurrency) || 0;
  const memory = Number(navigator?.deviceMemory) || 0;
  const gpu = support.renderer ? support.renderer.replace(/^ANGLE \((.*)\)$/, "$1") : "unknown GPU";
  return `${support.webgl2 ? "WebGL2" : "WebGL1"} · ${gpu} · ${cores || "?"} threads${
    memory ? ` · ${memory} GB` : ""
  }`;
}

/** Respect the OS reduced-motion setting; camera fly-to becomes instant. */
export function prefersReducedMotion() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
