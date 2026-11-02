/**
 * BioSim Lab · engine.js
 * ---------------------------------------------------------------------------
 * Numerically-correct stepping layer over numerics.js.
 *
 * State vectors are plain objects ( {S: 4.2, P: 0.1, ...} ) rather than typed
 * arrays: every model in js/data/models declares its own named compartments,
 * which keeps the differential equations readable next to their biology and
 * makes derived series / CSV export trivial.
 *
 * Provides:
 *   • RK4 for the real-time loop (fixed step, 4th order)
 *   • Dormand–Prince RK45 (adaptive) for headless reference solutions
 *   • Euler–Maruyama for the stochastic (drift + noise) models
 *   • a deterministic Monte-Carlo driver used by uncertainty readouts
 */

import { clamp, RNG } from "./numerics.js";

export const DEFAULT_ABS_FLOOR = -1e-9;

/** Clone a plain object state. */
export function cloneState(y) {
  const out = {};
  for (const key in y) out[key] = y[key];
  return out;
}

/**
 * One classical RK4 step on an object state.
 * @param {(t:number, y:object, p:object)=>object} f derivative
 */
export function rk4(f, t, y, h, p) {
  const k1 = f(t, y, p);
  const s2 = {};
  const s3 = {};
  const s4 = {};
  for (const key in y) s2[key] = y[key] + 0.5 * h * (k1[key] || 0);
  const k2 = f(t + h / 2, s2, p);
  for (const key in y) s3[key] = y[key] + 0.5 * h * (k2[key] || 0);
  const k3 = f(t + h / 2, s3, p);
  for (const key in y) s4[key] = y[key] + h * (k3[key] || 0);
  const k4 = f(t + h, s4, p);

  const out = {};
  for (const key in y) {
    out[key] =
      y[key] +
      (h / 6) * ((k1[key] || 0) + 2 * (k2[key] || 0) + 2 * (k3[key] || 0) + (k4[key] || 0));
  }
  return out;
}

/**
 * Dormand–Prince 5(4) adaptive integrator. Used for validation reference runs
 * and for the "solver convergence" check, never inside the render loop.
 */
export function rk45(f, t0, y0, tEnd, p = null, opts = {}) {
  const { atol = 1e-8, rtol = 1e-6, hMax = (tEnd - t0) / 25 || 1e-3, maxSteps = 200000 } = opts;
  const A = [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ];
  const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
  const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
  const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];
  const keys = Object.keys(y0);
  const n = keys.length;

  let t = t0;
  let y = cloneState(y0);
  let h = Math.min(hMax, Math.abs(tEnd - t0) / 20 || hMax);
  const ts = [t];
  const ys = [{ ...y }];
  let steps = 0;
  let accepted = 0;

  while (t < tEnd && steps < maxSteps) {
    if (t + h > tEnd) h = tEnd - t;
    const k = [];
    k[0] = f(t, y, p);
    for (let s = 1; s < 7; s++) {
      const stage = {};
      for (const key of keys) {
        let v = 0;
        for (let j = 0; j < s; j++) if (A[s][j]) v += A[s][j] * (k[j][key] || 0);
        stage[key] = y[key] + h * v;
      }
      k[s] = f(t + C[s] * h, stage, p);
    }
    const y5 = {};
    const y4 = {};
    for (const key of keys) {
      let hi = y[key];
      let lo = y[key];
      for (let s = 0; s < 7; s++) {
        hi += h * B5[s] * (k[s][key] || 0);
        lo += h * B4[s] * (k[s][key] || 0);
      }
      y5[key] = hi;
      y4[key] = lo;
    }
    let err = 0;
    for (const key of keys) {
      const scale = atol + rtol * Math.max(Math.abs(y[key]), Math.abs(y5[key]));
      err += ((y5[key] - y4[key]) / scale) ** 2;
    }
    err = Math.sqrt(err / n);
    if (err <= 1) {
      t += h;
      y = y5;
      ts.push(t);
      ys.push({ ...y });
      accepted++;
    }
    const factor = err === 0 ? 4 : clamp(0.9 * Math.pow(err, -0.2), 0.2, 4);
    h = Math.min(hMax, Math.max(1e-12, h * factor));
    steps++;
  }
  return { t: ts, y: ys, steps, accepted };
}

