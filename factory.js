/**
 * BioSim Lab · engine3d/factory.js
 * ---------------------------------------------------------------------------
 * Turns a type name ("beaker", "petri-dish", "microcentrifuge") into a finished
 * group, and owns the GPU resources that group created.
 *
 * The factory is deliberately the only place that knows every builder. The
 * engine and the experiments only ever ask for a type plus options, which keeps
 * the procedural library free to grow without touching scene code.
 *
 * Resource rules:
 *   geometry   cached per scene by key, disposed once by ResourcePool
 *   materials  owned by MaterialLibrary, disposed by it
 *   one-offs   materials built directly by a builder are tracked here
 *   shadows    scene-level planes, so a rotated prop does not tilt its shadow
 */

import { Box3, Group, Vector3 } from "three";
import { GLASSWARE_TYPES } from "./objects/glassware.js";
import { TUBE_TYPES } from "./objects/tubes.js";
import { PIPETTE_TYPES } from "./objects/pipettes.js";
import { BOTTLE_TYPES } from "./objects/bottles.js";
import { DISH_TYPES } from "./objects/dishes.js";
import { INSTRUMENT_TYPES } from "./objects/instruments.js";
import { PLANT_TYPES } from "./objects/plants.js";
import { MISC_TYPES } from "./objects/misc.js";
import { finalizeObject, toVector3 } from "./objects/common.js";

/** Every procedural builder, before aliases. */
const BUILDERS = Object.freeze({
  ...GLASSWARE_TYPES,
  ...TUBE_TYPES,
  ...PIPETTE_TYPES,
  ...BOTTLE_TYPES,
  ...DISH_TYPES,
  ...INSTRUMENT_TYPES,
  ...PLANT_TYPES,
  ...MISC_TYPES,
});

/**
 * Friendly spellings for the same builder. Keys are compared lower-case after
 * stripping spaces and punctuation, so "96-well plate", "96 well plate" and
 * "wellPlate" all resolve.
 */
const ALIASES = Object.freeze({
  // glassware
  erlenmeyer: "flask",
  erlenmeyerFlask: "flask",
  conicalFlask: "flask",
  cylinder: "graduatedCylinder",
  graduatedCylinder: "graduatedCylinder",
  measuringCylinder: "graduatedCylinder",
  volumetric: "volumetricFlask",
  // tubes
  eppendorf: "microtube",
  eppendorfTube: "microtube",
  microcentrifugeTube: "microtube",
  pcr: "pcrTube",
  falcon: "falconTube",
  conicalTube: "falconTube",
  rack: "tubeRack",
  // pipettes
  pipette: "micropipette",
  pipet: "micropipette",
  tips: "tipBox",
  // bottles
  reagent: "reagentBottle",
  reagentBottle: "reagentBottle",
  mediaBottle: "reagentBottle",
  dropper: "dropperBottle",
  // dishes
  petri: "petriDish",
  agarPlate: "petriDish",
  plate: "wellPlate",
  "96wellPlate": "wellPlate",
  microplate: "wellPlate",
  microscopeSlide: "slide",
  // instruments
  centrifuge: "microcentrifuge",
  miniCentrifuge: "microcentrifuge",
  microcentrifuge: "microcentrifuge",
  powerSupply: "powerSupply",
  powerpack: "powerSupply",
  // plants
  plantCulture: "plantJar",
  tissueCultureJar: "plantJar",
  // environment
  environment: "labEnvironment",
  lab: "labEnvironment",
  ice: "iceBucket",
});

const NORMALIZED = new Map();
for (const [key, builder] of Object.entries(BUILDERS)) {
  NORMALIZED.set(key.toLowerCase(), builder);
}
for (const [alias, target] of Object.entries(ALIASES)) {
  const builder = BUILDERS[target];
  if (builder) NORMALIZED.set(alias.toLowerCase(), builder);
}

export const OBJECT_TYPES = Object.freeze([...new Set([...Object.keys(BUILDERS), ...Object.keys(ALIASES)])].sort());

/** "graduated-cylinder" and "Graduated Cylinder" both become "graduatedcylinder". */
function normalizeType(type) {
  return String(type ?? "")
    .trim()
    .replace(/[\s_-]+(.)/g, (_, character) => character.toUpperCase())
    .toLowerCase();
}

/**
 * Resolve a public type name to a builder.
 * @returns {{builder: Function, type: string} | null}
 */
export function resolveBuilder(type) {
  if (typeof type === "function") return { builder: type, type: type.name || "custom" };
  if (typeof type !== "string") return null;
  const builder = NORMALIZED.get(normalizeType(type));
  if (!builder) return null;
  const key = Object.keys(BUILDERS).find((name) => BUILDERS[name] === builder) ?? type;
  return { builder, type: key };
}

/**
 * Apply a placement without destroying the builder's own resting transform.
 * A lying pipette, for example, already has a rotation and a small lift; adding
 * a yaw at the caller level must not stand it back up.
 */
function applyPlacement(root, options) {
  if (options.position) root.position.add(toVector3(options.position));
  if (options.rotation !== undefined) {
    if (Array.isArray(options.rotation)) {
      root.rotation.x += Number(options.rotation[0]) || 0;
      root.rotation.y += Number(options.rotation[1]) || 0;
      root.rotation.z += Number(options.rotation[2]) || 0;
    } else if (typeof options.rotation === "number") {
      root.rotation.y += options.rotation;
    } else if (options.rotation?.isEuler) {
      root.rotation.x += options.rotation.x;
      root.rotation.y += options.rotation.y;
      root.rotation.z += options.rotation.z;
    }
  }
  if (options.rotationY !== undefined && options.rotation === undefined) {
    root.rotation.y += Number(options.rotationY) || 0;
  }
  if (options.scale !== undefined) {
    if (typeof options.scale === "number") root.scale.multiplyScalar(options.scale);
    else if (Array.isArray(options.scale)) {
      root.scale.x *= options.scale[0] ?? 1;
      root.scale.y *= options.scale[1] ?? 1;
      root.scale.z *= options.scale[2] ?? 1;
    } else if (options.scale?.isVector3) {
      root.scale.multiply(options.scale);
    }
  }
  return root;
}

