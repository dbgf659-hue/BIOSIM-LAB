/**
 * BioSim Lab · engine3d/objects/common.js
 * ---------------------------------------------------------------------------
 * Small, geometry-only helpers shared by every procedural object builder.
 * No object-specific appearance lives here: just lathes, rounded boxes, hole
 * plates, liquid volumes, label decals, bounds and contact shadows.
 */

import {
  Box3,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";

export const MM = 0.001;

/** Convert a number, array or Vector3 into a Vector3. */
export function toVector3(value, fallback = [0, 0, 0]) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) return new Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  if (value && typeof value === "object") {
    return new Vector3(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
  }
  if (Array.isArray(fallback)) return new Vector3(fallback[0], fallback[1], fallback[2]);
  return new Vector3();
}

function applyTransform(mesh, { position, rotation, scale }) {
  if (position) mesh.position.copy(toVector3(position));
  if (rotation) {
    if (Array.isArray(rotation)) mesh.rotation.set(...rotation.map((n) => Number(n) || 0));
    else if (rotation?.isEuler) mesh.rotation.copy(rotation);
    else mesh.rotation.set(0, Number(rotation) || 0, 0);
  }
  if (scale) {
    if (Array.isArray(scale)) mesh.scale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
    else if (typeof scale === "number") mesh.scale.setScalar(scale);
    else if (scale?.isVector3) mesh.scale.copy(scale);
  }
}

/**
 * Add a mesh to a parent with the handful of options every builder needs.
 * @returns {Mesh}
 */
export function addMesh(parent, geometry, material, options = {}) {
  const mesh = new Mesh(geometry, material);
  applyTransform(mesh, options);
  mesh.name = options.name ?? geometry.type;
  if (options.castShadow === false) mesh.userData.noCastShadow = true;
  if (options.noShadow === true) mesh.userData.noShadow = true;
  if (options.ignoreBounds === true) mesh.userData.ignoreBounds = true;
  if (options.renderOrder !== undefined) mesh.renderOrder = options.renderOrder;
  if (options.visible !== undefined) mesh.visible = options.visible;
  if (options.userData) Object.assign(mesh.userData, options.userData);
  parent.add(mesh);
  return mesh;
}

/** Group with a name so the scene graph is readable in the debugger. */
export function group(name = "object") {
  const node = new Group();
  node.name = name;
  return node;
}

/* ==========================================================================
   Profiles and lathes
   ========================================================================== */

/** @param {Array<[number,number]>} points radius, height */
export function latheProfile(points, segments = 64) {
  const vectors = points.map(([radius, y]) => new Vector2(Math.max(0.00015, Number(radius) || 0), Number(y) || 0));
  return new LatheGeometry(vectors, segments);
}

/** Open surface (a wall) from a bottom-to-top radius/height profile. */
export function vesselSurface(points, segments = 64) {
  return latheProfile(points, segments);
}

/** Closed solid of revolution; caps both ends if the profile does not. */
export function solidLathe(points, segments = 48) {
  const profile = points.map(([r, y]) => [Math.max(0.00015, r), y]);
  if (profile[0][0] > 0.0002) profile.unshift([0.00015, profile[0][1]]);
  const last = profile[profile.length - 1];
  if (last[0] > 0.0002) profile.push([0.00015, last[1]]);
  return latheProfile(profile, segments);
}

/** Linear radius lookup on a bottom-to-top profile. */
export function radiusAt(points, y) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  if (y <= points[0][1]) return points[0][0];
  for (let index = 1; index < points.length; index += 1) {
    const [r1, y1] = points[index];
    const [r0, y0] = points[index - 1];
    if (y <= y1) {
      const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
      return r0 + (r1 - r0) * t;
    }
  }
  return points[points.length - 1][0];
}

/** Height of a typical vessel profile. */
export function profileHeight(points) {
  return points.reduce((height, [, y]) => Math.max(height, Number(y) || 0), 0);
}

/**
 * A liquid volume following the inside of a vessel. The top is slightly
 * curved so a meniscus reads at grazing angles instead of a flat disc.
 *
 * @param {Array<[number,number]>} profile vessel outer profile, bottom to top
 * @param {number} level 0..1
 * @param {{inset?: number, base?: number, meniscus?: number, segments?: number}} options
 */
