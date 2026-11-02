/**
 * BioSim Lab · Real-Time Execution Engine
 * ---------------------------------------------------------------------------
 * Low-latency simulation loop with live parameter updates, Web Worker offload,
 * state snapshots, and performance telemetry.
 */

export class RealTimeEngine {
  constructor(options = {}) {
    this.targetFPS = options.targetFPS || 20; // 50ms frame budget
    this.frameBudget = 1000 / this.targetFPS;
    this.simulationSpeed = options.simulationSpeed || 1.0;
    this.maxSubSteps = options.maxSubSteps || 10;

    this.state = null;
    this.parameters = {};
    this.callbacks = {
      onStep: null,
      onFrame: null,
      onParameterChange: null,
      onError: null
    };

    this.worker = null;
    this.useWorker = options.useWorker !== false;
    this.workerPool = null;

    this.running = false;
    this.paused = false;
    this.lastFrameTime = 0;
    this.accumulator = 0;
    this.frameCount = 0;
    this.fps = 0;
    this.lastFPSUpdate = 0;

    // Telemetry
    this.telemetry = {
      frameTimes: [],
      solverTimes: [],
      renderTimes: [],
      workerTimes: [],
      maxFrameTime: 0,
      avgFrameTime: 0,
      solverConvergence: 1.0
    };

    // State history for undo/redo and validation
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = options.maxHistory || 100;

    // Parameter change queue (for live updates)
    this.pendingParams = null;
    this.paramChangeCallbacks = new Map();
  }

  /**
   * Initialize with a solver function and initial state
   */
  async init(solverFn, initialState, initialParams = {}) {
    this.solverFn = solverFn;
    this.state = initialState;
    this.parameters = { ...initialParams };

    if (this.useWorker && typeof Worker !== 'undefined') {
      await this._initWorker();
    }

    // Save initial state
    this._pushHistory();
    return this;
  }

