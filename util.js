/**
 * BioSim Lab · engine/util.js
 * ---------------------------------------------------------------------------
 * Small shared helpers. Deliberately dependency-free and DOM-safe to import
 * from either the browser or a headless test.
 */

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export const lerp = (a, b, t) => a + (b - a) * t;

export const roundTo = (value, step) => Math.round(value / step) * step;

let counter = 0;
/** Deterministic-enough unique id for DOM nodes and bench items. */
export function uid(prefix = "id") {
  counter += 1;
  return `${prefix}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function debounce(fn, delay = 120) {
  let handle = null;
  return (...args) => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delay);
  };
}

export const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 1250 -> "1.25 mL"; 250 -> "250 µL" */
export function formatVolume(ul) {
  const value = Number(ul) || 0;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2).replace(/\.00$/, "")} mL`;
  if (Math.abs(value) >= 10) return `${value.toFixed(0)} µL`;
  return `${value.toFixed(1)} µL`;
}

export function formatTemp(c) {
  return `${(Number(c) || 0).toFixed(1)} °C`;
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-3)) return value.toExponential(2);
  return Number(value.toFixed(digits)).toString();
}

/** Escape user/model text before it reaches innerHTML. */
export function escapeHTML(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Add one listener and return its remover, so destroy() stays trivial. */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** Request an animation frame that is cancelled by the returned function. */
export function rafLoop(callback) {
  let handle = null;
  let last = 0;
  let stopped = false;
  const tick = (now) => {
    if (stopped) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    callback(dt, now);
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (handle !== null) cancelAnimationFrame(handle);
  };
}