export function liquidGeometry(profile, level, { inset = 0.00045, base = 0.0008, meniscus = 0.0011, segments = 64 } = {}) {
  const height = profileHeight(profile);
  const clamped = Math.min(1, Math.max(0, Number(level) || 0));
  if (clamped <= 0.001 || height <= 0) return null;
  const top = Math.max(base + 0.0004, height * clamped);
  const rTop = Math.max(0.0004, radiusAt(profile, top) - inset);

  const points = [[0.00015, base], [Math.max(0.0005, radiusAt(profile, base) - inset), base]];
  for (const [radius, y] of profile) {
    if (y > base + 0.0003 && y < top - 0.0002) points.push([Math.max(0.0004, radius - inset), y]);
  }
  points.push([rTop, top + meniscus * 0.55]);
  points.push([rTop * 0.6, top + meniscus * 0.22]);
  points.push([0.00015, top + meniscus * 0.1]);
  return latheProfile(points, segments);
}

/** A closed cylinder from radius/height without repeating profile code. */
export function cylinderProfile(radius, height) {
  return [
    [Math.max(0.0001, radius * 0.86), 0],
    [radius, Math.min(0.004, height * 0.08)],
    [radius, height],
  ];
}

/* ==========================================================================
   Rounded boxes and hole plates
   ========================================================================== */
export function roundedRectShape(width, height, radius) {
  const w = Math.max(0.0001, width);
  const h = Math.max(0.0001, height);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const shape = new Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  shape.closePath();
  return shape;
}

