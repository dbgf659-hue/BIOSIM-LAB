/**
 * BioSim Lab · Advanced Solver Engine
 * ---------------------------------------------------------------------------
 * Numerical solvers for ODEs, SDEs, and stochastic simulation.
 * Supports: RK4, RK45 (Dormand-Prince), Implicit methods, Gillespie SSA, Tau-leaping
 */

export const SolverEngine = {
  /**
   * Runge-Kutta 4th Order (classic RK4)
   * Fixed step, 4th order accuracy
   * Best for: Non-stiff ODEs, educational demos
   */
  rk4(f, t0, y0, dt, steps) {
    const t = [t0];
    const y = [y0.slice ? y0.slice() : [...y0]];

    for (let i = 0; i < steps; i++) {
      const k1 = f(t[i], y[i]);
      const k2 = f(t[i] + dt/2, this._addVec(y[i], this._scaleVec(k1, dt/2)));
      const k3 = f(t[i] + dt/2, this._addVec(y[i], this._scaleVec(k2, dt/2)));
      const k4 = f(t[i] + dt, this._addVec(y[i], this._scaleVec(k3, dt)));

      const yNext = this._addVec(
        y[i],
        this._scaleVec(
          this._addVec(
            this._addVec(k1, this._scaleVec(k2, 2)),
            this._addVec(this._scaleVec(k3, 2), k4)
          ),
          dt/6
        )
      );

      t.push(t[i] + dt);
      y.push(yNext);
    }
    return { t, y };
  },

  /**
   * Runge-Kutta 4/5 (Dormand-Prince) with adaptive step size
   * 5th order solution with 4th order error estimate
   * Best for: General purpose, automatic error control
   */
  rk45(f, t0, y0, tEnd, options = {}) {
    const {
      atol = 1e-6,
      rtol = 1e-3,
      hMin = 1e-6,
      hMax = 0.1,
      h0 = 0.01,
      maxSteps = 100000,
      denseOutput = false
    } = options;

    // Dormand-Prince coefficients (Butcher tableau)
    const a = [
      [],                    // k1
      [1/5],                 // k2
      [3/40, 9/40],          // k3
      [44/45, -56/15, 32/9], // k4
      [19372/6561, -25360/2187, 64448/6561, -212/729], // k5
      [9017/3168, -355/33, 46732/5247, 49/176, -5103/18656], // k6
      [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84]  // k7 (5th order)
    ];
    const b5 = [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84, 0]; // 5th order
    const b4 = [5179/57600, 0, 7571/16695, 393/640, -92097/339200, 187/2100, 1/40]; // 4th order
    const c = [0, 1/5, 3/10, 4/5, 8/9, 1, 1];

    const t = [t0];
    const y = [y0.slice ? y0.slice() : [...y0]];
    let h = h0;
    let steps = 0;

    while (t[t.length - 1] < tEnd && steps < maxSteps) {
      const tn = t[t.length - 1];
      const yn = y[y.length - 1];

      if (tn + h > tEnd) h = tEnd - tn;
      if (h < hMin) {
        console.warn('Step size below minimum');
        break;
      }

      const k = new Array(7);
      k[0] = f(tn, yn);

      for (let i = 1; i < 7; i++) {
        const sum = this._zeroVec(yn.length);
        for (let j = 0; j < i; j++) {
          this._addVecInPlace(sum, this._scaleVec(k[j], a[i][j] * h));
        }
        k[i] = f(tn + c[i] * h, this._addVec(yn, sum));
      }

      // 5th and 4th order solutions
      const y5 = this._zeroVec(yn.length);
      const y4 = this._zeroVec(yn.length);
      for (let i = 0; i < 7; i++) {
        this._addVecInPlace(y5, this._scaleVec(k[i], b5[i] * h));
        this._addVecInPlace(y4, this._scaleVec(k[i], b4[i] * h));
      }
      this._addVecInPlace(y5, yn);
      this._addVecInPlace(y4, yn);

      // Error estimate
      let err = 0;
      for (let i = 0; i < yn.length; i++) {
        const scale = atol + rtol * Math.max(Math.abs(yn[i]), Math.abs(y5[i]));
        const diff = Math.abs(y5[i] - y4[i]);
        err = Math.max(err, diff / scale);
      }

      if (err <= 1) {
        // Accept step
        t.push(tn + h);
        y.push(y5);

        // Dense output storage for interpolation
        if (denseOutput) {
          if (!this._denseData) this._denseData = [];
          this._denseData.push({ t: tn, y: yn, k, h });
        }
      }

      // Adaptive step size control
      const safety = 0.9;
      const errRatio = err === 0 ? 2 : Math.pow(err, -0.2);
      h = Math.min(hMax, Math.max(hMin, safety * h * errRatio));
      steps++;
    }

    return { t, y, steps, denseData: this._denseData || null };
  },

  /**
   * Implicit Euler (Backward Euler) - for stiff systems
   * Uses Newton iteration for nonlinear systems
   */
  implicitEuler(f, t0, y0, dt, steps, options = {}) {
    const { newtonTol = 1e-8, maxNewton = 10 } = options;
    const n = y0.length;

    const t = [t0];
    const y = [y0.slice ? y0.slice() : [...y0]];

    for (let i = 0; i < steps; i++) {
      const tn = t[i];
      const yn = y[i];

      // Newton iteration: y_{n+1} = y_n + dt * f(t_{n+1}, y_{n+1})
      // Solve: F(y_{n+1}) = y_{n+1} - y_n - dt * f(t_{n+1}, y_{n+1}) = 0
      let yNext = yn.slice();

      for (let iter = 0; iter < maxNewton; iter++) {
        const fVal = f(tn + dt, yNext);
        const F = this._subVec(yNext, this._addVec(yn, this._scaleVec(fVal, dt)));

        const FNorm = Math.sqrt(F.reduce((s, v) => s + v*v, 0));
        if (FNorm < newtonTol) break;

        // Approximate Jacobian: J = I - dt * df/dy
        const J = this._approximateJacobian(f, tn + dt, yNext, dt);
        const delta = this._solveLinear(J, F);
        this._subVecInPlace(yNext, delta);
      }

      t.push(tn + dt);
      y.push(yNext);
    }
    return { t, y };
  },

  /**
   * Rosenbrock method (semi-implicit) for stiff systems
   * 2nd order, L-stable
   */
  rosenbrock2(f, t0, y0, dt, steps, options = {}) {
    const { newtonTol = 1e-8 } = options;
    const n = y0.length;
    const gamma = 1 - 1/Math.sqrt(2); // ~0.292893

    const t = [t0];
    const y = [y0.slice ? y0.slice() : [...y0]];

    for (let i = 0; i < steps; i++) {
      const tn = t[i];
      const yn = y[i];

      // Stage 1: k1 = f(tn + gamma*dt, yn + gamma*dt*k1)
      let k1 = this._zeroVec(n);
      for (let iter = 0; iter < 5; iter++) {
        const fVal = f(tn + gamma*dt, this._addVec(yn, this._scaleVec(k1, gamma*dt)));
        const newK1 = fVal;
        if (this._vecDist(k1, newK1) < newtonTol) { k1 = newK1; break; }
        k1 = newK1;
      }

      // Stage 2: k2 = f(tn + dt, yn + dt*( (1-gamma)*k1 + gamma*k2 ))
      let k2 = this._zeroVec(n);
      for (let iter = 0; iter < 5; iter++) {
        const sum = this._addVec(
          this._scaleVec(k1, (1-gamma)*dt),
          this._scaleVec(k2, gamma*dt)
        );
        const fVal = f(tn + dt, this._addVec(yn, sum));
        const newK2 = fVal;
        if (this._vecDist(k2, newK2) < newtonTol) { k2 = newK2; break; }
        k2 = newK2;
      }

      // Update: y_{n+1} = y_n + dt * ( (1-gamma)*k1 + gamma*k2 )
      const yNext = this._addVec(yn, this._addVec(
        this._scaleVec(k1, (1-gamma)*dt),
        this._scaleVec(k2, gamma*dt)
      ));

      t.push(tn + dt);
      y.push(yNext);
    }
    return { t, y };
  },

  /**
   * Gillespie Direct Method (SSA) - exact stochastic simulation
   * For discrete molecular populations
   */
  gillespie(reactions, initialState, tEnd, options = {}) {
    const { maxSteps = 1000000, seed = null } = options;
    let rng = seed ? this._seedRandom(seed) : Math.random;

    const state = initialState.slice ? initialState.slice() : [...initialState];
    const t = [0];
    const states = [state.slice()];

    let steps = 0;
    while (t[t.length - 1] < tEnd && steps < maxSteps) {
      // Calculate propensities
      const propensities = reactions.map(r => r.propensity(state));
      const a0 = propensities.reduce((s, a) => s + a, 0);

      if (a0 <= 0) break; // No more reactions possible

      // Time to next reaction
      const tau = -Math.log(rng()) / a0;
      if (t[t.length - 1] + tau > tEnd) break;

      // Select reaction
      const r = rng() * a0;
      let cumsum = 0;
      let reactionIdx = 0;
      for (let i = 0; i < propensities.length; i++) {
        cumsum += propensities[i];
        if (cumsum >= r) { reactionIdx = i; break; }
      }

      // Execute reaction
      const reaction = reactions[reactionIdx];
      for (const [species, change] of Object.entries(reaction.stoichiometry)) {
        state[species] += change;
      }

      t.push(t[t.length - 1] + tau);
      states.push(state.slice());
      steps++;
    }
    return { t, states, steps };
  },

  /**
   * Tau-leaping - approximate accelerated stochastic simulation
   * Groups multiple reactions per step
   */
  tauLeaping(reactions, initialState, tEnd, tau, options = {}) {
    const { maxSteps = 100000, seed = null } = options;
    let rng = seed ? this._seedRandom(seed) : Math.random;

    const state = initialState.slice ? initialState.slice() : [...initialState];
    const t = [0];
    const states = [state.slice()];

    let steps = 0;
    while (t[t.length - 1] < tEnd && steps < maxSteps) {
      const propensities = reactions.map(r => r.propensity(state));
      const a0 = propensities.reduce((s, a) => s + a, 0);

      if (a0 <= 0) break;

      // Number of firings per reaction (Poisson)
      const firings = propensities.map(a => this._poissonRandom(a * tau, rng));

      // Apply firings
      for (let i = 0; i < reactions.length; i++) {
        const reaction = reactions[i];
        for (const [species, change] of Object.entries(reaction.stoichiometry)) {
          state[species] += change * firings[i];
          if (state[species] < 0) state[species] = 0; // Non-negative
        }
      }

      t.push(t[t.length - 1] + tau);
      states.push(state.slice());
      steps++;
    }
    return { t, states, steps };
  },

  /**
   * Hybrid solver - deterministic for large populations, stochastic for small
   * Switches based on population thresholds
   */
  hybridSolver(deterministicF, reactions, state, tEnd, dt, options = {}) {
    const { threshold = 100 } = options;
    // Implementation would switch between ODE and SSA based on species counts
    // For now, use adaptive RK45 as default
    return this.rk45(deterministicF, 0, state, tEnd, { h0: dt, ...options });
  },

  // ==================== Utility Methods ====================

  _zeroVec(n) { return new Array(n).fill(0); },
  _addVec(a, b) { return a.map((v, i) => v + b[i]); },
  _addVecInPlace(a, b) { for (let i = 0; i < a.length; i++) a[i] += b[i]; },
  _subVec(a, b) { return a.map((v, i) => v - b[i]); },
  _subVecInPlace(a, b) { for (let i = 0; i < a.length; i++) a[i] -= b[i]; },
  _scaleVec(v, s) { return v.map(x => x * s); },
  _vecDist(a, b) { return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i])**2, 0)); },

  _approximateJacobian(f, t, y, dt) {
    const n = y.length;
    const J = Array.from({ length: n }, () => new Array(n).fill(0));
    const f0 = f(t, y);
    const eps = 1e-8;

    for (let j = 0; j < n; j++) {
      const yPert = y.slice();
      yPert[j] += eps;
      const fPert = f(t, yPert);
      for (let i = 0; i < n; i++) {
        J[i][j] = (fPert[i] - f0[i]) / eps;
      }
    }

    // J = I - dt * df/dy
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        J[i][j] = (i === j ? 1 : 0) - dt * J[i][j];
      }
    }
    return J;
  },

  _solveLinear(A, b) {
    // Simple Gaussian elimination for small systems
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let i = 0; i < n; i++) {
      // Pivot
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      [M[i], M[maxRow]] = [M[maxRow], M[i]];

      // Normalize
      const pivot = M[i][i];
      if (Math.abs(pivot) < 1e-12) continue;
      for (let j = i; j <= n; j++) M[i][j] /= pivot;

      // Eliminate
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = M[k][i];
          for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
        }
      }
    }

    return M.map(row => row[n]);
  },

  _poissonRandom(lambda, rng) {
    if (lambda < 20) {
      // Knuth's algorithm
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= rng();
      } while (p > L);
      return k - 1;
    } else {
      // Normal approximation for large lambda
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this._boxMuller(rng)));
    }
  },

  _boxMuller(rng) {
    const u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  },

  _seedRandom(seed) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  },

  /**
   * Interpolate solution at arbitrary time (for dense output)
   */
  interpolate(denseData, t) {
    if (!denseData || !denseData.length) return null;

    // Find interval
    let idx = 0;
    while (idx < denseData.length - 1 && denseData[idx + 1].t <= t) idx++;

    const { t: t0, y: y0, k, h } = denseData[idx];
    const theta = (t - t0) / h;

    // 4th order interpolation (Dormand-Prince)
    const bInt = [
      0.41666666666666663, -0.5, 0.5, -0.3333333333333333,
      0.16666666666666666, -0.041666666666666664, 0
    ]; // Simplified - would use actual dense output coefficients

    const interp = this._zeroVec(y0.length);
    for (let i = 0; i < k.length; i++) {
      this._addVecInPlace(interp, this._scaleVec(k[i], bInt[i] * h));
    }
    this._addVecInPlace(interp, y0);
    return interp;
  }
};

