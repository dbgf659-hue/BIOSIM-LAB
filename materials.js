/**
 * BioSim Lab · engine3d/materials.js
 * ---------------------------------------------------------------------------
 * The shared material library for the 3D bench.
 *
 * Everything is generated, nothing is loaded: glassware uses
 * MeshPhysicalMaterial, labels are CanvasTextures, LCDs are CanvasTextures
 * redrawn on a throttle, and contact shadows are a single radial gradient.
 *
 * One library instance belongs to one BenchScene. dispose() releases every
 * material, texture and live LCD it created, which is what makes repeatedly
 * opening and closing an experiment leak-free.
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
} from "three";

export const PALETTE = Object.freeze({
  teal: 0x2ee6c5,
  tealDeep: 0x0ea88e,
  green: 0x7cf0a7,
  violet: 0xa78bfa,
  pink: 0xf472b6,
  sky: 0x38bdf8,
  amber: 0xfbbf24,
  danger: 0xfb7185,
  success: 0x3ddc97,
  ink: 0x061113,
  benchTop: 0xdcebe7,
  cabinet: 0x0b2426,
  wall: 0x07171a,
  steel: 0xaebcc0,
  darkSteel: 0x38484d,
});

const CSS_COLORS = {
  teal: "#2ee6c5",
  green: "#7cf0a7",
  violet: "#a78bfa",
  pink: "#f472b6",
  sky: "#38bdf8",
  amber: "#fbbf24",
  danger: "#fb7185",
  success: "#3ddc97",
  cream: "#f5e6b8",
  white: "#f8fafc",
  black: "#04100f",
  water: "#8fd7e8",
};

const FONT_MONO = '600 30px "JetBrains Mono", ui-monospace, Consolas, monospace';
const FONT_MONO_SMALL = '500 15px "JetBrains Mono", ui-monospace, Consolas, monospace';
const FONT_SANS = '600 26px "Inter", "Segoe UI", system-ui, sans-serif';
const FONT_SANS_SMALL = '600 15px "Inter", "Segoe UI", system-ui, sans-serif';

/** Accept a hex, an rgb()/named CSS colour, or an engine [r,g,b] triplet. */
export function toColor(input, fallback = 0xffffff) {
  if (input instanceof Color) return input.clone();
  if (Array.isArray(input) && input.length >= 3) {
    const [r, g, b] = input;
    return new Color().setRGB(
      Math.min(255, Math.max(0, Number(r))) / 255,
      Math.min(255, Math.max(0, Number(g))) / 255,
      Math.min(255, Math.max(0, Number(b))) / 255,
      SRGBColorSpace,
    );
  }
  if (typeof input === "number" && Number.isFinite(input)) return new Color(input);
  if (typeof input === "string") {
    const key = input.trim().toLowerCase();
    if (CSS_COLORS[key]) return new Color(CSS_COLORS[key]);
    try {
      const value = key.startsWith("#") || key.startsWith("rgb") ? key : `#${key}`;
      return new Color(value);
    } catch {
      return new Color(fallback);
    }
  }
  return new Color(fallback);
}

/** CSS colour string for DOM labels that must match the 3D material. */
export function colorToCss(input, fallback = "#2ee6c5") {
  try {
    return `#${toColor(input, fallback).getHexString()}`;
  } catch {
    return fallback;
  }
}

function makeCanvas(width, height) {
  if (typeof document === "undefined") throw new Error("Canvas textures require a browser document");
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function roundedPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawGrid(ctx, width, height, color = "rgba(46,230,197,0.06)") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 16) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += 16) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

/* ==========================================================================
   LCD screen — a live CanvasTexture with a deliberate 10 fps cap
   ========================================================================== */
