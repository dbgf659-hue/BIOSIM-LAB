/**
 * BioSim Lab · engine3d/scene.js
 * ---------------------------------------------------------------------------
 * The renderer, camera, lights and post-processing for one 3D bench.
 *
 * This module knows nothing about experiments. It owns a Scene, a
 * PerspectiveCamera, a CameraRig and the render loop; Bench3D adds objects.
 *
 * Design notes
 *   • One WebGL context per bench, destroyed with the bench.
 *   • Render-on-demand by default: idle benches cost no GPU. Camera motion,
 *     resize, object changes and explicit invalidate() request a frame.
 *   • Low tier caps the frame rate and drops shadows, bloom and environment
 *     reflections; Medium keeps shadows; High adds bloom and transmission.
 *   • Every listener, render target and environment texture is released in
 *     dispose(), which is what makes repeated mount/destroy leak-free.
 */

import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CameraRig } from "./camera-rig.js";

const BACKGROUND = 0x04090a;

function pixelRatioFor(quality) {
  const device = typeof window !== "undefined" ? Number(window.devicePixelRatio) || 1 : 1;
  return Math.min(device, quality?.pixelRatio ?? 1.5);
}

/**
 * @param {{
 *   container: HTMLElement,
 *   quality: object,
 *   reducedMotion?: boolean,
 *   cameraPresets?: object,
 *   initialPreset?: string,
 *   renderOnDemand?: boolean,
 *   onAfterRender?: Function,
 *   onResize?: Function,
 *   onStats?: Function,
 * }} options
 */