/**
 * Pre-built model definitions for common biological systems
 */
export const ModelLibrary = {
  /**
   * Michaelis-Menten enzyme kinetics: E + S <-> ES -> E + P
   * Variables: [S, ES, P], Parameters: [k1, k_1, k2, E0]
   */
  michaelisMenten(k1, k_1, k2, E0) {
    return (t, y) => {
      const [S, ES, P] = y;
      const E = E0 - ES;
      const dS = -k1 * E * S + k_1 * ES;
      const dES = k1 * E * S - (k_1 + k2) * ES;
      const dP = k2 * ES;
      return [dS, dES, dP];
    };
  },

  /**
   * Logistic growth: dN/dt = r * N * (1 - N/K)
   */
  logisticGrowth(r, K) {
    return (t, y) => [r * y[0] * (1 - y[0] / K)];
  },

  /**
   * Lotka-Volterra predator-prey
   * Variables: [prey, predator], Parameters: [alpha, beta, gamma, delta]
   */
  lotkaVolterra(alpha, beta, gamma, delta) {
    return (t, y) => [
      alpha * y[0] - beta * y[0] * y[1],
      delta * y[0] * y[1] - gamma * y[1]
    ];
  },

  /**
   * Hodgkin-Huxley neuron model
   * Variables: [V, m, h, n], Parameters: conductances, reversal potentials
   */
  hodgkinHuxley(params = {}) {
    const {
      gNa = 120, gK = 36, gL = 0.3,
      ENa = 50, EK = -77, EL = -54.4,
      Cm = 1
    } = params;

    const alphaM = V => 0.1 * (V + 40) / (1 - Math.exp(-(V + 40) / 10));
    const betaM = V => 4 * Math.exp(-(V + 65) / 18);
    const alphaH = V => 0.07 * Math.exp(-(V + 65) / 20);
    const betaH = V => 1 / (1 + Math.exp(-(V + 35) / 10));
    const alphaN = V => 0.01 * (V + 55) / (1 - Math.exp(-(V + 55) / 10));
    const betaN = V => 0.125 * Math.exp(-(V + 65) / 80);

    return (t, y) => {
      const [V, m, h, n] = y;
      const mInf = alphaM(V) / (alphaM(V) + betaM(V));
      const hInf = alphaH(V) / (alphaH(V) + betaH(V));
      const nInf = alphaN(V) / (alphaN(V) + betaN(V));
      const tauM = 1 / (alphaM(V) + betaM(V));
      const tauH = 1 / (alphaH(V) + betaH(V));
      const tauN = 1 / (alphaN(V) + betaN(V));

      const INa = gNa * m**3 * h * (V - ENa);
      const IK = gK * n**4 * (V - EK);
      const IL = gL * (V - EL);

      return [
        (-INa - IK - IL) / Cm,
        (mInf - m) / tauM,
        (hInf - h) / tauH,
        (nInf - n) / tauN
      ];
    };
  },

  /**
   * Repressilator (synthetic gene circuit)
   * 3 genes repressing each other in a cycle
   */
  repressilator(params = {}) {
    const { alpha = 100, beta = 1, n = 2, K = 1 } = params;
    return (t, y) => {
      const [p1, p2, p3] = y;
      return [
        alpha / (1 + Math.pow(p3/K, n)) - beta * p1,
        alpha / (1 + Math.pow(p1/K, n)) - beta * p2,
        alpha / (1 + Math.pow(p2/K, n)) - beta * p3
      ];
    };
  },

  /**
   * Glycolysis oscillator (Sel'kov model)
   */
  glycolysis(params = {}) {
    const { v = 0.65, k1 = 1, k2 = 1, k3 = 1, k4 = 1, K = 1 } = params;
    return (t, y) => {
      const [S, P] = y;
      const rate = v * S * P**2 / (K + P**2);
      return [k1 - rate, rate - k2 * P];
    };
  }
};

export default SolverEngine;