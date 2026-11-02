/**
 * BioSim Lab · engine3d/objects/bottles.js
 * ---------------------------------------------------------------------------
 * Reagent bottles: clear or amber glass, screw cap with knurling, a curved
 * printed label and a visible liquid level. Everything is lathed from a
 * canonical 500 mL profile and can be scaled down for bench-side stocks.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  TorusGeometry,
} from "three";
import {
  addMesh,
  addRim,
  curvedLabel,
  flatLabel,
  liquidGeometry,
  profileHeight,
  radiusAt,
  vesselSurface,
} from "./common.js";

/** 500 mL laboratory reagent bottle, bottom to neck (metres). */
export const BOTTLE_PROFILE = [
  [0.0002, 0.002],
  [0.029, 0.002],
  [0.0345, 0.009],
  [0.0365, 0.02],
  [0.0365, 0.092],
  [0.0355, 0.108],
  [0.028, 0.122],
  [0.0205, 0.135],
  [0.0185, 0.145],
  [0.0185, 0.164],
  [0.0198, 0.168],
];

function knurledCap(radius, height, material, ctx, y) {
  const cap = new Group();
  cap.name = "cap";
  cap.position.y = y;
  const body = new Mesh(new CylinderGeometry(radius, radius * 1.01, height, 32), material);
  body.position.y = height / 2;
  cap.add(body);
  const top = new Mesh(new CylinderGeometry(radius * 0.92, radius, 0.0025, 32), material);
  top.position.y = height + 0.0008;
  cap.add(top);
  const ring = new Mesh(new TorusGeometry(radius * 1.005, 0.00055, 5, 32), material);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = height * 0.18;
  cap.add(ring);
  // Knurling: 24 tiny ribs. Cheap geometry, big readability win up close.
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    const rib = new Mesh(new BoxGeometry(0.0007, height * 0.62, 0.0008), material);
    rib.position.set(Math.cos(angle) * radius, height * 0.5, Math.sin(angle) * radius);
    rib.rotation.y = -angle;
    rib.userData.noShadow = true;
    cap.add(rib);
  }
  cap.userData.part = "cap";
  return cap;
}

/**
 * @param {{label?: string, subtitle?: string, footer?: string, accent?: string,
 *          amber?: boolean, scale?: number, liquid?: object, capColor?: *,
 *          capMaterial?: string, hazard?: string}} options
 */