export class BenchScene {
  constructor(options) {
    const {
      container,
      quality,
      reducedMotion = false,
      cameraPresets,
      initialPreset = "overview",
      renderOnDemand = true,
    } = options;

    this.container = container;
    this.quality = quality;
    this.reducedMotion = reducedMotion;
    this.renderOnDemand = renderOnDemand;
    this.onAfterRender = options.onAfterRender ?? null;
    this.onResize = options.onResize ?? null;
    this.onStats = options.onStats ?? null;

    this.scene = new Scene();
    this.scene.name = "biosim-bench";
    this.scene.background = new Color(BACKGROUND);
    this.scene.fog = new FogExp2(BACKGROUND, 0.034);

    this.renderer = new WebGLRenderer({
      antialias: Boolean(quality.antialias),
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(pixelRatioFor(quality));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = Number(quality.exposure ?? 1);
    this.renderer.shadowMap.enabled = Boolean(quality.shadows);
    this.renderer.shadowMap.type = quality.shadowType;
    this.renderer.setClearColor(BACKGROUND, 1);
    this.renderer.domElement.className = "b3d-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.tabIndex = -1;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(38, 1, 0.03, 60);
    this.camera.position.set(1.5, 1.3, 2.05);

    this.rig = new CameraRig(this.camera, this.renderer.domElement, {
      reducedMotion,
      presets: cameraPresets,
      onChange: () => this.invalidate(),
    });

    this._buildLights();
    this._buildEnvironment();

    this.composer = null;
    this.bloomPass = null;
    this.outputPass = null;
    if (quality.bloom) this._buildComposer();

    this._disposed = false;
    this._dirty = true;
    this._paused = false;
    this._frames = 0;
    this._statsAt = 0;
    this._lastRenderAt = 0;
    this._lastFrame = performance.now();
    this._raf = 0;

    this._handleVisibility = () => {
      if (document.hidden) return;
      this._lastFrame = performance.now();
      this._dirty = true;
    };
    document.addEventListener("visibilitychange", this._handleVisibility);

    this._resizeObserver = new ResizeObserver(() => this._queueResize());
    this._resizeObserver.observe(this.container);
    this._resizeRaf = 0;
    this.resize();

    this.rig.goTo(initialPreset, { immediate: true });
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  _buildLights() {
    const quality = this.quality;

    this.hemisphere = new HemisphereLight(0xd8fff7, 0x04100f, 0.4);
    this.hemisphere.name = "hemisphere";
    this.scene.add(this.hemisphere);

    this.keyLight = new DirectionalLight(0xfff2dc, 2.35);
    this.keyLight.name = "key-light";
    this.keyLight.position.set(2.7, 4.4, 3.2);
    this.keyLight.target.position.set(0, 0.1, 0);
    this.keyLight.castShadow = Boolean(quality.shadows);
    if (quality.shadows) {
      const shadow = this.keyLight.shadow;
      shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      shadow.camera.left = -2.4;
      shadow.camera.right = 2.4;
      shadow.camera.top = 2.4;
      shadow.camera.bottom = -2.4;
      shadow.camera.near = 0.5;
      shadow.camera.far = 12;
      shadow.bias = -0.00025;
      shadow.normalBias = 0.028;
      shadow.radius = 2.5;
    }
    this.scene.add(this.keyLight, this.keyLight.target);

    this.fillLight = new DirectionalLight(0x8fe2dc, 0.58);
    this.fillLight.name = "fill-light";
    this.fillLight.position.set(-3.1, 2.3, 1.8);
    this.scene.add(this.fillLight);

    this.rimLight = new PointLight(0x2ee6c5, 2.6, 4.5, 2);
    this.rimLight.name = "teal-rim";
    this.rimLight.position.set(-1.8, 1.1, -0.15);
    this.scene.add(this.rimLight);

    this.warmLight = new PointLight(0xffc76b, 2.4, 4, 2);
    this.warmLight.name = "warm-rim";
    this.warmLight.position.set(1.55, 1.25, -0.2);
    this.scene.add(this.warmLight);

    this.shelfLight = new PointLight(0xeafffa, 2.4, 2.2, 2);
    this.shelfLight.name = "shelf-light";
    this.shelfLight.position.set(0, 0.7, -0.58);
    this.scene.add(this.shelfLight);

    // Low warm bounce reveals the cabinet doors instead of leaving the bench
    // floating on a black rectangle.
    this.counterLight = new PointLight(0xffd7a1, 1.6, 2.4, 2);
    this.counterLight.name = "counter-light";
    this.counterLight.position.set(0, -0.18, 1.05);
    this.scene.add(this.counterLight);
  }

  _buildEnvironment() {
    if (!this.quality.environment) return;
    const pmrem = new PMREMGenerator(this.renderer);
    let room = null;
    try {
      room = new RoomEnvironment();
      this.environmentTarget = pmrem.fromScene(room, 0.045);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.environmentIntensity = this.quality.environmentIntensity;
    } catch (error) {
      console.warn("[Bench3D] environment map unavailable", error);
      this.environmentTarget = null;
    } finally {
      room?.dispose?.();
      pmrem.dispose();
    }
  }

  _buildComposer() {
    const quality = this.quality;
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.addPass(new RenderPass(this.scene, this.camera));

    const size = this.container.getBoundingClientRect();
    this.bloomPass = new UnrealBloomPass(
      new Vector2(Math.max(1, size.width), Math.max(1, size.height)),
      quality.bloomStrength,
      quality.bloomRadius,
      quality.bloomThreshold,
    );
    this.bloomPass.name = "bench-bloom";
    composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    composer.addPass(this.outputPass);
    this.composer = composer;
  }

  /* ------------------------------------------------------------------ size */
  _queueResize() {
    if (this._resizeRaf || this._disposed) return;
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0;
      this.resize();
    });
  }

  resize() {
    if (this._disposed) return;
    const width = Math.max(1, Math.round(this.container.clientWidth || this.container.offsetWidth || 1));
    const height = Math.max(1, Math.round(this.container.clientHeight || this.container.offsetHeight || 1));
    const ratio = pixelRatioFor(this.quality);

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    if (this.composer) {
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(width, height);
    }

    this.width = width;
    this.height = height;
    this._dirty = true;
    this.onResize?.({ width, height, aspect: this.camera.aspect, pixelRatio: ratio });
    return { width, height, pixelRatio: ratio };
  }

  /* ------------------------------------------------------------------ loop */
  invalidate() {
    this._dirty = true;
  }

  /** Future experiments can hold a frame while a liquid drains, etc. */
  setPaused(paused) {
    this._paused = Boolean(paused);
    if (!this._paused) this._dirty = true;
  }

  _tick(now) {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(this._tick);
    if (this._paused || document.hidden) {
      this._lastFrame = now;
      return;
    }

    // Cap the step so a tab returning from the background does not jump the
    // camera, but keep it generous enough that a slow 10–20 fps device still
    // finishes a fly-to in roughly wall-clock time.
    const delta = Math.min(0.2, Math.max(0.001, (now - this._lastFrame) / 1000));
    this._lastFrame = now;

    const cameraActive = this.rig.update(delta);
    const maxFps = Number(this.quality.maxFps) || 0;
    if (maxFps > 0 && now - this._lastRenderAt < 1000 / maxFps - 1) return;

    const shouldRender = !this.renderOnDemand || this._dirty || cameraActive;
    if (!shouldRender) {
      this._reportStats(now);
      return;
    }

    this._dirty = false;
    this._lastRenderAt = now;
    if (this.composer) this.composer.render(delta);
    else this.renderer.render(this.scene, this.camera);
    this._frames += 1;
    this.onAfterRender?.(this);
    this._reportStats(now);
  }

  _reportStats(now) {
    if (!this._statsAt) this._statsAt = now;
    const elapsed = now - this._statsAt;
    if (elapsed < 500) return;
    const fps = Math.round((this._frames * 1000) / elapsed);
    this._frames = 0;
    this._statsAt = now;
    const info = this.renderer.info;
    this.onStats?.({
      fps,
      idle: fps === 0,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
      width: this.width,
      height: this.height,
      tier: this.quality.tier,
    });
  }

  /** Debug snapshot for the overlay's `~` panel. */
  getStats() {
    const info = this.renderer.info;
    return {
      tier: this.quality.tier,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
      width: this.width,
      height: this.height,
      fps: this._frames,
      camera: this.camera.position.toArray().map((value) => Number(value.toFixed(3))),
      target: this.rig.controls.target.toArray().map((value) => Number(value.toFixed(3))),
      shadow: Boolean(this.quality.shadows),
      bloom: Boolean(this.composer),
      environment: Boolean(this.scene.environment),
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._resizeRaf);
    document.removeEventListener("visibilitychange", this._handleVisibility);
    this._resizeObserver?.disconnect();
    this.rig.dispose();

    this.bloomPass?.dispose?.();
    this.outputPass?.dispose?.();
    this.composer?.dispose?.();
    this.bloomPass = null;
    this.outputPass = null;
    this.composer = null;

    if (this.scene.environment) {
      this.scene.environment = null;
      this.environmentTarget?.dispose?.();
      this.environmentTarget = null;
    }

    this.scene.fog = null;
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
    this.onAfterRender = null;
    this.onResize = null;
    this.onStats = null;
  }
}

export default BenchScene;