  async _initWorker() {
    // Create worker from blob for inline worker code
    const workerCode = `
      ${SolverWorker.toString()}
      const worker = new SolverWorker();
      self.onmessage = (e) => worker.handleMessage(e);
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));

    return new Promise((resolve) => {
      this.worker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          this.worker.postMessage({
            type: 'init',
            solverCode: this.solverFn.toString(),
            initialState: this.state,
            parameters: this.parameters
          });
          resolve();
        }
      };
    });
  }

  /**
   * Register callbacks
   */
  on(event, callback) {
    if (this.callbacks.hasOwnProperty(event)) {
      this.callbacks[event] = callback;
    }
    return this;
  }

  /**
   * Start the simulation loop
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastFrameTime = performance.now();
    this._loop();
  }

  /**
   * Pause simulation (keeps state)
   */
  pause() {
    this.paused = true;
  }

  /**
   * Resume simulation
   */
  resume() {
    if (!this.running) this.start();
    this.paused = false;
    this.lastFrameTime = performance.now();
  }

  /**
   * Stop simulation completely
   */
  stop() {
    this.running = false;
    this.paused = false;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Update a parameter live (queued for next step)
   */
  setParameter(name, value) {
    this.pendingParams = this.pendingParams || {};
    this.pendingParams[name] = value;

    if (this.callbacks.onParameterChange) {
      this.callbacks.onParameterChange(name, value, this.parameters[name]);
    }
  }

  /**
   * Update multiple parameters
   */
  setParameters(params) {
    Object.entries(params).forEach(([name, value]) => this.setParameter(name, value));
  }

  /**
   * Get current parameter value
   */
  getParameter(name) {
    return this.pendingParams?.[name] ?? this.parameters[name];
  }

  /**
   * Get all parameters
   */
  getAllParameters() {
    return { ...this.parameters, ...this.pendingParams };
  }

  /**
   * Main simulation loop
   */
  _loop() {
    if (!this.running) return;

    const now = performance.now();
    const frameTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (this.paused) {
      requestAnimationFrame(() => this._loop());
      return;
    }

    // Apply pending parameter changes
    if (this.pendingParams) {
      this.parameters = { ...this.parameters, ...this.pendingParams };
      this.pendingParams = null;
      this._pushHistory();
    }

    // Fixed timestep simulation with interpolation
    this.accumulator += frameTime * this.simulationSpeed;
    const dt = this.frameBudget;
    let subSteps = 0;

    const solverStart = performance.now();

    while (this.accumulator >= dt && subSteps < this.maxSubSteps) {
      this._step(dt);
      this.accumulator -= dt;
      subSteps++;
    }

    const solverTime = performance.now() - solverStart;

    // Interpolation factor for smooth rendering
    const alpha = this.accumulator / dt;

    // Render frame
    const renderStart = performance.now();
    if (this.callbacks.onFrame) {
      this.callbacks.onFrame(this.state, alpha, this.parameters);
    }
    const renderTime = performance.now() - renderStart;

    // Telemetry
    this._updateTelemetry(frameTime, solverTime, renderTime);

    // FPS calculation
    this.frameCount++;
    if (now - this.lastFPSUpdate >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFPSUpdate = now;
    }

    requestAnimationFrame(() => this._loop());
  }

  /**
   * Single simulation step
   */
  _step(dt) {
    try {
      const prevState = this.state;
      this.state = this.solverFn(this.state, this.parameters, dt);

      if (this.callbacks.onStep) {
        this.callbacks.onStep(this.state, prevState, dt, this.parameters);
      }
    } catch (error) {
      if (this.callbacks.onError) {
        this.callbacks.onError(error, this.state, this.parameters);
      }
      console.error('Simulation step error:', error);
      this.pause();
    }
  }

  /**
   * Step simulation manually (for worker-based or manual control)
   */
  step(dt = this.frameBudget) {
    this._step(dt);
    this._pushHistory();
  }

  /**
   * Run simulation in worker (for heavy computations)
   */
  async runInWorker(steps, dt) {
    if (!this.worker) return null;

    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (e) => {
        if (e.data.id === id && e.data.type === 'result') {
          this.worker.removeEventListener('message', handler);
          this.state = e.data.state;
          this._pushHistory();
          resolve(e.data);
        }
      };
      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ id, type: 'step', steps, dt, parameters: this.parameters });
    });
  }

  /**
   * Save checkpoint
   */
  checkpoint(label = 'checkpoint') {
    return {
      label,
      timestamp: Date.now(),
      state: this._deepClone(this.state),
      parameters: { ...this.parameters },
      telemetry: { ...this.telemetry }
    };
  }

  /**
   * Restore checkpoint
   */
  restore(checkpoint) {
    this.state = this._deepClone(checkpoint.state);
    this.parameters = { ...checkpoint.parameters };
    this.telemetry = { ...checkpoint.telemetry };
    this._pushHistory();
  }

  /**
   * Undo last parameter change
   */
  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const snapshot = this.history[this.historyIndex];
      this.state = this._deepClone(snapshot.state);
      this.parameters = { ...snapshot.parameters };
      return true;
    }
    return false;
  }

  /**
   * Redo
   */
  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const snapshot = this.history[this.historyIndex];
      this.state = this._deepClone(snapshot.state);
      this.parameters = { ...snapshot.parameters };
      return true;
    }
    return false;
  }

  /**
   * Get telemetry data
   */
  getTelemetry() {
    return {
      ...this.telemetry,
      fps: this.fps,
      running: this.running,
      paused: this.paused,
      simulationSpeed: this.simulationSpeed,
      historyLength: this.history.length,
      historyIndex: this.historyIndex
    };
  }

  /**
   * Set simulation speed multiplier
   */
  setSpeed(speed) {
    this.simulationSpeed = Math.max(0.01, Math.min(100, speed));
  }

  _pushHistory() {
    // Trim future history if we're not at the end
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    this.history.push({
      state: this._deepClone(this.state),
      parameters: { ...this.parameters },
      timestamp: Date.now()
    });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.historyIndex = this.history.length - 1;
    }
  }

  _updateTelemetry(frameTime, solverTime, renderTime) {
    this.telemetry.frameTimes.push(frameTime);
    this.telemetry.solverTimes.push(solverTime);
    this.telemetry.renderTimes.push(renderTime);

    // Keep only last 100 frames
    const maxSamples = 100;
    if (this.telemetry.frameTimes.length > maxSamples) {
      this.telemetry.frameTimes.shift();
      this.telemetry.solverTimes.shift();
      this.telemetry.renderTimes.shift();
    }

    this.telemetry.maxFrameTime = Math.max(this.telemetry.maxFrameTime, frameTime);
    this.telemetry.avgFrameTime =
      this.telemetry.frameTimes.reduce((a, b) => a + b, 0) / this.telemetry.frameTimes.length;

    // Solver convergence (inverse of solver time relative to budget)
    this.telemetry.solverConvergence = Math.min(1, this.frameBudget / (solverTime + 1));
  }

  _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(v => this._deepClone(v));
    if (obj instanceof Float32Array || obj instanceof Float64Array) return new obj.constructor(obj);
    const cloned = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = this._deepClone(obj[key]);
      }
    }
    return cloned;
  }
}

/**
 * Inline Web Worker for offloading simulation
 */
class SolverWorker {
  constructor() {
    this.solverFn = null;
    this.state = null;
    this.parameters = {};
    this.stepCount = 0;
    self.postMessage({ type: 'ready' });
  }

  handleMessage(e) {
    const { type, id } = e.data;

    switch (type) {
      case 'init':
        this.solverFn = new Function('return ' + e.data.solverCode)();
        this.state = e.data.initialState;
        this.parameters = e.data.parameters;
        break;

      case 'step':
        if (e.data.parameters) this.parameters = e.data.parameters;
        const dt = e.data.dt || 0.05;
        const steps = e.data.steps || 1;

        const startTime = performance.now();
        for (let i = 0; i < steps; i++) {
          this.state = this.solverFn(this.state, this.parameters, dt);
          this.stepCount++;
        }
        const workerTime = performance.now() - startTime;

        self.postMessage({
          id,
          type: 'result',
          state: this.state,
          stepCount: this.stepCount,
          workerTime
        });
        break;

      case 'getState':
        self.postMessage({ id, type: 'state', state: this.state });
        break;

      case 'setParams':
        this.parameters = { ...this.parameters, ...e.data.params };
        break;
    }
  }
}

/**
 * Worker Pool for parallel simulations
 */
export class WorkerPool {
  constructor(size = navigator.hardwareConcurrency || 4) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.active = 0;
    this._initWorkers();
  }

  _initWorkers() {
    for (let i = 0; i < this.size; i++) {
      const worker = this._createWorker();
      this.workers.push({ worker, busy: false });
    }
  }

  _createWorker() {
    const workerCode = `
      self.onmessage = function(e) {
        const { type, solverCode, initialState, parameters, dt, steps, id } = e.data;
        if (type === 'init') {
          self.solverFn = new Function('return ' + solverCode)();
          self.state = initialState;
          self.parameters = parameters;
          self.postMessage({ type: 'ready', id });
        } else if (type === 'run') {
          if (e.data.parameters) self.parameters = e.data.parameters;
          const start = performance.now();
          for (let i = 0; i < steps; i++) {
            self.state = self.solverFn(self.state, self.parameters, dt);
          }
          self.postMessage({
            type: 'result',
            id,
            state: self.state,
            time: performance.now() - start
          });
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  /**
   * Run simulation on available worker
   */
  run(solverFn, initialState, parameters, dt, steps) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);

      const available = this.workers.find(w => !w.busy);
      if (available) {
        this._runOnWorker(available.worker, id, solverFn, initialState, parameters, dt, steps, resolve);
      } else {
        this.queue.push({ id, solverFn, initialState, parameters, dt, steps, resolve, reject });
      }
    });
  }

  _runOnWorker(worker, id, solverFn, initialState, parameters, dt, steps, resolve) {
    const w = this.workers.find(w => w.worker === worker);
    w.busy = true;
    this.active++;

    const handler = (e) => {
      if (e.data.id === id && e.data.type === 'result') {
        worker.removeEventListener('message', handler);
        w.busy = false;
        this.active--;
        resolve(e.data);
        this._processQueue();
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({
      id,
      type: 'init',
      solverCode: solverFn.toString(),
      initialState,
      parameters,
      dt,
      steps
    });
  }

  _processQueue() {
    if (this.queue.length === 0) return;
    const available = this.workers.find(w => !w.busy);
    if (!available) return;

    const task = this.queue.shift();
    this._runOnWorker(available.worker, task.id, task.solverFn, task.initialState,
      task.parameters, task.dt, task.steps, task.resolve);
  }

  terminate() {
    this.workers.forEach(w => w.worker.terminate());
    this.workers = [];
    this.queue = [];
  }
}

export default RealTimeEngine;