/**
 * Euler–Maruyama for SDE models  dy = f(t,y) dt + g(t,y) dW.
 */
export function eulerMaruyama(f, g, t, y, h, p, rng) {
  const drift = f(t, y, p);
  const noise = g(t, y, p);
  const sq = Math.sqrt(h);
  const out = {};
  for (const key in y) {
    out[key] = y[key] + h * (drift[key] || 0) + sq * (noise[key] || 0) * rng.normal(0, 1);
  }
  return out;
}

/**
 * Headless run: integrate a model to completion with fixed steps.
 * Used by the numeric-convergence validator and by unit-style checks.
 */
export function integrate(model, params, { dt, tEnd, t0 = 0, sample = null } = {}) {
  const step = dt ?? model.dt;
  const end = tEnd ?? model.tEnd;
  let y = model.init(params);
  const rng = new RNG(params.__seed ?? model.id ?? 1);
  const ts = [t0];
  const ys = [cloneState(y)];
  let t = t0;
  let guard = 0;
  while (t < end - 1e-12 && guard < 500000) {
    if (model.deriv) {
      y = rk4(model.deriv, t, y, Math.min(step, end - t), params);
    } else if (model.step) {
      y = model.step(y, params, Math.min(step, end - t), t, rng);
    } else break;
    if (model.postStep) y = model.postStep(y, params, t + step);
    t += step;
    ts.push(t);
    ys.push(cloneState(y));
    guard++;
    if (sample) sample(t, y);
  }
  return { t: ts, y: ys, rng };
}

/**
 * Deterministic Monte-Carlo driver: runs the model under multiplicative
 * parameter jitter and returns the quantile band for one observable.
 * This is the uncertainty readout shown next to each bench.
 */
export function monteCarloBand(model, params, key, { runs = 24, jitter = 0.1, dt, tEnd } = {}) {
  const step = dt ?? model.dt;
  const end = tEnd ?? model.tEnd;
  const columns = [];
  for (let r = 0; r < runs; r++) {
    const rng = new RNG(`${model.id}-mc-${r}`);
    const jittered = {};
    for (const [name, value] of Object.entries(params)) {
      if (typeof value !== "number") {
        jittered[name] = value;
        continue;
      }
      const sensitive = name !== key && !/seed|temp|time|cycles|generation/i.test(name);
      jittered[name] = sensitive ? value * Math.exp(rng.normal(0, jitter)) : value;
    }
    let y = model.init(jittered);
    let t = 0;
    const column = [];
    const every = Math.max(1, Math.floor(end / step / 48));
    let i = 0;
    while (t < end - 1e-12) {
      if (model.deriv) y = rk4(model.deriv, t, y, step, jittered);
      else if (model.step) y = model.step(y, jittered, step, t, rng);
      t += step;
      if (i % every === 0 && Number.isFinite(y[key])) column.push(y[key]);
      i++;
    }
    if (Number.isFinite(y[key])) column.push(y[key]);
    columns.push(column);
  }
  const n = Math.min(...columns.map((c) => c.length));
  const lo = [];
  const hi = [];
  const mid = [];
  for (let i = 0; i < n; i++) {
    const row = columns.map((c) => c[i]).sort((a, b) => a - b);
    const pick = (q) => row[clamp(Math.round(q * (row.length - 1)), 0, row.length - 1)];
    lo.push(pick(0.05));
    mid.push(pick(0.5));
    hi.push(pick(0.95));
  }
  return { lo, mid, hi, runs };
}
