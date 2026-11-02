/**
 * BioSim Lab · engine3d/objects/glassware.js
 * ---------------------------------------------------------------------------
 * Beakers, conical flasks and graduated cylinders. Every vessel is a lathed or
 * cylindrical open surface with a real rim, a glass bottom, optional
 * graduations, a stir bar and a liquid volume with a curved meniscus.
 *
 * Origins are at the centre of the base, +Y is up and the front of the object
 * faces +Z. Objects are built in metres.
 */

import {
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from "three";
import {
  addDisc,
  addMesh,
  addRim,
  flatLabel,
  liquidGeometry,
  profileHeight,
  radiusAt,
  seededRandom,
  solidLathe,
  vesselSurface,
} from "./common.js";

/** Canonical 250 mL conical flask profile (metres). */
export const FLASK_PROFILE = [
  [0.0002, 0.002],
  [0.033, 0.002],
  [0.042, 0.016],
  [0.0435, 0.035],
  [0.0395, 0.053],
  [0.032, 0.072],
  [0.024, 0.09],
  [0.018, 0.108],
  [0.0166, 0.126],
  [0.0168, 0.136],
  [0.0186, 0.14],
  [0.0186, 0.143],
];

function makeLiquid(parent, profile, options, ctx, { glow = 0 } = {}) {
  const liquid = options.liquid;
  if (!liquid || !(liquid.level > 0)) return null;
  // Start the volume just above the vessel floor, not at a fixed 0.8 mm:
  // a graduated cylinder's floor is at 13 mm and would otherwise float.
  const base = liquid.base ?? Math.max(0.0008, (profile[0]?.[1] ?? 0) + 0.0004);
  const geometry = liquidGeometry(profile, liquid.level, {
    base,
    meniscus: liquid.meniscus ?? 0.0011,
    inset: liquid.inset ?? 0.00055,
  });
  if (!geometry) return null;
  const color = liquid.color ?? 0x8fd7e8;
  const material = ctx.library.liquid(color, {
    opacity: liquid.opacity ?? 0.78,
    turbidity: liquid.turbidity ?? 0,
    glow: liquid.glow ?? glow,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "liquid";
  mesh.userData.isLiquid = true;
  mesh.userData.noCastShadow = true;
  parent.add(mesh);

  const bubbles = Math.max(0, Number(liquid.bubbles) || 0);
  if (bubbles > 0) {
    const bubbleMaterial = ctx.library.plastic(0xd9ffff, { opacity: 0.24, roughness: 0.15 });
    const bubbleGeometry = ctx.resources.geometry("bubble-small", () => new SphereGeometry(0.0011, 8, 6));
    const random = seededRandom(Math.round((liquid.level ?? 0.5) * 997) + bubbles * 13);
    const height = profileHeight(profile) * Math.min(1, liquid.level);
    for (let index = 0; index < bubbles; index += 1) {
      const y = 0.004 + random() * Math.max(0.002, height - 0.007);
      const r = Math.max(0.0004, radiusAt(profile, y) * (0.25 + random() * 0.55));
      const angle = random() * Math.PI * 2;
      const bubble = new Mesh(bubbleGeometry, bubbleMaterial);
      bubble.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
      bubble.scale.setScalar(0.6 + random() * 0.9);
      bubble.userData.noShadow = true;
      parent.add(bubble);
    }
  }
  return mesh;
}

function addStirBar(parent, y, length, ctx) {
  const material = ctx.library.plastic(0xf4ffff, { opacity: 0.7, roughness: 0.18 });
  const rod = addMesh(
    parent,
    new CylinderGeometry(0.0022, 0.0022, length, 12),
    material,
    { rotation: [0, 0, Math.PI / 2], position: [0, y + 0.0022, 0], name: "stir-bar" },
  );
  rod.userData.part = "stirBar";
  return rod;
}

function addGraduations(parent, radius, height, ctx, { count = 4, start = 0.28, color = 0xf1fffb } = {}) {
  const material = ctx.library.matte(color, { opacity: 0.62, roughness: 0.5 });
  const group = new Group();
  group.name = "graduations";
  for (let index = 0; index < count; index += 1) {
    const y = height * (start + (index / Math.max(1, count - 1)) * 0.54);
    const arc = index === count - 1 ? 0.9 : 0.48;
    const mark = new Mesh(new TorusGeometry(radius + 0.00015, 0.00022, 4, 18, arc), material);
    mark.rotation.x = Math.PI / 2;
    mark.rotation.z = Math.PI * 0.55 - arc / 2;
    mark.position.y = y;
    mark.userData.noShadow = true;
    group.add(mark);
  }
  parent.add(group);
  return group;
}

function addVesselLabel(parent, text, y, z, ctx, width = 0.028, height = 0.009) {
  if (!text) return null;
  const texture = ctx.library.textTexture({
    text,
    width: 256,
    height: 96,
    background: "rgba(238,248,244,0.92)",
    foreground: "#12312f",
    accent: "#0e8f7e",
  });
  const material = ctx.library.label(texture);
  const label = flatLabel({ texture, width, height, y, z: z + 0.0006, material });
  parent.add(label);
  return label;
}

/* ==========================================================================
   Beaker
   ========================================================================== */
export function buildBeaker(options = {}, ctx) {
  const {
    diameter = 0.07,
    height = 0.095,
    tint = 0xeafcff,
    graduations = true,
    label = "",
    stirBar = false,
  } = options;
  const radius = Math.max(0.008, diameter / 2);
  const wallMaterial = ctx.library.glass({ color: tint, thickness: 0.09, opacity: 0.92 });
  const root = new Group();
  root.name = "beaker";

  const wall = new Mesh(new CylinderGeometry(radius, radius * 0.985, height, 64, 1, true), wallMaterial);
  wall.position.y = height / 2;
  root.add(wall);

  addDisc(root, radius * 0.978, 0.0011, wallMaterial, { segments: 48 });
  addRim(root, radius, height - 0.0008, 0.0009, wallMaterial, { segments: 64 });

  // A small pouring lip. Two tapered boxes read as a lip at normal distance.
  const lip = addMesh(
    root,
    new CylinderGeometry(0.0016, 0.0042, 0.011, 8, 1, true, 0, Math.PI),
    wallMaterial,
    {
      position: [radius * 0.97, height - 0.002, 0],
      rotation: [0, 0, Math.PI / 2],
      name: "spout",
    },
  );
  lip.userData.noCastShadow = true;

  addGraduations(root, radius, height, ctx, { count: 4, start: 0.25 });
  addVesselLabel(root, label, height * 0.52, radius * 0.965, ctx, 0.032, 0.011);

  const profile = [
    [radius * 0.985, 0.001],
    [radius, height * 0.12],
    [radius, height],
  ];
  const liquid = makeLiquid(root, profile, options, ctx);
  if (stirBar) addStirBar(root, 0.0012, radius * 1.15, ctx);

  root.userData.parts = { wall, liquid };
  return root;
}

/* ==========================================================================
   Conical (Erlenmeyer) flask
   ========================================================================== */
export function buildFlask(options = {}, ctx) {
  const { scale = 1, tint = 0xeafcff, label = "", stirBar = true } = options;
  const profile = FLASK_PROFILE.map(([r, y]) => [r * scale, y * scale]);
  const height = profileHeight(profile);
  const wallMaterial = ctx.library.glass({ color: tint, thickness: 0.12, opacity: 0.94 });
  const root = new Group();
  root.name = "flask";

  const wall = new Mesh(vesselSurface(profile, 72), wallMaterial);
  root.add(wall);
  addDisc(root, radiusAt(profile, 0.003) * 0.985, 0.0014 * scale, wallMaterial, { segments: 48 });
  addRim(root, profile[profile.length - 1][0], height - 0.001, 0.0008, wallMaterial, { segments: 64 });

  // Neck ring adds a believable blown-glass seam.
  addRim(root, radiusAt(profile, height * 0.83), height * 0.83, 0.00035, wallMaterial, { segments: 48 });

  const labelY = height * 0.42;
  addVesselLabel(root, label, labelY, radiusAt(profile, labelY) * 0.965, ctx, 0.036, 0.012);
  const liquid = makeLiquid(root, profile, options, ctx);
  if (stirBar) addStirBar(root, 0.0016, 0.024 * scale, ctx);

  root.userData.parts = { wall, liquid };
  return root;
}

/* ==========================================================================
   Graduated cylinder
   ========================================================================== */
export function buildGraduatedCylinder(options = {}, ctx) {
  const { diameter = 0.032, height = 0.22, label = "" } = options;
  const radius = Math.max(0.005, diameter / 2);
  const wallMaterial = ctx.library.glass({ color: 0xeafcff, thickness: 0.16, opacity: 0.94 });
  const root = new Group();
  root.name = "graduated-cylinder";

  const base = addMesh(
    root,
    new CylinderGeometry(radius * 1.9, radius * 2.2, 0.012, 48),
    wallMaterial,
    { position: [0, 0.006, 0], name: "base" },
  );
  base.userData.noCastShadow = true;

  const wall = new Mesh(new CylinderGeometry(radius, radius, height, 48, 1, true), wallMaterial);
  wall.position.y = height / 2 + 0.012;
  root.add(wall);
  addDisc(root, radius * 0.97, 0.0126, wallMaterial, { segments: 40 });
  addRim(root, radius, height + 0.011, 0.0007, wallMaterial, { segments: 48 });

  // Many fine graduations; cheaper than they look because the geometry is tiny.
  const markMaterial = ctx.library.matte(0xf1fffb, { opacity: 0.7, roughness: 0.5 });
  for (let index = 0; index < 18; index += 1) {
    const y = 0.028 + index * ((height - 0.05) / 17);
    const arc = index % 5 === 4 ? 1.15 : 0.52;
    const mark = new Mesh(new TorusGeometry(radius + 0.00012, 0.00018, 4, 16, arc), markMaterial);
    mark.rotation.x = Math.PI / 2;
    mark.rotation.z = Math.PI * 0.55 - arc / 2;
    mark.position.y = y;
    mark.userData.noShadow = true;
    root.add(mark);
  }

  addVesselLabel(root, label, height * 0.4, radius * 0.96, ctx, 0.024, 0.008);
  const profile = [
    [radius * 0.96, 0.013],
    [radius, 0.03],
    [radius, height + 0.01],
  ];
  const liquid = makeLiquid(root, profile, options, ctx);
  root.userData.parts = { wall, liquid };
  return root;
}

/* ==========================================================================
   Volumetric flask (a useful spare in the shelf palette)
   ========================================================================== */
export function buildVolumetricFlask(options = {}, ctx) {
  const { scale = 1, label = "" } = options;
  const profile = [
    [0.0002, 0.002],
    [0.03, 0.002],
    [0.041, 0.015],
    [0.043, 0.033],
    [0.038, 0.055],
    [0.026, 0.078],
    [0.013, 0.102],
    [0.0095, 0.14],
    [0.0095, 0.158],
    [0.0115, 0.16],
  ].map(([r, y]) => [r * scale, y * scale]);
  const height = profileHeight(profile);
  const material = ctx.library.glass({ color: 0xeafcff, thickness: 0.1 });
  const root = new Group();
  root.name = "volumetric-flask";
  root.add(new Mesh(vesselSurface(profile, 64), material));
  addDisc(root, radiusAt(profile, 0.003) * 0.98, 0.0014 * scale, material);
  addRim(root, profile[profile.length - 1][0], height - 0.001, 0.0007, material);
  addVesselLabel(root, label, height * 0.35, radiusAt(profile, height * 0.35) * 0.96, ctx, 0.03, 0.01);
  const liquid = makeLiquid(root, profile, options, ctx);
  root.userData.parts = { liquid };
  return root;
}

export const GLASSWARE_TYPES = {
  beaker: buildBeaker,
  flask: buildFlask,
  graduatedCylinder: buildGraduatedCylinder,
  volumetricFlask: buildVolumetricFlask,
};

export default GLASSWARE_TYPES;
