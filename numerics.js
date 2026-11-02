/**
 * BioSim Lab · numerics.js
 * ---------------------------------------------------------------------------
 * Dependency-free numerical core for the real-time bio-simulation bench.
 *
 *  • deterministic vector helpers
 *  • xoshiro128** PRNG with Poisson / binomial / normal / exponential draws
 *  • classic RK4
 *  • Dormand–Prince RK45 with embedded error estimate and adaptive stepping
 *  • root finding, trapezoidal integration and descriptive statistics
 *
 * All routines are side-effect free and safe to use in a Web Worker or in the
 * headless validation runner.
 */

export const EPS = 1e-12;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function vec(length, fill = 0) {
  const out = new Float64Array(length);
  if (fill) out.fill(fill);
  return out;
}

export function copyVec(y) {
  return Float64Array.from(y);
}

export function maxAbs(y) {
  let m = 0;
  for (let i = 0; i < y.length; i++) {
    const a = Math.abs(y[i]);
    if (a > m) m = a;
  }
  return m;
}

export function sum(y) {
  let s = 0;
  for (let i = 0; i < y.length; i++) s += y[i];
  return s;
}

export function sqSum(y) {
  let s = 0;
  for (let i = 0; i < y.length; i++) s += y[i] * y[i];
  return s;
}

export function finite(y, tol = 1e-9) {
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]) || Math.abs(y[i]) > 1e12) return false;
  }
  return true;
}

export function sanitize(y, floor = 0) {
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) y[i] = floor;
    else if (y[i] < floor) y[i] = floor;
  }
  return y;
}

export function addScaled(a, b, s) {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i] * s;
  return out;
}

export function weightedSum(vectors, weights) {
  const n = vectors[0].length;
  const out = new Float64Array(n);
  for (let k = 0; k < vectors.length; k++) {
    const w = weights[k];
    if (!w) continue;
    const v = vectors[k];
    for (let i = 0; i < n; i++) out[i] += v[i] * w;
  }
  return out;
}

/* ==========================================================================
   Deterministic PRNG — xoshiro128** seeded through splitmix32
   ========================================================================== */

export function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed = 0x9e3779b9) {
    const s = typeof seed === "string" ? hashString(seed) : seed >>> 0;
    let x = s || 1;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
    this._spare = null;
  }

  nextUint32() {
    const result = (Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0);
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result;
  }

  /** Uniform on [0, 1). */
  next() {
    return this.nextUint32() / 4294967296;
  }

  uniform(min = 0, max = 1) {
    return min + (max - min) * this.next();
  }

  int(min, max) {
    return Math.floor(this.uniform(min, max + 1));
  }

  /** Box–Muller normal, cached spare. */
  normal(mean = 0, sd = 1) {
    if (this._spare !== null) {
      const value = this._spare;
      this._spare = null;
      return mean + value * sd;
    }
    let u = 0;
    let v = 0;
    while (u <= EPS) u = this.next();
    v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    this._spare = r * Math.sin(theta);
    return mean + r * Math.cos(theta) * sd;
  }

  lognormal(median = 1, sigma = 0.1) {
    return median * Math.exp(this.normal(0, sigma));
  }

  exponential(rate) {
    if (!(rate > 0)) return Infinity;
    let u = this.next();
    if (u <= 0) u = 1e-12;
    return -Math.log(u) / rate;
  }

  /** Knuth / inversion hybrid Poisson. */
  poisson(lambda) {
    if (!(lambda > 0)) return 0;
    if (lambda < 40) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.next();
      } while (p > L && k < 10000);
      return k - 1;
    }
    // Normal approximation with continuity correction for large means.
    return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
  }

  binomial(n, p) {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n < 60) {
      let k = 0;
      for (let i = 0; i < n; i++) if (this.next() < p) k++;
      return k;
    }
    return clamp(Math.round(this.normal(n * p, Math.sqrt(n * p * (1 - p)))), 0, n);
  }

  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  shuffle(items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

function rotl(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/* ==========================================================================
   Integrators
   ========================================================================== */

/**
 * One classical fourth-order Runge–Kutta step.
 * @returns {Float64Array} y(t + h)
 */
export function rk4Step(f, t, y, h, p = null) {
  const k1 = f(t, y, p);
  const k2 = f(t + h / 2, addScaled(y, k1, h / 2), p);
  const k3 = f(t + h / 2, addScaled(y, k2, h / 2), p);
  const k4 = f(t + h, addScaled(y, k3, h), p);
  const out = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) {
    out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return out;
}

const DP_A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const DP_B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const DP_B4 = [
  5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40,
];
const DP_E = DP_B5.map((b, i) => b - DP_B4[i]);

/**
 * One Dormand–Prince RK45 step with embedded fourth-order error estimate.
 *
 * @param {Function} f  derivative f(t, y, p) -> Float64Array
 * @returns {{ y: Float64Array, yHigh: Float64Array, err: number, hNew: number, accepted: boolean, k1: Float64Array }}
 */
export function rk45Step(f, t, y, h, p = null, atol = 1e-7, rtol = 1e-4) {
  const n = y.length;
  const k = new Array(7);
  k[0] = f(t, y, p);

  for (let s = 1; s < 7; s++) {
    const a = DP_A[s];
    const acc = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let j = 0; j < a.length; j++) if (a[j]) v += a[j] * k[j][i];
      acc[i] = v;
    }
    const stageY = new Float64Array(n);
    for (let i = 0; i < n; i++) stageY[i] = y[i] + h * acc[i];
    k[s] = f(t + DP_C[s] * h, stageY, p);
  }

  const yHigh = new Float64Array(n);
  const yErr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let hi = y[i];
    let lo = y[i];
    for (let s = 0; s < 7; s++) {
      hi += h * DP_B5[s] * k[s][i];
      lo += h * DP_B4[s] * k[s][i];
    }
    yHigh[i] = hi;
    yErr[i] = hi - lo;
  }

  // RMS norm in scaled units.
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yHigh[i]));
    const r = yErr[i] / scale;
    acc += r * r;
  }
  const err = Math.sqrt(acc / Math.max(1, n));
  const factor = err === 0 ? 5 : clamp(0.9 * Math.pow(err, -0.2), 0.2, 5);
  const clipped = clamp(factor, 0.2, 5);
  return {
    y: yHigh,
    yHigh,
    yLow: new Float64Array(n).map((_, i) => yHigh[i] - yErr[i]),
    yErr,
    err,
    hNew: h * clipped,
    accepted: err <= 1,
    k1: k[0],
  };
}