export function buildBottle(options = {}, ctx) {
  const {
    label = "REAGENT",
    subtitle = "",
    footer = "BioSim Lab · BSL-1",
    accent = "#0ea88e",
    amber = false,
    scale = 1,
    capColor = 0x0b6b62,
    hazard = "",
  } = options;
  const profile = BOTTLE_PROFILE.map(([r, y]) => [r * scale, y * scale]);
  const height = profileHeight(profile);
  const radius = 0.0365 * scale;
  const glass = ctx.library.glass({
    color: amber ? 0x6b3a12 : 0xeafcff,
    amber,
    transmission: amber ? 0.66 : 0.96,
    opacity: amber ? 0.9 : 0.94,
    thickness: 0.42 * scale,
  });
  const capMaterial = ctx.library.plastic(capColor, { roughness: 0.36, clearcoat: 0.5 });

  const root = new Group();
  root.name = "reagent-bottle";
  root.add(new Mesh(vesselSurface(profile, 64), glass));
  // A single cap disc is enough: the lathe wall already closes the bottom.
  addMesh(
    root,
    new CylinderGeometry(radiusAt(profile, 0.003) * 0.98, radiusAt(profile, 0.003) * 0.98, 0.0012, 48),
    glass,
    { position: [0, 0.0018, 0], name: "bottle-bottom", noShadow: true },
  );
  addRim(root, profile[8][0], height * 0.86, 0.0007, glass, { segments: 48 });
  addRim(root, profile[profile.length - 1][0], height - 0.0005, 0.00045, glass, { segments: 40 });

  const capY = height - 0.004 * scale;
  const cap = knurledCap(0.0215 * scale, 0.019 * scale, capMaterial, ctx, capY);
  root.add(cap);

  if (options.liquid && options.liquid.level > 0) {
    const geometry = liquidGeometry(profile, options.liquid.level, {
      inset: 0.0009 * scale,
      base: 0.0022 * scale,
      meniscus: 0.001,
      segments: 56,
    });
    if (geometry) {
      const material = ctx.library.liquid(options.liquid.color ?? 0xd9a441, {
        opacity: options.liquid.opacity ?? 0.8,
        turbidity: options.liquid.turbidity ?? 0,
        glow: options.liquid.glow ?? 0,
      });
      const volume = new Mesh(geometry, material);
      volume.name = "liquid";
      volume.userData.isLiquid = true;
      volume.userData.noShadow = true;
      root.add(volume);
      root.userData.parts = { liquid: volume };
    }
  }

  const texture = ctx.library.labelTexture({
    title: label,
    subtitle,
    footer,
    accent,
    background: amber ? "#f4eddc" : "#eef4ec",
    barcode: true,
    width: 512,
    height: 256,
  });
  const labelMesh = curvedLabel({
    texture,
    radius: radius + 0.0011,
    height: 0.052 * scale,
    y: height * 0.38,
    arc: 1.62,
    material: ctx.library.label(texture),
  });
  root.add(labelMesh);

  if (hazard) {
    const hazardTexture = ctx.library.textTexture({
      text: hazard,
      sub: "HAZARD",
      width: 192,
      height: 192,
      background: "#f8d34a",
      foreground: "#2a1a00",
      accent: "#2a1a00",
    });
    const hazardMesh = flatLabel({
      texture: hazardTexture,
      width: 0.014 * scale,
      height: 0.014 * scale,
      y: height * 0.2,
      z: radius + 0.0012,
      material: ctx.library.label(hazardTexture),
    });
    root.add(hazardMesh);
  }

  root.userData.parts = { ...(root.userData.parts ?? {}), cap };
  root.userData.bottle = { volumeMl: Math.round(500 * scale ** 3), amber, label };
  return root;
}

/** Small amber dropper bottle used for stains and enzymes. */
export function buildDropperBottle(options = {}, ctx) {
  const scale = options.scale ?? 0.55;
  const profile = [
    [0.0002, 0.001],
    [0.016, 0.001],
    [0.019, 0.007],
    [0.019, 0.05],
    [0.017, 0.058],
    [0.0105, 0.068],
    [0.0105, 0.082],
    [0.0115, 0.084],
  ].map(([r, y]) => [r * scale * 1.4, y * scale * 1.4]);
  const height = profileHeight(profile);
  const glass = ctx.library.glass({ color: 0x5d2f0a, amber: true, transmission: 0.55, opacity: 0.9, thickness: 0.3 });
  const root = new Group();
  root.name = "dropper-bottle";
  root.add(new Mesh(vesselSurface(profile, 48), glass));
  addRim(root, profile[profile.length - 1][0], height - 0.0004, 0.0004, glass);
  if (options.liquid?.level > 0) {
    const geometry = liquidGeometry(profile, options.liquid.level, { inset: 0.0007, base: 0.0015, segments: 40 });
    if (geometry) {
      const mesh = new Mesh(geometry, ctx.library.liquid(options.liquid.color ?? 0xf59e0b, { opacity: 0.85 }));
      mesh.userData.isLiquid = true;
      mesh.userData.noShadow = true;
      root.add(mesh);
      root.userData.parts = { liquid: mesh };
    }
  }
  const cap = new Mesh(new CylinderGeometry(0.012 * scale * 1.4, 0.012 * scale * 1.4, 0.018, 24), ctx.library.plastic(options.capColor ?? 0x111c1e));
  cap.position.y = height + 0.007;
  root.add(cap);
  const bulb = new Mesh(new CylinderGeometry(0.007, 0.009, 0.018, 20), ctx.library.rubber(0x1d2a2b));
  bulb.position.y = height + 0.024;
  root.add(bulb);
  root.userData.parts = { ...(root.userData.parts ?? {}), cap };
  return root;
}

export const BOTTLE_TYPES = {
  bottle: buildBottle,
  reagentBottle: buildBottle,
  dropperBottle: buildDropperBottle,
};

export default BOTTLE_TYPES;