/**
 * Per-scene resource tracker. One pool belongs to one Bench3D instance.
 */
export class ResourcePool {
  constructor() {
    this.geometries = new Set();
    this.materials = new Set();
    this.roots = new Set();
    this.shadows = new Set();
    this._disposed = false;
  }

  /** Shared geometry cache. The factory function only runs on a miss. */
  geometry(key, make) {
    if (this._disposed) throw new Error("ResourcePool has been disposed");
    const name = String(key);
    if (!this.geometryCache) this.geometryCache = new Map();
    if (!this.geometryCache.has(name)) this.geometryCache.set(name, make());
    const geometry = this.geometryCache.get(name);
    this.geometries.add(geometry);
    return geometry;
  }

  /** Track a built root and every GPU object under it. */
  adopt(root) {
    if (!root || this._disposed) return root;
    this.roots.add(root);
    root.traverse((node) => {
      if (!node.isMesh && !node.isPoints && !node.isLine) return;
      if (node.geometry) this.geometries.add(node.geometry);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material && material.userData?.biosimLibrary !== true) this.materials.add(material);
      }
    });
    if (root.userData.contactShadow) this.shadows.add(root.userData.contactShadow);
    return root;
  }

  /** Detach a root without destroying shared geometry (used by later phases). */
  release(root) {
    if (!root) return;
    this.roots.delete(root);
    if (root.userData.contactShadow) {
      this.shadows.delete(root.userData.contactShadow);
      root.userData.contactShadow.removeFromParent();
    }
    root.removeFromParent();
  }

  stats() {
    let meshes = 0;
    for (const root of this.roots) {
      root.traverse((node) => {
        if (node.isMesh || node.isPoints) meshes += 1;
      });
    }
    return {
      objects: this.roots.size,
      geometries: this.geometries.size,
      materials: this.materials.size,
      meshes,
      shadows: this.shadows.size,
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const shadow of this.shadows) shadow.removeFromParent();
    this.shadows.clear();
    for (const root of this.roots) root.removeFromParent();
    this.roots.clear();
    for (const geometry of this.geometries) geometry.dispose?.();
    this.geometries.clear();
    for (const material of this.materials) material.dispose?.();
    this.materials.clear();
    if (this.geometryCache) this.geometryCache.clear();
  }
}

/**
 * Build one procedural object.
 *
 * @param {string} type public type name, e.g. "beaker"
 * @param {object} options builder options plus placement and metadata:
 *   position  offset from the builder origin (metres)
 *   rotation  additive Euler array / radians / Euler
 *   scale     multiplier or [x,y,z]
 *   id, label, displayLabel, role, interactive, meta, contactShadow,
 *   shadowScale, engine
 *
 * `label` is passed through to the builder (it is the etched glassware text or
 * bottle print in many builders), while `displayLabel` is what the HUD and
 * CSS2D label show. If only one is supplied, it serves both.
 * @param {{quality: object, library: object, resources: ResourcePool,
 *          shadowRoot?: Group, three?: object}} ctx
 * @returns {Group}
 */
export function createObject(type, options = {}, ctx) {
  if (!ctx?.library) throw new Error("createObject requires ctx.library");
  if (!ctx?.resources) throw new Error("createObject requires ctx.resources");
  if (!ctx?.quality) throw new Error("createObject requires ctx.quality");

  const resolved = resolveBuilder(type);
  if (!resolved) {
    throw new Error(`Unknown 3D object type "${type}". Try one of: ${OBJECT_TYPES.join(", ")}`);
  }

  const { builder, type: resolvedType } = resolved;
  const root = builder(options, ctx);
  if (!root) throw new Error(`Builder for "${resolvedType}" returned no object`);

  applyPlacement(root, options);

  finalizeObject(
    root,
    {
      type: resolvedType,
      id: options.id,
      label: options.displayLabel ?? options.label,
      interactive: options.interactive,
      role: options.role,
      engine: options.engine,
      contactShadow: options.contactShadow,
      shadowScale: options.shadowScale,
      meta: {
        ...(options.meta ?? {}),
        labelVisible: options.labelVisible !== false,
        ...(options.kind ? { kind: options.kind } : {}),
      },
    },
    ctx,
  );

  ctx.resources.adopt(root);
  return root;
}

/**
 * Convenience used by tests and by later engine integration: build, place and
 * immediately add to a parent.
 */
export function addObject(parent, type, options, ctx) {
  const root = createObject(type, options, ctx);
  parent?.add(root);
  return root;
}

/** Scene-level contact shadow group, kept together for a single clear pass. */
export function createShadowRoot() {
  const root = new Group();
  root.name = "contact-shadows";
  root.userData.role = "shadow-layer";
  return root;
}

/** Recompute world bounds for camera focus and selection cards. */
export function worldBounds(object) {
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) box.setFromCenterAndSize(new Vector3(), new Vector3(0.02, 0.02, 0.02));
  return box;
}

export const BUILDERS_FOR_TEST = BUILDERS;

export default { createObject, addObject, resolveBuilder, ResourcePool, OBJECT_TYPES, worldBounds };
