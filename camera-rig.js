/**
 * BioSim Lab · engine3d/camera-rig.js
 * ---------------------------------------------------------------------------
 * One camera, one orbit controller, five named views and a smooth fly-to.
 *
 * The rig never owns the renderer: it only moves the PerspectiveCamera and
 * reports whether the view changed this frame. That keeps render-on-demand
 * honest and makes the camera trivially reusable by the experiment engine.
 *
 * Reduced motion is honoured everywhere: fly-to becomes an instant cut, orbit
 * damping is disabled, and no transition exceeds one frame.
 */

import { Box3, MathUtils, Sphere, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * Default views for the Phase 3D-1 bench. Every value is metres.
 * `position` is where the camera sits; `target` is what it looks at.
 */
export const DEFAULT_PRESETS = Object.freeze({
  overview: {
    label: "Overview",
    hint: "The whole bench",
    position: [1.5, 1.3, 2.05],
    target: [0, 0.25, -0.04],
  },
  closeup: {
    label: "Close-up",
    hint: "Glassware at eye level",
    position: [0.05, 0.5, 1.02],
    target: [-0.3, 0.12, 0.08],
  },
  top: {
    label: "Top",
    hint: "Plan view of the bench",
    position: [0.02, 2.2, 0.4],
    target: [0, 0.08, -0.02],
  },
  instrument: {
    label: "Instrument",
    hint: "The microcentrifuge",
    position: [0.65, 0.38, 0.82],
    target: [0.26, 0.12, 0.06],
  },
  shelf: {
    label: "Shelf",
    hint: "Stock bottles and light bar",
    position: [0.2, 0.92, 0.68],
    target: [0, 0.63, -0.6],
  },
});

const FLIGHT_DURATION = 0.8;

const clamp = MathUtils.clamp;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function poseFrom(value) {
  if (!value) return null;
  const position = Array.isArray(value.position) ? new Vector3().fromArray(value.position) : value.position?.clone?.();
  const target = Array.isArray(value.target) ? new Vector3().fromArray(value.target) : value.target?.clone?.();
  if (!position || !target) return null;
  return { position, target };
}

/**
 * @param {PerspectiveCamera} camera
 * @param {HTMLElement} domElement
 * @param {{reducedMotion?: boolean, presets?: object, onChange?: Function,
 *          minDistance?: number, maxDistance?: number, fov?: number}} options
 */
export class CameraRig {
  constructor(camera, domElement, options = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.onChange = typeof options.onChange === "function" ? options.onChange : null;
    this.presets = { ...DEFAULT_PRESETS };
    this.setPresets(options.presets);

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.64;
    this.controls.zoomSpeed = 0.72;
    this.controls.panSpeed = 0.6;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = options.minDistance ?? 0.42;
    this.controls.maxDistance = options.maxDistance ?? 7.4;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.45;
    this.controls.target.set(0, 0.25, -0.04);

    this.flight = null;
    this._preset = "overview";
    this._disposed = false;

    this._handleChange = () => {
      this.onChange?.();
    };
    this._interrupt = () => this.cancelFlight({ restoreControls: true });
    this.controls.addEventListener("change", this._handleChange);
    this.domElement.addEventListener("pointerdown", this._interrupt, { passive: true });
    this.domElement.addEventListener("wheel", this._interrupt, { passive: true });

    this.applyPreset("overview", { immediate: true });
  }

  /** Merge custom preset definitions; used by Bench3D config and later sims. */
  setPresets(presets) {
    if (!presets || typeof presets !== "object") return;
    for (const [id, value] of Object.entries(presets)) {
      const pose = poseFrom(value);
      if (!pose) continue;
      this.presets[id] = {
        ...(DEFAULT_PRESETS[id] ?? {}),
        ...value,
        position: pose.position,
        target: pose.target,
      };
    }
  }

  get presetIds() {
    return Object.keys(this.presets);
  }

  get activePreset() {
    return this._preset;
  }

  getPose() {
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
  }

  /**
   * Start a smooth move.
   * @param {string|{position: Array<number>|Vector3, target: Array<number>|Vector3}} name
   * @param {{immediate?: boolean, duration?: number}} options
   */
  goTo(name, { immediate = false, duration = FLIGHT_DURATION } = {}) {
    const preset = typeof name === "string" && this.presets[name] ? this.presets[name] : null;
    const pose = poseFrom(preset ?? name);
    if (!pose) return false;

    this._preset = typeof name === "string" && preset ? name : null;
    const instant = immediate || this.reducedMotion || duration <= 0;
    if (instant) {
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.controls.update();
      this.flight = null;
      this.controls.enabled = true;
      this.onChange?.();
      return true;
    }

    this.flight = {
      elapsed: 0,
      duration,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: pose.position,
      toTarget: pose.target,
    };
    this.controls.enabled = false;
    this.onChange?.();
    return true;
  }

  applyPreset(name, options = {}) {
    return this.goTo(name, options);
  }

  /** Cancel a flight without moving the camera any further. */
  cancelFlight({ restoreControls = true } = {}) {
    if (!this.flight) {
      if (restoreControls) this.controls.enabled = true;
      return;
    }
    this.flight = null;
    this.controls.enabled = restoreControls;
  }

  /**
   * Frame a single object. Used by label clicks and by future experiment focus
   * calls.
   * @param {import("three").Object3D} object
   * @param {{label?: string, duration?: number, immediate?: boolean}} options
   */
  focusObject(object, { duration = 0.7, immediate = false } = {}) {
    if (!object) return false;
    const box = new Box3().setFromObject(object);
    if (box.isEmpty()) return false;
    const sphere = box.getBoundingSphere(new Sphere());
    const radius = Math.max(0.035, sphere.radius);
    const fov = MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.4, this.camera.aspect || 1);
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const fitVertical = radius / Math.sin(fov / 2);
    const fitHorizontal = radius / Math.sin(horizontalFov / 2);
    const distance = clamp(Math.max(fitVertical, fitHorizontal) * 1.35, 0.5, 2.6);

    const direction = new Vector3(0.56, 0.46, 1).normalize();
    const position = sphere.center.clone().addScaledVector(direction, distance);
    position.y = Math.max(position.y, sphere.center.y + radius * 0.45, 0.22);
    return this.goTo({ position, target: sphere.center }, { duration, immediate });
  }

  /** Gentle clamp so panning cannot lose the bench. */
  _clampTarget() {
    const target = this.controls.target;
    target.x = clamp(target.x, -1.9, 1.9);
    target.y = clamp(target.y, -0.12, 1.5);
    target.z = clamp(target.z, -1.1, 0.9);
  }

  /** Advance camera motion; returns true when a frame is needed. */
  update(delta = 1 / 60) {
    if (this._disposed) return false;
    let active = false;
    if (this.flight) {
      const flight = this.flight;
      flight.elapsed = Math.min(flight.duration, flight.elapsed + Math.max(0, delta));
      const t = easeInOutCubic(flight.elapsed / flight.duration);
      this.camera.position.lerpVectors(flight.fromPosition, flight.toPosition, t);
      this.controls.target.lerpVectors(flight.fromTarget, flight.toTarget, t);
      this.camera.lookAt(this.controls.target);
      active = true;
      if (flight.elapsed >= flight.duration) {
        this.camera.position.copy(flight.toPosition);
        this.controls.target.copy(flight.toTarget);
        this.flight = null;
        this.controls.enabled = true;
        this.controls.update();
        active = true;
      }
    } else {
      active = this.controls.update();
    }
    this._clampTarget();
    return active;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.cancelFlight({ restoreControls: false });
    this.domElement.removeEventListener("pointerdown", this._interrupt);
    this.domElement.removeEventListener("wheel", this._interrupt);
    this.controls.removeEventListener("change", this._handleChange);
    this.controls.dispose();
    this.onChange = null;
  }
}

export default CameraRig;
