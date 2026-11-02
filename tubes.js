/**
 * BioSim Lab · engine3d/objects/tubes.js
 * ---------------------------------------------------------------------------
 * Microcentrifuge tubes, PCR tubes and the 2 × 6 rack that holds them.
 * Tubes are built tip-down at the origin; the rack inserts them through real
 * holes in its top plate so the silhouette is correct from every angle.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  TorusGeometry,
} from "three";
import {
  addMesh,
  flatLabel,
  holePlateGeometry,
  liquidGeometry,
  profileHeight,
  roundedBoxGeometry,
  seededRandom,
  solidLathe,
} from "./common.js";

const TUBE_PROFILE = [
  [0.0012, 0.0005],
  [0.0031, 0.0042],
  [0.0048, 0.0098],
  [0.00535, 0.015],
  [0.00535, 0.0325],
  [0.00565, 0.035],
  [0.0058, 0.0365],
];

const PCR_PROFILE = [
  [0.0009, 0.0004],
  [0.0022, 0.0035],
  [0.0033, 0.0075],
  [0.00345, 0.0145],
  [0.0037, 0.0175],
];

/**
 * Build one microcentrifuge tube. Not finalized: callers may place it in a
 * rack or return it as the top-level object.
 */
export function buildMicroTube(options = {}, ctx) {
  const {
    capColor = 0xef4444,
    bodyColor = 0xe8f3f1,
    liquid = null,
    size = 1.5,
    open = false,
    label = "",
  } = options;
  const scale = size >= 2 ? 1.1 : 1;
  const profile = TUBE_PROFILE.map(([r, y]) => [r * scale, y * scale]);
  const height = profileHeight(profile);
  const tubeMaterial = ctx.library.plasticTranslucent(bodyColor, { opacity: 0.38 });
  const capMaterial = ctx.library.plastic(capColor, { roughness: 0.32, clearcoat: 0.7 });
  const root = new Group();
  root.name = "microtube";

  const body = new Mesh(solidLathe(profile, 40), tubeMaterial);
  root.add(body);
  // A slightly darker lip makes the moulded rim legible.
  const lip = new Mesh(new TorusGeometry(profile[profile.length - 1][0], 0.00045, 6, 32), tubeMaterial);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = height - 0.0004;
  root.add(lip);

  // Frosted writing patch.
  const patchMaterial = ctx.library.frosted();
  const patch = new Mesh(new PlaneGeometry(0.0056 * scale, 0.011 * scale), patchMaterial);
  patch.position.set(0, height * 0.68, profile[4][0] * 0.97);
  patch.userData.noShadow = true;
  root.add(patch);

  // Two moulded graduation rings.
  const markMaterial = ctx.library.matte(0xffffff, { opacity: 0.46, roughness: 0.6 });
  for (const level of [0.45, 0.62]) {
    const ring = new Mesh(new TorusGeometry(profile[4][0] + 0.0001, 0.00014, 4, 20), markMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = height * level;
    ring.userData.noShadow = true;
    root.add(ring);
  }

  if (liquid && liquid.level > 0) {
    const geometry = liquidGeometry(profile, liquid.level, {
      inset: 0.00038,
      base: 0.0012,
      meniscus: 0.00055,
      segments: 36,
    });
    if (geometry) {
      const material = ctx.library.liquid(liquid.color ?? 0x8fd7e8, {
        opacity: liquid.opacity ?? 0.82,
        turbidity: liquid.turbidity ?? 0,
      });
      const volume = new Mesh(geometry, material);
      volume.name = "liquid";
      volume.userData.isLiquid = true;
      volume.userData.noShadow = true;
      root.add(volume);
      root.userData.parts = { ...(root.userData.parts ?? {}), liquid: volume };
    }
  }

  // Hinged lid. The hinge group sits at the back of the rim so the cap can be
  // animated open in a later phase without rebuilding the tube.
  const hinge = new Group();
  hinge.name = "cap-hinge";
  hinge.position.set(0, height, -profile[5][0] * 0.7);
  const cap = new Mesh(new CylinderGeometry(0.0064 * scale, 0.0062 * scale, 0.0046 * scale, 28), capMaterial);
  cap.position.set(0, 0.0023 * scale, profile[5][0] * 0.7);
  hinge.add(cap);
  const tab = new Mesh(new BoxGeometry(0.0044 * scale, 0.0014 * scale, 0.0022 * scale), capMaterial);
  tab.position.set(0, 0.0004, profile[5][0] + 0.0016);
  hinge.add(tab);
  if (open) hinge.rotation.x = -1.85;
  root.add(hinge);

  root.userData.parts = { ...(root.userData.parts ?? {}), body, cap, hinge };

  if (label) {
    const texture = ctx.library.textTexture({ text: label, width: 256, height: 96 });
    const material = ctx.library.label(texture);
    const tag = flatLabel({ texture, width: 0.014 * scale, height: 0.005 * scale, y: height * 0.2, z: profile[3][0] + 0.0002, material });
    root.add(tag);
  }
  return root;
}

/** 0.2 mL PCR tube: thin wall, conical, tethered cap. */
export function buildPCRTube(options = {}, ctx) {
  const { capColor = 0x38bdf8, liquid = null } = options;
  const profile = PCR_PROFILE;
  const height = profileHeight(profile);
  const tubeMaterial = ctx.library.plasticTranslucent(0xeef8f6, { opacity: 0.3 });
  const capMaterial = ctx.library.plastic(capColor, { roughness: 0.28 });
  const root = new Group();
  root.name = "pcr-tube";

  root.add(new Mesh(solidLathe(profile, 32), tubeMaterial));
  if (liquid?.level > 0) {
    const geometry = liquidGeometry(profile, liquid.level, {
      inset: 0.00032,
      base: 0.0009,
      meniscus: 0.00035,
      segments: 28,
    });
    if (geometry) {
      const mesh = new Mesh(geometry, ctx.library.liquid(liquid.color ?? 0x8fd7e8, { opacity: 0.82 }));
      mesh.userData.isLiquid = true;
      mesh.userData.noShadow = true;
      root.add(mesh);
      root.userData.parts = { liquid: mesh };
    }
  }

  const tether = new Mesh(new BoxGeometry(0.0022, 0.0008, 0.0058), capMaterial);
  tether.position.set(0, height + 0.001, -0.0022);
  root.add(tether);
  const cap = new Mesh(new CylinderGeometry(0.0038, 0.0036, 0.003, 20), capMaterial);
  cap.position.set(0, height + 0.0014, 0.0014);
  root.add(cap);
  root.userData.parts = { ...(root.userData.parts ?? {}), cap };
  return root;
}

/** 15 / 50 mL conical Falcon tube. */
export function buildFalconTube(options = {}, ctx) {
  const { size = 15, capColor = 0x3b82f6, liquid = null } = options;
  const scale = size >= 50 ? 1.45 : 1;
  const profile = [
    [0.0015, 0.0008],
    [0.0075, 0.006],
    [0.012, 0.018],
    [0.0146, 0.045],
    [0.0146, 0.108],
    [0.0152, 0.116],
  ].map(([r, y]) => [r * scale, y * scale]);
  const height = profileHeight(profile);
  const bodyMaterial = ctx.library.plasticTranslucent(0xeaf4f2, { opacity: 0.42 });
  const root = new Group();
  root.name = "falcon-tube";
  root.add(new Mesh(solidLathe(profile, 40), bodyMaterial));
  const cap = new Mesh(new CylinderGeometry(0.0175 * scale, 0.0172 * scale, 0.016 * scale, 32), ctx.library.plastic(capColor));
  cap.position.y = height + 0.006 * scale;
  root.add(cap);
  if (liquid?.level > 0) {
    const geometry = liquidGeometry(profile, liquid.level, { inset: 0.0007, base: 0.002, segments: 40 });
    if (geometry) {
      const mesh = new Mesh(geometry, ctx.library.liquid(liquid.color ?? 0x8fd7e8, { opacity: 0.78 }));
      mesh.userData.isLiquid = true;
      mesh.userData.noShadow = true;
      root.add(mesh);
      root.userData.parts = { liquid: mesh };
    }
  }
  root.userData.parts = { ...(root.userData.parts ?? {}), cap };
  return root;
}

/* ==========================================================================
   Tube rack
   ========================================================================== */
const RACK_COLORS = [0xef4444, 0x3b82f6, 0x22c55e, 0xeab308, 0xa855f7, 0xf97316];

export function buildTubeRack(options = {}, ctx) {
  const {
    width = 0.16,
    depth = 0.078,
    height = 0.056,
    color = 0x0f8f83,
    tubes = 6,
    liquidLevel = 0.58,
    label = "SAMPLES",
  } = options;

  const root = new Group();
  root.name = "tube-rack";
  const plastic = ctx.library.plastic(color, { roughness: 0.36, clearcoat: 0.45 });
  const plasticDark = ctx.library.plastic(0x0a3f3c, { roughness: 0.48, clearcoat: 0.25 });
  const cols = 6;
  const rows = 2;
  const spacingX = (width - 0.026) / (cols - 1);
  const spacingZ = (depth - 0.028) / (rows - 1);
  const holes = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      holes.push([-width / 2 + 0.013 + col * spacingX, -depth / 2 + 0.014 + row * spacingZ]);
    }
  }

  const base = new Mesh(roundedBoxGeometry(width, 0.012, depth, 0.004, 0.0015), plastic);
  base.position.y = 0.006;
  root.add(base);

  const top = new Mesh(holePlateGeometry(width, depth, 0.006, holes, { radius: 0.005, bevel: 0.001 }), plastic);
  top.position.y = height - 0.003;
  root.add(top);

  // Side rails tie the two plates together.
  for (const side of [-1, 1]) {
    const rail = new Mesh(new BoxGeometry(0.006, height - 0.012, depth * 0.9), plastic);
    rail.position.set(side * (width / 2 - 0.003), 0.006 + (height - 0.012) / 2, 0);
    root.add(rail);
  }
  // Front nameplate.
  const plate = new Mesh(new BoxGeometry(width * 0.42, 0.009, 0.0022), plasticDark);
  plate.position.set(0, 0.017, depth / 2 + 0.0004);
  root.add(plate);

  const count = Math.max(0, Math.min(holes.length, Number(tubes) || 0));
  const tubeGroups = [];
  const random = seededRandom(42);
  for (let index = 0; index < count; index += 1) {
    const [x, z] = holes[index];
    const colorCap = RACK_COLORS[index % RACK_COLORS.length];
    const tube = buildMicroTube(
      {
        capColor: colorCap,
        liquid: {
          level: liquidLevel + (random() - 0.5) * 0.12,
          color: index % 3 === 0 ? 0x8fd7e8 : index % 3 === 1 ? 0xfbbf24 : 0xa78bfa,
        },
        size: 1.5,
      },
      ctx,
    );
    tube.position.set(x, 0.0115, z);
    tube.rotation.y = random() * Math.PI * 0.4;
    root.add(tube);
    tubeGroups.push(tube);
  }

  // Empty wells get a dark liner so they read as holes, not flat circles.
  for (let index = count; index < holes.length; index += 1) {
    const [x, z] = holes[index];
    const liner = new Mesh(
      new CylinderGeometry(0.0042, 0.0042, 0.022, 16, 1, true),
      ctx.library.matte(0x041414, { roughness: 0.9 }),
    );
    liner.position.set(x, height * 0.72, z);
    liner.userData.noShadow = true;
    root.add(liner);
  }

  const texture = ctx.library.textTexture({
    text: label,
    sub: "2 × 6 · 1.5 mL",
    width: 384,
    height: 128,
    background: "rgba(4,28,27,0.92)",
  });
  const labelMesh = flatLabel({
    texture,
    width: width * 0.58,
    height: 0.012,
    y: 0.017,
    z: depth / 2 + 0.0018,
    material: ctx.library.label(texture),
  });
  root.add(labelMesh);

  root.userData.parts = { tubes: tubeGroups, holes };
  return root;
}

export const TUBE_TYPES = {
  microtube: buildMicroTube,
  pcrTube: buildPCRTube,
  falconTube: buildFalconTube,
  tubeRack: buildTubeRack,
};

export default TUBE_TYPES;