/** A rounded, bevelled box centred on its origin. */
export function roundedBoxGeometry(width, height, depth, radius = 0.006, bevel = 0.002, curveSegments = 10) {
  const shape = roundedRectShape(width, height, radius);
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
    steps: 1,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Horizontal plate with real holes, used by tube racks and well plates.
 * @param {number} width x
 * @param {number} depth z
 * @param {number} thickness y
 * @param {Array<[number,number]>} holes local x/z centres
 */
export function holePlateGeometry(width, depth, thickness, holes = [], { radius = 0.0045, bevel = 0.0015 } = {}) {
  const shape = roundedRectShape(width, depth, Math.min(width, depth) * 0.12);
  for (const [x, z] of holes) {
    const path = new Shape();
    path.absarc(x, z, radius, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, thickness - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 18,
    steps: 1,
  });
  // Shape lives in XY and extrudes along Z; tip it flat and centre it.
  geometry.rotateX(-Math.PI / 2);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/* ==========================================================================
   Small details
   ========================================================================== */
export function addDisc(parent, radius, y, material, { segments = 48, rotation = 0 } = {}) {
  const geometry = new CircleGeometry(radius, segments);
  const mesh = addMesh(parent, geometry, material, {
    rotation: [-Math.PI / 2, 0, rotation],
    position: [0, y, 0],
    noShadow: true,
    ignoreBounds: true,
  });
  return mesh;
}

export function addRim(parent, radius, y, thickness, material, { segments = 48, arc = Math.PI * 2, rotation = 0 } = {}) {
  const geometry = new TorusGeometry(radius, thickness, 10, segments, arc);
  return addMesh(parent, geometry, material, {
    rotation: [Math.PI / 2, 0, rotation],
    position: [0, y, 0],
  });
}

/**
 * Curved label wrapped around a cylindrical bottle.
 * @param {{texture: object, radius: number, height: number, y: number, arc?: number}} options
 */
export function curvedLabel({ texture, radius, height, y, arc = 1.15, material }) {
  const geometry = new CylinderGeometry(radius, radius, height, 40, 1, true, -arc / 2, arc);
  const mesh = new Mesh(geometry, material);
  mesh.position.y = y;
  mesh.userData.noShadow = true;
  mesh.userData.ignoreBounds = true;
  return mesh;
}

export function flatLabel({ texture, width, height, y, z, material, rotation = 0 }) {
  const geometry = new PlaneGeometry(width, height);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(0, y, z);
  mesh.rotation.z = rotation;
  mesh.userData.noShadow = true;
  mesh.userData.ignoreBounds = true;
  return mesh;
}

/* ==========================================================================
   Deterministic randomness
   ========================================================================== */
export function seededRandom(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ==========================================================================
   Finishing: shadows, bounds, contact shadow, metadata
   ========================================================================== */
export function setShadows(root, quality) {
  const enabled = Boolean(quality?.shadows);
  root.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const glassy = materials.some(
      (material) =>
        !material ||
        material.userData?.glassy === true ||
        material.transmission > 0.05 ||
        (material.transparent && (material.opacity ?? 1) < 0.62),
    );
    node.castShadow = enabled && !glassy && node.userData.noCastShadow !== true && node.userData.noShadow !== true;
    node.receiveShadow = enabled && node.userData.noShadow !== true;
  });
}

/** Bounds in the group's local space, ignoring helper meshes and labels. */
export function computeBounds(root) {
  root.updateWorldMatrix(true, true);
  const box = new Box3();
  root.traverse((node) => {
    if (!node.isMesh || node.userData.ignoreBounds) return;
    if (node.name === "contact-shadow") return;
    box.expandByObject(node);
  });
  if (box.isEmpty()) {
    box.set(new Vector3(-0.01, 0, -0.01), new Vector3(0.01, 0.02, 0.01));
  }
  return box;
}

/**
 * Soft radial contact shadow that grounds an object on the bench.
 *
 * The plane lives in a scene-level `ctx.shadowRoot` whenever one is supplied,
 * so a lying pipette or a rotated bottle keeps a flat shadow on the bench.
 * Without a shadow root it falls back to a counter-rotated child plane.
 */
export function addContactShadow(root, bounds, ctx, { scale = 1.35, opacity = 0.72 } = {}) {
  if (!ctx?.library || !ctx?.resources) return null;
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const width = Math.max(0.035, size.x * scale);
  const depth = Math.max(0.035, size.z * scale);
  const geometry = ctx.resources.geometry("contact-shadow-plane", () => new PlaneGeometry(1, 1));
  const material = ctx.library.contactShadowMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.name = "contact-shadow";
  mesh.scale.set(width, depth, 1);
  mesh.renderOrder = -1;
  mesh.userData.ignoreBounds = true;
  mesh.userData.noShadow = true;

  const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const worldPosition = new Vector3(center.x, 0.0016, center.z);
  if (ctx.shadowRoot) {
    mesh.position.copy(worldPosition);
    mesh.quaternion.copy(flat);
    ctx.shadowRoot.add(mesh);
  } else {
    // Keep the plane horizontal in world space even if the object is tilted.
    root.updateWorldMatrix(true, false);
    const worldRotation = root.getWorldQuaternion(new Quaternion());
    mesh.position.copy(root.worldToLocal(worldPosition.clone()));
    mesh.quaternion.copy(worldRotation).invert().multiply(flat);
    root.add(mesh);
  }

  root.userData.contactShadow = mesh;
  return mesh;
}

/**
 * Common finish for every factory object.
 *
 * @param {Group} root
 * @param {{type: string, id?: string, label?: string, interactive?: boolean,
 *          role?: string, engine?: object, contactShadow?: boolean,
 *          shadowScale?: number, meta?: object}} meta
 * @param {{quality: object, library: object, resources: object}} ctx
 */
export function finalizeObject(root, meta, ctx) {
  root.userData = {
    ...root.userData,
    objectType: meta.type,
    id: meta.id ?? root.name,
    label: meta.label ?? meta.type,
    interactive: meta.interactive ?? true,
    role: meta.role ?? null,
    engine: meta.engine ?? null,
    kind: "bench-object",
    ...(meta.meta ?? {}),
  };
  setShadows(root, ctx.quality);
  const bounds = computeBounds(root);
  root.userData.bounds = {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    center: bounds.getCenter(new Vector3()).toArray(),
    size: bounds.getSize(new Vector3()).toArray(),
  };
  if (meta.contactShadow !== false) {
    addContactShadow(root, bounds, ctx, { scale: meta.shadowScale ?? 1.3 });
  }
  root.userData.dispose = () => {
    root.removeFromParent();
  };
  return root;
}

/** Dispose a geometry immediately; only used by one-off demo objects. */
export function disposeGeometry(geometry) {
  if (geometry instanceof BufferGeometry) geometry.dispose();
}

export default {
  MM,
  addMesh,
  group,
  latheProfile,
  vesselSurface,
  solidLathe,
  radiusAt,
  profileHeight,
  liquidGeometry,
  cylinderProfile,
  roundedBoxGeometry,
  holePlateGeometry,
  seededRandom,
  setShadows,
  computeBounds,
  finalizeObject,
};