export class LCDScreen {
  /**
   * @param {{width?: number, height?: number, maxFps?: number}} options
   */
  constructor({ width = 256, height = 128, maxFps = 12 } = {}) {
    this.canvas = makeCanvas(width, height);
    this.ctx = this.canvas.getContext("2d");
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.minInterval = 1000 / Math.max(1, maxFps);
    this._lastPaint = -Infinity;
    this._queued = null;
    this.disposed = false;

    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;

    this.material = new MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
      transparent: false,
    });
    this.material.name = "lcd";
    this.material.userData.biosimLibrary = true;

    this.render({ title: "STANDBY", value: "—", accent: "#2ee6c5", status: "off" }, { force: true });
  }

  /** Paint a new model, coalescing bursts to `maxFps`. */
  render(model, { force = false } = {}) {
    if (this.disposed) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    this._queued = model;
    if (!force && now - this._lastPaint < this.minInterval) return;
    this._lastPaint = now;
    this._draw(this._queued ?? model);
    this.texture.needsUpdate = true;
  }

  _draw(model = {}) {
    const ctx = this.ctx;
    const { width: w, height: h } = this;
    const accent = model.accent ?? "#2ee6c5";
    const statusColor =
      model.status === "bad" ? "#fb7185" : model.status === "warn" ? "#fbbf24" : model.status === "off" ? "#4b6867" : "#3ddc97";

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#071517");
    bg.addColorStop(1, "#020a0b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // A faint instrument grid keeps the panel from reading as a flat swatch.
    drawGrid(ctx, w, h);

    ctx.strokeStyle = "rgba(46,230,197,0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    // Header
    ctx.fillStyle = "rgba(46,230,197,0.88)";
    ctx.beginPath();
    ctx.arc(18, 20, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = FONT_SANS_SMALL;
    ctx.fillStyle = "rgba(207,241,236,0.72)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(String(model.title ?? "").toUpperCase().slice(0, 24), 30, 21);
    ctx.textAlign = "right";
    ctx.fillStyle = statusColor;
    ctx.fillText(String(model.statusLabel ?? (model.running ? "RUN" : "READY")).toUpperCase(), w - 14, 21);

    // Main value
    const value = model.value === undefined || model.value === null ? "—" : String(model.value);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = model.compact ? '600 24px "JetBrains Mono", ui-monospace, Consolas, monospace' : FONT_MONO;
    ctx.fillStyle = accent;
    ctx.fillText(value, 16, h * 0.62);
    if (model.unit) {
      const measured = ctx.measureText(value).width;
      ctx.font = FONT_SANS_SMALL;
      ctx.fillStyle = "rgba(207,241,236,0.62)";
      ctx.fillText(String(model.unit), 20 + measured, h * 0.62);
    }

    // Secondary lines
    const lines = Array.isArray(model.lines) ? model.lines.slice(0, 2) : [];
    ctx.font = FONT_MONO_SMALL;
    ctx.fillStyle = "rgba(207,241,236,0.58)";
    lines.forEach((line, index) => {
      ctx.fillText(String(line).slice(0, 30), 16, h - 30 + index * 17);
    });

    // Progress rail
    if (Number.isFinite(model.progress)) {
      const progress = Math.min(1, Math.max(0, model.progress));
      const railY = h - 10;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(16, railY, w - 32, 3);
      ctx.fillStyle = accent;
      ctx.fillRect(16, railY, (w - 32) * progress, 3);
    }

    // Scanline shimmer, very subtle.
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.texture.dispose();
    this.material.dispose();
    this.canvas.width = 1;
    this.canvas.height = 1;
    this._queued = null;
  }
}

/* ==========================================================================
   MaterialLibrary
   ========================================================================== */
export class MaterialLibrary {
  /**
   * @param {{quality: object, renderer?: object}} options
   */
  constructor({ quality, renderer = null }) {
    this.quality = quality;
    this.renderer = renderer;
    this.cache = new Map();
    this.textures = new Set();
    this.lcds = new Set();
    this.maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
    this._shadowMaterial = null;
    this._disposed = false;
  }

  _cached(key, make) {
    if (this.cache.has(key)) return this.cache.get(key);
    const material = make();
    material.name = key;
    material.userData = { ...(material.userData ?? {}), biosimLibrary: true };
    this.cache.set(key, material);
    return material;
  }

  _trackTexture(texture) {
    texture.userData = { ...(texture.userData ?? {}), biosimLibrary: true };
    this.textures.add(texture);
    return texture;
  }

  /* ---------------------------------------------------------------- glass */
  /**
   * @param {{color?: *, transmission?: number, opacity?: number, thickness?: number,
   *          amber?: boolean, roughness?: number}} options
   */
  glass({ color = 0xeafcff, transmission = 0.96, opacity = 1, thickness = 0.22, roughness = 0.055, amber = false } = {}) {
    const tint = toColor(color);
    const key = `glass:${tint.getHexString()}:${transmission}:${opacity}:${thickness}:${roughness}:${amber}`;
    return this._cached(key, () => {
      if (this.quality.transmission) {
        return new MeshPhysicalMaterial({
          color: tint,
          metalness: 0,
          roughness,
          transmission,
          thickness,
          ior: 1.45,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          envMapIntensity: 1.15,
          transparent: true,
          opacity,
          side: DoubleSide,
          depthWrite: false,
          attenuationColor: amber ? tint : new Color(1, 1, 1),
          attenuationDistance: amber ? 0.24 : 1.4,
        });
      }
      return new MeshPhysicalMaterial({
        color: tint,
        metalness: 0.02,
        roughness: Math.max(0.08, roughness),
        clearcoat: 0.9,
        clearcoatRoughness: 0.1,
        envMapIntensity: this.quality.environment ? 0.8 : 0.3,
        transparent: true,
        opacity: amber ? Math.max(0.46, opacity * 0.72) : Math.max(0.2, opacity * 0.34),
        side: DoubleSide,
        depthWrite: false,
      });
    });
  }

  /** Cloudy polypropylene: translucent, not refractive like glass. */
  plasticTranslucent(color = 0xe9f5f2, { opacity = 0.34 } = {}) {
    const tint = toColor(color);
    const key = `plastic-translucent:${tint.getHexString()}:${opacity}`;
    return this._cached(key, () => {
      return new MeshPhysicalMaterial({
        color: tint,
        metalness: 0,
        roughness: 0.28,
        clearcoat: 0.65,
        clearcoatRoughness: 0.25,
        transparent: true,
        opacity,
        side: DoubleSide,
        depthWrite: false,
        transmission: this.quality.transmission ? 0.28 : 0,
        thickness: 0.02,
      });
    });
  }

  /* --------------------------------------------------------------- solids */
  plastic(color = 0x2ee6c5, { roughness = 0.3, metalness = 0.02, clearcoat = 0.65, opacity = 1 } = {}) {
    const tint = toColor(color);
    const key = `plastic:${tint.getHexString()}:${roughness}:${metalness}:${clearcoat}:${opacity}`;
    return this._cached(key, () => {
      return new MeshPhysicalMaterial({
        color: tint,
        roughness,
        metalness,
        clearcoat,
        clearcoatRoughness: 0.22,
        envMapIntensity: this.quality.environment ? 0.7 : 0.25,
        transparent: opacity < 1,
        opacity,
      });
    });
  }

  metal(color = PALETTE.steel, { roughness = 0.28, brushed = false } = {}) {
    const tint = toColor(color);
    const key = `metal:${tint.getHexString()}:${roughness}:${brushed}`;
    return this._cached(key, () => {
      const material = new MeshStandardMaterial({
        color: tint,
        metalness: 1,
        roughness: brushed ? Math.max(0.32, roughness) : roughness,
        envMapIntensity: this.quality.environment ? 1.25 : 0.45,
      });
      if (brushed && "anisotropy" in material) {
        material.anisotropy = 0.55;
        material.anisotropyRotation = 0.4;
      }
      return material;
    });
  }

  rubber(color = 0x101c1d) {
    const tint = toColor(color);
    return this._cached(`rubber:${tint.getHexString()}`, () => {
      return new MeshStandardMaterial({ color: tint, roughness: 0.92, metalness: 0.02 });
    });
  }

  matte(color = 0xffffff, { roughness = 0.75, opacity = 1 } = {}) {
    const tint = toColor(color);
    return this._cached(`matte:${tint.getHexString()}:${roughness}:${opacity}`, () => {
      return new MeshStandardMaterial({
        color: tint,
        roughness,
        metalness: 0,
        transparent: opacity < 1,
        opacity,
      });
    });
  }

  /* --------------------------------------------------------------- liquids */
  /**
   * @param {*} color engine colour: hex, rgb string or [r,g,b]
   * @param {{opacity?: number, turbidity?: number, glow?: number, transmission?: number}} options
   */
  liquid(color = 0x8fd7e8, { opacity = 0.78, turbidity = 0, glow = 0, transmission = 0.12 } = {}) {
    const tint = toColor(color);
    const key = `liquid:${tint.getHexString()}:${opacity}:${turbidity}:${glow}:${transmission}`;
    return this._cached(key, () => {
      const physical = this.quality.transmission;
      const material = new MeshPhysicalMaterial({
        color: tint,
        roughness: turbidity > 0.45 ? 0.42 : 0.12,
        metalness: 0,
        transmission: physical ? transmission * (1 - Math.min(1, turbidity)) : 0,
        thickness: 0.08,
        ior: 1.33,
        clearcoat: 0.9,
        clearcoatRoughness: 0.1,
        envMapIntensity: this.quality.environment ? 0.9 : 0.3,
        transparent: true,
        opacity: Math.min(1, opacity + turbidity * 0.16),
        side: DoubleSide,
        depthWrite: false,
      });
      if (glow > 0) {
        material.emissive = tint;
        material.emissiveIntensity = glow;
      }
      return material;
    });
  }

  agar(color = 0xd9b36a, { opacity = 0.58, roughness = 0.35, transmission = 0.18 } = {}) {
    const tint = toColor(color);
    const key = `agar:${tint.getHexString()}:${opacity}:${roughness}`;
    return this._cached(key, () => {
      return new MeshPhysicalMaterial({
        color: tint,
        roughness,
        metalness: 0,
        transmission: this.quality.transmission ? transmission : 0,
        thickness: 0.04,
        clearcoat: 0.5,
        clearcoatRoughness: 0.35,
        transparent: true,
        opacity,
        side: DoubleSide,
        depthWrite: false,
      });
    });
  }

  gel(color = 0xbdf5dc, { opacity = 0.5, glow = 0 } = {}) {
    const tint = toColor(color);
    const key = `gel:${tint.getHexString()}:${opacity}:${glow}`;
    return this._cached(key, () => {
      const material = new MeshPhysicalMaterial({
        color: tint,
        roughness: 0.16,
        transmission: this.quality.transmission ? 0.5 : 0,
        thickness: 0.05,
        clearcoat: 0.6,
        transparent: true,
        opacity,
        side: DoubleSide,
        depthWrite: false,
      });
      if (glow > 0) {
        material.emissive = tint;
        material.emissiveIntensity = glow;
      }
      return material;
    });
  }

  /* ------------------------------------------------------------------ glow */
  glow(color = PALETTE.teal, { intensity = 1.8, opacity = 1 } = {}) {
    const tint = toColor(color);
    const key = `glow:${tint.getHexString()}:${intensity}:${opacity}`;
    return this._cached(key, () => {
      return new MeshStandardMaterial({
        color: tint.clone().multiplyScalar(0.4),
        emissive: tint,
        emissiveIntensity: intensity,
        roughness: 0.4,
        metalness: 0,
        transparent: opacity < 1,
        opacity,
        toneMapped: false,
      });
    });
  }

  emissive(color = PALETTE.teal, intensity = 2.2) {
    const tint = toColor(color);
    return this._cached(`emissive:${tint.getHexString()}:${intensity}`, () => {
      return new MeshBasicMaterial({ color: tint.clone().multiplyScalar(intensity), toneMapped: false });
    });
  }

  /* ---------------------------------------------------------------- labels */
  /** @param {CanvasTexture} texture */
  label(texture) {
    return this._cached(`label:${texture?.uuid ?? "none"}`, () => {
      return new MeshBasicMaterial({
        map: texture,
        transparent: true,
        toneMapped: false,
        side: DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    });
  }

  frosted() {
    return this._cached("frosted", () => {
      return new MeshPhysicalMaterial({
        color: 0xf4ffff,
        roughness: 0.62,
        transmission: this.quality.transmission ? 0.32 : 0,
        thickness: 0.01,
        transparent: true,
        opacity: 0.28,
        side: DoubleSide,
        depthWrite: false,
      });
    });
  }

  /* -------------------------------------------------------------- textures */
  /**
   * A procedurally painted bottle/vial label.
   * @param {{title: string, subtitle?: string, footer?: string, accent?: string,
   *          background?: string, foreground?: string, width?: number, height?: number,
   *          barcode?: boolean}} options
   */
  labelTexture({
    title = "",
    subtitle = "",
    footer = "",
    accent = "#0ea88e",
    background = "#eef4ec",
    foreground = "#102a2a",
    width = 512,
    height = 256,
    barcode = false,
  } = {}) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(16,42,42,0.18)";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, width - 6, height - 6);

    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, width, 16);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = foreground;
    ctx.font = '700 42px "Inter", "Segoe UI", system-ui, sans-serif';
    const titleLines = wrapText(ctx, title.toUpperCase(), width - 64, 3);
    titleLines.forEach((line, index) => ctx.fillText(line, 32, 44 + index * 44));

    if (subtitle) {
      ctx.fillStyle = "rgba(16,42,42,0.68)";
      ctx.font = FONT_SANS_SMALL;
      ctx.fillText(subtitle.slice(0, 42), 32, 44 + titleLines.length * 44 + 10);
    }

    if (barcode) {
      const baseY = height - 52;
      ctx.fillStyle = "rgba(16,42,42,0.82)";
      let x = 32;
      for (let i = 0; i < 26; i++) {
        const w = 2 + ((i * 7) % 5);
        ctx.fillRect(x, baseY, w, 26);
        x += w + 4;
      }
    }

    if (footer) {
      ctx.fillStyle = "rgba(16,42,42,0.5)";
      ctx.font = '500 13px "Inter", "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "right";
      ctx.fillText(footer.toUpperCase(), width - 32, height - 30);
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = this.maxAnisotropy;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    return this._trackTexture(texture);
  }

  /** Small text plate for pipette volume windows and rack tags. */
  textTexture({
    text = "",
    sub = "",
    width = 256,
    height = 128,
    background = "rgba(3,14,15,0.94)",
    foreground = "#d8fff8",
    accent = "#2ee6c5",
  } = {}) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = background;
    roundedPath(ctx, 0, 0, width, height, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(46,230,197,0.35)";
    ctx.lineWidth = 3;
    roundedPath(ctx, 2, 2, width - 4, height - 4, 16);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = foreground;
    ctx.font = '600 28px "Inter", "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, width / 2, height / 2 - (sub ? 10 : 0));
    if (sub) {
      ctx.fillStyle = accent;
      ctx.font = FONT_MONO_SMALL;
      ctx.fillText(sub, width / 2, height / 2 + 22);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = this.maxAnisotropy;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    return this._trackTexture(texture);
  }

  /** Vertical gradient for the backsplash wall. */
  gradientTexture({ top = "#0a2225", bottom = "#03090a", noise = 0.02, width = 256, height = 512 } = {}) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, bottom);
    gradient.addColorStop(0.55, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    if (noise > 0) {
      const pixels = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 255 * noise;
        pixels.data[i] += n;
        pixels.data[i + 1] += n;
        pixels.data[i + 2] += n;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.anisotropy = this.maxAnisotropy;
    texture.needsUpdate = true;
    return this._trackTexture(texture);
  }

  /* --------------------------------------------------------------- shadows */
  contactShadowTexture() {
    if (this._shadowTexture) return this._shadowTexture;
    const canvas = makeCanvas(128, 128);
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, "rgba(0,0,0,0.52)");
    gradient.addColorStop(0.42, "rgba(0,0,0,0.3)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    this._shadowTexture = this._trackTexture(texture);
    return texture;
  }

  contactShadowMaterial() {
    if (this._shadowMaterial) return this._shadowMaterial;
    this._shadowMaterial = new MeshBasicMaterial({
      map: this.contactShadowTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.72,
    });
    this._shadowMaterial.name = "contact-shadow";
    this._shadowMaterial.userData.biosimLibrary = true;
    return this._shadowMaterial;
  }

  /* ----------------------------------------------------------- LCD helper */
  createLCD(options = {}) {
    const lcd = new LCDScreen(options);
    this.lcds.add(lcd);
    return lcd;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const material of this.cache.values()) material.dispose?.();
    this.cache.clear();
    for (const lcd of this.lcds) lcd.dispose();
    this.lcds.clear();
    for (const texture of this.textures) texture.dispose?.();
    this.textures.clear();
    this._shadowTexture?.dispose?.();
    this._shadowMaterial?.dispose?.();
    this._shadowTexture = null;
    this._shadowMaterial = null;
  }
}

/** Greedy word wrap used by canvas labels. */
function wrapText(ctx, text, maxWidth, maxLines = 3) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : [""];
}

export default MaterialLibrary;