/* ==========================================================================
   Small numerical utilities used by validation and models
   ========================================================================== */

export function bisect(fn, lo, hi, tol = 1e-7, maxIter = 100) {
  let flo = fn(lo);
  let fhi = fn(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) return null;
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fm = fn(mid);
    if (Math.abs(fm) < tol || (hi - lo) / 2 < tol) return mid;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export function trapezoid(xs, ys) {
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    area += ((ys[i] + ys[i - 1]) * (xs[i] - xs[i - 1])) / 2;
  }
  return area;
}

export function interp(xs, ys, x) {
  if (!xs.length) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo] || 1;
  return lerp(ys[lo], ys[hi], (x - xs[lo]) / span);
}

export function mean(values) {
  if (!values.length) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stdev(values, avg = null) {
  if (values.length < 2) return 0;
  const m = avg ?? mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

export function percentile(sortedValues, p) {
  if (!sortedValues.length) return NaN;
  const idx = clamp((p / 100) * (sortedValues.length - 1), 0, sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lerp(sortedValues[lo], sortedValues[hi], idx - lo);
}

export function quantileBand(columns, low = 5, high = 95) {
  const n = columns[0]?.length ?? 0;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const mid = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const values = columns.map((c) => c[i]).sort((a, b) => a - b);
    lo[i] = percentile(values, low);
    hi[i] = percentile(values, high);
    mid[i] = percentile(values, 50);
  }
  return { lo, hi, mid };
}

/** Ordinary least squares y = m x + b. */
export function linearFit(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { m: 0, b: ys[0] ?? 0, r2: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const m = sxx ? sxy / sxx : 0;
  const b = my - m * mx;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { m, b, r2 };
}

export function rmse(pred, obs) {
  const n = Math.min(pred.length, obs.length);
  if (!n) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) s += (pred[i] - obs[i]) ** 2;
  return Math.sqrt(s / n);
}

export function nrmse(pred, obs) {
  const n = Math.min(pred.length, obs.length);
  if (!n) return NaN;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, obs[i]);
    hi = Math.max(hi, obs[i]);
  }
  const range = hi - lo || Math.max(1e-9, Math.abs(hi));
  return rmse(pred, obs) / range;
}

export function rSquared(pred, obs) {
  const n = Math.min(pred.length, obs.length);
  if (n < 2) return 0;
  const m = mean(obs.slice(0, n));
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (obs[i] - pred[i]) ** 2;
    ssTot += (obs[i] - m) ** 2;
  }
  return ssTot ? 1 - ssRes / ssTot : 0;
}

/** Chi-square survival function for integer-ish df (Wilson–Hilferty). */
export function chiSquarePValue(chi2, df) {
  if (df <= 0) return 1;
  const z = (Math.cbrt(chi2 / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 0.5 * erfc(z / Math.SQRT2);
}

export function erfc(x) {
  // Abramowitz & Stegun 7.1.26
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? ans : 2 - ans;
}

export function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

export function hill(x, k, n = 1) {
  const xn = Math.pow(Math.max(0, x), n);
  const kn = Math.pow(Math.max(0, k), n);
  return xn / (xn + kn + EPS);
}

export function q10Factor(tempC, referenceC, q10 = 2, span = 10) {
  return Math.pow(q10, (tempC - referenceC) / span);
}

export function arrhenius(tempC, eaKj = 50, refC = 37) {
  const R = 8.314e-3; // kJ mol^-1 K^-1
  const T = tempC + 273.15;
  const Tref = refC + 273.15;
  return Math.exp((eaKj / R) * (1 / Tref - 1 / T));
}

export function clampRange(value, def) {
  if (def.min !== undefined && value < def.min) return def.min;
  if (def.max !== undefined && value > def.max) return def.max;
  return value;
}
